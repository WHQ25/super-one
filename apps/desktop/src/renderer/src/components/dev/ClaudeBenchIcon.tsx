import React from 'react'
import type { SessionIconProps } from '@superone/ui/components/harness/ClaudeSessionIcon'

const BODY = '#E07B4A'
const EYE = '#1a1a1a'

export const CLAUDE_BENCH_CSS = `
@keyframes cb-float { 0%,100%{transform:translate(0,0)} 25%{transform:translate(12%,-12%)} 50%{transform:translate(0,0)} 75%{transform:translate(-12%,-12%)} }
@keyframes cb-bob { 0%,100%{transform:translate(0,0)} 50%{transform:translate(0,-12%)} }
@keyframes cb-jump { 0%,100%{transform:translate(0,0) rotate(0deg)} 25%{transform:translate(-12%,-22%) rotate(-6deg)} 50%{transform:translate(0,0) rotate(0deg)} 75%{transform:translate(12%,-22%) rotate(6deg)} }
@keyframes cb-breath { 0%,100%{opacity:.3} 50%{opacity:1} }
@keyframes cb-blink { 0%,90%,100%{opacity:1} 95%{opacity:0} }
@keyframes cb-leg-l { 0%,100%{transform:scaleY(1)} 50%{transform:scaleY(1.2)} }
@keyframes cb-leg-r { 0%,100%{transform:scaleY(1)} 50%{transform:scaleY(0.8)} }
@keyframes cb-key { 0%{opacity:0} 50%{opacity:1} 100%{opacity:0} }
.cb-wrap { position: relative; display: inline-flex; align-items: center; justify-content: center; }
.cb-layer { position: absolute; inset: 0; display: inline-flex; align-items: center; justify-content: center; }
.cb-motion { display: inline-flex; }
.cb-float { will-change: transform; animation: cb-float 2.5s ease-in-out infinite; }
.cb-bob { will-change: transform; animation: cb-bob 2.5s ease-in-out infinite; }
.cb-breath { will-change: transform, opacity; animation: cb-float 2.5s ease-in-out infinite, cb-breath 2.5s ease-in-out infinite; }
.cb-jump { will-change: transform; transform-origin: 50% 50%; animation: cb-jump 0.45s ease-in-out infinite; }
.cb-stage { position: relative; display: inline-block; line-height: 0; }
.cb-eyes { animation: cb-blink 5s ease-in-out infinite; }
.cb-html-leg { position: absolute; background: ${BODY}; transform-origin: top center; }
.cb-html-leg-l { animation: cb-leg-l 2.5s ease-in-out infinite; }
.cb-html-leg-r { animation: cb-leg-r 2.5s ease-in-out infinite; }
.cb-key-flash { position: absolute; will-change: opacity; animation: cb-key 0.45s step-end infinite; }
`

const FLASH_KEYS: { x: number; alt: string }[] = [
  { x: 6, alt: '#71717a' },
  { x: 30, alt: '#38bdf8' },
  { x: 68, alt: '#71717a' },
  { x: 92, alt: '#38bdf8' },
]

function wrapStyle(size?: number): React.CSSProperties | undefined {
  return size ? { width: size, height: size } : undefined
}

function svgStyle(size?: number): React.CSSProperties | undefined {
  return size ? { width: size - 2, height: size - 2 } : undefined
}

function stageStyle(size?: number): React.CSSProperties {
  const n = size ? size - 2 : 12
  return { width: n, height: n }
}

function legStyle(x: number, size?: number): React.CSSProperties {
  const n = size ? size - 2 : 12
  const scale = n / 116
  const yOffset = (n - 90 * scale) / 2
  return {
    left: (x + 3) * scale,
    top: yOffset + 61 * scale,
    width: 10 * scale,
    height: 22 * scale,
  }
}

function keyStyle(x: number, size?: number): React.CSSProperties {
  const n = size ? size - 2 : 12
  const scale = n / 116
  const yOffset = (n - 90 * scale) / 2
  return {
    left: (x + 3) * scale,
    top: yOffset + 75 * scale,
    width: 18 * scale,
    height: 8 * scale,
    borderRadius: 1.5 * scale,
  }
}

function IdleClaude({ size, background }: { size?: number; background?: boolean }) {
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle(size)}>
      <span className={`cb-motion ${background ? 'cb-breath' : 'cb-float'}`}>
        <span className="cb-stage" style={stageStyle(size)}>
          <svg viewBox="-3 -3 116 90" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
            <g fill={BODY}>
              <rect x="10" y="0" width="90" height="60" />
              <rect x="0" y="20" width="10" height="20" />
              <rect x="100" y="20" width="10" height="20" />
            </g>
            <g className="cb-eyes" fill={EYE}>
              <rect x="20" y="20" width="10" height="10" />
              <rect x="80" y="20" width="10" height="10" />
            </g>
          </svg>
          <span className="cb-html-leg cb-html-leg-l" style={legStyle(10, size)} />
          <span className="cb-html-leg cb-html-leg-l" style={legStyle(30, size)} />
          <span className="cb-html-leg cb-html-leg-r" style={legStyle(70, size)} />
          <span className="cb-html-leg cb-html-leg-r" style={legStyle(90, size)} />
        </span>
      </span>
    </span>
  )
}

function RunningClaude({ size }: { size?: number }) {
  return (
    <span className="cb-wrap w-3.5 h-3.5" style={wrapStyle(size)}>
      <span className="cb-layer">
        <span className="cb-stage" style={stageStyle(size)}>
          <svg viewBox="-3 -3 116 90" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
            <rect x="-8" y="66" width="132" height="20" rx="3" fill="#18181b" stroke="#3f3f46" strokeWidth="2" />
            <rect x="6" y="72" width="18" height="8" rx="1.5" fill="#ff7b47" />
            <rect x="30" y="72" width="18" height="8" rx="1.5" fill="#71717a" />
            <rect x="52" y="72" width="12" height="8" rx="1.5" fill="#71717a" />
            <rect x="68" y="72" width="18" height="8" rx="1.5" fill="#ff7b47" />
            <rect x="92" y="72" width="18" height="8" rx="1.5" fill="#71717a" />
          </svg>
          {FLASH_KEYS.map((k) => (
            <span key={k.x} className="cb-key-flash" style={{ ...keyStyle(k.x, size), background: k.alt }} />
          ))}
        </span>
      </span>
      <span className="cb-layer cb-jump">
        <svg viewBox="-3 -3 116 90" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
          <g transform="translate(8, -2) scale(0.85)">
            <g fill={BODY}>
              <rect x="10" y="0" width="90" height="60" />
              <rect x="0" y="20" width="10" height="20" />
              <rect x="100" y="20" width="10" height="20" />
            </g>
            <g fill={EYE}>
              <rect x="20" y="20" width="10" height="10" />
              <rect x="80" y="20" width="10" height="10" />
            </g>
            <g fill={BODY}>
              <rect x="10" y="58" width="10" height="22" />
              <rect x="30" y="58" width="10" height="22" />
              <rect x="70" y="58" width="10" height="22" />
              <rect x="90" y="58" width="10" height="22" />
            </g>
          </g>
        </svg>
      </span>
    </span>
  )
}

function UnseenClaude({ size }: { size?: number }) {
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle(size)}>
      <span className="cb-motion cb-bob">
        <svg viewBox="-3 -33 116 120" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
          <g>
            <rect x="5" y="-28" width="100" height="78" fill="#fafafa" stroke="#27272a" strokeWidth="2.5" />
            <path d="M 22 0 L 44 28 L 87 -12" fill="none" stroke="#22c55e" strokeWidth="13" strokeLinecap="square" strokeLinejoin="miter" />
          </g>
          <g fill={BODY}>
            <rect x="4" y="35" width="8" height="25" />
            <rect x="98" y="35" width="8" height="25" />
          </g>
          <g fill={BODY}>
            <rect x="0" y="28" width="16" height="10" />
            <rect x="94" y="28" width="16" height="10" />
          </g>
          <g fill={BODY}>
            <rect x="10" y="50" width="90" height="37" />
            <rect x="0" y="64" width="10" height="16" />
            <rect x="100" y="64" width="10" height="16" />
          </g>
          <g className="cb-eyes" fill={EYE}>
            <rect x="20" y="62" width="10" height="10" />
            <rect x="80" y="62" width="10" height="10" />
          </g>
        </svg>
      </span>
    </span>
  )
}

function AutomationClaude({ size }: { size?: number }) {
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle(size)}>
      <span className="cb-motion cb-float">
        <svg viewBox="-3 -3 116 115" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
          <g fill={BODY}>
            <rect x="17" y="0" width="76" height="51" />
            <rect x="9" y="10" width="8" height="17" />
            <rect x="93" y="10" width="8" height="17" />
          </g>
          <g className="cb-eyes" fill={EYE}>
            <rect x="29" y="8" width="9" height="9" />
            <rect x="72" y="8" width="9" height="9" />
          </g>
          <circle cx="55" cy="64" r="46" fill="#ffffff" stroke={BODY} strokeWidth="3" />
          <rect x="51" y="26" width="8" height="38" fill={BODY} />
          <rect x="55" y="60" width="25" height="8" fill={BODY} />
          <circle cx="55" cy="64" r="7" fill={BODY} />
        </svg>
      </span>
    </span>
  )
}

export function ClaudeBenchIcon({ status, size }: SessionIconProps) {
  if (status === 'default') return <IdleClaude size={size} />
  if (status === 'background') return <IdleClaude size={size} background />
  if (status === 'running') return <RunningClaude size={size} />
  if (status === 'unseen') return <UnseenClaude size={size} />
  return <AutomationClaude size={size} />
}
