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
  generateLtxVideo as comfyGenerateLtxVideo,
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
  mergeVideoAudio,
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

// ─── Crash Prevention: Global error handlers ──────────────────────────────────
// These prevent the server from dying on unhandled promise rejections or exceptions.
// Instead, errors are logged and the server continues running.
process.on("uncaughtException", (err: Error) => {
  console.error(`[CRITICAL] Uncaught Exception (server staying alive):`, err.message);
  console.error(err.stack);
});

process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
  console.error(`[CRITICAL] Unhandled Promise Rejection (server staying alive):`, reason);
});

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
  comfyCheckpoint: "sdxl_lightning_4step.safetensors",
  comfyNegativePrompt: "low quality, blurry, watermark, text overlay, deformed, ugly, bad anatomy",
  workflowTemplate: "Auto_Detect",
  wanUrl: "http://localhost:7860",
  motionEngine: "wan_i2v",
  wanMode: "i2v",
  wanResolution: "16:9",
  wanSteps: 20,
  wanCfg: 6.0,
  wanFrames: 81,
  wanMotionIntensity: 7,
  wanCheckpoint: "wan2.2_i2v_480p.safetensors",
  ltxSteps: 20,
  ltxCfg: 4.0,
  ltxFrames: 97,
  ltxFps: 24,
  ltxWorkflowPath: "",
  comfyLora: "",
  comfyLoraStrength: 1.0,
  comfySampler: "euler",
  comfyScheduler: "normal",
  comfySteps: 20,
  comfyCfg: 3.5,
  ttsEngine: "f5-tts",
  ttsUrl: "http://127.0.0.1:5050",
  voiceProfile: "natural_charles",
  voiceSpeed: 1.0,
  voiceEmotion: "neutral",
  refAudio: "",
  refText: "",
  voiceCloningEnabled: false,
  backupGeminiMode: false,
  promptIdeation: `You are a top-performing faceless YouTube strategist specializing in viral retention storytelling for Indonesian audiences.

TASK:
Generate 3 highly clickable short-form video concepts based on the given topic.

LANGUAGE RULE:
- All output must be in natural Indonesian.
- Do not use English titles or English prefixes.
- Do not use labels like "Viral Concept", "Nostalgic", "Documentary", or "Absolute Secrets Unveiled".

CORE GOAL:
Create 3 ideas that make viewers instantly curious and want to watch until the end.

IDEA REQUIREMENTS:
Each idea must:
- feel cinematic
- have a strong curiosity gap
- have a clear disaster / mystery / what-if / survival angle
- be easy to visualize scene by scene
- have escalation potential
- have a strong ending payoff or twist
- be suitable for AI-generated faceless videos

PREFERRED ANGLES:
- "Apa yang terjadi jika..."
- "POV..."
- "Hitung mundur..."
- "Dalam X menit..."
- "Hari pertama saat..."
- "Detik-detik setelah..."
- "Bagaimana dunia berubah ketika..."

AVOID:
- generic educational ideas
- vague poetry
- flat documentary phrasing
- abstract concepts without visible consequences
- repetitive titles
- ideas that are hard to visualize

OUTPUT FORMAT:
Return ONLY valid JSON object with this exact structure:
{
  "ideas": [
    {
      "title": "...",
      "hook": "...",
      "core_question": "...",
      "story_angle": "...",
      "escalation_path": "...",
      "final_payoff": "..."
    },
    {
      "title": "...",
      "hook": "...",
      "core_question": "...",
      "story_angle": "...",
      "escalation_path": "...",
      "final_payoff": "..."
    },
    {
      "title": "...",
      "hook": "...",
      "core_question": "...",
      "story_angle": "...",
      "escalation_path": "...",
      "final_payoff": "..."
    }
  ]
}

QUALITY RULES:
- Each title must be strong and clickable.
- Each hook must create instant tension or curiosity.
- Each idea must feel different from the others.
- Make the best idea feel like a mini-movie, not just a topic.
- Prioritize ideas with strong visual storytelling potential.

No markdown. No explanation. No triple-backtick json. No text before or after JSON.`,
  promptScript: `You are an elite faceless YouTube scriptwriter specializing in high-retention cinematic narration for short-form AI videos.

TASK:
Write a cinematic narration script based on the selected concept.

LANGUAGE RULE:
- All narration MUST be in natural Indonesian.
- No English narration.
- Make the language dramatic, clear, visual, and easy for TTS.

OUTPUT FORMAT:
Return ONLY a valid JSON object with these keys:
- hook
- intro
- body
- cta

STRUCTURE RULES:

HOOK:
- 1-2 short sentences
- must create immediate curiosity, danger, or shock
- must make the viewer want to continue

INTRO:
- 2-3 short sentences
- quickly establish the scenario
- clarify the strange event or disaster premise
- raise tension immediately

BODY:
- 6-10 short sentences
- each sentence must describe ONE concrete visual event
- progressive escalation is mandatory
- every line must push the story forward
- prefer chronological progression:
  detik -> menit -> jam -> akibat
- show cause and effect clearly
- include visible consequences in the world, environment, or people

CTA:
- 1 emotionally engaging question
- must feel natural
- designed to trigger comments
- should make the viewer imagine themselves inside the scenario

WRITING RULES:
- Every sentence must be short and punchy.
- Maximum 12 words per sentence.
- One sentence = one visual event.
- Use concrete visuals, not abstract drama.
- Make every sentence easy to animate visually.
- Make every sentence easy to read as subtitles.
- Avoid academic language.
- Avoid robotic wording.
- Avoid filler.
- Avoid overusing vague lines such as:
  "semuanya berubah"
  "kiamat datang"
  "misteri semakin dalam"
  "dunia kacau"
  unless tied to a visible event.

IMPORTANT:
Each line should answer at least one of these:
- what is happening?
- who is affected?
- what changed visually?
- what danger is visible?
- what happens next?

GOOD EXAMPLES:
- Orang-orang jatuh sambil memegangi leher mereka.
- Mobil berhenti di tengah jalan tanpa pengemudi sadar.
- Langit mendadak pucat dan sunyi.
- Pesawat mulai kehilangan kendali di udara.

BAD EXAMPLES:
- Dunia kacau.
- Semuanya berubah.
- Kiamat datang.
- Misteri dimulai.

STYLE:
- cinematic
- suspenseful
- immersive
- visual
- emotionally intense
- grounded enough to visualize
- optimized for faceless YouTube videos

Return ONLY valid JSON.
No markdown.
No explanations.`,
  promptPlanning: `You are a Hollywood Director of Photography and AI visual prompt engineer.

TASK:
Break the atomic narration lines into cinematic scenes.

CRITICAL INPUT:
You will receive a JSON array of atomic narration lines.
Create exactly one scene per narration line.

For each scene generate:
1. visual_prompt
2. motion_prompt
3. voice_text

LANGUAGE RULE:
- voice_text must remain in Indonesian exactly as given
- visual_prompt and motion_prompt should be written in English for better image/video model performance

VISUAL CONTINUITY RULES:
Maintain continuity whenever relevant:
- same world logic
- same time progression
- same disaster progression
- same recurring subject if present
- same environment style if scenes are connected

VISUAL PROMPT GOAL:
Each visual_prompt must feel like a complete cinematic frame, not a generic decoration.

VISUAL PROMPT RULES:
- highly cinematic
- realistic
- photorealistic
- physically believable
- emotionally intense
- visually specific
- suitable for SDXL / FLUX / LTX / WAN pipelines
- no text overlays
- no watermark
- no logos

Every visual_prompt MUST explicitly include:
1. main subject
2. exact location
3. visible action
4. important foreground details
5. important background details
6. lighting
7. mood
8. camera angle / composition
9. realism/style quality

IMPORTANT:
Do NOT write generic prompts like:
- "Cinematic visual scene: ..."
- "Beautiful dramatic scene"
- "Epic composition"
- "Richly textured environment"
unless they are followed by concrete specific details.

Each visual_prompt must be specific and scene-based.

EXAMPLE OF GOOD VISUAL THINKING:
If the line is:
"Orang-orang memegangi leher mereka"
the visual should show:
crowded street, people collapsing, panic, hand-to-throat gestures, vehicles stopped, harsh daylight, realistic human emotion

MOTION PROMPT RULES:
- describe camera movement only
- describe motion style based on scene emotion
- keep motion realistic
- avoid repeating the same movement every time
- avoid overcomplicated motion
- motion should support the scene, not overpower it

MOTION VARIETY GUIDE:
Use different motion depending on scene type:

For shock / realization:
- slow urgent push-in
- subtle handheld push-in
- restrained forward drift

For panic / running / chaos:
- shoulder-level tracking
- fast side tracking
- unstable follow motion
- urgent handheld movement

For eerie silence / aftermath:
- slow lateral drift
- gentle pullback
- still observational glide

For destruction / scale reveal:
- aerial retreat
- rising crane pullback
- wide cinematic pullback

For emotional close-up:
- intimate slow push-in
- subtle locked-off tremor
- gentle close drift

Do NOT repeat the same motion for every scene.

VOICE TEXT RULES:
- must exactly match the narration line
- one line only
- no rewriting
- no merging
- no paraphrasing

OUTPUT FORMAT:
Return ONLY valid JSON array.

Use this structure:
[
  {
    "scene": 1,
    "visual_prompt": "...",
    "motion_prompt": "...",
    "voice_text": "..."
  }
]

FINAL QUALITY RULES:
- one narration line = one scene
- visual_prompt must be concrete, not abstract
- motion_prompt must fit the emotion of the scene
- every scene must be easy to generate visually
- prioritize realism, clarity, and retention value`,
  promptSplitter: `You are a cinematic narration editor for AI-generated faceless videos.

TASK:
Convert the full narration script into atomic narration lines for scene-by-scene generation.

LANGUAGE RULE:
- Output must be in natural Indonesian.
- Keep the meaning faithful to the original script.

STRICT OUTPUT FORMAT:
Return ONLY a valid JSON array of strings.

CORE GOAL:
Create short atomic lines where each line represents exactly ONE visual moment.

STRICT RULES:
- one line = one visual event
- each line should be easy to visualize
- each line should be easy for TTS
- each line should be easy for subtitles
- keep dramatic pacing
- keep original story order
- preserve escalation
- preserve time progression if present
- preserve important cause-effect logic
- do not invent new story events
- do not add new facts
- do not change the story meaning

LENGTH RULE:
- ideal: 4-10 words
- maximum: 12 words

VISUAL RULE:
Every line must contain:
- at least one visible noun
- at least one visible action or visible change

GOOD EXAMPLES:
- Orang-orang langsung memegangi leher mereka.
- Langit berubah pucat dalam hitungan detik.
- Mobil berhenti di tengah jalan.
- Gedung retak karena tekanan berubah.
- Seorang anak mencari tabung oksigen.

BAD EXAMPLES:
- Kiamat datang.
- Semuanya berubah.
- Misteri semakin dalam.
- Perjuangan terakhir ada.
- Dunia terasa berbeda.

REJECTION RULE:
If a sentence is too abstract, rewrite it into a visible concrete event while preserving meaning.

SPLITTING RULE:
If one sentence contains two visual events, split it.
If two short phrases describe the same exact moment, merge them.

COUNT RULE:
Generate between 8 and 15 lines.
Prioritize clarity and visual strength over poetic style.

Return ONLY valid JSON array.
No markdown.
No explanations.`,
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
const stageRetryCount = new Map<string, number>(); // track retries per project+stage
const MAX_STAGE_RETRIES = 3;

setInterval(async () => {
  if (isProcessing) return;
  const pendingProject = findPendingProject();

  if (!pendingProject) return;

  // Check retry limit for this project's current stage
  const retryKey = `${pendingProject.id}:${pendingProject.status}`;
  const retries = stageRetryCount.get(retryKey) || 0;
  if (retries >= MAX_STAGE_RETRIES) {
    console.error(`[WORKER] Project ${pendingProject.id} exceeded ${MAX_STAGE_RETRIES} retries at stage "${pendingProject.status}". Halting.`);
    pendingProject.status = "failed";
    pendingProject.error = `Exceeded ${MAX_STAGE_RETRIES} retries at stage "${pendingProject.status}"`;
    pendingProject.logs.push(`[FATAL] ${pendingProject.error}`);
    try {
      saveProject(pendingProject);
    } catch (e: any) {
      console.error(`[CRITICAL] Cannot save halted project ${pendingProject.id}:`, e.message);
    }
    stageRetryCount.delete(retryKey);
    return;
  }

  isProcessing = true;
  try {
    await processProjectStage(pendingProject);
    // If stage completed successfully, clear the retry counter for that stage
    stageRetryCount.delete(retryKey);
  } catch (error: any) {
    console.error(`Error processing project ${pendingProject.id}:`, error);
    // Increment retry counter
    stageRetryCount.set(retryKey, retries + 1);
    pendingProject.status = "failed";
    pendingProject.error = error.message || "Unknown error during background generation.";
    pendingProject.logs.push(`[ERROR] ${pendingProject.error} (retry ${retries + 1}/${MAX_STAGE_RETRIES})`);
    // Save updated status to database (wrapped in try/catch to prevent server crash)
    try {
      saveProject(pendingProject);
    } catch (saveErr: any) {
      console.error(`[CRITICAL] Failed to save failed project ${pendingProject.id}:`, saveErr.message);
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
              prompt: `${fallbackSystemInstruction}\n\nUser request:\n${prompt}\n\nReturn ONLY valid raw JSON. No markdown. No triple-backtick json. No explanation.`,
              stream: false,
              format: "json",
              options: {
                temperature: 0.4,
                top_p: 0.8,
                num_ctx: 8192,
              },
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
          prompt: `${fallbackSystemInstruction}\n\nUser request:\n${prompt}\n\nReturn ONLY valid raw JSON. No markdown. No triple-backtick json. No explanation.`,
          stream: false,
          format: "json",
          options: {
            temperature: 0.4,
            top_p: 0.8,
            num_ctx: 8192,
          },
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

// ── AUTO QA: Prompt quality validation and repair ────────────────────────────

/** Clean a narration line — strip leading commas, dashes, dots, colons, semicolons */
function cleanNarrationLine(line: string): string {
  return String(line || "")
    .replace(/^[\s,.\-–—:;]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Calculate word overlap ratio between two strings (0.0 to 1.0) */
function wordOverlapRatio(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1.0;
  if (wordsA.size === 0 || wordsB.size === 0) return 0.0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

/** Rewrite a duplicate narration line into a visual consequence of the original event.
 *  Instead of repeating the same action, show what happens NEXT. */
function rewriteDuplicateToConsequence(originalLine: string, sceneNumber: number): string {
  const lower = originalLine.toLowerCase();

  // Gravity / falling themes → show impact on surroundings
  if (lower.includes("gravitasi") || lower.includes("jatuh") || lower.includes("terlempar")) {
    return `Benda-benda berserakan di lantai akibat hantaman tak terkendala`;
  }
  // Earthquake / shaking → show structural damage
  if (lower.includes("guncang") || lower.includes("gempar") || lower.includes("bergoyang")) {
    return `Retak besar muncul di dinding bangunan yang terguncang`;
  }
  // People running / panic → show aftermath crowd
  if (lower.includes("berlari") || lower.includes("panik") || lower.includes("ketakutan")) {
    return `Jejak kaki dan barang bertebaran di jalan yang ditinggalkan orang`;
  }
  // Explosion / fire → show smoke and destruction
  if (lower.includes("meledak") || lower.includes("api") || lower.includes("terbakar")) {
    return `Asap hitam mengepul dari puing-puing yang masih berpijar`;
  }
  // Water / flood → show submerged area
  if (lower.includes("air") || lower.includes("banjir") || lower.includes("ombak")) {
    return `Genangan air mulai merendam jalanan yang retak`;
  }
  // Sky / atmosphere → show environmental change
  if (lower.includes("langit") || lower.includes("awan") || lower.includes("mendung")) {
    return `Cahaya matahari tertutup seluruhnya oleh lapisan awan gelap`;
  }
  // Vehicle → show abandoned vehicles
  if (lower.includes("mobil") || lower.includes("kendaraan") || lower.includes("motor")) {
    return `Kendaraan terbengkalai menyamping di tengah jalan yang sepi`;
  }
  // Building / structure → show debris
  if (lower.includes("gedung") || lower.includes("bangunan") || lower.includes("menara")) {
    return `Potongan beton dan kaca berjatuhan dari bangunan yang retak`;
  }
  // Bumi / earth → show ground crack
  if (lower.includes("bumi") || lower.includes("tanah") || lower.includes("darat")) {
    return `Tanah merekah lebar membentuk jurang di tengah permukaan`;
  }

  // Default: show escalating consequence
  return `Akibat peristiwa itu terlihat jelas di sekeliling scene ${sceneNumber}`;
}

/** Detect bad/generic visual prompts — too short, template fallback, or insufficiently detailed */
function isBadVisualPrompt(prompt: string): boolean {
  const lower = String(prompt || "").toLowerCase().trim();
  const wordCount = String(prompt || "").trim().split(/\s+/).filter(Boolean).length;
  return (
    !prompt ||
    wordCount < 50 ||
    lower.startsWith("cinematic scene depicting") ||
    lower.startsWith("cinematic visual scene") ||
    lower.startsWith("cinematic wide-angle scene inspired") ||
    lower.startsWith("a breathtaking, photorealistic depiction") ||
    lower.includes("rough stone, smooth metal, soft fabric") ||
    lower.includes("cinematic chiaroscuro effect") ||
    lower.includes("richly textured composition with dramatic directional lighting") ||
    lower.includes("volumetric light rays, subtle haze, and layered depth") ||
    lower.includes("photorealistic, richly textured composition")
  );
}

/** Detect bad/generic motion prompts — too short, template fallback, or camera-only without detail */
function isBadMotionPrompt(prompt: string): boolean {
  const lower = String(prompt || "").toLowerCase().trim();
  const wordCount = String(prompt || "").trim().split(/\s+/).filter(Boolean).length;
  return (
    !prompt ||
    wordCount < 25 ||
    lower.includes("steady cinematic tracking shot moving forward") ||
    lower.includes("the camera executes a slow, cinematic dolly-forward movement") ||
    lower.includes("smooth, deliberate pacing") ||
    lower.includes("professional cinematic feel throughout") ||
    lower.includes("steady forward tracking shot") ||
    lower.startsWith("slow zoom in") && wordCount < 10 ||
    lower.startsWith("cinematic dolly forward") && wordCount < 10 ||
    lower.startsWith("subtle handheld motion") && wordCount < 10 ||
    lower.startsWith("dramatic aerial pullback") && wordCount < 10 ||
    lower.startsWith("fast pan across") && wordCount < 10
  );
}

/** Build a category-aware visual fallback prompt — location and details match the scene content */
function buildFallbackVisualPrompt(theme: string, topic?: string): string {
  const cleanTheme = cleanNarrationLine(theme);
  const cleanTopic = topic ? cleanNarrationLine(topic) : "";
  const t = String(cleanTheme || "").toLowerCase();

  // ── Category: People / human subjects → urban street scene ──
  if (
    t.includes("orang") || t.includes("pria") || t.includes("wanita") ||
    t.includes("anak") || t.includes("bayi") || t.includes("ibu") ||
    t.includes("bapak") || t.includes("remaja") || t.includes("petani") ||
    t.includes("tentara") || t.includes("dokter") || t.includes("pengemudi")
  ) {
    return [
      `A crowded city street at midday with people reacting to ${cleanTheme}.`,
      `The location is a wide urban road lined with concrete buildings, street vendors, and parked motorcycles.`,
      `Foreground shows a person in distress with visible body language — hands gripping, eyes wide, mouth open.`,
      `Background shows other people running, stopping, or looking up in shock.`,
      `Harsh overhead sunlight casts sharp shadows on the asphalt. Dust and debris in the air.`,
      `Realistic skin tones, worn clothing textures, sweat on faces.`,
      `Shot at eye level with shallow depth of field, documentary style, no text, no watermark.`
    ].join(" ");
  }

  // ── Category: Trees / nature → city park scene ──
  if (
    t.includes("pohon") || t.includes("taman") || t.includes("daun") ||
    t.includes("rumput") || t.includes("bunga") || t.includes("hutan") ||
    t.includes("tanaman") || t.includes("akar") || t.includes("cabang")
  ) {
    return [
      `A city park with large trees swaying violently during ${cleanTheme}.`,
      `The location is a public green space with paved walking paths, wooden benches, and trimmed hedges.`,
      `Foreground shows tree branches snapping, leaves scattering, and soil cracking near the roots.`,
      `Background shows park lamps flickering, a playground with empty swings moving on their own, and distant buildings through the canopy.`,
      `Overcast sky with dramatic grey-green tones, wind-blown debris mid-air, rain droplets on camera lens.`,
      `Realistic bark texture, wet grass, and broken branches on the ground.`,
      `Wide shot at low angle looking up through the canopy, no text, no watermark.`
    ].join(" ");
  }

  // ── Category: Vehicles / transportation → highway scene ──
  if (
    t.includes("mobil") || t.includes("kendaraan") || t.includes("motor") ||
    t.includes("bus") || t.includes("truk") || t.includes("pesawat") ||
    t.includes("kapal") || t.includes("kereta") || t.includes("helikopter") ||
    t.includes("pengemudi") || t.includes("rem") || t.includes("kecepatan")
  ) {
    return [
      `A busy multi-lane highway during ${cleanTheme}.`,
      `The location is an elevated toll road with concrete barriers, overhead signs, and lane markings.`,
      `Foreground shows vehicles skidding, colliding, or stopped at odd angles with hazard lights blinking.`,
      `Background shows a line of cars stretching to the horizon, smoke rising from crashed vehicles, and a city skyline under an unsettling sky.`,
      `Late afternoon golden light mixed with emergency flashers, tire marks on asphalt, shattered glass on the road.`,
      `Realistic car paint reflections, bent metal, steam from radiators.`,
      `Tracking shot at car-level with motion blur, no text, no watermark.`
    ].join(" ");
  }

  // ── Category: Buildings / construction → urban construction zone ──
  if (
    t.includes("gedung") || t.includes("bangunan") || t.includes("konstruksi") ||
    t.includes("menara") || t.includes("jembatan") || t.includes("kaca") ||
    t.includes("baja") || t.includes("beton") || t.includes("dinding") ||
    t.includes("atap") || t.includes("kolom") || t.includes("pondasi")
  ) {
    return [
      `A high-rise construction zone experiencing ${cleanTheme}.`,
      `The location is a half-built concrete tower with exposed steel rebar, scaffolding, and crane arms overhead.`,
      `Foreground shows cracks spreading across a concrete pillar, dust falling from above, and a hard hat rolling on the floor.`,
      `Background shows unfinished floors with workers evacuating, scaffolding swaying, and debris falling through open shafts.`,
      `Grey overcast light filtering through the open structure, concrete dust in the air, sparks from stress-fractured rebar.`,
      `Realistic concrete texture, rust on steel beams, wet cement splatter.`,
      `Low angle looking up through the structure, no text, no watermark.`
    ].join(" ");
  }

  // ── Category: Water / ocean → waterfront scene ──
  if (
    t.includes("air") || t.includes("laut") || t.includes("sungai") ||
    t.includes("hujan") || t.includes("banjir") || t.includes("ombak") ||
    t.includes("tsunami") || t.includes("danau") || t.includes("pantai")
  ) {
    return [
      `A waterfront area overwhelmed by ${cleanTheme}.`,
      `The location is a coastal promenade with a sea wall, moored boats, and waterfront cafes.`,
      `Foreground shows water surging over the barrier, dragging debris and flooding the walkway.`,
      `Background shows the ocean churning unnaturally, boats torn from moorings, and dark clouds rolling in from the horizon.`,
      `Cold blue-grey light with white foam, water droplets on lens, reflections on wet pavement.`,
      `Realistic water splashing against concrete, seaweed and driftwood scattered, wet clothing on fleeing people.`,
      `Wide shot at water level, no text, no watermark.`
    ].join(" ");
  }

  // ── Category: Fire / explosion → industrial zone ──
  if (
    t.includes("api") || t.includes("meledak") || t.includes("ledakan") ||
    t.includes("terbakar") || t.includes("asap") || t.includes("panas") ||
    t.includes("jilat") || t.includes("bara") || t.includes("kilat")
  ) {
    return [
      `An industrial area during ${cleanTheme}.`,
      `The location is a factory district with steel chimneys, storage tanks, and chain-link fences.`,
      `Foreground shows a fireball erupting with orange and yellow flames, thick black smoke billowing upward.`,
      `Background shows workers running from the blast, emergency lights flashing, and a plume of smoke visible for miles.`,
      `Warm orange light contrasting with dark smoke, embers floating in the air, heat distortion near the flames.`,
      `Realistic flame physics, scorched metal, cracked asphalt from the blast.`,
      `Medium shot with heat shimmer, no text, no watermark.`
    ].join(" ");
  }

  // ── Default fallback: disaster documentary style ──
  return [
    `A realistic cinematic scene based on the moment: ${cleanTheme}.`,
    cleanTopic ? `The scene belongs to a story about ${cleanTopic}.` : "",
    `Show a clear main subject experiencing the event in a specific real-world location, with visible consequences, foreground details, background depth, natural human emotion, realistic textures, dramatic but believable lighting, and a grounded camera composition.`,
    `Make the scene feel like a real captured moment from a high-budget survival documentary, physically believable, high detail, no text, no watermark.`
  ].filter(Boolean).join(" ");
}

/** Build a context-aware motion fallback — varies by scene content */
function buildFallbackMotionPrompt(theme: string): string {
  const t = String(theme || "").toLowerCase();

  if (
    t.includes("panik") || t.includes("berlari") || t.includes("berteriak") ||
    t.includes("terlempar") || t.includes("jatuh") || t.includes("hancur") ||
    t.includes("meledak") || t.includes("guncang") || t.includes("terdorong")
  ) {
    return `Urgent handheld tracking shot following the chaos at street level, with controlled camera shake, fast parallax between foreground debris and background structures, subtle subject movement, and realistic environmental motion while preserving the original scene layout.`;
  }

  if (
    t.includes("langit") || t.includes("kota") || t.includes("bumi") ||
    t.includes("bangunan") || t.includes("gedung") || t.includes("jalan") ||
    t.includes("pantai") || t.includes("laut") || t.includes("gunung")
  ) {
    return `Slow wide cinematic pullback revealing the scale of the scene, with gentle atmospheric drift, subtle movement in distant elements, realistic lighting shifts, and stable composition to preserve architectural and environmental details.`;
  }

  if (
    t.includes("anak") || t.includes("tangan") || t.includes("wajah") ||
    t.includes("tubuh") || t.includes("orang") || t.includes("pria") ||
    t.includes("wanita") || t.includes("bayi") || t.includes("ibu")
  ) {
    return `Intimate slow push-in toward the human subject, with subtle handheld tremor, small body movement, drifting dust particles, and restrained background motion to keep the person stable and realistic.`;
  }

  if (
    t.includes("air") || t.includes("botol") || t.includes("daun") ||
    t.includes("benda") || t.includes("debu") || t.includes("mobil") ||
    t.includes("pohon") || t.includes("kaca")
  ) {
    return `Slow observational camera drift across the objects and environment, with gentle parallax, small rotations of suspended items, soft light flicker, and stable background perspective to avoid warping.`;
  }

  return `Slow cinematic push-in with subtle handheld drift, gentle environmental motion, drifting particles, realistic light changes, and stable subject preservation for a grounded image-to-video result.`;
}

/** Repair a bad prompt by asking the LLM to regenerate it with proper length and detail */
async function repairPrompt(type: "visual" | "motion", badPrompt: string, narrationLine: string): Promise<string> {
  const systemInstruction = type === "visual"
    ? `You are an expert AI visual prompt engineer. You MUST write a visual_prompt that is between 50 and 100 words. Paint a vivid, immersive picture with rich sensory detail: subject, environment, lighting, atmosphere, color palette, textures, mood, camera angle, lens effects. No text overlays. Output ONLY the prompt text, nothing else — no quotes, no labels, no explanation.`
    : `You are an expert AI motion prompt engineer. You MUST write a motion_prompt that is between 50 and 100 words. Describe ALL motion: camera movement (type, speed, direction), subject motion (people, objects, elements), and environmental motion (wind, particles, fog, light shifts). Output ONLY the prompt text, nothing else — no quotes, no labels, no explanation.`;

  const userPrompt = type === "visual"
    ? `The narration for this scene is: "${narrationLine}"\n\nThe current weak visual prompt is: "${badPrompt}"\n\nRewrite it as a rich, detailed visual prompt (50-100 words) suitable for AI image generation (FLUX/SDXL). Describe the scene vividly with lighting, atmosphere, composition, and cinematic detail.`
    : `The narration for this scene is: "${narrationLine}"\n\nThe current weak motion prompt is: "${badPrompt}"\n\nRewrite it as a rich, detailed motion prompt (50-100 words) describing all motion in a 3-second cinematic clip: camera movement, subject motion, and environmental animation.`;

  const rawResponse = await askLLM(userPrompt, systemInstruction);

  // Clean up — strip quotes, labels, markdown
  let cleaned = rawResponse.trim();
  // Remove wrapping quotes if present
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  // Remove markdown code blocks
  cleaned = cleaned.replace(/^```[\s\S]*?\n/, "").replace(/\n```$/, "");
  // Remove any "visual_prompt:" or "motion_prompt:" prefix
  cleaned = cleaned.replace(/^(visual_prompt|motion_prompt)\s*:\s*/i, "");

  return cleaned.trim();
}

/** Robust JSON extractor — handles markdown wrapping, text before/after, and both object/array roots */
function extractJsonObject(text: string): any {
  // Step 1: Strip markdown code blocks
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // Step 2: Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Step 3: Extract JSON object (curly braces)
  const firstObj = cleaned.indexOf("{");
  const lastObj = cleaned.lastIndexOf("}");
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    try {
      return JSON.parse(cleaned.slice(firstObj, lastObj + 1));
    } catch {}
  }

  // Step 4: Extract JSON array (square brackets)
  const firstArr = cleaned.indexOf("[");
  const lastArr = cleaned.lastIndexOf("]");
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    try {
      return JSON.parse(cleaned.slice(firstArr, lastArr + 1));
    } catch {}
  }

  // Step 5: Try to fix truncated JSON by counting brackets
  // This handles cases where LLM output is cut off mid-JSON
  if (firstObj !== -1) {
    const partial = cleaned.slice(firstObj);
    // Count unclosed braces
    let depth = 0;
    let lastValidEnd = -1;
    for (let i = 0; i < partial.length; i++) {
      if (partial[i] === "{") depth++;
      if (partial[i] === "}") { depth--; if (depth === 0) { lastValidEnd = i; break; } }
    }
    if (lastValidEnd > 0) {
      try {
        return JSON.parse(partial.slice(0, lastValidEnd + 1));
      } catch {}
    }
  }

  throw new Error("No valid JSON found in LLM response");
}

/** Normalize ideation output — handles 3 possible LLM output shapes:
 * 1. { "ideas": [ { title, hook, ... }, ... ] }  — standard object format
 * 2. [ { title, hook, ... }, ... ]                — bare array format
 * 3. { title, hook, ... }                         — single idea object
 */
function normalizeIdeas(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed;

  if (parsed?.ideas && Array.isArray(parsed.ideas)) {
    return parsed.ideas;
  }

  // Single idea object — wrap in array
  if (parsed?.title && parsed?.hook) {
    return [parsed];
  }

  throw new Error("Invalid ideas JSON structure");
}

/** Extract a display-safe idea title from any idea shape (string or object) */
function ideaToTitle(idea: any): string {
  if (typeof idea === "string") return idea;
  if (idea?.title) return idea.title;
  if (idea?.hook) return idea.hook;
  return JSON.stringify(idea);
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

    // Log raw response for debugging
    console.log(`[LLM RAW RESPONSE] Ideation (${rawResponse.length} chars):`, rawResponse.slice(0, 2000));

    // Parse ideas — flexible: handles { ideas: [...] }, bare [...], or single { title, hook }
    let ideas: string[] = [];
    let parseSuccess = false;
    try {
      const parsed = extractJsonObject(rawResponse);
      const normalizedIdeas = normalizeIdeas(parsed);
      ideas = normalizedIdeas.map((idea: any) => ideaToTitle(idea));
      parseSuccess = ideas.length > 0;
      console.log(`[LLM] Ideation parsed ${ideas.length} ideas via normalizeIdeas().`);
    } catch (e: any) {
      console.warn(`[LLM] normalizeIdeas() failed: ${e.message}. Attempting text extraction fallback.`);
    }

    if (!parseSuccess || ideas.length === 0) {
      // Text extraction fallback
      console.warn("[LLM] Ideation parse failed — using text extraction fallback.");
      ideas = rawResponse
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((l) => l.startsWith("-") || l.match(/^\d/))
        .map((l) => l.replace(/^[- \d.]*/, ""))
        .filter((l) => l.length > 0)
        .slice(0, 3);
      if (ideas.length === 0) {
        ideas = [
          `Rahasia Tersembunyi: ${project.topic} yang Tidak Pernah Kamu Duga`,
          `Timeline Gelap: Kronologi ${project.topic} yang Mengguncang Dunia`,
          `Apa yang Terjadi? Misteri ${project.topic} yang Belum Terpecahkan`,
        ];
      }
    }

    project.ideas = ideas;
    project.selectedIdea = ideas[0] || `The Untold Secrets of ${project.topic}`;
    project.logs.push(`[IDEAS GENERATED] ${ideas.length} ideas. Chosen: "${project.selectedIdea}"`);
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

    // Log raw response for debugging
    console.log(`[LLM RAW RESPONSE] Script (${rawResponse.length} chars):`, rawResponse.slice(0, 2000));

    let scriptObj = { hook: "", intro: "", body: "", cta: "" };
    try {
      const parsed = extractJsonObject(rawResponse);
      // Handle both { "hook": "...", ... } and { "script": { "hook": "...", ... } }
      if (parsed && parsed.hook !== undefined) {
        scriptObj = parsed;
      } else if (parsed && parsed.script && typeof parsed.script === "object") {
        scriptObj = parsed.script;
      } else {
        throw new Error("Script object has no expected keys");
      }
    } catch (e) {
      console.warn("[LLM] Script parsing failed, using fallback script.");
      scriptObj = {
        hook: `Perhatikan! Rahasia besar tersembunyi di depan mata. Mari kita selami ${project.selectedIdea}.`,
        intro: "Bersiaplah, karena apa yang akan kamu lihat bukan untuk yang lemah hati.",
        body: rawResponse.length > 100 ? rawResponse.substring(0, 500) : "Eksplorasi gelap yang mendalam tentang pengetahuan yang terlupakan.",
        cta: "Jangan biarkan kebenaran ini lewat. Pastikan kamu subscribe dan nyalakan notifikasi.",
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

    // Log raw response for debugging
    console.log(`[LLM RAW RESPONSE] Splitter (${rawSplitResponse.length} chars):`, rawSplitResponse.slice(0, 2000));

    let atomicLines: string[] = [];
    try {
      const parsed = extractJsonObject(rawSplitResponse);
      if (Array.isArray(parsed)) {
        atomicLines = parsed.map((l: any) => typeof l === "string" ? l : String(l));
      } else if (parsed && Array.isArray(parsed.lines)) {
        atomicLines = parsed.lines.map((l: any) => typeof l === "string" ? l : String(l));
      } else if (parsed && Array.isArray(parsed.atomic_lines)) {
        atomicLines = parsed.atomic_lines.map((l: any) => typeof l === "string" ? l : String(l));
      } else {
        throw new Error("Splitter output has no array");
      }
    } catch (e) {
      console.warn("[LLM] Failed to parse split script JSON, fallback to sentence splitting...");
      // Smart sentence split: preserve time formats like "08.00" and "12.30"
      // Replace digit.digit patterns with a placeholder before splitting
      const timeProtected = fullScriptText
        .replace(/(\d)\.(\d)/g, "$1_DOT_$2")
        .replace(/(\d),(\d)/g, "$1_COMMA_$2");
      atomicLines = timeProtected
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .map((s) => s.replace(/_DOT_/g, ".").replace(/_COMMA_/g, ","))
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

    // Log raw response for debugging
    console.log(`[LLM RAW RESPONSE] Planning (${rawResponse.length} chars):`, rawResponse.slice(0, 2000));

    let scenesList: any[] = [];
    try {
      const parsed = extractJsonObject(rawResponse);
      if (Array.isArray(parsed)) {
        scenesList = parsed;
      } else if (parsed && Array.isArray(parsed.scenes)) {
        scenesList = parsed.scenes;
      } else if (parsed && Array.isArray(parsed.scene_list)) {
        scenesList = parsed.scene_list;
      } else if (parsed && typeof parsed === "object") {
        // Maybe the whole response is a single scene object
        scenesList = [parsed];
      } else {
        throw new Error("Planning output has no scene array");
      }

      // Validate scene count matches atomic lines count
      if (scenesList.length !== project.atomicLines.length) {
        project.logs.push(`[WARNING] Scene count mismatch: splitter=${project.atomicLines.length}, scenes=${scenesList.length}. Forcing alignment...`);
        console.warn(`Scene count mismatch: splitter=${project.atomicLines.length}, scenes=${scenesList.length}`);

        // If LLM returned fewer scenes, pad with voice_text from remaining atomic lines
        while (scenesList.length < project.atomicLines.length) {
          const idx = scenesList.length;
          scenesList.push({
            scene: idx + 1,
            visual_prompt: buildFallbackVisualPrompt(project.atomicLines[idx], project.topic),
            motion_prompt: buildFallbackMotionPrompt(project.atomicLines[idx]),
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
        visual_prompt: buildFallbackVisualPrompt(line, project.topic),
        motion_prompt: buildFallbackMotionPrompt(line),
        voice_text: line,
      }));
    }

    // ── AUTO QA: Validate and repair bad prompts ──────────────────────────────
    // First, clean all atomic lines (strip leading commas, dashes, etc.)
    project.atomicLines = project.atomicLines.map((line: string) => cleanNarrationLine(line));

    project.logs.push(`[QA] Running atomic line QA...`);
    let atomicLinesRepaired = 0;
    for (let i = 0; i < scenesList.length; i++) {
      const s = scenesList[i];
      // Clean voice_text — strip leading punctuation from LLM output
      const rawVoice = s.voice_text || s.voiceText || project.atomicLines[i] || "";
      const cleanVoice = cleanNarrationLine(rawVoice);
      const voiceOk = cleanVoice.length > 0;
      if (!voiceOk || rawVoice !== cleanVoice) {
        scenesList[i].voice_text = cleanVoice;
        atomicLinesRepaired++;
      } else {
        scenesList[i].voice_text = cleanVoice;
      }
    }
    project.logs.push(`[QA] Atomic lines cleaned/repaired: ${atomicLinesRepaired}/${scenesList.length}`);

    project.logs.push(`[QA] Running visual prompt QA...`);
    let visualRepaired = 0;
    for (let i = 0; i < scenesList.length; i++) {
      const vp = scenesList[i].visual_prompt || scenesList[i].visualPrompt || "";
      if (isBadVisualPrompt(vp)) {
        console.log(`[QA] Bad visual_prompt at scene ${i + 1}: "${vp.substring(0, 80)}..." — regenerating`);
        try {
          const repaired = await repairPrompt(
            "visual",
            vp,
            cleanNarrationLine(project.atomicLines[i] || `Scene ${i + 1}`)
          );
          scenesList[i].visual_prompt = repaired;
          visualRepaired++;
        } catch (repairErr: any) {
          console.warn(`[QA] Visual prompt repair failed for scene ${i + 1}:`, repairErr.message);
          scenesList[i].visual_prompt = buildFallbackVisualPrompt(project.atomicLines[i] || `Scene ${i + 1}`, project.topic);
          visualRepaired++;
        }
      }
    }
    project.logs.push(`[QA] Visual prompts repaired: ${visualRepaired}/${scenesList.length}`);

    project.logs.push(`[QA] Running motion prompt QA...`);
    let motionRepaired = 0;
    for (let i = 0; i < scenesList.length; i++) {
      const mp = scenesList[i].motion_prompt || scenesList[i].motionPrompt || "";
      if (isBadMotionPrompt(mp)) {
        console.log(`[QA] Bad motion_prompt at scene ${i + 1}: "${mp.substring(0, 80)}..." — regenerating`);
        try {
          const repaired = await repairPrompt(
            "motion",
            mp,
            cleanNarrationLine(project.atomicLines[i] || `Scene ${i + 1}`)
          );
          scenesList[i].motion_prompt = repaired;
          motionRepaired++;
        } catch (repairErr: any) {
          console.warn(`[QA] Motion prompt repair failed for scene ${i + 1}:`, repairErr.message);
          scenesList[i].motion_prompt = buildFallbackMotionPrompt(project.atomicLines[i] || `Scene ${i + 1}`);
          motionRepaired++;
        }
      }
    }
    project.logs.push(`[QA] Motion prompts repaired: ${motionRepaired}/${scenesList.length}`);

    // ── AUTO QA: Deduplicate similar scenes ──────────────────────────────────
    project.logs.push(`[QA] Running duplicate scene detection...`);
    let duplicatesFixed = 0;
    for (let i = 1; i < scenesList.length; i++) {
      const currentVoice = cleanNarrationLine(scenesList[i].voice_text || "").toLowerCase();
      for (let j = 0; j < i; j++) {
        const prevVoice = cleanNarrationLine(scenesList[j].voice_text || "").toLowerCase();
        // Check if two lines are very similar (Levenshtein-style: one contains the other, or >80% word overlap)
        if (currentVoice === prevVoice || wordOverlapRatio(currentVoice, prevVoice) > 0.8) {
          console.log(`[QA] Duplicate scene detected at scene ${i + 1}: "${currentVoice}" ≈ scene ${j + 1}: "${prevVoice}" — rewriting to visual consequence`);
          project.logs.push(`[QA] Duplicate scene ${i + 1} ≈ scene ${j + 1} — rewriting to visual consequence`);

          // Rewrite the duplicate line into a visual consequence of the original
          const originalAction = currentVoice;
          const consequenceLine = rewriteDuplicateToConsequence(originalAction, i + 1);
          scenesList[i].voice_text = consequenceLine;
          // Also update the atomic line
          if (project.atomicLines[i]) {
            project.atomicLines[i] = consequenceLine;
          }
          // Regenerate visual and motion prompts for this scene
          scenesList[i].visual_prompt = buildFallbackVisualPrompt(consequenceLine, project.topic);
          scenesList[i].motion_prompt = buildFallbackMotionPrompt(consequenceLine);
          duplicatesFixed++;
          break; // Only compare each scene once
        }
      }
    }
    project.logs.push(`[QA] Duplicate scenes rewritten: ${duplicatesFixed}/${scenesList.length}`);

    // Adapt to Scene interface — use unique IDs to prevent collisions on planning retries
    const planningTimestamp = Date.now();
    const planningRandom = Math.random().toString(36).slice(2, 8);
    project.scenes = scenesList.map((s: any, idx: number) => ({
      id: `${project.id}_s${idx + 1}_${planningTimestamp}_${planningRandom}`,
      projectId: project.id,
      sceneNumber: s.scene || idx + 1,
      visualPrompt: s.visual_prompt || s.visualPrompt || buildFallbackVisualPrompt(`Scene ${idx + 1}`),
      motionPrompt: s.motion_prompt || s.motionPrompt || buildFallbackMotionPrompt(`Scene ${idx + 1}`),
      voiceText: cleanNarrationLine(s.voice_text || s.voiceText || ""),
      status: "idle",
      imageBase64: "",
      imagePath: "",
      videoUrl: "",
      audioUrl: "",
      audioDuration: 0,
      error: "",
    }));

    project.logs.push(`[SCENE PLAN] ${project.scenes.length} scenes generated (QA applied).`);
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
        // Voice cloning: pass reference audio if enabled
        ...(settings.voiceCloningEnabled && settings.refAudio ? {
          refAudio: settings.refAudio,
          refText: settings.refText || "",
        } : {}),
      };

      const logFn = (msg: string) => {
        project.logs.push(msg);
        if (project.logs.length % 2 === 0) saveAndPublish(project);
      };

      const ttsResult = await synthesizeSpeech(nextScene.voiceText, ttsConfig, logFn);

      if (ttsResult.audioDataUrl) {
        nextScene.audioUrl = ttsResult.audioDataUrl;
        nextScene.audioDuration = typeof ttsResult.durationSeconds === "number" && Number.isFinite(ttsResult.durationSeconds)
          ? ttsResult.durationSeconds : 0;
        project.logs.push(`[TTS] Scene ${nextScene.sceneNumber} voice generated via ${ttsResult.engine} (${nextScene.audioDuration.toFixed(1)}s)`);
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
          comfyCheckpoint: settings.comfyCheckpoint || "",
          comfyNegativePrompt: settings.comfyNegativePrompt || "low quality, blurry, watermark, text overlay, deformed, ugly, bad anatomy",
          workflowTemplate: settings.workflowTemplate || "Auto_Detect",
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

        project.logs.push(`[COMFYUI] Using checkpoint: "${settings.comfyCheckpoint}", workflow: "${settings.workflowTemplate || 'Auto_Detect'}"`);

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

    // 3. Motion Engine — WAN 2.2 I2V or LTX-Video I2V via ComfyUI
    nextScene.status = "generating_video";
    saveAndPublish(project);

    let doneVideo = false;
    const motionEngine = settings.motionEngine || "wan_i2v";

    if (settings.comfyUrl && nextScene.imageBase64) {
      try {
        const comfyConfig: ComfyUIConfig = {
          comfyUrl: settings.comfyUrl,
          comfyCheckpoint: settings.comfyCheckpoint || "",
          comfyNegativePrompt: settings.comfyNegativePrompt || "low quality, blurry, static, no motion",
          workflowTemplate: settings.workflowTemplate || "Auto_Detect",
          wanMode: settings.wanMode as "i2v" | "t2v",
          wanResolution: settings.wanResolution as "16:9" | "9:16",
          wanSteps: settings.wanSteps,
          wanCfg: settings.wanCfg,
          wanFrames: settings.wanFrames,
          wanMotionIntensity: settings.wanMotionIntensity,
          wanCheckpoint: settings.wanCheckpoint || "wan2.2_i2v_480p.safetensors",
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

        // Only attempt video generation if we have a real image (not SVG placeholder)
        const isSvgPlaceholder = nextScene.imageBase64?.startsWith("data:image/svg+xml");

        if (!isSvgPlaceholder) {
          if (motionEngine === "ltx_i2v") {
            // ── LTX-Video I2V Engine ──
            project.logs.push(`[LTX I2V] Starting LTX-Video Image-to-Video for scene ${nextScene.sceneNumber}...`);

            const projectOutputDir = path.join(COMFYUI_OUTPUT_DIR, project.id);
            // Combine visual prompt + motion prompt for richer LTXV text conditioning
            const ltxFullPrompt = nextScene.visualPrompt
              ? `${nextScene.visualPrompt}. ${nextScene.motionPrompt}`
              : nextScene.motionPrompt;
            const ltxResult = await comfyGenerateLtxVideo(
              comfyConfig,
              ltxFullPrompt,
              nextScene.imageBase64!,
              projectOutputDir,
              nextScene.sceneNumber,
              logFn,
              undefined, // seed
              (settings as any).ltxSteps || 20,
              (settings as any).ltxCfg || 4.0,
              (settings as any).ltxFrames || 97,
              (settings as any).ltxFps || 24,
              (settings as any).ltxWorkflowPath || "",  // Path to user's saved LTX workflow JSON
            );

            if (ltxResult.videoPath) {
              nextScene.videoUrl = ltxResult.dataUrl || ltxResult.videoPath;
              nextScene.imagePath = ltxResult.videoPath; // Store video path for FFmpeg assembly
              doneVideo = true;
              project.logs.push(`[LTX I2V] Scene ${nextScene.sceneNumber} video saved to: ${ltxResult.videoPath}`);

              // ── FFmpeg: Merge LTX video with TTS audio ──
              if (nextScene.audioUrl) {
                try {
                  const sceneDir = path.join(projectOutputDir, `scene_${nextScene.sceneNumber}`);
                  const audioExt = nextScene.audioUrl.startsWith("data:audio/wav") ? "wav" :
                                   nextScene.audioUrl.startsWith("data:audio/mp3") ? "mp3" : "wav";
                  const audioPath = path.join(sceneDir, `audio.${audioExt}`);
                  const mergedPath = path.join(sceneDir, `video_with_audio.mp4`);

                  // Write audio to disk for FFmpeg
                  const audioBase64Match = nextScene.audioUrl.match(/^data:[^;]+;base64,(.+)$/);
                  if (audioBase64Match) {
                    const audioBuffer = Buffer.from(audioBase64Match[1], "base64");
                    if (!fs.existsSync(sceneDir)) fs.mkdirSync(sceneDir, { recursive: true });
                    fs.writeFileSync(audioPath, audioBuffer);

                    const { mergeVideoAudio } = await import("./ffmpeg.js");
                    await mergeVideoAudio(ltxResult.videoPath, audioPath, mergedPath, logFn);

                    nextScene.imagePath = mergedPath; // Update to merged video for assembly
                    project.logs.push(`[FFMPEG] Scene ${nextScene.sceneNumber} LTX video + audio merged: ${mergedPath}`);
                  }
                } catch (mergeErr: any) {
                  project.logs.push(`[WARNING] FFmpeg merge failed for scene ${nextScene.sceneNumber}: ${mergeErr.message}. Using video without audio.`);
                }
              } else {
                // No audio — add silent track for compatibility
                try {
                  const sceneDir = path.dirname(ltxResult.videoPath);
                  const silentPath = path.join(sceneDir, `video_with_silence.mp4`);
                  const { mergeVideoWithSilence } = await import("./ffmpeg.js");
                  await mergeVideoWithSilence(ltxResult.videoPath, silentPath, logFn);
                  nextScene.imagePath = silentPath;
                  project.logs.push(`[FFMPEG] Silent audio track added to LTX video.`);
                } catch {
                  // Non-critical — proceed with video as-is
                }
              }

              saveAndPublish(project);
            } else {
              project.logs.push(`[WARNING] LTX-Video returned no output. CSS Ken Burns motion will be used as fallback.`);
            }
          } else {
            // ── WAN 2.2 I2V Engine (default) ──
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
          }
        } else {
          project.logs.push(`[INFO] Scene ${nextScene.sceneNumber} using SVG placeholder — skipping ${motionEngine === 'ltx_i2v' ? 'LTX-Video' : 'WAN 2.2'} I2V. CSS Ken Burns motion will be applied by the Cinema Player.`);
        }
      } catch (err: any) {
        console.warn(`Motion engine video generation failed for scene ${nextScene.sceneNumber}:`, err.message);
        project.logs.push(`[WARNING] ${motionEngine === 'ltx_i2v' ? 'LTX-Video' : 'WAN 2.2'} I2V failed: ${err.message}. CSS Ken Burns motion will be used as fallback.`);
        saveAndPublish(project);
      }
    } else {
      if (!settings.comfyUrl) {
        project.logs.push(`[INFO] ComfyUI URL not configured — skipping ${motionEngine === 'ltx_i2v' ? 'LTX-Video' : 'WAN 2.2'} I2V. CSS Ken Burns motion will be used.`);
      } else if (!nextScene.imageBase64) {
        project.logs.push(`[INFO] No input image available — skipping ${motionEngine === 'ltx_i2v' ? 'LTX-Video' : 'WAN 2.2'} I2V.`);
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
        title: `${project.topic} — Fakta Yang Tidak Diketahui`,
        description: `Temukan fakta mengejutkan tentang ${project.topic}. Video ini mengungkap sisi yang jarang dibahas. Tonton sampai habis dan tinggalkan pendapatmu di kolom komentar.`,
        tags: [project.topic, "faceless channel", "fakta mengejutkan", "pengetahuan", "project kiwul"],
        hashtags: ["#ProjectKiwul", "#Fakta", "#Pengetahuan"],
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
          comfyCheckpoint: settings.comfyCheckpoint || "",
          comfyNegativePrompt: settings.comfyNegativePrompt || "low quality, blurry, watermark, simple, plain",
          workflowTemplate: settings.workflowTemplate || "Auto_Detect",
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
      const sceneAssets: FFmpegSceneAsset[] = project.scenes.map((scene: any) => {
        const sceneImagePath = scene.imagePath || null;
        const isVideoAsset = sceneImagePath && /\.(mp4|webm|avi|mov|mkv)$/i.test(sceneImagePath);
        const alreadyMergedAudio = isVideoAsset && sceneImagePath?.includes("video_with_audio");

        return {
          sceneNumber: scene.sceneNumber,
          imagePath: sceneImagePath,
          imageBase64: scene.imageBase64 || null,
          // If the video was already merged with audio by LTX pipeline, don't pass audio again
          // The FFmpeg assembly will just keep the video's existing audio track
          audioBase64: alreadyMergedAudio ? null : (scene.audioUrl || null),
          voiceText: scene.voiceText || "",
          durationSeconds: 0, // 0 = auto-detect from audio
          motionPrompt: scene.motionPrompt || "",
        };
      });

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
  try {
    saveProject(project);
  } catch (err: any) {
    console.error(`[SERVER] saveAndPublish() failed for project ${project.id}:`, err.message);
    // Mark project as failed so the polling loop stops retrying this stage
    project.status = "failed";
    project.error = `Save failed: ${err.message || "Unknown database error"}`;
    project.logs.push(`[FATAL] Database save failed — project halted. Error: ${project.error}`);
    // Attempt one last save with only the error status (no scenes) to persist the failure
    try {
      saveProject(project);
    } catch (finalErr: any) {
      console.error(`[CRITICAL] Final error-save also failed for project ${project.id}:`, finalErr.message);
    }
  }
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
  const { text, engine, voiceProfile, speed, refAudio, refText, voiceCloningEnabled } = req.body;
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
      // Voice cloning support for test
      ...((voiceCloningEnabled || localSettings.voiceCloningEnabled) && (refAudio || localSettings.refAudio) ? {
        refAudio: refAudio || localSettings.refAudio,
        refText: refText || localSettings.refText || "",
      } : {}),
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

// Upload reference audio for voice cloning
// Accepts multipart form data with an audio file and optional ref_text
app.post("/api/tts/upload-ref-audio", async (req, res) => {
  try {
    const { audio, refText } = req.body;

    if (!audio) {
      return res.status(400).json({ error: "No audio data provided. Send base64 audio data URL in 'audio' field." });
    }

    // Validate it's a data URL
    if (!audio.startsWith("data:audio/") && !audio.startsWith("data:application/")) {
      return res.status(400).json({ error: "Invalid audio format. Expected base64 data URL (data:audio/...)." });
    }

    // Check size (max 10MB for reference audio)
    const base64Part = audio.split(",")[1] || "";
    const sizeBytes = Math.ceil(base64Part.length * 0.75);
    if (sizeBytes > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "Audio file too large. Maximum 10MB." });
    }

    // Save to settings
    localSettings.refAudio = audio;
    localSettings.refText = refText || "";

    // Persist to database
    try {
      dbUpdateSettings({
        refAudio: audio,
        refText: refText || "",
      } as any);
    } catch (dbErr) {
      console.warn("[TTS] Could not persist ref_audio to database:", dbErr);
    }

    res.json({
      success: true,
      message: "Reference audio uploaded and saved for voice cloning",
      sizeKB: Math.round(sizeBytes / 1024),
      refText: refText || "",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete reference audio for voice cloning
app.delete("/api/tts/ref-audio", (_req, res) => {
  try {
    localSettings.refAudio = "";
    localSettings.refText = "";
    try {
      dbUpdateSettings({ refAudio: "", refText: "" } as any);
    } catch (dbErr) {
      console.warn("[TTS] Could not clear ref_audio from database:", dbErr);
    }
    res.json({ success: true, message: "Reference audio removed" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get available voice profiles from F5-TTS
app.get("/api/tts/voices", async (_req, res) => {
  try {
    const ttsUrl = localSettings.ttsUrl || "http://127.0.0.1:5050";
    const response = await fetch(`${ttsUrl}/voices`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json();
      res.json(data);
    } else {
      res.json({ voices: [], error: "F5-TTS returned non-200 status" });
    }
  } catch (err: any) {
    res.json({ voices: [], error: `F5-TTS unavailable: ${err.message}` });
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
