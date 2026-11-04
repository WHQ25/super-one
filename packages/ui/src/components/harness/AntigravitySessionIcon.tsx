import React from 'react'
import AntigravityColor from '@lobehub/icons/es/Antigravity/components/Color'
import type { SessionIconProps } from './ClaudeSessionIcon'
import { HarnessIconFallback, harnessMarkSvgStyle } from './HarnessIconFallback'

export function AntigravitySessionIcon({ status, size }: SessionIconProps) {
  const svg = harnessMarkSvgStyle(size)

  return (
    <HarnessIconFallback status={status} size={size} title="Antigravity">
      <AntigravityColor className="w-3 h-3" style={svg} aria-hidden />
    </HarnessIconFallback>
  )
}
