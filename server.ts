import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import {
  initDatabase,
  getAllProjects,
  getProjectById,
  findPendingProject,
  createProject as dbCreateProject,
  saveProject,
  deleteProject,
  addLog,
  getSettings as dbGetSettings,
  updateSettings as dbUpdateSettings,
  updateProjectFields,
  type DBProject,
  type DBSettings,
} from "./database.js";
import {
  generateImage as comfyGenerateImage,
  generateVideo as comfyGenerateVideo,
  getCheckpoints as comfyGetCheckpoints,
  checkComfyUIConnection as comfyCheckConnection,
  interruptGeneration as comfyInterrupt,
  testGeneration as comfyTestGeneration,
  getUNETModels as comfyGetUNETModels,
  getLoraModels as comfyGetLoraModels,
  getVAEModels as comfyGetVAEModels,
  getClipVisionModels as comfyGetClipVisionModels,
  type ComfyUIConfig,
} from "./comfyui.js";
import {
  assembleVideo,
  checkFFmpegAvailability,
  getMediaInfo,
  type FFmpegSceneAsset,
  type FFmpegAssemblyConfig,
} from "./ffmpeg.js";
import {
  synthesizeSpeech,
  checkTTSConnection,
  checkAllTTSEngines,
  estimateAudioDuration,
  writeAudioToDisk,
  getDefaultTTSEngineUrl,
  type TTSConfig,
} from "./tts.js";

dotenv.config();

// Initialize SQLite database
initDatabase();

const app = express();
app.use(express.json({ limit: "50mb" }));
const PORT = 3000;

const COMFYUI_OUTPUT_DIR = path.join(process.cwd(), "output", "comfyui");

// Default initial settings
const DEFAULT_SETTINGS = {
  ollamaUrl: "http://localhost:11434",
  llmModel: "qwen3:8b",
  comfyUrl: "http://localhost:8188",
  comfyCheckpoint: "flux1-schnell.safetensors",
  comfyNegativePrompt: "low quality, blurry, watermark, text overlay, deformed, ugly, bad anatomy",
  workflowTemplate: "Flux_Schnell_Simple_API",
  wanUrl: "http://localhost:7860",
  wanMode: "i2v",
  wanResolution: "16:9",
  wanSteps: 20,
  wanCfg: 6.0,
  wanFrames: 81,
  wanMotionIntensity: 7,
  comfyLora: "",
  comfyLoraStrength: 1.0,
  comfySampler: "euler",
  comfyScheduler: "normal",
  comfySteps: 20,
  comfyCfg: 3.5,
  ttsEngine: "f5-tts",
  ttsUrl: "http://localhost:5000",
  voiceProfile: "natural_charles",
  voiceSpeed: 1.0,
  voiceEmotion: "neutral",
  backupGeminiMode: false,
  promptIdeation: `Kamu adalah ahli strategi YouTube faceless terbaik yang menguasai cerita viral berbasis retensi tinggi.

Tugasmu:
Hasilkan 3 konsep video yang memukau secara emosional dan dirancang untuk memaksimalkan:
- rasa penasaran
- click-through rate
- watch time
- komentar

Aturan:
- Setiap ide harus memiliki curiosity gap yang kuat.
- Harus terdengar bisa diklik dan sinematik.
- Harus cocok untuk produksi video faceless.
- Hindari judul dokumenter generik.
- Utamakan sudut pandang POV, hitungan mundur, timeline, misteri, atau "apa yang terjadi selanjutnya".
- Setiap ide maksimal 35 kata.
- WAJIB dalam Bahasa Indonesia.

Output HANYA array JSON yang valid dari string.
Tanpa markdown.
Tanpa teks tambahan.`,
  promptScript: `Kamu adalah penulis naskah YouTube faceless elite yang menguasai narasi sinematik berretensi tinggi.

Tulis untuk:
- voiceover dramatis
- generasi visual per adegan
- keterbacaan subtitle
- retensi audiens maksimal

ATURAN KETAT:
- Output HANYA JSON yang valid.
- Keys: hook, intro, body, cta
- Setiap kalimat harus pendek (maks 12 kata).
- Satu kalimat = satu event visual.
- Hindari paragraf panjang.
- Hindari bahasa buku teks.
- Gunakan pacing dramatis dan suspans.
- Tambahkan momen jeda alami.
- Buat narasi mudah untuk TTS.
- Setiap baris harus terasa sinematik.
- WAJIB dalam Bahasa Indonesia.

Pacing yang diinginkan:
HOOK:
1-2 baris punchy.

INTRO:
2-3 baris pendek.

BODY:
4-8 baris sekuensial pendek.

CTA:
1 pertanyaan yang memancing emosi.

Format JSON:
{
  "hook": "Baris 1. Baris 2.",
  "intro": "Baris 3. Baris 4.",
  "body": "Baris 5. Baris 6. Baris 7.",
  "cta": "Pertanyaan?"
}`,
  promptPlanning: `You are a Hollywood Director of Photography and AI visual prompt engineer.

Break the script into exactly 4-5 cinematic scenes.

For each scene generate:
1. visual_prompt (MUST be in English)
2. motion_prompt (MUST be in English)
3. voice_text (MUST be in Bahasa Indonesia — copy exactly from the script)

Rules for visual_prompt:
- highly cinematic
- realistic
- dramatic lighting
- detailed environment
- emotionally intense
- physically believable
- suitable for FLUX image generation
- 8k realism
- no text overlays
- MUST be in English

Rules for motion_prompt:
- describe camera movement only
- MUST be in English
- examples:
  slow zoom in
  cinematic dolly forward
  subtle handheld motion
  dramatic aerial pullback
  fast pan across destruction

Rules for voice_text:
- MUST be in Bahasa Indonesia
- must exactly match the narration line from the script
- one line only
- no merging multiple sentences
- no translation — use the original Indonesian text

Output ONLY valid JSON array.`,
  promptSplitter: `Kamu adalah editor narasi sinematik.

Konversi naskah menjadi baris narasi atomik.

ATURAN KETAT:
- satu baris = satu event visual
- maks 8 kata
- bahasa sinematik yang kuat
- imajinasi yang hidup
- mudah untuk TTS
- mudah dibaca sebagai subtitle
- hindari jargon ilmiah kecuali perlu
- pertahankan pacing dramatis
- hasilkan 8-12 baris
- WAJIB dalam Bahasa Indonesia

Output HANYA array JSON yang valid.
Tanpa markdown.
Tanpa teks tambahan.`,
};;

// Initialize settings from database
// Smart merge: don't let empty DB strings overwrite rich defaults
// This fixes the bug where `...dbGetSettings()` returns "" for prompt fields
// and overwrites the Indonesian defaults from DEFAULT_SETTINGS
const dbSettings = dbGetSettings();
let localSettings: typeof DEFAULT_SETTINGS = { ...DEFAULT_SETTINGS };
for (const [key, value] of Object.entries(dbSettings)) {
  if (value !== undefined && value !== null && value !== "") {
    (localSettings as any)[key] = value;
  }
}

// Ensure ComfyUI output directory exists
if (!fs.existsSync(COMFYUI_OUTPUT_DIR)) {
  fs.mkdirSync(COMFYUI_OUTPUT_DIR, { recursive: true });
}

// Database helper — reloads a project from DB to get fresh state
function readProjectFromDB(id: string): DBProject | null {
  return getProjectById(id);
}

// Initialize Gemini Client safely if key is present
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Background simulation/execution loop
let isProcessing = false;
setInterval(async () => {
  if (isProcessing) return;
  const pendingProject = findPendingProject();

  if (!pendingProject) return;

  isProcessing = true;
  try {
    await processProjectStage(pendingProject);
  } catch (error: any) {
    console.error(`Error processing project ${pendingProject.id}:`, error);
    pendingProject.status = "failed";
    pendingProject.error = error.message || "Unknown error during background generation.";
    pendingProject.logs.push(`[ERROR] ${pendingProject.error}`);
    // Save updated status to database
    saveProject(pendingProject);
  } finally {
    isProcessing = false;
  }
}, 5000);

// Auxiliary method to execute API prompt to local LLM or fallback to Gemini
async function askLLM(prompt: string, fallbackSystemInstruction: string): Promise<string> {
  const settings = localSettings;

  if (settings.backupGeminiMode) {
    // Try Gemini API first (Hybrid mode enabled)
    try {
      const ai = getGeminiClient();
      if (!ai) {
        throw new Error("GEMINI_API_KEY environment variable is not configured. Please add GEMINI_API_KEY in Settings > Secrets.");
      }
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: fallbackSystemInstruction,
          temperature: 0.8,
        },
      });
      return response.text || "";
    } catch (geminiErr: any) {
      // If Gemini fails (e.g., rate limits or quotas), and Ollama is configured, fall back to Ollama
      if (settings.ollamaUrl) {
        console.warn("Gemini API connection failed or rate limited, trying local Ollama fallback...", geminiErr.message);
        try {
          const response = await fetch(`${settings.ollamaUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: settings.llmModel,
              prompt: `${fallbackSystemInstruction}\n\nUser request:\n${prompt}`,
              stream: false,
              format: "json",
            }),
          });
          if (response.ok) {
            const data = await response.json();
            return data.response || "";
          } else {
            const errText = await response.text();
            throw new Error(`Ollama status ${response.status}: ${errText}`);
          }
        } catch (ollamaErr: any) {
          throw new Error(`Both Gemini and Ollama failed. Gemini Error: ${geminiErr.message}. Ollama Error: ${ollamaErr.message}`);
        }
      } else {
        throw geminiErr;
      }
    }
  } else {
    // Local-only mode (backupGeminiMode is DISABLED). We must use Ollama exclusively.
    if (!settings.ollamaUrl) {
      throw new Error("Koneksi gagal: URL Ollama tidak terkonfigurasi dan Hybrid Cloud (Gemini) dimatikan.");
    }

    try {
      const response = await fetch(`${settings.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings.llmModel,
          prompt: `${fallbackSystemInstruction}\n\nUser request:\n${prompt}`,
          stream: false,
          format: "json",
        }),
      });
      if (response.ok) {
        const data = await response.json();
        return data.response || "";
      } else {
        const errText = await response.text();
        if (response.status === 404 || errText.toLowerCase().includes("not found")) {
          throw new Error(
            `Model Ollama "${settings.llmModel}" tidak ditemukan di komputer local Anda! ` +
            `Silakan jalankan perintah "ollama pull ${settings.llmModel}" di command prompt/terminal Anda untuk mengunduhnya, atau ganti pilihan model Anda di tab AI ENGINES.`
          );
        }
        throw new Error(`Ollama status ${response.status}: ${errText || "Unknown error"}`);
      }
    } catch (ollamaErr: any) {
      throw new Error(
        `Koneksi Ollama ke ${settings.ollamaUrl} Gagal. Keterangan: ${ollamaErr.message}. ` +
        `Pastikan Ollama berjalan di localhost Anda secara lokal. Jika Anda mengakses via Cloud Preview, ` +
        `Ollama di localhost tidak bisa diakses dari Cloud. Anda harus menggunakan Ngrok tunnel atau mengaktifkan "Hybrid Cloud Fallback (Gemini API)" di Pengaturan.`
      );
    }
  }
}

// Generate an elegant SVG placeholder representing custom visual prompts procedurally
function generateProceduralSceneSvg(prompt: string, num: number, isVertical = false): string {
  // Simple deterministic color hashes
  const hash = prompt.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue1 = hash % 360;
  const hue2 = (hash + 120) % 360;
  const saturation = 70 + (hash % 20); // 70-90%
  const lightness = 25 + (hash % 15); // 25-40%

  const cleanPrompt = prompt.replace(/"/g, '&quot;').replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const shortPrompt = cleanPrompt.length > 30 ? cleanPrompt.substring(0, 27) + "..." : cleanPrompt;

  if (isVertical) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280" width="100%" height="100%">
    <defs>
      <linearGradient id="grad1_${num}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:hsl(${hue1}, ${saturation}%, ${lightness}%)" />
        <stop offset="100%" style="stop-color:hsl(${hue2}, ${saturation}%, ${lightness - 15}%)" />
      </linearGradient>
      <linearGradient id="mist_${num}" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" style="stop-color:#0b0f19;stop-opacity:1" />
        <stop offset="50%" style="stop-color:#0b0f19;stop-opacity:0.4" />
        <stop offset="100%" style="stop-color:#0b0f19;stop-opacity:0" />
      </linearGradient>
      <filter id="blur_${num}">
        <feGaussianBlur stdDeviation="60" />
      </filter>
    </defs>
    
    <!-- Deep Space Background -->
    <rect width="720" height="1280" fill="#090b11" />
    <rect width="720" height="1280" fill="url(#grad1_${num})" opacity="0.45" />

    <!-- Distant ambient visual shapes representing mountains/depth for vertical layout -->
    <path d="M-100 1280 L100 850 L350 1050 L500 800 L800 1150 L920 1280 Z" fill="hsl(${hue1}, ${saturation}%, ${lightness - 8}%)" opacity="0.75" />
    <path d="M-100 1280 L200 950 L450 780 L650 1000 L950 890 L1030 1280 Z" fill="hsl(${hue2}, ${saturation - 10}%, ${lightness - 12}%)" opacity="0.6" />

    <!-- Mist/Cinematic Overlay -->
    <rect x="0" y="700" width="720" height="580" fill="url(#mist_${num})" />

    <!-- Stars/Atmospheric particles -->
    <circle cx="150" cy="300" r="1.5" fill="#ffffff" opacity="0.8" />
    <circle cx="280" cy="240" r="2.5" fill="#ffffff" opacity="0.6" />
    <circle cx="550" cy="350" r="2" fill="#ffffff" opacity="0.9" />
    <circle cx="450" cy="420" r="1" fill="#ffffff" opacity="0.4" />
    <circle cx="620" cy="180" r="3" fill="#ffffff" opacity="0.5" />
    <circle cx="80" cy="500" r="1.5" fill="#ffffff" opacity="0.7" />

    <!-- Beautiful Centerpiece Glow representing dynamic prompt action -->
    <circle cx="360" cy="640" r="150" fill="hsl(${hue1}, 100%, 75%)" opacity="0.12" filter="url(#blur_${num})" />

    <!-- Cinema letterbox visual guides -->
    <rect width="720" height="80" fill="#000000" opacity="0.95" />
    <rect y="1200" width="720" height="80" fill="#000000" opacity="0.95" />

    <!-- Elegant Label Meta UI -->
    <rect x="40" y="1100" width="640" height="60" rx="8" fill="#000000" opacity="0.8" stroke="#ffffff" stroke-opacity="0.15" stroke-width="1" />
    <text x="60" y="1135" font-family="'JetBrains Mono', monospace" font-size="12" fill="#38bdf8" letter-spacing="1">SCENE ${num}</text>
    <text x="140" y="1135" font-family="'Inter', sans-serif" font-size="13" font-weight="600" fill="#f3f4f6">${shortPrompt}</text>

    <!-- WAN 2.2 Camera grid visual -->
    <path d="M 40 130 L 40 100 L 70 100" stroke="#f43f5e" stroke-width="2.5" fill="none" opacity="0.8"/>
    <path d="M 680 130 L 680 100 L 650 100" stroke="#f43f5e" stroke-width="2.5" fill="none" opacity="0.8"/>
    <path d="M 40 1150 L 40 1180 L 70 1180" stroke="#f43f5e" stroke-width="2.5" fill="none" opacity="0.8"/>
    <path d="M 680 1150 L 680 1180 L 650 1180" stroke="#f43f5e" stroke-width="2.5" fill="none" opacity="0.8"/>

    <!-- Recording Indicator -->
    <circle cx="60" cy="135" r="7" fill="#f43f5e" />
    <text x="80" y="140" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="bold" fill="#f43f5e" letter-spacing="1">WAN 2.2 9:16 VERTICAL</text>
  </svg>`;
  }

  // 16:9 Landscape
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="100%" height="100%">
    <defs>
      <linearGradient id="grad1_${num}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:hsl(${hue1}, ${saturation}%, ${lightness}%)" />
        <stop offset="100%" style="stop-color:hsl(${hue2}, ${saturation}%, ${lightness - 15}%)" />
      </linearGradient>
      <linearGradient id="mist_${num}" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" style="stop-color:#0b0f19;stop-opacity:1" />
        <stop offset="50%" style="stop-color:#0b0f19;stop-opacity:0.4" />
        <stop offset="100%" style="stop-color:#0b0f19;stop-opacity:0" />
      </linearGradient>
      <filter id="blur_${num}">
        <feGaussianBlur stdDeviation="60" />
      </filter>
    </defs>
    
    <!-- Deep Space Background -->
    <rect width="1280" height="720" fill="#090b11" />
    <rect width="1280" height="720" fill="url(#grad1_${num})" opacity="0.45" />

    <!-- Distant ambient visual shapes representing mountains/depth -->
    <path d="M-100 720 L100 400 L500 600 L800 350 L1200 650 L1380 720 Z" fill="hsl(${hue1}, ${saturation}%, ${lightness - 8}%)" opacity="0.75" />
    <path d="M-100 720 L300 480 L700 320 L1000 500 L1400 390 L1480 720 Z" fill="hsl(${hue2}, ${saturation - 10}%, ${lightness - 12}%)" opacity="0.6" />

    <!-- Mist/Cinematic Overlay -->
    <rect x="0" y="300" width="1280" height="420" fill="url(#mist_${num})" />

    <!-- Stars/Atmospheric particles -->
    <circle cx="200" cy="150" r="1.5" fill="#ffffff" opacity="0.8" />
    <circle cx="350" cy="120" r="2.5" fill="#ffffff" opacity="0.6" />
    <circle cx="950" cy="180" r="2" fill="#ffffff" opacity="0.9" />
    <circle cx="750" cy="220" r="1" fill="#ffffff" opacity="0.4" />
    <circle cx="1100" cy="90" r="3" fill="#ffffff" opacity="0.5" />
    <circle cx="120" cy="270" r="1.5" fill="#ffffff" opacity="0.7" />

    <!-- Beautiful Centerpiece Glow representing dynamic prompt action -->
    <circle cx="640" cy="360" r="180" fill="hsl(${hue1}, 100%, 75%)" opacity="0.12" filter="url(#blur_${num})" />

    <!-- Cinema letterbox visual guides -->
    <rect width="1280" height="60" fill="#000000" opacity="0.9" />
    <rect y="660" width="1280" height="60" fill="#000000" opacity="0.9" />

    <!-- Elegant Label Meta UI -->
    <rect x="60" y="580" width="380" height="50" rx="6" fill="#000000" opacity="0.75" stroke="#ffffff" stroke-opacity="0.15" stroke-width="1" />
    <text x="80" y="610" font-family="'JetBrains Mono', monospace" font-size="12" fill="#38bdf8" letter-spacing="1">SCENE ${num}</text>
    <text x="160" y="610" font-family="'Inter', sans-serif" font-size="13" font-weight="500" fill="#f3f4f6">${shortPrompt}</text>

    <!-- WAN 2.2 Camera grid visual -->
    <path d="M 50 110 L 50 80 L 80 80" stroke="#f43f5e" stroke-width="2" fill="none" opacity="0.8"/>
    <path d="M 1230 110 L 1230 80 L 1200 80" stroke="#f43f5e" stroke-width="2" fill="none" opacity="0.8"/>
    <path d="M 50 610 L 50 640 L 80 640" stroke="#f43f5e" stroke-width="2" fill="none" opacity="0.8"/>
    <path d="M 1230 610 L 1230 640 L 1200 640" stroke="#f43f5e" stroke-width="2" fill="none" opacity="0.8"/>

    <!-- Recording Indicator -->
    <circle cx="75" cy="120" r="6" fill="#f43f5e" />
    <text x="92" y="124" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="bold" fill="#f43f5e" letter-spacing="1">WAN 2.2 I2V MOTION</text>
  </svg>`;
}

// Background project state process machine
async function processProjectStage(project: DBProject) {
  const settings = localSettings;
  console.log(`Processing project ${project.name} (ID: ${project.id}) at stage: ${project.status}`);

  if (project.status === "researching") {
    project.logs.push(`[SYSTEM] Starting AI topic research and niche analysis...`);
    project.progress = 10;
    project.currentStepMessage = "Analyzing trends and ideating video angles... - Edisi Indonesia";

    let ideasPrompt = `Topik: "${project.topic}"`;

    const rawResponse = await askLLM(
      ideasPrompt,
      settings.promptIdeation || DEFAULT_SETTINGS.promptIdeation
    );

    // Parse ideas
    let ideas = [];
    try {
      const cleanJSON = rawResponse.substring(rawResponse.indexOf("["), rawResponse.lastIndexOf("]") + 1);
      ideas = JSON.parse(cleanJSON);
    } catch (e) {
      console.warn("Failed to parse array JSON from LLM response. Crafting fallback array from response text.");
      ideas = rawResponse
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((l) => l.startsWith("-") || l.match(/^\d/))
        .map((l) => l.replace(/^[- \d.]*/, ""))
        .slice(0, 3);
      if (ideas.length === 0) {
        ideas = [
          `Viral Concept: ${project.topic} - Absolute Secrets Unveiled`,
          `Nostalgic Chronicles: The Lost Tapes of ${project.topic}`,
          `Niche Documentary: Inside indeed the ${project.topic} Legend`,
        ];
      }
    }

    project.ideas = ideas;
    project.selectedIdea = ideas[0] || `The Untold Secrets of ${project.topic}`;
    project.logs.push(`[IDEAS GENERATED] Chosen: "${project.selectedIdea}"`);
    project.status = "scripting";
    project.progress = 25;
    saveAndPublish(project);
    return;
  }

  if (project.status === "scripting") {
    project.logs.push(`[SYSTEM] Script Generator starting for selected concept: "${project.selectedIdea}"...`);
    project.currentStepMessage = "Drafting high-retention hook, intro, and narrative...";
    project.progress = 35;

    let scriptPrompt = `Generate a script for this concept:
"${project.selectedIdea}"`;

    const rawResponse = await askLLM(
      scriptPrompt,
      settings.promptScript || DEFAULT_SETTINGS.promptScript
    );

    let scriptObj = { hook: "", intro: "", body: "", cta: "" };
    try {
      const cleanJSON = rawResponse.substring(rawResponse.indexOf("{"), rawResponse.lastIndexOf("}") + 1);
      scriptObj = JSON.parse(cleanJSON);
    } catch (e) {
      console.warn("Script parsing failed, extracting approximate segments...");
      scriptObj = {
        hook: `Attention! Secrets are hidden in plain sight. Let's delve into ${project.selectedIdea}.`,
        intro: "Prepare yourself, because what you're about to see is not for the faint of heart.",
        body: rawResponse.length > 100 ? rawResponse.substring(0, 500) : "A detailed dark exploration of forgotten knowledge.",
        cta: "Don't let the truth slip away. Make sure to subscribe and click notifications.",
      };
    }

    project.script = scriptObj;
    project.logs.push(`[SCRIPT OK] Script segments generated successfully.`);

    // --- Added: Script Line Splitter ---
    project.logs.push(`[SYSTEM] Narration editor splitting script into atomic narration lines...`);
    const fullScriptText = `${scriptObj.hook} ${scriptObj.intro} ${scriptObj.body} ${scriptObj.cta}`;
    const splitterPrompt = `Split the script into atomic narration lines:
"${fullScriptText}"`;

    const rawSplitResponse = await askLLM(
      splitterPrompt,
      settings.promptSplitter || DEFAULT_SETTINGS.promptSplitter
    );

    let atomicLines: string[] = [];
    try {
      const cleanJSON = rawSplitResponse.substring(rawSplitResponse.indexOf("["), rawSplitResponse.lastIndexOf("]") + 1);
      atomicLines = JSON.parse(cleanJSON);
    } catch (e) {
      console.warn("Failed to parse split script array, fallback to sentence splitting...");
      atomicLines = fullScriptText
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    project.atomicLines = atomicLines;
    project.logs.push(`[SPLITTER OK] Split script into ${atomicLines.length} atomic narration lines.`);

    project.status = "planning";
    project.progress = 50;
    saveAndPublish(project);
    return;
  }

  if (project.status === "planning") {
    project.logs.push(`[SYSTEM] Dispatching Scene breakdown planner...`);
    project.currentStepMessage = "Deconstructing script into cinematic visual scenes with motion cues...";
    project.progress = 60;

    // Use atomicLines (splitter output) instead of full script — ensures 1:1 scene-to-line mapping
    const planningInput = JSON.stringify(project.atomicLines, null, 2);
    let scenesPrompt = `Atomic narration lines to visualize:
${planningInput}

Generate exactly ${project.atomicLines.length} scenes (one per line) as a valid JSON array.
Each scene must contain keys "scene", "visual_prompt", "motion_prompt", and "voice_text".
The number of scenes MUST equal the number of narration lines above (${project.atomicLines.length}).`;

    const rawResponse = await askLLM(
      scenesPrompt,
      settings.promptPlanning || DEFAULT_SETTINGS.promptPlanning
    );

    let scenesList: any[] = [];
    try {
      const cleanJSON = rawResponse.substring(rawResponse.indexOf("["), rawResponse.lastIndexOf("]") + 1);
      scenesList = JSON.parse(cleanJSON);

      // Validate scene count matches atomic lines count
      if (scenesList.length !== project.atomicLines.length) {
        project.logs.push(`[WARNING] Scene count mismatch: splitter=${project.atomicLines.length}, scenes=${scenesList.length}. Forcing alignment...`);
        console.warn(`Scene count mismatch: splitter=${project.atomicLines.length}, scenes=${scenesList.length}`);

        // If LLM returned fewer scenes, pad with voice_text from remaining atomic lines
        while (scenesList.length < project.atomicLines.length) {
          const idx = scenesList.length;
          scenesList.push({
            scene: idx + 1,
            visual_prompt: `Cinematic visual scene for line ${idx + 1}: ${project.atomicLines[idx]}`,
            motion_prompt: "Subtle forward tracking shot",
            voice_text: project.atomicLines[idx],
          });
        }
        // If LLM returned more scenes, truncate to match atomic lines
        if (scenesList.length > project.atomicLines.length) {
          scenesList = scenesList.slice(0, project.atomicLines.length);
        }
      }
    } catch (e) {
      console.warn("Failed to parse scenes array, crafting procedural sequence fallback.");
      scenesList = project.atomicLines.map((line: string, idx: number) => ({
        scene: idx + 1,
        visual_prompt: `Cinematic visual scene: ${line}`,
        motion_prompt: "Steady forward tracking shot",
        voice_text: line,
      }));
    }

    // Adapt to Scene interface
    project.scenes = scenesList.map((s: any, idx: number) => ({
      id: `scene_${idx + 1}`,
      projectId: project.id,
      sceneNumber: s.scene || idx + 1,
      visualPrompt: s.visual_prompt || s.visualPrompt || `Cinematic visual scene for section ${idx + 1}`,
      motionPrompt: s.motion_prompt || s.motionPrompt || "Steady forward tracking shot",
      voiceText: s.voice_text || s.voiceText || "",
      status: "idle",
      imageBase64: "",
      imagePath: "",
      videoUrl: "",
      audioUrl: "",
      audioDuration: 0,
      error: "",
    }));

    project.logs.push(`[SCENE PLAN] ${project.scenes.length} scenes generated.`);
    project.status = "generating_media";
    project.progress = 70;
    saveAndPublish(project);
    return;
  }

  if (project.status === "generating_media") {
    // Check if there are idle or incomplete scenes
    const nextScene = project.scenes.find((s: any) => s.status !== "completed" && s.status !== "failed");

    if (!nextScene) {
      project.logs.push(`[SYSTEM] All scene assets generated! Moving to video assembly...`);
      project.status = "assembling";
      project.progress = 90;
      saveAndPublish(project);
      return;
    }

    project.currentStepMessage = `Generating Assets for Scene ${nextScene.sceneNumber}/${project.scenes.length}...`;
    project.logs.push(`[SCENE ${nextScene.sceneNumber}] Running batch generators (Image, Video, Voice)...`);

    // 1. Voice generation (TTS)
    nextScene.status = "generating_audio";
    saveAndPublish(project);

    try {
      const ttsConfig: TTSConfig = {
        ttsEngine: (settings.ttsEngine || "f5-tts") as "f5-tts" | "styletts2" | "piper" | "gemini-tts",
        ttsUrl: settings.ttsUrl || getDefaultTTSEngineUrl(settings.ttsEngine || "f5-tts"),
        voiceProfile: settings.voiceProfile || "natural_charles",
        voiceSpeed: settings.voiceSpeed || 1.0,
        voiceEmotion: settings.voiceEmotion || "neutral",
        geminiClient: getGeminiClient(),
      };

      const logFn = (msg: string) => {
        project.logs.push(msg);
        if (project.logs.length % 2 === 0) saveAndPublish(project);
      };

      const ttsResult = await synthesizeSpeech(nextScene.voiceText, ttsConfig, logFn);

      if (ttsResult.audioDataUrl) {
        nextScene.audioUrl = ttsResult.audioDataUrl;
        nextScene.audioDuration = ttsResult.durationSeconds;
        project.logs.push(`[TTS] Scene ${nextScene.sceneNumber} voice generated via ${ttsResult.engine} (${ttsResult.durationSeconds.toFixed(1)}s)`);
        saveAndPublish(project);
      }
    } catch (ttsErr: any) {
      project.logs.push(`[WARNING] TTS synthesis failed for scene ${nextScene.sceneNumber}: ${ttsErr.message}`);
      // Continue without audio — FFmpeg will add silent track
    }

    if (!nextScene.audioUrl) {
      nextScene.audioUrl = ""; // FFmpeg will generate silent audio
    }

    // 2. Image Generation (ComfyUI Workflow with proper polling & result retrieval)
    nextScene.status = "generating_image";
    saveAndPublish(project);

    let doneImage = false;
    if (settings.comfyUrl) {
      try {
        const comfyConfig: ComfyUIConfig = {
          comfyUrl: settings.comfyUrl,
          comfyCheckpoint: settings.comfyCheckpoint || "flux1-schnell.safetensors",
          comfyNegativePrompt: settings.comfyNegativePrompt || "low quality, blurry, watermark, text overlay, deformed, ugly, bad anatomy",
          workflowTemplate: settings.workflowTemplate,
          wanMode: settings.wanMode as "i2v" | "t2v",
          wanResolution: settings.wanResolution as "16:9" | "9:16",
          wanSteps: settings.wanSteps,
          wanCfg: settings.wanCfg,
          wanFrames: settings.wanFrames,
          wanMotionIntensity: settings.wanMotionIntensity,
          aspectRatio: project.aspectRatio,
          comfyLora: settings.comfyLora || "",
          comfyLoraStrength: settings.comfyLoraStrength || 1.0,
          comfySampler: settings.comfySampler || "euler",
          comfyScheduler: settings.comfyScheduler || "normal",
          comfySteps: settings.comfySteps || 20,
          comfyCfg: settings.comfyCfg || 3.5,
        };

        const logFn = (msg: string) => {
          project.logs.push(msg);
          saveAndPublish(project);
        };

        // Create project-specific output directory for disk storage
        const projectOutputDir = path.join(COMFYUI_OUTPUT_DIR, project.id);

        const genResult = await comfyGenerateImage(
          comfyConfig,
          nextScene.visualPrompt,
          logFn,
          undefined, // seed
          projectOutputDir // save to disk too
        );

        if (genResult.dataUrl) {
          nextScene.imageBase64 = genResult.dataUrl;
          doneImage = true;
          if (genResult.filePath) {
            nextScene.imagePath = genResult.filePath;
            project.logs.push(`[COMFYUI] Scene ${nextScene.sceneNumber} image generated and saved to: ${genResult.filePath}`);
          } else {
            project.logs.push(`[COMFYUI] Scene ${nextScene.sceneNumber} image generated successfully via ComfyUI!`);
          }
          saveAndPublish(project);
        } else {
          project.logs.push(`[WARNING] ComfyUI returned no image output. Falling back to procedural SVG.`);
        }
      } catch (err: any) {
        console.warn(`ComfyUI image generation failed for scene ${nextScene.sceneNumber}:`, err.message);
        project.logs.push(`[WARNING] ComfyUI image generation failed: ${err.message}. Using SVG placeholder.`);
        saveAndPublish(project);
      }
    }

    if (!doneImage) {
      // Fallback: Generate stunning responsive procedural visual representing the director prompt
      const svg = generateProceduralSceneSvg(nextScene.visualPrompt, nextScene.sceneNumber, project.aspectRatio === "9:16");
      nextScene.imageBase64 = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
      project.logs.push(`[PLACEHOLDER] Scene ${nextScene.sceneNumber} using procedural SVG placeholder.`);
      saveAndPublish(project);
    }

    // 3. WAN 2.2 Local Motion Animation clip generator (I2V via ComfyUI)
    nextScene.status = "generating_video";
    saveAndPublish(project);

    let doneVideo = false;
    if (settings.comfyUrl && nextScene.imageBase64) {
      try {
        const comfyConfig: ComfyUIConfig = {
          comfyUrl: settings.comfyUrl,
          comfyCheckpoint: settings.comfyCheckpoint || "flux1-schnell.safetensors",
          comfyNegativePrompt: settings.comfyNegativePrompt || "low quality, blurry, static, no motion",
          workflowTemplate: settings.workflowTemplate,
          wanMode: settings.wanMode as "i2v" | "t2v",
          wanResolution: settings.wanResolution as "16:9" | "9:16",
          wanSteps: settings.wanSteps,
          wanCfg: settings.wanCfg,
          wanFrames: settings.wanFrames,
          wanMotionIntensity: settings.wanMotionIntensity,
          aspectRatio: project.aspectRatio,
          comfyLora: settings.comfyLora || "",
          comfyLoraStrength: settings.comfyLoraStrength || 1.0,
          comfySampler: settings.comfySampler || "euler",
          comfyScheduler: settings.comfyScheduler || "normal",
          comfySteps: settings.comfySteps || 20,
          comfyCfg: settings.comfyCfg || 3.5,
        };

        const logFn = (msg: string) => {
          project.logs.push(msg);
          saveAndPublish(project);
        };

        // Only attempt WAN 2.2 I2V if we have a real image (not SVG placeholder)
        const isSvgPlaceholder = nextScene.imageBase64?.startsWith("data:image/svg+xml");
        if (!isSvgPlaceholder) {
          const videoDataUrl = await comfyGenerateVideo(
            comfyConfig,
            nextScene.motionPrompt,
            nextScene.imageBase64!,
            logFn
          );

          if (videoDataUrl) {
            nextScene.videoUrl = videoDataUrl;
            doneVideo = true;
            project.logs.push(`[COMFYUI WAN] Scene ${nextScene.sceneNumber} video generated successfully via WAN 2.2 I2V!`);
            saveAndPublish(project);
          } else {
            project.logs.push(`[WARNING] ComfyUI WAN 2.2 returned no video output. CSS Ken Burns motion will be used as fallback.`);
          }
        } else {
          project.logs.push(`[INFO] Scene ${nextScene.sceneNumber} using SVG placeholder — skipping WAN 2.2 I2V. CSS Ken Burns motion will be applied by the Cinema Player.`);
        }
      } catch (err: any) {
        console.warn(`ComfyUI WAN 2.2 video generation failed for scene ${nextScene.sceneNumber}:`, err.message);
        project.logs.push(`[WARNING] WAN 2.2 I2V failed: ${err.message}. CSS Ken Burns motion will be used as fallback.`);
        saveAndPublish(project);
      }
    } else {
      if (!settings.comfyUrl) {
        project.logs.push(`[INFO] ComfyUI URL not configured — skipping WAN 2.2 I2V. CSS Ken Burns motion will be used.`);
      } else if (!nextScene.imageBase64) {
        project.logs.push(`[INFO] No input image available — skipping WAN 2.2 I2V.`);
      }
    }

    if (!doneVideo && !nextScene.videoUrl) {
      nextScene.videoUrl = ""; // Cinema Player will apply CSS Ken Burns animation
    }

    // Update scene status to completed
    nextScene.status = "completed";
    project.logs.push(`[ASSETS READY] Scene ${nextScene.sceneNumber} compiled assets successfully.`);
    saveAndPublish(project);
    return;
  }

  if (project.status === "assembling") {
    project.logs.push(`[SYSTEM] Video Editor engine packaging files together...`);
    project.currentStepMessage = "Running FFmpeg compilation, generating thumbnail and subtitle alignment...";
    project.progress = 95;

    // Generate smart Metadata SEO description and high click-through Title options
    const metadataPrompt = `Task: Given the script, generate:
    1. A high CTR YouTube video title (under 60 chars)
    2. An engagement description filled with story context and SEO keywords
    3. 5 tags
    4. 3 hashtags
    
    Script Hook: "${project.script.hook}"
    Script Body: "${project.script.body}"
    Return clean JSON format:
    {
      "title": "...",
      "description": "...",
      "tags": ["...", "..."],
      "hashtags": ["#...", "#..."]
    }`;

    const rawResponse = await askLLM(
      metadataPrompt,
      "You are a YouTube Metadata and SEO optimizer. Provide ONLY clean valid JSON."
    );

    let metaObj = { title: "", description: "", tags: [], hashtags: [] };
    try {
      const cleanJSON = rawResponse.substring(rawResponse.indexOf("{"), rawResponse.lastIndexOf("}") + 1);
      metaObj = JSON.parse(cleanJSON);
    } catch (e) {
      metaObj = {
        title: `The Mystery of ${project.name}! (MUST WATCH)`,
        description: `Explore the secrets of ${project.topic}. We reveal the hidden facts that nobody wants to talk about. Check out the full breakdown and leave your thoughts below.`,
        tags: [project.topic, "faceless channel", "secrets revealed", "horror narrative", "project kiwul"],
        hashtags: ["#ProjectKiwul", "#Mystery", "#FacelessDoc"],
      };
    }

    project.metadata = metaObj;

    // Generate elegant subtitles subtitle SRT data based on scene timings (roughly 5-7 seconds per scene)
    let srtData = "";
    let timeIndex = 0;
    project.scenes.forEach((scene: any, index: number) => {
      const sceneDuration = 6; // approximate fallback timing
      const startSec = timeIndex;
      const endSec = timeIndex + sceneDuration;

      const formatTime = (secs: number) => {
        const h = Math.floor(secs / 3600).toString().padStart(2, "0");
        const m = Math.floor((secs % 3600) / 60).toString().padStart(2, "0");
        const s = Math.floor(secs % 60).toString().padStart(2, "0");
        const ms = "000";
        return `${h}:${m}:${s},${ms}`;
      };

      srtData += `${index + 1}\n`;
      srtData += `${formatTime(startSec)} --> ${formatTime(endSec)}\n`;
      srtData += `${scene.voiceText}\n\n`;

      timeIndex += sceneDuration;
    });

    project.subtitleSrt = srtData;

    // Thumbnail generation via ComfyUI (with SVG fallback)
    project.thumbnailPrompt = `Epic high-contrast YouTube thumbnail showing: ${project.scenes[0]?.visualPrompt || project.topic}, bold neon text "THE UNTOLD SINS", extremely highly detailed, RTX shadows`;

    let doneThumbnail = false;
    if (settings.comfyUrl) {
      try {
        const comfyConfig: ComfyUIConfig = {
          comfyUrl: settings.comfyUrl,
          comfyCheckpoint: settings.comfyCheckpoint || "flux1-schnell.safetensors",
          comfyNegativePrompt: settings.comfyNegativePrompt || "low quality, blurry, watermark, simple, plain",
          workflowTemplate: settings.workflowTemplate,
          wanMode: settings.wanMode as "i2v" | "t2v",
          wanResolution: settings.wanResolution as "16:9" | "9:16",
          wanSteps: settings.wanSteps,
          wanCfg: settings.wanCfg,
          wanFrames: settings.wanFrames,
          wanMotionIntensity: settings.wanMotionIntensity,
          aspectRatio: project.aspectRatio,
          comfyLora: settings.comfyLora || "",
          comfyLoraStrength: settings.comfyLoraStrength || 1.0,
          comfySampler: settings.comfySampler || "euler",
          comfyScheduler: settings.comfyScheduler || "normal",
          comfySteps: settings.comfySteps || 20,
          comfyCfg: settings.comfyCfg || 3.5,
        };

        const logFn = (msg: string) => {
          project.logs.push(msg);
          saveAndPublish(project);
        };

        const projectOutputDir = path.join(COMFYUI_OUTPUT_DIR, project.id);

        const thumbResult = await comfyGenerateImage(
          comfyConfig,
          project.thumbnailPrompt,
          logFn,
          undefined,
          projectOutputDir
        );

        if (thumbResult.dataUrl) {
          project.thumbnailUrl = thumbResult.dataUrl;
          doneThumbnail = true;
          project.logs.push(`[COMFYUI] Thumbnail generated successfully via ComfyUI!`);
        } else {
          project.logs.push(`[WARNING] ComfyUI returned no thumbnail output. Using SVG fallback.`);
        }
      } catch (err: any) {
        console.warn("ComfyUI thumbnail generation failed:", err.message);
        project.logs.push(`[WARNING] ComfyUI thumbnail generation failed: ${err.message}. Using SVG fallback.`);
      }
    }

    if (!doneThumbnail) {
      const svgThumb = generateProceduralSceneSvg(project.thumbnailPrompt, 99, project.aspectRatio === "9:16");
      project.thumbnailUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgThumb)}`;
      project.logs.push(`[PLACEHOLDER] Thumbnail using procedural SVG placeholder.`);
    }

    project.logs.push(`[THUMBNAIL] Created clickable visual asset.`);
    project.logs.push(`[SUBTITLES] Auto-aligned SRT transcription completed.`);

    // ── FFmpeg Video Assembly ────────────────────────────────────────────
    project.currentStepMessage = "Assembling video with FFmpeg...";
    saveAndPublish(project);

    // Check FFmpeg availability first
    const ffmpegStatus = await checkFFmpegAvailability();
    if (!ffmpegStatus.available) {
      project.logs.push(`[FFMPEG ERROR] FFmpeg not found on system! Video assembly skipped.`);
      project.logs.push(`[FFMPEG] Install FFmpeg and add it to your PATH to enable video assembly.`);
      project.status = "completed";
      project.progress = 100;
      project.currentStepMessage = "Video ready (no FFmpeg - slideshow only)";
      saveAndPublish(project);
      return;
    }

    project.logs.push(`[FFMPEG] FFmpeg ${ffmpegStatus.version} detected. Starting video assembly...`);
    saveAndPublish(project);

    try {
      // Prepare scene assets for FFmpeg
      const sceneAssets: FFmpegSceneAsset[] = project.scenes.map((scene: any) => ({
        sceneNumber: scene.sceneNumber,
        imagePath: scene.imagePath || null,
        imageBase64: scene.imageBase64 || null,
        audioBase64: scene.audioUrl || null,
        voiceText: scene.voiceText || "",
        durationSeconds: 0, // 0 = auto-detect from audio
        motionPrompt: scene.motionPrompt || "",
      }));

      const isVertical = project.aspectRatio === "9:16";
      const assemblyConfig: FFmpegAssemblyConfig = {
        outputDir: path.join(process.cwd(), "output", project.id),
        projectId: project.id,
        width: isVertical ? 720 : 1280,
        height: isVertical ? 1280 : 720,
        fps: 30,
        subtitleSrt: srtData,
        defaultSceneDuration: 6,
        enableKenBurns: true,
      };

      const logFn = (msg: string) => {
        project.logs.push(msg);
        // Only save to disk every few logs to avoid excessive I/O
        if (project.logs.length % 3 === 0) {
          saveAndPublish(project);
        }
      };

      const result = await assembleVideo(sceneAssets, assemblyConfig, logFn);

      // Store the final video path (relative to cwd for portability)
      const relativePath = path.relative(process.cwd(), result.outputPath);
      project.finalVideoUrl = `/api/projects/${project.id}/video`;
      project.finalVideoPath = result.outputPath;

      project.logs.push(`[FFMPEG COMPLETE] Video assembled successfully!`);
      project.logs.push(`[FFMPEG] Output: ${relativePath}`);
      project.logs.push(`[FFMPEG] Duration: ${result.durationSeconds.toFixed(1)}s | Size: ${(result.fileSizeBytes / 1024 / 1024).toFixed(1)} MB | Scenes: ${result.sceneCount}`);
    } catch (ffmpegErr: any) {
      console.error("FFmpeg assembly failed:", ffmpegErr.message);
      project.logs.push(`[FFMPEG ERROR] Video assembly failed: ${ffmpegErr.message}`);
      project.logs.push(`[FFMPEG] You can still view scenes as slideshow in the Cinema Player.`);
      // Don't fail the whole project - it's still "completed" without the video
    }

    project.status = "completed";
    project.progress = 100;
    project.currentStepMessage = project.finalVideoUrl
      ? "Video Ready to upload to YouTube!"
      : "Assets Ready (video assembly failed - slideshow mode)";
    saveAndPublish(project);
    return;
  }
}

function saveAndPublish(project: DBProject) {
  saveProject(project);
}

// REST Full API endpoints
app.get("/api/projects", (req, res) => {
  res.json(getAllProjects());
});

app.post("/api/projects", (req, res) => {
  const { topic, name, maxDuration, aspectRatio } = req.body;
  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }

  const projectId = `project_${Date.now()}`;
  const projectName = name || `Video: ${topic}`;
  
  dbCreateProject({
    id: projectId,
    name: projectName,
    topic: topic,
    maxDuration: maxDuration || "Auto",
    aspectRatio: aspectRatio || "16:9",
  });

  const newProject = getProjectById(projectId);
  res.json(newProject);
});

app.patch("/api/projects/:id", (req, res) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  // Update only allowed fields
  const allowedFields = ["name", "topic", "status", "currentStepMessage", "progress",
    "ideas", "selectedIdea", "script", "metadata", "thumbnailPrompt", "thumbnailUrl",
    "maxDuration", "aspectRatio", "voiceUrl", "subtitleSrt", "finalVideoUrl",
    "finalVideoPath", "atomicLines", "error"];
  const updates: Record<string, any> = {};
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }
  
  if (Object.keys(updates).length > 0) {
    updateProjectFields(req.params.id, updates);
  }
  
  // Handle scene updates if provided
  if (req.body.scenes) {
    project.scenes = req.body.scenes;
    saveProject(project);
  }
  
  const updatedProject = getProjectById(req.params.id);
  res.json(updatedProject);
});

app.post("/api/projects/:id/retry", (req, res) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  project.status = "researching";
  project.progress = 10;
  project.error = "";
  project.logs.push(`[USER] Triggered manual retry and reset of pipeline.`);
  
  saveProject(project);
  res.json(project);
});

app.delete("/api/projects/:id", (req, res) => {
  deleteProject(req.params.id);
  res.json({ success: true, message: "Project deleted" });
});

// Settings endpoints
app.get("/api/settings", (req, res) => {
  res.json(localSettings);
});

app.post("/api/settings", (req, res) => {
  localSettings = { ...localSettings, ...req.body };
  try {
    dbUpdateSettings(req.body);
  } catch (err) {
    console.error("Failed to write settings to database");
  }
  res.json({ success: true, settings: localSettings });
});

// Proxy route for local Ollama models list (for setting selections)
app.get("/api/ollama/models", async (req, res) => {
  try {
    const listRes = await fetch(`${localSettings.ollamaUrl}/api/tags`);
    if (listRes.ok) {
      const data = await listRes.json();
      res.json(data);
    } else {
      res.json({ models: [], msg: "Ollama online but returned bad status" });
    }
  } catch (err: any) {
    res.json({ models: [], msg: "Ollama offline or not listening: " + err.message });
  }
});

// Endpoint to check the active connection state of local AI services (Ollama and ComfyUI)
app.get("/api/check-connections", async (req, res) => {
  const status = {
    ollama: { ok: false, message: "Unchecked" },
    comfy: { ok: false, message: "Unchecked" },
    tts: { ok: false, message: "Unchecked" },
    ffmpeg: { ok: false, message: "Unchecked" },
  };

  try {
    // Probe Ollama base URL
    const targetOllama = localSettings.ollamaUrl || "http://localhost:11434";
    const ollamaCheck = await fetch(targetOllama, { signal: AbortSignal.timeout(3000) });
    if (ollamaCheck.ok) {
      status.ollama = { ok: true, message: `Connected to Ollama at ${targetOllama}` };
    } else {
      status.ollama = { ok: false, message: `Ollama returned status ${ollamaCheck.status}` };
    }
  } catch (err: any) {
    status.ollama = { ok: false, message: `Ollama offline or timed out: ${err.message}` };
  }

  try {
    // Probe ComfyUI using the improved connection check
    const targetComfy = localSettings.comfyUrl || "http://localhost:8188";
    const comfyResult = await comfyCheckConnection(targetComfy);
    status.comfy = comfyResult;
  } catch (err: any) {
    status.comfy = { ok: false, message: `ComfyUI offline or timed out: ${err.message}` };
  }

  // Check TTS engine availability
  try {
    const ttsEngine = localSettings.ttsEngine || "f5-tts";
    const ttsUrl = localSettings.ttsUrl || getDefaultTTSEngineUrl(ttsEngine);
    const ttsInfo = await checkTTSConnection(ttsEngine, ttsUrl);
    status.tts = {
      ok: ttsInfo.available,
      message: ttsInfo.available
        ? `${ttsInfo.name} connected at ${ttsUrl}`
        : `${ttsInfo.name} offline: ${ttsInfo.error || "Not reachable"}`,
    };
  } catch (err: any) {
    status.tts = { ok: false, message: `TTS check failed: ${err.message}` };
  }

  // Check FFmpeg availability
  try {
    const ffmpegInfo = await checkFFmpegAvailability();
    status.ffmpeg = {
      ok: ffmpegInfo.available,
      message: ffmpegInfo.available
        ? `FFmpeg ${ffmpegInfo.version} available`
        : "FFmpeg not found — install FFmpeg for video assembly",
    };
  } catch (err: any) {
    status.ffmpeg = { ok: false, message: `FFmpeg check failed: ${err.message}` };
  }

  res.json({ success: true, ...status });
});

// ComfyUI Checkpoint Discovery - list available model checkpoints
app.get("/api/comfyui/checkpoints", async (req, res) => {
  try {
    const targetComfy = localSettings.comfyUrl || "http://localhost:8188";
    const checkpoints = await comfyGetCheckpoints(targetComfy);
    res.json({ success: true, checkpoints });
  } catch (err: any) {
    res.json({ success: false, checkpoints: [], message: err.message });
  }
});

// ─── ComfyUI Extended API Endpoints ────────────────────────────────────────

// Get available UNET models (for FLUX unet-only format)
app.get("/api/comfyui/unet-models", async (req, res) => {
  try {
    const models = await comfyGetUNETModels(localSettings.comfyUrl);
    res.json({ models });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get available LoRA models
app.get("/api/comfyui/loras", async (req, res) => {
  try {
    const models = await comfyGetLoraModels(localSettings.comfyUrl);
    res.json({ models });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get available VAE models
app.get("/api/comfyui/vaes", async (req, res) => {
  try {
    const models = await comfyGetVAEModels(localSettings.comfyUrl);
    res.json({ models });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get available CLIP Vision models (for WAN I2V)
app.get("/api/comfyui/clip-vision", async (req, res) => {
  try {
    const models = await comfyGetClipVisionModels(localSettings.comfyUrl);
    res.json({ models });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Test ComfyUI generation
app.post("/api/comfyui/test-generate", async (req, res) => {
  const { checkpoint, workflowTemplate } = req.body;
  if (!localSettings.comfyUrl) {
    return res.status(400).json({ error: "ComfyUI URL not configured" });
  }

  try {
    const result = await comfyTestGeneration(
      localSettings.comfyUrl,
      checkpoint || localSettings.comfyCheckpoint,
      workflowTemplate || localSettings.workflowTemplate
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message, imageUrl: null, timeMs: 0 });
  }
});

// Cancel/interrupt running ComfyUI generation
app.post("/api/comfyui/interrupt", async (req, res) => {
  if (!localSettings.comfyUrl) {
    return res.status(400).json({ error: "ComfyUI URL not configured" });
  }

  try {
    const success = await comfyInterrupt(localSettings.comfyUrl);
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get ComfyUI output directory listing for a project
app.get("/api/comfyui/outputs/:projectId", (req, res) => {
  const projectDir = path.join(COMFYUI_OUTPUT_DIR, req.params.projectId);
  if (!fs.existsSync(projectDir)) {
    return res.json({ files: [] });
  }

  try {
    const files = fs.readdirSync(projectDir).map(filename => {
      const filePath = path.join(projectDir, filename);
      const stats = fs.statSync(filePath);
      return {
        filename,
        size: stats.size,
        createdAt: stats.birthtime,
      };
    });
    res.json({ files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── FFmpeg & Video Routes ──────────────────────────────────────────────────

// Check FFmpeg availability
app.get("/api/ffmpeg/status", async (_req, res) => {
  try {
    const status = await checkFFmpegAvailability();
    res.json(status);
  } catch (err: any) {
    res.json({ available: false, version: null, path: null, error: err.message });
  }
});

// Serve the final assembled video for a project (supports range requests for seeking)
app.get("/api/projects/:id/video", (req, res) => {
  const project = getProjectById(req.params.id);

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  // Try to find the video file from finalVideoPath or search the output directory
  let videoPath: string | null = project.finalVideoPath || null;

  if (!videoPath || !fs.existsSync(videoPath)) {
    // Search the output directory for the final video
    const outputDir = path.join(process.cwd(), "output", project.id, "final");
    if (fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir).filter(f => f.endsWith(".mp4"));
      if (files.length > 0) {
        videoPath = path.join(outputDir, files[0]);
      }
    }
  }

  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(404).json({ error: "Video file not found. Assembly may not have completed yet." });
  }

  // Stream the video file with proper headers for range requests (video seeking)
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const fileStream = fs.createReadStream(videoPath, { start, end });
    const head = {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": "video/mp4",
    };

    res.writeHead(206, head);
    fileStream.pipe(res);
  } else {
    const head = {
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
    };
    res.writeHead(200, head);
    fs.createReadStream(videoPath).pipe(res);
  }
});

// Download the final video file
app.get("/api/projects/:id/video/download", (req, res) => {
  const project = getProjectById(req.params.id);

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  let videoPath: string | null = project.finalVideoPath || null;

  if (!videoPath || !fs.existsSync(videoPath)) {
    const outputDir = path.join(process.cwd(), "output", project.id, "final");
    if (fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir).filter(f => f.endsWith(".mp4"));
      if (files.length > 0) {
        videoPath = path.join(outputDir, files[0]);
      }
    }
  }

  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(404).json({ error: "Video file not found" });
  }

  const fileName = `${project.name || project.id}_final.mp4`.replace(/[^a-zA-Z0-9_-]/g, "_");
  res.download(videoPath, fileName);
});

// ── TTS Routes ──────────────────────────────────────────────────────────────

// Check all available TTS engines
app.get("/api/tts/engines", async (_req, res) => {
  try {
    const engines = await checkAllTTSEngines();
    res.json({ engines });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Check specific TTS engine connection
app.get("/api/tts/check", async (req, res) => {
  const engine = (req.query.engine as string) || localSettings.ttsEngine || "f5-tts";
  const url = (req.query.url as string) || localSettings.ttsUrl || getDefaultTTSEngineUrl(engine);
  try {
    const info = await checkTTSConnection(engine, url);
    res.json(info);
  } catch (err: any) {
    res.json({ name: engine, available: false, url, error: err.message });
  }
});

// Test TTS synthesis with a short sample
app.post("/api/tts/test", async (req, res) => {
  const { text, engine, voiceProfile, speed } = req.body;
  const ttsEngine = engine || localSettings.ttsEngine || "f5-tts";
  const ttsUrl = localSettings.ttsUrl || getDefaultTTSEngineUrl(ttsEngine);

  try {
    const ttsConfig: TTSConfig = {
      ttsEngine,
      ttsUrl,
      voiceProfile: voiceProfile || localSettings.voiceProfile || "natural_charles",
      voiceSpeed: speed || localSettings.voiceSpeed || 1.0,
      voiceEmotion: localSettings.voiceEmotion || "neutral",
      geminiClient: getGeminiClient(),
    };

    const sampleText = text || "Hello, this is a test of the text to speech system.";
    const result = await synthesizeSpeech(sampleText, ttsConfig);

    res.json({
      success: true,
      engine: result.engine,
      durationSeconds: result.durationSeconds,
      audioDataUrlLength: result.audioDataUrl.length,
    });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

// Vite server setup & Fallbacks
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[KIWUL FACTORY] Server running dynamically on http://localhost:${PORT}`);
  });
}

startServer();
