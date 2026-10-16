import { useEffect, useId, useRef } from 'react'
import { ULTRATHINK_COLORS } from '@superone/shared/composer-mode'
import { normalizedVoiceAudioLevel, voiceWaveY, VOICE_WAVEFORM } from '@superone/shared/voice-waveform'
import type { VoiceAudioLevelSource } from '@superone/shared/voice-audio-levels'
import { cn } from '@superone/ui/lib/utils'

/** Same geometry and audio response as the native phone waveform, drawn with SVG. */
export function VoiceWaveform({ levels, paused = false, compact = false }: {
  levels: VoiceAudioLevelSource; paused?: boolean; compact?: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const gradient = useId()
  const glow = useId()
  useEffect(() => {
    const svg = svgRef.current!
    const paths = svg.querySelectorAll<SVGPathElement>('[data-wave-layer]')
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let frame = 0
    let width = compact ? 24 : 300
    let level = paused ? 0 : normalizedVoiceAudioLevel(Math.max(levels.snapshot().input, levels.snapshot().output))
    let lastTime = 0
    const draw = (now: number) => {
      const sample = levels.snapshot()
      const target = paused ? 0 : normalizedVoiceAudioLevel(Math.max(sample.input, sample.output))
      const elapsed = Math.min(100, Math.max(0, now - lastTime))
      lastTime = now
      level += (target - level) * (1 - Math.exp(-elapsed / (target > level ? 60 : 180)))
      if (level < 0.001) level = 0
      const seconds = motion?.matches ? 0.8 : now / 1000
      const points = Math.min(180, Math.ceil(width))
      for (const path of paths) {
        const layer = Number(path.dataset.waveLayer)
        let d = ''
        for (let index = 0; index <= points; index++) {
          const u = index / points
          d += `${index ? 'L' : 'M'}${(2 + u * (width - 4)).toFixed(2)},${voiceWaveY(u, seconds, level, layer).toFixed(2)} `
        }
        path.setAttribute('d', d)
      }
      // Silence and pause need no clock. Meter updates restart the loop.
      frame = !paused && !motion?.matches && level > 0 ? requestAnimationFrame(draw) : 0
    }
    const wake = () => { if (!frame) frame = requestAnimationFrame(draw) }
    const resize = () => {
      width = Math.max(5, svg.getBoundingClientRect().width || width)
      svg.setAttribute('viewBox', `0 0 ${width} ${VOICE_WAVEFORM.height}`)
      wake()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(svg)
    const unsubscribe = levels.subscribe(wake)
    motion?.addEventListener('change', wake)
    resize()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      unsubscribe()
      motion?.removeEventListener('change', wake)
    }
  }, [levels, paused, compact])
  return <svg ref={svgRef} data-testid="voice-waveform" aria-hidden="true" focusable="false"
    viewBox={`0 0 ${compact ? 24 : 300} ${VOICE_WAVEFORM.height}`} preserveAspectRatio="none"
    className={cn('pointer-events-none block h-7 w-full', compact && 'size-6 overflow-hidden rounded-full border border-border')}>
    <defs>
      {/* A silent path has zero bounding-box height; objectBoundingBox gradients
          cannot paint it. Viewport coordinates keep the resting line visible. */}
      <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" x2="100%" y1="0" y2="0">
        {ULTRATHINK_COLORS.map(([r, g, b], index) => <stop key={index} offset={index / (ULTRATHINK_COLORS.length - 1)} stopColor={`rgb(${r},${g},${b})`} />)}
      </linearGradient>
      <filter id={glow} filterUnits="userSpaceOnUse" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation={VOICE_WAVEFORM.glow * 5} /></filter>
    </defs>
    {[3, 2, 1, 0].map(layer => {
      const opacity = layer === 0 ? 0.95 : 0.28 + layer * 0.12
      const strokeWidth = layer === 0 ? 1.9 : 1.2
      return <g key={layer} fill="none" stroke={`url(#${gradient})`} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path data-wave-layer={layer} d={`M2,18 L${compact ? 22 : 298},18`} opacity={opacity * 0.6} filter={`url(#${glow})`} />
        <path data-wave-layer={layer} d={`M2,18 L${compact ? 22 : 298},18`} opacity={opacity} />
      </g>
    })}
  </svg>
}
