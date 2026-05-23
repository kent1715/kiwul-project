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
  comfyCheckpoint: string;
  comfyNegativePrompt: string;
  workflowTemplate: string;
  wanMode: "i2v" | "t2v";
  wanResolution: "16:9" | "9:16";
  wanSteps: number;
  wanCfg: number;
  wanFrames: number;
  wanMotionIntensity: number;
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
 * Determine the model format and build the best workflow accordingly.
 * This auto-detects whether the checkpoint is a full checkpoint (CheckpointLoaderSimple)
 * or a UNET-only model (UNETLoader), and whether FLUX-specific nodes are available.
 */
async function buildBestWorkflow(
  config: ComfyUIConfig,
  prompt: string,
  seed?: number,
  onLog?: (msg: string) => void
): Promise<Record<string, any>> {
  const { comfyUrl, workflowTemplate } = config;

  // If user explicitly chose a workflow template, use it
  // But for FLUX_Dev_Standard, we should still validate the checkpoint exists
  if (workflowTemplate === "SDXL_Standard") {
    if (onLog) onLog(`[COMFYUI] Using SDXL Standard workflow template`);
    return buildSDXLWorkflow(config, prompt, seed);
  }

  if (workflowTemplate === "FLUX_Dev_UNET") {
    if (onLog) onLog(`[COMFYUI] Using FLUX Dev UNET workflow template`);
    return buildFluxUNETWorkflow(config, prompt, seed);
  }

  if (workflowTemplate === "FLUX_Dev_Standard") {
    // Validate that the checkpoint actually exists in CheckpointLoaderSimple
    try {
      const checkpoints = await getCheckpoints(comfyUrl);
      const checkpointExists = checkpoints.some(c => c === config.comfyCheckpoint);

      if (!checkpointExists) {
        // Check if it exists as a UNET model instead
        const unetModels = await getUNETModels(comfyUrl);
        const unetExists = unetModels.some(m => m === config.comfyCheckpoint);

        if (unetExists) {
          if (onLog) onLog(`[COMFYUI] WARNING: "${config.comfyCheckpoint}" not found as checkpoint, but found as UNET model. Automatically switching to UNET workflow.`);
          return buildFluxUNETWorkflow(config, prompt, seed);
        }

        if (onLog) onLog(`[COMFYUI] WARNING: Checkpoint "${config.comfyCheckpoint}" not found! Available: [${checkpoints.slice(0, 5).join(", ")}]. Generation will likely fail.`);
      } else {
        if (onLog) onLog(`[COMFYUI] Checkpoint "${config.comfyCheckpoint}" validated. Using FLUX Dev Standard workflow.`);
      }
    } catch (err: any) {
      if (onLog) onLog(`[COMFYUI] Could not validate checkpoint: ${err.message}. Proceeding with FLUX Dev Standard workflow.`);
    }
    return buildFluxWorkflow(config, prompt, seed);
  }

  // Auto-detect: Query ComfyUI for available checkpoints and UNET models
  const isFluxCheckpoint = config.comfyCheckpoint.toLowerCase().includes("flux");
  const isSDXLCheckpoint = config.comfyCheckpoint.toLowerCase().includes("sdxl") || config.comfyCheckpoint.toLowerCase().includes("xl");

  if (isSDXLCheckpoint) {
    if (onLog) onLog(`[COMFYUI] Auto-detected SDXL model. Using SDXL workflow.`);
    return buildSDXLWorkflow(config, prompt, seed);
  }

  // For FLUX or unknown models, check if the checkpoint exists in CheckpointLoaderSimple or UNETLoader
  if (isFluxCheckpoint || workflowTemplate === "Auto_Detect") {
    try {
      // Check if the checkpoint is available via CheckpointLoaderSimple
      const checkpoints = await getCheckpoints(comfyUrl);
      const checkpointExists = checkpoints.some(c => c === config.comfyCheckpoint);

      if (checkpointExists) {
        if (onLog) onLog(`[COMFYUI] Checkpoint "${config.comfyCheckpoint}" found in CheckpointLoaderSimple. Using standard workflow.`);
        return buildFluxWorkflow(config, prompt, seed);
      }

      // Check if it's a UNET-only model
      const unetModels = await getUNETModels(comfyUrl);
      const unetExists = unetModels.some(m => m === config.comfyCheckpoint);

      if (unetExists) {
        if (onLog) onLog(`[COMFYUI] Checkpoint "${config.comfyCheckpoint}" found in UNETLoader. Using UNET workflow.`);
        return buildFluxUNETWorkflow(config, prompt, seed);
      }

      // Check if ANY flux-related UNET model exists (might have different name)
      const fluxUnetMatch = unetModels.find(m => m.toLowerCase().includes("flux"));
      if (fluxUnetMatch && isFluxCheckpoint) {
        if (onLog) onLog(`[COMFYUI] FLUX checkpoint not found as-is, but found UNET model "${fluxUnetMatch}". Using UNET workflow.`);
        // Override checkpoint name with the actual found UNET model
        const adjustedConfig = { ...config, comfyCheckpoint: fluxUnetMatch };
        return buildFluxUNETWorkflow(adjustedConfig, prompt, seed);
      }

      // Neither checkpoint nor UNET found - log warning and try standard workflow anyway
      if (onLog) onLog(`[COMFYUI] WARNING: Checkpoint "${config.comfyCheckpoint}" not found in ComfyUI! Available checkpoints: [${checkpoints.slice(0, 5).join(", ")}${checkpoints.length > 5 ? "..." : ""}]. Available UNETs: [${unetModels.slice(0, 5).join(", ")}]. Will try standard workflow - this may fail validation.`);
    } catch (err: any) {
      if (onLog) onLog(`[COMFYUI] Could not query ComfyUI for model validation: ${err.message}. Proceeding with standard workflow.`);
    }
  }

  // Default: build standard CheckpointLoaderSimple workflow
  if (onLog) onLog(`[COMFYUI] Using standard CheckpointLoaderSimple workflow`);
  return buildFluxWorkflow(config, prompt, seed);
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
        ckpt_name: config.comfyCheckpoint || "flux1-dev.safetensors",
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
  seed?: number
): Record<string, any> {
  const isVertical = config.aspectRatio === "9:16";
  const width = isVertical ? 720 : 1280;
  const height = isVertical ? 1280 : 720;

  const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);
  const steps = config.comfySteps || 20;
  const cfg = config.comfyCfg || 3.5;
  const samplerName = config.comfySampler || "euler";
  const schedulerName = config.comfyScheduler || "normal";

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
        clip_name1: "clip_l.safetensors",
        clip_name2: "t5xxl_fp16.safetensors",
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
        vae_name: "ae.safetensors", // FLUX uses a separate VAE called "ae"
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
        ckpt_name: config.comfyCheckpoint || "wan2.2_i2v_480p.safetensors",
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
        ckpt_name: config.comfyCheckpoint || "wan2.2_i2v_480p.safetensors",
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
