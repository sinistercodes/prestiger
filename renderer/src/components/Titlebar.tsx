import { Minus, Square, X, Unplug, Plug } from "lucide-react";
import { cn } from "@/lib/utils";

const PLATFORM_NAMES: Record<string, string> = {
  steam: "Steam",
  egs: "Epic Games",
  ms_store: "Xbox / MS Store",
};

interface TitlebarProps {
  platform: string | null;
  platformExe: string | null;
}

export default function Titlebar({ platform, platformExe }: TitlebarProps) {
  const attached = !!platform;
  const label = platform ? PLATFORM_NAMES[platform] ?? platform : "Not Attached";

  return (
    <div className="flex items-center h-[36px] bg-card border-b border-border select-none shrink-0">
      <div className="drag-region flex-1 h-full flex items-center px-4 gap-4">
        <span className="font-display tracking-[0.2em] uppercase text-[11px] font-semibold text-muted-foreground">
          PRESTIGER
        </span>

        <div className="h-4 w-px bg-border" />

        <div
          className={cn(
            "no-drag flex items-center gap-2 text-[11px] font-medium transition-colors",
            attached ? "text-foreground" : "text-muted-foreground/60"
          )}
          title={platformExe ?? "No game process detected"}
        >
          {attached ? (
            <Plug className="h-3 w-3" />
          ) : (
            <Unplug className="h-3 w-3" />
          )}
          <span>{label}</span>
          {attached && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-zinc-400" />
            </span>
          )}
        </div>
      </div>

      <div className="flex h-full">
        <button
          className="no-drag inline-flex items-center justify-center w-[46px] h-full bg-transparent text-muted-foreground hover:bg-secondary transition-colors"
          onClick={() => window.windowControls.minimize()}
        >
          <Minus className="size-4" />
        </button>
        <button
          className="no-drag inline-flex items-center justify-center w-[46px] h-full bg-transparent text-muted-foreground hover:bg-secondary transition-colors"
          onClick={() => window.windowControls.maximize()}
        >
          <Square className="size-3.5" />
        </button>
        <button
          className="no-drag inline-flex items-center justify-center w-[46px] h-full bg-transparent text-muted-foreground hover:bg-destructive hover:text-white transition-colors"
          onClick={() => window.windowControls.close()}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
