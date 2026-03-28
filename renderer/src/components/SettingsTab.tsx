import { Separator } from '@/components/ui/separator'

export default function SettingsTab() {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-4">
        <div className="flex items-center gap-3">
          <img src="./icon.png" alt="" className="w-10 h-10" />
          <div>
            <h1 className="font-display text-xl font-bold tracking-wide">prestiger</h1>
            <p className="text-[11px] text-muted-foreground">bloodweb automation tool</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          MITM proxy that intercepts game traffic, captures your session,
          and sends custom requests to automate prestige progression.
        </p>

        <Separator className="bg-border/50" />

        <div className="text-xs text-muted-foreground space-y-1 leading-relaxed">
          <p>Each prestige costs ~20,000 BP</p>
          <p>Supports Steam <span className="text-zinc-400">(Requires SSL Bypass)</span>, Epic Games, and Xbox / MS Store</p>
          <p>Platform is auto-detected from the running game process</p>
        </div>

        <Separator className="bg-border/50" />

        <div className="text-xs text-muted-foreground">
          <p>Made by <a href="https://github.com/sinnayuh" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2 hover:text-zinc-300">sin</a> — <span className="text-foreground">@sinnayuh</span> on Discord</p>
        </div>
      </div>
    </div>
  )
}
