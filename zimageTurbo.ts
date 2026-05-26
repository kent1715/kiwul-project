/**
 * Z-Image Turbo API Integration (Gradio API)
 *
 * Standalone image generation service running on Gradio (e.g. :9000).
 * Uses Gradio's call/poll pattern:
 *   1. POST /gradio_api/call/run_and_return  → get event_id
 *   2. GET  /gradio_api/call/run_and_return/{event_id}  → poll for result
 *
 * This file is independent from ComfyUI — no comfyui.ts imports.
 */

import fs from "fs";
import path from "path";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ZImageTurboSettings = {
  zImageTurboUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageSteps?: number;
  imageCfg?: number;
  zImageVaePath?: string;
  zImageLlmPath?: string;
  zImageLoras?: string;
  zImageLoraStrength?: number;
};

export type GenerateZImageParams = {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  outputDir: string;
  filename?: string;
  settings: ZImageTurboSettings;
};

// ── Health Check ──────────────────────────────────────────────────────────────

/**
 * Ping the Z-Image Turbo Gradio API to verify it's reachable.
 * Checks /config for the run_and_return endpoint.
 */
export async function checkZImageTurboConnection(
  baseUrl?: string
): Promise<{ ok: boolean; status?: number; message: string; detail?: string; endpointDetected?: boolean }> {
  const url = baseUrl || "http://127.0.0.1:9000";

  // Try /config endpoint first (Gradio standard)
  try {
    const configResponse = await fetch(`${url}/config`, {
      method: "GET",
      signal: AbortSignal.timeout(8000),
    });

    if (configResponse.ok) {
      const config = await configResponse.json();

      // Check for run_and_return in the config
      let endpointDetected = false;
      try {
        // Gradio /config has a "dependencies" array with "api_name" fields
        const deps = config.dependencies || config.api || [];
        if (Array.isArray(deps)) {
          endpointDetected = deps.some((d: any) =>
            d.api_name === "run_and_return" ||
            d.api_name === "/run_and_return" ||
            d.name === "run_and_return"
          );
        }
        // Also check if it's in the root keys
        if (!endpointDetected && config.run_and_return) {
          endpointDetected = true;
        }
      } catch {}

      if (endpointDetected) {
        return {
          ok: true,
          status: configResponse.status,
          message: "Z-Image Turbo connected.\nEndpoint: run_and_return detected.",
          endpointDetected: true,
        };
      }

      // Config reachable but no run_and_return found
      return {
        ok: true,
        status: configResponse.status,
        message: "Z-Image Turbo API terhubung, tapi endpoint run_and_return tidak ditemukan di /config.",
        endpointDetected: false,
      };
    }
  } catch (error: any) {
    // /config failed, try root as fallback
  }

  // Fallback: try root endpoint
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        message: "Z-Image Turbo API terhubung (root accessible, /config not checked)",
        endpointDetected: false,
      };
    }

    return {
      ok: false,
      status: response.status,
      message: "Z-Image Turbo merespons tapi status tidak OK",
    };
  } catch (error: any) {
    return {
      ok: false,
      message: "Gagal terhubung ke Z-Image Turbo API",
      detail: error?.message || String(error),
    };
  }
}

// ── Gradio API Call + Poll ────────────────────────────────────────────────────

/**
 * Call Gradio API using the two-step call/poll pattern.
 * Step 1: POST to submit the job → get event_id
 * Step 2: GET to poll for the result → get output
 */
async function callGradioAPI(
  baseUrl: string,
  data: any[],
  timeoutMs: number = 300_000
): Promise<any> {
  const submitUrl = `${baseUrl}/gradio_api/call/run_and_return`;

  // Step 1: Submit the job
  console.log(`[Z-IMAGE TURBO] Submitting job to ${submitUrl}...`);
  const submitResponse = await fetch(submitUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(30_000), // 30s for submission
  });

  if (!submitResponse.ok) {
    const text = await submitResponse.text();
    throw new Error(
      `Z-Image Turbo submit gagal: HTTP ${submitResponse.status} - ${text.slice(0, 500)}`
    );
  }

  // Parse the submission response to get event_id
  const submitResult = await submitResponse.json();
  const eventId = submitResult.event_id;

  if (!eventId) {
    // Some Gradio versions return event_id in the response directly
    // Try alternate parsing
    const altEventId = submitResult.eventId || submitResult.id;
    if (!altEventId) {
      throw new Error(
        `Z-Image Turbo tidak mengembalikan event_id. Response: ${JSON.stringify(submitResult).slice(0, 500)}`
      );
    }
  }

  const finalEventId = eventId || submitResult.eventId || submitResult.id;
  console.log(`[Z-IMAGE TURBO] Job submitted, event_id: ${finalEventId}`);

  // Step 2: Poll for the result
  const pollUrl = `${baseUrl}/gradio_api/call/run_and_return/${finalEventId}`;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const pollResponse = await fetch(pollUrl, {
      method: "GET",
      signal: AbortSignal.timeout(60_000), // 60s per poll request
    });

    if (!pollResponse.ok) {
      throw new Error(
        `Z-Image Turbo poll gagal: HTTP ${pollResponse.status}`
      );
    }

    const contentType = pollResponse.headers.get("content-type") || "";
    const pollText = await pollResponse.text();

    // Gradio SSE format: lines like "event: complete\ndata: [...]"
    // or direct JSON response
    const lines = pollText.split("\n").filter((l: string) => l.trim());

    let eventType = "";
    let eventData = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.replace("event:", "").trim();
      } else if (line.startsWith("data:")) {
        eventData = line.replace("data:", "").trim();
      }
    }

    // Check event type
    if (eventType === "complete" || eventType === "success") {
      // Job completed — parse the result data
      try {
        const resultData = JSON.parse(eventData);
        console.log(`[Z-IMAGE TURBO] Job completed, result received`);
        return resultData;
      } catch {
        // If can't parse JSON, return raw data
        console.log(`[Z-IMAGE TURBO] Job completed, raw result: ${eventData.slice(0, 200)}`);
        return eventData;
      }
    }

    if (eventType === "error") {
      throw new Error(
        `Z-Image Turbo job error: ${eventData.slice(0, 500)}`
      );
    }

    if (eventType === "heartbeat" || eventType === "generating") {
      // Still processing — wait and poll again
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[Z-IMAGE TURBO] Still processing... (${elapsed}s elapsed)`);
      await new Promise((resolve) => setTimeout(resolve, 3000)); // 3s between polls
      continue;
    }

    // If no SSE format detected, try parsing as direct JSON
    if (!eventType && pollText.trim()) {
      try {
        const directResult = JSON.parse(pollText);
        // Could be immediate result
        return directResult;
      } catch {
        // Not JSON — might still be processing
      }
    }

    // Wait and poll again
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error(
    `Z-Image Turbo timeout setelah ${Math.round(timeoutMs / 1000)} detik menunggu hasil`
  );
}

// ── Image Generation ──────────────────────────────────────────────────────────

/**
 * Generate an image using the Z-Image Turbo Gradio API.
 *
 * Uses Gradio's call/poll pattern:
 *   1. POST /gradio_api/call/run_and_return with data array
 *   2. GET /gradio_api/call/run_and_return/{event_id} to poll
 *
 * Input data array: [prompt, width, height, steps, seed, cfg, vaePath, llmPath, loras, loraStrength]
 *
 * Response formats handled:
 * 1. Gradio file object: { path: "/tmp/xxx/image.png", url: "/file=...", ... }
 * 2. Direct URL string
 * 3. Base64 string
 *
 * Always saves the image to disk and returns the file path.
 */
export async function generateImageWithZImageTurbo({
  prompt,
  negativePrompt = "",
  seed = -1,
  outputDir,
  filename = `zimage_${Date.now()}.png`,
  settings,
}: GenerateZImageParams): Promise<{ dataUrl: string | null; filePath: string | null }> {
  const baseUrl = settings.zImageTurboUrl || "http://127.0.0.1:9000";

  // Build the Gradio data array
  // [prompt, width, height, steps, seed, cfg, vaePath, llmPath, loras, loraStrength]
  const data = [
    prompt,                                           // 0: prompt
    settings.imageWidth || 512,                       // 1: width
    settings.imageHeight || 896,                      // 2: height
    settings.imageSteps || 8,                         // 3: steps
    seed,                                             // 4: seed
    settings.imageCfg || 1.0,                         // 5: cfg
    settings.zImageVaePath || "",                     // 6: vaePath
    settings.zImageLlmPath || "",                     // 7: llmPath
    settings.zImageLoras || "",                       // 8: loras (JSON string or empty)
    settings.zImageLoraStrength ?? 1.0,               // 9: loraStrength
  ];

  console.log(`[Z-IMAGE TURBO] Sending request to ${baseUrl}/gradio_api/call/run_and_return...`);
  console.log(`[Z-IMAGE TURBO] Params: width=${data[1]}, height=${data[2]}, steps=${data[3]}, seed=${data[4]}, cfg=${data[5]}`);

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, filename);

  // Call the Gradio API
  const result = await callGradioAPI(baseUrl, data);

  // ── Parse the Gradio result ─────────────────────────────────────────────

  // Gradio typically returns an array of outputs
  // The first element should be the image result
  let imageOutput: any = null;

  if (Array.isArray(result)) {
    // Result is an array — take the first element
    imageOutput = result[0];
  } else if (result && typeof result === "object") {
    // Result is a single object
    imageOutput = result;
  } else if (typeof result === "string") {
    // Result is a string (could be URL or base64)
    imageOutput = result;
  }

  if (!imageOutput) {
    throw new Error(
      `Z-Image Turbo mengembalikan hasil kosong. Raw: ${JSON.stringify(result).slice(0, 500)}`
    );
  }

  // ── Format 1: Gradio file object { path, url, orig_name, ... } ────────
  if (typeof imageOutput === "object" && imageOutput.url) {
    const imageUrl = String(imageOutput.url).startsWith("http")
      ? imageOutput.url
      : `${baseUrl}${imageOutput.url.startsWith("/") ? "" : "/"}${imageOutput.url}`;

    console.log(`[Z-IMAGE TURBO] Downloading image from: ${imageUrl}`);

    const imgResponse = await fetch(imageUrl, {
      signal: AbortSignal.timeout(60_000),
    });

    if (!imgResponse.ok) {
      throw new Error(
        `Gagal download hasil Z-Image Turbo dari URL: ${imgResponse.status}`
      );
    }

    const arrayBuffer = await imgResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(outputPath, buffer);

    const base64 = buffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64}`;
    console.log(`[Z-IMAGE TURBO] Image saved (Gradio file): ${outputPath} (${buffer.length} bytes)`);
    return { dataUrl, filePath: outputPath };
  }

  // ── Format 2: Gradio file object with path only (local server path) ───
  if (typeof imageOutput === "object" && imageOutput.path) {
    // Try to construct URL from path
    // Gradio serves files at /file=<path>
    const filePath = String(imageOutput.path);
    const fileUrl = `${baseUrl}/file=${encodeURIComponent(filePath)}`;

    console.log(`[Z-IMAGE TURBO] Downloading image from file path: ${fileUrl}`);

    try {
      const imgResponse = await fetch(fileUrl, {
        signal: AbortSignal.timeout(60_000),
      });

      if (imgResponse.ok) {
        const arrayBuffer = await imgResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(outputPath, buffer);

        const base64 = buffer.toString("base64");
        const dataUrl = `data:image/png;base64,${base64}`;
        console.log(`[Z-IMAGE TURBO] Image saved (file path): ${outputPath} (${buffer.length} bytes)`);
        return { dataUrl, filePath: outputPath };
      }
    } catch {
      // File URL failed, try alternative
    }

    // If path looks like a local file system path and it exists
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      fs.writeFileSync(outputPath, buffer);

      const base64 = buffer.toString("base64");
      const dataUrl = `data:image/png;base64,${base64}`;
      console.log(`[Z-IMAGE TURBO] Image copied from local path: ${filePath} → ${outputPath} (${buffer.length} bytes)`);
      return { dataUrl, filePath: outputPath };
    }
  }

  // ── Format 3: Base64 string ────────────────────────────────────────────
  if (typeof imageOutput === "string") {
    // Check if it's a base64 data URL
    if (imageOutput.startsWith("data:image/")) {
      const base64 = imageOutput.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64, "base64");
      fs.writeFileSync(outputPath, buffer);

      const dataUrl = `data:image/png;base64,${base64}`;
      console.log(`[Z-IMAGE TURBO] Image saved (data URL): ${outputPath} (${buffer.length} bytes)`);
      return { dataUrl, filePath: outputPath };
    }

    // Check if it's a plain base64 string (long string without URL patterns)
    if (imageOutput.length > 200 && !imageOutput.startsWith("http") && !imageOutput.startsWith("/")) {
      try {
        const buffer = Buffer.from(imageOutput, "base64");
        if (buffer.length > 1000 && buffer[0] === 0x89) {
          // PNG magic number
          fs.writeFileSync(outputPath, buffer);

          const dataUrl = `data:image/png;base64,${imageOutput}`;
          console.log(`[Z-IMAGE TURBO] Image saved (raw base64): ${outputPath} (${buffer.length} bytes)`);
          return { dataUrl, filePath: outputPath };
        }
      } catch {}
    }

    // Check if it's a URL
    if (imageOutput.startsWith("http") || imageOutput.startsWith("/")) {
      const imageUrl = imageOutput.startsWith("http")
        ? imageOutput
        : `${baseUrl}${imageOutput}`;

      console.log(`[Z-IMAGE TURBO] Downloading image from URL: ${imageUrl}`);

      const imgResponse = await fetch(imageUrl, {
        signal: AbortSignal.timeout(60_000),
      });

      if (imgResponse.ok) {
        const arrayBuffer = await imgResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(outputPath, buffer);

        const base64 = buffer.toString("base64");
        const dataUrl = `data:image/png;base64,${base64}`;
        console.log(`[Z-IMAGE TURBO] Image saved (URL download): ${outputPath} (${buffer.length} bytes)`);
        return { dataUrl, filePath: outputPath };
      }

      throw new Error(
        `Gagal download hasil Z-Image Turbo dari URL: ${imgResponse.status}`
      );
    }
  }

  // ── Format 4: Image object with image field ────────────────────────────
  if (typeof imageOutput === "object" && imageOutput.image) {
    const imageData = imageOutput.image;
    if (typeof imageData === "string") {
      const base64 = imageData.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64, "base64");
      fs.writeFileSync(outputPath, buffer);

      const dataUrl = `data:image/png;base64,${base64}`;
      console.log(`[Z-IMAGE TURBO] Image saved (image field): ${outputPath} (${buffer.length} bytes)`);
      return { dataUrl, filePath: outputPath };
    }
  }

  // ── Format 5: Nested array with file object ────────────────────────────
  if (Array.isArray(result)) {
    for (const item of result) {
      if (typeof item === "object" && (item.url || item.path)) {
        // Recursively handle this item
        const nestedResult = await generateImageWithZImageTurbo({
          prompt,
          negativePrompt,
          seed,
          outputDir,
          filename,
          settings,
        });
        return nestedResult;
      }
    }
  }

  throw new Error(
    `Format response Z-Image Turbo tidak dikenali: ${JSON.stringify(imageOutput).slice(0, 800)}`
  );
}
