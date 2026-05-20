import React from 'react'

export interface SessionIconProps {
  status: 'running' | 'background' | 'unseen' | 'automation' | 'default'
  active?: boolean
  size?: number
}

export function ClaudeSessionIcon({ status, active = false, size }: SessionIconProps) {
  const bodyColor = '#E07B4A'
  const eyeColor = '#1a1a1a'
  const activeEyeColor = active ? '#ffffff' : '#f4f4f5'

  const viewBox =
    status === 'unseen'
      ? '-3 -33 116 120'
      : status === 'automation'
        ? '-3 -3 116 115'
        : '-3 -3 116 90'

  const wrapStyle = size ? { width: size, height: size } : undefined
  const svgStyle = size ? { width: size - 2, height: size - 2 } : undefined

  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle}>
      <svg
        viewBox={viewBox}
        className="w-3 h-3 overflow-visible"
        style={svgStyle}
        shapeRendering="crispEdges"
      >
        <defs>
          <style>
            {`
              @keyframes claude-v5-float {
                0%, 100% { transform: translate(0, 0); }
                25% { transform: translate(2px, -2px); }
                50% { transform: translate(0, 0); }
                75% { transform: translate(-2px, -2px); }
              }
              @keyframes claude-v5-blink {
                0%, 90%, 100% { opacity: 1; }
                95% { opacity: 0; }
              }
              @keyframes claude-v5-run-blink {
                0%, 75%, 100% { opacity: 1; }
                85%, 90% { opacity: 0; }
              }
              @keyframes claude-v5-leg-left {
                0%, 100% { height: 20px; }
                50% { height: 24px; }
              }
              @keyframes claude-v5-leg-right {
                0%, 100% { height: 20px; }
                50% { height: 16px; }
              }
              @keyframes claude-v5-run-left {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.15; }
              }
              @keyframes claude-v5-run-right {
                0%, 100% { opacity: 0.15; }
                50% { opacity: 1; }
              }
              @keyframes claude-v5-typing-jump {
                0%, 100% { transform: translate(0, 0) rotate(0deg); }
                25% { transform: translate(-6px, -22px) rotate(-6deg); }
                50% { transform: translate(0, 0) rotate(0deg); }
                75% { transform: translate(6px, -22px) rotate(6deg); }
              }
              @keyframes claude-v5-key-flash-1 {
                0%, 100% { fill: #ff7b47; }
                50% { fill: #71717a; }
              }
              @keyframes claude-v5-key-flash-2 {
                0%, 100% { fill: #71717a; }
                50% { fill: #38bdf8; }
              }
              @keyframes claude-v5-typing-leg-1 {
                0%, 100% { height: 20px; }
                50% { height: 26px; }
              }
              @keyframes claude-v5-typing-leg-2 {
                0%, 100% { height: 26px; }
                50% { height: 20px; }
              }
              @keyframes claude-v5-run-leg-1 {
                0%, 100% { height: 20px; }
                50% { height: 26px; }
              }
              @keyframes claude-v5-run-leg-2 {
                0%, 100% { height: 26px; }
                50% { height: 20px; }
              }
              @keyframes claude-v5-bg-breath {
                0%, 100% { opacity: 0.25; }
                50% { opacity: 0.95; }
              }
              @keyframes claude-v5-unseen-bob {
                0%, 100% { transform: translate(0, 0); }
                50% { transform: translate(0, -2px); }
              }
            `}
          </style>
        </defs>

        {status === 'default' && (
          <g style={{ transformOrigin: '55px 40px', animation: 'claude-v5-float 2.5s ease-in-out infinite' }}>
            <g fill={bodyColor}>
              <rect x="10" y="0" width="90" height="60" />
              <rect x="0" y="20" width="10" height="20" />
              <rect x="100" y="20" width="10" height="20" />
            </g>
            <g fill={eyeColor} style={{ transformOrigin: '50px 25px', animation: 'claude-v5-blink 4s ease-in-out infinite' }}>
              <rect x="20" y="20" width="10" height="10" />
              <rect x="80" y="20" width="10" height="10" />
            </g>
            <g fill={bodyColor}>
              <rect x="10" y="60" width="10" height="20" style={{ animation: 'claude-v5-leg-left 2.5s ease-in-out infinite' }} />
              <rect x="30" y="60" width="10" height="20" style={{ animation: 'claude-v5-leg-left 2.5s ease-in-out infinite' }} />
              <rect x="70" y="60" width="10" height="20" style={{ animation: 'claude-v5-leg-right 2.5s ease-in-out infinite' }} />
              <rect x="90" y="60" width="10" height="20" style={{ animation: 'claude-v5-leg-right 2.5s ease-in-out infinite' }} />
            </g>
          </g>
        )}

        {status === 'running' && (
          <g>
            <g>
              <rect x="-8" y="66" width="132" height="20" rx="3" fill="#18181b" stroke="#3f3f46" strokeWidth="2" />
              <rect x="6" y="72" width="18" height="8" rx="1.5" style={{ animation: 'claude-v5-key-flash-1 0.45s step-end infinite' }} />
              <rect x="30" y="72" width="18" height="8" rx="1.5" style={{ animation: 'claude-v5-key-flash-2 0.45s step-end infinite' }} />
              <rect x="52" y="72" width="12" height="8" rx="1.5" fill="#71717a" />
              <rect x="68" y="72" width="18" height="8" rx="1.5" style={{ animation: 'claude-v5-key-flash-1 0.45s step-end infinite' }} />
              <rect x="92" y="72" width="18" height="8" rx="1.5" style={{ animation: 'claude-v5-key-flash-2 0.45s step-end infinite' }} />
            </g>
            <g style={{ transformOrigin: '55px 40px', animation: 'claude-v5-typing-jump 0.45s ease-in-out infinite' }}>
              <g transform="translate(8, -2) scale(0.85)">
                <g fill={bodyColor}>
                  <rect x="10" y="0" width="90" height="60" />
                  <rect x="0" y="20" width="10" height="20" />
                  <rect x="100" y="20" width="10" height="20" />
                </g>
                <g fill={eyeColor} style={{ transformOrigin: '50px 25px', animation: 'claude-v5-run-blink 0.8s ease-in-out infinite' }}>
                  <rect x="20" y="20" width="10" height="10" />
                  <rect x="80" y="20" width="10" height="10" />
                </g>
                <g fill={bodyColor}>
                  <rect x="10" y="60" width="10" height="20" style={{ animation: 'claude-v5-typing-leg-1 0.45s ease-in-out infinite' }} />
                  <rect x="30" y="60" width="10" height="20" style={{ animation: 'claude-v5-typing-leg-2 0.45s ease-in-out infinite' }} />
                  <rect x="70" y="60" width="10" height="20" style={{ animation: 'claude-v5-typing-leg-1 0.45s ease-in-out infinite' }} />
                  <rect x="90" y="60" width="10" height="20" style={{ animation: 'claude-v5-typing-leg-2 0.45s ease-in-out infinite' }} />
                </g>
              </g>
            </g>
          </g>
        )}

        {status === 'background' && (
          <g style={{ animation: 'claude-v5-bg-breath 2.5s ease-in-out infinite' }}>
            <g style={{ transformOrigin: '55px 40px', animation: 'claude-v5-float 2.5s ease-in-out infinite' }}>
              <g fill={bodyColor}>
                <rect x="10" y="0" width="90" height="60" />
                <rect x="0" y="20" width="10" height="20" />
                <rect x="100" y="20" width="10" height="20" />
              </g>
              <g fill={eyeColor} style={{ transformOrigin: '50px 25px', animation: 'claude-v5-blink 4s ease-in-out infinite' }}>
                <rect x="20" y="20" width="10" height="10" />
                <rect x="80" y="20" width="10" height="10" />
              </g>
              <g fill={bodyColor}>
                <rect x="10" y="60" width="10" height="20" style={{ animation: 'claude-v5-leg-left 2.5s ease-in-out infinite' }} />
                <rect x="30" y="60" width="10" height="20" style={{ animation: 'claude-v5-leg-left 2.5s ease-in-out infinite' }} />
                <rect x="70" y="60" width="10" height="20" style={{ animation: 'claude-v5-leg-right 2.5s ease-in-out infinite' }} />
                <rect x="90" y="60" width="10" height="20" style={{ animation: 'claude-v5-leg-right 2.5s ease-in-out infinite' }} />
              </g>
            </g>
          </g>
        )}

        {status === 'unseen' && (
          <g style={{ animation: 'claude-v5-unseen-bob 2.4s ease-in-out infinite' }}>
            <g>
              <rect x="5" y="-28" width="100" height="78" fill="#fafafa" stroke="#27272a" strokeWidth="2.5" />
              <path d="M 22 0 L 44 28 L 87 -12" fill="none" stroke="#22c55e" strokeWidth="13" strokeLinecap="square" strokeLinejoin="miter" />
            </g>
            <g fill={bodyColor}>
              <rect x="4" y="35" width="8" height="25" />
              <rect x="98" y="35" width="8" height="25" />
            </g>
            <g fill={bodyColor}>
              <rect x="0" y="28" width="16" height="10" />
              <rect x="94" y="28" width="16" height="10" />
            </g>
            <g fill={bodyColor}>
              <rect x="10" y="50" width="90" height="37" />
              <rect x="0" y="64" width="10" height="16" />
              <rect x="100" y="64" width="10" height="16" />
            </g>
            <g fill={eyeColor} style={{ animation: 'claude-v5-blink 4s ease-in-out infinite' }}>
              <rect x="20" y="62" width="10" height="10" />
              <rect x="80" y="62" width="10" height="10" />
            </g>
          </g>
        )}

        {status === 'automation' && (
          <g style={{ animation: 'claude-v5-float 2.5s ease-in-out infinite' }}>
            <g fill={bodyColor}>
              <rect x="17" y="0" width="76" height="51" />
              <rect x="9" y="10" width="8" height="17" />
              <rect x="93" y="10" width="8" height="17" />
            </g>
            <g fill={eyeColor} style={{ animation: 'claude-v5-blink 4s ease-in-out infinite' }}>
              <rect x="29" y="8" width="9" height="9" />
              <rect x="72" y="8" width="9" height="9" />
            </g>
            <circle cx="55" cy="64" r="46" fill="#ffffff" stroke={bodyColor} strokeWidth="3" />
            <rect x="51" y="26" width="8" height="38" fill={bodyColor} />
            <rect x="55" y="60" width="25" height="8" fill={bodyColor} />
            <circle cx="55" cy="64" r="7" fill={bodyColor} />
          </g>
        )}

      </svg>
    </span>
  )
}
