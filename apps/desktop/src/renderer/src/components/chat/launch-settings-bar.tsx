import type { ReactNode } from 'react'
import { Bot, Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { cn } from '@superone/ui/lib/utils'
import type {
  HarnessId,
  PermissionMode,
  SandboxMode,
  SessionAgentLaunchProposal,
  SessionAgentLaunchSettings,
  SessionAgentProfile,
} from '@superone/shared/agent-types'
import { resolveSessionIcon, resolveSessionIconFromBrandKey } from '@/components/harness/resolve-session-icon'
import { HARNESS_CONTROLS } from '@/harness-ui/controls'
import { useAppStore } from '@/stores/app'
import { HarnessPermissionPopover } from './HarnessPermissionPopover'
import { harnessSupportsSandbox, harnessSandboxModes, harnessSandboxSupportLevel, coerceSandboxModeForHarness, SandboxModePopover } from './SandboxModeSelector'
import { SELECTOR_TRIGGER_CLASS } from './model-selector/GroupedModelEffortSelector'

/** Idle harness glyph, brand-aware for ACP agents (e.g. Grok → acp-grok icon). */
export function HarnessGlyph({
  profile,
  launch,
}: {
  profile: Pick<SessionAgentProfile, 'harnessId' | 'acpAgentId' | 'brandKey'> | undefined
  /** Link launches have no agent profile — use peer harness fields instead. */
  launch?: SessionAgentLaunchProposal
}) {
  const Icon = resolveSessionIconFromBrandKey(profile?.brandKey ?? launch?.peerBrandKey)
    ?? resolveSessionIcon(
      profile?.harnessId ?? launch?.peerHarnessId,
      profile?.acpAgentId ?? launch?.peerAcpAgentId,
    )
  return (
    <span className="flex size-3 shrink-0 items-center justify-center">
      {Icon
        ? <Icon status="default" renderLevel="compact" />
        : <Bot className="size-3 text-muted-foreground" />}
    </span>
  )
}

export function LaunchBarDivider() {
  return <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border" />
}

/** Below this bar width, permission and sandbox show their icons only (the label stays as the tooltip). */
const ICON_ONLY = '@max-[26rem]/launch:hidden'

/**
 * How a session that does not exist yet will run: the leading controls the
 * caller passes (agent, model), then its permission mode where the harness has
 * modes and, where it has one and the caller can carry it, its sandbox.
 */
export function LaunchSettingsBar({
  harnessId,
  settings,
  onChange,
  offerSandbox = true,
  className,
  children,
}: {
  harnessId: HarnessId
  settings: Pick<SessionAgentLaunchSettings, 'permissionMode' | 'sandboxMode'>
  onChange: (patch: SessionAgentLaunchSettings) => void
  /** False when what the bar configures has no sandbox setting (an agent profile). */
  offerSandbox?: boolean
  className?: string
  children: ReactNode
}) {
  const sandboxCapability = useAppStore((state) => state.sandboxCapability)
  return (
    <div className={cn('@container/launch flex min-w-0 shrink-0 flex-wrap items-center gap-1 rounded-md border border-border bg-muted/20 px-1 py-0.5', className)}>
      {children}
      {HARNESS_CONTROLS[harnessId].launchPermission && (
        <>
          <LaunchBarDivider />
          <HarnessPermissionPopover
            harnessId={harnessId}
            value={settings.permissionMode}
            onChange={(permissionMode: PermissionMode) => onChange({ permissionMode })}
            labelClassName={ICON_ONLY}
          />
        </>
      )}
      {offerSandbox && harnessSupportsSandbox(harnessId) && (
        <>
          <LaunchBarDivider />
          <SandboxModePopover
            value={coerceSandboxModeForHarness(harnessId, settings.sandboxMode ?? 'off')}
            onValueChange={(sandboxMode: SandboxMode) => onChange({ sandboxMode })}
            supportLevel={harnessSandboxSupportLevel(harnessId, sandboxCapability?.supportLevel ?? 'always')}
            availableModes={harnessSandboxModes(harnessId)}
            labelClassName={ICON_ONLY}
          />
        </>
      )}
    </div>
  )
}

/** Which agent a new session runs on. */
export function LaunchAgentPicker({
  profiles,
  value,
  onChange,
}: {
  profiles: SessionAgentProfile[]
  value: string
  onChange: (agentId: string) => void
}) {
  const { t } = useTranslation()
  const selected = profiles.find((profile) => profile.id === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={SELECTOR_TRIGGER_CLASS}
          aria-label={t('chat.toolBlock.suggestedTask.agent')}
          title={selected?.name}
        >
          <HarnessGlyph profile={selected} />
          <span className="min-w-0 truncate">{selected?.name ?? value}</span>
          <ChevronDown className="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="max-h-[60vh] min-w-44 overflow-y-auto">
        {profiles.map((profile) => (
          <DropdownMenuItem
            key={profile.id}
            role="menuitemradio"
            aria-checked={profile.id === value}
            onSelect={() => onChange(profile.id)}
            className="gap-2 text-xs"
          >
            <HarnessGlyph profile={profile} />
            <span className="min-w-0 flex-1 truncate">{profile.name}</span>
            {profile.id === value && <Check className="text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
