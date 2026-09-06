import React from 'react'
import DeepSeekColor from '@lobehub/icons/es/DeepSeek/components/Color'
import type { SessionIconProps } from './ClaudeSessionIcon'
import { HarnessIconFallback, harnessMarkSvgStyle } from './HarnessIconFallback'

/** Compact official DeepSeek color mark with shared session status chrome. */
export function DeepseekSessionIcon({ status, size }: SessionIconProps) {
  const svg = harnessMarkSvgStyle(size)

  return (
    <HarnessIconFallback status={status} size={size} title="DeepSeek">
      <DeepSeekColor className="w-3 h-3" style={svg} aria-hidden />
    </HarnessIconFallback>
  )
}
