import type { ReactNode } from 'react'
import { Bot, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import { useAppStore } from '@/stores/app'
import { HarnessPermissionPopover } from './HarnessPermissionPopover'
import { harnessSupportsSandbox, harnessSandboxModes, harnessSandboxSupportLevel, coerceSandboxModeForHarness, SandboxModePopover } from './SandboxModeSelector'
import { SELECTOR_TRIGGER_CLASS } from './model-selector/GroupedModelEffortSelector'

/** Idle harness glyph, brand-aware for ACP agents (e.g. Grok → acp-grok icon). */
export function HarnessGlyph({
  profile,
  launch,
}: {
  profile: SessionAgentProfile | undefined
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
 * caller passes (agent, model), then its permission mode and, where the
 * harness has one, its sandbox.
 */
export function LaunchSettingsBar({
  harnessId,
  settings,
  onChange,
  className,
  children,
}: {
  harnessId: HarnessId
  settings: Pick<SessionAgentLaunchSettings, 'permissionMode' | 'sandboxMode'>
  onChange: (patch: SessionAgentLaunchSettings) => void
  className?: string
  children: ReactNode
}) {
  const sandboxCapability = useAppStore((state) => state.sandboxCapability)
  return (
    <div className={cn('@container/launch flex min-w-0 shrink-0 flex-wrap items-center gap-1 rounded-md border border-border bg-muted/20 px-1 py-0.5', className)}>
      {children}
      <LaunchBarDivider />
      <HarnessPermissionPopover
        harnessId={harnessId}
        value={settings.permissionMode}
        onChange={(permissionMode: PermissionMode) => onChange({ permissionMode })}
        labelClassName={ICON_ONLY}
      />
      {harnessSupportsSandbox(harnessId) && (
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
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {profiles.map((profile) => (
            <DropdownMenuRadioItem key={profile.id} value={profile.id} className="gap-2 text-xs">
              <HarnessGlyph profile={profile} />
              <span className="min-w-0 truncate">{profile.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
