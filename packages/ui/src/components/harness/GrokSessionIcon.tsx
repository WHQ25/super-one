import React from 'react'
import type { SessionIconProps } from './ClaudeSessionIcon'
import { HarnessIconFallback, harnessMarkSvgStyle } from './HarnessIconFallback'

/** Official Grok mono mark path (matches @lobehub/icons Grok). */
const GROK_MARK =
  'M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815'

/**
 * Compact Grok/xAI brand mark for ACP sessions whose agent is Grok.
 *
 * Status chrome comes from {@link HarnessIconFallback}. The mark tracks
 * `--foreground` rather than carrying its own ink, the way Cursor and OpenCode
 * do. It used to be a hardcoded `#0a0a0a` plus `dark:invert`, which assumed
 * light mode means a light surface — but the light-mode sidebar is a DARK
 * island (`--sidebar` at L 0.26), so the mark landed near-black on near-black at
 * 1.27:1 on every resting row. `currentColor` inherits the sidebar scope's
 * remap of `--foreground` to `--sidebar-foreground`, and the plain light ink
 * everywhere else, so both surfaces are right with no variant to maintain.
 */
export function GrokSessionIcon({ status, size }: SessionIconProps) {
  const svg = harnessMarkSvgStyle(size)

  return (
    <HarnessIconFallback status={status} size={size} title="Grok">
      <svg viewBox="0 0 24 24" className="w-3 h-3 text-foreground" style={svg} aria-hidden>
        <path fill="currentColor" fillRule="evenodd" d={GROK_MARK} />
      </svg>
    </HarnessIconFallback>
  )
}
