import React, { useEffect, useRef } from "react";
import { Terminal, Shield, Sparkles, AlertTriangle, Play } from "lucide-react";

interface ConsoleTerminalProps {
  logs: string[];
  status: string;
  stepMessage: string;
}

export default function ConsoleTerminal({ logs, status, stepMessage }: ConsoleTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl font-mono text-xs text-slate-300">
      {/* Chrome header */}
      <div className="bg-slate-900 px-4 py-2.5 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-rose-500 animate-pulse" />
          <span className="text-slate-400 font-bold tracking-wider text-[10px] uppercase">
            LOCAL ENGINE PIPELINE DEPLOY MONITOR
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-500 block"></span>
          <span className="h-2 w-2 rounded-full bg-amber-500 block"></span>
          <span className="h-2 w-2 rounded-full bg-teal-500 block"></span>
        </div>
      </div>

      {/* Connection warning status in system margin */}
      <div className="bg-slate-900/40 px-4 py-2 border-b border-slate-900 flex items-center justify-between text-[11px] text-slate-400 select-none">
        <div className="flex items-center gap-1.5">
          <Shield size={12} className="text-cyan-400" />
          <span>Local Stack Host: <code className="text-cyan-400">localhost</code></span>
        </div>
        <div className="flex items-center gap-2">
          {status === "generating_media" || status === "assembling" || status === "researching" || status === "scripting" || status === "planning" ? (
            <span className="flex items-center gap-1 text-rose-400">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping inline-block"></span>
              PIPELINE WORKER ACTIVE
            </span>
          ) : status === "completed" ? (
            <span className="text-emerald-400 font-semibold uppercase">READY</span>
          ) : (
            <span className="text-slate-500 uppercase">IDLE QUEUE</span>
          )}
        </div>
      </div>

      {/* Logs console window */}
      <div
        ref={containerRef}
        className="p-4 h-48 overflow-y-auto space-y-1.5 bg-black/70 scrollbar-thin scrollbar-thumb-slate-800 selection:bg-rose-500 selection:text-white"
      >
        {logs && logs.length > 0 ? (
          logs.map((log, index) => {
            let color = "text-slate-300";
            if (log.includes("[ERROR]")) color = "text-rose-400 font-semibold";
            else if (log.includes("[ASSETS READY]") || log.includes("[FFMPEG COMPLETE]") || log.includes("[SCRIPT OK]")) color = "text-emerald-400 font-medium";
            else if (log.includes("[IDEAS GENERATED]") || log.includes("[SCENE")) color = "text-cyan-400";
            else if (log.includes("[SYSTEM]")) color = "text-slate-500";
            else if (log.includes("[USER]")) color = "text-pink-400";

            return (
              <div key={index} className="leading-relaxed hover:bg-slate-900/50 px-1 py-0.5 rounded transition-colors whitespace-pre-wrap">
                <span className="text-slate-600 mr-2 select-none">[{new Date().toLocaleTimeString()}]</span>
                <span className={color}>{log}</span>
              </div>
            );
          })
        ) : (
          <div className="text-slate-600 italic text-center py-12">
            Waiting for factory job dispatch context instructions...
          </div>
        )}
      </div>

      {/* Terminal Footer status info bar */}
      <div className="bg-slate-950 px-4 py-2 border-t border-slate-900 flex items-center gap-2 text-[11px] text-slate-400 font-sans">
        <div className="w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" />
        <span className="text-xs truncate font-mono">
          <strong className="text-slate-300">Message State:</strong> {stepMessage || "Listening for project instruction triggers..."}
        </span>
      </div>
    </div>
  );
}
