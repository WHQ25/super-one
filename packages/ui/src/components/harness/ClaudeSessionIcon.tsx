import React from 'react'

const DEBUG_SOLID_BLOCK: boolean = false

export type SessionIconRenderLevel = 'compact' | 'rich'

export interface SessionIconProps {
  status: 'running' | 'background' | 'unseen' | 'automation' | 'default'
  active?: boolean
  size?: number
  renderLevel?: SessionIconRenderLevel
}

const BODY_COLOR = '#E07B4A'
const EYE_COLOR = '#1a1a1a'
const BODY_PATH = 'M10 0H100V20H110V40H100V60H10V40H0V20H10Z'

const FLASH_KEYS: { x: number; alt: string }[] = [
  { x: 6, alt: '#71717a' },
  { x: 30, alt: '#38bdf8' },
  { x: 68, alt: '#71717a' },
  { x: 92, alt: '#38bdf8' },
]

function iconWrapStyle(size?: number): React.CSSProperties | undefined {
  return size ? { width: size, height: size } : undefined
}

function iconSvgStyle(size?: number): React.CSSProperties | undefined {
  return size ? { width: size - 2, height: size - 2 } : undefined
}

function idleStageStyle(size?: number): React.CSSProperties {
  const n = size ? size - 2 : 12
  return { width: n, height: n }
}

function idleLegStyle(x: number, size?: number): React.CSSProperties {
  const n = size ? size - 2 : 12
  const scale = n / 116
  const yOffset = (n - 90 * scale) / 2
  return {
    left: (x + 3) * scale,
    top: yOffset + 59 * scale,
    width: 10 * scale,
    height: 24 * scale,
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

function idleLegClass(side: 'left' | 'right', renderLevel: SessionIconRenderLevel): string {
  return `claude-session-idle-leg${renderLevel === 'rich' ? ` claude-session-idle-leg-${side}` : ''}`
}

/** Resting states (`default`/`automation`) drop the continuous float at `compact`
 *  — their motion is decorative, and a sidebar renders many of them at once. The
 *  eye blink is sparse-keyframed, so it stays on at every level. */
function idleMotionClass(renderLevel: SessionIconRenderLevel): string {
  return renderLevel === 'rich' ? 'claude-session-idle-motion' : 'claude-session-inline'
}

export function ClaudeSessionIcon({ status, size, renderLevel = 'rich' }: SessionIconProps) {
  const wrapStyle = iconWrapStyle(size)
  const svgStyle = iconSvgStyle(size)

  if (DEBUG_SOLID_BLOCK) {
    return (
      <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle}>
        <span style={{ ...svgStyle, width: svgStyle?.width ?? 12, height: svgStyle?.height ?? 12, background: BODY_COLOR }} />
      </span>
    )
  }

  if (status === 'default' || status === 'background') {
    return (
      <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle}>
        <span className={status === 'background' ? 'claude-session-bg-motion' : idleMotionClass(renderLevel)}>
          <span className="claude-session-idle-stage" style={idleStageStyle(size)}>
            <svg viewBox="-3 -3 116 90" className="w-3 h-3 overflow-visible" style={svgStyle} aria-hidden>
              <path d={BODY_PATH} fill={BODY_COLOR} />
              <g className="claude-session-idle-eyes" fill={EYE_COLOR}>
                <rect x="20" y="20" width="10" height="10" />
                <rect x="80" y="20" width="10" height="10" />
              </g>
            </svg>
            <span className={idleLegClass('left', renderLevel)} style={idleLegStyle(10, size)} />
            <span className={idleLegClass('left', renderLevel)} style={idleLegStyle(30, size)} />
            <span className={idleLegClass('right', renderLevel)} style={idleLegStyle(70, size)} />
            <span className={idleLegClass('right', renderLevel)} style={idleLegStyle(90, size)} />
          </span>
        </span>
      </span>
    )
  }

  if (status === 'running') {
    return (
      <span className="claude-session-wrap w-3.5 h-3.5" style={wrapStyle}>
        <span className="claude-session-layer">
          <span className="claude-session-idle-stage" style={idleStageStyle(size)}>
            <svg viewBox="-3 -3 116 90" className="w-3 h-3 overflow-visible" style={svgStyle} aria-hidden>
              <rect x="-8" y="66" width="132" height="20" rx="3" fill="#18181b" stroke="#3f3f46" strokeWidth="2" />
              <rect x="6" y="72" width="18" height="8" rx="1.5" fill="#ff7b47" />
              <rect x="30" y="72" width="18" height="8" rx="1.5" fill="#71717a" />
              <rect x="52" y="72" width="12" height="8" rx="1.5" fill="#71717a" />
              <rect x="68" y="72" width="18" height="8" rx="1.5" fill="#ff7b47" />
              <rect x="92" y="72" width="18" height="8" rx="1.5" fill="#71717a" />
            </svg>
            {FLASH_KEYS.map((k) => (
              <span key={k.x} className="claude-session-key" style={{ ...keyStyle(k.x, size), background: k.alt }} />
            ))}
          </span>
        </span>
        <span className="claude-session-layer claude-session-jump">
          <svg viewBox="-3 -3 116 90" className="w-3 h-3 overflow-visible" style={svgStyle} aria-hidden>
            <g transform="translate(8, -2) scale(0.85)">
              <path d={BODY_PATH} fill={BODY_COLOR} />
              <g fill={EYE_COLOR}>
                <rect x="20" y="20" width="10" height="10" />
                <rect x="80" y="20" width="10" height="10" />
              </g>
              <g fill={BODY_COLOR}>
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

  if (status === 'unseen') {
    return (
      <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle}>
        <span className="claude-session-bob-motion">
          <svg viewBox="-3 -33 116 120" className="w-3 h-3 overflow-visible" style={svgStyle} aria-hidden>
            <g>
              <rect x="5" y="-28" width="100" height="78" fill="#fafafa" stroke="#27272a" strokeWidth="2.5" />
              <path d="M 22 0 L 44 28 L 87 -12" fill="none" stroke="#22c55e" strokeWidth="13" strokeLinecap="square" strokeLinejoin="miter" />
            </g>
            <g fill={BODY_COLOR}>
              <rect x="4" y="35" width="8" height="25" />
              <rect x="98" y="35" width="8" height="25" />
            </g>
            <g fill={BODY_COLOR}>
              <rect x="0" y="28" width="16" height="10" />
              <rect x="94" y="28" width="16" height="10" />
            </g>
            <g fill={BODY_COLOR}>
              <rect x="10" y="50" width="90" height="37" />
              <rect x="0" y="64" width="10" height="16" />
              <rect x="100" y="64" width="10" height="16" />
            </g>
            <g className="claude-session-idle-eyes" fill={EYE_COLOR}>
              <rect x="20" y="62" width="10" height="10" />
              <rect x="80" y="62" width="10" height="10" />
            </g>
          </svg>
        </span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle}>
      <span className={idleMotionClass(renderLevel)}>
        <svg viewBox="-3 -3 116 115" className="w-3 h-3 overflow-visible" style={svgStyle} aria-hidden>
          <g fill={BODY_COLOR}>
            <rect x="17" y="0" width="76" height="51" />
            <rect x="9" y="10" width="8" height="17" />
            <rect x="93" y="10" width="8" height="17" />
          </g>
          <g className="claude-session-idle-eyes" fill={EYE_COLOR}>
            <rect x="29" y="8" width="9" height="9" />
            <rect x="72" y="8" width="9" height="9" />
          </g>
          <circle cx="55" cy="64" r="46" fill="#ffffff" stroke={BODY_COLOR} strokeWidth="3" />
          <rect x="51" y="26" width="8" height="38" fill={BODY_COLOR} />
          <rect x="55" y="60" width="25" height="8" fill={BODY_COLOR} />
          <circle cx="55" cy="64" r="7" fill={BODY_COLOR} />
        </svg>
      </span>
    </span>
  )
}
