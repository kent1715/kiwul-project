/**
 * TTS (Text-to-Speech) Integration Module for Project Kiwul
 *
 * Supports multiple TTS engines:
 * 1. F5-TTS — Local voice cloning synthesis (default, port 5000)
 * 2. Piper — Fast local neural TTS (port 5000)
 * 3. StyleTTS2 — Expressive local TTS (port 8501)
 * 4. Gemini TTS — Cloud fallback via Google AI API
 *
 * F5-TTS API Reference:
 *   POST /synthesize
 *   Body: { text: string, ref_audio?: base64, ref_text?: string, speed?: number }
 *   Response: { audio: base64 (wav) }
 *
 *   Also supports Gradio-style API:
 *   POST /api/tts
 *   Body: { data: [text, ref_audio_path, ref_text, speed] }
 */

import fs from "fs";
import path from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TTSConfig {
  ttsEngine: "f5-tts" | "styletts2" | "piper" | "gemini-tts";
  ttsUrl: string;
  voiceProfile: string;
  voiceSpeed: number;
  voiceEmotion: string;
  /** Gemini client for cloud TTS fallback */
  geminiClient?: any;
  /** Reference audio for voice cloning (F5-TTS) — base64 data URL or file path */
  refAudio?: string;
  /** Reference text for the reference audio (F5-TTS voice cloning) */
  refText?: string;
}

export interface TTSResult {
  /** Base64 data URL of the generated audio */
  audioDataUrl: string;
  /** Duration of the audio in seconds */
  durationSeconds: number;
  /** Engine that was used */
  engine: string;
}

export type TTSLogCallback = (msg: string) => void;

export interface TTSEngineInfo {
  name: string;
  available: boolean;
  url: string;
  voices?: string[];
  error?: string;
}

// ─── F5-TTS Engine ───────────────────────────────────────────────────────────

/**
 * Synthesize speech using F5-TTS local API.
 *
 * F5-TTS typically runs as a Gradio web UI on port 5000.
 * It exposes two API styles:
 *   1. Gradio API: POST /api/tts with data array
 *   2. Simple API: POST /synthesize with JSON body
 *
 * We try the Gradio API first, then fall back to the simple API.
 */
async function synthesizeF5TTS(
  text: string,
  config: TTSConfig,
  onLog?: TTSLogCallback
): Promise<TTSResult> {
  const baseUrl = config.ttsUrl.replace(/\/$/, "");

  if (onLog) onLog(`[TTS F5] Synthesizing: "${text.substring(0, 60)}..."`);

  // Prepare the reference audio for voice cloning
  let refAudioBase64 = config.refAudio || "";

  // If refAudio is a file path, read it and convert to base64
  if (refAudioBase64 && !refAudioBase64.startsWith("data:") && fs.existsSync(refAudioBase64)) {
    const buffer = fs.readFileSync(refAudioBase64);
    refAudioBase64 = `data:audio/wav;base64,${buffer.toString("base64")}`;
    if (onLog) onLog(`[TTS F5] Loaded reference audio from: ${config.refAudio}`);
  }

  // Try Gradio-style API first (/api/tts)
  try {
    const gradioPayload: any = {
      data: [
        text,                                      // text to synthesize
        refAudioBase64 || "",                       // reference audio (base64 or path)
        config.refText || config.voiceProfile || "", // reference text
        config.voiceSpeed || 1.0,                   // speed
      ],
    };

    if (onLog) onLog(`[TTS F5] Trying Gradio API at ${baseUrl}/api/tts...`);

    const response = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gradioPayload),
      signal: AbortSignal.timeout(60000), // TTS can take a while
    });

    if (response.ok) {
      const data = await response.json();

      // Gradio API returns { data: [base64_audio_or_file_path] }
      let audioBase64 = "";

      if (data.data && Array.isArray(data.data) && data.data.length > 0) {
        const audioResult = data.data[0];

        if (typeof audioResult === "string") {
          if (audioResult.startsWith("data:")) {
            // Already a base64 data URL
            audioBase64 = audioResult;
          } else if (audioResult.startsWith("/") || audioResult.startsWith("C:")) {
            // File path — read the file
            if (fs.existsSync(audioResult)) {
              const buffer = fs.readFileSync(audioResult);
              audioBase64 = `data:audio/wav;base64,${buffer.toString("base64")}`;
            }
          } else {
            // Raw base64
            audioBase64 = `data:audio/wav;base64,${audioResult}`;
          }
        }
      }

      if (audioBase64) {
        const duration = estimateAudioDuration(audioBase64);
        if (onLog) onLog(`[TTS F5] Synthesis complete via Gradio API (${duration.toFixed(1)}s)`);
        return { audioDataUrl: audioBase64, durationSeconds: duration, engine: "f5-tts" };
      }
    }
  } catch (err: any) {
    if (onLog) onLog(`[TTS F5] Gradio API failed: ${err.message}. Trying simple API...`);
  }

  // Try simple API (/synthesize)
  try {
    const simplePayload: any = {
      text,
      speed: config.voiceSpeed || 1.0,
    };

    if (refAudioBase64) {
      simplePayload.ref_audio = refAudioBase64;
    }
    if (config.refText) {
      simplePayload.ref_text = config.refText;
    }

    if (onLog) onLog(`[TTS F5] Trying simple API at ${baseUrl}/synthesize...`);

    const response = await fetch(`${baseUrl}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(simplePayload),
      signal: AbortSignal.timeout(60000),
    });

    if (response.ok) {
      const data = await response.json();

      let audioBase64 = "";
      if (data.audio) {
        if (data.audio.startsWith("data:")) {
          audioBase64 = data.audio;
        } else {
          audioBase64 = `data:audio/wav;base64,${data.audio}`;
        }
      } else if (data.audio_base64) {
        audioBase64 = `data:audio/wav;base64,${data.audio_base64}`;
      }

      if (audioBase64) {
        const duration = estimateAudioDuration(audioBase64);
        if (onLog) onLog(`[TTS F5] Synthesis complete via simple API (${duration.toFixed(1)}s)`);
        return { audioDataUrl: audioBase64, durationSeconds: duration, engine: "f5-tts" };
      }
    }
  } catch (err: any) {
    if (onLog) onLog(`[TTS F5] Simple API also failed: ${err.message}`);
  }

  // Try direct file download approach — some F5-TTS setups serve files via /file= endpoint
  try {
    if (onLog) onLog(`[TTS F5] Trying /file= download approach...`);

    const gradioPayload = {
      data: [
        text,
        refAudioBase64 || "",
        config.refText || config.voiceProfile || "",
        config.voiceSpeed || 1.0,
      ],
    };

    const response = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gradioPayload),
      signal: AbortSignal.timeout(60000),
    });

    if (response.ok) {
      const data = await response.json();

      // Check for Gradio file reference like { path: "...", url: "/file=..." }
      if (data.data && Array.isArray(data.data)) {
        for (const item of data.data) {
          if (typeof item === "object" && item !== null) {
            const fileUrl = item.url || item.path;
            if (fileUrl) {
              const fullUrl = fileUrl.startsWith("http") ? fileUrl : `${baseUrl}${fileUrl.startsWith("/") ? "" : "/"}${fileUrl}`;
              if (onLog) onLog(`[TTS F5] Downloading audio from: ${fullUrl}`);

              const audioResponse = await fetch(fullUrl, {
                signal: AbortSignal.timeout(30000),
              });

              if (audioResponse.ok) {
                const arrayBuffer = await audioResponse.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const audioBase64 = `data:audio/wav;base64,${buffer.toString("base64")}`;
                const duration = estimateAudioDuration(audioBase64);
                if (onLog) onLog(`[TTS F5] Audio downloaded (${duration.toFixed(1)}s, ${(buffer.length / 1024).toFixed(0)} KB)`);
                return { audioDataUrl: audioBase64, durationSeconds: duration, engine: "f5-tts" };
              }
            }
          }
        }
      }
    }
  } catch (err: any) {
    if (onLog) onLog(`[TTS F5] File download approach failed: ${err.message}`);
  }

  throw new Error(
    `F5-TTS synthesis failed. Make sure F5-TTS is running at ${baseUrl}. ` +
    `Start it with: f5-tts_webui --port 5000`
  );
}

// ─── Piper Engine ────────────────────────────────────────────────────────────

/**
 * Synthesize speech using Piper local API.
 * Piper typically runs on port 5000 with a simple HTTP API.
 */
async function synthesizePiper(
  text: string,
  config: TTSConfig,
  onLog?: TTSLogCallback
): Promise<TTSResult> {
  const baseUrl = config.ttsUrl.replace(/\/$/, "");

  if (onLog) onLog(`[TTS Piper] Synthesizing: "${text.substring(0, 60)}..."`);

  // Piper HTTP API: POST /synthesize with JSON body
  const payload: any = {
    text,
    speaker_id: config.voiceProfile || "default",
    speed: config.voiceSpeed || 1.0,
  };

  try {
    const response = await fetch(`${baseUrl}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (response.ok) {
      // Piper returns raw WAV audio bytes
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("audio") || contentType.includes("octet-stream")) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const audioBase64 = `data:audio/wav;base64,${buffer.toString("base64")}`;
        const duration = estimateAudioDuration(audioBase64);
        if (onLog) onLog(`[TTS Piper] Synthesis complete (${duration.toFixed(1)}s)`);
        return { audioDataUrl: audioBase64, durationSeconds: duration, engine: "piper" };
      }

      // Might return JSON with base64
      const data = await response.json();
      if (data.audio || data.audio_base64 || data.wav) {
        const audioRaw = data.audio || data.audio_base64 || data.wav;
        const audioBase64 = audioRaw.startsWith("data:")
          ? audioRaw
          : `data:audio/wav;base64,${audioRaw}`;
        const duration = estimateAudioDuration(audioBase64);
        if (onLog) onLog(`[TTS Piper] Synthesis complete (${duration.toFixed(1)}s)`);
        return { audioDataUrl: audioBase64, durationSeconds: duration, engine: "piper" };
      }
    }

    throw new Error(`Piper returned status ${response.status}`);
  } catch (err: any) {
    throw new Error(
      `Piper TTS failed: ${err.message}. Make sure Piper is running at ${baseUrl}. ` +
      `Start it with: piper_server --port 5000`
    );
  }
}

// ─── StyleTTS2 Engine ────────────────────────────────────────────────────────

/**
 * Synthesize speech using StyleTTS2 local API.
 * StyleTTS2 typically runs as a Streamlit/Gradio app on port 8501.
 */
async function synthesizeStyleTTS2(
  text: string,
  config: TTSConfig,
  onLog?: TTSLogCallback
): Promise<TTSResult> {
  const baseUrl = config.ttsUrl.replace(/\/$/, "");

  if (onLog) onLog(`[TTS StyleTTS2] Synthesizing: "${text.substring(0, 60)}..."`);

  // StyleTTS2 Gradio API
  const payload = {
    data: [
      text,
      config.voiceProfile || "default",
      config.voiceSpeed || 1.0,
      config.voiceEmotion || "neutral",
    ],
  };

  try {
    const response = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });

    if (response.ok) {
      const data = await response.json();

      if (data.data && Array.isArray(data.data) && data.data.length > 0) {
        const audioResult = data.data[0];
        let audioBase64 = "";

        if (typeof audioResult === "string") {
          if (audioResult.startsWith("data:")) {
            audioBase64 = audioResult;
          } else if (audioResult.startsWith("/") || audioResult.startsWith("C:")) {
            if (fs.existsSync(audioResult)) {
              const buffer = fs.readFileSync(audioResult);
              audioBase64 = `data:audio/wav;base64,${buffer.toString("base64")}`;
            }
          } else {
            audioBase64 = `data:audio/wav;base64,${audioResult}`;
          }
        } else if (typeof audioResult === "object" && audioResult !== null) {
          // Gradio file reference
          const fileUrl = audioResult.url || audioResult.path;
          if (fileUrl) {
            const fullUrl = fileUrl.startsWith("http") ? fileUrl : `${baseUrl}${fileUrl.startsWith("/") ? "" : "/"}${fileUrl}`;
            const audioResponse = await fetch(fullUrl, { signal: AbortSignal.timeout(30000) });
            if (audioResponse.ok) {
              const arrayBuffer = await audioResponse.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              audioBase64 = `data:audio/wav;base64,${buffer.toString("base64")}`;
            }
          }
        }

        if (audioBase64) {
          const duration = estimateAudioDuration(audioBase64);
          if (onLog) onLog(`[TTS StyleTTS2] Synthesis complete (${duration.toFixed(1)}s)`);
          return { audioDataUrl: audioBase64, durationSeconds: duration, engine: "styletts2" };
        }
      }
    }

    throw new Error(`StyleTTS2 returned status ${response.status}`);
  } catch (err: any) {
    throw new Error(
      `StyleTTS2 TTS failed: ${err.message}. Make sure StyleTTS2 is running at ${baseUrl}.`
    );
  }
}

// ─── Gemini TTS Engine ──────────────────────────────────────────────────────

/**
 * Synthesize speech using Google Gemini TTS API (cloud fallback).
 */
async function synthesizeGeminiTTS(
  text: string,
  config: TTSConfig,
  onLog?: TTSLogCallback
): Promise<TTSResult> {
  if (!config.geminiClient) {
    throw new Error("Gemini client not available. Set GEMINI_API_KEY environment variable.");
  }

  if (onLog) onLog(`[TTS Gemini] Synthesizing: "${text.substring(0, 60)}..."`);

  try {
    const voiceName = mapVoiceProfileToGemini(config.voiceProfile);

    const ttsRes = await config.geminiClient.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const base64Audio = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      const audioDataUrl = `data:audio/wav;base64,${base64Audio}`;
      const duration = estimateAudioDuration(audioDataUrl);
      if (onLog) onLog(`[TTS Gemini] Synthesis complete (voice: ${voiceName}, ${duration.toFixed(1)}s)`);
      return { audioDataUrl, durationSeconds: duration, engine: "gemini-tts" };
    }

    throw new Error("Gemini TTS returned no audio data");
  } catch (err: any) {
    throw new Error(`Gemini TTS failed: ${err.message}`);
  }
}

// ─── Main TTS Router ────────────────────────────────────────────────────────

/**
 * Synthesize speech using the configured TTS engine.
 * Automatically routes to the correct engine based on ttsEngine setting.
 * Falls back to other engines if the primary fails.
 */
export async function synthesizeSpeech(
  text: string,
  config: TTSConfig,
  onLog?: TTSLogCallback
): Promise<TTSResult> {
  if (!text || text.trim().length === 0) {
    throw new Error("No text provided for TTS synthesis");
  }

  // Truncate very long text (most TTS engines have limits)
  const maxTextLength = 2000;
  const truncatedText = text.length > maxTextLength
    ? text.substring(0, maxTextLength) + "..."
    : text;

  const engine = config.ttsEngine;

  // Try the primary engine
  try {
    switch (engine) {
      case "f5-tts":
        return await synthesizeF5TTS(truncatedText, config, onLog);
      case "piper":
        return await synthesizePiper(truncatedText, config, onLog);
      case "styletts2":
        return await synthesizeStyleTTS2(truncatedText, config, onLog);
      case "gemini-tts":
        return await synthesizeGeminiTTS(truncatedText, config, onLog);
      default:
        if (onLog) onLog(`[TTS] Unknown engine "${engine}", falling back to F5-TTS`);
        return await synthesizeF5TTS(truncatedText, config, onLog);
    }
  } catch (primaryErr: any) {
    if (onLog) onLog(`[TTS] Primary engine "${engine}" failed: ${primaryErr.message}`);

    // Try fallback engines in order of preference
    const fallbackOrder = engine === "gemini-tts"
      ? ["f5-tts", "piper"]
      : ["gemini-tts"]; // If local fails, try cloud

    for (const fallbackEngine of fallbackOrder) {
      if (fallbackEngine === engine) continue; // Skip the one that already failed

      try {
        if (onLog) onLog(`[TTS] Trying fallback engine: ${fallbackEngine}`);

        switch (fallbackEngine) {
          case "f5-tts":
            return await synthesizeF5TTS(truncatedText, config, onLog);
          case "piper":
            return await synthesizePiper(truncatedText, config, onLog);
          case "styletts2":
            return await synthesizeStyleTTS2(truncatedText, config, onLog);
          case "gemini-tts":
            if (config.geminiClient) {
              return await synthesizeGeminiTTS(truncatedText, config, onLog);
            }
            break;
        }
      } catch (fallbackErr: any) {
        if (onLog) onLog(`[TTS] Fallback "${fallbackEngine}" also failed: ${fallbackErr.message}`);
      }
    }

    // All engines failed
    throw new Error(
      `All TTS engines failed. Primary (${engine}): ${primaryErr.message}. ` +
      `Make sure your TTS engine is running and accessible.`
    );
  }
}

// ─── Connection Check ───────────────────────────────────────────────────────

/**
 * Check if a TTS engine is reachable.
 */
export async function checkTTSConnection(
  ttsEngine: string,
  ttsUrl: string
): Promise<TTSEngineInfo> {
  const baseUrl = ttsUrl.replace(/\/$/, "");

  try {
    // Different engines have different health check endpoints
    let healthPath = "/";
    switch (ttsEngine) {
      case "f5-tts":
        healthPath = "/"; // Gradio UI root
        break;
      case "piper":
        healthPath = "/health";
        break;
      case "styletts2":
        healthPath = "/";
        break;
      case "gemini-tts":
        // Gemini is cloud-based, always "available" if we have a client
        return {
          name: "Gemini TTS",
          available: true,
          url: "Cloud (Google AI API)",
        };
    }

    const response = await fetch(`${baseUrl}${healthPath}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      // Try to get available voices if possible
      let voices: string[] = [];
      try {
        if (ttsEngine === "f5-tts") {
          // Try to get Gradio config for available voices
          const configResponse = await fetch(`${baseUrl}/info`, {
            signal: AbortSignal.timeout(5000),
          });
          if (configResponse.ok) {
            const info = await configResponse.json();
            // Extract voice names from Gradio config if available
            if (info.named_endpoints) {
              voices = Object.keys(info.named_endpoints);
            }
          }
        }
      } catch {
        // Ignore — voice list is optional
      }

      return {
        name: getEngineDisplayName(ttsEngine),
        available: true,
        url: baseUrl,
        voices: voices.length > 0 ? voices : undefined,
      };
    }

    return {
      name: getEngineDisplayName(ttsEngine),
      available: false,
      url: baseUrl,
      error: `Returned status ${response.status}`,
    };
  } catch (err: any) {
    return {
      name: getEngineDisplayName(ttsEngine),
      available: false,
      url: baseUrl,
      error: `Offline or timed out: ${err.message}`,
    };
  }
}

/**
 * Check all available TTS engines and return their status.
 */
export async function checkAllTTSEngines(): Promise<TTSEngineInfo[]> {
  const engines: TTSEngineInfo[] = [];

  const engineChecks = [
    { engine: "f5-tts", url: "http://localhost:5000" },
    { engine: "piper", url: "http://localhost:5000" },
    { engine: "styletts2", url: "http://localhost:8501" },
  ];

  for (const check of engineChecks) {
    const info = await checkTTSConnection(check.engine, check.url);
    engines.push(info);
  }

  return engines;
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Estimate audio duration from a base64 WAV data URL.
 * WAV header contains the byte rate which we can use to calculate duration.
 * For other formats, estimate based on base64 data size.
 */
export function estimateAudioDuration(audioDataUrl: string): number {
  try {
    const base64Match = audioDataUrl.match(/^data:[^;]+;base64,(.+)$/);
    if (!base64Match) return 0;

    const buffer = Buffer.from(base64Match[1], "base64");
    const size = buffer.length;

    // If it's a WAV file, parse the header
    if (audioDataUrl.includes("audio/wav") || audioDataUrl.includes("audio/x-wav")) {
      if (size > 44) {
        // WAV header: bytes 28-31 = sample rate, bytes 34-35 = bits per sample, bytes 22-23 = channels
        // byteRate = sampleRate * numChannels * bitsPerSample/8
        // duration = dataSize / byteRate
        const byteRate = buffer.readUInt32LE(28);
        const dataSize = buffer.readUInt32LE(40);
        if (byteRate > 0) {
          return dataSize / byteRate;
        }
      }
    }

    // Fallback estimation: ~176.4 KB/s for 16-bit 44.1kHz stereo WAV
    // or ~16 KB/s for 128kbps MP3
    if (audioDataUrl.includes("mp3") || audioDataUrl.includes("mpeg")) {
      return size / (128 * 1024 / 8); // 128kbps
    }

    // Assume WAV-like bitrate as default
    return size / 176400; // 44.1kHz 16-bit stereo
  } catch {
    return 0;
  }
}

/**
 * Map voice profile name to Gemini TTS voice name.
 * Gemini supports: Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr
 */
function mapVoiceProfileToGemini(voiceProfile: string): string {
  const profileMap: Record<string, string> = {
    "natural_charles": "Charon",
    "natural_puck": "Puck",
    "natural_kore": "Kore",
    "natural_fenrir": "Fenrir",
    "natural_aoede": "Aoede",
    "natural_leda": "Leda",
    "natural_orus": "Orus",
    "natural_zephyr": "Zephyr",
    // Direct Gemini names
    "Puck": "Puck",
    "Charon": "Charon",
    "Kore": "Kore",
    "Fenrir": "Fenrir",
    "Aoede": "Aoede",
    "Leda": "Leda",
    "Orus": "Orus",
    "Zephyr": "Zephyr",
  };

  return profileMap[voiceProfile] || "Puck";
}

/**
 * Get a display name for a TTS engine.
 */
function getEngineDisplayName(engine: string): string {
  const names: Record<string, string> = {
    "f5-tts": "F5-TTS (Voice Cloning)",
    "piper": "Piper (Fast Neural TTS)",
    "styletts2": "StyleTTS2 (Expressive TTS)",
    "gemini-tts": "Gemini TTS (Cloud)",
  };
  return names[engine] || engine;
}

/**
 * Get the default URL for a TTS engine.
 */
export function getDefaultTTSEngineUrl(engine: string): string {
  const urls: Record<string, string> = {
    "f5-tts": "http://localhost:5000",
    "piper": "http://localhost:5000",
    "styletts2": "http://localhost:8501",
    "gemini-tts": "",
  };
  return urls[engine] || "http://localhost:5000";
}

/**
 * Write audio data URL to a WAV file on disk.
 * Returns the file path.
 */
export function writeAudioToDisk(
  audioDataUrl: string,
  outputDir: string,
  filename: string
): string {
  const base64Match = audioDataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!base64Match) {
    throw new Error("Invalid audio data URL format");
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const buffer = Buffer.from(base64Match[1], "base64");
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, buffer);

  return filePath;
}
