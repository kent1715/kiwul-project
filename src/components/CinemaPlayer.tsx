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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeScene: Scene | undefined = project.scenes[currentSceneIndex];
  const SCENE_DURATION_SEC = 6.4;

  useEffect(() => {
    let interval: any = null;
    if (isPlaying && project.scenes.length > 0) {
      interval = setInterval(() => {
        setSceneProgress(prev => {
          if (prev >= 100) {
            setCurrentSceneIndex(prevIndex => {
              if (prevIndex >= project.scenes.length - 1) {
                setIsPlaying(false);
                return 0;
              }
              return prevIndex + 1;
            });
            return 0;
          }
          return prev + (100 / (SCENE_DURATION_SEC * 10));
        });
      }, 100);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isPlaying, project.scenes]);

  useEffect(() => {
    if (activeScene?.audioUrl && isPlaying) {
      if (audioRef.current) {
        audioRef.current.src = activeScene.audioUrl;
        audioRef.current.muted = isMuted;
        audioRef.current.play().catch(() => {});
      }
    }
  }, [currentSceneIndex, isPlaying]);

  const handlePlayPause = () => setIsPlaying(!isPlaying);

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
    const metaTxt = `=== YOUTUBE SEO METADATA ===\nTITLE: ${project.metadata?.title || ""}\nTAGS: ${(project.metadata?.tags || []).join(", ")}\nHASHTAGS: ${(project.metadata?.hashtags || []).join(" ")}\n\n=== DESCRIPTION ===\n${project.metadata?.description || ""}\n\n=== GENERATION LOGS ===\n${project.logs.join("\n")}`;
    downloadFile(metaTxt, `${project.name.toLowerCase().replace(/\s+/g, "_")}_metadata.txt`, "text/plain");
  };

  const handleDownloadInstallScript = () => {
    const scriptContent = `#!/bin/bash\n# ====================================================================\n# Project Kiwul Pipeline - Local Autonomous Setup Installer\n# ====================================================================\n\necho "Installing Project Kiwul Local AI Engines..."\n\n# 1. Ollama\nif ! command -v ollama &> /dev/null; then\n  curl -fsSL https://ollama.com/install.sh | sh\nfi\nnohup ollama serve > /dev/null 2>&1 &\nsleep 5\nollama pull qwen3:8b\n\n# 2. ComfyUI\ngit clone https://github.com/comfyanonymous/ComfyUI.git\ncd ComfyUI && pip install -r requirements.txt\n\n# 3. F5-TTS\ngit clone https://github.com/SWUFE-FDC-PR/F5-TTS.git\ncd F5-TTS && pip install -e .\n\necho "Setup Complete!"`;
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
    <div className="rounded-xl overflow-hidden border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] select-none">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-surface-3)] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center">
            <Film size={14} className="text-brand-600" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-ink-800)]">Preview Player</p>
            <p className="text-[10px] text-[var(--color-ink-400)] truncate max-w-[180px]">{project.name}</p>
          </div>
        </div>
        <span className="badge badge-neutral text-[9px]">Slideshow Mode</span>
      </div>

      {/* Video Area */}
      <div className="relative aspect-video bg-black overflow-hidden">
        <audio ref={audioRef} className="hidden" />

        {project.scenes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center bg-[#0f1117] text-[var(--color-ink-400)]">
            <Film size={32} className="text-[var(--color-ink-300)] mb-2" />
            <p className="text-xs font-medium text-[var(--color-ink-300)]">No scenes yet</p>
            <p className="text-[10px] text-[var(--color-ink-500)] mt-1">Run the pipeline to generate scenes</p>
          </div>
        ) : (
          <div className="relative w-full h-full overflow-hidden">
            <img
              src={activeScene?.imageBase64 || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1280&q=80"}
              alt="Scene"
              className={`w-full h-full object-cover transform select-none origin-center ${motionClass}`}
              referrerPolicy="no-referrer"
            />

            {/* Subtitles */}
            {showSubtitles && activeScene?.voiceText && (
              <div className="absolute bottom-10 inset-x-0 px-8 text-center pointer-events-none">
                <p className="inline-block bg-black/80 text-amber-200 px-4 py-1.5 rounded-lg text-xs font-medium max-w-2xl leading-relaxed">
                  {activeScene.voiceText}
                </p>
              </div>
            )}

            {/* Scene Info */}
            <div className="absolute top-3 left-3 flex gap-1.5">
              <span className="bg-black/70 backdrop-blur-sm text-[10px] font-medium text-white px-2 py-0.5 rounded-md">
                {currentSceneIndex + 1}/{project.scenes.length}
              </span>
              <span className="bg-black/70 backdrop-blur-sm text-[10px] text-cyan-300 px-2 py-0.5 rounded-md">
                {activeScene?.motionPrompt || "Zoom In"}
              </span>
            </div>

            {/* Progress */}
            <div className="absolute bottom-0 inset-x-0 h-0.5 bg-white/10">
              <div className="h-full bg-brand-500 transition-all ease-linear" style={{ width: `${sceneProgress}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      {project.scenes.length > 0 && (
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button onClick={handlePlayPause}
                className="w-8 h-8 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors flex items-center justify-center shadow-sm">
                {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
              </button>
              <button onClick={handleReset}
                className="w-8 h-8 rounded-lg bg-[var(--color-surface-2)] text-[var(--color-ink-600)] hover:bg-[var(--color-surface-3)] transition-colors flex items-center justify-center">
                <RotateCcw size={14} />
              </button>
              <button onClick={() => setIsMuted(!isMuted)}
                className={`w-8 h-8 rounded-lg transition-colors flex items-center justify-center ${isMuted ? "bg-red-50 text-red-500" : "bg-[var(--color-surface-2)] text-[var(--color-ink-600)]"}`}>
                {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <button onClick={() => setShowSubtitles(!showSubtitles)}
                className={`w-8 h-8 rounded-lg transition-colors flex items-center justify-center ${showSubtitles ? "bg-cyan-50 text-cyan-600" : "bg-[var(--color-surface-2)] text-[var(--color-ink-600)]"}`}>
                <Subtitles size={14} />
              </button>
            </div>

            <div className="flex gap-1.5">
              {project.subtitleSrt && (
                <button onClick={handleDownloadSRT} className="btn-ghost text-[10px] gap-1 text-[var(--color-ink-500)] px-2 py-1 rounded-md border border-[var(--color-surface-3)]">
                  <Download size={10} /> SRT
                </button>
              )}
              {project.metadata && (
                <button onClick={handleDownloadMetadata} className="btn-ghost text-[10px] gap-1 text-[var(--color-ink-500)] px-2 py-1 rounded-md border border-[var(--color-surface-3)]">
                  <FileText size={10} /> Meta
                </button>
              )}
              {project.thumbnailUrl && (
                <a href={project.thumbnailUrl} download="thumbnail.svg"
                  className="btn-ghost text-[10px] gap-1 text-[var(--color-ink-500)] px-2 py-1 rounded-md border border-[var(--color-surface-3)]">
                  <Image size={10} /> Thumb
                </a>
              )}
            </div>
          </div>

          {/* Setup Script */}
          <div className="p-3 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-surface-3)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame size={13} className="text-amber-500" />
              <div>
                <p className="text-[11px] font-medium text-[var(--color-ink-700)]">Local RTX Setup Script</p>
                <p className="text-[9px] text-[var(--color-ink-400)]">Shell script for local engine installation</p>
              </div>
            </div>
            <button onClick={handleDownloadInstallScript}
              className="text-[10px] font-semibold text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1 rounded-md transition-colors">
              setup.sh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
