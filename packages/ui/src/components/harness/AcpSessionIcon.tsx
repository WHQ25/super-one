import React from 'react'
import type { SessionIconProps } from './ClaudeSessionIcon'

function wrapStyle(size?: number): React.CSSProperties | undefined {
  return size ? { width: size, height: size } : undefined
}

function svgStyle(size?: number): React.CSSProperties | undefined {
  return size ? { width: size - 2, height: size - 2 } : undefined
}

export function AcpSessionIcon({ status, size }: SessionIconProps) {
  const wrap = wrapStyle(size)
  const svg = svgStyle(size)
  const fill = status === 'unseen' ? '#34d399' : status === 'running' ? '#a78bfa' : '#8b5cf6'

  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrap}>
      <svg viewBox="0 0 24 24" fill="none" style={svg} aria-hidden>
        <rect x="3" y="3" width="8" height="8" rx="2" fill={fill} opacity={0.9} />
        <rect x="13" y="3" width="8" height="8" rx="2" fill={fill} opacity={0.55} />
        <rect x="3" y="13" width="8" height="8" rx="2" fill={fill} opacity={0.55} />
        <rect x="13" y="13" width="8" height="8" rx="2" fill={fill} opacity={0.35} />
      </svg>
    </span>
  )
}
