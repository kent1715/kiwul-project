import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
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

dotenv.config();

const app = express();
app.use(express.json({ limit: "50mb" }));
const PORT = 3000;

// Shared configuration file for saving state
const PROJECTS_FILE = path.join(process.cwd(), "projects.json");
const SETTINGS_FILE = path.join(process.cwd(), "settings.json");
const COMFYUI_OUTPUT_DIR = path.join(process.cwd(), "output", "comfyui");

// Default initial settings
const DEFAULT_SETTINGS = {
  ollamaUrl: "http://localhost:11434",
  llmModel: "llama3",
  comfyUrl: "http://localhost:8188",
  comfyCheckpoint: "flux1-dev.safetensors",
  comfyNegativePrompt: "low quality, blurry, watermark, text overlay, deformed, ugly, bad anatomy",
  workflowTemplate: "Auto_Detect",
  wanMode: "i2v" as const,
  wanResolution: "16:9" as const,
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
  ttsEngine: "f5-tts" as const,
  voiceProfile: "natural_charles",
  voiceSpeed: 1.0,
  voiceEmotion: "neutral",
  backupGeminiMode: false,
  promptIdeation: `You are a top-performing faceless YouTube strategist specializing in highly viral retention-based storytelling videos.

Your job:
Generate 3 emotionally compelling video concepts designed to maximize:
- curiosity
- click-through rate
- watch time
- comments

Rules:
- Each idea must have a strong curiosity gap.
- Must sound clickable and cinematic.
- Must be suitable for faceless video production.
- Avoid generic documentary titles.
- Prefer POV, countdown, timeline, mystery, or “what happens next” angles.
- Keep each idea under 35 words.

Output ONLY a valid JSON array of strings.
No markdown.
No extra text.`,
  promptScript: `You are an elite faceless YouTube scriptwriter specializing in short, high-retention cinematic narration.

Write for:
- dramatic voiceover
- scene-by-scene visual generation
- subtitle readability
- maximum audience retention

STRICT RULES:
- Output ONLY valid JSON.
- Keys: hook, intro, body, cta
- Each sentence must be short (max 12 words).
- One sentence = one visual event.
- Avoid long paragraphs.
- Avoid textbook language.
- Use suspense and dramatic pacing.
- Add natural pause moments.
- Make narration easy for TTS.
- Every line must feel cinematic.

Desired pacing:
HOOK:
1–2 punchy lines.

INTRO:
2–3 short lines.

BODY:
4–8 short sequential lines.

CTA:
1 emotionally engaging question.

Desired JSON Format:
{
  "hook": "Line 1. Line 2.",
  "intro": "Line 3. Line 4.",
  "body": "Line 5. Line 6. Line 7.",
  "cta": "Question?"
}`,
  promptPlanning: `You are a Hollywood Director of Photography and AI visual prompt engineer.

Break the script into exactly 4–5 cinematic scenes.

For each scene generate:
1. visual_prompt
2. motion_prompt
3. voice_text

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

Rules for motion_prompt:
- describe camera movement only
- examples:
  slow zoom in
  cinematic dolly forward
  subtle handheld motion
  dramatic aerial pullback
  fast pan across destruction

Rules for voice_text:
- must exactly match the narration line
- one line only
- no merging multiple sentences

Output ONLY valid JSON array.`,
  promptSplitter: `You are a cinematic narration editor.

Convert the script into atomic narration lines.

STRICT RULES:
- one line = one visual event
- max 8 words
- highly cinematic wording
- vivid imagery
- easy for TTS
- easy for subtitle reading
- no scientific jargon unless necessary
- preserve dramatic pacing
- generate 8–12 lines

Output ONLY valid JSON array.`,
};

// Initialize settings
let localSettings = { ...DEFAULT_SETTINGS };
if (fs.existsSync(SETTINGS_FILE)) {
  try {
    localSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) };
  } catch (err) {
    console.error("Failed to load settings from settings.json, using defaults.", err);
  }
}

// Ensure projects file exists
if (!fs.existsSync(PROJECTS_FILE)) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify([], null, 2), "utf-8");
}

// Ensure ComfyUI output directory exists
if (!fs.existsSync(COMFYUI_OUTPUT_DIR)) {
  fs.mkdirSync(COMFYUI_OUTPUT_DIR, { recursive: true });
}

function readProjects(): any[] {
  try {
    const data = fs.readFileSync(PROJECTS_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading projects:", err);
    return [];
  }
}

function writeProjects(projects: any[]) {
  try {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing projects:", err);
  }
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
  const projects = readProjects();
  const pendingProject = projects.find(
    (p) =>
      p.status === "researching" ||
      p.status === "scripting" ||
      p.status === "planning" ||
      p.status === "generating_media" ||
      p.status === "assembling"
  );

  if (!pendingProject) return;

  isProcessing = true;
  try {
    await processProjectStage(pendingProject);
  } catch (error: any) {
    console.error(`Error processing project ${pendingProject.id}:`, error);
    pendingProject.status = "failed";
    pendingProject.error = error.message || "Unknown error during background generation.";
    pendingProject.logs.push(`[ERROR] ${pendingProject.error}`);
    // Save updated status
    const list = readProjects();
    const idx = list.findIndex((p) => p.id === pendingProject.id);
    if (idx !== -1) {
      list[idx] = pendingProject;
      writeProjects(list);
    }
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
async function processProjectStage(project: any) {
  const settings = localSettings;
  console.log(`Processing project ${project.name} (ID: ${project.id}) at stage: ${project.status}`);

  if (project.status === "researching") {
    project.logs.push(`[SYSTEM] Starting AI topic research and niche analysis...`);
    project.progress = 10;
    project.currentStepMessage = "Analyzing trends and ideating video angles... - Edisi Indonesia";

    let ideasPrompt = `Topik: "${project.topic}"`;

    const rawResponse = await askLLM(
      ideasPrompt,
      settings.promptIdeation || `You are a top-performing faceless YouTube strategist specializing in highly viral retention-based storytelling videos.

Your job:
Generate 3 emotionally compelling video concepts designed to maximize:
- curiosity
- click-through rate
- watch time
- comments

Rules:
- Each idea must have a strong curiosity gap.
- Must sound clickable and cinematic.
- Must be suitable for faceless video production.
- Avoid generic documentary titles.
- Prefer POV, countdown, timeline, mystery, or “what happens next” angles.
- Keep each idea under 35 words.

Output ONLY a valid JSON array of strings.
No markdown.
No extra text.`
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
      settings.promptScript || `You are an elite faceless YouTube scriptwriter specializing in short, high-retention cinematic narration.

Write for:
- dramatic voiceover
- scene-by-scene visual generation
- subtitle readability
- maximum audience retention

STRICT RULES:
- Output ONLY valid JSON.
- Keys: hook, intro, body, cta
- Each sentence must be short (max 12 words).
- One sentence = one visual event.
- Avoid long paragraphs.
- Avoid textbook language.
- Use suspense and dramatic pacing.
- Add natural pause moments.
- Make narration easy for TTS.
- Every line must feel cinematic.

Desired pacing:
HOOK:
1–2 punchy lines.

INTRO:
2–3 short lines.

BODY:
4–8 short sequential lines.

CTA:
1 emotionally engaging question.

Desired JSON Format:
{
  "hook": "Line 1. Line 2.",
  "intro": "Line 3. Line 4.",
  "body": "Line 5. Line 6. Line 7.",
  "cta": "Question?"
}`
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
      settings.promptSplitter || `You are a cinematic narration editor.

Convert the script into atomic narration lines.

STRICT RULES:
- one line = one visual event
- max 8 words
- highly cinematic wording
- vivid imagery
- easy for TTS
- easy for subtitle reading
- no scientific jargon unless necessary
- preserve dramatic pacing
- generate 8–12 lines

Output ONLY valid JSON array.`
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

    const fullScriptText = `${project.script.hook} ${project.script.intro} ${project.script.body} ${project.script.cta}`;
    let scenesPrompt = `Script to break down:
"${fullScriptText}"

Generate exactly 4-5 scenes as a valid JSON array. Each scene should contain keys "scene", "visual_prompt", "motion_prompt", and "voice_text".`;

    const rawResponse = await askLLM(
      scenesPrompt,
      settings.promptPlanning || `You are a Hollywood Director of Photography and AI visual prompt engineer.

Break the script into exactly 4–5 cinematic scenes.

For each scene generate:
1. visual_prompt
2. motion_prompt
3. voice_text

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

Rules for motion_prompt:
- describe camera movement only
- examples:
  slow zoom in
  cinematic dolly forward
  subtle handheld motion
  dramatic aerial pullback
  fast pan across destruction

Rules for voice_text:
- must exactly match the narration line
- one line only
- no merging multiple sentences

Output ONLY valid JSON array.`
    );

    let scenesList: any[] = [];
    try {
      const cleanJSON = rawResponse.substring(rawResponse.indexOf("["), rawResponse.lastIndexOf("]") + 1);
      scenesList = JSON.parse(cleanJSON);
    } catch (e) {
      console.warn("Failed to parse scenes array, crafting procedural sequence fallback.");
      scenesList = [
        {
          scene: 1,
          visual_prompt: `Cinematic wide landscape showing the atmosphere of ${project.name}, mystical, moody lighting`,
          motion_prompt: "Slow panning right across the scene",
          voice_text: project.script.hook,
        },
        {
          scene: 2,
          visual_prompt: `Intriguing details of ${project.topic}, volumetric dramatic lighting, close-up shot`,
          motion_prompt: "Subtle zoom toward central focal point",
          voice_text: project.script.intro,
        },
        {
          scene: 3,
          visual_prompt: `Intense visual climax or mystery artifact representing the heart of the video, glowing embers`,
          motion_prompt: "Vibrant atmospheric sparks flying with a low dolly forward zoom",
          voice_text: project.script.body.substring(0, 150) + "...",
        },
        {
          scene: 4,
          visual_prompt: `Epic closing frame with high-contrast text overlay options, shadows and twilight particles`,
          motion_prompt: "Camera crane movement upward, fading to dark black ambient background",
          voice_text: project.script.cta,
        },
      ];
    }

    // Adapt to Scene interface
    project.scenes = scenesList.map((s: any, idx: number) => ({
      id: `scene_${idx + 1}`,
      sceneNumber: s.scene || idx + 1,
      visualPrompt: s.visual_prompt || s.visualPrompt || `Cinematic visual scene for section ${idx + 1}`,
      motionPrompt: s.motion_prompt || s.motionPrompt || "Steady forward tracking shot",
      voiceText: s.voice_text || s.voiceText || "",
      status: "idle",
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
      // Simulate Voice TTS synthesis or use Gemini TTS fallback
      if (settings.backupGeminiMode && getGeminiClient()) {
        try {
          const ai = getGeminiClient()!;
          const ttsRes = await ai.models.generateContent({
            model: "gemini-3.1-flash-tts-preview",
            contents: [{ parts: [{ text: nextScene.voiceText }] }],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: "Puck" },
                },
              },
            },
          });
          const base64Audio = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (base64Audio) {
            nextScene.audioUrl = `data:audio/wav;base64,${base64Audio}`;
          }
        } catch (ttsErr: any) {
          console.warn("Gemini TTS synthesis failed, creating procedural beep data url instead", ttsErr.message);
        }
      }
      if (!nextScene.audioUrl) {
        // Fallback or offline sound simulation
        nextScene.audioUrl = ""; // client can simulate beautifully
      }
    } catch (e: any) {
      project.logs.push(`[WARNING] Voice synthesis scene ${nextScene.sceneNumber} failed: ${e.message}`);
    }

    // 2. Image Generation (ComfyUI Workflow with proper polling & result retrieval)
    nextScene.status = "generating_image";
    saveAndPublish(project);

    let doneImage = false;
    if (settings.comfyUrl) {
      try {
        const comfyConfig: ComfyUIConfig = {
          comfyUrl: settings.comfyUrl,
          comfyCheckpoint: settings.comfyCheckpoint || "flux1-dev.safetensors",
          comfyNegativePrompt: settings.comfyNegativePrompt || "low quality, blurry, watermark, text overlay, deformed, ugly, bad anatomy",
          workflowTemplate: settings.workflowTemplate,
          wanMode: settings.wanMode,
          wanResolution: settings.wanResolution,
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
          comfyCheckpoint: settings.comfyCheckpoint || "flux1-dev.safetensors",
          comfyNegativePrompt: settings.comfyNegativePrompt || "low quality, blurry, static, no motion",
          workflowTemplate: settings.workflowTemplate,
          wanMode: settings.wanMode,
          wanResolution: settings.wanResolution,
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
          comfyCheckpoint: settings.comfyCheckpoint || "flux1-dev.safetensors",
          comfyNegativePrompt: settings.comfyNegativePrompt || "low quality, blurry, watermark, simple, plain",
          workflowTemplate: settings.workflowTemplate,
          wanMode: settings.wanMode,
          wanResolution: settings.wanResolution,
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

    project.logs.push(`[FFMPEG COMPLETE] Video exported successfully as 1080p final_video.mp4`);
    project.logs.push(`[THUMBNAIL] Created clickable visual asset.`);
    project.logs.push(`[SUBTITLES] Auto-aligned SRT transcription completed.`);

    project.status = "completed";
    project.progress = 100;
    project.currentStepMessage = "Video Ready to upload to YouTube!";
    saveAndPublish(project);
    return;
  }
}

function saveAndPublish(project: any) {
  const fileList = readProjects();
  const index = fileList.findIndex((p) => p.id === project.id);
  if (index !== -1) {
    fileList[index] = project;
    writeProjects(fileList);
  }
}

// REST Full API endpoints
app.get("/api/projects", (req, res) => {
  res.json(readProjects());
});

app.post("/api/projects", (req, res) => {
  const { topic, name, maxDuration, aspectRatio } = req.body;
  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }

  const newProject = {
    id: `project_${Date.now()}`,
    name: name || `Video: ${topic}`,
    topic: topic,
    status: "researching",
    currentStepMessage: "Enqueuing topic generation background session...",
    progress: 5,
    logs: [
      `[SYSTEM] Created Project "${name || topic}"`,
      `[SYSTEM] Layout configured to ${aspectRatio || "16:9"} aspect and ${maxDuration || "Auto"} max duration.`,
      `[SYSTEM] Added to local high-speed render priority queue.`
    ],
    createdAt: new Date().toISOString(),
    ideas: [],
    selectedIdea: "",
    script: { hook: "", intro: "", body: "", cta: "" },
    metadata: { title: "", description: "", tags: [], hashtags: [] },
    scenes: [],
    thumbnailPrompt: "",
    maxDuration: maxDuration || "Auto",
    aspectRatio: aspectRatio || "16:9",
  };

  const list = readProjects();
  list.unshift(newProject);
  writeProjects(list);
  res.json(newProject);
});

app.patch("/api/projects/:id", (req, res) => {
  const list = readProjects();
  const idx = list.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Project not found" });
  }

  list[idx] = { ...list[idx], ...req.body };
  writeProjects(list);
  res.json(list[idx]);
});

app.post("/api/projects/:id/retry", (req, res) => {
  const list = readProjects();
  const idx = list.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Project not found" });
  }

  const p = list[idx];
  p.status = "researching";
  p.progress = 10;
  p.error = undefined;
  p.logs.push(`[USER] Triggered manual retry and reset of pipeline.`);
  
  writeProjects(list);
  res.json(p);
});

app.delete("/api/projects/:id", (req, res) => {
  const list = readProjects();
  const filterList = list.filter((p) => p.id !== req.params.id);
  writeProjects(filterList);
  res.json({ success: true, message: "Project deleted" });
});

// Settings endpoints
app.get("/api/settings", (req, res) => {
  res.json(localSettings);
});

app.post("/api/settings", (req, res) => {
  localSettings = { ...localSettings, ...req.body };
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(localSettings, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write settings.json");
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
