import { useMemo } from 'react'
import { ModSite, sessionModeProps } from '@superone/chat-view/mod-ui'
import { MOD_SESSION_MODE_INSTANCE } from '@superone/shared/mod-ui'

const NO_MODES: string[] = []

function modeLabels(props: Record<string, unknown>): string[] {
  return Array.isArray(props.modes) ? props.modes.filter((m): m is string => typeof m === 'string') : NO_MODES
}

/**
 * The terminal footer's session-state labels ("memory paused", "account
 * memory: off") as a mod site, beside the composer's context ring. SuperOne
 * has no such state, so it lists none and draws nothing unless a mod hooks
 * the site.
 */
export function ModSessionMode() {
  const props = useMemo(() => sessionModeProps(NO_MODES), [])
  // Capped so a mod's tree cannot crowd the send button; empty, it takes no room or gap.
  return (
    <div className="max-w-48 min-w-0 truncate text-xs text-muted-foreground empty:hidden">
      <ModSite component="SessionMode" instanceId={MOD_SESSION_MODE_INSTANCE} props={props}>
        {(p) => {
          const modes = modeLabels(p)
          return modes.length > 0 ? modes.join(' & ') : null
        }}
      </ModSite>
    </div>
  )
}
