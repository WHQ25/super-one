import React from 'react'
import { SessionIconProps } from './LegacyClaudeSessionIcon'

export function LegacyCodexSessionIcon({ status, active = false, size }: SessionIconProps) {
  const baseGradId = `codex-base-${status}-${active ? 'act' : 'inact'}`
  const warmGradId = `codex-warm-${status}-${active ? 'act' : 'inact'}`
  const specGradId = `codex-spec-${status}-${active ? 'act' : 'inact'}`

  const isRunning = status === 'running'
  const baseDur = isRunning ? '5.5s' : '7s'
  const baseVals = '0 0;5 4;0 0;-5 -4;0 0'

  const warmDur = isRunning ? '6.5s' : '9s'
  const warmVals = '0 0;-4 -3;0 0;4 3;0 0'

  const specDur = isRunning ? '4s' : '5s'
  const specVals = '0 0;1.5 1;0 0;-1.5 -1;0 0'

  const cloudPath = 'M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388z'

  const wrapStyle = size ? { width: size, height: size } : undefined
  const svgStyle = size ? { width: size - 2, height: size - 2 } : undefined

  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle}>
      <svg
        viewBox="1 1 22 22"
        className="w-3 h-3 overflow-visible"
        style={svgStyle}
      >
        <defs>
          <radialGradient id={baseGradId} cx="8" cy="6" r="22" fx="6" fy="3" gradientUnits="userSpaceOnUse">
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
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              values={baseVals}
              dur={baseDur}
              repeatCount="indefinite"
            />
          </radialGradient>
          <radialGradient id={warmGradId} cx="18" cy="20" r="15" fx="20" fy="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#D14EE8" stopOpacity="0.85" />
            <stop offset="40%" stopColor="#9045D8" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#5530B0" stopOpacity="0" />
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              values={warmVals}
              dur={warmDur}
              repeatCount="indefinite"
            />
          </radialGradient>
          <radialGradient id={specGradId} cx="7" cy="4" r="5" fx="7" fy="3" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
            <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              values={specVals}
              dur={specDur}
              repeatCount="indefinite"
            />
          </radialGradient>

          <style>
            {`
              @keyframes codex-legacy-scale {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.04); }
              }
              @keyframes codex-v6-run-scale {
                0%, 100% { transform: scale(0.96); }
                50% { transform: scale(1.12); }
              }
              @keyframes codex-legacy-cursor-default {
                0%, 48%, 100% { opacity: 1; }
                50%, 98% { opacity: 0; }
              }
              @keyframes codex-legacy-cursor-fast {
                0%, 48%, 100% { opacity: 1; }
                50%, 98% { opacity: 0; }
              }
              @keyframes codex-legacy-bg-breath {
                0%, 100% { opacity: 0.25; }
                50% { opacity: 0.95; }
              }
            `}
          </style>
        </defs>

        {status === 'default' && (
          <g transform="translate(12 12)">
            <g style={{ transformOrigin: 'center center', animation: 'codex-legacy-scale 3.2s ease-in-out infinite' }}>
              <g transform="translate(-12 -12)">
                <path
                  d={cloudPath}
                  fill={`url(#${baseGradId})`}
                />
                <path
                  d={cloudPath}
                  fill={`url(#${warmGradId})`}
                />
                <path
                  d={cloudPath}
                  fill={`url(#${specGradId})`}
                />
                <path
                  d="M8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z"
                  fill="#fff"
                />
                <path
                  d="M12.546 13.909a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636z"
                  fill="#fff"
                  style={{ animation: 'codex-legacy-cursor-default 1.2s step-end infinite' }}
                />
              </g>
            </g>
          </g>
        )}

        {status === 'running' && (
          <>
            <g style={{ transformOrigin: '12px 12px', animation: 'codex-v6-run-scale 1.2s ease-in-out infinite' }}>
              <g>
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 12 12"
                  to="360 12 12"
                  dur="2.4s"
                  repeatCount="indefinite"
                />
                <path d={cloudPath} fill={`url(#${baseGradId})`} />
                <path d={cloudPath} fill={`url(#${warmGradId})`} />
                <path d={cloudPath} fill={`url(#${specGradId})`} />
              </g>
            </g>
            <path
              d="M8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z"
              fill="#fff"
            />
            <path
              d="M12.546 13.909a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636z"
              fill="#fff"
              style={{ animation: 'codex-legacy-cursor-fast 0.4s step-end infinite' }}
            />
          </>
        )}

        {status === 'background' && (
          <g style={{ animation: 'codex-legacy-bg-breath 2.5s ease-in-out infinite' }}>
            <g transform="translate(12 12)">
              <g style={{ transformOrigin: 'center center', animation: 'codex-legacy-scale 3.2s ease-in-out infinite' }}>
                <g transform="translate(-12 -12)">
                  <path
                    d={cloudPath}
                    fill={`url(#${baseGradId})`}
                  />
                  <path
                    d={cloudPath}
                    fill={`url(#${warmGradId})`}
                  />
                  <path
                    d={cloudPath}
                    fill={`url(#${specGradId})`}
                  />
                  <path
                    d="M8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z"
                    fill="#fff"
                  />
                  <path
                    d="M12.546 13.909a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636z"
                    fill="#fff"
                    style={{ animation: 'codex-legacy-cursor-default 1.2s step-end infinite' }}
                  />
                </g>
              </g>
            </g>
          </g>
        )}

        {status === 'unseen' && (
          <g transform="translate(12 12)">
            <g style={{ transformOrigin: 'center center', animation: 'codex-legacy-scale 3.2s ease-in-out infinite' }}>
              <g transform="translate(-12 -12)">
                <path d={cloudPath} fill={`url(#${baseGradId})`} />
                <path d={cloudPath} fill={`url(#${specGradId})`} />
                <path
                  d="M 6.2 12.8 L 10.6 17.0 L 18.0 6.8"
                  fill="none"
                  stroke="#022c1d"
                  strokeWidth="4.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M 6.2 12.8 L 10.6 17.0 L 18.0 6.8"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </g>
          </g>
        )}

        {status === 'automation' && (
          <g transform="translate(12 12)">
            <g style={{ transformOrigin: 'center center', animation: 'codex-legacy-scale 3.2s ease-in-out infinite' }}>
              <g transform="translate(-12 -12)">
                <path d={cloudPath} fill={`url(#${baseGradId})`} />
                <path d={cloudPath} fill={`url(#${warmGradId})`} />
                <path d={cloudPath} fill={`url(#${specGradId})`} />
                <rect x="11.3" y="5.4" width="1.4" height="6.8" fill="#ffffff" />
                <rect x="12" y="11.3" width="4.6" height="1.4" fill="#ffffff" />
                <circle cx="12" cy="12" r="1.0" fill="#ffffff" />
              </g>
            </g>
          </g>
        )}

      </svg>
    </span>
  )
}
