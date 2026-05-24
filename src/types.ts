export interface AISettings {
  ollamaUrl: string;
  llmModel: string;
  comfyUrl: string;
  comfyCheckpoint: string;
  comfyNegativePrompt: string;
  workflowTemplate: string;
  comfyLora?: string;
  comfyLoraStrength?: number;
  comfySampler?: string;
  comfyScheduler?: string;
  comfySteps?: number;
  comfyCfg?: number;
  wanUrl: string;
  wanMode: 'i2v' | 't2v';
  wanResolution: '16:9' | '9:16';
  wanSteps: number;
  wanCfg: number;
  wanFrames: number;
  wanMotionIntensity: number;
  ttsEngine: 'f5-tts' | 'styletts2' | 'piper' | 'gemini-tts';
  ttsUrl: string;
  voiceProfile: string;
  voiceSpeed: number;
  voiceEmotion: string;
  backupGeminiMode: boolean; // Use server-side Gemini to simulate or fallback properly
  promptIdeation?: string;
  promptScript?: string;
  promptPlanning?: string;
  promptSplitter?: string;
}

export interface Scene {
  id: string;
  sceneNumber: number;
  visualPrompt: string;
  motionPrompt: string;
  voiceText: string;
  status: 'idle' | 'generating_image' | 'generating_video' | 'generating_audio' | 'completed' | 'failed';
  imageBase64?: string;
  imagePath?: string; // Local disk path for FFmpeg assembly
  videoUrl?: string; // Video animation preview or canvas simulation
  audioUrl?: string; // Voiceover chunk
  audioDuration?: number; // Duration in seconds (for FFmpeg timing)
  error?: string;
}

export interface ProjectMetadata {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
}

export interface Project {
  id: string;
  name: string;
  topic: string;
  status: 'idle' | 'researching' | 'scripting' | 'planning' | 'generating_media' | 'assembling' | 'completed' | 'failed';
  currentStepMessage: string;
  progress: number;
  logs: string[];
  createdAt: string;
  ideas: string[];
  selectedIdea: string;
  script: {
    hook: string;
    intro: string;
    body: string;
    cta: string;
  };
  metadata: ProjectMetadata;
  scenes: Scene[];
  thumbnailPrompt: string;
  thumbnailUrl?: string;
  maxDuration?: string;
  aspectRatio?: string;
  voiceUrl?: string; // Full voice wav file
  subtitleSrt?: string; // Raw SRT file text
  finalVideoUrl?: string; // Final assembled container file
  error?: string;
  atomicLines?: string[];
}

export interface JobDashboardStats {
  totalJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
}
