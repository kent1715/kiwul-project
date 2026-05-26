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
  Activity,
  FileText,
  RefreshCw,
  Database,
  Trash2,
  Edit2,
  CheckCircle,
  XCircle,
  Clock,
  Sliders,
  AlertTriangle,
  Info,
  Save,
  ChevronRight,
  HelpCircle,
  LayoutDashboard,
  Film,
  Terminal,
  Search,
  Zap,
  Eye,
  BookOpen,
  Palette,
  Mic,
  Video,
  Wifi,
  WifiOff,
  Upload,
  X,
} from "lucide-react";

import { Project, AISettings, Scene } from "./types";
import CinemaPlayer from "./components/CinemaPlayer";
import ConsoleTerminal from "./components/ConsoleTerminal";

// ─── ComfyUI Test Generation Button Component ────────────────────────
function ComfyUITestButton({ settings }: { settings: AISettings }) {
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<{
    success: boolean;
    imageUrl: string | null;
    error: string | null;
    timeMs: number;
  } | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/comfyui/test-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkpoint: settings.comfyCheckpoint,
          workflowTemplate: settings.workflowTemplate,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult(data);
      } else {
        const err = await res.json();
        setResult({ success: false, imageUrl: null, error: err.error || "Unknown error", timeMs: 0 });
      }
    } catch (err: any) {
      setResult({ success: false, imageUrl: null, error: err.message, timeMs: 0 });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex-1">
      <button type="button" onClick={handleTest} disabled={testing} className="btn btn-primary w-full text-xs">
        {testing ? (
          <><Loader2 size={13} className="animate-spin" /><span>Generating...</span></>
        ) : (
          <><Cpu size={13} /><span>Test Generate</span></>
        )}
      </button>
      {result && (
        <div className={`mt-2 p-3 rounded-lg text-xs ${
          result.success ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"
        }`}>
          {result.success ? (
            <div className="space-y-2">
              <p className="font-semibold">Test successful ({(result.timeMs / 1000).toFixed(1)}s)</p>
              {result.imageUrl && (
                <img src={result.imageUrl} alt="Test output" className="w-full rounded-lg border border-green-200" />
              )}
            </div>
          ) : (
            <p>Failed: {result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

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

type TabType = "workspace" | "settings" | "docs";

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Create project form states
  const [newTopic, setNewTopic] = useState("");
  const [newName, setNewName] = useState("");
  const [maxDuration, setMaxDuration] = useState("Auto");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [imageOnlyMode, setImageOnlyMode] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Settings states
  const [settings, setSettings] = useState<AISettings>({
    ollamaUrl: "http://localhost:11434",
    llmModel: "llama3",
    imageProvider: "comfyui",
    zImageTurboUrl: "http://127.0.0.1:9000",
    imageWidth: 512,
    imageHeight: 896,
    imageSteps: 8,
    imageCfg: 1.0,
    zImageVaePath: "D:\\Z-Image-Turbo-Windows\\models\\vae\\ae.safetensors",
    zImageLlmPath: "D:\\Z-Image-Turbo-Windows\\models\\llm\\Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    zImageLoras: "",
    zImageLoraStrength: 1.0,
    comfyUrl: "http://localhost:8188",
    comfyCheckpoint: "sdxl_lightning_4step.safetensors",
    comfyNegativePrompt: "low quality, blurry, watermark, text overlay, deformed, ugly, bad anatomy",
    workflowTemplate: "Auto_Detect",
    comfyLora: "",
    comfyLoraStrength: 1.0,
    comfySampler: "euler",
    comfyScheduler: "normal",
    comfySteps: 20,
    comfyCfg: 3.5,
    wanMode: "i2v",
    motionEngine: "wan_i2v",
    wanResolution: "16:9",
    wanSteps: 20,
    wanCfg: 6.0,
    wanFrames: 81,
    wanMotionIntensity: 7,
    ltxSteps: 20,
    ltxCfg: 4.0,
    ltxFrames: 97,
    ltxFps: 24,
    ltxWorkflowPath: "",
    ttsEngine: "f5-tts",
    ttsUrl: "http://127.0.0.1:5050",
    voiceProfile: "natural_charles",
    voiceSpeed: 1.0,
    voiceEmotion: "neutral",
    refAudio: "",
    refText: "",
    voiceCloningEnabled: false,
    backupGeminiMode: false,
  });

  const [activeTab, setActiveTab] = useState<TabType>("workspace");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSavedMessage, setSettingsSavedMessage] = useState("");

  // Connection check state
  const [connectionCheck, setConnectionCheck] = useState<{
    checked: boolean;
    loading: boolean;
    ollamaOk: boolean | null;
    comfyOk: boolean | null;
    zimageOk: boolean | null;
    ollamaDetails: string;
    comfyDetails: string;
    zimageDetails: string;
  }>({
    checked: false,
    loading: false,
    ollamaOk: null,
    comfyOk: null,
    zimageOk: null,
    ollamaDetails: "",
    comfyDetails: "",
    zimageDetails: "",
  });

  const handleCheckConnections = async () => {
    if (connectionCheck.ollamaOk && connectionCheck.comfyOk) return;
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
          zimageOk: data.zimage?.ok ?? false,
          ollamaDetails: data.ollama.message,
          comfyDetails: data.comfy.message,
          zimageDetails: data.zimage?.message || "",
        });
      } else {
        setConnectionCheck({ checked: true, loading: false, ollamaOk: false, comfyOk: false, zimageOk: false, ollamaDetails: "Connection failed", comfyDetails: "Connection failed", zimageDetails: "Connection failed" });
      }
    } catch (err: any) {
      setConnectionCheck({ checked: true, loading: false, ollamaOk: false, comfyOk: false, zimageOk: false, ollamaDetails: "Offline", comfyDetails: "Offline", zimageDetails: "Offline" });
    }
  };

  // Editing states
  const [isEditingScript, setIsEditingScript] = useState(false);
  const [editHook, setEditHook] = useState("");
  const [editIntro, setEditIntro] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editCta, setEditCta] = useState("");
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [editVisualPrompt, setEditVisualPrompt] = useState("");
  const [editMotionPrompt, setEditMotionPrompt] = useState("");
  const [editVoiceText, setEditVoiceText] = useState("");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [comfyCheckpoints, setComfyCheckpoints] = useState<string[]>([]);

  const fetchLocalModels = async () => {
    try {
      const res = await fetch("/api/ollama/models");
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.models)) {
          setOllamaModels(data.models.map((m: any) => m.name));
        } else {
          setOllamaModels([]);
        }
      }
    } catch (err) {
      setOllamaModels([]);
    }
  };

  const fetchComfyCheckpoints = async () => {
    try {
      const res = await fetch("/api/comfyui/checkpoints");
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.checkpoints)) {
          setComfyCheckpoints(data.checkpoints);
        } else if (Array.isArray(data)) {
          setComfyCheckpoints(data);
        } else {
          setComfyCheckpoints([]);
        }
      } else {
        setComfyCheckpoints([]);
      }
    } catch (err) {
      setComfyCheckpoints([]);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchProjects(true);
    fetchLocalModels();
    handleCheckConnections();
  }, []);

  useEffect(() => {
    const hasActiveJob = projects.some(p =>
      ["researching", "scripting", "planning", "generating_media", "assembling", "images_ready"].includes(p.status)
    );
    if (hasActiveJob) {
      const interval = setInterval(() => fetchProjects(false), 3000);
      return () => clearInterval(interval);
    }
  }, [projects]);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        setSettings(await res.json());
      }
    } catch (err) {
      console.error("Error loading settings:", err);
    }
  };

  const fetchProjects = async (selectFirst = false) => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data: Project[] = await res.json();
        setProjects(data);
        if (data.length > 0) {
          if (selectFirst && !selectedProject) {
            setSelectedProject(data[0]);
          } else {
            const current = data.find(p => p.id === selectedProject?.id);
            if (current) setSelectedProject(current);
          }
        } else {
          setSelectedProject(null);
        }
      }
    } catch (err) {
      console.error("Error loading projects:", err);
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
          name: newName.trim() ? newName : `Video: ${newTopic}`,
          maxDuration,
          aspectRatio,
          imageOnlyMode,
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
        setActiveTab("workspace");
      }
    } catch (error) {
      console.error("Error creating project:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setSettingsSavedMessage("");
    setConnectionCheck(prev => ({ ...prev, loading: true, checked: false }));
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setSettingsSavedMessage("Settings saved successfully");
        setTimeout(() => setSettingsSavedMessage(""), 4000);
        await fetchLocalModels();
        await fetchComfyCheckpoints();
        const testRes = await fetch("/api/check-connections");
        const testData = await testRes.json();
        if (testData.success) {
          setConnectionCheck({
            checked: true,
            loading: false,
            ollamaOk: testData.ollama.ok,
            comfyOk: testData.comfy.ok,
            ollamaDetails: testData.ollama.message,
            comfyDetails: testData.comfy.message,
          });
        } else {
          setConnectionCheck({ checked: true, loading: false, ollamaOk: false, comfyOk: false, ollamaDetails: "Failed", comfyDetails: "Failed" });
        }
      }
    } catch (err: any) {
      setConnectionCheck({ checked: true, loading: false, ollamaOk: false, comfyOk: false, ollamaDetails: "Error", comfyDetails: "Error" });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleRetryProject = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/retry`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        await fetchProjects();
        setSelectedProject(updated);
      }
    } catch (err) {
      console.error("Error retrying project:", err);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!window.confirm("Delete this project? All data will be removed.")) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (res.ok) await fetchProjects(true);
    } catch (err) {
      console.error("Error deleting project:", err);
    }
  };

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
          script: { hook: editHook, intro: editIntro, body: editBody, cta: editCta },
          logs: [...selectedProject.logs, "[USER] Script edited manually."]
        }),
      });
      if (res.ok) {
        setIsEditingScript(false);
        await fetchProjects();
      }
    } catch (err) {
      console.error("Error saving script:", err);
    }
  };

  const startEditingScene = (scene: Scene) => {
    setEditingSceneId(scene.id);
    setEditVisualPrompt(scene.visualPrompt);
    setEditMotionPrompt(scene.motionPrompt || "");
    setEditVoiceText(scene.voiceText);
  };

  const saveEditedScene = async (sceneId: string) => {
    if (!selectedProject) return;
    const updatedScenes = selectedProject.scenes.map(s =>
      s.id === sceneId ? { ...s, visualPrompt: editVisualPrompt, motionPrompt: editMotionPrompt, voiceText: editVoiceText } : s
    );
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: updatedScenes,
          logs: [...selectedProject.logs, "[USER] Scene parameters adjusted."]
        }),
      });
      if (res.ok) {
        setEditingSceneId(null);
        await fetchProjects();
      }
    } catch (err) {
      console.error("Error saving scene:", err);
    }
  };

  // Stats
  const totalJobs = projects.length;
  const runningJobs = projects.filter(p => ["researching", "scripting", "planning", "generating_media", "assembling", "images_ready"].includes(p.status)).length;
  const completedJobs = projects.filter(p => p.status === "completed").length;
  const failedJobs = projects.filter(p => p.status === "failed").length;

  const allConnected = connectionCheck.ollamaOk && connectionCheck.comfyOk;

  // ─── Nav items ──────────────────────────────────────────────────
  const navItems: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: "workspace", label: "Workspace", icon: <LayoutDashboard size={18} /> },
    { key: "settings", label: "AI Engines", icon: <Sliders size={18} /> },
    { key: "docs", label: "Documentation", icon: <BookOpen size={18} /> },
  ];

  return (
    <div className="min-h-screen bg-[var(--color-surface-1)] flex">
      {/* ─── Sidebar ────────────────────────────────────────────── */}
      <aside className={`${sidebarCollapsed ? "w-[60px]" : "w-[240px]"} bg-[var(--color-surface-0)] border-r border-[var(--color-surface-3)] flex flex-col transition-all duration-200 sticky top-0 h-screen`}>
        {/* Logo */}
        <div className={`px-4 py-5 border-b border-[var(--color-surface-3)] ${sidebarCollapsed ? "px-3" : ""}`}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0 shadow-sm">
              <Cpu size={16} className="text-white" />
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <h1 className="text-sm font-bold text-[var(--color-ink-900)] tracking-tight truncate">Kiwul</h1>
                <p className="text-[10px] text-[var(--color-ink-400)] truncate">v2.2 WAN Local</p>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {navItems.map(item => (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all ${
                activeTab === item.key
                  ? "bg-brand-50 text-brand-700"
                  : "text-[var(--color-ink-600)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink-800)]"
              }`}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className={activeTab === item.key ? "text-brand-600" : ""}>{item.icon}</span>
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Connection Status */}
        {!sidebarCollapsed && (
          <div className="px-3 py-4 border-t border-[var(--color-surface-3)]">
            <p className="section-label mb-2.5 px-1">Connections</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--color-surface-2)]">
                <span className={`status-dot ${connectionCheck.ollamaOk ? "status-dot-online" : connectionCheck.ollamaOk === false ? "status-dot-offline" : "status-dot-pending"}`} />
                <span className="text-[11px] font-medium text-[var(--color-ink-600)]">Ollama</span>
                {connectionCheck.ollamaOk && <CheckCircle size={11} className="text-green-500 ml-auto" />}
              </div>
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--color-surface-2)]">
                <span className={`status-dot ${connectionCheck.comfyOk ? "status-dot-online" : connectionCheck.comfyOk === false ? "status-dot-offline" : "status-dot-pending"}`} />
                <span className="text-[11px] font-medium text-[var(--color-ink-600)]">ComfyUI</span>
                {connectionCheck.comfyOk && <CheckCircle size={11} className="text-green-500 ml-auto" />}
              </div>
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--color-surface-2)]">
                <span className={`status-dot ${connectionCheck.zimageOk ? "status-dot-online" : connectionCheck.zimageOk === false ? "status-dot-offline" : "status-dot-pending"}`} />
                <span className="text-[11px] font-medium text-[var(--color-ink-600)]">Z-Image Turbo</span>
                {connectionCheck.zimageOk && <CheckCircle size={11} className="text-green-500 ml-auto" />}
              </div>
            </div>
          </div>
        )}

        {/* Collapse Toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="p-3 border-t border-[var(--color-surface-3)] flex items-center justify-center text-[var(--color-ink-400)] hover:text-[var(--color-ink-600)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <ChevronRight size={16} className={`transition-transform ${sidebarCollapsed ? "" : "rotate-180"}`} />
        </button>
      </aside>

      {/* ─── Main Content ───────────────────────────────────────── */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="h-14 bg-[var(--color-surface-0)] border-b border-[var(--color-surface-3)] flex items-center justify-between px-6 sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-semibold text-[var(--color-ink-900)]">
              {activeTab === "workspace" ? "Factory Workspace" : activeTab === "settings" ? "AI Engines Configuration" : "Documentation"}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            {/* Stats Badges */}
            <div className="hidden md:flex items-center gap-2">
              <span className="badge badge-neutral">{totalJobs} Total</span>
              {runningJobs > 0 && <span className="badge badge-brand">{runningJobs} Running</span>}
              {completedJobs > 0 && <span className="badge badge-success">{completedJobs} Done</span>}
              {failedJobs > 0 && <span className="badge badge-danger">{failedJobs} Failed</span>}
            </div>
            <button onClick={() => fetchProjects(false)} className="btn-ghost rounded-lg p-1.5" title="Refresh">
              <RefreshCw size={15} />
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto">
          {/* ═══════════ WORKSPACE TAB ═══════════ */}
          {activeTab === "workspace" && (
            <div className="flex h-full">
              {/* Left Panel: Job Queue */}
              <div className="w-[280px] border-r border-[var(--color-surface-3)] bg-[var(--color-surface-0)] flex flex-col flex-shrink-0">
                <div className="p-4 border-b border-[var(--color-surface-3)]">
                  <button
                    onClick={() => setSelectedProject(null)}
                    className={`w-full btn ${!selectedProject ? "btn-primary" : "btn-secondary"} text-xs gap-2`}
                  >
                    <Plus size={14} />
                    New Project
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                  {projects.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Database size={28} className="text-[var(--color-ink-300)] mb-2" />
                      <p className="text-xs font-medium text-[var(--color-ink-500)]">No projects yet</p>
                      <p className="text-[11px] text-[var(--color-ink-400)] mt-1">Create your first video project</p>
                    </div>
                  ) : (
                    projects.map(proj => {
                      const isSelected = selectedProject?.id === proj.id;
                      const isActive = ["researching", "scripting", "planning", "generating_media", "assembling", "images_ready"].includes(proj.status);
                      return (
                        <div
                          key={proj.id}
                          onClick={() => setSelectedProject(proj)}
                          className={`p-3 rounded-lg cursor-pointer transition-all group ${
                            isSelected
                              ? "bg-brand-50 border border-brand-200 shadow-sm"
                              : "bg-[var(--color-surface-1)] border border-transparent hover:bg-[var(--color-surface-2)] hover:border-[var(--color-surface-3)]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-[var(--color-ink-800)] truncate">{proj.name}</p>
                              <p className="text-[10px] text-[var(--color-ink-400)] mt-0.5">
                                {new Date(proj.createdAt).toLocaleDateString()} {new Date(proj.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                            <button
                              onClick={e => { e.stopPropagation(); handleDeleteProject(proj.id); }}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-ink-400)] hover:text-red-500 hover:bg-red-50 transition-all"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>

                          {isActive && (
                            <div className="mt-2 progress-bar">
                              <div className="progress-bar-fill" style={{ width: `${proj.progress}%` }} />
                            </div>
                          )}

                          <div className="flex items-center justify-between mt-2">
                            <span className={`badge ${
                              proj.status === "completed" ? "badge-success" :
                              proj.status === "failed" ? "badge-danger" :
                              proj.status === "images_ready" ? "badge-warning" :
                              isActive ? "badge-brand" : "badge-neutral"
                            } text-[10px]`}>
                              {proj.status === "images_ready" ? "images ready" : proj.status.replace("_", " ")}
                            </span>
                            <span className="text-[10px] font-medium text-[var(--color-ink-400)]">
                              {isActive ? `${proj.progress}%` : proj.status === "completed" ? "100%" : "—"}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Center + Right Panels */}
              {!selectedProject ? (
                /* ─── New Project Form ─── */
                <div className="flex-1 flex items-center justify-center p-8">
                  <div className="max-w-xl w-full animate-fade-in">
                    <div className="text-center mb-8">
                      <div className="w-14 h-14 rounded-2xl bg-brand-50 border border-brand-100 flex items-center justify-center mx-auto mb-4">
                        <Sparkles size={24} className="text-brand-600" />
                      </div>
                      <h2 className="text-2xl font-bold text-[var(--color-ink-900)]">Create New Video</h2>
                      <p className="text-sm text-[var(--color-ink-500)] mt-2">Choose a topic and let AI produce your faceless YouTube content</p>
                    </div>

                    {/* Suggested Topics */}
                    <div className="flex flex-wrap gap-1.5 justify-center mb-6">
                      {SUGGESTED_STORIES.map((topic, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => { setNewTopic(topic); setNewName(topic); }}
                          className={`px-3 py-1.5 text-[11px] font-medium rounded-full transition-all ${
                            newTopic === topic
                              ? "bg-brand-100 text-brand-700 border border-brand-300"
                              : "bg-[var(--color-surface-0)] text-[var(--color-ink-600)] border border-[var(--color-surface-3)] hover:bg-[var(--color-surface-2)]"
                          }`}
                        >
                          {topic}
                        </button>
                      ))}
                    </div>

                    {/* Form */}
                    <form onSubmit={handleCreateProject} className="card p-6 space-y-5">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">Video Topic</label>
                        <input
                          type="text"
                          required
                          placeholder="Enter a unique story, historical event, conspiracy, or topic..."
                          value={newTopic}
                          onChange={e => setNewTopic(e.target.value)}
                          className="input"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">Max Duration</label>
                          <div className="grid grid-cols-2 gap-1.5">
                            {[
                              { value: "Auto", label: "Auto" },
                              { value: "1 min", label: "1 min" },
                              { value: "2 min", label: "2 min" },
                              { value: "3 min+", label: "3 min+" },
                            ].map(d => (
                              <button
                                key={d.value}
                                type="button"
                                onClick={() => setMaxDuration(d.value)}
                                className={`py-1.5 text-[11px] font-medium rounded-lg border transition-all ${
                                  maxDuration === d.value
                                    ? "bg-brand-600 text-white border-brand-700 shadow-sm"
                                    : "bg-[var(--color-surface-0)] text-[var(--color-ink-600)] border-[var(--color-surface-3)] hover:bg-[var(--color-surface-2)]"
                                }`}
                              >
                                {d.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">Aspect Ratio</label>
                          <div className="grid grid-cols-2 gap-1.5">
                            {[
                              { value: "16:9", label: "16:9 Landscape" },
                              { value: "9:16", label: "9:16 Portrait" },
                            ].map(ar => (
                              <button
                                key={ar.value}
                                type="button"
                                onClick={() => setAspectRatio(ar.value)}
                                className={`py-1.5 text-[11px] font-medium rounded-lg border transition-all ${
                                  aspectRatio === ar.value
                                    ? "bg-brand-600 text-white border-brand-700 shadow-sm"
                                    : "bg-[var(--color-surface-0)] text-[var(--color-ink-600)] border-[var(--color-surface-3)] hover:bg-[var(--color-surface-2)]"
                                }`}
                              >
                                {ar.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">Custom Title <span className="font-normal text-[var(--color-ink-400)]">(optional)</span></label>
                        <input
                          type="text"
                          placeholder="e.g., Ancient Egypt's Greatest Secret"
                          value={newName}
                          onChange={e => setNewName(e.target.value)}
                          className="input"
                        />
                      </div>

                      {/* Generate Image Only Mode */}
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                        <input
                          type="checkbox"
                          id="imageOnlyMode"
                          checked={imageOnlyMode}
                          onChange={e => setImageOnlyMode(e.target.checked)}
                          className="w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                        />
                        <label htmlFor="imageOnlyMode" className="flex-1">
                          <span className="block text-xs font-semibold text-amber-800">Generate Images Only</span>
                          <span className="block text-[10px] text-amber-600">Skip video generation. Review images first, then approve to continue.</span>
                        </label>
                      </div>

                      <button type="submit" disabled={isCreating} className="btn btn-primary w-full py-3">
                        {isCreating ? (
                          <><Loader2 size={15} className="animate-spin" /><span>Creating Project...</span></>
                        ) : (
                          <><Sparkles size={15} /><span>Start Production</span></>
                        )}
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                /* ─── Project Detail View ─── */
                <div className="flex-1 flex min-w-0">
                  {/* Center: Project Details */}
                  <div className="flex-1 p-6 overflow-y-auto min-w-0">
                    <div className="animate-fade-in max-w-3xl">
                      {/* Project Header */}
                      <div className="flex items-start justify-between gap-4 mb-6">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`badge ${
                              selectedProject.status === "completed" ? "badge-success" :
                              selectedProject.status === "failed" ? "badge-danger" :
                              selectedProject.status === "images_ready" ? "badge-warning" :
                              ["researching","scripting","planning","generating_media","assembling"].includes(selectedProject.status) ? "badge-brand" : "badge-neutral"
                            }`}>
                              {selectedProject.status === "images_ready" ? "images ready" : selectedProject.status.replace("_", " ")}
                            </span>
                          </div>
                          <h3 className="text-lg font-bold text-[var(--color-ink-900)]">{selectedProject.name}</h3>
                          <p className="text-xs text-[var(--color-ink-500)] mt-0.5">
                            Topic: <span className="font-medium text-[var(--color-ink-700)]">"{selectedProject.topic}"</span>
                          </p>
                          {selectedProject.currentStepMessage && (
                            <p className="text-xs text-[var(--color-ink-500)] mt-1 flex items-center gap-1.5">
                              <Info size={12} className="text-brand-500" />
                              {selectedProject.currentStepMessage}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          {selectedProject.status === "images_ready" && (
                            <button
                              onClick={async () => {
                                try {
                                  const res = await fetch(`/api/projects/${selectedProject.id}/approve-images`, { method: "POST" });
                                  const data = await res.json();
                                  if (data.success) {
                                    alert("✅ Images approved! Video generation will resume.");
                                    await fetchProjects(false);
                                  } else {
                                    alert(`❌ ${data.error || "Approval failed"}`);
                                  }
                                } catch (err: any) {
                                  alert(`❌ Error: ${err.message}`);
                                }
                              }}
                              className="btn btn-primary text-xs gap-1.5"
                            >
                              ✅ Approve & Continue to Video
                            </button>
                          )}
                          {selectedProject.status === "failed" && (
                            <button onClick={() => handleRetryProject(selectedProject.id)} className="btn btn-secondary text-xs gap-1.5">
                              <RotateCcw size={12} /> Retry
                            </button>
                          )}
                          <button onClick={() => fetchProjects(false)} className="btn-ghost p-2 rounded-lg" title="Sync">
                            <RefreshCw size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-5">
                        {/* Stage 1: Research & Ideas */}
                        <section className="card p-5">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-6 h-6 rounded-md bg-cyan-100 text-cyan-700 flex items-center justify-center text-[11px] font-bold">1</div>
                              <h4 className="text-sm font-semibold text-[var(--color-ink-800)]">Topic Research & Viral Ideas</h4>
                            </div>
                            {selectedProject.ideas?.length > 0 && (
                              <span className="badge badge-success text-[10px]"><CheckCircle size={10} /> Done</span>
                            )}
                          </div>
                          {selectedProject.ideas?.length > 0 ? (
                            <div className="space-y-2">
                              {selectedProject.ideas.map((idea, index) => {
                                const isPicked = selectedProject.selectedIdea === idea;
                                return (
                                  <div
                                    key={index}
                                    onClick={async () => {
                                      if (selectedProject.status !== "researching") {
                                        try {
                                          const res = await fetch(`/api/projects/${selectedProject.id}`, {
                                            method: "PATCH",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                              selectedIdea: idea,
                                              logs: [...selectedProject.logs, `[USER] Selected idea #${index + 1}.`]
                                            }),
                                          });
                                          if (res.ok) fetchProjects();
                                        } catch (e) {}
                                      }
                                    }}
                                    className={`p-3 rounded-lg border text-xs leading-relaxed cursor-pointer transition-all ${
                                      isPicked
                                        ? "bg-cyan-50 border-cyan-300 text-cyan-900"
                                        : "bg-[var(--color-surface-1)] border-[var(--color-surface-3)] text-[var(--color-ink-600)] hover:bg-[var(--color-surface-2)]"
                                    }`}
                                  >
                                    <div className="flex justify-between items-center mb-1">
                                      <span className={`text-[10px] font-semibold ${isPicked ? "text-cyan-600" : "text-[var(--color-ink-400)]"}`}>
                                        Idea #{index + 1} {isPicked ? "— Selected" : ""}
                                      </span>
                                      {isPicked && <CheckCircle size={12} className="text-cyan-500" />}
                                    </div>
                                    <p className="leading-relaxed">{idea}</p>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-[var(--color-ink-400)] italic text-center py-3">Researching trending topics...</p>
                          )}
                        </section>

                        {/* Stage 2: Script */}
                        <section className="card p-5">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-6 h-6 rounded-md bg-rose-100 text-rose-700 flex items-center justify-center text-[11px] font-bold">2</div>
                              <h4 className="text-sm font-semibold text-[var(--color-ink-800)]">Cinematic Script</h4>
                            </div>
                            {selectedProject.script?.hook && !isEditingScript && (
                              <button onClick={() => startEditingScript(selectedProject)} className="btn-ghost text-[11px] gap-1 text-[var(--color-ink-500)]">
                                <Edit2 size={11} /> Edit
                              </button>
                            )}
                          </div>

                          {!selectedProject.script?.hook ? (
                            <p className="text-xs text-[var(--color-ink-400)] italic text-center py-3">Compiling script...</p>
                          ) : isEditingScript ? (
                            <div className="space-y-3">
                              <div>
                                <label className="block text-[11px] font-semibold text-[var(--color-ink-600)] mb-1">Hook (first 5 seconds)</label>
                                <textarea value={editHook} onChange={e => setEditHook(e.target.value)} rows={2} className="input text-xs" />
                              </div>
                              <div>
                                <label className="block text-[11px] font-semibold text-[var(--color-ink-600)] mb-1">Intro</label>
                                <textarea value={editIntro} onChange={e => setEditIntro(e.target.value)} rows={2} className="input text-xs" />
                              </div>
                              <div>
                                <label className="block text-[11px] font-semibold text-[var(--color-ink-600)] mb-1">Body Narration</label>
                                <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={4} className="input text-xs" />
                              </div>
                              <div>
                                <label className="block text-[11px] font-semibold text-[var(--color-ink-600)] mb-1">CTA Outro</label>
                                <textarea value={editCta} onChange={e => setEditCta(e.target.value)} rows={2} className="input text-xs" />
                              </div>
                              <div className="flex gap-2 justify-end pt-1">
                                <button onClick={() => setIsEditingScript(false)} className="btn btn-secondary text-xs">Cancel</button>
                                <button onClick={saveEditedScript} className="btn btn-primary text-xs gap-1"><Save size={12} /> Save Script</button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2.5">
                              <div className="p-3 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-surface-3)]">
                                <span className="text-[10px] font-semibold text-[var(--color-ink-400)] uppercase tracking-wide block mb-1">Hook</span>
                                <p className="text-xs text-rose-700 italic leading-relaxed">"{selectedProject.script.hook}"</p>
                              </div>
                              <div className="p-3 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-surface-3)]">
                                <span className="text-[10px] font-semibold text-[var(--color-ink-400)] uppercase tracking-wide block mb-1">Intro</span>
                                <p className="text-xs text-[var(--color-ink-700)] leading-relaxed">{selectedProject.script.intro}</p>
                              </div>
                              <div className="p-3 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-surface-3)]">
                                <span className="text-[10px] font-semibold text-[var(--color-ink-400)] uppercase tracking-wide block mb-1">Body</span>
                                <p className="text-xs text-[var(--color-ink-700)] leading-relaxed">{selectedProject.script.body}</p>
                              </div>
                              <div className="p-3 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-surface-3)]">
                                <span className="text-[10px] font-semibold text-[var(--color-ink-400)] uppercase tracking-wide block mb-1">CTA</span>
                                <p className="text-xs text-amber-700 italic leading-relaxed">"{selectedProject.script.cta}"</p>
                              </div>

                              {selectedProject.atomicLines?.length > 0 && (
                                <div className="p-3 rounded-lg bg-rose-50/50 border border-rose-200">
                                  <span className="text-[10px] font-semibold text-rose-600 uppercase tracking-wide flex items-center gap-1 mb-2">
                                    <Sparkles size={11} /> Atomic Lines
                                  </span>
                                  <div className="space-y-1 max-h-[150px] overflow-y-auto">
                                    {selectedProject.atomicLines.map((line, i) => (
                                      <div key={i} className="text-[11px] px-2 py-1 rounded bg-[var(--color-surface-0)] border border-[var(--color-surface-3)] text-[var(--color-ink-700)]">
                                        <span className="text-rose-500 font-semibold mr-1.5">{i + 1}.</span>{line}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </section>

                        {/* Stage 3: Scenes */}
                        <section className="card p-5">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-6 h-6 rounded-md bg-purple-100 text-purple-700 flex items-center justify-center text-[11px] font-bold">3</div>
                              <h4 className="text-sm font-semibold text-[var(--color-ink-800)]">Scene Sequence</h4>
                            </div>
                          </div>

                          {!selectedProject.scenes?.length ? (
                            <p className="text-xs text-[var(--color-ink-400)] italic text-center py-3">Generating scene breakdown...</p>
                          ) : (
                            <div className="space-y-3">
                              {selectedProject.scenes.map((scene: Scene) => {
                                const isEditing = editingSceneId === scene.id;
                                return (
                                  <div key={scene.id} className="p-4 rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-surface-3)]">
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-2">
                                        <span className="badge badge-neutral text-[10px]">Scene {scene.sceneNumber}</span>
                                        <span className={`status-dot ${scene.status === "completed" ? "status-dot-online" : "status-dot-pending"}`} />
                                        <span className="text-[11px] text-[var(--color-ink-500)]">{scene.status.replace("_", " ")}</span>
                                      </div>
                                      {!isEditing && (
                                        <button onClick={() => startEditingScene(scene)} className="btn-ghost text-[11px] gap-1 text-[var(--color-ink-400)]">
                                          <Edit2 size={10} /> Edit
                                        </button>
                                      )}
                                    </div>

                                    {isEditing ? (
                                      <div className="space-y-2.5">
                                        <div>
                                          <label className="block text-[10px] font-semibold text-[var(--color-ink-500)] mb-1 uppercase">Visual Prompt</label>
                                          <textarea value={editVisualPrompt} onChange={e => setEditVisualPrompt(e.target.value)} rows={2} className="input text-xs" />
                                        </div>
                                        <div>
                                          <label className="block text-[10px] font-semibold text-[var(--color-ink-500)] mb-1 uppercase">Motion Dynamics</label>
                                          <input type="text" value={editMotionPrompt} onChange={e => setEditMotionPrompt(e.target.value)} className="input text-xs" />
                                        </div>
                                        <div>
                                          <label className="block text-[10px] font-semibold text-[var(--color-ink-500)] mb-1 uppercase">Narrative / Subtitle</label>
                                          <input type="text" value={editVoiceText} onChange={e => setEditVoiceText(e.target.value)} className="input text-xs" />
                                        </div>
                                        <div className="flex gap-2 justify-end pt-1">
                                          <button onClick={() => setEditingSceneId(null)} className="btn btn-secondary text-[11px]">Cancel</button>
                                          <button onClick={() => saveEditedScene(scene.id)} className="btn btn-primary text-[11px] gap-1"><Save size={10} /> Apply</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="space-y-3">
                                        {/* Scene Preview */}
                                        <div className="h-28 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-surface-3)] overflow-hidden relative group">
                                          {scene.imageBase64 ? (
                                            <img src={scene.imageBase64} alt="Scene" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                          ) : (
                                            <div className="absolute inset-0 flex items-center justify-center">
                                              <span className="text-[11px] text-[var(--color-ink-400)] animate-pulse-dot">Rendering...</span>
                                            </div>
                                          )}
                                        </div>

                                        <div className="grid grid-cols-2 gap-2.5">
                                          <div className="p-2.5 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-surface-3)]">
                                            <span className="text-[9px] font-semibold text-purple-600 uppercase tracking-wide block mb-0.5">Visual Prompt</span>
                                            <p className="text-[11px] text-[var(--color-ink-700)] leading-relaxed">{scene.visualPrompt}</p>
                                          </div>
                                          <div className="p-2.5 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-surface-3)]">
                                            <span className="text-[9px] font-semibold text-rose-600 uppercase tracking-wide block mb-0.5">Camera Motion</span>
                                            <p className="text-[11px] text-[var(--color-ink-700)] font-mono leading-relaxed">{scene.motionPrompt || "Zoom in"}</p>
                                          </div>
                                        </div>

                                        <div className="p-2.5 rounded-lg bg-cyan-50/50 border border-cyan-200/60">
                                          <span className="text-[9px] font-semibold text-cyan-600 uppercase tracking-wide">Narration: </span>
                                          <span className="text-[11px] text-[var(--color-ink-700)] italic">"{scene.voiceText}"</span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </section>

                        {/* Stage 4: SEO Metadata */}
                        {selectedProject.metadata?.title && (
                          <section className="card p-5">
                            <div className="flex items-center gap-2.5 mb-4">
                              <div className="w-6 h-6 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center text-[11px] font-bold">4</div>
                              <h4 className="text-sm font-semibold text-[var(--color-ink-800)]">YouTube SEO Metadata</h4>
                            </div>

                            <div className="space-y-3">
                              <div className="p-3 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-surface-3)]">
                                <span className="text-[10px] font-semibold text-[var(--color-ink-400)] uppercase tracking-wide block mb-1">Title</span>
                                <p className="text-sm font-bold text-[var(--color-ink-800)]">{selectedProject.metadata.title}</p>
                              </div>
                              <div className="p-3 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-surface-3)]">
                                <span className="text-[10px] font-semibold text-[var(--color-ink-400)] uppercase tracking-wide block mb-1">Description</span>
                                <p className="text-[11px] text-[var(--color-ink-700)] whitespace-pre-line leading-relaxed">{selectedProject.metadata.description}</p>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-surface-3)]">
                                  <span className="text-[10px] font-semibold text-[var(--color-ink-400)] uppercase tracking-wide block mb-1.5">Tags</span>
                                  <div className="flex flex-wrap gap-1">
                                    {(selectedProject.metadata.tags || []).map((tag, i) => (
                                      <span key={i} className="badge badge-neutral text-[10px]">{tag}</span>
                                    ))}
                                  </div>
                                </div>
                                <div className="p-3 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-surface-3)]">
                                  <span className="text-[10px] font-semibold text-[var(--color-ink-400)] uppercase tracking-wide block mb-1.5">Hashtags</span>
                                  <div className="flex flex-wrap gap-1">
                                    {(selectedProject.metadata.hashtags || []).map((hash, i) => (
                                      <span key={i} className="badge badge-brand text-[10px]">{hash}</span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </section>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Player + Console */}
                  <div className="w-[380px] border-l border-[var(--color-surface-3)] bg-[var(--color-surface-0)] flex flex-col flex-shrink-0 overflow-y-auto">
                    <div className="p-4 space-y-4">
                      <CinemaPlayer project={selectedProject} />
                      <ConsoleTerminal
                        logs={selectedProject.logs}
                        status={selectedProject.status}
                        stepMessage={selectedProject.currentStepMessage}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════ SETTINGS TAB ═══════════ */}
          {activeTab === "settings" && (
            <div className="max-w-4xl mx-auto w-full p-8 animate-fade-in">
              <div className="card p-8">
                {/* Header */}
                <div className="flex items-center gap-3 mb-6 pb-5 border-b border-[var(--color-surface-3)]">
                  <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center">
                    <Sliders size={20} className="text-brand-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-[var(--color-ink-900)]">AI Engine Configuration</h2>
                    <p className="text-xs text-[var(--color-ink-500)] mt-0.5">Configure local AI engines and generation parameters</p>
                  </div>
                </div>

                {settingsSavedMessage && (
                  <div className="mb-5 p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-xs font-medium flex items-center gap-2">
                    <CheckCircle size={14} /> {settingsSavedMessage}
                  </div>
                )}

                {/* Connection Monitor */}
                <div className="p-4 rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-surface-3)] mb-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`status-dot ${allConnected ? "status-dot-online" : connectionCheck.checked ? "status-dot-offline" : "status-dot-pending"}`} />
                      <div>
                        <p className="text-xs font-semibold text-[var(--color-ink-800)]">Connection Status</p>
                        <p className="text-[11px] text-[var(--color-ink-500)]">Test connectivity to Ollama and ComfyUI</p>
                      </div>
                    </div>
                    <button
                      onClick={handleCheckConnections}
                      disabled={connectionCheck.loading || allConnected}
                      className={`btn text-xs ${allConnected ? "badge-success border cursor-default" : "btn-primary"}`}
                    >
                      {connectionCheck.loading ? (
                        <><Loader2 size={12} className="animate-spin" /> Testing...</>
                      ) : allConnected ? (
                        <><CheckCircle size={12} /> Connected</>
                      ) : (
                        <><Activity size={12} /> Test Connection</>
                      )}
                    </button>
                  </div>

                  {connectionCheck.checked && (
                    <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-[var(--color-surface-3)]">
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-surface-3)]">
                        <span className={`status-dot ${connectionCheck.ollamaOk ? "status-dot-online" : "status-dot-offline"}`} />
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-[var(--color-ink-700)]">Ollama LLM</p>
                          <p className="text-[10px] text-[var(--color-ink-400)] truncate">{connectionCheck.ollamaDetails}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-surface-3)]">
                        <span className={`status-dot ${connectionCheck.comfyOk ? "status-dot-online" : "status-dot-offline"}`} />
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-[var(--color-ink-700)]">ComfyUI</p>
                          <p className="text-[10px] text-[var(--color-ink-400)] truncate">{connectionCheck.comfyDetails}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Settings Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                  {/* Left Column */}
                  <div className="space-y-6">
                    {/* Section 1: LLM */}
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-5 h-5 rounded bg-cyan-100 flex items-center justify-center"><Search size={11} className="text-cyan-700" /></div>
                        <h3 className="text-xs font-bold text-[var(--color-ink-800)] uppercase tracking-wide">Script & Research LLM</h3>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Ollama API URL</label>
                          <input type="url" value={settings.ollamaUrl} onChange={e => setSettings({ ...settings, ollamaUrl: e.target.value })} className="input input-mono" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">LLM Model</label>
                          <input type="text" value={settings.llmModel} onChange={e => setSettings({ ...settings, llmModel: e.target.value })} className="input input-mono" placeholder="e.g. llama3, qwen2.5" />
                          {ollamaModels.length > 0 ? (
                            <div className="mt-2 p-2.5 rounded-lg bg-indigo-50/50 border border-indigo-100">
                              <p className="text-[10px] font-semibold text-indigo-700 mb-1.5">Detected Models:</p>
                              <div className="flex flex-wrap gap-1">
                                {ollamaModels.map(m => (
                                  <button key={m} type="button" onClick={() => setSettings({ ...settings, llmModel: m })}
                                    className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${
                                      settings.llmModel === m ? "bg-brand-600 text-white border-brand-700" : "bg-white text-[var(--color-ink-600)] border-[var(--color-surface-3)] hover:bg-[var(--color-surface-2)]"
                                    }`}
                                  >{m}</button>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p className="text-[10px] text-amber-600 mt-1.5 flex items-center gap-1"><AlertTriangle size={10} /> No models detected. Make sure Ollama is running.</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Section 2: Image Gen */}
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-5 h-5 rounded bg-amber-100 flex items-center justify-center"><Palette size={11} className="text-amber-700" /></div>
                        <h3 className="text-xs font-bold text-[var(--color-ink-800)] uppercase tracking-wide">Image Generation</h3>
                      </div>
                      <div className="space-y-3">
                        {/* Image Engine Selector */}
                        <div>
                          <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Image Engine</label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setSettings({ ...settings, imageProvider: 'comfyui' })}
                              className={`px-3 py-2 rounded-lg text-xs font-semibold border-2 transition-all ${
                                settings.imageProvider === 'comfyui'
                                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                              }`}
                            >
                              ComfyUI
                            </button>
                            <button
                              type="button"
                              onClick={() => setSettings({ ...settings, imageProvider: 'zimage_turbo' })}
                              className={`px-3 py-2 rounded-lg text-xs font-semibold border-2 transition-all ${
                                settings.imageProvider === 'zimage_turbo'
                                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                              }`}
                            >
                              Z-Image Turbo
                            </button>
                          </div>
                        </div>

                        {/* Z-Image Turbo Settings */}
                        {settings.imageProvider === 'zimage_turbo' && (
                          <div className="space-y-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                            <div>
                              <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Z-Image Turbo API URL</label>
                              <input type="url" value={settings.zImageTurboUrl} onChange={e => setSettings({ ...settings, zImageTurboUrl: e.target.value })} className="input input-mono" placeholder="http://127.0.0.1:9000" />
                            </div>
                            {/* Resolution Presets */}
                            <div>
                              <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">Resolution Preset</label>
                              <div className="grid grid-cols-3 gap-2">
                                <button type="button" onClick={() => setSettings({ ...settings, imageWidth: 512, imageHeight: 896 })}
                                  className={`px-2 py-1.5 rounded text-[10px] font-semibold border transition-all ${
                                    settings.imageWidth === 512 && settings.imageHeight === 896
                                      ? 'border-amber-500 bg-amber-100 text-amber-800' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                                  }`}>
                                  512×896<br/><span className="text-[9px] font-normal">±12s Fast</span>
                                </button>
                                <button type="button" onClick={() => setSettings({ ...settings, imageWidth: 576, imageHeight: 1024 })}
                                  className={`px-2 py-1.5 rounded text-[10px] font-semibold border transition-all ${
                                    settings.imageWidth === 576 && settings.imageHeight === 1024
                                      ? 'border-amber-500 bg-amber-100 text-amber-800' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                                  }`}>
                                  576×1024<br/><span className="text-[9px] font-normal">±18s HQ</span>
                                </button>
                                <button type="button" onClick={() => setSettings({ ...settings, imageWidth: 1024, imageHeight: 1024 })}
                                  className={`px-2 py-1.5 rounded text-[10px] font-semibold border transition-all ${
                                    settings.imageWidth === 1024 && settings.imageHeight === 1024
                                      ? 'border-amber-500 bg-amber-100 text-amber-800' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                                  }`}>
                                  1024×1024<br/><span className="text-[9px] font-normal">±30s Max</span>
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                              <div>
                                <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">Width</label>
                                <input type="number" min={256} max={2048} step={64} value={settings.imageWidth} onChange={e => setSettings({ ...settings, imageWidth: parseInt(e.target.value) || 512 })} className="input input-mono text-xs" />
                              </div>
                              <div>
                                <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">Height</label>
                                <input type="number" min={256} max={2048} step={64} value={settings.imageHeight} onChange={e => setSettings({ ...settings, imageHeight: parseInt(e.target.value) || 896 })} className="input input-mono text-xs" />
                              </div>
                              <div>
                                <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">Steps</label>
                                <input type="number" min={1} max={50} value={settings.imageSteps} onChange={e => setSettings({ ...settings, imageSteps: parseInt(e.target.value) || 8 })} className="input input-mono text-xs" />
                              </div>
                              <div>
                                <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">CFG</label>
                                <input type="number" min={0.1} max={10} step={0.1} value={settings.imageCfg} onChange={e => setSettings({ ...settings, imageCfg: parseFloat(e.target.value) || 1.0 })} className="input input-mono text-xs" />
                              </div>
                            </div>
                            {/* Model Paths */}
                            <div>
                              <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">VAE Path</label>
                              <input type="text" value={settings.zImageVaePath} onChange={e => setSettings({ ...settings, zImageVaePath: e.target.value })} className="input input-mono text-xs" placeholder="D:\Z-Image-Turbo\models\vae\ae.safetensors" />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">LLM Path</label>
                              <input type="text" value={settings.zImageLlmPath} onChange={e => setSettings({ ...settings, zImageLlmPath: e.target.value })} className="input input-mono text-xs" placeholder="D:\Z-Image-Turbo\models\llm\Qwen3-4B.gguf" />
                            </div>
                            {/* LoRA Settings */}
                            <div className="grid grid-cols-5 gap-2">
                              <div className="col-span-3">
                                <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">LoRAs (JSON or comma-separated)</label>
                                <input type="text" value={settings.zImageLoras} onChange={e => setSettings({ ...settings, zImageLoras: e.target.value })} className="input input-mono text-xs" placeholder='[] or lora1.safetensors,lora2.safetensors' />
                              </div>
                              <div className="col-span-2">
                                <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">LoRA Strength</label>
                                <input type="number" min={0} max={2} step={0.1} value={settings.zImageLoraStrength} onChange={e => setSettings({ ...settings, zImageLoraStrength: parseFloat(e.target.value) || 1.0 })} className="input input-mono text-xs" />
                              </div>
                            </div>
                            {/* Test Buttons */}
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const res = await fetch(`/api/zimage-turbo/health?baseUrl=${encodeURIComponent(settings.zImageTurboUrl)}`);
                                    const data = await res.json();
                                    alert(data.ok ? `✅ ${data.message}` : `❌ ${data.message}${data.detail ? '\n' + data.detail : ''}`);
                                  } catch (err: any) {
                                    alert(`❌ Gagal cek koneksi: ${err.message}`);
                                  }
                                }}
                                className="btn btn-secondary text-xs flex-1 gap-1"
                              >
                                Test Connection
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!confirm('Test generate 1 image dengan Z-Image Turbo?')) return;
                                  try {
                                    alert('⏳ Generating test image...');
                                    const res = await fetch('/api/zimage-turbo/test-generate', { method: 'POST' });
                                    const data = await res.json();
                                    alert(data.ok ? `✅ ${data.message}\nFile: ${data.filePath}` : `❌ ${data.message}\n${data.detail || ''}`);
                                  } catch (err: any) {
                                    alert(`❌ Test gagal: ${err.message}`);
                                  }
                                }}
                                className="btn btn-secondary text-xs flex-1 gap-1"
                              >
                                Test Generate
                              </button>
                            </div>
                          </div>
                        )}

                        {/* ComfyUI Settings (shown when ComfyUI is selected) */}
                        {settings.imageProvider === 'comfyui' && (
                          <>
                            <div>
                              <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">ComfyUI Endpoint</label>
                              <input type="url" value={settings.comfyUrl} onChange={e => setSettings({ ...settings, comfyUrl: e.target.value })} className="input input-mono" />
                            </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-medium text-[var(--color-ink-600)]">Checkpoint Model</label>
                            <button type="button" onClick={fetchComfyCheckpoints} className="text-[10px] text-[var(--color-ink-400)] hover:text-brand-600 flex items-center gap-1"><RefreshCw size={9} /> Refresh</button>
                          </div>
                          {comfyCheckpoints.length > 0 ? (
                            <select value={settings.comfyCheckpoint} onChange={e => setSettings({ ...settings, comfyCheckpoint: e.target.value })} className="input">
                              {comfyCheckpoints.map(ckpt => <option key={ckpt} value={ckpt}>{ckpt}</option>)}
                            </select>
                          ) : (
                            <input type="text" value={settings.comfyCheckpoint} onChange={e => setSettings({ ...settings, comfyCheckpoint: e.target.value })} className="input input-mono" placeholder="e.g. flux1-dev.safetensors" />
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Negative Prompt</label>
                          <textarea value={settings.comfyNegativePrompt} onChange={e => setSettings({ ...settings, comfyNegativePrompt: e.target.value })} rows={2} className="input text-xs resize-y" placeholder="low quality, blurry, watermark..." />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Workflow Template</label>
                          <select value={settings.workflowTemplate} onChange={e => setSettings({ ...settings, workflowTemplate: e.target.value })} className="input">
                            <option value="Auto_Detect">Auto-Detect (Recommended)</option>
                            <option value="Flux_Schnell_Simple_API">FLUX Schnell Simple</option>
                            <option value="FLUX_Dev_UNET">FLUX Dev UNET</option>
                            <option value="FLUX_Dev_Standard">FLUX Dev Standard</option>
                            <option value="SDXL_Standard">SDXL Standard</option>
                            <option value="SDXL_Lightning">SDXL Lightning (Fast)</option>
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">Sampler</label>
                            <select value={settings.comfySampler || "euler"} onChange={e => setSettings({ ...settings, comfySampler: e.target.value })} className="input text-xs">
                              <option value="euler">Euler</option>
                              <option value="euler_ancestral">Euler Ancestral</option>
                              <option value="dpmpp_2m">DPM++ 2M</option>
                              <option value="dpmpp_2m_karras">DPM++ 2M Karras</option>
                              <option value="dpmpp_3m_karras">DPM++ 3M Karras</option>
                              <option value="dpmpp_sde">DPM++ SDE</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">Scheduler</label>
                            <select value={settings.comfyScheduler || "normal"} onChange={e => setSettings({ ...settings, comfyScheduler: e.target.value })} className="input text-xs">
                              <option value="normal">Normal</option>
                              <option value="karras">Karras</option>
                              <option value="exponential">Exponential</option>
                              <option value="sgm_uniform">SGM Uniform</option>
                            </select>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">Steps</label>
                            <input type="number" min={1} max={100} value={settings.comfySteps || 20} onChange={e => setSettings({ ...settings, comfySteps: parseInt(e.target.value) || 20 })} className="input input-mono text-xs" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">CFG (Guidance)</label>
                            <input type="number" min={0} max={30} step={0.5} value={settings.comfyCfg || 3.5} onChange={e => setSettings({ ...settings, comfyCfg: parseFloat(e.target.value) || 3.5 })} className="input input-mono text-xs" />
                            <p className="text-[9px] text-[var(--color-ink-400)] mt-0.5">FLUX: 1-4 | SDXL: 5-8</p>
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <ComfyUITestButton settings={settings} />
                          <button
                            type="button"
                            onClick={async () => { try { await fetch("/api/comfyui/interrupt", { method: "POST" }); } catch (err) {} }}
                            className="btn btn-secondary text-xs flex-1 gap-1"
                          >
                            <XCircle size={12} /> Interrupt
                          </button>
                        </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Section 3: TTS */}
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-5 h-5 rounded bg-rose-100 flex items-center justify-center"><Mic size={11} className="text-rose-700" /></div>
                        <h3 className="text-xs font-bold text-[var(--color-ink-800)] uppercase tracking-wide">Text-to-Speech</h3>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">TTS Engine</label>
                          <select value={settings.ttsEngine} onChange={e => setSettings({ ...settings, ttsEngine: e.target.value as any })} className="input">
                            <option value="f5-tts">F5-TTS (Clone Synthesis)</option>
                            <option value="styletts2">StyleTTS2 (Emotional)</option>
                            <option value="piper">Piper (Ultra-Fast)</option>
                            <option value="gemini-tts">Gemini TTS (Cloud)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">TTS Server URL</label>
                          <input type="text" value={settings.ttsUrl || "http://127.0.0.1:5050"} onChange={e => setSettings({ ...settings, ttsUrl: e.target.value })} className="input input-mono text-xs" placeholder="http://127.0.0.1:5050" />
                        </div>

                        {/* Voice Cloning Section */}
                        <div className="border border-purple-200 rounded-lg p-3 bg-purple-50/50">
                          <div className="flex items-center gap-2 mb-2">
                            <input
                              type="checkbox"
                              checked={settings.voiceCloningEnabled || false}
                              onChange={e => setSettings({ ...settings, voiceCloningEnabled: e.target.checked })}
                              className="w-3.5 h-3.5 rounded accent-purple-600"
                            />
                            <label className="text-xs font-bold text-purple-800 uppercase tracking-wide">Voice Cloning</label>
                          </div>
                          <p className="text-[10px] text-purple-600 mb-2">Upload suara referensi untuk clone suara kustom via F5-TTS</p>

                          {settings.voiceCloningEnabled && (
                            <div className="space-y-2">
                              {/* Reference Audio Upload */}
                              <div>
                                <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">Upload Suara Referensi</label>
                                <div className="flex gap-2">
                                  <label className="flex-1 flex items-center gap-2 px-3 py-2 border-2 border-dashed border-purple-300 rounded-lg cursor-pointer hover:border-purple-500 hover:bg-purple-50 transition-colors">
                                    <Upload size={14} className="text-purple-500 shrink-0" />
                                    <span className="text-[10px] text-purple-600 truncate">
                                      {settings.refAudio ? "✓ Audio tersimpan" : "Pilih file audio (WAV/MP3)..."}
                                    </span>
                                    <input
                                      type="file"
                                      accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
                                      className="hidden"
                                      onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        // Convert to base64 data URL
                                        const reader = new FileReader();
                                        reader.onload = async () => {
                                          const dataUrl = reader.result as string;
                                          setSettings({ ...settings, refAudio: dataUrl });
                                          // Also upload to backend for persistence
                                          try {
                                            await fetch("/api/tts/upload-ref-audio", {
                                              method: "POST",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ audio: dataUrl, refText: settings.refText || "" }),
                                            });
                                          } catch (err) {
                                            console.warn("Failed to persist ref audio:", err);
                                          }
                                        };
                                        reader.readAsDataURL(file);
                                      }}
                                    />
                                  </label>
                                  {settings.refAudio && (
                                    <button
                                      onClick={async () => {
                                        setSettings({ ...settings, refAudio: "", refText: "" });
                                        try {
                                          await fetch("/api/tts/ref-audio", { method: "DELETE" });
                                        } catch (err) { /* ignore */ }
                                      }}
                                      className="px-2 py-1 text-[10px] text-red-600 hover:bg-red-50 rounded border border-red-200"
                                    >
                                      Hapus
                                    </button>
                                  )}
                                </div>
                                {settings.refAudio && (
                                  <div className="mt-1">
                                    <audio controls src={settings.refAudio} className="w-full h-8 rounded" style={{ maxHeight: '32px' }} />
                                  </div>
                                )}
                              </div>

                              {/* Reference Text */}
                              <div>
                                <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">Teks Referensi (opsional)</label>
                                <input
                                  type="text"
                                  value={settings.refText || ""}
                                  onChange={e => setSettings({ ...settings, refText: e.target.value })}
                                  className="input input-mono text-xs"
                                  placeholder="Teks yang sesuai dengan audio referensi..."
                                />
                                <p className="text-[9px] text-[var(--color-ink-400)] mt-0.5">Membantu akurasi cloning — ketik apa yang diucapkan di audio referensi</p>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Voice Profile (fallback when cloning is disabled) */}
                        {!settings.voiceCloningEnabled && (
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">Voice Profile</label>
                              <input type="text" value={settings.voiceProfile} onChange={e => setSettings({ ...settings, voiceProfile: e.target.value })} className="input input-mono text-xs" />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">Emotion</label>
                              <select value={settings.voiceEmotion} onChange={e => setSettings({ ...settings, voiceEmotion: e.target.value })} className="input text-xs">
                                <option value="neutral">Neutral / Dramatic</option>
                                <option value="excited">Excited / Viral</option>
                                <option value="whispering">Suspenseful</option>
                                <option value="terrified">Horror</option>
                              </select>
                            </div>
                          </div>
                        )}

                        {/* Voice Speed */}
                        <div>
                          <label className="block text-[10px] font-medium text-[var(--color-ink-500)] mb-1 uppercase">Speed: {settings.voiceSpeed?.toFixed(1) || "1.0"}x</label>
                          <input
                            type="range"
                            min="0.5"
                            max="2.0"
                            step="0.1"
                            value={settings.voiceSpeed || 1.0}
                            onChange={e => setSettings({ ...settings, voiceSpeed: parseFloat(e.target.value) })}
                            className="w-full accent-purple-600"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-6">
                    {/* Section 4: Motion Engine */}
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-5 h-5 rounded bg-brand-100 flex items-center justify-center"><Video size={11} className="text-brand-700" /></div>
                        <h3 className="text-xs font-bold text-[var(--color-ink-800)] uppercase tracking-wide">Motion Engine</h3>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Engine</label>
                          <select value={settings.motionEngine || 'wan_i2v'} onChange={e => setSettings({ ...settings, motionEngine: e.target.value as any })} className="input">
                            <option value="wan_i2v">WAN 2.2 I2V</option>
                            <option value="ltx_i2v">LTX-Video I2V</option>
                          </select>
                          <p className="text-[9px] text-[var(--color-ink-400)] mt-0.5">Select the video generation engine for scene motion</p>
                        </div>

                        {/* WAN 2.2 Parameters */}
                        {(settings.motionEngine || 'wan_i2v') === 'wan_i2v' && (
                          <>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Mode</label>
                                <select value={settings.wanMode} onChange={e => setSettings({ ...settings, wanMode: e.target.value as any })} className="input">
                                  <option value="i2v">Image-to-Video</option>
                                  <option value="t2v">Text-to-Video</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Resolution</label>
                                <select value={settings.wanResolution} onChange={e => setSettings({ ...settings, wanResolution: e.target.value as any })} className="input">
                                  <option value="16:9">16:9 Landscape</option>
                                  <option value="9:16">9:16 Portrait</option>
                                </select>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Steps</label>
                                <input type="number" value={settings.wanSteps} onChange={e => setSettings({ ...settings, wanSteps: parseInt(e.target.value) || 20 })} className="input input-mono text-xs" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">CFG</label>
                                <input type="number" step="0.5" value={settings.wanCfg} onChange={e => setSettings({ ...settings, wanCfg: parseFloat(e.target.value) || 6 })} className="input input-mono text-xs" />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Frames</label>
                                <input type="number" value={settings.wanFrames} onChange={e => setSettings({ ...settings, wanFrames: parseInt(e.target.value) || 81 })} className="input input-mono text-xs" />
                                <p className="text-[9px] text-[var(--color-ink-400)] mt-0.5">81 frames = ~5 seconds</p>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Motion Intensity</label>
                                <input type="number" min={1} max={10} value={settings.wanMotionIntensity} onChange={e => setSettings({ ...settings, wanMotionIntensity: parseInt(e.target.value) || 7 })} className="input input-mono text-xs" />
                              </div>
                            </div>
                          </>
                        )}

                        {/* LTX-Video Parameters */}
                        {(settings.motionEngine || 'wan_i2v') === 'ltx_i2v' && (
                          <>
                            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-[10px] text-amber-700 mb-2">
                              Requires ComfyUI-LTXVideo custom nodes + ltx-video-2b-v0.9 model + siglip CLIP + ltx_vae
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Custom Workflow JSON Path</label>
                              <input
                                type="text"
                                value={settings.ltxWorkflowPath || ''}
                                onChange={e => setSettings({ ...settings, ltxWorkflowPath: e.target.value })}
                                className="input text-xs"
                                placeholder="/path/to/your/ltx_workflow.json"
                              />
                              <p className="text-[9px] text-[var(--color-ink-400)] mt-0.5">
                                Path to your manually saved ComfyUI LTX I2V workflow JSON (API or GUI format). Leave empty to use built-in workflow.
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Steps</label>
                                <input type="number" value={settings.ltxSteps || 20} onChange={e => setSettings({ ...settings, ltxSteps: parseInt(e.target.value) || 20 })} className="input input-mono text-xs" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">CFG</label>
                                <input type="number" step="0.5" value={settings.ltxCfg || 4.0} onChange={e => setSettings({ ...settings, ltxCfg: parseFloat(e.target.value) || 4.0 })} className="input input-mono text-xs" />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">Frames</label>
                                <input type="number" value={settings.ltxFrames || 97} onChange={e => setSettings({ ...settings, ltxFrames: parseInt(e.target.value) || 97 })} className="input input-mono text-xs" />
                                <p className="text-[9px] text-[var(--color-ink-400)] mt-0.5">97 frames @ 24fps = ~4 seconds</p>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-[var(--color-ink-600)] mb-1">FPS</label>
                                <input type="number" value={settings.ltxFps || 24} onChange={e => setSettings({ ...settings, ltxFps: parseInt(e.target.value) || 24 })} className="input input-mono text-xs" />
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Section 5: Prompts */}
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-5 h-5 rounded bg-rose-100 flex items-center justify-center"><Sparkles size={11} className="text-rose-700" /></div>
                        <h3 className="text-xs font-bold text-[var(--color-ink-800)] uppercase tracking-wide">Master Prompts & AI Directives</h3>
                      </div>
                      <div className="space-y-4">
                        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/30">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Sparkles size={13} className="text-rose-500" />
                            <span className="text-xs font-semibold text-rose-700">Motion Prompt Generator</span>
                          </div>
                          <p className="text-[10px] text-[var(--color-ink-500)] mb-2 leading-relaxed">Controls visual and camera motion prompts for each scene</p>
                          <textarea
                            value={settings.promptPlanning || ""}
                            onChange={e => setSettings({ ...settings, promptPlanning: e.target.value })}
                            className="input text-xs input-mono min-h-[160px] resize-y !bg-[var(--color-ink-900)] !text-rose-200 !border-[var(--color-ink-700)]"
                            placeholder="Enter master scene & camera planning prompt..."
                          />
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                          <div className="p-3 rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-surface-3)]">
                            <span className="text-[11px] font-semibold text-[var(--color-ink-700)] block mb-0.5">Ideation Prompt</span>
                            <p className="text-[9px] text-[var(--color-ink-400)] mb-1.5">Generates 3 viral story angles</p>
                            <textarea value={settings.promptIdeation || ""} onChange={e => setSettings({ ...settings, promptIdeation: e.target.value })} className="input text-[10px] input-mono min-h-[100px] resize-y" />
                          </div>
                          <div className="p-3 rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-surface-3)]">
                            <span className="text-[11px] font-semibold text-[var(--color-ink-700)] block mb-0.5">Script Prompt</span>
                            <p className="text-[9px] text-[var(--color-ink-400)] mb-1.5">Builds hook, intro, body, and CTA</p>
                            <textarea value={settings.promptScript || ""} onChange={e => setSettings({ ...settings, promptScript: e.target.value })} className="input text-[10px] input-mono min-h-[100px] resize-y" />
                          </div>
                          <div className="p-3 rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-surface-3)]">
                            <span className="text-[11px] font-semibold text-[var(--color-ink-700)] block mb-0.5">Script Splitter Prompt</span>
                            <p className="text-[9px] text-[var(--color-ink-400)] mb-1.5">Splits script into atomic TTS lines</p>
                            <textarea value={settings.promptSplitter || ""} onChange={e => setSettings({ ...settings, promptSplitter: e.target.value })} className="input text-[10px] input-mono min-h-[100px] resize-y" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="mt-8 pt-5 border-t border-[var(--color-surface-3)] flex items-center justify-between">
                  <p className="text-[11px] text-[var(--color-ink-400)] flex items-center gap-1.5">
                    <AlertTriangle size={13} className="text-amber-500" />
                    Changes are saved to local disk configuration
                  </p>
                  <button onClick={handleSaveSettings} disabled={isSavingSettings} className="btn btn-primary text-xs">
                    {isSavingSettings ? (
                      <><Loader2 size={13} className="animate-spin" /> Saving...</>
                    ) : (
                      <><Save size={14} /> Save Settings</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════ DOCS TAB ═══════════ */}
          {activeTab === "docs" && (
            <div className="max-w-3xl mx-auto w-full p-8 animate-fade-in">
              <div className="card p-8">
                <h2 className="text-lg font-bold text-[var(--color-ink-900)] mb-6 pb-4 border-b border-[var(--color-surface-3)]">Local Engine Setup Guide</h2>

                <div className="space-y-6 text-sm text-[var(--color-ink-600)] leading-relaxed">
                  <p>
                    <strong className="text-[var(--color-ink-800)]">Project Kiwul</strong> builds high click-through, fully animated faceless YouTube videos locally.
                    To run completely offline without cloud token costs, set up these engines on your computer:
                  </p>

                  <div className="space-y-5">
                    <div>
                      <h3 className="text-xs font-bold text-cyan-700 mb-1.5">Step 1: Local LLM Host (Ollama)</h3>
                      <p className="text-[var(--color-ink-500)] text-xs mb-2">Ollama acts as research director, generating hooks and visual instructions.</p>
                      <div className="p-3 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-surface-3)] font-mono text-xs text-[var(--color-ink-800)]">
                        ollama run qwen3:8b
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-bold text-amber-700 mb-1.5">Step 2: ComfyUI Image Engine</h3>
                      <p className="text-[var(--color-ink-500)] text-xs mb-2">ComfyUI listens on port 8188 for workflow JSON injections to generate scene images.</p>
                      <div className="p-3 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-surface-3)] font-mono text-xs text-[var(--color-ink-800)]">
                        python main.py --port 8188 --enable-cors-header
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-bold text-rose-700 mb-1.5">Step 3: F5-TTS Narration</h3>
                      <p className="text-[var(--color-ink-500)] text-xs mb-2">F5 clones high quality voice styles via local wav references.</p>
                      <div className="p-3 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-surface-3)] font-mono text-xs text-[var(--color-ink-800)]">
                        f5-tts_webui --port 7860
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-brand-50/50 border border-brand-100 mt-6">
                    <p className="text-xs font-semibold text-brand-800 mb-1">Sandbox Preview</p>
                    <p className="text-[11px] text-brand-700 leading-relaxed">
                      We've preloaded SVG procedural render engines and Gemini Voice synthesizers for preview.
                      Keep the Hybrid Cloud Fallback switched ON to generate slides, titles, overlays, and SRT outputs directly in the browser without a local RTX GPU.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="border-t border-[var(--color-surface-3)] bg-[var(--color-surface-0)] px-6 py-3 flex items-center justify-between text-[10px] text-[var(--color-ink-400)] mt-auto">
          <span>© 2026 Project Kiwul</span>
          <div className="flex items-center gap-3">
            {allConnected ? (
              <span className="flex items-center gap-1 text-green-600"><Wifi size={10} /> All Engines Online</span>
            ) : (
              <span className="flex items-center gap-1 text-amber-600"><WifiOff size={10} /> Engines Offline</span>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
