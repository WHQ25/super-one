import React from 'react'
import type { SessionIconProps } from './ClaudeSessionIcon'
import { HarnessIconFallback, harnessMarkSvgStyle } from './HarnessIconFallback'

/**
 * Generic ACP mark (non-Grok agents). Status chrome is auto-derived via
 * {@link HarnessIconFallback}.
 */
export function AcpSessionIcon({ status, size }: SessionIconProps) {
  const svg = harnessMarkSvgStyle(size)

  return (
    <HarnessIconFallback status={status} size={size} title="ACP">
      <svg viewBox="0 0 24 24" className="w-3 h-3" style={svg} aria-hidden>
        <rect x="3" y="3" width="8" height="8" rx="2" fill="#8b5cf6" opacity={0.9} />
        <rect x="13" y="3" width="8" height="8" rx="2" fill="#8b5cf6" opacity={0.55} />
        <rect x="3" y="13" width="8" height="8" rx="2" fill="#8b5cf6" opacity={0.55} />
        <rect x="13" y="13" width="8" height="8" rx="2" fill="#8b5cf6" opacity={0.35} />
      </svg>
    </HarnessIconFallback>
  )
}
