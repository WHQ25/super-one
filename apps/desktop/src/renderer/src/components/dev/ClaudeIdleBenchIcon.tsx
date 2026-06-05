import React from 'react'

export const CLAUDE_IDLE_BENCH_CSS = `
@keyframes claude-idle-bench-float {
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(2px, -2px); }
  50% { transform: translate(0, 0); }
  75% { transform: translate(-2px, -2px); }
}
@keyframes claude-idle-bench-blink {
  0%, 90%, 100% { opacity: 1; }
  95% { opacity: 0; }
}
@keyframes claude-idle-bench-leg-left {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(1.2); }
}
@keyframes claude-idle-bench-leg-right {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(0.8); }
}
.claude-idle-bench-motion {
  display: inline-flex;
  animation: claude-idle-bench-float 2.5s ease-in-out infinite;
}
.claude-idle-bench-stage {
  position: relative;
  display: inline-block;
  line-height: 0;
}
.claude-idle-bench-eyes {
  animation: claude-idle-bench-blink 5s ease-in-out infinite;
}
.claude-idle-bench-leg {
  position: absolute;
  background: #E07B4A;
  transform-origin: top center;
}
.claude-idle-bench-leg-left {
  animation: claude-idle-bench-leg-left 2.5s ease-in-out infinite;
}
.claude-idle-bench-leg-right {
  animation: claude-idle-bench-leg-right 2.5s ease-in-out infinite;
}
`

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

export function ClaudeIdleBenchIcon({ size }: { size?: number }) {
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle(size)}>
      <span className="claude-idle-bench-motion">
        <span className="claude-idle-bench-stage" style={stageStyle(size)}>
          <svg viewBox="-3 -3 116 90" className="w-3 h-3 overflow-visible" style={svgStyle(size)} aria-hidden>
            <g fill="#E07B4A">
              <rect x="10" y="0" width="90" height="60" />
              <rect x="0" y="20" width="10" height="20" />
              <rect x="100" y="20" width="10" height="20" />
            </g>
            <g className="claude-idle-bench-eyes" fill="#1a1a1a">
              <rect x="20" y="20" width="10" height="10" />
              <rect x="80" y="20" width="10" height="10" />
            </g>
          </svg>
          <span className="claude-idle-bench-leg claude-idle-bench-leg-left" style={legStyle(10, size)} />
          <span className="claude-idle-bench-leg claude-idle-bench-leg-left" style={legStyle(30, size)} />
          <span className="claude-idle-bench-leg claude-idle-bench-leg-right" style={legStyle(70, size)} />
          <span className="claude-idle-bench-leg claude-idle-bench-leg-right" style={legStyle(90, size)} />
        </span>
      </span>
    </span>
  )
}
