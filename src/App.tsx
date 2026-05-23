import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Cpu,
  Layers,
  Settings,
  Plus,
  Play,
  RotateCcw,
  Loader2,
  Tv,
  Activity,
  FileText,
  RefreshCw,
  Database,
  Trash2,
  Edit2,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  Sliders,
  AlertTriangle,
  Info,
  Save,
  Video,
  ChevronRight,
  HelpCircle,
} from "lucide-react";

import { Project, AISettings, Scene } from "./types";
import CinemaPlayer from "./components/CinemaPlayer";
import ConsoleTerminal from "./components/ConsoleTerminal";

const SUGGESTED_STORIES = [
  "The Theft of the Irish Crown Jewels (1907)",
  "The 1972 Andes plane crash",
  "The 2010 Chile mine rescue",
  "The Great Escape from Stalag Luft III",
  "The disappearance of the Mary Celeste",
  "Operation Anthropoid — killing Heydrich",
  "The Radium Girls factory poisoning",
  "Ernest Shackleton's Endurance expedition",
  "The Dyatlov Pass incident",
  "The Alcatraz escape of 1962",
  "The 1980 MGM Grand Hotel fire",
];

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  
  // Create project form states
  const [newTopic, setNewTopic] = useState("");
  const [newName, setNewName] = useState("");
  const [maxDuration, setMaxDuration] = useState("Auto");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [isCreating, setIsCreating] = useState(false);

  // Settings states
  const [settings, setSettings] = useState<AISettings>({
    ollamaUrl: "http://localhost:11434",
    llmModel: "qwen3:8b",
    comfyUrl: "http://localhost:8188",
    workflowTemplate: "FLUX_Dev_Standard",
    wanMode: "i2v",
    wanResolution: "16:9",
    wanSteps: 20,
    wanCfg: 6.0,
    wanFrames: 81,
    wanMotionIntensity: 7,
    ttsEngine: "f5-tts",
    voiceProfile: "natural_charles",
    voiceSpeed: 1.0,
    voiceEmotion: "neutral",
    backupGeminiMode: true,
  });
  
  const [activeTab, setActiveTab] = useState<"workspace" | "settings" | "docs">("workspace");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSavedMessage, setSettingsSavedMessage] = useState("");

  // Connection check state for local AI
  const [connectionCheck, setConnectionCheck] = useState<{
    checked: boolean;
    loading: boolean;
    ollamaOk: boolean | null;
    comfyOk: boolean | null;
    ollamaDetails: string;
    comfyDetails: string;
  }>({
    checked: false,
    loading: false,
    ollamaOk: null,
    comfyOk: null,
    ollamaDetails: "",
    comfyDetails: "",
  });

  const handleCheckConnections = async () => {
    // Cek hanya sekali jika status sudah konek tidak usah di cek lagi (both OK)
    if (connectionCheck.ollamaOk && connectionCheck.comfyOk) {
      return;
    }
    setConnectionCheck(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch("/api/check-connections");
      const data = await res.json();
      if (data.success) {
        setConnectionCheck({
          checked: true,
          loading: false,
          ollamaOk: data.ollama.ok,
          comfyOk: data.comfy.ok,
          ollamaDetails: data.ollama.message,
          comfyDetails: data.comfy.message,
        });
      } else {
        setConnectionCheck({
          checked: true,
          loading: false,
          ollamaOk: false,
          comfyOk: false,
          ollamaDetails: "Failed connection read",
          comfyDetails: "Failed connection read",
        });
      }
    } catch (err: any) {
      setConnectionCheck({
        checked: true,
        loading: false,
        ollamaOk: false,
        comfyOk: false,
        ollamaDetails: "Offline: " + err.message,
        comfyDetails: "Offline: " + err.message,
      });
    }
  };
  
  // Editing individual script blocks & ideas input directly
  const [isEditingScript, setIsEditingScript] = useState(false);
  const [editHook, setEditHook] = useState("");
  const [editIntro, setEditIntro] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editCta, setEditCta] = useState("");

  // Editing scene details
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [editVisualPrompt, setEditVisualPrompt] = useState("");
  const [editMotionPrompt, setEditMotionPrompt] = useState("");
  const [editVoiceText, setEditVoiceText] = useState("");

  // Load and refresh stats
  useEffect(() => {
    fetchSettings();
    fetchProjects(true);
  }, []);

  // Poll for active background jobs
  useEffect(() => {
    const hasActiveJob = projects.some(
      (p) =>
        p.status === "researching" ||
        p.status === "scripting" ||
        p.status === "planning" ||
        p.status === "generating_media" ||
        p.status === "assembling"
    );

    if (hasActiveJob) {
      const interval = setInterval(() => {
        fetchProjects(false);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [projects]);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (err) {
      console.error("Error loading local settings:", err);
    }
  };

  const fetchProjects = async (selectFirst = false) => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data: Project[] = await res.json();
        setProjects(data);
        
        // Retain selection or fallback to first
        if (data.length > 0) {
          if (selectFirst && !selectedProject) {
            setSelectedProject(data[0]);
          } else {
            const currentSelected = data.find((p) => p.id === selectedProject?.id);
            if (currentSelected) {
              setSelectedProject(currentSelected);
            }
          }
        } else {
          setSelectedProject(null);
        }
      }
    } catch (err) {
      console.error("Error loading factory queue projects:", err);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTopic.trim()) return;

    setIsCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: newTopic,
          name: newName.trim() ? newName : `Video Factory: ${newTopic}`,
          maxDuration: maxDuration,
          aspectRatio: aspectRatio,
        }),
      });

      if (res.ok) {
        const newProj = await res.json();
        setNewTopic("");
        setNewName("");
        setMaxDuration("Auto");
        setAspectRatio("16:9");
        await fetchProjects(false);
        setSelectedProject(newProj);
      }
    } catch (error) {
      console.error("Error spawning project factory pipeline:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setSettingsSavedMessage("");
    // Reset connection check when settings are saved (allowing fresh re-test)
    setConnectionCheck({
      checked: false,
      loading: false,
      ollamaOk: null,
      comfyOk: null,
      ollamaDetails: "",
      comfyDetails: "",
    });
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setSettingsSavedMessage("AI Settings saved globally on local cluster host!");
        setTimeout(() => setSettingsSavedMessage(""), 4000);
      }
    } catch (err) {
      console.error("Error writing settings configs:", err);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleRetryProject = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/retry`, {
        method: "POST",
      });
      if (res.ok) {
        const updated = await res.json();
        await fetchProjects();
        setSelectedProject(updated);
      }
    } catch (err) {
      console.error("Error performing retry command request:", err);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!window.confirm("Are you sure you want to delete this video pipeline? All files will be recycled.")) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchProjects(true);
      }
    } catch (err) {
      console.error("Error recycling project files:", err);
    }
  };

  // Fast script modifier save mechanism
  const startEditingScript = (proj: Project) => {
    setEditHook(proj.script?.hook || "");
    setEditIntro(proj.script?.intro || "");
    setEditBody(proj.script?.body || "");
    setEditCta(proj.script?.cta || "");
    setIsEditingScript(true);
  };

  const saveEditedScript = async () => {
    if (!selectedProject) return;
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: {
            hook: editHook,
            intro: editIntro,
            body: editBody,
            cta: editCta,
          },
          logs: [...selectedProject.logs, `[USER] Manually tuned and locked script segments.`]
        }),
      });
      if (res.ok) {
        setIsEditingScript(false);
        await fetchProjects();
      }
    } catch (err) {
      console.error("Error saving script revisions:", err);
    }
  };

  // Detail scene properties direct optimization edit
  const startEditingScene = (scene: Scene) => {
    setEditingSceneId(scene.id);
    setEditVisualPrompt(scene.visualPrompt);
    setEditMotionPrompt(scene.motionPrompt || "");
    setEditVoiceText(scene.voiceText);
  };

  const saveEditedScene = async (sceneId: string) => {
    if (!selectedProject) return;
    const updatedScenes = selectedProject.scenes.map((s) => {
      if (s.id === sceneId) {
        return {
          ...s,
          visualPrompt: editVisualPrompt,
          motionPrompt: editMotionPrompt,
          voiceText: editVoiceText,
        };
      }
      return s;
    });

    try {
      const res = await fetch(`/api/projects/${selectedProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: updatedScenes,
          logs: [...selectedProject.logs, `[USER] Tweaked Scene parameters manually for optimal shot direction.`]
        }),
      });
      if (res.ok) {
        setEditingSceneId(null);
        await fetchProjects();
      }
    } catch (err) {
      console.error("Error saving Scene parameters:", err);
    }
  };

  // Helper stats values
  const totalJobs = projects.length;
  const runningJobs = projects.filter((p) => ["researching", "scripting", "planning", "generating_media", "assembling"].includes(p.status)).length;
  const completedJobs = projects.filter((p) => p.status === "completed").length;
  const failedJobs = projects.filter((p) => p.status === "failed").length;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col font-sans antialiased selection:bg-rose-500 selection:text-white">
      {/* High-End Minimalist Cinematic Header Nav */}
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur-md px-6 py-4 sticky top-0 z-50 flex flex-wrap justify-between items-center gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center p-2.5 bg-gradient-to-br from-rose-500 to-rose-600 rounded-xl shadow-md">
            <Cpu size={22} className="text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-rose-600 font-mono">
                PROJECT KIWUL
              </h1>
              <span className="bg-rose-100 text-rose-700 text-[10px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded border border-rose-200 font-mono">
                v2.2 WAN LOCAL
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Offline Faceless YouTube Automated Content Factory
            </p>
          </div>
        </div>

        {/* Global Local Connection Monitor Grid */}
        <div className="hidden lg:flex items-center gap-6">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 block"></span>
            <span className="text-slate-500">Ollama API:</span>
            <code className="bg-slate-100 px-2 py-0.5 rounded text-slate-705 border border-slate-200 text-[11px]">
              {settings.ollamaUrl}
            </code>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-orange-500 block"></span>
            <span className="text-slate-500">ComfyUI Host:</span>
            <code className="bg-slate-100 px-2 py-0.5 rounded text-orange-605 border border-slate-200 text-[11px]">
              {settings.comfyUrl}
            </code>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full block ${settings.backupGeminiMode ? "bg-cyan-500" : "bg-slate-400"}`}></span>
            <span className="text-slate-500">Hybrid Cloud Fallback:</span>
            <span className="font-semibold text-[11px] text-slate-700">
              {settings.backupGeminiMode ? "ENABLED (Hybrid)" : "DISABLED (100% WAN)"}
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("workspace")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold tracking-wider font-mono transition-all border ${
              activeTab === "workspace"
                ? "bg-rose-500 text-white border-rose-600 shadow-md shadow-rose-950/10"
                : "bg-white text-slate-605 border-slate-200 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Layers size={14} />
            <span>FACTORY WORKSPACE</span>
          </button>
          
          <button
            onClick={() => setActiveTab("settings")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold tracking-wider font-mono transition-all border ${
              activeTab === "settings"
                ? "bg-rose-500 text-white border-rose-600 shadow-md shadow-rose-950/10"
                : "bg-white text-slate-605 border-slate-200 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Settings size={14} />
            <span>AI ENGINES</span>
          </button>

          <button
            onClick={() => setActiveTab("docs")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold tracking-wider font-mono transition-all border ${
              activeTab === "docs"
                ? "bg-rose-500 text-white border-rose-600 shadow-md shadow-rose-950/10"
                : "bg-white text-slate-650 border-slate-200 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <HelpCircle size={14} />
            <span>DOCUMENTATION</span>
          </button>
        </div>
      </header>

      {/* Primary Pipeline stats dashboard indicator */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between text-xs text-slate-500 shadow-sm">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-cyan-500 animate-pulse" />
          <span className="font-bold text-slate-800">LOCAL CLUSTER PIPELINE QUEUE STATS:</span>
        </div>
        <div className="flex gap-4">
          <span className="flex items-center gap-1">
            <span className="text-slate-400 font-mono">Total Scheduled:</span>
            <strong className="text-slate-800">{totalJobs}</strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping inline-block"></span>
            <span className="text-slate-400 font-mono">Rendering:</span>
            <strong className="text-rose-600">{runningJobs}</strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-slate-400 font-mono">Completed:</span>
            <strong className="text-emerald-600">{completedJobs}</strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-slate-400 font-mono">Failed:</span>
            <strong className="text-amber-600">{failedJobs}</strong>
          </span>
        </div>
      </div>

      {activeTab === "workspace" && (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
          {/* Column A (Left 3/12): Video Factory Job Spawn and Pipe Manager list */}
          <div className="lg:col-span-3 flex flex-col gap-6">
            {/* Spawn New Story Quick Action Toggle */}
            <button
              onClick={() => setSelectedProject(null)}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold font-mono tracking-wider rounded-xl border transition-all active:scale-[0.98] shadow-sm cursor-pointer ${
                !selectedProject
                  ? "bg-rose-500 text-white border-rose-605 ring-2 ring-rose-500/10 font-black"
                  : "bg-slate-900 hover:bg-slate-800 text-white border-slate-950"
              }`}
            >
              <Plus size={14} className={!selectedProject ? "spin-360 duration-300" : ""} />
              <span>SPAWN NEW STORY</span>
            </button>

            {/* Active Jobs list */}
            <div className="bg-white border border-slate-205 rounded-2xl flex-1 flex flex-col p-4 shadow-sm min-h-[400px]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Database size={15} className="text-cyan-600" />
                  <h3 className="text-xs font-bold tracking-wider text-slate-800 uppercase font-mono">
                    AUTONOMOUS JOBS QUEUE
                  </h3>
                </div>
                <button
                  onClick={() => fetchProjects(false)}
                  className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                  title="Manual reload stats"
                >
                  <RefreshCw size={12} />
                </button>
              </div>

              {projects.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400">
                  <Database size={30} className="text-slate-300 mb-2 stroke-[1.2]" />
                  <p className="text-xs font-bold uppercase font-mono text-slate-500">Empty Queue</p>
                  <p className="text-[10px] text-slate-400 mt-1">No video renders planned. Spawn one first to start generating.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 max-h-[500px] lg:max-h-none">
                  {projects.map((proj) => {
                    const isSelected = selectedProject?.id === proj.id;
                    const isActive = ["researching", "scripting", "planning", "generating_media", "assembling"].includes(proj.status);
                    
                    let badgeColor = "bg-slate-50 text-slate-600 border-slate-200";
                    if (proj.status === "completed") badgeColor = "bg-emerald-50 text-emerald-600 border-emerald-200";
                    if (proj.status === "failed") badgeColor = "bg-amber-50 text-amber-600 border-amber-200";
                    if (isActive) badgeColor = "bg-rose-550/10 text-rose-600 border-rose-500/20 animate-pulse";

                    return (
                      <div
                        key={proj.id}
                        onClick={() => setSelectedProject(proj)}
                        className={`group p-3 rounded-xl border transition-all cursor-pointer relative ${
                          isSelected
                            ? "bg-rose-50/40 border-rose-450 shadow-sm translate-x-1"
                            : "bg-slate-50/50 border-slate-200 hover:bg-slate-100/50 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="truncate flex-1">
                            <span className="text-[10px] font-mono text-slate-400 block">
                              {new Date(proj.createdAt).toLocaleDateString()} @ {new Date(proj.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <h4 className="text-xs font-semibold text-slate-850 truncate group-hover:text-slate-950 mt-0.5">
                              {proj.name}
                            </h4>
                          </div>
                          
                          {/* Close / Action */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteProject(proj.id);
                            }}
                            className="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-slate-100 transition-all opacity-0 group-hover:opacity-100"
                            title="Recycle Job"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>

                        {/* Progress Bar indicator */}
                        {isActive && (
                          <div className="mt-2.5 h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-rose-500 to-amber-500"
                              style={{ width: `${proj.progress}%` }}
                            ></div>
                          </div>
                        )}

                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-[10px] font-mono">
                          <span className={`px-2 py-0.5 rounded border ${badgeColor}`}>
                            {proj.status.replace("_", " ").toUpperCase()}
                          </span>
                          <span className="text-slate-500 font-bold">
                            {isActive ? `${proj.progress}%` : proj.status === "completed" ? "100%" : "0%"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {!selectedProject ? (
            /* Spacious 9/12 column placeholder containing the stunning creator wizard */
            <div className="lg:col-span-9 flex flex-col items-center justify-center bg-white border border-slate-200 rounded-2xl p-6 lg:p-10 shadow-sm min-h-[550px] overflow-hidden">
              <div className="max-w-2xl w-full flex flex-col items-center text-center">
                {/* Heading */}
                <div className="space-y-1.5 mb-6 animate-fade-in">
                  <h2 className="text-2xl font-black tracking-tight text-slate-900 font-sans">
                    Mau Bikin Konten Apa?
                  </h2>
                  <p className="text-xs font-semibold text-slate-400 font-mono tracking-wider uppercase">
                    PROYEK KIWUL CONTENT MACHINE — EDISI OFFLINE
                  </p>
                </div>

                {/* Suggested Topics Chips */}
                <div className="flex flex-wrap justify-center gap-1.5 max-w-xl mb-6">
                  {SUGGESTED_STORIES.map((topic, idx) => {
                    const isSelected = newTopic === topic;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setNewTopic(topic);
                          setNewName(topic);
                        }}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-all duration-200 active:scale-95 cursor-pointer ${
                          isSelected
                            ? "bg-rose-50 border-rose-300 text-rose-700 font-bold ring-1 ring-rose-300"
                            : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        {topic}
                      </button>
                    );
                  })}
                </div>

                {/* Creation Form */}
                <form onSubmit={handleCreateProject} className="w-full max-w-xl text-left bg-slate-50/50 border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
                  {/* Topic Area */}
                  <div className="space-y-1">
                    <label className="block text-[10px] text-slate-655 font-mono tracking-wider font-extrabold uppercase">
                      PROMPT TOPIK / CERITA VIDEO:
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Masukkan rahasia unik, peristiwa sejarah, konspirasi, atau kata kunci topik..."
                      value={newTopic}
                      onChange={(e) => setNewTopic(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 transition-all font-sans"
                    />
                  </div>

                  {/* Config grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Duration Buttons row selector */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] text-slate-655 font-mono tracking-wider font-extrabold uppercase">
                        Durasi Maksimal (menit):
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {[
                          { value: "Auto", label: "Otomatis (30d)" },
                          { value: "1 min", label: "1 mnt" },
                          { value: "2 min", label: "2 mnt" },
                          { value: "3 min+", label: "3 mnt+" },
                        ].map((d) => (
                          <button
                            key={d.value}
                            type="button"
                            onClick={() => setMaxDuration(d.value)}
                            className={`py-1.5 text-[10px] font-bold rounded-lg border font-mono tracking-tight transition-all active:scale-95 cursor-pointer ${
                              maxDuration === d.value
                                ? "bg-rose-500 text-white border-rose-600 shadow-sm"
                                : "bg-white hover:bg-slate-100 text-slate-700 border-slate-200"
                            }`}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Aspect Ratio Buttons row selector */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] text-slate-655 font-mono tracking-wider font-extrabold uppercase">
                        Aspek Rasio / Ukuran Layar:
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {[
                          { value: "16:9", label: "16:9 Lanskap" },
                          { value: "9:16", label: "9:16 Potret" },
                        ].map((ar) => (
                          <button
                            key={ar.value}
                            type="button"
                            onClick={() => setAspectRatio(ar.value)}
                            className={`py-1.5 text-[10px] font-bold rounded-lg border font-mono tracking-tight transition-all active:scale-95 cursor-pointer ${
                              aspectRatio === ar.value
                                ? "bg-rose-500 text-white border-rose-600 shadow-sm"
                                : "bg-white hover:bg-slate-100 text-slate-700 border-slate-200"
                            }`}
                          >
                            {ar.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Custom Name */}
                  <div className="space-y-1">
                    <label className="block text-[10px] text-slate-605 font-mono tracking-wider font-extrabold uppercase">
                      JUDUL VIDEO KUSTOM (OPSIONAL):
                    </label>
                    <input
                      type="text"
                      placeholder="misal: Rahasia Mesir Kuno Terungkap"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 transition-all font-sans"
                    />
                  </div>

                  {/* Submit Button */}
                  <div className="pt-1">
                    <button
                      type="submit"
                      disabled={isCreating}
                      className="w-full py-2.5 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white font-mono text-[11px] font-bold uppercase tracking-wider rounded-xl shadow-md transition-all active:scale-[0.98] disabled:opacity-40 select-none flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {isCreating ? (
                        <>
                          <Loader2 size={13} className="animate-spin text-white" />
                          <span>MENDAFTARKAN PIPELINE PEMBUATAN KONTEN...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={13} />
                          <span>MULAI PRODUKSI KONTEN AI</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <>
              {/* Column B (Center - 5/12): Main Workshop Stage for Active Project details */}
              <div className="lg:col-span-5 flex flex-col gap-6 animate-fade-in font-sans">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex-1 flex flex-col">
                {/* Active Workspace Header and reset retry mechanism */}
                <div className="flex justify-between items-start gap-3 pb-4 border-b border-slate-200 mb-5">
                  <div>
                    <span className="text-[10px] font-bold text-rose-500 font-mono tracking-widest uppercase block">
                      ACTIVE FACTORY TUNER
                    </span>
                    <h2 className="text-base font-bold text-slate-900 tracking-tight">
                      {selectedProject.name}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Target Topic: <strong className="text-slate-800 font-mono">"{selectedProject.topic}"</strong>
                    </p>
                  </div>

                  <div className="flex gap-2">
                    {selectedProject.status === "failed" && (
                      <button
                        onClick={() => handleRetryProject(selectedProject.id)}
                        className="flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white font-mono font-bold text-[10px] tracking-wider py-1.5 px-3 rounded shadow-sm transition-all"
                      >
                        <RotateCcw size={12} />
                        <span>RETRY PIPELINE</span>
                      </button>
                    )}
                    <button
                      onClick={() => fetchProjects(false)}
                      className="p-1.5 text-slate-600 hover:text-slate-905 bg-slate-50 border border-slate-250 rounded transition"
                      title="Sync current state"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                </div>

                {/* Status-specific rendering panels */}
                <div className="space-y-6 flex-1 overflow-y-auto max-h-[600px] pr-1 scrollbar-thin scrollbar-thumb-slate-200">
                  
                  {/* Pipeline Message Panel */}
                  <div className="bg-rose-50/50 p-3 rounded-xl border border-rose-500/10 flex items-start gap-3">
                    <Info size={16} className="text-rose-550 shrink-0 mt-0.5" />
                    <div className="text-xs text-slate-600 leading-relaxed font-sans">
                      <strong className="text-slate-850">Current Phase Message: </strong>
                      {selectedProject.currentStepMessage || "Processing localized AI generation frames..."}
                    </div>
                  </div>

                  {/* Stage A: Ideasi & Research */}
                  <div className="bg-slate-50/60 p-4 rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between mb-3.5 border-b border-slate-200 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 bg-cyan-100 text-cyan-705 rounded text-[10px] font-mono font-bold">STAGE 1</span>
                        <h3 className="text-xs font-extrabold tracking-wider text-slate-800 uppercase font-mono">
                          Topic Research & Viral Ideas Angle
                        </h3>
                      </div>
                      {selectedProject.ideas && selectedProject.ideas.length > 0 && (
                        <span className="text-[10px] font-mono text-emerald-600 flex items-center gap-1">
                          <CheckCircle size={10} /> Done
                        </span>
                      )}
                    </div>

                    {selectedProject.ideas && selectedProject.ideas.length > 0 ? (
                      <div className="space-y-2.5">
                        {selectedProject.ideas.map((idea, index) => {
                          const isPicked = selectedProject.selectedIdea === idea;
                          return (
                            <div
                              key={index}
                              onClick={async () => {
                                if (selectedProject.status !== "researching") {
                                  // Update chosen idea on the fly
                                  try {
                                    const res = await fetch(`/api/projects/${selectedProject.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        selectedIdea: idea,
                                        logs: [...selectedProject.logs, `[USER] Changed the selected viral story angle to Idea #${index + 1}.`]
                                      }),
                                    });
                                    if (res.ok) fetchProjects();
                                  } catch (e) {}
                                }
                              }}
                              className={`p-2.5 rounded-lg border text-xs leading-relaxed transition-all cursor-pointer ${
                                isPicked
                                  ? "bg-cyan-50/40 border-cyan-405 text-cyan-900 shadow-sm"
                                  : "bg-white border-slate-200 text-slate-600 hover:text-slate-850 hover:bg-slate-100/40"
                              }`}
                            >
                              <div className="flex justify-between items-center mb-1">
                                <span className={`text-[9px] font-mono font-bold ${isPicked ? "text-cyan-700" : "text-slate-400"}`}>
                                  IDEA ANGLE #{index + 1} {isPicked ? "(CHOSEN NARRATIVE)" : ""}
                                </span>
                                {isPicked && <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></span>}
                              </div>
                              <p>{idea}</p>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-slate-400 text-xs italic py-2 text-center">
                        Synthesizing target trend indices... wait for stage completion.
                      </div>
                    )}
                  </div>

                  {/* Stage B: Script Editor & Review */}
                  <div className="bg-slate-50/60 p-4 rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between mb-3.5 border-b border-slate-200 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded text-[10px] font-mono font-bold">STAGE 2</span>
                        <h3 className="text-xs font-extrabold tracking-wider text-slate-800 uppercase font-mono">
                          Cinematic Script Segments
                        </h3>
                      </div>
                      
                      {selectedProject.script?.hook && !isEditingScript && (
                        <button
                          onClick={() => startEditingScript(selectedProject)}
                          className="flex items-center gap-1.5 px-2.5 py-1 bg-white hover:bg-slate-50 hover:text-rose-600 rounded text-[10px] text-slate-600 font-semibold border border-slate-200 shadow-sm"
                        >
                          <Edit2 size={10} />
                          <span>Tune Script</span>
                        </button>
                      )}
                    </div>

                    {!selectedProject.script?.hook ? (
                      <div className="text-slate-400 text-xs italic py-2 text-center">
                        Script compilation in queue...
                      </div>
                    ) : isEditingScript ? (
                      <div className="space-y-3 font-sans">
                        <div>
                          <label className="text-[9px] font-mono text-cyan-705 font-bold block mb-1 uppercase text-slate-600">HOOK STRATEGY (FIRST 5 SECONDS):</label>
                          <textarea
                             value={editHook}
                             onChange={(e) => setEditHook(e.target.value)}
                             rows={2}
                             className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs text-slate-900 font-sans focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-mono text-cyan-705 font-bold block mb-1 uppercase text-slate-600">INTRO STORY (STABLIZATION):</label>
                          <textarea
                             value={editIntro}
                             onChange={(e) => setEditIntro(e.target.value)}
                             rows={2}
                             className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs text-slate-900 font-sans focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-mono text-cyan-705 font-bold block mb-1 uppercase text-slate-600">BODY NARRATION (NUCLEUS CLIMAX):</label>
                          <textarea
                             value={editBody}
                             onChange={(e) => setEditBody(e.target.value)}
                             rows={4}
                             className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs text-slate-900 font-sans focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-mono text-cyan-705 font-bold block mb-1 uppercase text-slate-600">CTA OUTRO:</label>
                          <textarea
                             value={editCta}
                             onChange={(e) => setEditCta(e.target.value)}
                             rows={2}
                             className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs text-slate-900 font-sans focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500"
                          />
                        </div>
                        <div className="flex gap-2 justify-end pt-2">
                          <button
                            onClick={() => setIsEditingScript(false)}
                            className="px-3 py-1.5 hover:bg-slate-100 text-slate-600 text-[11px] font-mono rounded border border-slate-200"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={saveEditedScript}
                            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-mono rounded flex items-center gap-1.5 font-semibold"
                          >
                            <Save size={12} />
                            <span>Save & Bake Script</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 font-sans text-xs">
                        <div className="border border-slate-150 bg-white/50 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono font-bold text-slate-400 tracking-wider block uppercase mb-1">
                            HOOK STRATEGY:
                          </span>
                          <p className="text-rose-705 italic font-medium leading-relaxed">
                            "{selectedProject.script.hook}"
                          </p>
                        </div>

                        <div className="border border-slate-150 bg-white/50 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono font-bold text-slate-400 tracking-wider block uppercase mb-1">
                            INTRO PLOT:
                          </span>
                          <p className="text-slate-700 leading-relaxed">
                            {selectedProject.script.intro}
                          </p>
                        </div>

                        <div className="border border-slate-150 bg-white/50 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono font-bold text-slate-400 tracking-wider block uppercase mb-1">
                            BODY STORYLINE:
                          </span>
                          <p className="text-slate-700 leading-relaxed">
                            {selectedProject.script.body}
                          </p>
                        </div>

                        <div className="border border-slate-150 bg-white/50 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono font-bold text-slate-400 tracking-wider block uppercase mb-1">
                            OUTRO CTA:
                          </span>
                          <p className="text-amber-705 italic leading-relaxed font-semibold">
                            "{selectedProject.script.cta}"
                          </p>
                        </div>

                        {selectedProject.atomicLines && selectedProject.atomicLines.length > 0 && (
                          <div className="border border-slate-150 bg-rose-50/25 p-2.5 rounded-lg mt-3">
                            <span className="text-[9px] font-mono font-bold text-rose-600 tracking-wider block uppercase mb-2 flex items-center gap-1">
                              <Sparkles size={11} className="text-rose-500" /> Baris Narasi Atomik (Script Splitter):
                            </span>
                            <div className="flex flex-col gap-1 max-h-[150px] overflow-y-auto pr-1">
                              {selectedProject.atomicLines.map((line, lIdx) => (
                                <div key={lIdx} className="bg-slate-100/80 hover:bg-slate-201/80 text-slate-700 font-mono text-[10px] px-2 py-1 rounded border border-slate-200 transition-colors flex gap-1.5 items-start">
                                  <span className="text-rose-500 font-bold font-mono">{lIdx + 1}.</span>
                                  <span className="font-medium text-slate-800">{line}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Stage C: Director Scene Breakdown Grid */}
                  <div className="bg-slate-50/60 p-4 rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between mb-3.5 border-b border-slate-200 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-mono font-bold">STAGE 3</span>
                        <h3 className="text-xs font-extrabold tracking-wider text-slate-800 uppercase font-mono">
                          WAN 2.2 Shot Scene Sequence
                        </h3>
                      </div>
                    </div>

                    {!selectedProject.scenes || selectedProject.scenes.length === 0 ? (
                      <div className="text-slate-400 text-xs italic py-2 text-center">
                        Evaluating dynamic visual prompts breakdown timing...
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {selectedProject.scenes.map((scene: Scene) => {
                          const isSceneEditing = editingSceneId === scene.id;
                          return (
                            <div key={scene.id} className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col gap-3">
                              <div className="flex justify-between items-center text-[10px] font-mono">
                                <span className="font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                                  SCENE #{scene.sceneNumber} SHOT
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full inline-block ${
                                    scene.status === "completed" ? "bg-emerald-450" : "bg-rose-500 animate-pulse"
                                  }`} />
                                  <span className="text-slate-500">
                                    {scene.status.toUpperCase().replace("_", " ")}
                                  </span>
                                  {!isSceneEditing && (
                                    <button
                                      onClick={() => startEditingScene(scene)}
                                      className="text-cyan-600 hover:text-cyan-800 ml-2 hover:bg-slate-50 p-1 rounded transition"
                                      title="Modify visual prompts"
                                    >
                                      <Edit2 size={11} />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {isSceneEditing ? (
                                <div className="space-y-2.5 font-sans pt-1">
                                  <div>
                                    <label className="text-[10px] font-mono text-slate-550 uppercase block mb-1">Visual prompts (Flux/SDXL target orientation):</label>
                                    <textarea
                                      value={editVisualPrompt}
                                      onChange={(e) => setEditVisualPrompt(e.target.value)}
                                      rows={2}
                                      className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs text-slate-900 font-sans focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-mono text-slate-550 uppercase block mb-1">WAN 2.2 Motion dynamics:</label>
                                    <input
                                      type="text"
                                      value={editMotionPrompt}
                                      onChange={(e) => setEditMotionPrompt(e.target.value)}
                                      className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs text-slate-900 font-sans focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-mono text-slate-550 uppercase block mb-1">Scene Narrative / Subtitle:</label>
                                    <input
                                      type="text"
                                      value={editVoiceText}
                                      onChange={(e) => setEditVoiceText(e.target.value)}
                                      className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs text-slate-900 font-sans focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500"
                                    />
                                  </div>
                                  <div className="flex gap-2 justify-end pt-1">
                                    <button
                                      onClick={() => setEditingSceneId(null)}
                                      className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-650 text-[10px] font-mono rounded"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={() => saveEditedScene(scene.id)}
                                      className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-700 text-white text-[10px] font-mono rounded flex items-center gap-1 font-semibold"
                                    >
                                      <Save size={10} />
                                      <span>Apply Block</span>
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-2.5">
                                  {/* Procedural Visual thumbnail indicator on screen */}
                                  <div className="h-28 bg-slate-100 rounded border border-slate-200 flex items-center justify-center overflow-hidden relative group">
                                    {scene.imageBase64 ? (
                                      <img
                                        src={scene.imageBase64}
                                        alt="scene base render layout"
                                        className="w-full h-full object-cover select-none group-hover:scale-105 transition-transform duration-500"
                                      />
                                    ) : (
                                      <span className="text-[10px] text-slate-405 font-mono animate-pulse">RENDERING IMAGE WORKFLOW INSTANCE</span>
                                    )}
                                    <div className="absolute top-2 left-2 bg-slate-800/90 px-2 py-0.5 rounded text-[9px] font-mono text-slate-100 border border-slate-705">
                                      Frame 1 SVG Seed
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] leading-relaxed">
                                    <div className="bg-slate-100/50 p-2.5 rounded-lg border border-slate-200">
                                      <strong className="text-purple-700 block font-mono text-[9px] uppercase tracking-wider mb-0.5">DIRECTOR MODEL STAGE PROMPT:</strong>
                                      <span className="text-slate-700 font-sans">{scene.visualPrompt}</span>
                                    </div>
                                    <div className="bg-slate-100/50 p-2.5 rounded-lg border border-slate-200">
                                      <strong className="text-rose-700 block font-mono text-[9px] uppercase tracking-wider mb-0.5">CAMERA DYNAMICS TRAJECTORY:</strong>
                                      <span className="text-slate-705 font-mono">{scene.motionPrompt || "Steady zoom forward"}</span>
                                    </div>
                                  </div>

                                  <div className="bg-[#f8fafc] p-2 rounded-lg border border-slate-200 text-[11px] flex gap-2 items-start">
                                    <span className="text-[9px] font-mono bg-cyan-50 text-cyan-700 px-1 py-0.5 rounded font-bold uppercase block tracking-wider mt-0.5">NARRATIVE VOICEOVER:</span>
                                    <p className="text-slate-700 italic">"{scene.voiceText}"</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Stage D: SEO Metadata & Tags */}
                  {selectedProject.metadata?.title && (
                    <div className="bg-slate-5/60 p-4 rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between mb-3.5 border-b border-slate-200 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-mono font-bold">STAGE 4</span>
                          <h3 className="text-xs font-extrabold tracking-wider text-slate-800 uppercase font-mono">
                            YouTube Publisher Metadata SEO
                          </h3>
                        </div>
                      </div>

                      <div className="space-y-3 font-sans text-xs">
                        <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm">
                          <strong className="text-[10px] font-mono block uppercase tracking-wider text-slate-500 mb-1">
                            YouTube Recommendation Title Angle
                          </strong>
                          <p className="text-slate-800 font-bold font-mono text-sm leading-snug">
                            {selectedProject.metadata.title}
                          </p>
                        </div>

                        <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm">
                          <strong className="text-[10px] font-mono block uppercase tracking-wider text-slate-505 mb-1">
                            Video Description Context (SEO Stacked)
                          </strong>
                          <p className="text-slate-700 whitespace-pre-line leading-relaxed text-[11px]">
                            {selectedProject.metadata.description}
                          </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                          <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm">
                            <strong className="text-[10px] font-mono block uppercase tracking-wider text-slate-500 mb-1">Video Semantic Tags:</strong>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {(selectedProject.metadata.tags || []).map((tag, i) => (
                                <span key={i} className="text-[10px] font-mono px-2 py-0.5 bg-slate-100 text-slate-655 border border-slate-200 rounded">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm">
                            <strong className="text-[10px] font-mono block uppercase tracking-wider text-slate-500 mb-1">Reels & Shorts Hashtags:</strong>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {(selectedProject.metadata.hashtags || []).map((hash, i) => (
                                <span key={i} className="text-[10px] font-mono px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200/60 rounded font-bold">
                                  {hash}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            </div>

            {/* Column C (Right 4/12): Real-time Player frame emulator & live log tracker */}
            <div className="lg:col-span-4 flex flex-col gap-6 animate-fade-in">
              <CinemaPlayer project={selectedProject} />
              <ConsoleTerminal
                logs={selectedProject.logs}
                status={selectedProject.status}
                stepMessage={selectedProject.currentStepMessage}
              />
            </div>
          </>
        )}
      </div>
      )}

      {/* AI ENGINES TAB VIEW */}
      {activeTab === "settings" && (
        <div className="flex-1 max-w-4xl mx-auto w-full p-6">
          <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-6">
            <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
              <div className="p-2.5 bg-rose-50 border border-rose-100 rounded-xl">
                <Sliders size={20} className="text-rose-500" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-800">AI Stack Connections & Video Parameters</h2>
                <p className="text-xs text-slate-500">Modify physical engine connection ports and neural networking variables.</p>
              </div>
            </div>

            {settingsSavedMessage && (
              <div className="bg-emerald-50 border border-emerald-250 text-emerald-700 px-4 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wide animate-fade-in">
                ✓ {settingsSavedMessage}
              </div>
            )}

            {/* CONNECTION MONITOR (Cek Koneksi) */}
            <div className="bg-slate-50 border border-slate-205 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4 shadow-sm">
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${connectionCheck.ollamaOk && connectionCheck.comfyOk ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500 animate-ping'} block`}></span>
                  <span className="text-[11px] font-bold text-slate-705 font-mono tracking-wider uppercase">Fasilitas Monitor & Koneksi AI Lokal</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed max-w-xl">
                  Uji status jabat tangan (handshake) ke model lokal <strong className="text-slate-600 font-mono">Ollama</strong> dan engine visual <strong className="text-slate-600 font-mono">ComfyUI</strong> untuk memastikan kecocokan pipa rendering video.
                </p>
                
                {connectionCheck.checked && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <div className="flex flex-col gap-0.5 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-xs min-w-[150px]">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${connectionCheck.ollamaOk ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                        <span className="text-[10px] font-mono font-bold text-slate-700">Ollama LLM Status</span>
                      </div>
                      <span className="text-[9px] text-slate-450 font-mono block truncate max-w-[200px]" title={connectionCheck.ollamaDetails}>
                        {connectionCheck.ollamaDetails}
                      </span>
                    </div>

                    <div className="flex flex-col gap-0.5 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-xs min-w-[150px]">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${connectionCheck.comfyOk ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                        <span className="text-[10px] font-mono font-bold text-slate-700">ComfyUI Status</span>
                      </div>
                      <span className="text-[9px] text-slate-450 font-mono block truncate max-w-[200px]" title={connectionCheck.comfyDetails}>
                        {connectionCheck.comfyDetails}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center">
                <button
                  type="button"
                  id="btn-cek-koneksi-ai"
                  onClick={handleCheckConnections}
                  disabled={connectionCheck.loading || (connectionCheck.ollamaOk === true && connectionCheck.comfyOk === true)}
                  className={`w-full md:w-auto px-4 py-2.5 rounded-xl text-xs font-bold font-sans tracking-wide transition-all shadow-sm flex items-center justify-center gap-1.5 ${
                    connectionCheck.ollamaOk === true && connectionCheck.comfyOk === true
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-not-allowed'
                      : connectionCheck.loading
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-205'
                      : 'bg-rose-500 text-white hover:bg-rose-600 active:scale-95 cursor-pointer hover:shadow-md'
                  }`}
                >
                  {connectionCheck.loading ? (
                    <>
                      <Loader2 className="animate-spin text-slate-500" size={13} />
                      Menguji Jaringan...
                    </>
                  ) : connectionCheck.ollamaOk === true && connectionCheck.comfyOk === true ? (
                    <>
                      <CheckCircle size={13} className="text-emerald-700" />
                      Status Konek (Cukup Sekali)
                    </>
                  ) : (
                    <>
                      <Activity size={13} />
                      Cek Koneksi AI Lokal
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column Settings */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-cyan-700 font-mono tracking-wider uppercase border-l-2 border-cyan-500 pl-2">
                  1. Script & Research LLMs
                </h3>
                
                <div>
                  <label className="block text-xs text-slate-600 font-mono mb-1">Ollama API Base URL:</label>
                  <input
                    type="url"
                    value={settings.ollamaUrl}
                    onChange={(e) => setSettings({ ...settings, ollamaUrl: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-600 font-mono mb-1">Model Selection (Recommended qwen3):</label>
                  <input
                    type="text"
                    value={settings.llmModel}
                    onChange={(e) => setSettings({ ...settings, llmModel: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 text-slate-800"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Default is <code className="text-slate-655 bg-slate-100 px-1.5 py-0.5 rounded font-bold">qwen3:8b</code>. Supports <code className="text-slate-500">qwen3:14b</code> or any downloaded model tag.</p>
                </div>

                <div className="pt-2">
                  <h3 className="text-xs font-bold text-amber-705 font-mono tracking-wider uppercase border-l-2 border-amber-500 pl-2 mb-3">
                    2. Image Generation Engine
                  </h3>
                  <div>
                    <label className="block text-xs text-slate-600 font-mono mb-1">ComfyUI Host Endpoint:</label>
                    <input
                      type="url"
                      value={settings.comfyUrl}
                      onChange={(e) => setSettings({ ...settings, comfyUrl: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 text-slate-800"
                    />
                  </div>
                  <div className="mt-3">
                    <label className="block text-xs text-slate-600 font-mono mb-1">Workflow JSON Template Name:</label>
                    <select
                      value={settings.workflowTemplate}
                      onChange={(e) => setSettings({ ...settings, workflowTemplate: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 text-slate-800"
                    >
                      <option value="FLUX_Dev_Standard">FLUX Dev Standard Workflow (1024px)</option>
                      <option value="SDXL_Turbo_Fast">SDXL Turbo Fast Instant (512px)</option>
                      <option value="Anime_Consistent_Model">Anime Style Consistency Setup</option>
                    </select>
                  </div>
                </div>

                <div className="pt-2">
                  <h3 className="text-xs font-bold text-rose-700 font-mono tracking-wider uppercase border-l-2 border-rose-500 pl-2 mb-3">
                    3. Text-To-Speech (Narrator)
                  </h3>
                  <div>
                    <label className="block text-xs text-slate-600 font-mono mb-1">Active TTS Engine Provider:</label>
                    <select
                      value={settings.ttsEngine}
                      onChange={(e) => setSettings({ ...settings, ttsEngine: e.target.value as any })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 text-slate-800"
                    >
                      <option value="f5-tts">F5-TTS (Primary - Clone Synthesis)</option>
                      <option value="styletts2">StyleTTS2 (Emotional Fallback)</option>
                      <option value="piper">Piper Local Voice (Ultra-Fast)</option>
                      <option value="gemini-tts">Gemini Reader Hybrid (High Fidelity API)</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-[10px] text-slate-500 font-mono mb-1">VOICE REFERENCE PROFILE:</label>
                      <input
                        type="text"
                        value={settings.voiceProfile}
                        onChange={(e) => setSettings({ ...settings, voiceProfile: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-505 font-mono mb-1">EMOTION OVERLAY:</label>
                      <select
                        value={settings.voiceEmotion}
                        onChange={(e) => setSettings({ ...settings, voiceEmotion: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800"
                      >
                        <option value="neutral">Neutral/Dramatic</option>
                        <option value="excited">Excited/Viral</option>
                        <option value="whispering">Suspenseful/Whisper</option>
                        <option value="terrified">Scared/Deep Horror</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column Settings */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-rose-700 font-mono tracking-wider uppercase border-l-2 border-rose-500 pl-2">
                  4. WAN 2.2 Local Video Parameters
                </h3>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-600 font-mono mb-1">Generation Mode:</label>
                    <select
                      value={settings.wanMode}
                      onChange={(e) => setSettings({ ...settings, wanMode: e.target.value as any })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none text-slate-805 text-slate-803"
                    >
                      <option value="i2v">Image-To-Video (Recommended)</option>
                      <option value="t2v">Text-To-Video</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-655 font-mono mb-1">Resolution Aspect Ratio:</label>
                    <select
                      value={settings.wanResolution}
                      onChange={(e) => setSettings({ ...settings, wanResolution: e.target.value as any })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none text-slate-803"
                    >
                      <option value="16:9">Horizontal (16:9 YouTube Long)</option>
                      <option value="9:16">Vertical (9:16 Shorts/Reels)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-600 font-mono mb-1">Steps (Sampling):</label>
                    <input
                      type="number"
                      value={settings.wanSteps}
                      onChange={(e) => setSettings({ ...settings, wanSteps: parseInt(e.target.value) || 20 })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-803"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 font-mono mb-1">CFG Guidance scale:</label>
                    <input
                      type="number"
                      step="0.5"
                      value={settings.wanCfg}
                      onChange={(e) => setSettings({ ...settings, wanCfg: parseFloat(e.target.value) || 6 })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-803"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-600 font-mono mb-1">Clips Frame length:</label>
                    <input
                      type="number"
                      value={settings.wanFrames}
                      onChange={(e) => setSettings({ ...settings, wanFrames: parseInt(e.target.value) || 81 })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-803"
                    />
                    <p className="text-[9px] text-slate-500 mt-0.5">81 frames = ~5 seconds of video</p>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-604 font-mono mb-1">Motion Intensity Scale (1-10):</label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={settings.wanMotionIntensity}
                      onChange={(e) => setSettings({ ...settings, wanMotionIntensity: parseInt(e.target.value) || 7 })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-803"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200">
                  <h3 className="text-xs font-bold text-cyan-705 font-mono tracking-wider uppercase mb-2">
                    5. Safe Hybrid Cloud Mode (AI Studio)
                  </h3>
                  <div className="flex items-center justify-between bg-cyan-50/40 p-3 rounded-lg border border-cyan-500/10">
                    <div>
                      <p className="text-xs text-slate-800 font-bold">Use Gemini API & Simulated Generation</p>
                      <p className="text-[10px] text-slate-550 mt-0.5 font-sans leading-relaxed">
                        Guarantees the application runs perfectly inside the AI Studio sandbox. When tested locally with real hardware, you can disable this.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={settings.backupGeminiMode}
                        onChange={(e) => setSettings({ ...settings, backupGeminiMode: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-650"></div>
                    </label>
                  </div>
                </div>

                {/* Section 6: Prompt Configuration (Full Width) */}
                <div className="pt-4 border-t border-slate-200 md:col-span-2">
                  <h3 className="text-xs font-bold text-rose-700 font-mono tracking-wider uppercase border-l-2 border-rose-500 pl-2 mb-3">
                    6. 🎬 Master Prompts & AI Directives
                  </h3>
                  <p className="text-[11px] text-slate-500 mb-4">
                    Lihat dan konfigurasikan master prompt AI yang digunakan untuk riset ide, penulisan skrip, split kalimat atomik, dan pengaturan pergerakan kamera (Motion Prompt).
                  </p>

                  <div className="space-y-4">
                    {/* Motion Prompt Generator Highlighted */}
                    <div className="border border-rose-200 bg-rose-50/25 p-4 rounded-xl">
                      <div className="flex items-center gap-2 mb-1.5 matches-motion">
                        <Sparkles size={16} className="text-rose-500" />
                        <span className="font-bold text-xs text-rose-700">Motion Prompt Generator (Hollywood DoP Rules)</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mb-2.5 leading-relaxed">
                        Prompt utama ini menentukan detail visual (<code className="text-slate-655 bg-slate-100 px-1 font-bold">visual_prompt</code>) dan pergerakan kamera (<code className="text-slate-655 bg-slate-100 px-1 font-bold">motion_prompt</code>) untuk setiap scene berdasarkan naskah asli.
                      </p>
                      <textarea
                        value={settings.promptPlanning || ""}
                        onChange={(e) => setSettings({ ...settings, promptPlanning: e.target.value })}
                        className="w-full bg-slate-900 text-rose-200 font-mono text-[11px] p-3 rounded-lg border border-slate-700 focus:outline-none focus:ring-1 focus:ring-rose-500 min-h-[180px] leading-relaxed shadow-sm resize-y"
                        placeholder="Masukkan Master Prompt Perencanaan Adegan & Kamera..."
                      />
                    </div>

                    {/* Secondary Prompts in columns */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="border border-slate-200 bg-slate-50/50 p-3 rounded-xl flex flex-col">
                        <span className="font-bold text-[11px] text-slate-700 block mb-1">Ideation Prompt</span>
                        <p className="text-[9px] text-slate-450 mb-2 leading-relaxed">Konsep viralitas dan curiosity-gap 3 ide awal.</p>
                        <textarea
                          value={settings.promptIdeation || ""}
                          onChange={(e) => setSettings({ ...settings, promptIdeation: e.target.value })}
                          className="w-full bg-white border border-slate-200 text-slate-700 font-mono text-[10px] p-2 rounded-lg focus:outline-none min-h-[120px] leading-normal flex-1 resize-y"
                        />
                      </div>

                      <div className="border border-slate-200 bg-slate-50/50 p-3 rounded-xl flex flex-col">
                        <span className="font-bold text-[11px] text-slate-700 block mb-1">Script Prompt</span>
                        <p className="text-[9px] text-slate-450 mb-2 leading-relaxed">Bahan pembangun hook, intro, bodi naskah, dan CTA.</p>
                        <textarea
                          value={settings.promptScript || ""}
                          onChange={(e) => setSettings({ ...settings, promptScript: e.target.value })}
                          className="w-full bg-white border border-slate-200 text-slate-700 font-mono text-[10px] p-2 rounded-lg focus:outline-none min-h-[120px] leading-normal flex-1 resize-y"
                        />
                      </div>

                      <div className="border border-slate-200 bg-slate-50/50 p-3 rounded-xl flex flex-col">
                        <span className="font-bold text-[11px] text-slate-700 block mb-1">Script Splitter Prompt</span>
                        <p className="text-[9px] text-slate-450 mb-2 leading-relaxed">Membagi kalimat naskah menjadi bait atomik TTS.</p>
                        <textarea
                          value={settings.promptSplitter || ""}
                          onChange={(e) => setSettings({ ...settings, promptSplitter: e.target.value })}
                          className="w-full bg-white border border-slate-200 text-slate-700 font-mono text-[10px] p-2 rounded-lg focus:outline-none min-h-[120px] leading-normal flex-1 resize-y"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-150 pt-5 flex items-center justify-between">
              <div className="flex gap-2 text-xs text-slate-550 items-center">
                <AlertTriangle size={15} className="text-amber-500" />
                <span>Changes are written onto local disk configuration parameters.</span>
              </div>
              
              <button
                onClick={handleSaveSettings}
                disabled={isSavingSettings}
                className="bg-rose-500 hover:bg-rose-600 active:scale-95 text-white font-mono text-xs font-bold py-2.5 px-6 rounded-xl shadow transition-all flex items-center gap-2 cursor-pointer"
              >
                {isSavingSettings ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>SAVING SETTINGS...</span>
                  </>
                ) : (
                  <>
                    <Save size={14} />
                    <span>APPLY GLOBAL CONFIGS</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENTATION VIEW */}
      {activeTab === "docs" && (
        <div className="flex-1 max-w-4xl mx-auto w-full p-6">
          <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-6">
            <h2 className="text-base font-bold font-mono text-rose-600 tracking-wider uppercase border-b border-slate-200 pb-3">
              🎯 KIWUL LOCAL ENGINE INTEGRATION PLAYBOOK
            </h2>

            <div className="space-y-4 text-xs leading-relaxed text-slate-655 font-sans font-medium">
              <p>
                <strong>Project Kiwul</strong> is specifically mapped to build high click-through, fully animated faceless YouTube videos locally.
                To run completely local and offline without utilizing cloud token costs, construct these server configs inside your computer:
              </p>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 font-mono">
                <h3 className="text-xs font-bold text-cyan-750">Step 1: Spin up local LLM Host (Ollama qwen3)</h3>
                <p className="text-slate-550">Ollama acts as research director, generating hooks and plan visual instructions.</p>
                <div className="bg-white border border-slate-200 p-2.5 rounded text-[11px] text-slate-800 shadow-sm">
                  ollama run qwen3:8b
                </div>

                <h3 className="text-xs font-bold text-amber-705 mt-2">Step 2: Initialize ComfyUI API</h3>
                <p className="text-slate-550">ComfyUI listens on port 8188 for direct workspace json injections to bake the scenes.</p>
                <div className="bg-white border border-slate-200 p-2.5 rounded text-[11px] text-slate-800 shadow-sm">
                  python main.py --port 8188 --enable-cors-header
                </div>

                <h3 className="text-xs font-bold text-rose-705 mt-2">Step 3: Setup F5-TTS narration voice library</h3>
                <p className="text-slate-550">F5 clones high quality styles via local wav references seamlessly.</p>
                <div className="bg-white border border-slate-200 p-2.5 rounded text-[11px] text-slate-800 shadow-sm">
                  f5-tts_webui --port 7860
                </div>
              </div>

              <div className="border-t border-slate-200 pt-4">
                <h3 className="font-bold text-slate-800 mb-1">💡 Sandbox ProTip for AI Studio preview:</h3>
                <p className="text-slate-600">
                  We have preloaded high fidelity, responsive <strong>SVG procedural render engines</strong> and <strong>Gemini Voice synthesizers</strong>. 
                  Keep the <code className="text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded border border-cyan-100">Hybrid Cloud Fallback</code> switched <strong>ON</strong>. 
                  This will generate stunning slides, titles, custom overlays, and correct srt outputs directly in this live browser preview frame without you needing a local RTX GPU right now!
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Persistent global applet footer */}
      <footer className="bg-white/70 border-t border-slate-200/80 px-6 py-4 flex flex-wrap justify-between items-center text-[10px] text-slate-500 font-mono mt-auto gap-2">
        <span>© 2026 Project Kiwul Autonomous Content Suite. Built for RTX 2000 Ada Offline Pipeline.</span>
        <div className="flex gap-4">
          <span className="text-slate-500 hover:text-slate-800 cursor-help" title="Local node communication healthy.">STAT: CLUSTER SECURE</span>
          <span className="text-slate-500">TIME_ZONE: UTC 24H</span>
        </div>
      </footer>
    </div>
  );
}
