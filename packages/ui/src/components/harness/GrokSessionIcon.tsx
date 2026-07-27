import React from 'react'
import type { SessionIconProps } from './ClaudeSessionIcon'

function wrapStyle(size?: number): React.CSSProperties | undefined {
  return size ? { width: size, height: size } : undefined
}

function svgStyle(size?: number): React.CSSProperties | undefined {
  return size ? { width: size - 2, height: size - 2 } : undefined
}

/**
 * Compact Grok/xAI brand mark for ACP sessions whose agent is Grok.
 * Uses near-black by default so the glyph stays visible on light cards
 * (unlike a pure white fill which vanishes on --card).
 */
export function GrokSessionIcon({ status, size }: SessionIconProps) {
  const wrap = wrapStyle(size)
  const svg = svgStyle(size)
  const fill =
    status === 'unseen' ? '#34d399'
      : status === 'running' ? '#0a0a0a'
        : status === 'background' ? '#71717a'
          : status === 'automation' ? '#fbbf24'
            // Default: ink black — xAI-adjacent and readable on light surfaces.
            : '#0a0a0a'

  return (
    <span
      className="inline-flex items-center justify-center w-3.5 h-3.5 dark:invert"
      style={wrap}
      title="Grok"
    >
      <svg viewBox="0 0 24 24" fill="none" style={svg} aria-hidden>
        {/* Stylized Grok star / X mark */}
        <path
          d="M12 2.5 L14.2 9.2 L21.5 9.2 L15.7 13.4 L17.9 20.5 L12 16.1 L6.1 20.5 L8.3 13.4 L2.5 9.2 L9.8 9.2 Z"
          fill={fill}
          opacity={status === 'background' ? 0.55 : 0.95}
        />
      </svg>
    </span>
  )
}
