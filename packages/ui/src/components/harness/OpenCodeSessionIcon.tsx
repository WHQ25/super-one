import React from 'react'
import type { SessionIconProps } from './ClaudeSessionIcon'
import { HarnessIconFallback, harnessMarkSvgStyle } from './HarnessIconFallback'

/** Official OpenCode mono mark path (matches @lobehub/icons OpenCode). */
const OPENCODE_MARK = 'M16 6H8v12h8V6zm4 16H4V2h16v20z'

/**
 * Compact OpenCode brand mark. Status chrome is auto-derived via
 * {@link HarnessIconFallback} so every status reuses the same static glyph.
 */
export function OpenCodeSessionIcon({ status, size }: SessionIconProps) {
  const svg = harnessMarkSvgStyle(size)

  return (
    <HarnessIconFallback status={status} size={size} title="OpenCode">
      <svg viewBox="0 0 24 24" className="w-3 h-3 text-foreground" style={svg} aria-hidden>
        <path fill="currentColor" fillRule="evenodd" d={OPENCODE_MARK} />
      </svg>
    </HarnessIconFallback>
  )
}
