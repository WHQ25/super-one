import React from 'react'
import { Sparkles } from 'lucide-react'
import type { SessionIconProps } from './ClaudeSessionIcon'
import { HarnessIconFallback, harnessMarkSvgStyle } from './HarnessIconFallback'

/** Compact placeholder mark until the icon set exposes a DeepSeek glyph. */
export function DeepseekSessionIcon({ status, size }: SessionIconProps) {
  const svg = harnessMarkSvgStyle(size)

  return (
    <HarnessIconFallback status={status} size={size} title="DeepSeek">
      {/* TODO: real DeepSeek glyph */}
      <Sparkles className="w-3 h-3 text-foreground" style={svg} aria-hidden />
    </HarnessIconFallback>
  )
}
