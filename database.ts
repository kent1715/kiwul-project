/**
 * Database Module for Project Kiwul
 *
 * SQLite database with better-sqlite3 — replaces JSON file storage.
 * Provides ACID transactions, proper indexing, and relational data access.
 *
 * Schema:
 *   - projects: Main project data
 *   - scenes: Scene data per project (one-to-many)
 *   - logs: Log entries per project (one-to-many)
 *   - settings: Singleton settings row
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DBProject {
  id: string;
  name: string;
  topic: string;
  status: string;
  currentStepMessage: string;
  progress: number;
  createdAt: string;
  ideas: string[];
  selectedIdea: string;
  script: { hook: string; intro: string; body: string; cta: string };
  metadata: { title: string; description: string; tags: string[]; hashtags: string[] };
  thumbnailPrompt: string;
  thumbnailUrl: string;
  maxDuration: string;
  aspectRatio: string;
  voiceUrl: string;
  subtitleSrt: string;
  finalVideoUrl: string;
  finalVideoPath: string;
  atomicLines: string[];
  error: string;
  scenes: DBScene[];
  logs: string[];
}

export interface DBScene {
  id: string;
  projectId: string;
  sceneNumber: number;
  visualPrompt: string;
  motionPrompt: string;
  voiceText: string;
  status: string;
  imageBase64: string;
  imagePath: string;
  videoUrl: string;
  audioUrl: string;
  audioDuration: number;
  error: string;
}

export interface DBSettings {
  ollamaUrl: string;
  llmModel: string;
  comfyUrl: string;
  comfyCheckpoint: string;
  comfyNegativePrompt: string;
  workflowTemplate: string;
  motionEngine: string;
  wanMode: string;
  wanResolution: string;
  wanSteps: number;
  wanUrl: string;
  wanCfg: number;
  wanFrames: number;
  wanMotionIntensity: number;
  wanCheckpoint: string;
  ltxSteps: number;
  ltxCfg: number;
  ltxFrames: number;
  ltxFps: number;
  ltxWorkflowPath: string;   // Path to user's manually saved LTX I2V workflow JSON from ComfyUI
  comfyLora: string;
  comfyLoraStrength: number;
  comfySampler: string;
  comfyScheduler: string;
  comfySteps: number;
  comfyCfg: number;
  ttsEngine: string;
  ttsUrl: string;
  voiceProfile: string;
  voiceSpeed: number;
  voiceEmotion: string;
  refAudio: string;        // Base64 data URL of reference audio for voice cloning
  refText: string;         // Reference text corresponding to the reference audio
  voiceCloningEnabled: boolean;  // Whether to use custom reference audio for voice cloning
  backupGeminiMode: boolean;
  promptIdeation: string;
  promptScript: string;
  promptPlanning: string;
  promptSplitter: string;
}

// ─── Database Initialization ─────────────────────────────────────────────────

const DB_PATH = path.join(process.cwd(), "kiwul.db");
const PROJECTS_JSON_PATH = path.join(process.cwd(), "projects.json");
const SETTINGS_JSON_PATH = path.join(process.cwd(), "settings.json");

let db: Database.Database;

/**
 * Initialize the database, create tables, and migrate from JSON if needed.
 */
export function initDatabase(): Database.Database {
  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      topic TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      current_step_message TEXT DEFAULT '',
      progress INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      ideas TEXT DEFAULT '[]',
      selected_idea TEXT DEFAULT '',
      script TEXT DEFAULT '{"hook":"","intro":"","body":"","cta":""}',
      metadata TEXT DEFAULT '{"title":"","description":"","tags":[],"hashtags":[]}',
      thumbnail_prompt TEXT DEFAULT '',
      thumbnail_url TEXT DEFAULT '',
      max_duration TEXT DEFAULT 'Auto',
      aspect_ratio TEXT DEFAULT '16:9',
      voice_url TEXT DEFAULT '',
      subtitle_srt TEXT DEFAULT '',
      final_video_url TEXT DEFAULT '',
      final_video_path TEXT DEFAULT '',
      atomic_lines TEXT DEFAULT '[]',
      error TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      scene_number INTEGER NOT NULL,
      visual_prompt TEXT DEFAULT '',
      motion_prompt TEXT DEFAULT '',
      voice_text TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'idle',
      image_base64 TEXT DEFAULT '',
      image_path TEXT DEFAULT '',
      video_url TEXT DEFAULT '',
      audio_url TEXT DEFAULT '',
      audio_duration REAL DEFAULT 0,
      error TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ollama_url TEXT DEFAULT 'http://localhost:11434',
      llm_model TEXT DEFAULT 'qwen3:8b',
      comfy_url TEXT DEFAULT 'http://localhost:8188',
      comfy_checkpoint TEXT DEFAULT 'sdxl_lightning_4step.safetensors',
      comfy_negative_prompt TEXT DEFAULT 'low quality, blurry, watermark, text overlay, deformed, ugly, bad anatomy',
      workflow_template TEXT DEFAULT 'Auto_Detect',
      wan_url TEXT DEFAULT 'http://localhost:7860',
      motion_engine TEXT DEFAULT 'wan_i2v',
      wan_mode TEXT DEFAULT 'i2v',
      wan_resolution TEXT DEFAULT '16:9',
      wan_steps INTEGER DEFAULT 20,
      wan_cfg REAL DEFAULT 6.0,
      wan_frames INTEGER DEFAULT 81,
      wan_motion_intensity INTEGER DEFAULT 7,
      wan_checkpoint TEXT DEFAULT 'wan2.2_i2v_480p.safetensors',
      ltx_steps INTEGER DEFAULT 20,
      ltx_cfg REAL DEFAULT 4.0,
      ltx_frames INTEGER DEFAULT 97,
      ltx_fps REAL DEFAULT 24,
      ltx_workflow_path TEXT DEFAULT '',
      comfy_lora TEXT DEFAULT '',
      comfy_lora_strength REAL DEFAULT 1.0,
      comfy_sampler TEXT DEFAULT 'euler',
      comfy_scheduler TEXT DEFAULT 'normal',
      comfy_steps INTEGER DEFAULT 20,
      comfy_cfg REAL DEFAULT 3.5,
      tts_engine TEXT DEFAULT 'f5-tts',
      tts_url TEXT DEFAULT 'http://127.0.0.1:5050',
      voice_profile TEXT DEFAULT 'natural_charles',
      voice_speed REAL DEFAULT 1.0,
      voice_emotion TEXT DEFAULT 'neutral',
      ref_audio TEXT DEFAULT '',
      ref_text TEXT DEFAULT '',
      voice_cloning_enabled INTEGER DEFAULT 0,
      backup_gemini_mode INTEGER DEFAULT 0,
      prompt_ideation TEXT DEFAULT 'Kamu adalah ahli strategi YouTube faceless terbaik yang menguasai cerita viral berbasis retensi tinggi.\n\nTugasmu:\nHasilkan 3 konsep video yang memukau secara emosional dan dirancang untuk memaksimalkan:\n- rasa penasaran\n- click-through rate\n- watch time\n- komentar\n\nAturan:\n- Setiap ide harus memiliki curiosity gap yang kuat.\n- Harus terdengar bisa diklik dan sinematik.\n- Harus cocok untuk produksi video faceless.\n- Hindari judul dokumenter generik.\n- Utamakan sudut pandang POV, hitungan mundur, timeline, misteri, atau "apa yang terjadi selanjutnya".\n- Setiap ide maksimal 35 kata.\n- WAJIB dalam Bahasa Indonesia.\n\nOutput HANYA array JSON yang valid dari string.\nTanpa markdown.\nTanpa teks tambahan.',
      prompt_script TEXT DEFAULT 'Kamu adalah penulis naskah YouTube faceless elite yang menguasai narasi sinematik berretensi tinggi.\n\nTulis untuk:\n- voiceover dramatis\n- generasi visual per adegan\n- keterbacaan subtitle\n- retensi audiens maksimal\n\nATURAN KETAT:\n- Output HANYA JSON yang valid.\n- Keys: hook, intro, body, cta\n- Setiap kalimat harus pendek (maks 12 kata).\n- Satu kalimat = satu event visual.\n- Hindari paragraf panjang.\n- Hindari bahasa buku teks.\n- Gunakan pacing dramatis dan suspans.\n- Tambahkan momen jeda alami.\n- Buat narasi mudah untuk TTS.\n- Setiap baris harus terasa sinematik.\n- WAJIB dalam Bahasa Indonesia.\n\nPacing yang diinginkan:\nHOOK:\n1-2 baris punchy.\n\nINTRO:\n2-3 baris pendek.\n\nBODY:\n4-8 baris sekuensial pendek.\n\nCTA:\n1 pertanyaan yang memancing emosi.\n\nFormat JSON:\n{\n  "hook": "Baris 1. Baris 2.",\n  "intro": "Baris 3. Baris 4.",\n  "body": "Baris 5. Baris 6. Baris 7.",\n  "cta": "Pertanyaan?"\n}',
      prompt_planning TEXT DEFAULT '',
      prompt_splitter TEXT DEFAULT 'Kamu adalah editor narasi sinematik.\n\nKonversi naskah menjadi baris narasi atomik.\n\nATURAN KETAT:\n- satu baris = satu event visual\n- maks 8 kata\n- bahasa sinematik yang kuat\n- imajinasi yang hidup\n- mudah untuk TTS\n- mudah dibaca sebagai subtitle\n- hindari jargon ilmiah kecuali perlu\n- pertahankan pacing dramatis\n- hasilkan 8-12 baris\n- WAJIB dalam Bahasa Indonesia\n\nOutput HANYA array JSON yang valid.\nTanpa markdown.\nTanpa teks tambahan.'
    );

    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_scenes_project_id ON scenes(project_id);
    CREATE INDEX IF NOT EXISTS idx_logs_project_id ON logs(project_id);
  `);

  // Ensure settings row exists
  const settingsExists = db.prepare("SELECT COUNT(*) as cnt FROM settings WHERE id = 1").get() as { cnt: number };
  if (settingsExists.cnt === 0) {
    db.prepare(`
      INSERT INTO settings (id) VALUES (1)
    `).run();
  }

  // Migrate schema — add missing columns for existing databases
  migrateSchema();

  // Migrate from JSON files if database is empty and JSON files exist
  migrateFromJSON();

  console.log(`[DATABASE] SQLite database initialized at: ${DB_PATH}`);
  return db;
}

/**
 * Get the database instance (must call initDatabase first).
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

// ─── Schema Migration ─────────────────────────────────────────────────────────

/**
 * Add missing columns to existing databases.
 * SQLite ALTER TABLE only supports ADD COLUMN, so this is safe.
 */
function migrateSchema() {
  const columns = db.prepare("PRAGMA table_info(settings)").all() as Array<{ name: string }>;
  const existingColumns = new Set(columns.map(c => c.name));

  const requiredColumns: Record<string, string> = {
    wan_url: "TEXT DEFAULT 'http://localhost:7860'",
    wan_checkpoint: "TEXT DEFAULT 'wan2.2_i2v_480p.safetensors'",
    motion_engine: "TEXT DEFAULT 'wan_i2v'",
    ltx_steps: "INTEGER DEFAULT 20",
    ltx_cfg: "REAL DEFAULT 4.0",
    ltx_frames: "INTEGER DEFAULT 97",
    ltx_fps: "REAL DEFAULT 24",
    ltx_workflow_path: "TEXT DEFAULT ''",
    ref_audio: "TEXT DEFAULT ''",
    ref_text: "TEXT DEFAULT ''",
    voice_cloning_enabled: "INTEGER DEFAULT 0",
  };

  for (const [colName, colDef] of Object.entries(requiredColumns)) {
    if (!existingColumns.has(colName)) {
      console.log(`[DATABASE] Adding missing column: settings.${colName}`);
      db.exec(`ALTER TABLE settings ADD COLUMN ${colName} ${colDef}`);
    }
  }

  // Force-update workflow_template from old "Flux_Schnell_Simple_API" to "Auto_Detect"
  // This ensures existing databases use smart auto-detection instead of hardcoded FLUX
  try {
    const currentWorkflow = db.prepare("SELECT workflow_template FROM settings WHERE id = 1").get() as { workflow_template: string };
    if (currentWorkflow?.workflow_template === "Flux_Schnell_Simple_API") {
      db.prepare("UPDATE settings SET workflow_template = 'Auto_Detect' WHERE id = 1").run();
      console.log(`[DATABASE] Updated workflow_template from 'Flux_Schnell_Simple_API' to 'Auto_Detect' for smart model detection`);
    }
  } catch (err) {
    console.warn("[DATABASE] Could not update workflow_template:", err);
  }

  // Force-update comfy_checkpoint from old "flux1-schnell.safetensors" default to empty
  // This allows Auto_Detect to properly query ComfyUI for available models
  try {
    const currentCheckpoint = db.prepare("SELECT comfy_checkpoint FROM settings WHERE id = 1").get() as { comfy_checkpoint: string };
    if (currentCheckpoint?.comfy_checkpoint === "flux1-schnell.safetensors") {
      db.prepare("UPDATE settings SET comfy_checkpoint = '' WHERE id = 1").run();
      console.log(`[DATABASE] Cleared hardcoded comfy_checkpoint default. Auto_Detect will find the correct model.`);
    }
  } catch (err) {
    console.warn("[DATABASE] Could not update comfy_checkpoint:", err);
  }

  // Update prompt_planning to enforce 1:1 scene-to-line mapping (removes old "4-5 scenes" default)
  // Only update if the current value still contains the old "4-5 scenes" text
  try {
    const currentPlanning = db.prepare("SELECT prompt_planning FROM settings WHERE id = 1").get() as { prompt_planning: string };
    if (currentPlanning?.prompt_planning?.includes("4-5 cinematic scenes") || currentPlanning?.prompt_planning === "") {
      const newPlanning = `You are a Hollywood Director of Photography and AI visual prompt engineer.

You will receive an array of atomic narration lines. You MUST generate EXACTLY ONE scene per narration line.
The number of scenes MUST EQUAL the number of narration lines provided — no more, no less.

For each scene generate:
1. visual_prompt (MUST be in English)
2. motion_prompt (MUST be in English)
3. voice_text (MUST be in Bahasa Indonesia — copy EXACTLY from the corresponding narration line)

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
- must EXACTLY match the corresponding narration line from the input array
- one voice_text per scene, one scene per narration line
- no merging multiple narration lines into one scene
- no splitting one narration line across multiple scenes
- no adding extra scenes (no opening/closing frames)
- no translation — use the original Indonesian text

CRITICAL: If you receive 12 narration lines, you MUST output exactly 12 scenes.
If you receive 8 narration lines, you MUST output exactly 8 scenes.
Never add extra scenes like "mystery artifact" or "Epic closing frame".
Never skip any narration line.

Output ONLY valid JSON array.`;
      db.prepare("UPDATE settings SET prompt_planning = ? WHERE id = 1").run(newPlanning);
      console.log(`[DATABASE] Updated prompt_planning to enforce 1:1 scene-to-line mapping`);
    }
  } catch (err) {
    console.warn("[DATABASE] Could not update prompt_planning:", err);
  }
}

// ─── Migration from JSON ─────────────────────────────────────────────────────

function migrateFromJSON() {
  // Check if we already have data
  const projectCount = db.prepare("SELECT COUNT(*) as cnt FROM projects").get() as { cnt: number };
  if (projectCount.cnt > 0) {
    return; // Already have data, skip migration
  }

  // Try to migrate projects.json
  if (fs.existsSync(PROJECTS_JSON_PATH)) {
    try {
      const rawProjects = JSON.parse(fs.readFileSync(PROJECTS_JSON_PATH, "utf-8"));
      if (Array.isArray(rawProjects) && rawProjects.length > 0) {
        console.log(`[DATABASE] Migrating ${rawProjects.length} projects from projects.json...`);
        const insertProject = db.prepare(`
          INSERT INTO projects (id, name, topic, status, current_step_message, progress, created_at,
            ideas, selected_idea, script, metadata, thumbnail_prompt, thumbnail_url,
            max_duration, aspect_ratio, voice_url, subtitle_srt, final_video_url, final_video_path,
            atomic_lines, error)
          VALUES (@id, @name, @topic, @status, @currentStepMessage, @progress, @createdAt,
            @ideas, @selectedIdea, @script, @metadata, @thumbnailPrompt, @thumbnailUrl,
            @maxDuration, @aspectRatio, @voiceUrl, @subtitleSrt, @finalVideoUrl, @finalVideoPath,
            @atomicLines, @error)
        `);
        const insertScene = db.prepare(`
          INSERT INTO scenes (id, project_id, scene_number, visual_prompt, motion_prompt, voice_text,
            status, image_base64, image_path, video_url, audio_url, audio_duration, error)
          VALUES (@id, @projectId, @sceneNumber, @visualPrompt, @motionPrompt, @voiceText,
            @status, @imageBase64, @imagePath, @videoUrl, @audioUrl, @audioDuration, @error)
        `);
        const insertLog = db.prepare(`
          INSERT INTO logs (project_id, message) VALUES (@projectId, @message)
        `);

        const transaction = db.transaction(() => {
          for (const p of rawProjects) {
            insertProject.run({
              id: p.id,
              name: p.name || "",
              topic: p.topic || "",
              status: p.status || "idle",
              currentStepMessage: p.currentStepMessage || "",
              progress: p.progress || 0,
              createdAt: p.createdAt || new Date().toISOString(),
              ideas: JSON.stringify(p.ideas || []),
              selectedIdea: p.selectedIdea || "",
              script: JSON.stringify(p.script || { hook: "", intro: "", body: "", cta: "" }),
              metadata: JSON.stringify(p.metadata || { title: "", description: "", tags: [], hashtags: [] }),
              thumbnailPrompt: p.thumbnailPrompt || "",
              thumbnailUrl: p.thumbnailUrl || "",
              maxDuration: p.maxDuration || "Auto",
              aspectRatio: p.aspectRatio || "16:9",
              voiceUrl: p.voiceUrl || "",
              subtitleSrt: p.subtitleSrt || "",
              finalVideoUrl: p.finalVideoUrl || "",
              finalVideoPath: p.finalVideoPath || "",
              atomicLines: JSON.stringify(p.atomicLines || []),
              error: p.error || "",
            });

            // Insert scenes
            if (Array.isArray(p.scenes)) {
              for (const s of p.scenes) {
                insertScene.run({
                  id: s.id || `scene_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
                  projectId: p.id,
                  sceneNumber: s.sceneNumber || 0,
                  visualPrompt: s.visualPrompt || "",
                  motionPrompt: s.motionPrompt || "",
                  voiceText: s.voiceText || "",
                  status: s.status || "idle",
                  imageBase64: s.imageBase64 || "",
                  imagePath: s.imagePath || "",
                  videoUrl: s.videoUrl || "",
                  audioUrl: s.audioUrl || "",
                  audioDuration: s.audioDuration || 0,
                  error: s.error || "",
                });
              }
            }

            // Insert logs
            if (Array.isArray(p.logs)) {
              for (const logMsg of p.logs) {
                insertLog.run({ projectId: p.id, message: logMsg });
              }
            }
          }
        });
        transaction();
        console.log(`[DATABASE] Migration complete: ${rawProjects.length} projects migrated.`);
      }
    } catch (err) {
      console.error("[DATABASE] Failed to migrate projects.json:", err);
    }
  }

  // Try to migrate settings.json
  if (fs.existsSync(SETTINGS_JSON_PATH)) {
    try {
      const rawSettings = JSON.parse(fs.readFileSync(SETTINGS_JSON_PATH, "utf-8"));
      if (rawSettings && typeof rawSettings === "object") {
        console.log(`[DATABASE] Migrating settings from settings.json...`);
        db.prepare(`
          UPDATE settings SET
            ollama_url = @ollamaUrl,
            llm_model = @llmModel,
            comfy_url = @comfyUrl,
            comfy_checkpoint = @comfyCheckpoint,
            comfy_negative_prompt = @comfyNegativePrompt,
            workflow_template = @workflowTemplate,
            wan_url = @wanUrl,
            motion_engine = @motionEngine,
            wan_mode = @wanMode,
            wan_resolution = @wanResolution,
            wan_steps = @wanSteps,
            wan_cfg = @wanCfg,
            wan_frames = @wanFrames,
            wan_motion_intensity = @wanMotionIntensity,
            wan_checkpoint = @wanCheckpoint,
            ltx_steps = @ltxSteps,
            ltx_cfg = @ltxCfg,
            ltx_frames = @ltxFrames,
            ltx_fps = @ltxFps,
            comfy_lora = @comfyLora,
            comfy_lora_strength = @comfyLoraStrength,
            comfy_sampler = @comfySampler,
            comfy_scheduler = @comfyScheduler,
            comfy_steps = @comfySteps,
            comfy_cfg = @comfyCfg,
            tts_engine = @ttsEngine,
            tts_url = @ttsUrl,
            voice_profile = @voiceProfile,
            voice_speed = @voiceSpeed,
            voice_emotion = @voiceEmotion,
            ref_audio = @refAudio,
            ref_text = @refText,
            voice_cloning_enabled = @voiceCloningEnabled,
            backup_gemini_mode = @backupGeminiMode,
            prompt_ideation = @promptIdeation,
            prompt_script = @promptScript,
            prompt_planning = @promptPlanning,
            prompt_splitter = @promptSplitter
          WHERE id = 1
        `).run({
          ollamaUrl: rawSettings.ollamaUrl || "http://localhost:11434",
          llmModel: rawSettings.llmModel || "qwen3:8b",
          comfyUrl: rawSettings.comfyUrl || "http://localhost:8188",
          comfyCheckpoint: rawSettings.comfyCheckpoint || "",
          comfyNegativePrompt: rawSettings.comfyNegativePrompt || "",
          workflowTemplate: rawSettings.workflowTemplate || "Auto_Detect",
          wanUrl: rawSettings.wanUrl || "http://localhost:7860",
          motionEngine: rawSettings.motionEngine || "wan_i2v",
          wanMode: rawSettings.wanMode || "i2v",
          wanResolution: rawSettings.wanResolution || "16:9",
          wanSteps: rawSettings.wanSteps || 20,
          wanCfg: rawSettings.wanCfg || 6.0,
          wanFrames: rawSettings.wanFrames || 81,
          wanMotionIntensity: rawSettings.wanMotionIntensity || 7,
          wanCheckpoint: rawSettings.wanCheckpoint || "wan2.2_i2v_480p.safetensors",
          ltxSteps: rawSettings.ltxSteps || 20,
          ltxCfg: rawSettings.ltxCfg || 4.0,
          ltxFrames: rawSettings.ltxFrames || 97,
          ltxFps: rawSettings.ltxFps || 24,
          comfyLora: rawSettings.comfyLora || "",
          comfyLoraStrength: rawSettings.comfyLoraStrength || 1.0,
          comfySampler: rawSettings.comfySampler || "euler",
          comfyScheduler: rawSettings.comfyScheduler || "normal",
          comfySteps: rawSettings.comfySteps || 20,
          comfyCfg: rawSettings.comfyCfg || 3.5,
          ttsEngine: rawSettings.ttsEngine || "f5-tts",
          ttsUrl: rawSettings.ttsUrl || "http://127.0.0.1:5050",
          voiceProfile: rawSettings.voiceProfile || "natural_charles",
          voiceSpeed: rawSettings.voiceSpeed || 1.0,
          voiceEmotion: rawSettings.voiceEmotion || "neutral",
          refAudio: rawSettings.refAudio || "",
          refText: rawSettings.refText || "",
          voiceCloningEnabled: rawSettings.voiceCloningEnabled ? 1 : 0,
          backupGeminiMode: rawSettings.backupGeminiMode ? 1 : 0,
          promptIdeation: rawSettings.promptIdeation || "",
          promptScript: rawSettings.promptScript || "",
          promptPlanning: rawSettings.promptPlanning || "",
          promptSplitter: rawSettings.promptSplitter || "",
        });
        console.log(`[DATABASE] Settings migration complete.`);
      }

      // ── Migrate old short promptPlanning to empty (forces use of new rich DEFAULT_SETTINGS) ──
      try {
        const currentPromptPlanning = db.prepare(`SELECT prompt_planning FROM settings WHERE id = 1`).get() as any;
        if (currentPromptPlanning?.prompt_planning && currentPromptPlanning.prompt_planning.length < 300) {
          db.prepare(`UPDATE settings SET prompt_planning = '' WHERE id = 1`).run();
          console.log(`[DATABASE] Reset old short promptPlanning — will use new rich default from DEFAULT_SETTINGS.`);
        }
      } catch (err) {
        console.warn("[DATABASE] promptPlanning migration check failed:", err);
      }

      // ── Migrate old FLUX checkpoint to SDXL Lightning (image engine fix) ──
      try {
        const currentCkpt = db.prepare(`SELECT comfy_checkpoint FROM settings WHERE id = 1`).get() as any;
        const ckpt = currentCkpt?.comfy_checkpoint || "";
        if (ckpt.includes("flux") || ckpt === "" || ckpt.includes("ltx") || ckpt.includes("ltxv")) {
          db.prepare(`UPDATE settings SET comfy_checkpoint = 'sdxl_lightning_4step.safetensors' WHERE id = 1`).run();
          console.log(`[DATABASE] Migrated image checkpoint from "${ckpt}" to "sdxl_lightning_4step.safetensors"`);
        }
      } catch (err) {
        console.warn("[DATABASE] Checkpoint migration failed:", err);
      }

      // ── Migrate TTS URL from localhost:5050 to 127.0.0.1:5050 ──
      try {
        const currentTts = db.prepare(`SELECT tts_url FROM settings WHERE id = 1`).get() as any;
        if (currentTts?.tts_url && currentTts.tts_url.includes("localhost:5050")) {
          db.prepare(`UPDATE settings SET tts_url = 'http://127.0.0.1:5050' WHERE id = 1`).run();
          console.log(`[DATABASE] Migrated TTS URL from localhost:5050 to 127.0.0.1:5050`);
        }
      } catch (err) {
        console.warn("[DATABASE] TTS URL migration failed:", err);
      }
    } catch (err) {
      console.error("[DATABASE] Failed to migrate settings.json:", err);
    }
  }
}

// ─── Project CRUD ────────────────────────────────────────────────────────────

/**
 * Row type from the projects table (snake_case columns).
 */
interface ProjectRow {
  id: string;
  name: string;
  topic: string;
  status: string;
  current_step_message: string;
  progress: number;
  created_at: string;
  ideas: string;
  selected_idea: string;
  script: string;
  metadata: string;
  thumbnail_prompt: string;
  thumbnail_url: string;
  max_duration: string;
  aspect_ratio: string;
  voice_url: string;
  subtitle_srt: string;
  final_video_url: string;
  final_video_path: string;
  atomic_lines: string;
  error: string;
}

interface SceneRow {
  id: string;
  project_id: string;
  scene_number: number;
  visual_prompt: string;
  motion_prompt: string;
  voice_text: string;
  status: string;
  image_base64: string;
  image_path: string;
  video_url: string;
  audio_url: string;
  audio_duration: number;
  error: string;
  created_at: string;
}

interface LogRow {
  id: number;
  project_id: string;
  message: string;
  created_at: string;
}

/**
 * Convert a project DB row to the application-level Project object.
 * Optionally includes scenes and logs.
 */
function projectRowToObj(row: ProjectRow, includeScenes: boolean = true, includeLogs: boolean = true): DBProject {
  const project: DBProject = {
    id: row.id,
    name: row.name,
    topic: row.topic,
    status: row.status,
    currentStepMessage: row.current_step_message,
    progress: row.progress,
    createdAt: row.created_at,
    ideas: safeJsonParse(row.ideas, []),
    selectedIdea: row.selected_idea,
    script: safeJsonParse(row.script, { hook: "", intro: "", body: "", cta: "" }),
    metadata: safeJsonParse(row.metadata, { title: "", description: "", tags: [], hashtags: [] }),
    thumbnailPrompt: row.thumbnail_prompt,
    thumbnailUrl: row.thumbnail_url,
    maxDuration: row.max_duration,
    aspectRatio: row.aspect_ratio,
    voiceUrl: row.voice_url,
    subtitleSrt: row.subtitle_srt,
    finalVideoUrl: row.final_video_url,
    finalVideoPath: row.final_video_path,
    atomicLines: safeJsonParse(row.atomic_lines, []),
    error: row.error,
    scenes: [],
    logs: [],
  };

  if (includeScenes) {
    const sceneRows = db.prepare("SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_number ASC").all(row.id) as SceneRow[];
    project.scenes = sceneRows.map(sceneRowToObj);
  }

  if (includeLogs) {
    const logRows = db.prepare("SELECT * FROM logs WHERE project_id = ? ORDER BY id ASC").all(row.id) as LogRow[];
    project.logs = logRows.map(r => r.message);
  }

  return project;
}

/**
 * Convert a scene DB row to the application-level Scene object.
 */
function sceneRowToObj(row: SceneRow): DBScene {
  return {
    id: row.id,
    projectId: row.project_id,
    sceneNumber: row.scene_number,
    visualPrompt: row.visual_prompt,
    motionPrompt: row.motion_prompt,
    voiceText: row.voice_text,
    status: row.status,
    imageBase64: row.image_base64,
    imagePath: row.image_path,
    videoUrl: row.video_url,
    audioUrl: row.audio_url,
    audioDuration: row.audio_duration,
    error: row.error,
  };
}

/**
 * Safely parse JSON with a fallback default value.
 */
function safeJsonParse<T>(json: string, defaultValue: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Sanitize a value for SQLite binding.
 * SQLite can only bind: numbers, strings, bigints, Buffers, and null.
 * This converts unsupported types (undefined, boolean, objects, arrays) to safe values.
 * This is the fix for: "TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and null"
 */
function sanitizeValue(value: any): string | number | bigint | Buffer | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return value;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value) || typeof value === "object") {
    try { return JSON.stringify(value); } catch { return null; }
  }
  return String(value);
}

/**
 * Get all projects (with scenes and logs).
 */
export function getAllProjects(): DBProject[] {
  const rows = db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as ProjectRow[];
  return rows.map(r => projectRowToObj(r));
}

/**
 * Get all projects without heavy data (no scenes/base64/logs) for list views.
 */
export function getAllProjectsSummary(): Array<{
  id: string;
  name: string;
  topic: string;
  status: string;
  progress: number;
  createdAt: string;
  currentStepMessage: string;
  sceneCount: number;
  error: string;
}> {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.topic, p.status, p.progress, p.created_at,
           p.current_step_message, p.error,
           (SELECT COUNT(*) FROM scenes WHERE project_id = p.id) as scene_count
    FROM projects p
    ORDER BY p.created_at DESC
  `).all() as Array<{
    id: string;
    name: string;
    topic: string;
    status: string;
    progress: number;
    created_at: string;
    current_step_message: string;
    error: string;
    scene_count: number;
  }>;

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    topic: r.topic,
    status: r.status,
    progress: r.progress,
    createdAt: r.created_at,
    currentStepMessage: r.current_step_message,
    sceneCount: r.scene_count,
    error: r.error,
  }));
}

/**
 * Get a single project by ID (with scenes and logs).
 */
export function getProjectById(id: string): DBProject | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  if (!row) return null;
  return projectRowToObj(row);
}

/**
 * Find the first project with an active status for the background processor.
 */
export function findPendingProject(): DBProject | null {
  const row = db.prepare(`
    SELECT * FROM projects
    WHERE status IN ('researching', 'scripting', 'planning', 'generating_media', 'assembling')
    ORDER BY created_at ASC
    LIMIT 1
  `).get() as ProjectRow | undefined;
  if (!row) return null;
  return projectRowToObj(row);
}

/**
 * Create a new project.
 */
export function createProject(data: {
  id: string;
  name: string;
  topic: string;
  maxDuration?: string;
  aspectRatio?: string;
}): void {
  db.prepare(`
    INSERT INTO projects (id, name, topic, status, current_step_message, progress, created_at,
      ideas, selected_idea, script, metadata, thumbnail_prompt, thumbnail_url,
      max_duration, aspect_ratio, voice_url, subtitle_srt, final_video_url, final_video_path,
      atomic_lines, error)
    VALUES (@id, @name, @topic, 'researching', @currentStepMessage, 5, @createdAt,
      '[]', '', '{"hook":"","intro":"","body":"","cta":""}',
      '{"title":"","description":"","tags":[],"hashtags":[]}',
      '', '', @maxDuration, @aspectRatio, '', '', '', '', '[]', '')
  `).run({
    id: data.id,
    name: data.name,
    topic: data.topic,
    currentStepMessage: "Enqueuing topic generation background session...",
    createdAt: new Date().toISOString(),
    maxDuration: data.maxDuration || "Auto",
    aspectRatio: data.aspectRatio || "16:9",
  });

  // Insert initial logs
  addLog(data.id, `[SYSTEM] Created Project "${data.name}"`);
  addLog(data.id, `[SYSTEM] Layout configured to ${data.aspectRatio || "16:9"} aspect and ${data.maxDuration || "Auto"} max duration.`);
  addLog(data.id, `[SYSTEM] Added to local high-speed render priority queue.`);
}

/**
 * Save a full project (upsert pattern — updates all fields including scenes and logs).
 * This is the primary method used by the pipeline processor.
 */
export function saveProject(project: DBProject): void {
  const transaction = db.transaction(() => {
    // Upsert project
    db.prepare(`
      INSERT INTO projects (id, name, topic, status, current_step_message, progress, created_at,
        ideas, selected_idea, script, metadata, thumbnail_prompt, thumbnail_url,
        max_duration, aspect_ratio, voice_url, subtitle_srt, final_video_url, final_video_path,
        atomic_lines, error)
      VALUES (@id, @name, @topic, @status, @currentStepMessage, @progress, @createdAt,
        @ideas, @selectedIdea, @script, @metadata, @thumbnailPrompt, @thumbnailUrl,
        @maxDuration, @aspectRatio, @voiceUrl, @subtitleSrt, @finalVideoUrl, @finalVideoPath,
        @atomicLines, @error)
      ON CONFLICT(id) DO UPDATE SET
        name = @name, topic = @topic, status = @status,
        current_step_message = @currentStepMessage, progress = @progress,
        ideas = @ideas, selected_idea = @selectedIdea, script = @script,
        metadata = @metadata, thumbnail_prompt = @thumbnailPrompt,
        thumbnail_url = @thumbnailUrl, max_duration = @maxDuration,
        aspect_ratio = @aspectRatio, voice_url = @voiceUrl,
        subtitle_srt = @subtitleSrt, final_video_url = @finalVideoUrl,
        final_video_path = @finalVideoPath, atomic_lines = @atomicLines,
        error = @error
    `).run({
      id: project.id || "",
      name: project.name || "",
      topic: project.topic || "",
      status: project.status || "idle",
      currentStepMessage: project.currentStepMessage || "",
      progress: typeof project.progress === "number" && Number.isFinite(project.progress) ? project.progress : 0,
      createdAt: project.createdAt || new Date().toISOString(),
      ideas: JSON.stringify(project.ideas || []),
      selectedIdea: project.selectedIdea || "",
      script: JSON.stringify(project.script || { hook: "", intro: "", body: "", cta: "" }),
      metadata: JSON.stringify(project.metadata || { title: "", description: "", tags: [], hashtags: [] }),
      thumbnailPrompt: project.thumbnailPrompt || "",
      thumbnailUrl: project.thumbnailUrl || "",
      maxDuration: project.maxDuration || "Auto",
      aspectRatio: project.aspectRatio || "16:9",
      voiceUrl: project.voiceUrl || "",
      subtitleSrt: project.subtitleSrt || "",
      finalVideoUrl: project.finalVideoUrl || "",
      finalVideoPath: project.finalVideoPath || "",
      atomicLines: JSON.stringify(project.atomicLines || []),
      error: project.error || "",
    });

    // Delete and re-insert scenes (simpler than diffing)
    db.prepare("DELETE FROM scenes WHERE project_id = ?").run(project.id);
    const insertScene = db.prepare(`
      INSERT INTO scenes (id, project_id, scene_number, visual_prompt, motion_prompt, voice_text,
        status, image_base64, image_path, video_url, audio_url, audio_duration, error)
      VALUES (@id, @projectId, @sceneNumber, @visualPrompt, @motionPrompt, @voiceText,
        @status, @imageBase64, @imagePath, @videoUrl, @audioUrl, @audioDuration, @error)
    `);

    for (const scene of (project.scenes || [])) {
      insertScene.run({
        id: scene.id || "",
        projectId: project.id,
        sceneNumber: typeof scene.sceneNumber === "number" && Number.isFinite(scene.sceneNumber) ? scene.sceneNumber : 0,
        visualPrompt: scene.visualPrompt || "",
        motionPrompt: scene.motionPrompt || "",
        voiceText: scene.voiceText || "",
        status: scene.status || "idle",
        imageBase64: scene.imageBase64 || "",
        imagePath: scene.imagePath || "",
        videoUrl: scene.videoUrl || "",
        audioUrl: scene.audioUrl || "",
        audioDuration: typeof scene.audioDuration === "number" && Number.isFinite(scene.audioDuration) ? scene.audioDuration : 0,
        error: scene.error || "",
      });
    }

    // Sync logs: delete all and re-insert
    // This ensures the log array is in exact order
    db.prepare("DELETE FROM logs WHERE project_id = ?").run(project.id);
    const insertLog = db.prepare("INSERT INTO logs (project_id, message) VALUES (?, ?)");
    for (const logMsg of (project.logs || [])) {
      // Sanitize log message — must be a string for SQLite
      const safeMsg = typeof logMsg === "string" ? logMsg
        : logMsg === null || logMsg === undefined ? ""
        : String(logMsg);
      insertLog.run(project.id, safeMsg);
    }
  });

  try {
    transaction();
  } catch (err: any) {
    console.error(`[DATABASE] saveProject() failed for project ${project.id}:`, err.message);
    // Re-throw so callers know the save failed, but log first for debugging
    throw err;
  }
}

/**
 * Update specific project fields without replacing everything.
 */
export function updateProjectFields(id: string, fields: Record<string, any>): void {
  const allowedFields: Record<string, string> = {
    name: "name",
    topic: "topic",
    status: "status",
    currentStepMessage: "current_step_message",
    progress: "progress",
    ideas: "ideas",
    selectedIdea: "selected_idea",
    script: "script",
    metadata: "metadata",
    thumbnailPrompt: "thumbnail_prompt",
    thumbnailUrl: "thumbnail_url",
    maxDuration: "max_duration",
    aspectRatio: "aspect_ratio",
    voiceUrl: "voice_url",
    subtitleSrt: "subtitle_srt",
    finalVideoUrl: "final_video_url",
    finalVideoPath: "final_video_path",
    atomicLines: "atomic_lines",
    error: "error",
  };

  const setClauses: string[] = [];
  const values: Record<string, any> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (key in allowedFields) {
      const column = allowedFields[key];
      setClauses.push(`${column} = @${column}`);
      // JSON-encode array/object fields
      if (["ideas", "script", "metadata", "atomicLines"].includes(key)) {
        values[column] = JSON.stringify(value);
      } else {
        values[column] = sanitizeValue(value);
      }
    }
  }

  if (setClauses.length === 0) return;

  values.id = id;
  db.prepare(`UPDATE projects SET ${setClauses.join(", ")} WHERE id = @id`).run(values);
}

/**
 * Update a single scene's fields.
 */
export function updateScene(sceneId: string, fields: Partial<DBScene>): void {
  const allowedFields: Record<string, string> = {
    visualPrompt: "visual_prompt",
    motionPrompt: "motion_prompt",
    voiceText: "voice_text",
    status: "status",
    imageBase64: "image_base64",
    imagePath: "image_path",
    videoUrl: "video_url",
    audioUrl: "audio_url",
    audioDuration: "audio_duration",
    error: "error",
  };

  const setClauses: string[] = [];
  const values: Record<string, any> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (key in allowedFields) {
      const column = allowedFields[key];
      setClauses.push(`${column} = @${column}`);
      values[column] = sanitizeValue(value);
    }
  }

  if (setClauses.length === 0) return;

  values.id = sceneId;
  db.prepare(`UPDATE scenes SET ${setClauses.join(", ")} WHERE id = @id`).run(values);
}

/**
 * Delete a project and all its associated scenes and logs.
 */
export function deleteProject(id: string): void {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  // Cascade will handle scenes and logs
}

/**
 * Add a single log entry to a project.
 */
export function addLog(projectId: string, message: string): void {
  db.prepare("INSERT INTO logs (project_id, message) VALUES (?, ?)").run(projectId, message);
}

/**
 * Get logs for a project with optional pagination.
 */
export function getProjectLogs(projectId: string, limit?: number, offset?: number): string[] {
  let query = "SELECT message FROM logs WHERE project_id = ? ORDER BY id ASC";
  const params: any[] = [projectId];
  if (limit) {
    query += " LIMIT ? OFFSET ?";
    params.push(limit, offset || 0);
  }
  const rows = db.prepare(query).all(...params) as Array<{ message: string }>;
  return rows.map(r => r.message);
}

// ─── Settings CRUD ───────────────────────────────────────────────────────────

/**
 * Get the current settings.
 */
export function getSettings(): DBSettings {
  const row = db.prepare("SELECT * FROM settings WHERE id = 1").get() as any;
  if (!row) {
    throw new Error("Settings row not found. Database may be corrupted.");
  }

  return {
    ollamaUrl: row.ollama_url,
    llmModel: row.llm_model,
    comfyUrl: row.comfy_url,
    comfyCheckpoint: row.comfy_checkpoint,
    comfyNegativePrompt: row.comfy_negative_prompt,
    workflowTemplate: row.workflow_template,
    wanUrl: row.wan_url,
    motionEngine: row.motion_engine || "wan_i2v",
    wanMode: row.wan_mode,
    wanResolution: row.wan_resolution,
    wanSteps: row.wan_steps,
    wanCfg: row.wan_cfg,
    wanFrames: row.wan_frames,
    wanMotionIntensity: row.wan_motion_intensity,
    wanCheckpoint: row.wan_checkpoint,
    ltxSteps: row.ltx_steps || 20,
    ltxCfg: row.ltx_cfg || 4.0,
    ltxFrames: row.ltx_frames || 97,
    ltxFps: row.ltx_fps || 24,
    ltxWorkflowPath: row.ltx_workflow_path || "",
    comfyLora: row.comfy_lora,
    comfyLoraStrength: row.comfy_lora_strength,
    comfySampler: row.comfy_sampler,
    comfyScheduler: row.comfy_scheduler,
    comfySteps: row.comfy_steps,
    comfyCfg: row.comfy_cfg,
    ttsEngine: row.tts_engine,
    ttsUrl: row.tts_url,
    voiceProfile: row.voice_profile,
    voiceSpeed: row.voice_speed,
    voiceEmotion: row.voice_emotion,
    refAudio: row.ref_audio || "",
    refText: row.ref_text || "",
    voiceCloningEnabled: row.voice_cloning_enabled === 1,
    backupGeminiMode: row.backup_gemini_mode === 1,
    promptIdeation: row.prompt_ideation,
    promptScript: row.prompt_script,
    promptPlanning: row.prompt_planning,
    promptSplitter: row.prompt_splitter,
  };
}

/**
 * Update settings with partial data.
 */
export function updateSettings(data: Partial<DBSettings>): DBSettings {
  const fieldMap: Record<string, string> = {
    ollamaUrl: "ollama_url",
    llmModel: "llm_model",
    comfyUrl: "comfy_url",
    comfyCheckpoint: "comfy_checkpoint",
    comfyNegativePrompt: "comfy_negative_prompt",
    workflowTemplate: "workflow_template",
    wanUrl: "wan_url",
    motionEngine: "motion_engine",
    wanMode: "wan_mode",
    wanResolution: "wan_resolution",
    wanSteps: "wan_steps",
    wanCfg: "wan_cfg",
    wanFrames: "wan_frames",
    wanMotionIntensity: "wan_motion_intensity",
    wanCheckpoint: "wan_checkpoint",
    ltxSteps: "ltx_steps",
    ltxCfg: "ltx_cfg",
    ltxFrames: "ltx_frames",
    ltxFps: "ltx_fps",
    ltxWorkflowPath: "ltx_workflow_path",
    comfyLora: "comfy_lora",
    comfyLoraStrength: "comfy_lora_strength",
    comfySampler: "comfy_sampler",
    comfyScheduler: "comfy_scheduler",
    comfySteps: "comfy_steps",
    comfyCfg: "comfy_cfg",
    ttsEngine: "tts_engine",
    ttsUrl: "tts_url",
    voiceProfile: "voice_profile",
    voiceSpeed: "voice_speed",
    voiceEmotion: "voice_emotion",
    refAudio: "ref_audio",
    refText: "ref_text",
    voiceCloningEnabled: "voice_cloning_enabled",
    backupGeminiMode: "backup_gemini_mode",
    promptIdeation: "prompt_ideation",
    promptScript: "prompt_script",
    promptPlanning: "prompt_planning",
    promptSplitter: "prompt_splitter",
  };

  const setClauses: string[] = [];
  const values: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key in fieldMap) {
      const column = fieldMap[key];
      setClauses.push(`${column} = @${column}`);
      // Handle boolean → integer conversion for SQLite
      if (key === "backupGeminiMode" || key === "voiceCloningEnabled") {
        values[column] = value ? 1 : 0;
      } else {
        // Sanitize all other values to prevent SQLite bind type errors
        // SQLite can only bind: numbers, strings, bigints, Buffers, and null
        values[column] = sanitizeValue(value);
      }
    }
  }

  if (setClauses.length > 0) {
    db.prepare(`UPDATE settings SET ${setClauses.join(", ")} WHERE id = 1`).run(values);
  }

  return getSettings();
}

// ─── Statistics ──────────────────────────────────────────────────────────────

/**
 * Get dashboard statistics.
 */
export function getDashboardStats(): {
  totalJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
} {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_jobs,
      SUM(CASE WHEN status IN ('researching','scripting','planning','generating_media','assembling') THEN 1 ELSE 0 END) as running_jobs,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_jobs,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_jobs
    FROM projects
  `).get() as any;

  return {
    totalJobs: stats.total_jobs || 0,
    runningJobs: stats.running_jobs || 0,
    completedJobs: stats.completed_jobs || 0,
    failedJobs: stats.failed_jobs || 0,
  };
}

/**
 * Close the database connection gracefully.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}
