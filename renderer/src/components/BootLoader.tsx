import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface BootLoaderProps {
  onComplete: () => void
}

export default function BootLoader({ onComplete }: BootLoaderProps) {
  const [phase, setPhase] = useState<'typing' | 'rule' | 'fadeout' | 'done'>('typing')
  const [visibleChars, setVisibleChars] = useState(0)
  const title = 'PRESTIGER'

  // Phase 1: Type out the title character by character
  useEffect(() => {
    if (phase !== 'typing') return
    if (visibleChars >= title.length) {
      setTimeout(() => setPhase('rule'), 200)
      return
    }
    const timeout = setTimeout(() => setVisibleChars(v => v + 1), 65)
    return () => clearTimeout(timeout)
  }, [visibleChars, phase])

  // Phase 2: Expanding rule line
  useEffect(() => {
    if (phase !== 'rule') return
    const timeout = setTimeout(() => setPhase('fadeout'), 700)
    return () => clearTimeout(timeout)
  }, [phase])

  // Phase 3: Fade out
  useEffect(() => {
    if (phase !== 'fadeout') return
    const timeout = setTimeout(() => {
      setPhase('done')
      onComplete()
    }, 500)
    return () => clearTimeout(timeout)
  }, [phase, onComplete])

  if (phase === 'done') return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center bg-background transition-opacity duration-500',
        phase === 'fadeout' ? 'opacity-0' : 'opacity-100'
      )}
    >
      {/* Title */}
      <div className="relative">
        <h1
          className="font-display text-[28px] font-bold tracking-[0.35em] text-foreground/90 select-none"
          aria-label={title}
        >
          {title.split('').map((char, i) => (
            <span
              key={i}
              className={cn(
                'inline-block transition-all duration-150',
                i < visibleChars
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-1'
              )}
            >
              {char}
            </span>
          ))}
        </h1>

        {/* Scanning cursor */}
        {phase === 'typing' && visibleChars < title.length && (
          <span
            className="absolute top-0 bottom-0 w-px bg-foreground/40 animate-pulse"
            style={{
              left: `${(visibleChars / title.length) * 100}%`,
              transition: 'left 65ms linear',
            }}
          />
        )}
      </div>

      {/* Subtitle */}
      <p
        className={cn(
          'mt-3 font-display text-[10px] uppercase tracking-[0.5em] text-muted-foreground transition-all duration-300',
          phase === 'typing' && visibleChars < title.length
            ? 'opacity-0'
            : 'opacity-100'
        )}
      >
        bloodweb automation
      </p>

      {/* Expanding rule */}
      <div className="mt-6 flex justify-center w-full">
        <div
          className={cn(
            'h-px bg-border transition-all ease-out',
            phase === 'rule' || phase === 'fadeout'
              ? 'w-48 opacity-100 duration-600'
              : 'w-0 opacity-0 duration-0'
          )}
        />
      </div>

      {/* Version */}
      <p
        className={cn(
          'absolute bottom-6 text-[10px] font-mono text-muted-foreground/30 tracking-wider transition-opacity duration-300',
          phase === 'rule' || phase === 'fadeout' ? 'opacity-100' : 'opacity-0'
        )}
      >
        v2.0.0
      </p>
    </div>
  )
}
