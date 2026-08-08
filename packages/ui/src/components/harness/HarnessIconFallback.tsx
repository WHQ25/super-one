import React from 'react'
import type { SessionIconProps } from './ClaudeSessionIcon'

export interface HarnessIconFallbackProps {
  status: SessionIconProps['status']
  size?: number
  title?: string
  className?: string
  /** Applied to the mark layer only (e.g. `dark:invert` for Grok). */
  markClassName?: string
  children: React.ReactNode
}

function wrapStyle(size?: number): React.CSSProperties | undefined {
  return size ? { width: size, height: size } : undefined
}

/**
 * Auto-derived status chrome around a static harness mark.
 *
 * - default: static
 * - running: scale + opacity pulse
 * - background: opacity breathe
 * - unseen: bottom-right check badge
 * - automation: bottom-right clock badge
 *
 * Custom-animated harnesses (Claude / Codex) keep their own status art;
 * use this for marks that only ship a single static glyph (Grok, OpenCode, ACP).
 */
export function HarnessIconFallback({
  status,
  size,
  title,
  className,
  markClassName,
  children,
}: HarnessIconFallbackProps) {
  const motionClass =
    status === 'running'
      ? 'harness-session-pulse'
      : status === 'background'
        ? 'harness-session-breathe'
        : undefined

  return (
    <span
      className={['harness-session-wrap', 'inline-flex', 'items-center', 'justify-center', 'w-3.5', 'h-3.5', className]
        .filter(Boolean)
        .join(' ')}
      style={wrapStyle(size)}
      title={title}
    >
      <span
        className={['harness-session-mark', motionClass, markClassName].filter(Boolean).join(' ')}
      >
        {children}
      </span>
      {status === 'unseen' ? (
        <span className="harness-session-corner harness-session-corner-check" aria-hidden>
          <svg viewBox="0 0 12 12">
            <path d="M2.5 6.2 L5 8.7 L9.5 3.5" />
          </svg>
        </span>
      ) : null}
      {status === 'automation' ? (
        <span className="harness-session-corner harness-session-corner-clock" aria-hidden>
          <svg viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="4.2" />
            <path d="M6 3.8 V6.2 L7.8 7.4" />
          </svg>
        </span>
      ) : null}
    </span>
  )
}

/** Shared SVG sizing for static marks inside {@link HarnessIconFallback}. */
export function harnessMarkSvgStyle(size?: number): React.CSSProperties | undefined {
  if (!size) return undefined
  const n = Math.max(size - 2, 8)
  return { width: n, height: n }
}
