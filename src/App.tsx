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

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  
  // Create project form states
  const [newTopic, setNewTopic] = useState("");
  const [newName, setNewName] = useState("");
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
        }),
      });

      if (res.ok) {
        const newProj = await res.json();
        setNewTopic("");
        setNewName("");
        await fetchProjects();
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
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans antialiased selection:bg-rose-500 selection:text-white">
      {/* High-End Minimalist Cinematic Header Nav */}
      <header className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md px-6 py-4 sticky top-0 z-50 flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center p-2.5 bg-gradient-to-br from-rose-500 to-amber-600 rounded-xl shadow-lg shadow-rose-950/20">
            <Cpu size={22} className="text-white animate-pulse" />
            <div className="absolute -inset-0.5 bg-rose-500 rounded-xl blur opacity-30 animate-pulse"></div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-rose-400 font-mono">
                PROJECT KIWUL
              </h1>
              <span className="bg-rose-500/10 text-rose-400 text-[10px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded border border-rose-500/20 font-mono">
                v2.2 WAN LOCAL
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Offline Faceless YouTube Automated Content Factory
            </p>
          </div>
        </div>

        {/* Global Local Connection Monitor Grid */}
        <div className="hidden lg:flex items-center gap-6">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 block"></span>
            <span className="text-slate-400">Ollama API:</span>
            <code className="bg-slate-900 px-2 py-0.5 rounded text-cyan-400 border border-slate-800 text-[11px]">
              {settings.ollamaUrl}
            </code>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-orange-500 block"></span>
            <span className="text-slate-400">ComfyUI Host:</span>
            <code className="bg-slate-900 px-2 py-0.5 rounded text-orange-400 border border-slate-800 text-[11px]">
              {settings.comfyUrl}
            </code>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full block ${settings.backupGeminiMode ? "bg-cyan-400" : "bg-slate-600"}`}></span>
            <span className="text-slate-400">Hybrid Cloud Fallback:</span>
            <span className="font-semibold text-[11px] text-slate-300">
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
                ? "bg-rose-500 text-white border-rose-600 shadow-md shadow-rose-950/20"
                : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-850"
            }`}
          >
            <Layers size={14} />
            <span>FACTORY WORKSPACE</span>
          </button>
          
          <button
            onClick={() => setActiveTab("settings")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold tracking-wider font-mono transition-all border ${
              activeTab === "settings"
                ? "bg-rose-500 text-white border-rose-600 shadow-md shadow-rose-950/20"
                : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-850"
            }`}
          >
            <Settings size={14} />
            <span>AI ENGINES</span>
          </button>

          <button
            onClick={() => setActiveTab("docs")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold tracking-wider font-mono transition-all border ${
              activeTab === "docs"
                ? "bg-rose-500 text-white border-rose-600 shadow-md shadow-rose-950/20"
                : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-850"
            }`}
          >
            <HelpCircle size={14} />
            <span>DOCUMENTATION</span>
          </button>
        </div>
      </header>

      {/* Primary Pipeline stats dashboard indicator */}
      <div className="bg-slate-950 border-b border-slate-900 px-6 py-3 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-cyan-400 animate-pulse" />
          <span className="font-bold text-slate-300">LOCAL CLUSTER PIPELINE QUEUE STATS:</span>
        </div>
        <div className="flex gap-4">
          <span className="flex items-center gap-1">
            <span className="text-slate-500 font-mono">Total Scheduled:</span>
            <strong className="text-slate-200">{totalJobs}</strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping inline-block"></span>
            <span className="text-slate-500 font-mono">Rendering:</span>
            <strong className="text-rose-400">{runningJobs}</strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-slate-500 font-mono">Completed:</span>
            <strong className="text-emerald-400">{completedJobs}</strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-slate-500 font-mono">Failed:</span>
            <strong className="text-amber-500">{failedJobs}</strong>
          </span>
        </div>
      </div>

      {activeTab === "workspace" && (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
          {/* Column A (Left 3/12): Video Factory Job Spawn and Pipe Manager list */}
          <div className="lg:col-span-3 flex flex-col gap-6">
            {/* Create pipeline section */}
            <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 shadow-lg">
              <div className="flex items-center gap-2 mb-3">
                <Plus size={16} className="text-rose-400" />
                <h3 className="text-xs font-bold tracking-wider text-slate-300 uppercase font-mono">
                  SPAWN NEW CONTENT PIPELINE
                </h3>
              </div>
              <form onSubmit={handleCreateProject} className="flex flex-col gap-3">
                <div>
                  <label className="block text-[10px] text-slate-400 font-mono mb-1">
                    VIDEO NICHE / TOPIC KEYWORD:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Secret chamber beneath Egypt sphinx"
                    value={newTopic}
                    onChange={(e) => setNewTopic(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-rose-500 transition-colors font-sans"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 font-mono mb-1">
                    CUSTOM VIDEO FILE NAME (OPTIONAL):
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Lost Egyptian Secrets Revealed"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-rose-500 transition-colors font-sans"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="w-full bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 disabled:opacity-40 text-white font-mono text-xs font-semibold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 shadow-lg shadow-rose-950/20"
                >
                  {isCreating ? (
                    <>
                      <Loader2 size={14} className="animate-spin text-white" />
                      <span>ENQUEUING PIPELINE...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} />
                      <span>INITIALIZE FACTORY</span>
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Active Jobs list */}
            <div className="bg-slate-900 border border-slate-800/80 rounded-2xl flex-1 flex flex-col p-4 shadow-lg min-h-[400px]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Database size={15} className="text-cyan-400" />
                  <h3 className="text-xs font-bold tracking-wider text-slate-300 uppercase font-mono">
                    AUTONOMOUS JOBS QUEUE
                  </h3>
                </div>
                <button
                  onClick={() => fetchProjects(false)}
                  className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
                  title="Manual reload stats"
                >
                  <RefreshCw size={12} />
                </button>
              </div>

              {projects.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-500">
                  <Database size={30} className="text-slate-700 mb-2 stroke-[1.2]" />
                  <p className="text-xs font-bold uppercase font-mono text-slate-400">Empty Queue</p>
                  <p className="text-[10px] text-slate-600 mt-1">No video renders planned. Spawn one first to start generating.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 max-h-[500px] lg:max-h-none">
                  {projects.map((proj) => {
                    const isSelected = selectedProject?.id === proj.id;
                    const isActive = ["researching", "scripting", "planning", "generating_media", "assembling"].includes(proj.status);
                    
                    let badgeColor = "bg-slate-950 text-slate-400 border-slate-800";
                    if (proj.status === "completed") badgeColor = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                    if (proj.status === "failed") badgeColor = "bg-amber-500/10 text-amber-500 border-amber-500/20";
                    if (isActive) badgeColor = "bg-rose-500/10 text-rose-400 border-rose-500/20 animate-pulse";

                    return (
                      <div
                        key={proj.id}
                        onClick={() => setSelectedProject(proj)}
                        className={`group p-3 rounded-xl border transition-all cursor-pointer relative ${
                          isSelected
                            ? "bg-slate-800/70 border-rose-500/50 shadow-md translate-x-1"
                            : "bg-slate-950/40 border-slate-800/60 hover:bg-slate-800/30 hover:border-slate-700/80"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="truncate flex-1">
                            <span className="text-[10px] font-mono text-slate-500 block">
                              {new Date(proj.createdAt).toLocaleDateString()} @ {new Date(proj.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <h4 className="text-xs font-semibold text-slate-200 truncate group-hover:text-white mt-0.5">
                              {proj.name}
                            </h4>
                          </div>
                          
                          {/* Close / Action */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteProject(proj.id);
                            }}
                            className="text-slate-600 hover:text-red-400 p-1 rounded hover:bg-slate-900/60 transition-all opacity-0 group-hover:opacity-100"
                            title="Recycle Job"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>

                        {/* Progress Bar indicator */}
                        {isActive && (
                          <div className="mt-2.5 h-1 bg-slate-950 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-rose-500 to-amber-500"
                              style={{ width: `${proj.progress}%` }}
                            ></div>
                          </div>
                        )}

                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-900 text-[10px] font-mono">
                          <span className={`px-2 py-0.5 rounded border ${badgeColor}`}>
                            {proj.status.replace("_", " ").toUpperCase()}
                          </span>
                          <span className="text-slate-500">
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

          {/* Column B (Center 6/12): Main Workshop Stage for Active Project details */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            {!selectedProject ? (
              <div className="bg-slate-900 border border-slate-800/80 rounded-2xl flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-400">
                <Tv size={45} className="text-slate-700 mb-2 stroke-[1.2]" />
                <h3 className="text-sm font-bold uppercase font-mono text-slate-300">Workspace Inactive</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  Select a registered offline video project from the left queue dashboard, or start a new video pipeline creation instantly.
                </p>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800/85 rounded-2xl p-5 shadow-lg flex-1 flex flex-col">
                {/* Active Workspace Header and reset retry mechanism */}
                <div className="flex justify-between items-start gap-3 pb-4 border-b border-slate-800/60 mb-5">
                  <div>
                    <span className="text-[10px] font-bold text-rose-500 font-mono tracking-widest uppercase block">
                      ACTIVE FACTORY TUNER
                    </span>
                    <h2 className="text-base font-bold text-white tracking-tight">
                      {selectedProject.name}
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Target Topic: <strong className="text-slate-300 font-mono">"{selectedProject.topic}"</strong>
                    </p>
                  </div>

                  <div className="flex gap-2">
                    {selectedProject.status === "failed" && (
                      <button
                        onClick={() => handleRetryProject(selectedProject.id)}
                        className="flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white font-mono font-bold text-[10px] tracking-wider py-1.5 px-3 rounded shadow-lg transition-all"
                      >
                        <RotateCcw size={12} />
                        <span>RETRY PIPELINE</span>
                      </button>
                    )}
                    <button
                      onClick={() => fetchProjects(false)}
                      className="p-1.5 text-slate-450 hover:text-white bg-slate-950 border border-slate-800 rounded transition"
                      title="Sync current state"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                </div>

                {/* Status-specific rendering panels */}
                <div className="space-y-6 flex-1 overflow-y-auto max-h-[600px] pr-1 scrollbar-thin scrollbar-thumb-slate-800">
                  
                  {/* Pipeline Message Panel */}
                  <div className="bg-slate-950/80 p-3 rounded-xl border border-rose-500/10 flex items-start gap-3">
                    <Info size={16} className="text-rose-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-slate-400 leading-relaxed font-sans">
                      <strong className="text-slate-200">Current Phase Message: </strong>
                      {selectedProject.currentStepMessage || "Processing localized AI generation frames..."}
                    </div>
                  </div>

                  {/* Stage A: Ideasi & Research */}
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between mb-3.5 border-b border-slate-900 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 bg-cyan-950 text-cyan-400 rounded text-[10px] font-mono font-bold">STAGE 1</span>
                        <h3 className="text-xs font-extrabold tracking-wider text-slate-350 uppercase font-mono">
                          Topic Research & Viral Ideas Angle
                        </h3>
                      </div>
                      {selectedProject.ideas && selectedProject.ideas.length > 0 && (
                        <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
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
                                  ? "bg-cyan-950/30 border-cyan-500/40 text-cyan-200 shadow"
                                  : "bg-slate-950 border-slate-900 text-slate-400 hover:text-slate-300 hover:bg-slate-900"
                              }`}
                            >
                              <div className="flex justify-between items-center mb-1">
                                <span className={`text-[9px] font-mono font-bold ${isPicked ? "text-cyan-400" : "text-slate-500"}`}>
                                  IDEA ANGLE #{index + 1} {isPicked ? "(CHOSEN NARRATIVE)" : ""}
                                </span>
                                {isPicked && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>}
                              </div>
                              <p>{idea}</p>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-slate-600 text-xs italic py-2 text-center">
                        Synthesizing target trend indices... wait for stage completion.
                      </div>
                    )}
                  </div>

                  {/* Stage B: Script Editor & Review */}
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between mb-3.5 border-b border-slate-900 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 bg-rose-950 text-rose-400 rounded text-[10px] font-mono font-bold">STAGE 2</span>
                        <h3 className="text-xs font-extrabold tracking-wider text-slate-350 uppercase font-mono">
                          Cinematic Script Segments
                        </h3>
                      </div>
                      
                      {selectedProject.script?.hook && !isEditingScript && (
                        <button
                          onClick={() => startEditingScript(selectedProject)}
                          className="flex items-center gap-1.5 px-2.1 py-1 bg-slate-900 hover:bg-slate-850 hover:text-rose-400 rounded text-[10px] text-slate-400 font-semibold"
                        >
                          <Edit2 size={10} />
                          <span>Tune Script</span>
                        </button>
                      )}
                    </div>

                    {!selectedProject.script?.hook ? (
                      <div className="text-slate-600 text-xs italic py-2 text-center">
                        Script compilation in queue...
                      </div>
                    ) : isEditingScript ? (
                      <div className="space-y-3 font-sans">
                        <div>
                          <label className="text-[9px] font-mono text-cyan-400 font-bold block mb-1 uppercase">HOOK STRATEGY (FIRST 5 SECONDS):</label>
                          <textarea
                            value={editHook}
                            onChange={(e) => setEditHook(e.target.value)}
                            rows={2}
                            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs text-slate-100 font-sans focus:outline-none focus:border-rose-500"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-mono text-cyan-400 font-bold block mb-1 uppercase">INTRO STORY (STABLIZATION):</label>
                          <textarea
                            value={editIntro}
                            onChange={(e) => setEditIntro(e.target.value)}
                            rows={2}
                            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs text-slate-100 font-sans focus:outline-none focus:border-rose-500"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-mono text-cyan-400 font-bold block mb-1 uppercase">BODY NARRATION (NUCLEUS CLIMAX):</label>
                          <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            rows={4}
                            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs text-slate-100 font-sans focus:outline-none focus:border-rose-500"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-mono text-cyan-400 font-bold block mb-1 uppercase">CTA OUTRO:</label>
                          <textarea
                            value={editCta}
                            onChange={(e) => setEditCta(e.target.value)}
                            rows={2}
                            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs text-slate-100 font-sans focus:outline-none focus:border-rose-500"
                          />
                        </div>
                        <div className="flex gap-2 justify-end pt-2">
                          <button
                            onClick={() => setIsEditingScript(false)}
                            className="px-3 py-1.5 hover:bg-slate-805 text-slate-400 text-[11px] font-mono rounded border border-slate-800"
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
                        <div className="border border-slate-900 bg-slate-900/40 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono font-bold text-slate-500 tracking-wider block uppercase mb-1">
                            HOOK STRATEGY:
                          </span>
                          <p className="text-rose-200 italic font-medium leading-relaxed">
                            "{selectedProject.script.hook}"
                          </p>
                        </div>

                        <div className="border border-slate-900 bg-slate-900/20 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono font-bold text-slate-500 tracking-wider block uppercase mb-1">
                            INTRO PLOT:
                          </span>
                          <p className="text-slate-300 leading-relaxed">
                            {selectedProject.script.intro}
                          </p>
                        </div>

                        <div className="border border-slate-900 bg-slate-900/20 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono font-bold text-slate-500 tracking-wider block uppercase mb-1">
                            BODY STORYLINE:
                          </span>
                          <p className="text-slate-300 leading-relaxed">
                            {selectedProject.script.body}
                          </p>
                        </div>

                        <div className="border border-slate-900 bg-slate-900/20 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono font-bold text-slate-500 tracking-wider block uppercase mb-1">
                            OUTRO CTA:
                          </span>
                          <p className="text-amber-200 italic leading-relaxed">
                            "{selectedProject.script.cta}"
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Stage C: Director Scene Breakdown Grid */}
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between mb-3.5 border-b border-slate-900 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 bg-purple-950 text-purple-400 rounded text-[10px] font-mono font-bold">STAGE 3</span>
                        <h3 className="text-xs font-extrabold tracking-wider text-slate-350 uppercase font-mono">
                          WAN 2.2 Shot Scene Sequence
                        </h3>
                      </div>
                    </div>

                    {!selectedProject.scenes || selectedProject.scenes.length === 0 ? (
                      <div className="text-slate-600 text-xs italic py-2 text-center">
                        Evaluating dynamic visual prompts breakdown timing...
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {selectedProject.scenes.map((scene: Scene) => {
                          const isSceneEditing = editingSceneId === scene.id;
                          return (
                            <div key={scene.id} className="p-3.5 bg-slate-900/30 rounded-xl border border-slate-800 flex flex-col gap-3">
                              <div className="flex justify-between items-center text-[10px] font-mono">
                                <span className="font-bold text-slate-400 bg-slate-950 border border-slate-900 px-2 py-0.5 rounded">
                                  SCENE #{scene.sceneNumber} SHOT
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full inline-block ${
                                    scene.status === "completed" ? "bg-emerald-400" : "bg-rose-500 animate-pulse"
                                  }`} />
                                  <span className="text-slate-500">
                                    {scene.status.toUpperCase().replace("_", " ")}
                                  </span>
                                  {!isSceneEditing && (
                                    <button
                                      onClick={() => startEditingScene(scene)}
                                      className="text-cyan-400 hover:text-white ml-2 hover:bg-slate-950 p-1 rounded transition"
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
                                    <label className="text-[10px] font-mono text-slate-400 uppercase block mb-1">Visual prompts (Flux/SDXL target orientation):</label>
                                    <textarea
                                      value={editVisualPrompt}
                                      onChange={(e) => setEditVisualPrompt(e.target.value)}
                                      rows={2}
                                      className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-xs text-slate-200 font-sans focus:outline-none focus:border-rose-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-mono text-slate-400 uppercase block mb-1">WAN 2.2 Motion dynamics:</label>
                                    <input
                                      type="text"
                                      value={editMotionPrompt}
                                      onChange={(e) => setEditMotionPrompt(e.target.value)}
                                      className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-xs text-slate-200 font-sans focus:outline-none focus:border-rose-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-mono text-slate-400 uppercase block mb-1">Scene Narrative / Subtitle:</label>
                                    <input
                                      type="text"
                                      value={editVoiceText}
                                      onChange={(e) => setEditVoiceText(e.target.value)}
                                      className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-xs text-slate-200 font-sans focus:outline-none focus:border-rose-500"
                                    />
                                  </div>
                                  <div className="flex gap-2 justify-end pt-1">
                                    <button
                                      onClick={() => setEditingSceneId(null)}
                                      className="px-2.5 py-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 text-[10px] font-mono rounded"
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
                                  <div className="h-28 bg-slate-950 rounded border border-slate-900 flex items-center justify-center overflow-hidden relative group">
                                    {scene.imageBase64 ? (
                                      <img
                                        src={scene.imageBase64}
                                        alt="scene base render layout"
                                        className="w-full h-full object-cover select-none group-hover:scale-105 transition-transform duration-500"
                                      />
                                    ) : (
                                      <span className="text-[10px] text-slate-600 font-mono animate-pulse">RENDERING IMAGE WORKFLOW INSTANCE</span>
                                    )}
                                    <div className="absolute top-2 left-2 bg-black/80 px-2 py-0.5 rounded text-[9px] font-mono text-slate-400 border border-slate-800">
                                      Frame 1 SVG Seed
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] leading-relaxed">
                                    <div className="bg-slate-950 p-2 rounded border border-slate-900/65">
                                      <strong className="text-purple-400 block font-mono text-[9px] uppercase tracking-wider mb-0.5">DIRECTOR MODEL STAGE PROMPT:</strong>
                                      <span className="text-slate-300 font-sans">{scene.visualPrompt}</span>
                                    </div>
                                    <div className="bg-slate-950 p-2 rounded border border-slate-900/65">
                                      <strong className="text-rose-400 block font-mono text-[9px] uppercase tracking-wider mb-0.5">CAMERA DYNAMICS TRAJECTORY:</strong>
                                      <span className="text-slate-300 font-mono">{scene.motionPrompt || "Steady zoom forward"}</span>
                                    </div>
                                  </div>

                                  <div className="bg-slate-950/40 p-2 rounded border border-slate-900/65 text-[11px] flex gap-2 items-start">
                                    <span className="text-[9px] font-mono bg-cyan-950 text-cyan-400 px-1 py-0.5 rounded font-bold uppercase block tracking-wider mt-0.5">NARRATIVE VOICEOVER:</span>
                                    <p className="text-slate-300 italic">"{scene.voiceText}"</p>
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
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                      <div className="flex items-center justify-between mb-3.5 border-b border-slate-900 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 bg-amber-950 text-amber-400 rounded text-[10px] font-mono font-bold">STAGE 4</span>
                          <h3 className="text-xs font-extrabold tracking-wider text-slate-350 uppercase font-mono">
                            YouTube Publisher Metadata SEO
                          </h3>
                        </div>
                      </div>

                      <div className="space-y-3 font-sans text-xs">
                        <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-850">
                          <strong className="text-[10px] font-mono block uppercase tracking-wider text-slate-400 mb-1">
                            YouTube Recommendation Title Angle
                          </strong>
                          <p className="text-slate-200 font-bold font-mono text-sm leading-snug">
                            {selectedProject.metadata.title}
                          </p>
                        </div>

                        <div className="bg-slate-900/40 p-2.5 rounded-lg border border-slate-850">
                          <strong className="text-[10px] font-mono block uppercase tracking-wider text-slate-400 mb-1">
                            Video Description Context (SEO Stacked)
                          </strong>
                          <p className="text-slate-350 whitespace-pre-line leading-relaxed text-[11px]">
                            {selectedProject.metadata.description}
                          </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                          <div className="bg-slate-900/30 p-2 rounded border border-slate-850">
                            <strong className="text-[10px] font-mono block uppercase tracking-wider text-slate-500 mb-1">Video Semantic Tags:</strong>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {(selectedProject.metadata.tags || []).map((tag, i) => (
                                <span key={i} className="text-[10px] font-mono px-2 py-0.5 bg-slate-950 text-slate-400 border border-slate-900 rounded">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="bg-slate-900/30 p-2 rounded border border-slate-850">
                            <strong className="text-[10px] font-mono block uppercase tracking-wider text-slate-500 mb-1">Reels & Shorts Hashtags:</strong>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {(selectedProject.metadata.hashtags || []).map((hash, i) => (
                                <span key={i} className="text-[10px] font-mono px-2 py-0.5 bg-rose-950/20 text-rose-350 border border-rose-900/30 rounded font-bold">
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
            )}
          </div>

          {/* Column C (Right 4/12): Real-time Player frame emulator & live log tracker */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            {selectedProject ? (
              <>
                <CinemaPlayer project={selectedProject} />
                <ConsoleTerminal
                  logs={selectedProject.logs}
                  status={selectedProject.status}
                  stepMessage={selectedProject.currentStepMessage}
                />
              </>
            ) : (
              <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-6 shadow-lg flex-1 flex flex-col justify-center items-center text-center text-slate-550">
                <Video size={40} className="text-slate-800 mb-2" />
                <p className="font-mono text-xs uppercase font-bold text-slate-400">Preview Engine Offline</p>
                <p className="text-[11px] text-slate-600 mt-1 max-w-xs">Select any job on the left pipeline queue to engage the interactive player controls.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI ENGINES TAB VIEW */}
      {activeTab === "settings" && (
        <div className="flex-1 max-w-4xl mx-auto w-full p-6">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-6">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
              <div className="p-2.5 bg-rose-500/10 rounded-xl">
                <Sliders size={20} className="text-rose-400" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-200">AI Stack Connections & Video Parameters</h2>
                <p className="text-xs text-slate-400">Modify physical engine connection ports and neural networking variables.</p>
              </div>
            </div>

            {settingsSavedMessage && (
              <div className="bg-emerald-950/50 border border-emerald-500/30 text-emerald-350 px-4 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wide">
                ✓ {settingsSavedMessage}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column Settings */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-cyan-400 font-mono tracking-wider uppercase border-l-2 border-cyan-400 pl-2">
                  1. Script & Research LLMs
                </h3>
                
                <div>
                  <label className="block text-xs text-slate-350 font-mono mb-1">Ollama API Base URL:</label>
                  <input
                    type="url"
                    value={settings.ollamaUrl}
                    onChange={(e) => setSettings({ ...settings, ollamaUrl: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-cyan-500 text-slate-200"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-350 font-mono mb-1">Model Selection (Recommended qwen3):</label>
                  <input
                    type="text"
                    value={settings.llmModel}
                    onChange={(e) => setSettings({ ...settings, llmModel: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-cyan-500 text-slate-200"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Default is <code className="text-slate-400 font-bold">qwen3:8b</code>. Supports <code className="text-slate-405">qwen3:14b</code> or any downloaded model tag.</p>
                </div>

                <div className="pt-2">
                  <h3 className="text-xs font-bold text-orange-400 font-mono tracking-wider uppercase border-l-2 border-orange-400 pl-2 mb-3">
                    2. Image Generation Engine
                  </h3>
                  <div>
                    <label className="block text-xs text-slate-350 font-mono mb-1">ComfyUI Host Endpoint:</label>
                    <input
                      type="url"
                      value={settings.comfyUrl}
                      onChange={(e) => setSettings({ ...settings, comfyUrl: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-orange-500 text-slate-200"
                    />
                  </div>
                  <div className="mt-3">
                    <label className="block text-xs text-slate-350 font-mono mb-1">Workflow JSON Template Name:</label>
                    <select
                      value={settings.workflowTemplate}
                      onChange={(e) => setSettings({ ...settings, workflowTemplate: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-855 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500 text-slate-200"
                    >
                      <option value="FLUX_Dev_Standard">FLUX Dev Standard Workflow (1024px)</option>
                      <option value="SDXL_Turbo_Fast">SDXL Turbo Fast Instant (512px)</option>
                      <option value="Anime_Consistent_Model">Anime Style Consistency Setup</option>
                    </select>
                  </div>
                </div>

                <div className="pt-2">
                  <h3 className="text-xs font-bold text-amber-500 font-mono tracking-wider uppercase border-l-2 border-amber-500 pl-2 mb-3">
                    3. Text-To-Speech (Narrator)
                  </h3>
                  <div>
                    <label className="block text-xs text-slate-350 font-mono mb-1">Active TTS Engine Provider:</label>
                    <select
                      value={settings.ttsEngine}
                      onChange={(e) => setSettings({ ...settings, ttsEngine: e.target.value as any })}
                      className="w-full bg-slate-950 border border-slate-855 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-amber-500 text-slate-200"
                    >
                      <option value="f5-tts">F5-TTS (Primary - Clone Synthesis)</option>
                      <option value="styletts2">StyleTTS2 (Emotional Fallback)</option>
                      <option value="piper">Piper Local Voice (Ultra-Fast)</option>
                      <option value="gemini-tts">Gemini Reader Hybrid (High Fidelity API)</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-[10px] text-slate-400 font-mono mb-1">VOICE REFERENCE PROFILE:</label>
                      <input
                        type="text"
                        value={settings.voiceProfile}
                        onChange={(e) => setSettings({ ...settings, voiceProfile: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-1.5 text-xs text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 font-mono mb-1">EMOTION OVERLAY:</label>
                      <select
                        value={settings.voiceEmotion}
                        onChange={(e) => setSettings({ ...settings, voiceEmotion: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-1.5 text-xs text-slate-200"
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
                <h3 className="text-xs font-bold text-rose-400 font-mono tracking-wider uppercase border-l-2 border-rose-400 pl-2">
                  4. WAN 2.2 Local Video Parameters
                </h3>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-350 font-mono mb-1">Generation Mode:</label>
                    <select
                      value={settings.wanMode}
                      onChange={(e) => setSettings({ ...settings, wanMode: e.target.value as any })}
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs focus:outline-none text-slate-200"
                    >
                      <option value="i2v">Image-To-Video (Recommended)</option>
                      <option value="t2v">Text-To-Video</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-350 font-mono mb-1">Resolution Aspect Ratio:</label>
                    <select
                      value={settings.wanResolution}
                      onChange={(e) => setSettings({ ...settings, wanResolution: e.target.value as any })}
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs focus:outline-none text-slate-200"
                    >
                      <option value="16:9">Horizontal (16:9 YouTube Long)</option>
                      <option value="9:16">Vertical (9:16 Shorts/Reels)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-350 font-mono mb-1">Steps (Sampling):</label>
                    <input
                      type="number"
                      value={settings.wanSteps}
                      onChange={(e) => setSettings({ ...settings, wanSteps: parseInt(e.target.value) || 20 })}
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-350 font-mono mb-1">CFG Guidance scale:</label>
                    <input
                      type="number"
                      step="0.5"
                      value={settings.wanCfg}
                      onChange={(e) => setSettings({ ...settings, wanCfg: parseFloat(e.target.value) || 6 })}
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs font-mono text-slate-200"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-350 font-mono mb-1">Clips Frame length:</label>
                    <input
                      type="number"
                      value={settings.wanFrames}
                      onChange={(e) => setSettings({ ...settings, wanFrames: parseInt(e.target.value) || 81 })}
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs font-mono text-slate-200"
                    />
                    <p className="text-[9px] text-slate-500 mt-0.5">81 frames = ~5 seconds of video</p>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-350 font-mono mb-1">Motion Intensity Scale (1-10):</label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={settings.wanMotionIntensity}
                      onChange={(e) => setSettings({ ...settings, wanMotionIntensity: parseInt(e.target.value) || 7 })}
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs font-mono text-slate-200"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800">
                  <h3 className="text-xs font-bold text-cyan-400 font-mono tracking-wider uppercase mb-2">
                    5. Safe Hybrid Cloud Mode (AI Studio)
                  </h3>
                  <div className="flex items-center justify-between bg-slate-950 p-3 rounded-lg border border-cyan-800/20">
                    <div>
                      <p className="text-xs text-slate-200 font-bold">Use Gemini API & Simulated Generation</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Guarantees the application runs perfectly inside the AI Studio sandbox. When tested locally with real hardware, you can disable this.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.backupGeminiMode}
                        onChange={(e) => setSettings({ ...settings, backupGeminiMode: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-805 pt-5 flex items-center justify-between">
              <div className="flex gap-2 text-xs text-slate-500 items-center">
                <AlertTriangle size={15} className="text-amber-500/80" />
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
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-6">
            <h2 className="text-base font-bold font-mono text-rose-450 tracking-wider uppercase border-b border-slate-800 pb-3">
              🎯 KIWUL LOCAL ENGINE INTEGRATION PLAYBOOK
            </h2>

            <div className="space-y-4 text-xs leading-relaxed text-slate-300">
              <p>
                <strong>Project Kiwul</strong> is specifically mapped to build high click-through, fully animated faceless YouTube videos locally.
                To run completely local and offline without utilizing cloud token costs, construct these server configs inside your computer:
              </p>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-3 font-mono">
                <h3 className="text-xs font-bold text-cyan-400">Step 1: Spin up local LLM Host (Ollama qwen3)</h3>
                <p className="text-slate-500">Ollama acts as research director, generating hooks and plan visual instructions.</p>
                <div className="bg-slate-900 border border-slate-850 p-2.5 rounded text-[11px] text-slate-350">
                  ollama run qwen3:8b
                </div>

                <h3 className="text-xs font-bold text-orange-400 mt-2">Step 2: Initialize ComfyUI API</h3>
                <p className="text-slate-500">ComfyUI listens on port 8188 for direct workspace json injections to bake the scenes.</p>
                <div className="bg-slate-900 border border-slate-850 p-2.5 rounded text-[11px] text-slate-350">
                  python main.py --port 8188 --enable-cors-header
                </div>

                <h3 className="text-xs font-bold text-amber-400 mt-2">Step 3: Setup F5-TTS narration voice library</h3>
                <p className="text-slate-500">F5 clones high quality styles via local wav references seamlessly.</p>
                <div className="bg-slate-900 border border-slate-850 p-2.5 rounded text-[11px] text-slate-350">
                  f5-tts_webui --port 7860
                </div>
              </div>

              <div className="border-t border-slate-800 pt-4">
                <h3 className="font-bold text-slate-200 mb-1">💡 Sandbox ProTip for AI Studio preview:</h3>
                <p className="text-slate-400">
                  We have preloaded high fidelity, responsive <strong>SVG procedural render engines</strong> and <strong>Gemini Voice synthesizers</strong>. 
                  Keep the <code className="text-cyan-400 bg-slate-950 px-1 py-0.5 rounded border border-slate-800">Hybrid Cloud Fallback</code> switched <strong>ON</strong>. 
                  This will generate stunning slides, titles, custom overlays, and correct srt outputs directly in this live browser preview frame without you needing a local RTX GPU right now!
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Persistent global applet footer */}
      <footer className="bg-slate-950/30 border-t border-slate-900 px-6 py-4 flex flex-wrap justify-between items-center text-[10px] text-slate-500 font-mono mt-auto gap-2">
        <span>© 2026 Project Kiwul Autonomous Content Suite. Built for RTX 2000 Ada Offline Pipeline.</span>
        <div className="flex gap-4">
          <span className="text-slate-450 hover:text-slate-200 cursor-help" title="Local node communication healthy.">STAT: CLUSTER SECURE</span>
          <span className="text-slate-450">TIME_ZONE: UTC 24H</span>
        </div>
      </footer>
    </div>
  );
}
