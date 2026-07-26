import React from 'react'
import { SessionIconProps } from './ClaudeSessionIcon'

const DEBUG_SOLID_BLOCK: boolean = false

const CLOUD =
  'M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388z'

const SLASH =
  'M8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z'

const UNDERSCORE =
  'M12.546 13.909a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636z'

function wrapStyle(size?: number): React.CSSProperties | undefined {
  return size ? { width: size, height: size } : undefined
}

function svgStyle(size?: number): React.CSSProperties | undefined {
  return size ? { width: size - 2, height: size - 2 } : undefined
}

function gradIds(status: SessionIconProps['status']) {
  const base = status === 'unseen' ? 'codex-base-unseen' : 'codex-base-std'
  return { base, warm: 'codex-warm-std', spec: 'codex-spec-std' }
}

function Defs({ status }: { status: SessionIconProps['status'] }) {
  const ids = gradIds(status)
  return (
    <defs>
      <radialGradient id={ids.base} cx="8" cy="6" r="22" fx="6" fy="3" gradientUnits="userSpaceOnUse">
        {status === 'unseen' ? (
          <>
            <stop offset="0%" stopColor="#6ee7b7" />
            <stop offset="25%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#047857" />
            <stop offset="75%" stopColor="#064e3b" />
            <stop offset="100%" stopColor="#022c1d" />
          </>
        ) : (
          <>
            <stop offset="0%" stopColor="#FAFAFF" />
            <stop offset="12%" stopColor="#DCE0FF" />
            <stop offset="28%" stopColor="#B1A7FF" />
            <stop offset="46%" stopColor="#7A9DFF" />
            <stop offset="62%" stopColor="#4F6BE8" />
            <stop offset="80%" stopColor="#3941FF" />
            <stop offset="100%" stopColor="#241889" />
          </>
        )}
      </radialGradient>
      <radialGradient id={ids.warm} cx="18" cy="20" r="15" fx="20" fy="22" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#D14EE8" stopOpacity="0.85" />
        <stop offset="40%" stopColor="#9045D8" stopOpacity="0.55" />
        <stop offset="100%" stopColor="#5530B0" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={ids.spec} cx="7" cy="4" r="5" fx="7" fy="3" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
        <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0.18" />
        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
      </radialGradient>
    </defs>
  )
}

function CloudBody({
  status,
  shimmer = true,
}: {
  status: SessionIconProps['status']
  shimmer?: boolean
}) {
  const ids = gradIds(status)
  return (
    <>
      <path d={CLOUD} fill={`url(#${ids.base})`} />
      <path className={shimmer ? 'codex-session-warm' : undefined} d={CLOUD} fill={`url(#${ids.warm})`} />
      <path className={shimmer ? 'codex-session-spec' : undefined} d={CLOUD} fill={`url(#${ids.spec})`} />
    </>
  )
}

function ScaledCodex({
  status,
  size,
  animated = true,
  children,
}: {
  status: SessionIconProps['status']
  size?: number
  animated?: boolean
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle(size)}>
      <span className={`codex-session-motion${animated ? ' codex-session-scale' : ''}`}>
        <svg viewBox="1 1 22 22" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
          <Defs status={status} />
          {children}
        </svg>
      </span>
    </span>
  )
}

export function CodexSessionIcon({ status, size, renderLevel = 'rich' }: SessionIconProps) {
  // Mirrors ClaudeSessionIcon: resting states drop their interpolating animations
  // (`codex-session-scale` ≈ float, `warm`/`spec` ≈ the leg wiggle) at `compact`.
  // The step-end `codex-session-cursor` is this icon's blink — it stays on.
  const restingAnimated = renderLevel === 'rich'

  if (DEBUG_SOLID_BLOCK) {
    return (
      <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle(size)}>
        <span style={{ ...svgStyle(size), width: svgStyle(size)?.width ?? 12, height: svgStyle(size)?.height ?? 12, background: '#4F6BE8' }} />
      </span>
    )
  }

  if (status === 'running') {
    return (
      <span className="codex-session-wrap w-3.5 h-3.5" style={wrapStyle(size)}>
        <span className="codex-session-layer codex-session-run-scale">
          <span className="codex-session-motion codex-session-rotate">
            <svg viewBox="1 1 22 22" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
              <Defs status="running" />
              <CloudBody status="running" />
            </svg>
          </span>
        </span>
        <span className="codex-session-layer">
          <svg viewBox="1 1 22 22" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
            <path d={SLASH} fill="#fff" />
            <path className="codex-session-cursor-run" d={UNDERSCORE} fill="#fff" />
          </svg>
        </span>
      </span>
    )
  }

  if (status === 'background') {
    return (
      <span className="codex-session-wrap w-3.5 h-3.5" style={wrapStyle(size)}>
        <span className="codex-session-layer codex-session-scale">
          <svg viewBox="1 1 22 22" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
            <Defs status="background" />
            <CloudBody status="background" shimmer={false} />
            <path d={SLASH} fill="#fff" />
            <path d={UNDERSCORE} fill="#fff" />
          </svg>
        </span>
        <span className="codex-session-veil" />
      </span>
    )
  }

  if (status === 'unseen') {
    const ids = gradIds('unseen')
    return (
      <ScaledCodex status="unseen" size={size}>
        <path d={CLOUD} fill={`url(#${ids.base})`} />
        <path className="codex-session-spec" d={CLOUD} fill={`url(#${ids.spec})`} />
        <path d="M 6.2 12.8 L 10.6 17.0 L 18.0 6.8" fill="none" stroke="#022c1d" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 6.2 12.8 L 10.6 17.0 L 18.0 6.8" fill="none" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      </ScaledCodex>
    )
  }

  if (status === 'automation') {
    return (
      <ScaledCodex status="automation" size={size} animated={restingAnimated}>
        <CloudBody status="automation" shimmer={restingAnimated} />
        <rect x="11.3" y="5.4" width="1.4" height="6.8" fill="#ffffff" />
        <rect x="12" y="11.3" width="4.6" height="1.4" fill="#ffffff" />
        <circle cx="12" cy="12" r="1.0" fill="#ffffff" />
      </ScaledCodex>
    )
  }

  return (
    <ScaledCodex status={status} size={size} animated={restingAnimated}>
      <CloudBody status={status} shimmer={restingAnimated} />
      <path d={SLASH} fill="#fff" />
      <path className="codex-session-cursor" d={UNDERSCORE} fill="#fff" />
    </ScaledCodex>
  )
}
