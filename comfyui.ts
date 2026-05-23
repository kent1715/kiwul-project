/**
 * ComfyUI Integration Module for Project Kiwul
 *
 * Properly integrates with ComfyUI's API:
 * 1. Queue prompts with correct workflow JSON
 * 2. Poll /history/{prompt_id} for completion
 * 3. Fetch generated images/videos from /view endpoint
 * 4. Build proper FLUX Dev / SDXL / WAN 2.2 workflows
 */

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

// ─── ComfyUI Client ─────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 300000; // 5 minutes max per prompt
const FETCH_TIMEOUT_MS = 30000; // 30 seconds for image fetch

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
    const errorMessage =
      parsed?.error?.message ||
      parsed?.node_errors ||
      errText ||
      `ComfyUI returned status ${response.status}`;

    throw new Error(
      `ComfyUI prompt queue failed: ${typeof errorMessage === "string" ? errorMessage : JSON.stringify(errorMessage)}`
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
 * Poll ComfyUI /history/{promptId} until the prompt completes or times out
 */
export async function pollForResult(
  comfyUrl: string,
  promptId: string,
  onLog?: (msg: string) => void,
  timeoutMs: number = POLL_TIMEOUT_MS
): Promise<ComfyUIHistoryEntry> {
  const startTime = Date.now();

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

          // Still running - log progress
          if (onLog) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            onLog(`[COMFYUI] Still generating... (${elapsed}s elapsed)`);
          }
        }
      }
    } catch (err: any) {
      // Network error during polling - retry
      if (onLog) {
        onLog(`[COMFYUI] Poll retry: ${err.message}`);
      }
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `ComfyUI generation timed out after ${Math.round(timeoutMs / 1000)}s for prompt ${promptId}`
  );
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
 * Full generation pipeline: queue → poll → fetch image
 */
export async function generateImage(
  config: ComfyUIConfig,
  prompt: string,
  onLog?: (msg: string) => void,
  seed?: number
): Promise<string | null> {
  const { comfyUrl } = config;

  if (onLog) onLog(`[COMFYUI] Building workflow for: "${prompt.substring(0, 80)}..."`);

  // Build the workflow
  const workflow = buildFluxWorkflow(config, prompt, seed);

  if (onLog) onLog(`[COMFYUI] Queueing prompt to ${comfyUrl}...`);

  // Queue the prompt
  const result = await queuePrompt(comfyUrl, workflow);

  if (result.nodeErrors && Object.keys(result.nodeErrors).length > 0) {
    if (onLog) onLog(`[COMFYUI] Node validation warnings: ${JSON.stringify(result.nodeErrors)}`);
  }

  if (onLog) onLog(`[COMFYUI] Prompt queued (ID: ${result.promptId}). Waiting for generation...`);

  // Poll for completion
  const historyEntry = await pollForResult(comfyUrl, result.promptId, onLog);

  // Extract and fetch images
  const outputImages = extractOutputImages(historyEntry);

  if (outputImages.length === 0) {
    if (onLog) onLog(`[COMFYUI] No output images found in history entry. Outputs: ${JSON.stringify(historyEntry.outputs)}`);
    return null;
  }

  if (onLog) onLog(`[COMFYUI] Found ${outputImages.length} output image(s). Fetching first one...`);

  // Fetch the first image
  const imageDataUrl = await fetchImageAsBase64(comfyUrl, outputImages[0]);

  if (onLog) onLog(`[COMFYUI] Image fetched successfully (${(imageDataUrl.length / 1024).toFixed(0)} KB base64)`);

  return imageDataUrl;
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

// ─── Workflow Builders ───────────────────────────────────────────────────────

/**
 * Build a proper FLUX Dev / SDXL workflow for image generation
 *
 * Node graph:
 *   4: CheckpointLoaderSimple → loads model, clip, vae
 *   6: CLIPTextEncode (positive) → uses clip from node 4
 *   7: CLIPTextEncode (negative) → uses clip from node 4
 *   5: EmptyLatentImage → creates empty latent
 *   3: KSampler → samples the model
 *   8: VAEDecode → decodes latent to image
 *   9: SaveImage → saves the final image
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

  return {
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
        text: config.comfyNegativePrompt || "low quality, blurry, watermark, text overlay, deformed, ugly, bad anatomy",
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
        steps: 20,
        cfg: 3.5, // FLUX typically uses lower CFG (1-4)
        sampler_name: "euler",
        scheduler: "normal",
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
}

/**
 * Build a WAN 2.2 Image-to-Video workflow
 *
 * This workflow assumes the user has WAN 2.2 custom nodes installed in ComfyUI.
 * Node graph:
 *   1: CheckpointLoaderSimple → loads WAN model
 *   10: LoadImage → loads the input image
 *   11: CLIPVisionEncode → encodes image for I2V
 *   12: CLIPTextEncode (positive) → motion prompt
 *   13: CLIPTextEncode (negative) → negative prompt
 *   14: WanImageToVideo → I2V generation
 *   15: VAEDecode → decode video latent
 *   16: SaveImage → save output frames
 *
 * NOTE: This uses the common ComfyUI-WanVideo Wrapper node names.
 * If the user has a different WAN 2.2 node pack, they may need to adjust
 * the class_type values via the settings UI.
 */
export function buildWanI2VWorkflow(
  config: ComfyUIConfig,
  motionPrompt: string,
  inputImageFilename: string,
  seed?: number
): Record<string, any> {
  const isVertical = config.wanResolution === "9:16";
  const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);

  // WAN 2.2 workflow using popular custom node names
  // Users may need to install: ComfyUI-WanVideo or similar
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
 * Falls back gracefully if the primary workflow fails.
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
