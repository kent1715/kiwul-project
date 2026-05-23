import React, { useEffect, useRef } from "react";
import { Terminal, Shield, Play } from "lucide-react";

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

  const isActive = ["generating_media", "assembling", "researching", "scripting", "planning"].includes(status);

  return (
    <div className="rounded-xl overflow-hidden border border-[var(--color-ink-900)]/20 bg-[#0f1117] font-mono text-xs">
      {/* Header */}
      <div className="bg-[#161822] px-4 py-2.5 flex items-center justify-between border-b border-[#1e2030]">
        <div className="flex items-center gap-2">
          <Terminal size={13} className="text-brand-400" />
          <span className="text-[10px] font-semibold text-[var(--color-ink-400)] uppercase tracking-wider">Pipeline Monitor</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-400/80" />
          <span className="w-2 h-2 rounded-full bg-amber-400/80" />
          <span className="w-2 h-2 rounded-full bg-green-400/80" />
        </div>
      </div>

      {/* Status Bar */}
      <div className="bg-[#161822]/60 px-4 py-1.5 border-b border-[#1e2030] flex items-center justify-between text-[10px] text-[var(--color-ink-500)]">
        <div className="flex items-center gap-1.5">
          <Shield size={10} className="text-cyan-400/70" />
          <span>Host: <span className="text-cyan-400/80">localhost</span></span>
        </div>
        <div>
          {isActive ? (
            <span className="flex items-center gap-1 text-brand-400">
              <span className="status-dot status-dot-online" style={{ width: 5, height: 5 }} />
              Worker Active
            </span>
          ) : status === "completed" ? (
            <span className="text-green-400 font-medium">Ready</span>
          ) : (
            <span className="text-[var(--color-ink-500)]">Idle</span>
          )}
        </div>
      </div>

      {/* Logs */}
      <div
        ref={containerRef}
        className="p-3 h-40 overflow-y-auto space-y-0.5 bg-[#0c0d12] text-[var(--color-ink-400)] leading-relaxed"
      >
        {logs && logs.length > 0 ? (
          logs.map((log, index) => {
            let color = "text-[var(--color-ink-400)]";
            if (log.includes("[ERROR]")) color = "text-red-400 font-medium";
            else if (log.includes("[ASSETS READY]") || log.includes("[FFMPEG COMPLETE]") || log.includes("[SCRIPT OK]")) color = "text-green-400";
            else if (log.includes("[IDEAS GENERATED]") || log.includes("[SCENE")) color = "text-cyan-400";
            else if (log.includes("[SYSTEM]")) color = "text-[var(--color-ink-500)]";
            else if (log.includes("[USER]")) color = "text-pink-400";

            return (
              <div key={index} className="px-1 py-0.5 rounded hover:bg-[#161822]/50 transition-colors whitespace-pre-wrap">
                <span className="text-[var(--color-ink-600)] mr-1.5 select-none text-[10px]">
                  {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={color}>{log}</span>
              </div>
            );
          })
        ) : (
          <div className="text-[var(--color-ink-500)] italic text-center py-8 text-[11px]">
            Waiting for pipeline events...
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-[#0c0d12] px-4 py-2 border-t border-[#1e2030] flex items-center gap-2 text-[10px] text-[var(--color-ink-500)]">
        <span className={`status-dot ${isActive ? "status-dot-online" : "status-dot-pending"}`} style={{ width: 5, height: 5 }} />
        <span className="truncate">
          {stepMessage || "Listening for pipeline events..."}
        </span>
      </div>
    </div>
  );
}
