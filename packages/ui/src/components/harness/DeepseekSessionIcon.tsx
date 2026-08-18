import React from 'react'
import { DeepSeek } from '@lobehub/icons'
import type { SessionIconProps } from './ClaudeSessionIcon'
import { HarnessIconFallback, harnessMarkSvgStyle } from './HarnessIconFallback'

/** Compact official DeepSeek color mark with shared session status chrome. */
export function DeepseekSessionIcon({ status, size }: SessionIconProps) {
  const svg = harnessMarkSvgStyle(size)

  return (
    <HarnessIconFallback status={status} size={size} title="DeepSeek">
      <DeepSeek.Color className="w-3 h-3" style={svg} aria-hidden />
    </HarnessIconFallback>
  )
}
