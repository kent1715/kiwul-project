/**
 * ComfyUI Integration Module for Project Kiwul
 *
 * Properly integrates with ComfyUI's API:
 * 1. Queue prompts with correct workflow JSON (auto-detected model format)
 * 2. WebSocket connection for real-time progress tracking
 * 3. Poll /history/{prompt_id} for completion
 * 4. Fetch generated images/videos from /view endpoint
 * 5. Build proper FLUX Dev / SDXL / WAN 2.2 workflows
 * 6. Save images to disk for FFmpeg assembly
 * 7. Cancel/interrupt running generations
 * 8. Auto-detect installed nodes and model formats
 */

import path from "path";
import fs from "fs";
import { WebSocket } from "ws";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ComfyUIConfig {
  comfyUrl: string;
  comfyCheckpoint: string;        // FLUX checkpoint for image generation
  comfyNegativePrompt: string;
  workflowTemplate: string;
  wanMode: "i2v" | "t2v";
  wanResolution: "16:9" | "9:16";
  wanSteps: number;
  wanCfg: number;
  wanFrames: number;
  wanMotionIntensity: number;
  wanCheckpoint?: string;          // WAN 2.2 checkpoint for video generation (separate from FLUX)
  aspectRatio?: string;
  comfyLora?: string;
  comfyLoraStrength?: number;
  comfySampler?: string;
  comfyScheduler?: string;
  comfySteps?: number;
  comfyCfg?: number;
}

export interface ComfyUIPromptResult {
  promptId: string;
  number: number;
  nodeErrors?: Record<string, any>;
}

export interface ComfyUIOutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

export interface ComfyUIHistoryEntry {
  prompt: any[];
  outputs: Record<string, {
    images?: ComfyUIOutputImage[];
    gifs?: ComfyUIOutputImage[];
    videos?: ComfyUIOutputImage[];
  }>;
  status: {
    status_str: string;
    completed: boolean;
    messages?: string[][];
  };
}

export interface ComfyUIProgress {
  value: number;
  max: number;
  promptId?: string;
  nodeId?: number;
  nodeName?: string;
}

export interface ComfyUINodeInfo {
  input?: {
    required?: Record<string, any>;
    optional?: Record<string, any>;
  };
}

export interface ComfyUISystemInfo {
  devices?: Array<{
    name: string;
    type: string;
    vram_total: number;
    vram_free: number;
  }>;
  system?: {
    OS: string;
    python_version: string;
  };
}

export type ProgressCallback = (progress: ComfyUIProgress) => void;

// ─── Constants ───────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 300000; // 5 minutes max per prompt
const FETCH_TIMEOUT_MS = 30000; // 30 seconds for image fetch
const WS_RECONNECT_DELAY_MS = 3000;

// ─── WebSocket Manager ──────────────────────────────────────────────────────

/**
 * Manages a WebSocket connection to ComfyUI for real-time progress updates.
 * ComfyUI sends progress messages on execution:
 *   - { type: "status", data: { status: { exec_info: { queue_remaining } } } }
 *   - { type: "execution_start", data: { prompt_id } }
 *   - { type: "execution_cached", data: { prompt_id, nodes } }
 *   - { type: "progress", data: { value, max, prompt_id } }
 *   - { type: "executing", data: { node, prompt_id } }
 *   - { type: "executed", data: { node, output, prompt_id } }
 *   - { type: "execution_error", data: { prompt_id, ... } }
 *   - { type: "execution_success", data: { prompt_id } }
 */
class ComfyUIWebSocket {
  private ws: WebSocket | null = null;
  private comfyUrl: string;
  private clientId: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private progressCallback: ProgressCallback | null = null;
  private currentPromptId: string | null = null;
  private _connected = false;

  constructor(comfyUrl: string, clientId: string) {
    this.comfyUrl = comfyUrl;
    this.clientId = clientId;
  }

  get connected(): boolean {
    return this._connected;
  }

  onProgress(cb: ProgressCallback) {
    this.progressCallback = cb;
  }

  setPromptId(promptId: string | null) {
    this.currentPromptId = promptId;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Convert http(s) URL to ws(s) URL
        const wsUrl = this.comfyUrl
          .replace(/^http/, "ws")
          .replace(/\/$/, "") + `/ws?clientId=${this.clientId}`;

        console.log(`[COMFYUI WS] Connecting to ${wsUrl}...`);
        this.ws = new WebSocket(wsUrl);

        this.ws.on("open", () => {
          console.log("[COMFYUI WS] Connected");
          this._connected = true;
          resolve();
        });

        this.ws.on("message", (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString());
            this.handleMessage(msg);
          } catch (err) {
            // Ignore non-JSON messages (binary previews)
          }
        });

        this.ws.on("close", () => {
          console.log("[COMFYUI WS] Disconnected");
          this._connected = false;
          this.scheduleReconnect();
        });

        this.ws.on("error", (err) => {
          console.warn("[COMFYUI WS] Error:", err.message);
          this._connected = false;
          reject(err);
        });

        // Timeout for initial connection
        setTimeout(() => {
          if (!this._connected) {
            reject(new Error("WebSocket connection timeout"));
          }
        }, 10000);
      } catch (err: any) {
        reject(err);
      }
    });
  }

  private handleMessage(msg: any) {
    if (!this.progressCallback) return;

    switch (msg.type) {
      case "progress": {
        // Real-time step progress
        const pid = msg.data?.prompt_id;
        if (!this.currentPromptId || pid === this.currentPromptId) {
          this.progressCallback({
            value: msg.data.value,
            max: msg.data.max,
            promptId: pid,
          });
        }
        break;
      }
      case "executing": {
        // Currently executing a node
        const nodeId = msg.data?.node;
        const pid = msg.data?.prompt_id;
        if (nodeId && (!this.currentPromptId || pid === this.currentPromptId)) {
          this.progressCallback({
            value: 0,
            max: 0,
            promptId: pid,
            nodeId: typeof nodeId === "string" ? parseInt(nodeId) : nodeId,
            nodeName: `Node ${nodeId}`,
          });
        }
        break;
      }
      case "execution_error": {
        console.error("[COMFYUI WS] Execution error:", msg.data);
        break;
      }
      case "execution_success": {
        const pid = msg.data?.prompt_id;
        if (!this.currentPromptId || pid === this.currentPromptId) {
          this.progressCallback({
            value: 1,
            max: 1,
            promptId: pid,
          });
        }
        break;
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, WS_RECONNECT_DELAY_MS);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }
}

// ─── ComfyUI Client ─────────────────────────────────────────────────────────

/**
 * Queue a prompt to ComfyUI and return the prompt_id
 */
export async function queuePrompt(
  comfyUrl: string,
  workflow: Record<string, any>
): Promise<ComfyUIPromptResult> {
  const clientId = `kiwul_${Date.now()}`;

  const response = await fetch(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      client_id: clientId,
      prompt: workflow,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(errText);
    } catch {
      // not JSON
    }

    // Build detailed error message with node-level details
    let errorMessage = "";

    if (parsed?.error?.message) {
      errorMessage = parsed.error.message;
    }

    // Extract node-level validation errors (this is the key info for "Prompt outputs failed validation")
    if (parsed?.node_errors && typeof parsed.node_errors === "object") {
      const nodeDetails: string[] = [];
      for (const [nodeId, errors] of Object.entries(parsed.node_errors)) {
        const errArr = errors as any[];
        if (Array.isArray(errArr)) {
          for (const e of errArr) {
            nodeDetails.push(`Node ${nodeId} (${workflow[nodeId]?.class_type || "unknown"}): ${e.message || e.code || JSON.stringify(e)}`);
          }
        } else if (typeof errArr === "object" && errArr !== null) {
          nodeDetails.push(`Node ${nodeId} (${workflow[nodeId]?.class_type || "unknown"}): ${JSON.stringify(errArr)}`);
        }
      }
      if (nodeDetails.length > 0) {
        errorMessage += (errorMessage ? " | " : "") + "Node errors: " + nodeDetails.join("; ");
      }
    }

    // Also check for validation errors in the top-level error
    if (parsed?.error?.details) {
      errorMessage += (errorMessage ? " | " : "") + JSON.stringify(parsed.error.details);
    }

    if (!errorMessage) {
      errorMessage = errText || `ComfyUI returned status ${response.status}`;
    }

    throw new Error(
      `ComfyUI prompt queue failed: ${errorMessage}`
    );
  }

  const data = await response.json();
  return {
    promptId: data.prompt_id,
    number: data.number,
    nodeErrors: data.node_errors,
  };
}

/**
 * Poll ComfyUI /history/{promptId} until the prompt completes or times out.
 * Optionally uses WebSocket for real-time progress.
 */
export async function pollForResult(
  comfyUrl: string,
  promptId: string,
  onLog?: (msg: string) => void,
  timeoutMs: number = POLL_TIMEOUT_MS,
  onProgress?: ProgressCallback
): Promise<ComfyUIHistoryEntry> {
  const startTime = Date.now();
  let lastProgressValue = -1;

  // Try to connect WebSocket for real-time progress
  let ws: ComfyUIWebSocket | null = null;
  try {
    ws = new ComfyUIWebSocket(comfyUrl, `kiwul_poll_${Date.now()}`);
    ws.setPromptId(promptId);
    ws.onProgress((progress) => {
      if (onProgress) onProgress(progress);
      if (progress.value > 0 && progress.max > 0) {
        const pct = Math.round((progress.value / progress.max) * 100);
        if (pct !== lastProgressValue && onLog) {
          lastProgressValue = pct;
          onLog(`[COMFYUI] Generation progress: ${progress.value}/${progress.max} steps (${pct}%)`);
        }
      }
    });
    await ws.connect();
    if (onLog) onLog(`[COMFYUI] WebSocket connected for real-time progress tracking`);
  } catch (err: any) {
    if (onLog) onLog(`[COMFYUI] WebSocket unavailable, falling back to HTTP polling (${err.message})`);
    ws = null;
  }

  try {
    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(`${comfyUrl}/history/${promptId}`, {
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const history = await response.json();

          // The history is keyed by prompt_id
          const entry = history[promptId];
          if (entry) {
            // Check if completed
            if (entry.status?.completed || entry.status?.status_str === "success") {
              return entry;
            }

            // Check for error
            if (entry.status?.status_str === "error") {
              const msgs = entry.status.messages || [];
              throw new Error(
                `ComfyUI execution error: ${msgs.map((m: any) => m.join(": ")).join("; ")}`
              );
            }

            // Still running - log progress if no WS
            if (!ws?.connected && onLog) {
              const elapsed = Math.round((Date.now() - startTime) / 1000);
              onLog(`[COMFYUI] Still generating... (${elapsed}s elapsed)`);
            }
          }
        }
      } catch (err: any) {
        // Network error during polling - retry
        if (err.message?.includes("ComfyUI execution error")) {
          throw err;
        }
        if (onLog) {
          onLog(`[COMFYUI] Poll retry: ${err.message}`);
        }
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, ws?.connected ? 3000 : POLL_INTERVAL_MS));
    }

    throw new Error(
      `ComfyUI generation timed out after ${Math.round(timeoutMs / 1000)}s for prompt ${promptId}`
    );
  } finally {
    ws?.disconnect();
  }
}

/**
 * Fetch a generated image from ComfyUI and return as base64 data URL
 */
export async function fetchImageAsBase64(
  comfyUrl: string,
  imageInfo: ComfyUIOutputImage
): Promise<string> {
  const params = new URLSearchParams({
    filename: imageInfo.filename,
    subfolder: imageInfo.subfolder || "",
    type: imageInfo.type || "output",
  });

  const response = await fetch(`${comfyUrl}/view?${params}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch image "${imageInfo.filename}" from ComfyUI: status ${response.status}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString("base64");

  // Determine content type from filename extension
  const ext = imageInfo.filename.split(".").pop()?.toLowerCase() || "png";
  const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";

  return `data:${contentType};base64,${base64}`;
}

/**
 * Save a fetched image to local disk (for FFmpeg assembly)
 * Returns the absolute file path where the image was saved.
 */
export async function fetchAndSaveImage(
  comfyUrl: string,
  imageInfo: ComfyUIOutputImage,
  outputDir: string,
  filenameOverride?: string
): Promise<string> {
  const params = new URLSearchParams({
    filename: imageInfo.filename,
    subfolder: imageInfo.subfolder || "",
    type: imageInfo.type || "output",
  });

  const response = await fetch(`${comfyUrl}/view?${params}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch image "${imageInfo.filename}" from ComfyUI: status ${response.status}`
    );
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const ext = imageInfo.filename.split(".").pop()?.toLowerCase() || "png";
  const filename = filenameOverride || `kiwul_${Date.now()}.${ext}`;
  const filePath = path.join(outputDir, filename);

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(filePath, buffer);

  return filePath;
}

/**
 * Extract output images from a completed history entry
 */
export function extractOutputImages(
  historyEntry: ComfyUIHistoryEntry
): ComfyUIOutputImage[] {
  const images: ComfyUIOutputImage[] = [];

  if (!historyEntry.outputs) return images;

  for (const nodeId of Object.keys(historyEntry.outputs)) {
    const output = historyEntry.outputs[nodeId];

    // Regular images (from SaveImage node)
    if (output.images && Array.isArray(output.images)) {
      images.push(...output.images);
    }

    // Animated/GIF outputs
    if (output.gifs && Array.isArray(output.gifs)) {
      images.push(...output.gifs);
    }

    // Video outputs (mp4, webm)
    if (output.videos && Array.isArray(output.videos)) {
      images.push(...output.videos);
    }
  }

  return images;
}

/**
 * Full generation pipeline: queue -> poll -> fetch image
 * Optionally saves image to disk if outputDir is provided.
 */
export async function generateImage(
  config: ComfyUIConfig,
  prompt: string,
  onLog?: (msg: string) => void,
  seed?: number,
  outputDir?: string
): Promise<{ dataUrl: string | null; filePath: string | null }> {
  const { comfyUrl } = config;

  if (onLog) onLog(`[COMFYUI] Building workflow for: "${prompt.substring(0, 80)}..."`);

  // Auto-detect the best workflow based on installed nodes and model format
  const workflow = await buildBestWorkflow(config, prompt, seed, onLog);

  if (onLog) onLog(`[COMFYUI] Queueing prompt to ${comfyUrl}...`);

  // Queue the prompt
  const result = await queuePrompt(comfyUrl, workflow);

  if (result.nodeErrors && Object.keys(result.nodeErrors).length > 0) {
    if (onLog) onLog(`[COMFYUI] Node validation warnings: ${JSON.stringify(result.nodeErrors)}`);
  }

  if (onLog) onLog(`[COMFYUI] Prompt queued (ID: ${result.promptId}). Waiting for generation...`);

  // Poll for completion (with WebSocket progress)
  const historyEntry = await pollForResult(
    comfyUrl,
    result.promptId,
    onLog,
    POLL_TIMEOUT_MS,
    (progress) => {
      if (progress.value > 0 && progress.max > 0) {
        // Progress is reported via onLog in pollForResult
      }
    }
  );

  // Extract and fetch images
  const outputImages = extractOutputImages(historyEntry);

  if (outputImages.length === 0) {
    if (onLog) onLog(`[COMFYUI] No output images found in history entry. Outputs: ${JSON.stringify(historyEntry.outputs)}`);
    return { dataUrl: null, filePath: null };
  }

  if (onLog) onLog(`[COMFYUI] Found ${outputImages.length} output image(s). Fetching first one...`);

  // Fetch the first image as base64 data URL
  const imageDataUrl = await fetchImageAsBase64(comfyUrl, outputImages[0]);

  // Optionally save to disk
  let filePath: string | null = null;
  if (outputDir) {
    try {
      const ext = outputImages[0].filename.split(".").pop()?.toLowerCase() || "png";
      filePath = await fetchAndSaveImage(
        comfyUrl,
        outputImages[0],
        outputDir,
        `scene_${Date.now()}.${ext}`
      );
      if (onLog) onLog(`[COMFYUI] Image saved to disk: ${filePath}`);
    } catch (err: any) {
      if (onLog) onLog(`[COMFYUI] Warning: Could not save to disk: ${err.message}`);
    }
  }

  if (onLog) onLog(`[COMFYUI] Image fetched successfully (${(imageDataUrl.length / 1024).toFixed(0)} KB base64)`);

  return { dataUrl: imageDataUrl, filePath };
}

/**
 * Generate a video using WAN 2.2 I2V (Image-to-Video) via ComfyUI
 */
export async function generateVideo(
  config: ComfyUIConfig,
  motionPrompt: string,
  inputImageBase64: string,
  onLog?: (msg: string) => void,
  seed?: number
): Promise<string | null> {
  const { comfyUrl } = config;

  if (onLog) onLog(`[COMFYUI WAN] Building I2V workflow for motion: "${motionPrompt.substring(0, 80)}..."`);

  // First, upload the input image to ComfyUI
  const uploadedFilename = await uploadImage(comfyUrl, inputImageBase64, `kiwul_input_${Date.now()}.png`);

  if (onLog) onLog(`[COMFYUI WAN] Input image uploaded as: ${uploadedFilename}`);

  // Build the WAN 2.2 I2V workflow
  const workflow = buildWanI2VWorkflow(config, motionPrompt, uploadedFilename, seed);

  if (onLog) onLog(`[COMFYUI WAN] Queueing I2V prompt to ${comfyUrl}...`);

  // Queue the prompt
  const result = await queuePrompt(comfyUrl, workflow);

  if (onLog) onLog(`[COMFYUI WAN] I2V prompt queued (ID: ${result.promptId}). Video generation may take several minutes...`);

  // Poll for completion (longer timeout for video)
  const historyEntry = await pollForResult(comfyUrl, result.promptId, onLog, 600000); // 10 min timeout for video

  // Extract output
  const outputImages = extractOutputImages(historyEntry);

  if (outputImages.length === 0) {
    if (onLog) onLog(`[COMFYUI WAN] No output video/images found.`);
    return null;
  }

  if (onLog) onLog(`[COMFYUI WAN] Found ${outputImages.length} output(s). Fetching first one...`);

  // Fetch the first output
  const outputDataUrl = await fetchImageAsBase64(comfyUrl, outputImages[0]);

  if (onLog) onLog(`[COMFYUI WAN] Output fetched successfully`);

  return outputDataUrl;
}

/**
 * Upload an image to ComfyUI's input directory
 */
export async function uploadImage(
  comfyUrl: string,
  dataUrl: string,
  filename: string
): Promise<string> {
  // Extract base64 data from data URL
  const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!base64Match) {
    throw new Error("Invalid data URL format for image upload");
  }

  const base64Data = base64Match[1];
  const buffer = Buffer.from(base64Data, "base64");

  // Determine content type
  const mimeMatch = dataUrl.match(/^data:([^;]+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/png";

  // Create form data manually
  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  formData.append("image", blob, filename);
  formData.append("overwrite", "true");

  const response = await fetch(`${comfyUrl}/upload/image`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ComfyUI image upload failed: ${errText}`);
  }

  const data = await response.json();
  return data.name || filename;
}

/**
 * Get list of available checkpoints from ComfyUI
 */
export async function getCheckpoints(comfyUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${comfyUrl}/object_info/CheckpointLoaderSimple`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const inputInfo = data?.CheckpointLoaderSimple?.input;
    if (inputInfo?.required?.ckpt_name) {
      return inputInfo.required.ckpt_name[0] || [];
    }

    return [];
  } catch (err) {
    return [];
  }
}

/**
 * Get list of available UNET models from ComfyUI (for FLUX unet-only format)
 */
export async function getUNETModels(comfyUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${comfyUrl}/object_info/UNETLoader`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const inputInfo = data?.UNETLoader?.input;
    if (inputInfo?.required?.unet_name) {
      return inputInfo.required.unet_name[0] || [];
    }

    return [];
  } catch (err) {
    return [];
  }
}

/**
 * Get list of available CLIP vision models (for WAN I2V)
 */
export async function getClipVisionModels(comfyUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${comfyUrl}/object_info/CLIPVisionLoader`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const inputInfo = data?.CLIPVisionLoader?.input;
    if (inputInfo?.required?.clip_name) {
      return inputInfo.required.clip_name[0] || [];
    }

    return [];
  } catch (err) {
    return [];
  }
}

/**
 * Get list of available LoRA models
 */
export async function getLoraModels(comfyUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${comfyUrl}/object_info/LoraLoader`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const inputInfo = data?.LoraLoader?.input;
    if (inputInfo?.required?.lora_name) {
      return inputInfo.required.lora_name[0] || [];
    }

    return [];
  } catch (err) {
    return [];
  }
}

/**
 * Get list of available VAE models
 */
export async function getVAEModels(comfyUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${comfyUrl}/object_info/VAELoader`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const inputInfo = data?.VAELoader?.input;
    if (inputInfo?.required?.vae_name) {
      return inputInfo.required.vae_name[0] || [];
    }

    return [];
  } catch (err) {
    return [];
  }
}

/**
 * Get list of available CLIP models for DualCLIPLoader (for FLUX UNET workflow)
 * Returns { clip_name1: string[], clip_name2: string[] }
 */
export async function getDualCLIPModels(comfyUrl: string): Promise<{ clip_name1: string[]; clip_name2: string[] }> {
  try {
    const response = await fetch(`${comfyUrl}/object_info/DualCLIPLoader`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { clip_name1: [], clip_name2: [] };
    }

    const data = await response.json();
    const inputInfo = data?.DualCLIPLoader?.input;
    return {
      clip_name1: inputInfo?.required?.clip_name1?.[0] || [],
      clip_name2: inputInfo?.required?.clip_name2?.[0] || [],
    };
  } catch (err) {
    return { clip_name1: [], clip_name2: [] };
  }
}

/**
 * Check if a specific node class_type is available in ComfyUI
 */
export async function isNodeAvailable(comfyUrl: string, classType: string): Promise<boolean> {
  try {
    const response = await fetch(`${comfyUrl}/object_info/${classType}`, {
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get comprehensive ComfyUI system and model info
 */
export async function getComfyUISystemInfo(comfyUrl: string): Promise<ComfyUISystemInfo | null> {
  try {
    const response = await fetch(`${comfyUrl}/system_stats`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if ComfyUI is reachable and get basic info
 */
export async function checkComfyUIConnection(comfyUrl: string): Promise<{
  ok: boolean;
  message: string;
  systemInfo?: any;
}> {
  try {
    const response = await fetch(`${comfyUrl}/system_stats`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        ok: true,
        message: `Connected to ComfyUI at ${comfyUrl}`,
        systemInfo: data,
      };
    }

    // Fallback: try root endpoint
    const rootResponse = await fetch(comfyUrl, {
      signal: AbortSignal.timeout(5000),
    });

    if (rootResponse.ok || rootResponse.status === 200) {
      return {
        ok: true,
        message: `Connected to ComfyUI at ${comfyUrl}`,
      };
    }

    return {
      ok: false,
      message: `ComfyUI returned status ${rootResponse.status}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `ComfyUI offline or timed out: ${err.message}`,
    };
  }
}

/**
 * Interrupt/cancel a running ComfyUI generation
 */
export async function interruptGeneration(comfyUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${comfyUrl}/interrupt`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Clear the ComfyUI queue
 */
export async function clearQueue(comfyUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${comfyUrl}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete: [] }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ─── Auto-Detect & Workflow Selection ────────────────────────────────────────

/**
 * Resolve FLUX-specific model names (CLIP and VAE) by querying ComfyUI's API.
 * Falls back to common defaults if the query fails.
 */
async function resolveFluxUNETModels(
  comfyUrl: string,
  onLog?: (msg: string) => void
): Promise<{ clipName1: string; clipName2: string; vaeName: string }> {
  // Defaults (most common names)
  let clipName1 = "clip_l.safetensors";
  let clipName2 = "t5xxl_fp16.safetensors";
  let vaeName = "ae.safetensors";

  try {
    // Query DualCLIPLoader for available CLIP model pairs
    const clipResponse = await fetch(`${comfyUrl}/object_info/DualCLIPLoader`, {
      signal: AbortSignal.timeout(10000),
    });
    if (clipResponse.ok) {
      const data = await clipResponse.json();
      const inputInfo = data?.DualCLIPLoader?.input;
      if (inputInfo?.required) {
        const availableClip1 = inputInfo.required.clip_name1?.[0] as string[] | undefined;
        const availableClip2 = inputInfo.required.clip_name2?.[0] as string[] | undefined;

        // Find best match for clip_l
        if (availableClip1 && availableClip1.length > 0) {
          const clipLMatch = availableClip1.find(c => c.toLowerCase().includes("clip_l")) ||
                            availableClip1.find(c => c.toLowerCase().includes("clip_l"));
          if (clipLMatch) clipName1 = clipLMatch;
          else if (availableClip1.length > 0) clipName1 = availableClip1[0];
        }

        // Find best match for t5xxl
        if (availableClip2 && availableClip2.length > 0) {
          const t5Match = availableClip2.find(c => c.toLowerCase().includes("t5xxl")) ||
                         availableClip2.find(c => c.toLowerCase().includes("t5"));
          if (t5Match) clipName2 = t5Match;
          else if (availableClip2.length > 0) clipName2 = availableClip2[0];
        }
      }
    }

    // Query VAELoader for available VAE models
    const vaeModels = await getVAEModels(comfyUrl);
    if (vaeModels.length > 0) {
      const aeMatch = vaeModels.find(v => v.toLowerCase().includes("ae"));
      if (aeMatch) vaeName = aeMatch;
      else vaeName = vaeModels[0]; // Use first available VAE
    }

    if (onLog) onLog(`[COMFYUI] Resolved FLUX models: CLIP1=${clipName1}, CLIP2=${clipName2}, VAE=${vaeName}`);
  } catch (err: any) {
    if (onLog) onLog(`[COMFYUI] Could not query ComfyUI for CLIP/VAE model names, using defaults: ${err.message}`);
  }

  return { clipName1, clipName2, vaeName };
}

async function buildBestWorkflow(
  config: ComfyUIConfig,
  prompt: string,
  seed?: number,
  onLog?: (msg: string) => void
): Promise<Record<string, any>> {
  const { comfyUrl, workflowTemplate } = config;

  // ── CRITICAL: Validate checkpoint before any template selection ──
  // If comfyCheckpoint is empty, wrong, or doesn't exist in ComfyUI,
  // auto-correct to the first available checkpoint.
  // This prevents "ckpt_name not in list" validation errors.
  try {
    const checkpoints = await getCheckpoints(comfyUrl);
    // Filter out video/UNET models that should NOT be used for image generation
    const imageCheckpoints = checkpoints.filter(c => {
      const lower = c.toLowerCase();
      return !lower.includes("ltx") && !lower.includes("ltxv") && !lower.includes("wan") && !lower.includes("cogvideo");
    });
    if (imageCheckpoints.length > 0) {
      const checkpointExists = imageCheckpoints.some(c => c === config.comfyCheckpoint);
      if (!checkpointExists) {
        const oldCheckpoint = config.comfyCheckpoint;
        const newCheckpoint = imageCheckpoints[0];
        if (onLog) onLog(`[COMFYUI] WARNING: Checkpoint "${oldCheckpoint}" not found in ComfyUI. Auto-correcting to "${newCheckpoint}". Available image checkpoints: [${imageCheckpoints.join(", ")}]`);
        config = { ...config, comfyCheckpoint: newCheckpoint };
      }
    } else if (!config.comfyCheckpoint || config.comfyCheckpoint.trim() === "") {
      // No checkpoints in CheckpointLoaderSimple, try UNET
      const unetModels = await getUNETModels(comfyUrl);
      // Filter out video UNET models (LTX, WAN, etc.)
      const imageUnets = unetModels.filter(u => {
        const lower = u.toLowerCase();
        return !lower.includes("ltx") && !lower.includes("ltxv") && !lower.includes("wan") && !lower.includes("cogvideo");
      });
      if (imageUnets.length > 0) {
        config = { ...config, comfyCheckpoint: imageUnets[0] };
        if (onLog) onLog(`[COMFYUI] No image checkpoint in CheckpointLoaderSimple. Using UNET model: "${imageUnets[0]}"`);
      } else if (unetModels.length > 0) {
        // Last resort — but warn if it's a video model
        const chosen = unetModels[0];
        const lower = chosen.toLowerCase();
        if (lower.includes("ltx") || lower.includes("ltxv") || lower.includes("wan")) {
          if (onLog) onLog(`[COMFYUI] ⚠️ CRITICAL: Only video UNET models found! "${chosen}" is a VIDEO model, NOT suitable for image generation. Image generation will likely fail. Please install an image model (SDXL, FLUX, etc.) in ComfyUI.`);
        }
        config = { ...config, comfyCheckpoint: chosen };
      }
    }
  } catch (err: any) {
    if (onLog) onLog(`[COMFYUI] Could not validate checkpoint against ComfyUI: ${err.message}. Proceeding with configured value.`);
  }

  // ── Helper functions (used throughout this function) ──

  // Detect checkpoint type by name keywords
  const detectCheckpointType = (name: string): "sdxl" | "flux" | "unknown" => {
    const lower = name.toLowerCase();
    const sdxlKeywords = ["sdxl", "xl", "lightning", "dreamshaper", "realvis",
      "juggernaut", "epicrealism", "protovision", "realistic", "dynavision",
      "pony", "animagine", "counterfeit", "cyberrealistic", "amour",
      "realism-engine", "sd_xl", "sdxl_"];
    const fluxKeywords = ["flux"];
    const isSDXL = sdxlKeywords.some(kw => lower.includes(kw));
    const isFLUX = fluxKeywords.some(kw => lower.includes(kw));
    if (isSDXL && !isFLUX) return "sdxl";
    if (isFLUX && !isSDXL) return "flux";
    if (isSDXL && isFLUX) return "flux"; // Ambiguous — prefer FLUX to avoid mismatched CLIP
    return "unknown";
  };

  // Build Lightning-optimized config that FORCES correct settings
  // regardless of what FLUX defaults may be in the settings
  const buildLightningConfig = (cfg: ComfyUIConfig): ComfyUIConfig => ({
    ...cfg,
    comfySteps: 8,           // Lightning needs 4-8 steps (not 20!)
    comfyCfg: 1.5,            // Lightning uses very low CFG (not 3.5!)
    comfySampler: "dpmpp_sde", // Lightning optimized sampler
    comfyScheduler: "karras",  // Lightning optimized scheduler
  });

  // ── SMART REDIRECT: If checkpoint is SDXL but template is FLUX, force SDXL workflow ──
  // This is the ultimate safety net: no matter what template is selected,
  // if the actual checkpoint is SDXL (e.g., auto-corrected from old FLUX default),
  // we MUST use the SDXL workflow. FLUX workflows will fail with SDXL checkpoints
  // because they use different CLIP/VAE architectures (DualCLIPLoader+t5xxl vs single CLIP).
  const ckptTypeQuick = detectCheckpointType(config.comfyCheckpoint);
  const isFLUXTemplate = workflowTemplate === "Flux_Schnell_Simple_API" ||
                         workflowTemplate === "FLUX_Dev_UNET" ||
                         workflowTemplate === "FLUX_Dev_Standard";

  if (ckptTypeQuick === "sdxl" && isFLUXTemplate) {
    if (onLog) onLog(`[COMFYUI] WARNING: Template "${workflowTemplate}" selected but checkpoint "${config.comfyCheckpoint}" is SDXL. FLUX workflow would fail. Auto-redirecting to SDXL workflow.`);
    if (config.comfyCheckpoint.toLowerCase().includes("lightning")) {
      return buildSDXLWorkflow(buildLightningConfig(config), prompt, seed);
    }
    return buildSDXLWorkflow(config, prompt, seed);
  }

  // If user explicitly chose SDXL Standard, use it directly
  if (workflowTemplate === "SDXL_Standard") {
    if (onLog) onLog(`[COMFYUI] Using SDXL Standard workflow template`);
    return buildSDXLWorkflow(config, prompt, seed);
  }

  // SDXL Lightning — optimized for lightning-fast SDXL models (4-8 steps, DPM++ SDE Karras)
  if (workflowTemplate === "SDXL_Lightning") {
    if (onLog) onLog(`[COMFYUI] Using SDXL Lightning workflow template (optimized for sdxl-lightning models)`);
    const lightningConfig = {
      ...config,
      comfySteps: config.comfySteps || 8,          // Lightning: 4-8 steps
      comfyCfg: config.comfyCfg || 1.5,             // Lightning: low CFG
      comfySampler: config.comfySampler || "dpmpp_sde",
      comfyScheduler: config.comfyScheduler || "karras",
    };
    return buildSDXLWorkflow(lightningConfig, prompt, seed);
  }

  // Flux_Schnell_Simple_API — the recommended workflow for flux1-schnell.safetensors
  // Uses CheckpointLoaderSimple with optimized Schnell settings (4 steps, cfg 1.0)
  if (workflowTemplate === "Flux_Schnell_Simple_API") {
    if (onLog) onLog(`[COMFYUI] Using Flux Schnell Simple API workflow (optimized for flux1-schnell)`);
    // Validate checkpoint exists, fallback to UNET if needed
    try {
      const checkpoints = await getCheckpoints(comfyUrl);
      const checkpointExists = checkpoints.some(c => c === config.comfyCheckpoint);
      if (checkpointExists) {
        if (onLog) onLog(`[COMFYUI] Checkpoint "${config.comfyCheckpoint}" validated.`);
        // Use Schnell-optimized settings: fewer steps, lower CFG
        const schnellConfig = {
          ...config,
          comfySteps: config.comfySteps || 4,   // Schnell is fast: 4 steps enough
          comfyCfg: config.comfyCfg || 1.0,      // Schnell uses CFG 1.0
          comfySampler: config.comfySampler || "euler",
          comfyScheduler: config.comfyScheduler || "simple",
        };
        return buildFluxWorkflow(schnellConfig, prompt, seed);
      }
      // Checkpoint not found as-is, try UNET
      if (onLog) onLog(`[COMFYUI] Checkpoint "${config.comfyCheckpoint}" not found. Trying UNET workflow...`);
      const models = await resolveFluxUNETModels(comfyUrl, onLog);
      return buildFluxUNETWorkflow(config, prompt, seed, models);
    } catch (err: any) {
      if (onLog) onLog(`[COMFYUI] Could not validate checkpoint: ${err.message}. Using UNET fallback.`);
      const models = await resolveFluxUNETModels(comfyUrl, onLog);
      return buildFluxUNETWorkflow(config, prompt, seed, models);
    }
  }

  // For FLUX_Dev_UNET, validate and resolve model names dynamically
  if (workflowTemplate === "FLUX_Dev_UNET") {
    if (onLog) onLog(`[COMFYUI] Using FLUX Dev UNET workflow template`);
    const models = await resolveFluxUNETModels(comfyUrl, onLog);
    return buildFluxUNETWorkflow(config, prompt, seed, models);
  }

  // For FLUX_Dev_Standard, validate that the checkpoint actually exists
  // If not found, auto-switch to UNET workflow
  if (workflowTemplate === "FLUX_Dev_Standard") {
    try {
      const checkpoints = await getCheckpoints(comfyUrl);
      const checkpointExists = checkpoints.some(c => c === config.comfyCheckpoint);

      if (!checkpointExists) {
        // Check if it exists as a UNET model instead
        const unetModels = await getUNETModels(comfyUrl);
        const unetExists = unetModels.some(m => m === config.comfyCheckpoint);

        if (unetExists) {
          if (onLog) onLog(`[COMFYUI] "${config.comfyCheckpoint}" not found as checkpoint, but found as UNET model. Auto-switching to UNET workflow.`);
          const models = await resolveFluxUNETModels(comfyUrl, onLog);
          return buildFluxUNETWorkflow(config, prompt, seed, models);
        }

        // Check if ANY flux-related UNET model exists
        const fluxUnetMatch = unetModels.find(m => m.toLowerCase().includes("flux"));
        if (fluxUnetMatch) {
          if (onLog) onLog(`[COMFYUI] "${config.comfyCheckpoint}" not found anywhere. Found UNET model "${fluxUnetMatch}". Auto-switching to UNET workflow.`);
          const adjustedConfig = { ...config, comfyCheckpoint: fluxUnetMatch };
          const models = await resolveFluxUNETModels(comfyUrl, onLog);
          return buildFluxUNETWorkflow(adjustedConfig, prompt, seed, models);
        }

        // No FLUX model found at all — check if we have an SDXL model instead
        if (checkpoints.length > 0) {
          const firstCheckpoint = checkpoints[0];
          const firstType = detectCheckpointType(firstCheckpoint);
          if (firstType === "sdxl") {
            if (onLog) onLog(`[COMFYUI] No FLUX model found. Found SDXL checkpoint "${firstCheckpoint}" instead. Auto-switching to SDXL workflow.`);
            return buildSDXLWorkflow({ ...config, comfyCheckpoint: firstCheckpoint }, prompt, seed);
          }
        }

        if (onLog) onLog(`[COMFYUI] WARNING: Checkpoint "${config.comfyCheckpoint}" not found! Available checkpoints: [${checkpoints.slice(0, 5).join(", ")}]. Trying UNET workflow as fallback.`);
        // Instead of falling through to a broken CheckpointLoaderSimple workflow,
        // try UNET workflow as the most common case for FLUX models
        const models = await resolveFluxUNETModels(comfyUrl, onLog);
        return buildFluxUNETWorkflow(config, prompt, seed, models);
      } else {
        if (onLog) onLog(`[COMFYUI] Checkpoint "${config.comfyCheckpoint}" validated. Using FLUX Dev Standard workflow.`);
      }
    } catch (err: any) {
      if (onLog) onLog(`[COMFYUI] Could not validate checkpoint: ${err.message}. Using UNET workflow as safe fallback.`);
      // When we can't validate, UNET is safer for FLUX models
      const models = await resolveFluxUNETModels(comfyUrl, onLog);
      return buildFluxUNETWorkflow(config, prompt, seed, models);
    }
    return buildFluxWorkflow(config, prompt, seed);
  }

  // Auto_Detect (default) or any other value:
  // Always query ComfyUI to determine the correct workflow

  // If comfyCheckpoint is empty, try to find the first available checkpoint from ComfyUI
  if (!config.comfyCheckpoint || config.comfyCheckpoint.trim() === "") {
    try {
      const checkpoints = await getCheckpoints(comfyUrl);
      if (checkpoints.length > 0) {
        config = { ...config, comfyCheckpoint: checkpoints[0] };
        if (onLog) onLog(`[COMFYUI] No checkpoint configured. Auto-detected first available: "${checkpoints[0]}"`);
      } else {
        const unetModels = await getUNETModels(comfyUrl);
        if (unetModels.length > 0) {
          config = { ...config, comfyCheckpoint: unetModels[0] };
          if (onLog) onLog(`[COMFYUI] No checkpoint configured. Auto-detected UNET model: "${unetModels[0]}"`);
        }
      }
    } catch (err: any) {
      if (onLog) onLog(`[COMFYUI] Could not auto-detect checkpoint: ${err.message}`);
    }
  }

  const checkpointLower = config.comfyCheckpoint.toLowerCase();
  const isFluxCheckpoint = checkpointLower.includes("flux");
  const isSDXLCheckpoint = checkpointLower.includes("sdxl") ||
                          checkpointLower.includes("xl") ||
                          checkpointLower.includes("lightning") ||
                          checkpointLower.includes("dreamshaper") ||
                          checkpointLower.includes("realvis") ||
                          checkpointLower.includes("juggernaut") ||
                          checkpointLower.includes("epicrealism") ||
                          checkpointLower.includes("protovision") ||
                          checkpointLower.includes("realistic") ||
                          checkpointLower.includes("dynavision");

  // If the checkpoint name suggests SDXL, verify against ComfyUI
  if (isSDXLCheckpoint && !isFluxCheckpoint) {
    // Double-check: try to validate the checkpoint exists in CheckpointLoaderSimple
    try {
      const checkpoints = await getCheckpoints(comfyUrl);
      const checkpointExists = checkpoints.some(c => c === config.comfyCheckpoint);
      if (checkpointExists) {
        if (checkpointLower.includes("lightning")) {
          if (onLog) onLog(`[COMFYUI] Auto-detected SDXL Lightning model "${config.comfyCheckpoint}". Using SDXL Lightning workflow (forced 8 steps, CFG 1.5, DPM++ SDE Karras).`);
          return buildSDXLWorkflow(buildLightningConfig(config), prompt, seed);
        }
        if (onLog) onLog(`[COMFYUI] Auto-detected SDXL model "${config.comfyCheckpoint}". Using SDXL workflow.`);
        return buildSDXLWorkflow(config, prompt, seed);
      }
      // Not found in checkpoints — might be UNET, let the rest of the logic handle it
      if (onLog) onLog(`[COMFYUI] Checkpoint "${config.comfyCheckpoint}" looks like SDXL but not found in CheckpointLoaderSimple. Checking UNET...`);
    } catch {
      // Can't validate, use SDXL workflow anyway based on name
      if (onLog) onLog(`[COMFYUI] Auto-detected SDXL model by name (validation skipped). Using SDXL workflow.`);
      if (checkpointLower.includes("lightning")) {
        return buildSDXLWorkflow(buildLightningConfig(config), prompt, seed);
      }
      return buildSDXLWorkflow(config, prompt, seed);
    }
  }

  // For FLUX, SDXL, or unknown models — validate against ComfyUI and pick the right workflow
  try {
    // Check if the checkpoint is available via CheckpointLoaderSimple
    const checkpoints = await getCheckpoints(comfyUrl);
    const checkpointExists = checkpoints.some(c => c === config.comfyCheckpoint);

    if (checkpointExists) {
      // CRITICAL FIX: Check the checkpoint type before choosing workflow builder
      const ckptType = detectCheckpointType(config.comfyCheckpoint);
      if (ckptType === "sdxl") {
        if (onLog) onLog(`[COMFYUI] Checkpoint "${config.comfyCheckpoint}" found and detected as SDXL. Using SDXL workflow.`);
        if (config.comfyCheckpoint.toLowerCase().includes("lightning")) {
          return buildSDXLWorkflow(buildLightningConfig(config), prompt, seed);
        }
        return buildSDXLWorkflow(config, prompt, seed);
      }
      if (onLog) onLog(`[COMFYUI] Checkpoint "${config.comfyCheckpoint}" found in CheckpointLoaderSimple (type: ${ckptType}). Using FLUX workflow.`);
      return buildFluxWorkflow(config, prompt, seed);
    }

    // Check if it's a UNET-only model
    const unetModels = await getUNETModels(comfyUrl);
    const unetExists = unetModels.some(m => m === config.comfyCheckpoint);

    if (unetExists) {
      // Check if this UNET is FLUX-specific (FLUX uses DualCLIPLoader with t5xxl)
      const unetType = detectCheckpointType(config.comfyCheckpoint);
      if (unetType === "sdxl") {
        if (onLog) onLog(`[COMFYUI] Checkpoint "${config.comfyCheckpoint}" found as UNET and detected as SDXL. Using SDXL CheckpointLoaderSimple workflow.`);
        const effectiveConfig = config.comfyCheckpoint.toLowerCase().includes("lightning")
          ? buildLightningConfig(config) : config;
        return buildSDXLWorkflow(effectiveConfig, prompt, seed);
      }
      if (onLog) onLog(`[COMFYUI] Checkpoint "${config.comfyCheckpoint}" found in UNETLoader. Using FLUX UNET workflow.`);
      const models = await resolveFluxUNETModels(comfyUrl, onLog);
      return buildFluxUNETWorkflow(config, prompt, seed, models);
    }

    // Check if ANY flux-related UNET model exists (might have different name)
    const fluxUnetMatch = unetModels.find(m => m.toLowerCase().includes("flux"));
    if (fluxUnetMatch && isFluxCheckpoint) {
      if (onLog) onLog(`[COMFYUI] FLUX checkpoint not found as-is, but found UNET model "${fluxUnetMatch}". Using UNET workflow.`);
      const adjustedConfig = { ...config, comfyCheckpoint: fluxUnetMatch };
      const models = await resolveFluxUNETModels(comfyUrl, onLog);
      return buildFluxUNETWorkflow(adjustedConfig, prompt, seed, models);
    }

    // Check if ANY UNET model exists (not just FLUX)
    if (unetModels.length > 0) {
      const firstUnet = unetModels[0];
      const unetType = detectCheckpointType(firstUnet);
      if (unetType === "sdxl") {
        if (onLog) onLog(`[COMFYUI] Checkpoint not found in either loader. Found UNET model "${firstUnet}" (SDXL). Using SDXL workflow.`);
        const cfg = firstUnet.toLowerCase().includes("lightning")
          ? buildLightningConfig({ ...config, comfyCheckpoint: firstUnet })
          : { ...config, comfyCheckpoint: firstUnet };
        return buildSDXLWorkflow(cfg, prompt, seed);
      }
      if (onLog) onLog(`[COMFYUI] Checkpoint not found in either loader. Found UNET model "${firstUnet}". Using UNET workflow.`);
      const adjustedConfig = { ...config, comfyCheckpoint: firstUnet };
      const models = await resolveFluxUNETModels(comfyUrl, onLog);
      return buildFluxUNETWorkflow(adjustedConfig, prompt, seed, models);
    }

    // Check if ANY checkpoint exists — pick the right workflow based on type
    if (checkpoints.length > 0) {
      const firstCheckpoint = checkpoints[0];
      const firstType = detectCheckpointType(firstCheckpoint);
      if (firstType === "sdxl") {
        if (onLog) onLog(`[COMFYUI] Checkpoint not found. Using first available checkpoint: "${firstCheckpoint}" (SDXL).`);
        const cfg = firstCheckpoint.toLowerCase().includes("lightning")
          ? buildLightningConfig({ ...config, comfyCheckpoint: firstCheckpoint })
          : { ...config, comfyCheckpoint: firstCheckpoint };
        return buildSDXLWorkflow(cfg, prompt, seed);
      }
      if (onLog) onLog(`[COMFYUI] Checkpoint not found. Using first available checkpoint: "${firstCheckpoint}".`);
      const adjustedConfig = { ...config, comfyCheckpoint: firstCheckpoint };
      return buildFluxWorkflow(adjustedConfig, prompt, seed);
    }

    // Neither checkpoint nor UNET found
    if (onLog) onLog(`[COMFYUI] ERROR: No models found in ComfyUI! Please install at least one checkpoint or UNET model. Available checkpoints: [${checkpoints.join(", ")}]. Available UNETs: [${unetModels.join(", ")}].`);
    // Throw a clear error instead of building a workflow that will fail
    throw new Error(
      `No models found in ComfyUI. Please install a model in ComfyUI's models/checkpoints/ or models/unet/ directory. ` +
      `Available checkpoints: [${checkpoints.join(", ")}]. Available UNETs: [${unetModels.join(", ")}]`
    );
  } catch (err: any) {
    // Re-throw our own errors
    if (err.message?.includes("No models found in ComfyUI")) throw err;
    // When we can't validate, use checkpoint name heuristics to pick the right workflow
    const fallbackType = detectCheckpointType(config.comfyCheckpoint);
    if (fallbackType === "sdxl") {
      if (onLog) onLog(`[COMFYUI] Could not validate models (${err.message}). Checkpoint name suggests SDXL. Using SDXL workflow as fallback.`);
      return buildSDXLWorkflow(config, prompt, seed);
    }
    if (onLog) onLog(`[COMFYUI] Could not validate models (${err.message}). Using UNET workflow as safe fallback.`);
    const models = await resolveFluxUNETModels(comfyUrl, onLog);
    return buildFluxUNETWorkflow(config, prompt, seed, models);
  }
}

// ─── Workflow Builders ───────────────────────────────────────────────────────

/**
 * Build a FLUX Dev workflow using CheckpointLoaderSimple
 * This works with full-format FLUX checkpoints (e.g., flux1-dev.safetensors)
 *
 * Node graph:
 *   4: CheckpointLoaderSimple -> loads model, clip, vae
 *   6: CLIPTextEncode (positive)
 *   7: CLIPTextEncode (negative)
 *   5: EmptyLatentImage -> creates empty latent
 *   3: KSampler -> samples the model
 *   8: VAEDecode -> decodes latent to image
 *   9: SaveImage -> saves the final image
 */
export function buildFluxWorkflow(
  config: ComfyUIConfig,
  prompt: string,
  seed?: number
): Record<string, any> {
  const isVertical = config.aspectRatio === "9:16";
  const width = isVertical ? 720 : 1280;
  const height = isVertical ? 1280 : 720;

  const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);
  const steps = config.comfySteps || 20;
  const cfg = config.comfyCfg || 3.5; // FLUX typically uses lower CFG (1-4)
  const samplerName = config.comfySampler || "euler";
  const schedulerName = config.comfyScheduler || "normal";

  const nodes: Record<string, any> = {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: config.comfyCheckpoint || "",
      },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: prompt,
        clip: ["4", 1],
      },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: "", // FLUX works best without negative prompt - use empty string
        clip: ["4", 1],
      },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: width,
        height: height,
        batch_size: 1,
      },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: actualSeed,
        steps: steps,
        cfg: cfg,
        sampler_name: samplerName,
        scheduler: schedulerName,
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "kiwul/scene",
        images: ["8", 0],
      },
    },
  };

  // Add LoRA support if configured
  if (config.comfyLora) {
    nodes["10"] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: config.comfyLora,
        strength_model: config.comfyLoraStrength || 1.0,
        strength_clip: config.comfyLoraStrength || 1.0,
        model: ["4", 0],
        clip: ["4", 1],
      },
    };
    // Update KSampler to use LoRA model and clip
    nodes["3"].inputs.model = ["10", 0];
    nodes["6"].inputs.clip = ["10", 1];
    nodes["7"].inputs.clip = ["10", 1];
  }

  return nodes;
}

/**
 * Build a FLUX Dev workflow using UNETLoader + DualCLIPLoader
 * This works with UNET-only FLUX models (e.g., flux1-dev.safetensors in unet format)
 *
 * Node graph:
 *   20: UNETLoader -> loads FLUX unet model
 *   21: DualCLIPLoader -> loads clip_l + t5xxl for FLUX
 *   22: CLIPTextEncode (positive)
 *   23: CLIPTextEncode (negative - empty for FLUX)
 *   24: EmptyLatentImage
 *   25: KSampler
 *   26: VAELoader -> loads FLUX VAE separately
 *   27: VAEDecode
 *   28: SaveImage
 */
export function buildFluxUNETWorkflow(
  config: ComfyUIConfig,
  prompt: string,
  seed?: number,
  resolvedModels?: { clipName1: string; clipName2: string; vaeName: string }
): Record<string, any> {
  const isVertical = config.aspectRatio === "9:16";
  const width = isVertical ? 720 : 1280;
  const height = isVertical ? 1280 : 720;

  const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);
  const steps = config.comfySteps || 20;
  const cfg = config.comfyCfg || 3.5;
  const samplerName = config.comfySampler || "euler";
  const schedulerName = config.comfyScheduler || "normal";

  // Use resolved model names from ComfyUI API, or fall back to defaults
  const clipName1 = resolvedModels?.clipName1 || "clip_l.safetensors";
  const clipName2 = resolvedModels?.clipName2 || "t5xxl_fp16.safetensors";
  const vaeName = resolvedModels?.vaeName || "ae.safetensors";

  // Extract the base model name (remove extension if present)
  const unetName = config.comfyCheckpoint;

  return {
    "20": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: unetName,
        weight_dtype: "default",
      },
    },
    "21": {
      class_type: "DualCLIPLoader",
      inputs: {
        clip_name1: clipName1,
        clip_name2: clipName2,
        type: "flux",
      },
    },
    "22": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: prompt,
        clip: ["21", 0],
      },
    },
    "23": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: "", // FLUX works best without negative prompt
        clip: ["21", 0],
      },
    },
    "24": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: width,
        height: height,
        batch_size: 1,
      },
    },
    "25": {
      class_type: "KSampler",
      inputs: {
        seed: actualSeed,
        steps: steps,
        cfg: cfg,
        sampler_name: samplerName,
        scheduler: schedulerName,
        denoise: 1,
        model: ["20", 0],
        positive: ["22", 0],
        negative: ["23", 0],
        latent_image: ["24", 0],
      },
    },
    "26": {
      class_type: "VAELoader",
      inputs: {
        vae_name: vaeName, // Dynamically resolved from ComfyUI API
      },
    },
    "27": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["25", 0],
        vae: ["26", 0],
      },
    },
    "28": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "kiwul/scene",
        images: ["27", 0],
      },
    },
  };
}

/**
 * Build an SDXL workflow
 * SDXL uses dual text encoders (clip_l + clip_g) but loaded via CheckpointLoaderSimple.
 * SDXL typically uses higher CFG (5-8) and 20-30 steps.
 *
 * Node graph:
 *   30: CheckpointLoaderSimple -> loads SDXL model, clip, vae
 *   31: CLIPTextEncode (positive) -> uses clip from node 30
 *   32: CLIPTextEncode (negative) -> uses clip from node 30
 *   33: EmptyLatentImage -> creates empty latent at SDXL resolution
 *   34: KSampler -> samples the model
 *   35: VAEDecode -> decodes latent to image
 *   36: SaveImage -> saves the final image
 */
export function buildSDXLWorkflow(
  config: ComfyUIConfig,
  prompt: string,
  seed?: number
): Record<string, any> {
  const isVertical = config.aspectRatio === "9:16";
  // SDXL native resolution is 1024x1024; use multiples of 64
  const width = isVertical ? 768 : 1344;
  const height = isVertical ? 1344 : 768;

  const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);
  const steps = config.comfySteps || 25; // SDXL typically 20-30
  const cfg = config.comfyCfg || 7.0; // SDXL typically 5-8
  const samplerName = config.comfySampler || "dpmpp_2m";
  const schedulerName = config.comfyScheduler || "karras";

  const nodes: Record<string, any> = {
    "30": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: config.comfyCheckpoint || "sd_xl_base_1.0.safetensors",
      },
    },
    "31": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: prompt,
        clip: ["30", 1],
      },
    },
    "32": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: config.comfyNegativePrompt || "low quality, blurry, watermark, text overlay, deformed, ugly, bad anatomy",
        clip: ["30", 1],
      },
    },
    "33": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: width,
        height: height,
        batch_size: 1,
      },
    },
    "34": {
      class_type: "KSampler",
      inputs: {
        seed: actualSeed,
        steps: steps,
        cfg: cfg,
        sampler_name: samplerName,
        scheduler: schedulerName,
        denoise: 1,
        model: ["30", 0],
        positive: ["31", 0],
        negative: ["32", 0],
        latent_image: ["33", 0],
      },
    },
    "35": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["34", 0],
        vae: ["30", 2],
      },
    },
    "36": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "kiwul/scene",
        images: ["35", 0],
      },
    },
  };

  // Add LoRA support if configured
  if (config.comfyLora) {
    nodes["37"] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: config.comfyLora,
        strength_model: config.comfyLoraStrength || 1.0,
        strength_clip: config.comfyLoraStrength || 1.0,
        model: ["30", 0],
        clip: ["30", 1],
      },
    };
    // Update KSampler to use LoRA model and clip
    nodes["34"].inputs.model = ["37", 0];
    nodes["31"].inputs.clip = ["37", 1];
    nodes["32"].inputs.clip = ["37", 1];
  }

  return nodes;
}

/**
 * Build a WAN 2.2 Image-to-Video workflow
 *
 * This workflow assumes the user has WAN 2.2 custom nodes installed in ComfyUI.
 * Node graph:
 *   1: CheckpointLoaderSimple -> loads WAN model
 *   10: LoadImage -> loads the input image
 *   11: CLIPVisionEncode -> encodes image for I2V
 *   12: CLIPTextEncode (positive) -> motion prompt
 *   13: CLIPTextEncode (negative) -> negative prompt
 *   14: WanImageToVideo -> I2V generation
 *   15: VAEDecode -> decode video latent
 *   16: SaveImage -> save output frames
 */
export function buildWanI2VWorkflow(
  config: ComfyUIConfig,
  motionPrompt: string,
  inputImageFilename: string,
  seed?: number
): Record<string, any> {
  const isVertical = config.wanResolution === "9:16";
  const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);

  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: config.wanCheckpoint || "wan2.2_i2v_480p.safetensors",
      },
    },
    "10": {
      class_type: "LoadImage",
      inputs: {
        image: inputImageFilename,
      },
    },
    "11": {
      class_type: "CLIPVisionEncode",
      inputs: {
        clip_vision: ["1", 1],
        image: ["10", 0],
      },
    },
    "12": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: motionPrompt,
        clip: ["1", 1],
      },
    },
    "13": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: config.comfyNegativePrompt || "low quality, blurry, static, no motion",
        clip: ["1", 1],
      },
    },
    "14": {
      class_type: "WanImageToVideo",
      inputs: {
        model: ["1", 0],
        image: ["10", 0],
        clip_vision: ["11", 0],
        positive: ["12", 0],
        negative: ["13", 0],
        steps: config.wanSteps || 20,
        cfg: config.wanCfg || 6,
        seed: actualSeed,
        frames: config.wanFrames || 81,
        motion_strength: config.wanMotionIntensity || 7,
      },
    },
    "15": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["14", 0],
        vae: ["1", 2],
      },
    },
    "16": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "kiwul/video",
        images: ["15", 0],
      },
    },
  };
}

/**
 * Build a simplified WAN 2.2 I2V workflow that uses the alternative
 * node structure found in some ComfyUI packs.
 */
export function buildWanI2VWorkflowAlt(
  config: ComfyUIConfig,
  motionPrompt: string,
  inputImageFilename: string,
  seed?: number
): Record<string, any> {
  const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);

  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: config.wanCheckpoint || "wan2.2_i2v_480p.safetensors",
      },
    },
    "10": {
      class_type: "LoadImage",
      inputs: {
        image: inputImageFilename,
      },
    },
    "11": {
      class_type: "CLIPVisionEncode",
      inputs: {
        clip_vision: ["1", 1],
        image: ["10", 0],
      },
    },
    "12": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: motionPrompt,
        clip: ["1", 1],
      },
    },
    "13": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: config.comfyNegativePrompt || "",
        clip: ["1", 1],
      },
    },
    "14": {
      class_type: "ImageToVideo",
      inputs: {
        model: ["1", 0],
        image: ["10", 0],
        clip_vision: ["11", 0],
        positive: ["12", 0],
        negative: ["13", 0],
        steps: config.wanSteps || 20,
        cfg: config.wanCfg || 6,
        seed: actualSeed,
        num_frames: config.wanFrames || 81,
      },
    },
    "15": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["14", 0],
        vae: ["1", 2],
      },
    },
    "16": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "kiwul/video",
        images: ["15", 0],
      },
    },
  };
}

/**
 * Test ComfyUI by generating a simple test image.
 * Returns the image data URL on success, null on failure.
 */
export async function testGeneration(
  comfyUrl: string,
  checkpoint: string,
  workflowTemplate: string
): Promise<{ success: boolean; imageUrl: string | null; error: string | null; timeMs: number }> {
  const startTime = Date.now();

  try {
    const config: ComfyUIConfig = {
      comfyUrl,
      comfyCheckpoint: checkpoint,
      comfyNegativePrompt: "",
      workflowTemplate,
      wanMode: "i2v",
      wanResolution: "16:9",
      wanSteps: 20,
      wanCfg: 3.5,
      wanFrames: 81,
      wanMotionIntensity: 7,
      comfySteps: 10, // Quick test with fewer steps
      comfyCfg: 3.5,
    };

    const result = await generateImage(
      config,
      "a beautiful cat sitting on a windowsill, cinematic lighting, 8k",
      undefined,
      undefined
    );

    return {
      success: !!result.dataUrl,
      imageUrl: result.dataUrl,
      error: result.dataUrl ? null : "No image output received",
      timeMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      success: false,
      imageUrl: null,
      error: err.message,
      timeMs: Date.now() - startTime,
    };
  }
}

// ─── LTX-Video I2V Pipeline ─────────────────────────────────────────────────

/**
 * Convert a ComfyUI GUI-format workflow (with "nodes" array) to API format (keyed by node ID).
 */
export function convertGuiWorkflowToApi(guiWorkflow: any): Record<string, any> {
  const apiWorkflow: Record<string, any> = {};

  if (!guiWorkflow.nodes || !Array.isArray(guiWorkflow.nodes)) {
    return guiWorkflow; // Already API format or invalid
  }

  // Build a map of node ID → title for widget name extraction
  for (const node of guiWorkflow.nodes) {
    const nodeId = String(node.id);
    const classType = node.type || node.class_type || "";
    const inputs: Record<string, any> = {};

    // Extract widget values from node.inputs array (GUI format stores widget values there)
    if (Array.isArray(node.inputs)) {
      for (const input of node.inputs) {
        if (input.widget && input.widget.name !== undefined) {
          inputs[input.widget.name] = input.widget.value;
        }
      }
    }

    // Also extract from widgets_values if present (another GUI format)
    if (node.widgets_values && Array.isArray(node.widgets_values)) {
      // widgets_values correspond to the widget inputs in order
      // We'll let the specific injection logic handle proper mapping
    }

    apiWorkflow[nodeId] = {
      classType,
      inputs,
    };
  }

  // Now resolve links — GUI format uses link IDs, API format uses node references
  const linksMap = new Map<number, any[]>();
  if (Array.isArray(guiWorkflow.links)) {
    for (const link of guiWorkflow.links) {
      // link: [link_id, from_node_id, from_slot, to_node_id, to_slot, type]
      linksMap.set(link[0], link);
    }
  }

  // Connect outputs to inputs using links
  for (const node of guiWorkflow.nodes) {
    const nodeId = String(node.id);
    if (!apiWorkflow[nodeId]) continue;

    if (Array.isArray(node.inputs)) {
      for (const input of node.inputs) {
        if (input.link !== undefined && input.link !== null) {
          const link = linksMap.get(input.link);
          if (link) {
            const fromNodeId = String(link[1]);
            const fromSlot = link[2];
            apiWorkflow[nodeId].inputs[input.name || input.type] = [fromNodeId, fromSlot];
          }
        }
      }
    }
  }

  return apiWorkflow;
}

/**
 * Load a user's ComfyUI workflow JSON and inject dynamic LTX-Video values.
 * Smart injection: fuzzy-matches LTXV-related nodes and force-injects params.
 */
export function loadAndInjectLtxWorkflow(
  workflowPath: string,
  motionPrompt: string,
  uploadedImageFilename: string,
  negativePrompt: string,
  seed?: number,
  ltxSteps?: number,
  ltxCfg?: number,
  ltxFrames?: number,
  ltxFps?: number,
  onLog?: (msg: string) => void,
): Record<string, any> {
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`LTX workflow file not found: ${workflowPath}`);
  }

  let workflow: any = JSON.parse(fs.readFileSync(workflowPath, "utf-8"));

  // If GUI format, convert to API format
  if (workflow.nodes && Array.isArray(workflow.nodes)) {
    if (onLog) onLog(`[LTX I2V] Converting GUI workflow to API format...`);
    workflow = convertGuiWorkflowToApi(workflow);
  }

  // Log all node class_types found
  const nodeTypes: string[] = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    const ct = (node as any).classType || (node as any).class_type || "unknown";
    nodeTypes.push(`${nodeId}=${ct}`);
  }
  if (onLog) onLog(`[LTX I2V] Found nodes: ${nodeTypes.join(", ")}`);

  const usedSeed = seed ?? Math.floor(Math.random() * 2147483647);
  const usedSteps = ltxSteps ?? 20;
  const usedCfg = ltxCfg ?? 4.0;
  const usedFrames = ltxFrames ?? 97;
  const usedFps = ltxFps ?? 24;

  let injectedSeed = false;
  let injectedSteps = false;
  let injectedFrames = false;
  let injectedFps = false;
  let injectedImage = false;
  let injectedPrompt = false;

  for (const [nodeId, nodeRaw] of Object.entries(workflow)) {
    const node = nodeRaw as any;
    const ct = (node.classType || node.class_type || "").toString();
    const ctLower = ct.toLowerCase();
    const inputs = node.inputs || {};

    // 1. LoadImage / LoadImageMask → inject image filename
    if (ct === "LoadImage" || ct === "LoadImageMask") {
      inputs.image = uploadedImageFilename;
      injectedImage = true;
      if (onLog) onLog(`[LTX I2V] Injected image into ${ct} node ${nodeId}`);
    }

    // 2. LTXVConditioning (exact or fuzzy) → inject prompt, negative_prompt, frame_rate
    if (ct === "LTXVConditioning" || (ctLower.includes("ltxv") && ctLower.includes("conditioning"))) {
      if (inputs.prompt !== undefined) inputs.prompt = motionPrompt;
      if (inputs.negative_prompt !== undefined) inputs.negative_prompt = negativePrompt;
      if (inputs.frame_rate !== undefined) { inputs.frame_rate = usedFps; injectedFps = true; }
      injectedPrompt = true;
      if (onLog) onLog(`[LTX I2V] Injected conditioning into ${ct} node ${nodeId}`);
    }

    // 3. CLIPTextEncode → inject text prompt
    if (ct === "CLIPTextEncode" || ct === "CLIPTextEncodeSDXL") {
      if (inputs.text !== undefined && !injectedPrompt) {
        inputs.text = motionPrompt;
        injectedPrompt = true;
        if (onLog) onLog(`[LTX I2V] Injected prompt into ${ct} node ${nodeId}`);
      }
    }

    // 4. LTXVImageToVideo (exact OR fuzzy) → FORCE inject seed, steps, cfg, num_frames, frame_rate
    const isLtxI2v = ct === "LTXVImageToVideo" ||
      (ctLower.includes("ltx") && (ctLower.includes("imagetovideo") || ctLower.includes("i2v")));
    if (isLtxI2v) {
      inputs.seed = usedSeed; injectedSeed = true;
      inputs.steps = usedSteps; injectedSteps = true;
      inputs.cfg = usedCfg;
      inputs.num_frames = usedFrames; injectedFrames = true;
      inputs.frame_rate = usedFps; injectedFps = true;
      if (onLog) onLog(`[LTX I2V] Fuzzy-matched node ${nodeId} (${ct}) as LTXV video node → Steps: ${usedSteps}, Frames: ${usedFrames}, FPS: ${usedFps}, CFG: ${usedCfg}, Seed: ${usedSeed}`);
    }

    // 5. KSampler / KSamplerAdvanced → inject seed, steps, cfg
    if (ct === "KSampler" || ct === "KSamplerAdvanced") {
      if (!injectedSeed) { inputs.seed = usedSeed; inputs.noise_seed = usedSeed; injectedSeed = true; }
      if (!injectedSteps) { inputs.steps = usedSteps; injectedSteps = true; }
      if (inputs.cfg !== undefined) inputs.cfg = usedCfg;
      if (onLog) onLog(`[LTX I2V] Injected sampler params into ${ct} node ${nodeId}`);
    }

    // 6. For ANY node: scan for specific input names and inject if not yet done
    if (!injectedSeed && (inputs.seed !== undefined || inputs.noise_seed !== undefined)) {
      if (inputs.seed !== undefined) inputs.seed = usedSeed;
      if (inputs.noise_seed !== undefined) inputs.noise_seed = usedSeed;
      injectedSeed = true;
      if (onLog) onLog(`[LTX I2V] Injected seed into node ${nodeId} (${ct}) via input name scan`);
    }
    if (!injectedSteps && inputs.steps !== undefined) {
      inputs.steps = usedSteps; injectedSteps = true;
      if (onLog) onLog(`[LTX I2V] Injected steps into node ${nodeId} (${ct}) via input name scan`);
    }
    if (!injectedFrames && inputs.num_frames !== undefined) {
      inputs.num_frames = usedFrames; injectedFrames = true;
      if (onLog) onLog(`[LTX I2V] Injected num_frames into node ${nodeId} (${ct}) via input name scan`);
    }
    if (!injectedFps && inputs.frame_rate !== undefined) {
      inputs.frame_rate = usedFps; injectedFps = true;
      if (onLog) onLog(`[LTX I2V] Injected frame_rate into node ${nodeId} (${ct}) via input name scan`);
    }
  }

  if (onLog) onLog(`[LTX I2V] Injection summary: Image=${injectedImage}, Prompt=${injectedPrompt}, Seed=${injectedSeed}, Steps=${injectedSteps}, Frames=${injectedFrames}, FPS=${injectedFps}`);

  return workflow;
}

/**
 * Build a built-in LTX-Video I2V workflow as fallback.
 */
export function buildLtxI2VWorkflow(
  config: ComfyUIConfig,
  motionPrompt: string,
  inputImageFilename: string,
  seed?: number,
  ltxSteps?: number,
  ltxCfg?: number,
  ltxFrames?: number,
  ltxFps?: number,
): Record<string, any> {
  const usedSeed = seed ?? Math.floor(Math.random() * 2147483647);
  const usedSteps = ltxSteps ?? 20;
  const usedCfg = ltxCfg ?? 4.0;
  const usedFrames = ltxFrames ?? 97;
  const usedFps = ltxFps ?? 24;

  return {
    "1": {
      classType: "UNETLoader",
      inputs: {
        unet_name: config.wanCheckpoint || "ltx-video-2b-v0.9.safetensors",
        weight_dtype: "fp8_e4m3fn",
      },
    },
    "2": {
      classType: "CLIPVisionLoader",
      inputs: {
        clip_name: "siglip-so400m-patch14-384.safetensors",
      },
    },
    "3": {
      classType: "VAELoader",
      inputs: {
        vae_name: "ltx_vae.safetensors",
      },
    },
    "10": {
      classType: "LoadImage",
      inputs: {
        image: inputImageFilename,
      },
    },
    "11": {
      classType: "CLIPVisionEncode",
      inputs: {
        clip_vision: ["2", 0],
        image: ["10", 0],
      },
    },
    "12": {
      classType: "LTXVConditioning",
      inputs: {
        prompt: motionPrompt,
        negative_prompt: "low quality, blurry, static, no motion, distorted",
        frame_rate: usedFps,
      },
    },
    "14": {
      classType: "LTXVImageToVideo",
      inputs: {
        model: ["1", 0],
        conditioning: ["12", 0],
        latent_input: ["3", 0],
        image: ["10", 0],
        clip_vision: ["11", 0],
        steps: usedSteps,
        cfg: usedCfg,
        seed: usedSeed,
        num_frames: usedFrames,
        frame_rate: usedFps,
      },
    },
    "15": {
      classType: "VAEDecode",
      inputs: {
        samples: ["14", 0],
        vae: ["3", 0],
      },
    },
    "16": {
      classType: "SaveImage",
      inputs: {
        filename_prefix: "kiwul/ltx_video",
        images: ["15", 0],
      },
    },
  };
}

/**
 * Full LTX-Video I2V generation pipeline.
 */
export async function generateLtxVideo(
  config: ComfyUIConfig,
  motionPrompt: string,
  inputImageBase64: string,
  outputDir: string,
  sceneNumber: number,
  onLog?: (msg: string) => void,
  seed?: number,
  ltxSteps?: number,
  ltxCfg?: number,
  ltxFrames?: number,
  ltxFps?: number,
  ltxWorkflowPath?: string,
): Promise<{ videoPath: string | null; dataUrl: string | null }> {
  const { comfyUrl } = config;

  if (onLog) onLog(`[LTX I2V] Starting LTX-Video Image-to-Video pipeline...`);

  // 1. Upload image to ComfyUI
  const uploadedFilename = await uploadImage(comfyUrl, inputImageBase64, `kiwul_ltx_input_${Date.now()}.png`);
  if (onLog) onLog(`[LTX I2V] Input image uploaded as: ${uploadedFilename}`);

  // 2. Build or load workflow
  let workflow: Record<string, any>;
  const workflowPath = ltxWorkflowPath || "";
  if (workflowPath && fs.existsSync(workflowPath)) {
    if (onLog) onLog(`[LTX I2V] Loading custom workflow from: ${workflowPath}`);
    workflow = loadAndInjectLtxWorkflow(
      workflowPath,
      motionPrompt,
      uploadedFilename,
      config.comfyNegativePrompt || "",
      seed,
      ltxSteps,
      ltxCfg,
      ltxFrames,
      ltxFps,
      onLog,
    );
  } else {
    if (onLog) onLog(`[LTX I2V] Using built-in LTX-Video I2V workflow`);
    workflow = buildLtxI2VWorkflow(config, motionPrompt, uploadedFilename, seed, ltxSteps, ltxCfg, ltxFrames, ltxFps);
  }

  // 3. Queue prompt
  if (onLog) onLog(`[LTX I2V] Queueing prompt to ${comfyUrl}...`);
  const result = await queuePrompt(comfyUrl, workflow);
  if (onLog) onLog(`[LTX I2V] Prompt queued (ID: ${result.promptId}). Video generation may take several minutes...`);

  // 4. Poll for result (10 min timeout)
  const historyEntry = await pollForResult(comfyUrl, result.promptId, onLog, 600000);

  // 5. Extract output
  const outputImages = extractOutputImages(historyEntry);
  if (outputImages.length === 0) {
    if (onLog) onLog(`[LTX I2V] No output video/images found.`);
    return { videoPath: null, dataUrl: null };
  }

  if (onLog) onLog(`[LTX I2V] Found ${outputImages.length} output(s). Fetching...`);

  // 6. Save video to disk
  const sceneDir = path.join(outputDir, `scene_${sceneNumber}`);
  if (!fs.existsSync(sceneDir)) fs.mkdirSync(sceneDir, { recursive: true });

  const videoOutputInfo = outputImages[0];
  let videoPath: string | null = null;
  let dataUrl: string | null = null;

  try {
    const ext = videoOutputInfo.filename.split(".").pop()?.toLowerCase() || "mp4";
    videoPath = await fetchAndSaveImage(comfyUrl, videoOutputInfo, sceneDir, `video.${ext}`);
    if (onLog) onLog(`[LTX I2V] Video saved to: ${videoPath}`);
  } catch (err: any) {
    if (onLog) onLog(`[LTX I2V] Warning: Could not save video to disk: ${err.message}`);
  }

  // 7. Also fetch as base64 for preview
  try {
    dataUrl = await fetchImageAsBase64(comfyUrl, videoOutputInfo);
    if (onLog) onLog(`[LTX I2V] Video fetched as base64 for preview`);
  } catch (err: any) {
    if (onLog) onLog(`[LTX I2V] Warning: Could not fetch video as base64: ${err.message}`);
  }

  return { videoPath, dataUrl };
}
