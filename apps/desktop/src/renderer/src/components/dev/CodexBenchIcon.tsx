import React from 'react'
import type { SessionIconProps } from '@superone/ui/components/harness/ClaudeSessionIcon'

const CLOUD =
  'M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388z'

const SLASH =
  'M8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z'

const UNDERSCORE =
  'M12.546 13.909a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636z'

export const CODEX_BENCH_CSS = `
@keyframes xb-scale { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
@keyframes xb-run-scale { 0%,100%{transform:scale(0.96)} 50%{transform:scale(1.12)} }
@keyframes xb-rotate { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
@keyframes xb-cursor { 0%,48%,100%{opacity:1} 50%,98%{opacity:0} }
@keyframes xb-veil { 0%,100%{opacity:.7} 50%{opacity:.05} }
@keyframes xb-warm { 0%,100%{opacity:.7} 50%{opacity:1} }
@keyframes xb-spec { 0%,100%{opacity:.65} 50%{opacity:1} }
.xb-wrap { position: relative; display: inline-flex; align-items: center; justify-content: center; }
.xb-layer { position: absolute; inset: 0; display: inline-flex; align-items: center; justify-content: center; }
.xb-motion { display: inline-flex; }
.xb-scale { will-change: transform; animation: xb-scale 2.5s ease-in-out infinite; }
.xb-veil { position: absolute; inset: 0; background: var(--sidebar, var(--background)); will-change: opacity; animation: xb-veil 2.5s ease-in-out infinite; }
.xb-run-scale { will-change: transform; animation: xb-run-scale 1.25s ease-in-out infinite; }
.xb-rotate { will-change: transform; animation: xb-rotate 2.5s linear infinite; }
.xb-warm { animation: xb-warm 5s ease-in-out infinite; }
.xb-spec { animation: xb-spec 5s ease-in-out infinite; }
.xb-cursor { animation: xb-cursor 1.25s step-end infinite; }
.xb-cursor-run { animation: xb-cursor 0.5s step-end infinite; }
`

function wrapStyle(size?: number): React.CSSProperties | undefined {
  return size ? { width: size, height: size } : undefined
}

function svgStyle(size?: number): React.CSSProperties | undefined {
  return size ? { width: size - 2, height: size - 2 } : undefined
}

function Defs({ status }: { status: SessionIconProps['status'] }) {
  return (
    <defs>
      <radialGradient id="xb-base" cx="8" cy="6" r="22" fx="6" fy="3" gradientUnits="userSpaceOnUse">
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
      <radialGradient id="xb-warm-grad" cx="18" cy="20" r="15" fx="20" fy="22" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#D14EE8" stopOpacity="0.85" />
        <stop offset="40%" stopColor="#9045D8" stopOpacity="0.55" />
        <stop offset="100%" stopColor="#5530B0" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="xb-spec-grad" cx="7" cy="4" r="5" fx="7" fy="3" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
        <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0.18" />
        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
      </radialGradient>
    </defs>
  )
}

function CloudBody({ warm = true, shimmer = true }: { warm?: boolean; shimmer?: boolean }) {
  return (
    <>
      <path d={CLOUD} fill="url(#xb-base)" />
      {warm && <path className={shimmer ? 'xb-warm' : undefined} d={CLOUD} fill="url(#xb-warm-grad)" />}
      <path className={shimmer ? 'xb-spec' : undefined} d={CLOUD} fill="url(#xb-spec-grad)" />
    </>
  )
}

function ScaledCodex({
  status,
  size,
  children,
}: {
  status: SessionIconProps['status']
  size?: number
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle(size)}>
      <span className="xb-motion xb-scale">
        <svg viewBox="1 1 22 22" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
          <Defs status={status} />
          {children}
        </svg>
      </span>
    </span>
  )
}

function BackgroundCodex({ size }: { size?: number }) {
  return (
    <span className="xb-wrap w-3.5 h-3.5" style={wrapStyle(size)}>
      <span className="xb-layer xb-scale">
        <svg viewBox="1 1 22 22" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
          <Defs status="background" />
          <CloudBody shimmer={false} />
          <path d={SLASH} fill="#fff" />
          <path d={UNDERSCORE} fill="#fff" />
        </svg>
      </span>
      <span className="xb-veil" />
    </span>
  )
}

function RunningCodex({ size }: { size?: number }) {
  return (
    <span className="xb-wrap w-3.5 h-3.5" style={wrapStyle(size)}>
      <span className="xb-layer xb-run-scale">
        <span className="xb-motion xb-rotate">
          <svg viewBox="1 1 22 22" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
            <Defs status="running" />
            <CloudBody />
          </svg>
        </span>
      </span>
      <span className="xb-layer">
        <svg viewBox="1 1 22 22" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
          <path d={SLASH} fill="#fff" />
          <path className="xb-cursor-run" d={UNDERSCORE} fill="#fff" />
        </svg>
      </span>
    </span>
  )
}

export function CodexBenchIcon({ status, size }: SessionIconProps) {
  if (status === 'running') return <RunningCodex size={size} />
  if (status === 'background') return <BackgroundCodex size={size} />

  if (status === 'unseen') {
    return (
      <ScaledCodex status="unseen" size={size}>
        <path d={CLOUD} fill="url(#xb-base)" />
        <path className="xb-spec" d={CLOUD} fill="url(#xb-spec-grad)" />
        <path d="M 6.2 12.8 L 10.6 17.0 L 18.0 6.8" fill="none" stroke="#022c1d" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 6.2 12.8 L 10.6 17.0 L 18.0 6.8" fill="none" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      </ScaledCodex>
    )
  }

  if (status === 'automation') {
    return (
      <ScaledCodex status="automation" size={size}>
        <CloudBody />
        <rect x="11.3" y="5.4" width="1.4" height="6.8" fill="#ffffff" />
        <rect x="12" y="11.3" width="4.6" height="1.4" fill="#ffffff" />
        <circle cx="12" cy="12" r="1.0" fill="#ffffff" />
      </ScaledCodex>
    )
  }

  return (
    <ScaledCodex status={status} size={size}>
      <CloudBody />
      <path d={SLASH} fill="#fff" />
      <path className="xb-cursor" d={UNDERSCORE} fill="#fff" />
    </ScaledCodex>
  )
}
