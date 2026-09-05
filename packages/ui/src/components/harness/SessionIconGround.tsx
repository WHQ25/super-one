import type { ComponentType } from 'react'
import type { SessionIconProps } from './ClaudeSessionIcon'

/**
 * Wraps a harness session mark in the light-mode dark ground
 * (`.session-icon-ground` in `theme.css`).
 *
 * The mark itself stays transparent — the ground is a sibling layer, not a prop
 * every icon has to thread through its own status branches (Claude alone has
 * five). Call this once per icon at module scope: the returned component must
 * keep a stable identity, or the row holding it remounts the mark — and
 * restarts its animation — on every render.
 */
export function withSessionIconGround(
  Icon: ComponentType<SessionIconProps>,
): ComponentType<SessionIconProps> {
  function Grounded(props: SessionIconProps) {
    return (
      <span className="session-icon-ground">
        <Icon {...props} />
      </span>
    )
  }
  Grounded.displayName = `withSessionIconGround(${Icon.displayName ?? Icon.name ?? 'SessionIcon'})`
  return Grounded
}
