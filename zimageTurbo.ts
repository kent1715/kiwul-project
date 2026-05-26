/**
 * Z-Image Turbo API Integration
 *
 * Standalone image generation service (e.g. SDXL Lightning / FLUX Turbo on :9000).
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
 * Ping the Z-Image Turbo API to verify it's reachable.
 * Tries /docs, /openapi.json, and / as fallbacks.
 */
export async function checkZImageTurboConnection(
  baseUrl?: string
): Promise<{ ok: boolean; status?: number; message: string; detail?: string }> {
  const url = baseUrl || "http://127.0.0.1:9000";

  // Try root endpoint first
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        message: "Z-Image Turbo API terhubung",
      };
    }

    // Root didn't return OK — try /docs (common for FastAPI)
    try {
      const docsResponse = await fetch(`${url}/docs`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (docsResponse.ok) {
        return {
          ok: true,
          status: docsResponse.status,
          message: "Z-Image Turbo API terhubung (docs accessible)",
        };
      }
    } catch {}

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

// ── Image Generation ──────────────────────────────────────────────────────────

/**
 * Generate an image using the Z-Image Turbo API.
 *
 * Supports 3 possible response formats from the API:
 * 1. Direct binary image (Content-Type: image/*)
 * 2. JSON with base64: { image: "base64..." } or { images: ["base64..."] }
 * 3. JSON with URL: { url: "/outputs/image.png" }
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

  const payload = {
    prompt,
    negative_prompt: negativePrompt,
    width: settings.imageWidth || 1024,
    height: settings.imageHeight || 1024,
    steps: settings.imageSteps || 8,
    seed,
  };

  console.log(`[Z-IMAGE TURBO] Sending request to ${baseUrl}/generate...`);
  console.log(`[Z-IMAGE TURBO] Payload: width=${payload.width}, height=${payload.height}, steps=${payload.steps}, seed=${payload.seed}`);

  const response = await fetch(`${baseUrl}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180_000), // 3 minutes timeout
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Z-Image Turbo API gagal: HTTP ${response.status} - ${text.slice(0, 500)}`
    );
  }

  const contentType = response.headers.get("content-type") || "";

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, filename);

  // ── Format 1: Direct binary image response ────────────────────────────────
  if (contentType.includes("image/")) {
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(outputPath, buffer);

    // Build data URL for UI display
    const base64 = buffer.toString("base64");
    const ext = path.extname(filename).replace(".", "") || "png";
    const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    const dataUrl = `data:${mimeType};base64,${base64}`;

    console.log(`[Z-IMAGE TURBO] Image saved (binary): ${outputPath} (${buffer.length} bytes)`);
    return { dataUrl, filePath: outputPath };
  }

  // ── Format 2/3: JSON response ─────────────────────────────────────────────
  const data = await response.json();

  // Format 2a: { image: "base64..." }
  if (data.image) {
    const base64 = String(data.image).replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64, "base64");
    fs.writeFileSync(outputPath, buffer);

    const dataUrl = `data:image/png;base64,${base64}`;
    console.log(`[Z-IMAGE TURBO] Image saved (base64 single): ${outputPath} (${buffer.length} bytes)`);
    return { dataUrl, filePath: outputPath };
  }

  // Format 2b: { images: ["base64..."] }
  if (Array.isArray(data.images) && data.images[0]) {
    const base64 = String(data.images[0]).replace(
      /^data:image\/\w+;base64,/,
      ""
    );
    const buffer = Buffer.from(base64, "base64");
    fs.writeFileSync(outputPath, buffer);

    const dataUrl = `data:image/png;base64,${base64}`;
    console.log(`[Z-IMAGE TURBO] Image saved (base64 array): ${outputPath} (${buffer.length} bytes)`);
    return { dataUrl, filePath: outputPath };
  }

  // Format 3: { url: "/outputs/image.png" } or { url: "http://..." }
  if (data.url) {
    const imageUrl = String(data.url).startsWith("http")
      ? data.url
      : `${baseUrl}${data.url}`;

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
    console.log(`[Z-IMAGE TURBO] Image saved (URL download): ${outputPath} (${buffer.length} bytes)`);
    return { dataUrl, filePath: outputPath };
  }

  throw new Error(
    `Format response Z-Image Turbo tidak dikenali: ${JSON.stringify(data).slice(0, 500)}`
  );
}
