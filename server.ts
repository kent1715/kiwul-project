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
  updateScene,
  getDatabase,
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
import {
  generateImageWithZImageTurbo,
  checkZImageTurboConnection,
  type ZImageTurboSettings,
} from "./zimageTurbo.js";

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
  // Image provider: "comfyui" or "zimage_turbo"
  imageProvider: "comfyui" as "comfyui" | "zimage_turbo",
  zImageTurboUrl: "http://127.0.0.1:9000",
  imageWidth: 512,
  imageHeight: 896,
  imageSteps: 8,
  imageCfg: 1.0,
  zImageVaePath: "D:\\Z-Image-Turbo-Windows\\models\\vae\\ae.safetensors",
  zImageLlmPath: "D:\\Z-Image-Turbo-Windows\\models\\llm\\Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
  zImageLoras: "",
  zImageLoraStrength: 1.0,
  // ComfyUI settings
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
  promptSplitter: `/no_think

Kamu adalah editor narasi sinematik untuk video AI tanpa wajah.

TUGAS:
Konversi skrip narasi penuh menjadi baris-baris narasi atomik untuk pembuatan scene per scene.

ATURAN BAHASA:
- Semua output WAJIB Bahasa Indonesia natural.
- Pertahankan makna sesuai skrip asli.

FORMAT OUTPUT:
Balas HANYA JSON array of strings. JANGAN pakai object mapping.
Jangan pakai markdown. Jangan beri penjelasan.

CONTOH OUTPUT YANG BENAR:
["Baris narasi pertama.", "Baris narasi kedua.", "Baris narasi ketiga."]

CONTOH OUTPUT YANG SALAH (DILARANG):
{"1": "Baris pertama", "2": "Baris kedua"}
{"lines": ["Baris pertama"]}
[{"text": "Baris pertama"}]

TUJUAN INTI:
Buat baris pendek atomik dimana setiap baris mewakili TEPAT SATU momen visual.

ATURAN KETAT:
- satu baris = satu kejadian visual
- setiap baris mudah divisualisasikan
- setiap baris mudah dibaca TTS
- setiap baris cocok untuk subtitle
- pertahankan pacing dramatis
- pertahankan urutan cerita asli
- pertahankan eskalasi
- pertahankan progresi waktu jika ada
- pertahankan logika sebab-akibat penting
- jangan invent cerita baru
- jangan tambah fakta baru
- jangan ubah makna cerita

ATURAN PANJANG:
- ideal: 4-10 kata
- maksimal: 12 kata

ATURAN VISUAL:
Setiap baris harus mengandung:
- minimal satu benda yang terlihat (visible noun)
- minimal satu aksi yang terlihat (visible action/change)

CONTOH BAIK:
- Orang-orang langsung memegangi leher mereka.
- Langit berubah pucat dalam hitungan detik.
- Mobil berhenti di tengah jalan.
- Gedung retak karena tekanan berubah.
- Seorang anak mencari tabung oksigen.

CONTOH BURUK:
- Kiamat datang.
- Semuanya berubah.
- Misteri semakin dalam.
- Perjuangan terakhir ada.
- Dunia terasa berbeda.

ATURAN PENOLAKAN:
Jika kalimat terlalu abstrak, tulis ulang menjadi kejadian konkret yang terlihat sambil mempertahankan makna.

ATURAN SPLIT:
Jika satu kalimat mengandung dua kejadian visual, pisahkan.
Jika dua frasa pendek menjelaskan momen yang sama persis, gabungkan.

ATURAN JUMLAH:
Buat antara 8 dan 15 baris.
Utamakan kejelasan dan kekuatan visual daripada gaya puitis.

Balas HANYA JSON array of strings. Jangan pakai object. Jangan pakai markdown.`,
  promptStoryDoctor: `/no_think

Kamu adalah Story Doctor untuk konten video pendek viral Indonesia.

Tugas:
Nilai dan perbaiki konsep video agar lebih kuat untuk video AI lokal.

ATURAN BAHASA:
- Semua value string WAJIB Bahasa Indonesia natural.
- Dilarang menggunakan Bahasa Inggris kecuali istilah teknis umum.
- Contoh SALAH: "Lack of personal stakes", "Emotional conflict is weak"
- Contoh BENAR: "Kurang tarikan emosional", "Konflik belum cukup kuat"

WAJIB BALAS HANYA JSON VALID.
Jangan pakai markdown.
Jangan beri penjelasan.
Jangan tulis teks sebelum atau sesudah JSON.

Schema:
{
  "overall_score": 0,
  "hook_score": 0,
  "conflict_score": 0,
  "curiosity_gap_score": 0,
  "visual_potential_score": 0,
  "emotional_stakes_score": 0,
  "ending_payoff_score": 0,
  "main_weakness": "string",
  "rewrite_plan": "string",
  "improved_concept": {
    "title": "string",
    "hook": "string",
    "core_question": "string",
    "story_angle": "string",
    "escalation_path": [
      "string",
      "string",
      "string",
      "string",
      "string"
    ],
    "final_payoff": "string"
  }
}

Aturan penilaian:
- Setiap skor 1-10.
- overall_score adalah rata-rata semua sub-skor.
- Skor 8+ berarti konsep cukup kuat untuk lanjut.
- Skor di bawah 8 berarti konsep perlu ditulis ulang.

Kriteria penilaian:

hook_score:
- Apakah pembukaan langsung menciptakan bahaya, kejutan, atau misteri?
- Apakah penonton berhenti scroll dalam 2 detik pertama?

conflict_score:
- Apakah ada ancaman, bahaya, atau masalah yang jelas?
- Apakah konflik meningkat secara alami?

curiosity_gap_score:
- Apakah konsep bikin penonton ingin tahu apa yang terjadi selanjutnya?
- Apakah ada pertanyaan yang tak terjawab sampai akhir?

visual_potential_score:
- Apakah setiap momen bisa divisualisasikan secara konkret?
- Apakah ada visual set-piece yang kuat?

emotional_stakes_score:
- Apakah ada koneksi personal atau ketakutan yang bisa dirasakan penonton?
- Apakah penonton peduli dengan apa yang terjadi?

ending_payoff_score:
- Apakah ada twist, reveal, atau kesimpulan yang memuaskan?
- Apakah ending memberi reward pada penonton yang menonton sampai akhir?

Aturan rewrite:
- Jika overall_score < 8, WAJIB berikan improved_concept.
- Rewrite harus memperbaiki main_weakness.
- Pertahankan tema inti tapi perkuat aspek terlemah.
- Jangan ubah genre utama.
- Jangan buat twist terlalu abstrak atau psikologis.
- Fokus pada visual yang bisa digenerate AI.
- Konflik harus jelas dalam 3 detik pertama.
- Ada eskalasi setiap 10 detik.
- Ending harus punya payoff visual, bukan sekadar sedih.
- Jangan membunuh anak kecil sebagai payoff.
- Cocok untuk konten what-if, disaster, cinematic science thriller.

Balas hanya JSON valid.`,
  promptHookLab: `/no_think

Kamu adalah mesin JSON murni untuk Hook Lab konten viral Indonesia.

Tugas:
Buat Hook Lab untuk video pendek Indonesia berdasarkan topik yang diberikan.

ATURAN BAHASA:
- Semua value string WAJIB Bahasa Indonesia natural.
- Dilarang menggunakan Bahasa Inggris kecuali istilah teknis umum.

WAJIB BALAS HANYA JSON VALID.
Jangan pakai markdown.
Jangan pakai \`\`\`json.
Jangan beri penjelasan.
Jangan tulis teks sebelum atau sesudah JSON.
Jangan tulis reasoning atau <think/>.

Schema wajib:
{
  "hooks": [
    {
      "hook": "string",
      "type": "countdown|shock|danger|mystery|whatif",
      "curiosity_gap": "string",
      "emotional_trigger": "string",
      "visual_opening": "string",
      "strength": 1
    }
  ],
  "best_hook_index": 0
}

Aturan hook:
- Buat tepat 8 hook.
- Bahasa Indonesia natural.
- Hook maksimal 12 kata.
- Hook harus langsung terasa bahaya, misteri, atau konflik.
- Jangan terdengar seperti artikel.
- Jangan pakai kata generik seperti "bayangkan" terlalu sering.
- strength antara 1 sampai 10.
- best_hook_index memakai index array mulai dari 0.
- type hanya boleh: countdown, shock, danger, mystery, whatif.

Balas hanya JSON valid.`,
  promptScriptDoctor: `/no_think

Kamu adalah Script Doctor untuk konten video pendek viral Indonesia.

Tugas:
Nilai kualitas skrip dan perbaiki jika masih lemah.

ATURAN BAHASA:
- Semua value string WAJIB Bahasa Indonesia natural.
- Dilarang menggunakan Bahasa Inggris.

WAJIB BALAS HANYA JSON VALID.
Jangan pakai markdown.
Jangan beri penjelasan.

Schema:
{
  "score": 0,
  "hook_strength": 0,
  "time_pressure": 0,
  "visual_clarity": 0,
  "escalation_quality": 0,
  "cause_effect_logic": 0,
  "language_quality": 0,
  "problems": ["string"],
  "rewrite_needed": true,
  "rewrite_instruction": "string",
  "improved_script": {
    "hook": "string",
    "intro": "string",
    "body": ["string"],
    "cta": "string"
  }
}

Kriteria penilaian (setiap skor 1-10):

hook_strength:
- Apakah hook langsung bikin penasaran dalam 2 detik pertama?
- Apakah ada bahaya, kejutan, atau misteri langsung?

time_pressure:
- Apakah ada countdown atau batas waktu yang terasa?
- Apakah penonton merasa waktu berjalan dan sesuatu akan terjadi?

visual_clarity:
- Apakah setiap kalimat bisa divisualisasikan secara konkret?
- Apakah ada kata abstrak yang sulit divisualisasikan?

escalation_quality:
- Apakah setiap 10 detik ada eskalasi baru?
- Apakah ketegangan meningkat secara progresif?

cause_effect_logic:
- Apakah ada sebab-akibat yang jelas antara kejadian?
- Apakah ada kalimat yang tidak logis atau membingungkan?

language_quality:
- Apakah bahasa natural dan mudah dibaca TTS?
- Apakah ada kalimat puitis berlebihan?
- Apakah ada kalimat lebih dari 12 kata?

Aturan rewrite:
- Jika score < 8, WAJIB berikan improved_script.
- Perbaiki semua problems yang terdeteksi.
- Jangan ubah makna cerita, hanya perbaiki kualitas.
- Setiap kalimat body maksimal 12 kata.
- Gunakan time pressure jika topik memungkinkan.
- Hindari kalimat abstrak, pakai visual konkret.
- Hindari ending anak meninggal.
- Jangan terlalu puitis.
- Pastikan sebab-akibat jelas.

Balas hanya JSON valid.`,
  promptDramaticStructure: `You are a dramatic structure architect for cinematic short-form video.

TASK:
Create a dramatic structure outline for the given video concept.

LANGUAGE RULE:
- All output must be in natural Indonesian.

OUTPUT FORMAT:
Return ONLY valid JSON object with this structure:
{
  "opening_shock": "...",
  "normal_world": "...",
  "first_anomaly": "...",
  "danger_escalation": "...",
  "personal_stakes": "...",
  "unexpected_twist": "...",
  "final_visual_payoff": "..."
}

STRUCTURE RULES:

opening_shock:
- 1-2 short sentences describing the first 0-3 seconds.
- Must immediately grab attention.
- Must create a visual that makes viewers stop scrolling.
- Example: "Semua orang melayang ke langit dalam hitungan detik."

normal_world:
- 1-2 sentences describing the situation BEFORE the event.
- Must be easy to understand and relatable.
- Grounds the viewer before the chaos begins.
- Example: "Sebuah kota kecil yang tenang di sore hari, anak-anak bermain di taman."

first_anomaly:
- 1-2 sentences describing the first sign that something is wrong.
- Must be visually specific and unsettling.
- This is the moment tension begins.
- Example: "Seorang anak menyadari mainannya tidak jatuh saat dilepas — melayang pelan."

danger_escalation:
- 2-3 sentences describing how the danger increases.
- Each sentence must show escalation: more danger, more people affected, more visual chaos.
- Must follow a clear cause-and-effect chain.
- Example: "Benda-benda kecil mulai melayang. Lalu manusia. Orang-orang berpegangan ke tiang saat gravitasi membalik arah."

personal_stakes:
- 1-2 sentences showing who is personally threatened.
- Must make the viewer care about a specific person.
- Example: "Seorang ibu berlari mengejar bayinya yang melayang semakin tinggi."

unexpected_twist:
- 1-2 sentences describing a reversal or surprise.
- Must change the viewer's understanding of what is happening.
- Example: "Hanya satu anak yang tetap menapak — dan bayangannya tergantung terbalik di langit."

final_visual_payoff:
- 1-2 sentences describing the final image.
- Must be the most visually striking moment of the entire video.
- Must be easy to remember and describe to others.
- Example: "Gravitasi kembali. Semua orang jatuh. Tapi bayangan anak itu tetap di langit — berdiri terbalik."

QUALITY RULES:
- Every field must describe a VISIBLE, CONCRETE event.
- No abstract concepts. No vague descriptions.
- The structure must escalate from calm to chaos to twist.
- Each step must be easy to visualize as a scene.
- The final_visual_payoff must be the most memorable image.

No markdown. No explanation. No text before or after JSON.`,
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

/** askLLM with custom Ollama options — used for Hook Lab and other stages needing specific token/ctx limits */
async function askLLMWithOptions(prompt: string, fallbackSystemInstruction: string, ollamaOptions: { num_predict?: number; temperature?: number; num_ctx?: number }): Promise<string> {
  const settings = localSettings;

  if (settings.backupGeminiMode) {
    // Gemini mode — just use askLLM (Gemini doesn't support these Ollama-specific options)
    return askLLM(prompt, fallbackSystemInstruction);
  }

  // Ollama-only mode with custom options
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
          temperature: ollamaOptions.temperature ?? 0.25,
          top_p: 0.8,
          num_ctx: ollamaOptions.num_ctx ?? 4096,
          num_predict: ollamaOptions.num_predict ?? 2048,
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
          `Model Ollama "${settings.llmModel}" tidak ditemukan! ` +
          `Silakan jalankan "ollama pull ${settings.llmModel}" di terminal Anda.`
        );
      }
      throw new Error(`Ollama status ${response.status}: ${errText || "Unknown error"}`);
    }
  } catch (ollamaErr: any) {
    throw new Error(
      `Koneksi Ollama ke ${settings.ollamaUrl} Gagal. Keterangan: ${ollamaErr.message}. ` +
      `Pastikan Ollama berjalan di localhost Anda secara lokal.`
    );
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
    // Generic template starters
    lower.startsWith("cinematic scene depicting") ||
    lower.startsWith("cinematic visual scene") ||
    lower.startsWith("cinematic wide-angle scene inspired") ||
    lower.startsWith("a breathtaking, photorealistic depiction") ||
    lower.startsWith("a cinematic, photorealistic depiction") ||
    lower.startsWith("a stunning, cinematic depiction") ||
    lower.startsWith("a dramatic cinematic scene") ||
    lower.startsWith("a photorealistic cinematic scene") ||
    // Generic material/texture phrases
    lower.includes("rough stone, smooth metal, soft fabric") ||
    lower.includes("cinematic chiaroscuro effect") ||
    lower.includes("richly textured composition with dramatic directional lighting") ||
    lower.includes("volumetric light rays, subtle haze, and layered depth") ||
    lower.includes("photorealistic, richly textured composition") ||
    // Generic LLM fillers with no real scene content
    lower.includes("every detail rendered with precision") ||
    lower.includes("every detail meticulously rendered") ||
    lower.includes("ultra-realistic detail and cinematic atmosphere") ||
    lower.includes("hyper-realistic detail and cinematic composition") ||
    lower.includes("stunning photorealistic quality") ||
    lower.includes("breathtaking cinematic quality") ||
    // Repetitive filler patterns
    (wordCount < 60 && (lower.match(/cinematic/g) || []).length >= 3) ||
    (wordCount < 60 && (lower.match(/photorealistic/g) || []).length >= 2)
  );
}

/** Detect bad/generic motion prompts — too short, template fallback, or camera-only without detail */
function isBadMotionPrompt(prompt: string): boolean {
  const lower = String(prompt || "").toLowerCase().trim();
  const wordCount = String(prompt || "").trim().split(/\s+/).filter(Boolean).length;
  return (
    !prompt ||
    wordCount < 25 ||
    // Generic camera-only template phrases
    lower.includes("steady cinematic tracking shot moving forward") ||
    lower.includes("the camera executes a slow, cinematic dolly-forward movement") ||
    lower.includes("smooth, deliberate pacing") ||
    lower.includes("professional cinematic feel throughout") ||
    lower.includes("steady forward tracking shot") ||
    lower.includes("a slow and steady cinematic dolly-forward") ||
    lower.includes("camera slowly tracks forward") && wordCount < 30 ||
    lower.includes("camera gently moves forward") && wordCount < 30 ||
    // Camera-only with no subject/environment motion
    lower.includes("the camera slowly pulls back") && wordCount < 30 ||
    lower.includes("the camera slowly zooms in") && wordCount < 30 ||
    // Too-short camera-only starters
    lower.startsWith("slow zoom in") && wordCount < 15 ||
    lower.startsWith("cinematic dolly forward") && wordCount < 15 ||
    lower.startsWith("subtle handheld motion") && wordCount < 15 ||
    lower.startsWith("dramatic aerial pullback") && wordCount < 15 ||
    lower.startsWith("fast pan across") && wordCount < 15 ||
    lower.startsWith("slow push in") && wordCount < 15 ||
    lower.startsWith("gentle tracking shot") && wordCount < 15 ||
    // Repetitive filler: too many "cinematic" with few real details
    (wordCount < 40 && (lower.match(/cinematic/g) || []).length >= 2 && !lower.includes("subject") && !lower.includes("environment"))
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
    t.includes("tentara") || t.includes("dokter") || t.includes("pengemudi") ||
    t.includes("people") || t.includes("person") || t.includes("man") ||
    t.includes("woman") || t.includes("child") || t.includes("baby") ||
    t.includes("mother") || t.includes("father") || t.includes("teenager") ||
    t.includes("farmer") || t.includes("soldier") || t.includes("doctor") ||
    t.includes("driver") || t.includes("victim") || t.includes("survivor") ||
    t.includes("crowd") || t.includes("family") || t.includes("elderly")
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
    t.includes("tanaman") || t.includes("akar") || t.includes("cabang") ||
    t.includes("tree") || t.includes("park") || t.includes("leaf") ||
    t.includes("grass") || t.includes("flower") || t.includes("forest") ||
    t.includes("plant") || t.includes("root") || t.includes("branch") ||
    t.includes("garden") || t.includes("vegetation") || t.includes("canopy")
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
    t.includes("pengemudi") || t.includes("rem") || t.includes("kecepatan") ||
    t.includes("car") || t.includes("vehicle") || t.includes("motorcycle") ||
    t.includes("truck") || t.includes("plane") || t.includes("ship") ||
    t.includes("train") || t.includes("helicopter") || t.includes("brake") ||
    t.includes("speed") || t.includes("traffic") || t.includes("highway")
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
    t.includes("atap") || t.includes("kolom") || t.includes("pondasi") ||
    t.includes("building") || t.includes("construction") || t.includes("tower") ||
    t.includes("bridge") || t.includes("glass") || t.includes("steel") ||
    t.includes("concrete") || t.includes("wall") || t.includes("roof") ||
    t.includes("pillar") || t.includes("foundation") || t.includes("skyscraper")
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
    t.includes("tsunami") || t.includes("danau") || t.includes("pantai") ||
    t.includes("water") || t.includes("ocean") || t.includes("river") ||
    t.includes("rain") || t.includes("flood") || t.includes("wave") ||
    t.includes("lake") || t.includes("beach") || t.includes("coast") ||
    t.includes("shore") || t.includes("sea") || t.includes("storm surge")
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
    t.includes("jilat") || t.includes("bara") || t.includes("kilat") ||
    t.includes("fire") || t.includes("explosion") || t.includes("blast") ||
    t.includes("burning") || t.includes("smoke") || t.includes("heat") ||
    t.includes("flame") || t.includes("ember") || t.includes("lightning") ||
    t.includes("inferno") || t.includes("blaze") || t.includes("detonation")
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

/** Build a context-aware motion fallback — varies by scene content (Indonesian + English keywords) */
function buildFallbackMotionPrompt(theme: string): string {
  const t = String(theme || "").toLowerCase();

  // ── Chaos / Action / Panic → handheld tracking with shake ──
  if (
    t.includes("panik") || t.includes("berlari") || t.includes("berteriak") ||
    t.includes("terlempar") || t.includes("jatuh") || t.includes("hancur") ||
    t.includes("meledak") || t.includes("guncang") || t.includes("terdorong") ||
    t.includes("panic") || t.includes("running") || t.includes("screaming") ||
    t.includes("thrown") || t.includes("falling") || t.includes("destroyed") ||
    t.includes("explosion") || t.includes("shaking") || t.includes("chaos") ||
    t.includes("collaps") || t.includes("crash") || t.includes("erupt") ||
    t.includes("flee") || t.includes("rush") || t.includes("impact")
  ) {
    return `Urgent handheld tracking shot following the chaos at street level, with controlled camera shake, fast parallax between foreground debris and background structures, subtle subject movement, and realistic environmental motion while preserving the original scene layout.`;
  }

  // ── Landscape / Environment / City → wide cinematic pullback ──
  if (
    t.includes("langit") || t.includes("kota") || t.includes("bumi") ||
    t.includes("bangunan") || t.includes("gedung") || t.includes("jalan") ||
    t.includes("pantai") || t.includes("laut") || t.includes("gunung") ||
    t.includes("sky") || t.includes("city") || t.includes("earth") ||
    t.includes("building") || t.includes("street") || t.includes("beach") ||
    t.includes("ocean") || t.includes("mountain") || t.includes("landscape") ||
    t.includes("horizon") || t.includes("coast") || t.includes("bridge") ||
    t.includes("tower") || t.includes("skyline") || t.includes("aerial")
  ) {
    return `Slow wide cinematic pullback revealing the scale of the scene, with gentle atmospheric drift, subtle movement in distant elements, realistic lighting shifts, and stable composition to preserve architectural and environmental details.`;
  }

  // ── People / Human → intimate push-in ──
  if (
    t.includes("anak") || t.includes("tangan") || t.includes("wajah") ||
    t.includes("tubuh") || t.includes("orang") || t.includes("pria") ||
    t.includes("wanita") || t.includes("bayi") || t.includes("ibu") ||
    t.includes("child") || t.includes("hand") || t.includes("face") ||
    t.includes("body") || t.includes("person") || t.includes("man") ||
    t.includes("woman") || t.includes("baby") || t.includes("mother") ||
    t.includes("people") || t.includes("crowd") || t.includes("victim") ||
    t.includes("survivor") || t.includes("family") || t.includes("elderly")
  ) {
    return `Intimate slow push-in toward the human subject, with subtle handheld tremor, small body movement, drifting dust particles, and restrained background motion to keep the person stable and realistic.`;
  }

  // ── Objects / Water / Nature → observational drift ──
  if (
    t.includes("air") || t.includes("botol") || t.includes("daun") ||
    t.includes("benda") || t.includes("debu") || t.includes("mobil") ||
    t.includes("pohon") || t.includes("kaca") ||
    t.includes("water") || t.includes("bottle") || t.includes("leaf") ||
    t.includes("object") || t.includes("dust") || t.includes("car") ||
    t.includes("tree") || t.includes("glass") || t.includes("debris") ||
    t.includes("wreckage") || t.includes("rubble") || t.includes("flood") ||
    t.includes("rain") || t.includes("wind") || t.includes("fire")
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

/** Validate concept against topic for logical contradictions.
 *  E.g. topic "air mengering" should NOT produce "tenggelam/banjir". */
function validateConceptAgainstTopic(topic: string, concept: any): { ok: boolean; reason: string } {
  const text = JSON.stringify(concept).toLowerCase();
  const topicLower = topic.toLowerCase();

  // Air mengering → tidak boleh ada tenggelam/banjir/gelombang air
  if (topicLower.includes("air") && topicLower.includes("mengering")) {
    if (text.includes("tenggelam") || text.includes("banjir") || text.includes("gelombang air")) {
      return {
        ok: false,
        reason: "Konsep bertentangan: topik air mengering, tetapi output berisi tenggelam/banjir/gelombang air."
      };
    }
  }

  // Udara hilang → tidak boleh ada angin kencang/badai
  if (topicLower.includes("udara") && topicLower.includes("hilang")) {
    if (text.includes("angin kencang") || text.includes("badai")) {
      return {
        ok: false,
        reason: "Konsep bertentangan: topik udara hilang, tetapi output berisi angin kencang/badai."
      };
    }
  }

  // Matahari padam → tidak boleh ada cahaya matahari/sinar matahari
  if (topicLower.includes("matahari") && (topicLower.includes("padam") || topicLower.includes("mati"))) {
    if (text.includes("cahaya matahari") || text.includes("sinar matahari") || text.includes("mentari bersinar")) {
      return {
        ok: false,
        reason: "Konsep bertentangan: topik matahari padam, tetapi output berisi cahaya matahari."
      };
    }
  }

  // Gravitasi hilang → tidak boleh ada jatuh/terjatuh (ke bawah)
  if (topicLower.includes("gravitasi") && topicLower.includes("hilang")) {
    if (text.includes("jatuh ke bawah") || text.includes("terjatuh ke tanah")) {
      return {
        ok: false,
        reason: "Konsep bertentangan: topik gravitasi hilang, tetapi output berisi jatuh ke bawah."
      };
    }
  }

  // Es mencair → tidak boleh ada membeku
  if (topicLower.includes("es") && topicLower.includes("mencair")) {
    if (text.includes("membeku") || text.includes("mengeras")) {
      return {
        ok: false,
        reason: "Konsep bertentangan: topik es mencair, tetapi output berisi membeku/mengeras."
      };
    }
  }

  return { ok: true, reason: "" };
}

/** Detect if text contains English diagnostic phrases (should be in Indonesian) */
function containsEnglishDiagnostic(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const englishPhrases = [
    "lack of", "personal stakes", "emotional", "conflict is weak",
    "visual potential", "payoff", "rewrite", "not enough",
    "needs more", "could be stronger", "weak hook", "poor escalation",
    "unclear motivation", "no clear conflict", "missing emotional",
    "the hook is", "the story", "the concept", "the ending",
    "this video", "the viewer", "the audience", "the script",
    "should be", "needs to", "fails to", "does not",
    "it lacks", "missing a", "there is no", "not compelling",
  ];
  const lower = text.toLowerCase();
  return englishPhrases.some(phrase => lower.includes(phrase));
}

/** Ensure all string values in a JSON object are in Indonesian.
 *  If English diagnostic phrases are detected, flag for rewrite. */
function validateIndonesianOutput(data: any): { isIndonesian: boolean; englishFields: string[] } {
  if (!data || typeof data !== "object") return { isIndonesian: true, englishFields: [] };

  const englishFields: string[] = [];

  function checkValue(value: any, path: string) {
    if (typeof value === "string" && containsEnglishDiagnostic(value)) {
      englishFields.push(path);
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => checkValue(item, `${path}[${i}]`));
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) {
        checkValue(v, path ? `${path}.${k}` : k);
      }
    }
  }

  checkValue(data, "");
  return { isIndonesian: englishFields.length === 0, englishFields };
}

/** Robust JSON extractor — handles markdown wrapping, text before/after, and both object/array roots */
function extractJsonObject(text: string): any {
  if (!text || typeof text !== "string") {
    throw new Error("LLM response kosong");
  }

  // Step 1: Strip markdown code blocks and common wrappers
  let cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  // Step 1b: Clean trailing broken key/value pairs like ,"\n\n\n or ,"key"\n\n\n
  // These happen when LLM output gets cut off mid-JSON
  cleaned = cleaned.replace(/,\s*"[^"]*"\s*:\s*"[^"]*$/s, ""); // trailing incomplete key-value
  cleaned = cleaned.replace(/,\s*"[^"]*"\s*:\s*\d+\s*$/s, ""); // trailing incomplete numeric value
  cleaned = cleaned.replace(/,\s*"[^"]*"\s*:\s*$/s, ""); // trailing key with no value
  cleaned = cleaned.replace(/,\s*$/s, ""); // trailing comma before closing bracket

  // Step 2: Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Step 3: Balanced-bracket extraction for JSON objects
  const firstObj = cleaned.indexOf("{");
  if (firstObj !== -1) {
    const extracted = extractBalancedJson(cleaned, firstObj, "{", "}");
    if (extracted !== null) {
      try {
        return JSON.parse(extracted);
      } catch {}
      // Try cleaning the extracted content — remove trailing broken key-value pairs
      const cleanedExtracted = cleanTrailingBrokenJson(extracted);
      if (cleanedExtracted !== extracted) {
        try {
          return JSON.parse(cleanedExtracted);
        } catch {}
      }
    }
  }

  // Step 4: Balanced-bracket extraction for JSON arrays
  const firstArr = cleaned.indexOf("[");
  if (firstArr !== -1) {
    const extracted = extractBalancedJson(cleaned, firstArr, "[", "]");
    if (extracted !== null) {
      try {
        return JSON.parse(extracted);
      } catch {}
      const cleanedExtracted = cleanTrailingBrokenJson(extracted);
      if (cleanedExtracted !== extracted) {
        try {
          return JSON.parse(cleanedExtracted);
        } catch {}
      }
    }
  }

  // Step 5: Try both start characters — pick whichever comes first and parses
  const startChar = Math.min(
    firstObj !== -1 ? firstObj : Infinity,
    firstArr !== -1 ? firstArr : Infinity
  );
  if (startChar !== Infinity) {
    const openChar = cleaned[startChar];
    const closeChar = openChar === "{" ? "}" : "]";
    const extracted = extractBalancedJson(cleaned, startChar, openChar, closeChar);
    if (extracted !== null) {
      try {
        return JSON.parse(extracted);
      } catch {}
      const cleanedExtracted = cleanTrailingBrokenJson(extracted);
      if (cleanedExtracted !== extracted) {
        try {
          return JSON.parse(cleanedExtracted);
        } catch {}
      }
    }
  }

  // Step 6: Last resort — strip all non-JSON characters and try
  const jsonOnly = cleaned.replace(/^[^{\[]*/, "").replace(/[^}\]]*$/, "");
  if (jsonOnly.length > 2) {
    try {
      return JSON.parse(jsonOnly);
    } catch {}
    const cleanedJsonOnly = cleanTrailingBrokenJson(jsonOnly);
    if (cleanedJsonOnly !== jsonOnly) {
      try {
        return JSON.parse(cleanedJsonOnly);
      } catch {}
    }
  }

  throw new Error("No valid JSON found in LLM response");
}

/** Clean trailing broken JSON content — removes incomplete key-value pairs at the end of a JSON string.
 *  Handles cases like: {"key": "value", "broken_key": "\n\n\n or {"key": "value", "broken": */
function cleanTrailingBrokenJson(jsonStr: string): string {
  // Strategy: find the last valid closing structure and trim everything after it
  // Remove trailing broken key-value patterns before the closing bracket

  // Pattern 1: ,"key"\n\n... (broken string value with newlines)
  let result = jsonStr.replace(/,\s*"[^"]*"\s*:\s*"[^"]*$/s, "");
  // Pattern 2: ,"key": number_without_closing
  result = result.replace(/,\s*"[^"]*"\s*:\s*\d+\s*$/s, "");
  // Pattern 3: ,"key": (no value at all)
  result = result.replace(/,\s*"[^"]*"\s*:\s*$/s, "");
  // Pattern 4: ,"key" (no colon or value)
  result = result.replace(/,\s*"[^"]*"\s*$/s, "");
  // Pattern 5: trailing comma before closing
  result = result.replace(/,(\s*[}\]])/s, "$1");
  // Pattern 6: trailing whitespace/newlines before closing bracket
  result = result.replace(/,?\s+([}\]])/s, "$1");

  return result;
}

/** Repair broken JSON by asking the LLM to fix it against a known schema */
async function repairJsonWithLLM(raw: string, schemaDescription: string): Promise<any> {
  const repairPrompt = `/no_think
Perbaiki teks berikut menjadi JSON valid sesuai schema.
Jangan beri penjelasan.
Jangan pakai markdown.
Balas hanya JSON valid.

Schema:
${schemaDescription}

Teks rusak:
${raw.slice(0, 2000)}`;

  const repairResponse = await askLLM(
    repairPrompt,
    "Kamu adalah mesin JSON murni. Balas hanya JSON valid tanpa markdown tanpa penjelasan."
  );
  return extractJsonObject(repairResponse);
}

/** Extract balanced JSON substring starting at a given position.
 *  Handles nested brackets and string literals (ignores brackets inside strings). */
function extractBalancedJson(text: string, startPos: number, openChar: string, closeChar: string): string | null {
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startPos; i < text.length; i++) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === "\\" && inString) {
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === openChar) depth++;
    if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(startPos, i + 1);
      }
    }
  }

  // Truncated JSON — try to close it
  if (depth > 0) {
    const partial = text.slice(startPos);
    const suffix = closeChar.repeat(depth);
    try {
      JSON.parse(partial + suffix);
      return partial + suffix;
    } catch {}
  }

  return null;
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

// ── Image Generation Router ──────────────────────────────────────────────────
// Routes image generation to the selected provider (ComfyUI or Z-Image Turbo).
// Both providers return { dataUrl, filePath } for consistent downstream usage.

async function generateSceneImage(
  prompt: string,
  negativePrompt: string,
  seed: number | undefined,
  outputDir: string,
  filename: string,
  settings: any,
  comfyConfig: ComfyUIConfig,
  logFn?: (msg: string) => void
): Promise<{ dataUrl: string | null; filePath: string | null }> {
  const provider = settings.imageProvider || "comfyui";

  if (provider === "zimage_turbo") {
    // ── Z-Image Turbo Provider ─────────────────────────────────────────────
    const turboSettings: ZImageTurboSettings = {
      zImageTurboUrl: settings.zImageTurboUrl || "http://127.0.0.1:9000",
      imageWidth: settings.imageWidth || 512,
      imageHeight: settings.imageHeight || 896,
      imageSteps: settings.imageSteps || 8,
      imageCfg: settings.imageCfg ?? 1.0,  // use ?? so cfg=0 is valid
      zImageVaePath: settings.zImageVaePath || "D:\\Z-Image-Turbo-Windows\\models\\vae\\ae.safetensors",
      zImageLlmPath: settings.zImageLlmPath || "D:\\Z-Image-Turbo-Windows\\models\\llm\\Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
      zImageLoras: settings.zImageLoras || "",
      zImageLoraStrength: settings.zImageLoraStrength ?? 1.0,
    };

    logFn?.(`[Z-IMAGE TURBO] Generating image with Z-Image Turbo (${turboSettings.imageWidth}x${turboSettings.imageHeight}, steps=${turboSettings.imageSteps}, cfg=${turboSettings.imageCfg})...`);

    const result = await generateImageWithZImageTurbo({
      prompt,
      // negativePrompt is NOT sent to Z-Image Turbo — kept for API compat only
      seed: seed ?? 0,  // 0 = random in Z-Image Turbo
      outputDir,
      filename,
      settings: turboSettings,
    });

    logFn?.(`[Z-IMAGE TURBO] Image generated: ${result.filePath || "no file path"}`);
    return result;
  }

  // ── Default: ComfyUI Provider ─────────────────────────────────────────────
  logFn?.(`[COMFYUI] Generating image with ComfyUI (checkpoint: ${comfyConfig.comfyCheckpoint})...`);

  const result = await comfyGenerateImage(
    comfyConfig,
    prompt,
    logFn,
    seed,
    outputDir
  );

  return result;
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
    project.status = "hook_lab";
    project.progress = 15;
    saveAndPublish(project);
    return;
  }

  // ── HOOK LAB: Generate multiple hooks ───────────────────
  if (project.status === "hook_lab") {
    project.logs.push(`[HOOK LAB] Expanding concept into hooks...`);
    project.currentStepMessage = "Hook Lab: generating 8 hooks...";
    project.progress = 18;

    const hookLabPrompt = `Topik: "${project.topic}"
Konsep terpilih: "${project.selectedIdea}"`;

    let hookLabData: any = { hooks: [], best_hook_index: 0 };
    let hookLabSuccess = false;
    const MAX_HOOK_LAB_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_HOOK_LAB_RETRIES; attempt++) {
      try {
        // Use custom Ollama options for Hook Lab: lower temperature, limited tokens
        const rawResponse = await askLLMWithOptions(
          hookLabPrompt,
          settings.promptHookLab || DEFAULT_SETTINGS.promptHookLab,
          { num_predict: 2048, temperature: 0.25, num_ctx: 4096 }
        );
        console.log(`[LLM RAW RESPONSE] Hook Lab attempt ${attempt + 1} (${rawResponse.length} chars):`, rawResponse.slice(0, 2000));

        const parsed = extractJsonObject(rawResponse);
        // Accept hooks array — handle both "hook" and "text" field names
        if (parsed?.hooks && Array.isArray(parsed.hooks) && parsed.hooks.length > 0) {
          hookLabData = parsed;
          hookLabSuccess = true;
          break;
        }

        // If no hooks but has an array at top level, try as hooks
        if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0]?.hook || parsed[0]?.text)) {
          hookLabData = { hooks: parsed, best_hook_index: 0 };
          hookLabSuccess = true;
          break;
        }

        project.logs.push(`[HOOK LAB] Attempt ${attempt + 1}: JSON parsed but no hooks array found. Retrying...`);
      } catch (e: any) {
        console.warn(`[HOOK LAB] Attempt ${attempt + 1} failed: ${e.message}`);

        // Attempt repair: ask LLM to fix its own broken JSON
        if (attempt < MAX_HOOK_LAB_RETRIES) {
          project.logs.push(`[HOOK LAB] Attempting JSON repair with LLM...`);
          try {
            const hookLabSchema = `{
  "hooks": [{ "hook": "string", "type": "countdown|shock|danger|mystery|whatif", "curiosity_gap": "string", "emotional_trigger": "string", "visual_opening": "string", "strength": 1 }],
  "best_hook_index": 0
}`;
            const repaired = await repairJsonWithLLM(
              e.message.includes("No valid JSON") ? "Response tidak terparse" : "Format salah",
              hookLabSchema
            );
            if (repaired?.hooks && Array.isArray(repaired.hooks) && repaired.hooks.length > 0) {
              hookLabData = repaired;
              hookLabSuccess = true;
              break;
            }
          } catch (repairErr: any) {
            console.warn(`[HOOK LAB] Repair attempt failed: ${repairErr.message}`);
          }
        }
      }
    }

    // Validate concept against topic for contradictions
    const conceptValidation = validateConceptAgainstTopic(project.topic, hookLabData);
    if (!conceptValidation.ok) {
      project.logs.push(`[HOOK LAB] CONTRADICTION: ${conceptValidation.reason}. Requesting rewrite...`);
      try {
        const rewritePrompt = `/no_think
Topik: "${project.topic}"
Konsep terpilih: "${project.selectedIdea}"

KONTRADIKSI TERDETEKSI: ${conceptValidation.reason}

Buat ulang Hook Lab yang KONSISTEN dengan topik.
Jangan sertakan konsep yang bertentangan dengan topik.

Schema:
{
  "hooks": [{ "hook": "string", "type": "countdown|shock|danger|mystery|whatif", "curiosity_gap": "string", "emotional_trigger": "string", "visual_opening": "string", "strength": 1 }],
  "best_hook_index": 0
}

Buat tepat 8 hook. Semua value string WAJIB Bahasa Indonesia.
Balas hanya JSON valid.`;
        const rewriteResponse = await askLLMWithOptions(
          rewritePrompt,
          settings.promptHookLab || DEFAULT_SETTINGS.promptHookLab,
          { num_predict: 2048, temperature: 0.25, num_ctx: 4096 }
        );
        const rewriteParsed = extractJsonObject(rewriteResponse);
        if (rewriteParsed?.hooks && Array.isArray(rewriteParsed.hooks) && rewriteParsed.hooks.length > 0) {
          hookLabData = rewriteParsed;
          project.logs.push(`[HOOK LAB] Rewrite successful after contradiction fix.`);
        }
      } catch (rewriteErr: any) {
        console.warn(`[HOOK LAB] Contradiction rewrite failed: ${rewriteErr.message}`);
      }
    }

    // Select the strongest hook (highest strength score or best_hook_index)
    if (hookLabData.hooks?.length > 0) {
      const bestIdx = hookLabData.best_hook_index ?? -1;
      const bestHook = (bestIdx >= 0 && bestIdx < hookLabData.hooks.length)
        ? hookLabData.hooks[bestIdx]
        : hookLabData.hooks.reduce((best: any, h: any) =>
            (h.strength || 0) > (best.strength || 0) ? h : best, hookLabData.hooks[0]);
      project.logs.push(`[HOOK LAB] Best hook (strength ${bestHook.strength || "?"}): "${bestHook.hook || bestHook.text || ""}"`);
      // Enhance selectedIdea with best hook
      if (bestHook.hook || bestHook.text) {
        project.selectedIdea = bestHook.hook || bestHook.text;
      }
    }

    // Store Hook Lab data on project for downstream stages
    project.hookLabData = JSON.stringify({
      hooks: hookLabData.hooks || [],
      best_hook_index: hookLabData.best_hook_index ?? 0,
    });

    project.logs.push(`[HOOK LAB] ${hookLabData.hooks?.length || 0} hooks generated.`);

    if (!hookLabSuccess) {
      project.logs.push(`[HOOK LAB] WARNING: All attempts failed. Proceeding with original concept.`);
    }

    project.status = "story_doctor";
    project.progress = 20;
    saveAndPublish(project);
    return;
  }

  // ── STORY DOCTOR: Evaluate story quality, rewrite if weak ───────────────────
  if (project.status === "story_doctor") {
    project.logs.push(`[STORY DOCTOR] Evaluating story quality...`);
    project.currentStepMessage = "Story Doctor: diagnosing narrative strength...";
    project.progress = 22;

    let currentConcept = project.selectedIdea;
    // Include Hook Lab best hook if available
    let hookContext = "";
    try {
      const hld = project.hookLabData ? JSON.parse(project.hookLabData) : null;
      if (hld) {
        if (hld.best_hook_index !== undefined && hld.hooks?.[hld.best_hook_index]) {
          hookContext += `\nHook terpilih: "${hld.hooks[hld.best_hook_index].hook || hld.hooks[hld.best_hook_index].text}"`;
        }
        if (hld.hooks?.length > 0) {
          hookContext += `\nSemua hook tersedia: ${hld.hooks.map((h: any) => h.hook || h.text || "").filter(Boolean).join(" | ")}`;
        }
      }
    } catch {}

    let doctorPrompt = `Topik: "${project.topic}"
Konsep terpilih: "${currentConcept}"${hookContext}`;

    let doctorResult: any = { overall_score: 0, main_weakness: "", rewrite_plan: "" };
    let doctorPassed = false;
    const MAX_DOCTOR_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_DOCTOR_RETRIES; attempt++) {
      try {
        const rawResponse = await askLLM(
          doctorPrompt,
          settings.promptStoryDoctor || DEFAULT_SETTINGS.promptStoryDoctor
        );
        console.log(`[LLM RAW RESPONSE] Story Doctor attempt ${attempt + 1} (${rawResponse.length} chars):`, rawResponse.slice(0, 2000));

        const parsed = extractJsonObject(rawResponse);
        if (parsed?.overall_score !== undefined) {
          doctorResult = parsed;
        }

        // Validate Indonesian language in output
        const langCheck = validateIndonesianOutput(doctorResult);
        if (!langCheck.isIndonesian) {
          project.logs.push(`[STORY DOCTOR] WARNING: English detected in fields: ${langCheck.englishFields.join(", ")}. Forcing Indonesian.`);
          // Auto-fix: add language enforcement to retry
          if (doctorResult.main_weakness && containsEnglishDiagnostic(doctorResult.main_weakness)) {
            doctorResult.main_weakness = "Keluaran masih dalam Bahasa Inggris, perlu diperbaiki ke Bahasa Indonesia";
          }
          if (doctorResult.rewrite_plan && containsEnglishDiagnostic(doctorResult.rewrite_plan)) {
            doctorResult.rewrite_plan = "Tulis ulang semua dalam Bahasa Indonesia natural";
          }
        }

        const score = Number(doctorResult.overall_score || 0);
        project.logs.push(`[STORY DOCTOR] Attempt ${attempt + 1}: overall_score=${score}, weakness="${doctorResult.main_weakness || "none"}"`);

        if (score >= 8) {
          doctorPassed = true;
          break;
        }

        // Score < 8: use the improved concept for next attempt WITH feedback
        if (doctorResult.improved_concept) {
          const improved = doctorResult.improved_concept;
          currentConcept = improved.title || improved.hook || currentConcept;
          project.selectedIdea = currentConcept;

          // CRITICAL: Include previous diagnosis as feedback for retry
          doctorPrompt = `Topik: "${project.topic}"
Konsep sebelumnya: "${currentConcept}"

HASIL DIAGNOSA SEBELUMNYA:
- Skor: ${score}/10
- Kelemahan utama: ${doctorResult.main_weakness || "tidak teridentifikasi"}
- Rencana perbaikan: ${doctorResult.rewrite_plan || "tidak ada"}
${hookContext}

Perbaiki konsep agar skor minimal 8.
Wajib:
- Hook lebih mengejutkan.
- Konflik muncul dalam 3 detik.
- Ada visual besar.
- Ada personal stakes ringan, bukan melodrama.
- Ending punya payoff visual.
- Semua value string WAJIB Bahasa Indonesia.`;

          project.logs.push(`[STORY DOCTOR] Rewriting with improved concept + feedback: "${currentConcept}"`);
        }
      } catch (e: any) {
        console.warn(`[STORY DOCTOR] Attempt ${attempt + 1} failed: ${e.message}`);
      }
    }

    // Store diagnosis
    project.storyScore = String(doctorResult.overall_score || 0);
    project.storyDiagnosis = JSON.stringify({
      overall_score: doctorResult.overall_score || 0,
      hook_score: doctorResult.hook_score || 0,
      conflict_score: doctorResult.conflict_score || 0,
      curiosity_gap_score: doctorResult.curiosity_gap_score || 0,
      visual_potential_score: doctorResult.visual_potential_score || 0,
      emotional_stakes_score: doctorResult.emotional_stakes_score || 0,
      ending_payoff_score: doctorResult.ending_payoff_score || 0,
      main_weakness: doctorResult.main_weakness || "",
      rewrite_plan: doctorResult.rewrite_plan || "",
      doctor_passed: doctorPassed,
    });

    if (!doctorPassed) {
      project.logs.push(`[STORY DOCTOR] WARNING: Story score still below 8 after rewrites. Proceeding with best available version.`);
    } else {
      project.logs.push(`[STORY DOCTOR] ✅ Story quality approved (score ≥ 8).`);
    }

    // Generate Visual Bible for this project
    project.logs.push(`[VISUAL BIBLE] Generating visual consistency rules...`);
    try {
      const biblePrompt = `Create a Visual Bible for an AI-generated faceless YouTube video about this concept:
Topic: "${project.topic}"
Concept: "${project.selectedIdea}"

Return ONLY valid JSON with this structure:
{
  "visual_style": "cinematic realistic Indonesian disaster thriller",
  "main_character": "description of main character (age, appearance, clothing)",
  "world_setting": "description of world/location",
  "color_palette": "warm orange sunset, dusty gray, emergency red accents",
  "camera_language": "close-up panic, handheld documentary, slow push-in",
  "lighting": "natural warm light, flickering electricity, atmospheric dust",
  "negative_prompt": "text, watermark, logo, distorted face, extra fingers, bad anatomy"
}`;
      const bibleResponse = await askLLM(biblePrompt, "You are a visual director creating consistency rules for AI video production. Output ONLY valid JSON.");
      const bibleParsed = extractJsonObject(bibleResponse);
      project.visualBible = JSON.stringify(bibleParsed);
      project.logs.push(`[VISUAL BIBLE] Generated: style="${bibleParsed?.visual_style || "default"}", character="${(bibleParsed?.main_character || "").substring(0, 60)}..."`);
    } catch (e: any) {
      project.visualBible = JSON.stringify({
        visual_style: "cinematic realistic Indonesian disaster thriller",
        main_character: "Indonesian person, everyday clothing",
        world_setting: "modern Indonesian neighborhood",
        color_palette: "warm orange, dusty gray, emergency red",
        camera_language: "handheld documentary, slow push-in",
        lighting: "natural warm light, atmospheric dust",
        negative_prompt: "text, watermark, logo, distorted face, bad anatomy",
      });
      project.logs.push(`[VISUAL BIBLE] Fallback default applied.`);
    }

    // Generate Dramatic Structure
    project.logs.push(`[DRAMATIC STRUCTURE] Creating story arc...`);
    try {
      const structurePrompt = `Concept: "${project.selectedIdea}"
Topic: "${project.topic}"`;
      const structureResponse = await askLLM(
        structurePrompt,
        settings.promptDramaticStructure || DEFAULT_SETTINGS.promptDramaticStructure
      );
      const structureParsed = extractJsonObject(structureResponse);
      project.dramaticStructure = JSON.stringify(structureParsed);
      project.logs.push(`[DRAMATIC STRUCTURE] Created: opening="${(structureParsed?.opening_shock || "").substring(0, 60)}...", twist="${(structureParsed?.unexpected_twist || "").substring(0, 60)}..."`);
    } catch (e: any) {
      project.dramaticStructure = JSON.stringify({
        opening_shock: project.selectedIdea,
        normal_world: "Situasi normal sebelum peristiwa terjadi",
        first_anomaly: "Keanehan pertama yang terlihat",
        danger_escalation: "Bahaya meningkat dengan cepat",
        personal_stakes: "Seseorang terancam secara langsung",
        unexpected_twist: "Perubahan arah cerita yang tak terduga",
        final_visual_payoff: "Gambar akhir yang kuat dan berkesan",
      });
      project.logs.push(`[DRAMATIC STRUCTURE] Fallback structure applied.`);
    }

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
        atomicLines = parsed.map((l: any) => typeof l === "string" ? l : (l?.text || l?.line || String(l)));
      } else if (parsed && Array.isArray(parsed.lines)) {
        atomicLines = parsed.lines.map((l: any) => typeof l === "string" ? l : (l?.text || l?.line || String(l)));
      } else if (parsed && Array.isArray(parsed.atomic_lines)) {
        atomicLines = parsed.atomic_lines.map((l: any) => typeof l === "string" ? l : (l?.text || l?.line || String(l)));
      } else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Handle object with numeric keys: {"1": "line1", "2": "line2"}
        const keys = Object.keys(parsed).map(Number).filter(k => !isNaN(k)).sort((a, b) => a - b);
        if (keys.length > 0) {
          atomicLines = keys.map(k => String(parsed[k] || ""));
        } else {
          // Last resort: extract all string values from the object
          const stringValues = Object.values(parsed).filter(v => typeof v === "string" && v.length > 0) as string[];
          if (stringValues.length > 0) {
            atomicLines = stringValues;
          } else {
            throw new Error("Splitter output has no usable array");
          }
        }
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

    project.status = "script_doctor";
    project.progress = 42;
    saveAndPublish(project);
    return;
  }

  // ── SCRIPT DOCTOR: Evaluate script quality, rewrite if weak ─────────────────
  if (project.status === "script_doctor") {
    project.logs.push(`[SCRIPT DOCTOR] Evaluating script quality...`);
    project.currentStepMessage = "Script Doctor: diagnosing script strength...";
    project.progress = 45;

    const scriptObj = project.script as any;
    let scriptDoctorPrompt = `Topik: "${project.topic}"
Konsep: "${project.selectedIdea}"

Skrip saat ini:
Hook: ${scriptObj?.hook || ""}
Intro: ${scriptObj?.intro || ""}
Body: ${JSON.stringify(scriptObj?.body || [])}
CTA: ${scriptObj?.cta || ""}`;

    let scriptDoctorResult: any = { score: 0, problems: [], rewrite_needed: true };
    let scriptDoctorPassed = false;
    const MAX_SCRIPT_DOCTOR_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_SCRIPT_DOCTOR_RETRIES; attempt++) {
      try {
        const rawResponse = await askLLM(
          scriptDoctorPrompt,
          settings.promptScriptDoctor || DEFAULT_SETTINGS.promptScriptDoctor
        );
        console.log(`[LLM RAW RESPONSE] Script Doctor attempt ${attempt + 1} (${rawResponse.length} chars):`, rawResponse.slice(0, 2000));

        const parsed = extractJsonObject(rawResponse);
        if (parsed?.score !== undefined) {
          scriptDoctorResult = parsed;
        }

        // Validate Indonesian language in output
        const scriptLangCheck = validateIndonesianOutput(scriptDoctorResult);
        if (!scriptLangCheck.isIndonesian) {
          project.logs.push(`[SCRIPT DOCTOR] WARNING: English detected in fields: ${scriptLangCheck.englishFields.join(", ")}. Forcing Indonesian.`);
          // Auto-fix problems array if in English
          if (Array.isArray(scriptDoctorResult.problems)) {
            scriptDoctorResult.problems = scriptDoctorResult.problems.map((p: string) =>
              containsEnglishDiagnostic(p) ? "Keluaran perlu diperbaiki ke Bahasa Indonesia" : p
            );
          }
          if (scriptDoctorResult.rewrite_instruction && containsEnglishDiagnostic(scriptDoctorResult.rewrite_instruction)) {
            scriptDoctorResult.rewrite_instruction = "Tulis ulang skrip dalam Bahasa Indonesia natural, visual, dan konkret";
          }
        }

        const score = Number(scriptDoctorResult.score || 0);
        const problems = Array.isArray(scriptDoctorResult.problems) ? scriptDoctorResult.problems : [];
        project.logs.push(`[SCRIPT DOCTOR] Attempt ${attempt + 1}: score=${score}, problems=[${problems.join(", ")}]`);

        if (score >= 8) {
          scriptDoctorPassed = true;
          break;
        }

        // Score < 8: use improved script + include feedback
        if (scriptDoctorResult.improved_script) {
          const improved = scriptDoctorResult.improved_script;
          // Apply improved script
          if (improved.hook) scriptObj.hook = improved.hook;
          if (improved.intro) scriptObj.intro = improved.intro;
          if (Array.isArray(improved.body) && improved.body.length > 0) scriptObj.body = improved.body;
          if (improved.cta) scriptObj.cta = improved.cta;
          project.script = scriptObj;

          // Build feedback prompt for next attempt
          scriptDoctorPrompt = `Topik: "${project.topic}"
Konsep: "${project.selectedIdea}"

Skrip sebelumnya:
Hook: ${scriptObj?.hook || ""}
Intro: ${scriptObj?.intro || ""}
Body: ${JSON.stringify(scriptObj?.body || [])}
CTA: ${scriptObj?.cta || ""}

HASIL DIAGNOSA SEBELUMNYA:
- Skor: ${score}/10
- Masalah: ${problems.join("; ")}
- Instruksi perbaikan: ${scriptDoctorResult.rewrite_instruction || "tidak ada"}

Perbaiki skrip agar skor minimal 8.
Wajib:
- Hook lebih mengejutkan.
- Gunakan time pressure jika memungkinkan.
- Setiap kalimat visual dan konkret.
- Hindari kalimat puitis berlebihan.
- Sebab-akibat harus jelas.
- Setiap kalimat maksimal 12 kata.
- Semua value string WAJIB Bahasa Indonesia.`;

          project.logs.push(`[SCRIPT DOCTOR] Rewriting with improved script + feedback (attempt ${attempt + 1})`);
        }
      } catch (e: any) {
        console.warn(`[SCRIPT DOCTOR] Attempt ${attempt + 1} failed: ${e.message}`);
      }
    }

    // Re-split if script was rewritten
    if (project.script && !scriptDoctorPassed) {
      project.logs.push(`[SCRIPT DOCTOR] WARNING: Script score still below 8. Proceeding with best available version.`);
    } else {
      project.logs.push(`[SCRIPT DOCTOR] Script quality approved (score ≥ 8).`);
    }

    // Re-run splitter on potentially improved script
    const improvedScript = project.script as any;
    const fullScriptText = `${improvedScript?.hook || ""} ${improvedScript?.intro || ""} ${improvedScript?.body || ""} ${improvedScript?.cta || ""}`;
    project.logs.push(`[SCRIPT DOCTOR] Re-splitting improved script...`);
    const splitterPrompt = `Split the script into atomic narration lines:
"${fullScriptText}"`;

    try {
      const rawSplitResponse = await askLLM(
        splitterPrompt,
        settings.promptSplitter || DEFAULT_SETTINGS.promptSplitter
      );
      const parsed = extractJsonObject(rawSplitResponse);
      if (Array.isArray(parsed)) {
        project.atomicLines = parsed.map((l: any) => typeof l === "string" ? l : (l?.text || l?.line || String(l)));
      } else if (parsed && Array.isArray(parsed.lines)) {
        project.atomicLines = parsed.lines.map((l: any) => typeof l === "string" ? l : (l?.text || l?.line || String(l)));
      } else if (parsed && Array.isArray(parsed.atomic_lines)) {
        project.atomicLines = parsed.atomic_lines.map((l: any) => typeof l === "string" ? l : (l?.text || l?.line || String(l)));
      } else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Handle object with numeric keys: {"1": "line1", "2": "line2"}
        const keys = Object.keys(parsed).map(Number).filter(k => !isNaN(k)).sort((a, b) => a - b);
        if (keys.length > 0) {
          project.atomicLines = keys.map(k => String(parsed[k] || ""));
        } else {
          const stringValues = Object.values(parsed).filter(v => typeof v === "string" && v.length > 0) as string[];
          if (stringValues.length > 0) project.atomicLines = stringValues;
        }
      }
    } catch (e) {
      // Fallback: simple sentence split
      const timeProtected = fullScriptText
        .replace(/(\d)\.(\d)/g, "$1_DOT_$2")
        .replace(/(\d),(\d)/g, "$1_COMMA_$2");
      project.atomicLines = timeProtected
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .map((s) => s.replace(/_DOT_/g, ".").replace(/_COMMA_/g, ","))
        .filter((s) => s.length > 0);
    }
    project.logs.push(`[SCRIPT DOCTOR] Final: ${project.atomicLines.length} atomic narration lines.`);

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

    // ── DIFFICULTY SCORE: Rate each scene for video generation safety ─────────
    project.logs.push(`[QA] Calculating scene difficulty scores...`);
    for (let i = 0; i < scenesList.length; i++) {
      const s = scenesList[i];
      const voiceText = String(s.voice_text || "").toLowerCase();
      const motionText = String(s.motion_prompt || s.motionPrompt || "").toLowerCase();
      const visualText = String(s.visual_prompt || s.visualPrompt || "").toLowerCase();

      // If LLM already provided a score, keep it
      if (s.difficulty_score && s.difficulty_score > 0) continue;

      let score = 3; // Default: safe for image_to_video
      let risk = "Standard scene, safe for AI video generation.";

      // Complexity indicators that increase difficulty
      const complexMotion = ["berlari", "melompat", "jatuh", "terbang", "berputar", "berkelahi", "menangkap", "meledak", "runtuh", "melayang"];
      const complexVisual = ["ribuan", "ratusan", "kerumunan", "massal", "semua orang", "seluruh kota", "besar", "luas"];
      const safeMotion = ["push-in", "drift", "zoom", "pan", "pullback", "static", "still"];

      for (const cm of complexMotion) {
        if (voiceText.includes(cm) || motionText.includes(cm)) {
          score += 2;
          break;
        }
      }
      for (const cv of complexVisual) {
        if (voiceText.includes(cv) || visualText.includes(cv)) {
          score += 2;
          break;
        }
      }
      for (const sm of safeMotion) {
        if (motionText.includes(sm)) {
          score -= 1;
          break;
        }
      }

      // Clamp to 1-10
      score = Math.max(1, Math.min(10, score));

      if (score >= 7) {
        risk = "Complex scene with multiple subjects or fast motion. Risk of character distortion or scene jumping in AI video.";
        s.recommended_generation = "image_only_editing";
        s.fallback_editing = "still_image_with_zoom";
      } else if (score >= 4) {
        risk = "Moderate complexity. Use light motion to avoid distortion.";
        s.recommended_generation = "image_to_video_light";
        s.fallback_editing = "still_image_with_slow_zoom";
      } else {
        risk = "Simple scene with minimal motion. Safe for AI video generation.";
        s.recommended_generation = "image_to_video";
        s.fallback_editing = "still_image_with_zoom";
      }

      s.difficulty_score = score;
      s.risk_reason = risk;
    }
    const avgDifficulty = scenesList.reduce((sum: number, s: any) => sum + (s.difficulty_score || 0), 0) / scenesList.length;
    const hardScenes = scenesList.filter((s: any) => (s.difficulty_score || 0) >= 7).length;
    project.logs.push(`[QA] Difficulty scores: avg=${avgDifficulty.toFixed(1)}/10, hard scenes (7+) = ${hardScenes}/${scenesList.length}`);

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
      difficultyScore: s.difficulty_score || s.difficultyScore || 0,
      recommendedGeneration: s.recommended_generation || s.recommendedGeneration || "image_to_video",
      riskReason: s.risk_reason || s.riskReason || "",
      fallbackEditing: s.fallback_editing || s.fallbackEditing || "still_image_with_zoom",
      imageApproved: false,
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

    // 2. Image Generation (routed to selected provider: ComfyUI or Z-Image Turbo)
    nextScene.status = "generating_image";
    saveAndPublish(project);

    let doneImage = false;
    const imageProvider = settings.imageProvider || "comfyui";
    const hasProviderUrl = imageProvider === "zimage_turbo"
      ? !!settings.zImageTurboUrl
      : !!settings.comfyUrl;

    if (hasProviderUrl) {
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

        // Route to the selected image provider
        const genResult = await generateSceneImage(
          nextScene.visualPrompt,
          settings.comfyNegativePrompt || "low quality, blurry, watermark, text overlay, deformed, ugly, bad anatomy",
          undefined, // seed
          projectOutputDir,
          `scene_${String(nextScene.sceneNumber).padStart(3, "0")}.png`,
          settings,
          comfyConfig,
          logFn
        );

        if (genResult.dataUrl) {
          nextScene.imageBase64 = genResult.dataUrl;
          doneImage = true;
          if (genResult.filePath) {
            nextScene.imagePath = genResult.filePath;
            project.logs.push(`[IMAGE] Scene ${nextScene.sceneNumber} image generated and saved to: ${genResult.filePath}`);
          } else {
            project.logs.push(`[IMAGE] Scene ${nextScene.sceneNumber} image generated successfully!`);
          }
          saveAndPublish(project);
        } else {
          project.logs.push(`[WARNING] Image provider returned no output. Falling back to procedural SVG.`);
        }
      } catch (err: any) {
        console.warn(`Image generation failed for scene ${nextScene.sceneNumber}:`, err.message);
        project.logs.push(`[WARNING] Image generation failed (${imageProvider}): ${err.message}. Using SVG placeholder.`);
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
    // Skip video generation if "Generate Image Only" mode is active
    const imageOnlyMode = (project as any).imageOnlyMode === true || (project as any).image_only_mode === 1;

    if (imageOnlyMode) {
      nextScene.status = "completed";
      nextScene.imageApproved = true;
      saveAndPublish(project);

      // Check if all scenes are done
      const allScenesDone = project.scenes.every((s: any) => s.status === "completed" || s.status === "failed");
      if (allScenesDone) {
        project.logs.push(`[IMAGE ONLY] All images generated! Project paused for review. Approve to continue to video.`);
        project.status = "images_ready";
        project.currentStepMessage = "All images generated — review and approve to continue";
        project.progress = 75;
        saveAndPublish(project);
        return;
      }
      return;
    }

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

  // ── "Generate Image Only" mode: All images done, waiting for approval ──
  if (project.status === "images_ready") {
    // This status is paused — user needs to review images and approve
    // Approval is handled via the /api/projects/:id/approve-images endpoint
    project.currentStepMessage = "All images generated — review and approve to continue to video generation";
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

    // Thumbnail generation via selected image provider (with SVG fallback)
    project.thumbnailPrompt = `Epic high-contrast YouTube thumbnail showing: ${project.scenes[0]?.visualPrompt || project.topic}, bold neon text "THE UNTOLD SINS", extremely highly detailed, RTX shadows`;

    let doneThumbnail = false;
    const thumbProvider = settings.imageProvider || "comfyui";
    const hasThumbProviderUrl = thumbProvider === "zimage_turbo"
      ? !!settings.zImageTurboUrl
      : !!settings.comfyUrl;

    if (hasThumbProviderUrl) {
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

        const thumbResult = await generateSceneImage(
          project.thumbnailPrompt,
          settings.comfyNegativePrompt || "low quality, blurry, watermark, simple, plain",
          undefined,
          projectOutputDir,
          "thumbnail.png",
          settings,
          comfyConfig,
          logFn
        );

        if (thumbResult.dataUrl) {
          project.thumbnailUrl = thumbResult.dataUrl;
          doneThumbnail = true;
          project.logs.push(`[THUMBNAIL] Thumbnail generated successfully via ${thumbProvider}!`);
        } else {
          project.logs.push(`[WARNING] Image provider returned no thumbnail output. Using SVG fallback.`);
        }
      } catch (err: any) {
        console.warn("Thumbnail generation failed:", err.message);
        project.logs.push(`[WARNING] Thumbnail generation failed (${thumbProvider}): ${err.message}. Using SVG fallback.`);
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
  const { topic, name, maxDuration, aspectRatio, imageOnlyMode } = req.body;
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

  // Set image_only_mode flag if enabled
  if (imageOnlyMode) {
    try {
      const db = getDatabase();
      db.prepare("UPDATE projects SET image_only_mode = 1 WHERE id = ?").run(projectId);
    } catch (err) {
      console.warn("[DATABASE] Could not set image_only_mode:", err);
    }
  }

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

// ── Image-Only Mode: Approve images and continue to video generation ──
app.post("/api/projects/:id/approve-images", (req, res) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (project.status !== "images_ready") {
    res.status(400).json({ error: `Project status is "${project.status}", expected "images_ready"` });
    return;
  }

  // Mark all scenes as idle so pipeline picks them up for video generation
  for (const scene of project.scenes) {
    if (scene.status === "completed" && !scene.videoUrl) {
      updateScene(scene.id, { status: "idle" });
    }
  }

  // Update project: disable image-only mode and resume generating_media
  updateProjectFields(req.params.id, {
    status: "generating_media",
    currentStepMessage: "Images approved — generating videos...",
    progress: 75,
  });

  // Also update the image_only_mode flag in DB
  try {
    const db = getDatabase();
    db.prepare("UPDATE projects SET image_only_mode = 0 WHERE id = ?").run(req.params.id);
  } catch (err) {
    console.warn("[DATABASE] Could not reset image_only_mode:", err);
  }

  res.json({ success: true, message: "Images approved — resuming video generation" });
});

// ── Image-Only Mode: Reject and regenerate specific scene image ──
app.post("/api/projects/:id/regenerate-scene-image", (req, res) => {
  const { sceneId } = req.body;
  if (!sceneId) {
    res.status(400).json({ error: "sceneId required" });
    return;
  }

  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Reset the specific scene to idle so pipeline regenerates its image
  updateScene(sceneId, { status: "idle" });

  // If project was in images_ready, move it back to generating_media
  if (project.status === "images_ready") {
    updateProjectFields(req.params.id, {
      status: "generating_media",
      currentStepMessage: "Regenerating rejected images...",
      progress: 70,
    });
  }

  res.json({ success: true, message: "Scene image scheduled for regeneration" });
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
    ollama: { ok: false, message: "Unchecked", modelAvailable: false },
    comfy: { ok: false, message: "Unchecked", checkpointAvailable: false },
    zimage: { ok: false, message: "Unchecked" },
    tts: { ok: false, message: "Unchecked" },
    ffmpeg: { ok: false, message: "Unchecked" },
    disk: { ok: false, message: "Unchecked" },
  };

  try {
    // Probe Ollama base URL
    const targetOllama = localSettings.ollamaUrl || "http://localhost:11434";
    const ollamaCheck = await fetch(targetOllama, { signal: AbortSignal.timeout(3000) });
    if (ollamaCheck.ok) {
      status.ollama = { ok: true, message: `Connected to Ollama at ${targetOllama}`, modelAvailable: false };
      // Check if the configured model is available
      try {
        const modelList = await fetch(`${targetOllama}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (modelList.ok) {
          const models = await modelList.json();
          const modelNames: string[] = (models?.models || []).map((m: any) => m.name || m.model || "");
          const configuredModel = localSettings.llmModel || "qwen3:8b";
          const modelFound = modelNames.some(n => n === configuredModel || n.startsWith(configuredModel.split(":")[0]));
          status.ollama.modelAvailable = modelFound;
          if (modelFound) {
            status.ollama.message = `Ollama connected, model "${configuredModel}" available (${modelNames.length} models total)`;
          } else {
            status.ollama.message = `Ollama connected, but model "${configuredModel}" NOT found. Run: ollama pull ${configuredModel}. Available: ${modelNames.slice(0, 5).join(", ")}`;
          }
        }
      } catch {}
    } else {
      status.ollama = { ok: false, message: `Ollama returned status ${ollamaCheck.status}`, modelAvailable: false };
    }
  } catch (err: any) {
    status.ollama = { ok: false, message: `Ollama offline or timed out. Make sure Ollama is running. Error: ${err.message}`, modelAvailable: false };
  }

  try {
    // Probe ComfyUI using the improved connection check
    const targetComfy = localSettings.comfyUrl || "http://localhost:8188";
    const comfyResult = await comfyCheckConnection(targetComfy);
    status.comfy = { ...comfyResult, checkpointAvailable: false };
    // Check if configured checkpoint exists
    if (comfyResult.ok) {
      try {
        const checkpoints = await comfyGetCheckpoints(targetComfy);
        const configuredCkpt = localSettings.comfyCheckpoint || "sdxl_lightning_4step.safetensors";
        const ckptFound = checkpoints.some((c: string) => c.toLowerCase().includes(configuredCkpt.toLowerCase()));
        status.comfy.checkpointAvailable = ckptFound;
        if (!ckptFound) {
          status.comfy.message += ` Checkpoint "${configuredCkpt}" not found in ComfyUI.`;
        }
      } catch {}
    }
  } catch (err: any) {
    status.comfy = { ok: false, message: `ComfyUI offline or timed out: ${err.message}`, checkpointAvailable: false };
  }

  // Check Z-Image Turbo connection
  try {
    const turboUrl = localSettings.zImageTurboUrl || "http://127.0.0.1:9000";
    const turboResult = await checkZImageTurboConnection(turboUrl);
    status.zimage = turboResult;
  } catch (err: any) {
    status.zimage = { ok: false, message: `Z-Image Turbo offline or timed out: ${err.message}` };
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
        : `${ttsInfo.name} offline: ${ttsInfo.error || "Not reachable"}. Start TTS server or check URL.`,
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
        : "FFmpeg not found — install FFmpeg and add to PATH for video assembly",
    };
  } catch (err: any) {
    status.ffmpeg = { ok: false, message: `FFmpeg check failed: ${err.message}` };
  }

  // Check disk output directory writable
  try {
    const outputDir = COMFYUI_OUTPUT_DIR;
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const testFile = path.join(outputDir, ".healthcheck");
    fs.writeFileSync(testFile, "ok");
    fs.unlinkSync(testFile);
    status.disk = { ok: true, message: `Output directory writable: ${outputDir}` };
  } catch (err: any) {
    status.disk = { ok: false, message: `Output directory not writable: ${err.message}. Check permissions.` };
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

// ── Z-Image Turbo Routes ──────────────────────────────────────────────────

// Z-Image Turbo health check
app.get("/api/zimage-turbo/health", async (req, res) => {
  const baseUrl = String(req.query.baseUrl || localSettings.zImageTurboUrl || "http://127.0.0.1:9000");

  try {
    const result = await checkZImageTurboConnection(baseUrl);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      message: "Gagal terhubung ke Z-Image Turbo API",
      detail: error?.message || String(error),
    });
  }
});

// Z-Image Turbo test generate
app.post("/api/zimage-turbo/test-generate", async (req, res) => {
  const baseUrl = String(req.query.baseUrl || localSettings.zImageTurboUrl || "http://127.0.0.1:9000");

  try {
    const testOutputDir = path.join(COMFYUI_OUTPUT_DIR, "test");
    const result = await generateImageWithZImageTurbo({
      prompt: "cinematic photo of a dry cracked earth landscape, dramatic golden sunlight, ultra detailed, 8k",
      // negativePrompt is NOT sent to Z-Image Turbo — omitted intentionally
      seed: 42,
      outputDir: testOutputDir,
      filename: "test_zimage.png",
      settings: {
        zImageTurboUrl: baseUrl,
        imageWidth: localSettings.imageWidth || 512,
        imageHeight: localSettings.imageHeight || 896,
        imageSteps: localSettings.imageSteps || 8,
        imageCfg: localSettings.imageCfg ?? 1.0,
        zImageVaePath: (localSettings as any).zImageVaePath || "D:\\Z-Image-Turbo-Windows\\models\\vae\\ae.safetensors",
        zImageLlmPath: (localSettings as any).zImageLlmPath || "D:\\Z-Image-Turbo-Windows\\models\\llm\\Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
        zImageLoras: (localSettings as any).zImageLoras || "",
        zImageLoraStrength: (localSettings as any).zImageLoraStrength ?? 1.0,
      },
    });

    res.json({
      ok: true,
      message: "Z-Image Turbo test generation berhasil",
      filePath: result.filePath,
      imageSize: result.dataUrl ? result.dataUrl.length : 0,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      message: "Z-Image Turbo test generation gagal",
      detail: error?.message || String(error),
    });
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
