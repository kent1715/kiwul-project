import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Subtitles, Film, Download, FileText, Image, CheckCircle, Flame } from "lucide-react";
import { Project, Scene } from "../types";

interface CinemaPlayerProps {
  project: Project;
}

export default function CinemaPlayer({ project }: CinemaPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [sceneProgress, setSceneProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(true);

  // Audio elements ref for playing real-time synchronized sounds if we have audio base64 clips
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const activeScene: Scene | undefined = project.scenes[currentSceneIndex];

  // Duration in seconds per scene simulation
  const SCENE_DURATION_SEC = 6.4;

  useEffect(() => {
    let interval: any = null;
    if (isPlaying && project.scenes.length > 0) {
      interval = setInterval(() => {
        setSceneProgress((prev) => {
          if (prev >= 100) {
            // Next scene
            setCurrentSceneIndex((prevIndex) => {
              if (prevIndex >= project.scenes.length - 1) {
                // Loop end
                setIsPlaying(false);
                return 0;
              }
              return prevIndex + 1;
            });
            return 0;
          }
          return prev + (100 / (SCENE_DURATION_SEC * 10)); // increment based on interval frequency
        });
      }, 100);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isPlaying, project.scenes]);

  // Handle playing scene specific synthesized narration audio wave from server if available
  useEffect(() => {
    if (activeScene && activeScene.audioUrl && isPlaying) {
      if (audioRef.current) {
        audioRef.current.src = activeScene.audioUrl;
        audioRef.current.muted = isMuted;
        audioRef.current.play().catch(() => {});
      }
    }
  }, [currentSceneIndex, isPlaying]);

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentSceneIndex(0);
    setSceneProgress(0);
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadSRT = () => {
    if (!project.subtitleSrt) return;
    downloadFile(project.subtitleSrt, `${project.name.toLowerCase().replace(/\s+/g, "_")}_subtitles.srt`, "text/plain");
  };

  const handleDownloadMetadata = () => {
    const metaTxt = `=== YOUTUBE SEO METADATA ===
TITLE: ${project.metadata?.title || ""}
TAGS: ${(project.metadata?.tags || []).join(", ")}
HASHTAGS: ${(project.metadata?.hashtags || []).join(" ")}

=== DESCRIPTION ===
${project.metadata?.description || ""}

=== GENERATION LOGS ===
${project.logs.join("\n")}
`;
    downloadFile(metaTxt, `${project.name.toLowerCase().replace(/\s+/g, "_")}_metadata.txt`, "text/plain");
  };

  const handleDownloadInstallScript = () => {
    const scriptContent = `#!/bin/bash
# ====================================================================
# Project Kiwul Pipeline - Local Autonomous Setup Installer
# Supports: RTX 2000 Ada, i9-14900, 32GB RAM + Ubuntu/CentOS/WSL2
# ====================================================================

echo "=========================================================="
echo "Installing Project Kiwul Local AI Engines..."
echo "=========================================================="

# 1. Ollama installation
if ! command -v ollama &> /dev/null; then
    echo "Installing Ollama LLM provider..."
    curl -fsSL https://ollama.com/install.sh | sh
else
    echo "Ollama is already installed."
fi

# Starting Ollama in background & pulling qwen3:8b
nohup ollama serve > /dev/null 2>&1 &
sleep 5
echo "Pulling script generator model qwen3:8b..."
ollama pull qwen3:8b

# 2. ComfyUI + WAN 2.2 Local setup
echo "Creating deep clone repositories for ComfyUI + WAN animation..."
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI
pip install -r requirements.txt

# Create WAN checkpoints and Motion models folder
mkdir -p models/checkpoints
mkdir -p models/wan2.2

echo "Installing F5 Text-To-Speech modules..."
git clone https://github.com/SWUFE-FDC-PR/F5-TTS.git
cd F5-TTS
pip install -e .

echo "Setup Complete! Start local engines and set connections inside settings page."
`;
    downloadFile(scriptContent, "setup_kiwul_local_engines.sh", "application/x-sh");
  };

  const currentMotion = activeScene?.motionPrompt?.toLowerCase() || "";
  let motionClass = "scale-100 translate-x-0 translate-y-0";
  if (isPlaying) {
    if (currentMotion.includes("zoom") || currentMotion.includes("scale") || currentMotion.includes("forward")) {
      motionClass = "scale-110 duration-[6500ms] transition-transform ease-out";
    } else if (currentMotion.includes("pan right") || currentMotion.includes("panning right")) {
      motionClass = "translate-x-12 scale-105 duration-[6500ms] transition-transform ease-out";
    } else if (currentMotion.includes("pan left") || currentMotion.includes("track left")) {
      motionClass = "-translate-x-12 scale-105 duration-[6500ms] transition-transform ease-out";
    } else if (currentMotion.includes("crane") || currentMotion.includes("up")) {
      motionClass = "-translate-y-12 scale-105 duration-[6500ms] transition-transform ease-out";
    } else {
      motionClass = "scale-105 duration-[6500ms] ease-out";
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800/80 rounded-2xl overflow-hidden p-5 shadow-xl select-none">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-rose-500/10 rounded-lg">
            <Film size={18} className="text-rose-400" />
          </div>
          <div>
            <span className="text-xs text-rose-500 font-bold tracking-wider font-mono">PRE-RENDER CINEMA VIEWER</span>
            <h2 className="text-sm font-semibold text-slate-200 truncate max-w-sm">{project.name}</h2>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded text-[10px] font-mono border border-slate-800 text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 block animate-pulse"></span>
          <span>SLIDESHOW MOTION EMULATION READY</span>
        </div>
      </div>

      <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-slate-950/80 shadow-inner group">
        <audio ref={audioRef} className="hidden" />

        {/* Display scene image context with ken burns panning */}
        {project.scenes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-radial-gradient from-slate-900 to-black text-slate-400">
            <Film size={40} className="text-slate-700 mb-2 stroke-[1.5] animate-bounce" />
            <p className="text-sm font-semibold text-slate-300">No scene frames exist in timeline</p>
            <p className="text-xs text-slate-500 mt-1 max-w-xs">Launch the autonomous generator pipeline first to create script assets and visual images.</p>
          </div>
        ) : (
          <div className="relative w-full h-full overflow-hidden">
            <img
              src={activeScene?.imageBase64 || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1280&q=80"}
              alt="Generated Visual Scene Content"
              className={`w-full h-full object-cover transform select-none origin-center ${motionClass}`}
              referrerPolicy="no-referrer"
            />

            {/* Subtitles Overlay */}
            {showSubtitles && activeScene?.voiceText && (
              <div className="absolute bottom-12 inset-x-0 px-10 text-center pointer-events-none drop-shadow-md">
                <p className="inline-block bg-black/85 text-amber-300 px-4 py-1.5 rounded border border-slate-800/80 font-sans text-xs md:text-sm font-semibold max-w-2xl leading-relaxed tracking-wide select-none">
                  {activeScene.voiceText}
                </p>
              </div>
            )}

            {/* Info Badge */}
            <div className="absolute top-4 left-4 flex gap-2">
              <span className="bg-black/80 backdrop-blur-md text-[10px] font-mono font-bold text-rose-400 border border-rose-500/20 px-2.5 py-1 rounded">
                Scene {currentSceneIndex + 1}/{project.scenes.length}
              </span>
              <span className="bg-black/80 backdrop-blur-md text-[10px] font-mono text-cyan-400 border border-cyan-500/10 px-2.5 py-1 rounded">
                {activeScene?.motionPrompt || "Zoom In camera trajectory"}
              </span>
            </div>

            {/* Progress Bar inside Stage */}
            <div className="absolute bottom-0 inset-x-0 h-1 bg-slate-900">
              <div
                className="h-full bg-gradient-to-r from-rose-500 to-amber-500 transition-all ease-linear"
                style={{ width: `${sceneProgress}%` }}
              ></div>
            </div>
          </div>
        )}
      </div>

      {project.scenes.length > 0 && (
        <div className="mt-4 flex flex-col gap-4">
          {/* Controls Bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={handlePlayPause}
                className="p-2 rounded-lg bg-rose-500 text-white hover:bg-rose-600 transition-all flex items-center justify-center shadow-lg"
                title={isPlaying ? "Pause Scene Player" : "Start Production Player"}
              >
                {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              </button>
              <button
                onClick={handleReset}
                className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                title="Reset to frame 1"
              >
                <RotateCcw size={18} />
              </button>
              <button
                onClick={() => setIsMuted(!isMuted)}
                className={`p-2 rounded-lg transition-colors ${isMuted ? "bg-red-500/10 text-red-400" : "bg-slate-800 text-slate-300"}`}
                title={isMuted ? "Voice naration muted" : "Voice enabled"}
              >
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <button
                onClick={() => setShowSubtitles(!showSubtitles)}
                className={`p-2 rounded-lg transition-colors ${showSubtitles ? "bg-cyan-500/10 text-cyan-400" : "bg-slate-800 text-slate-300"}`}
                title="Toggle subtitles overlays"
              >
                <Subtitles size={18} />
              </button>
            </div>

            {/* Right downloads action buttons */}
            <div className="flex gap-2">
              {project.subtitleSrt && (
                <button
                  onClick={handleDownloadSRT}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors rounded-lg border border-slate-700"
                >
                  <Download size={14} className="text-cyan-400" />
                  <span>SRT</span>
                </button>
              )}
              {project.metadata && (
                <button
                  onClick={handleDownloadMetadata}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors rounded-lg border border-slate-700"
                >
                  <FileText size={14} className="text-rose-400" />
                  <span>Metadata TXT</span>
                </button>
              )}
              {project.thumbnailUrl && (
                <a
                  href={project.thumbnailUrl}
                  download="click_thumbnail.svg"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors rounded-lg border border-slate-700"
                >
                  <Image size={14} className="text-amber-400" />
                  <span>Thumbnail</span>
                </a>
              )}
            </div>
          </div>

          {/* Setup Script for local RTX hardware */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame size={15} className="text-rose-400 animate-pulse" />
              <div className="text-[11px]">
                <p className="text-slate-300 font-semibold">Ready to test offline on your local PC?</p>
                <p className="text-slate-500 font-mono">RTX 2000 Ada / RTX 3080/4090 shell compiler script</p>
              </div>
            </div>
            <button
              onClick={handleDownloadInstallScript}
              className="px-3 py-1.5 text-[11px] font-bold tracking-wider font-mono text-cyan-400 bg-cyan-950/45 hover:bg-cyan-950 rounded-lg hover:text-white transition-all border border-cyan-500/40"
            >
              GENERATE SETUP.SH
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
