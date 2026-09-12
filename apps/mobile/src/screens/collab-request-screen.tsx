import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Bot, ChevronDown, ChevronRight, FileText, FolderClosed, GitBranch, MessageSquare, Monitor, type LucideIcon } from 'lucide-react-native'
import type {
  HarnessId, ModelOption, RemoteProviderOption, SandboxMode, SessionAgentLaunchProposal, SessionAgentProfile, SessionAgentRequestPayload,
} from '@superone/shared/agent-types'
import {
  buildLaunchTabLabels,
  isHandoffLaunch,
  isLinkLaunch,
  launchNameRoleLine,
  launchWorkDir,
  pathBasename,
  peerSessionTitle,
  shortSessionId,
  type LaunchWorkDir,
} from '@superone/shared/collab-request-display'
import { findCodexFastServiceTier } from '@superone/shared/codex-fast-mode'
import { formatEffortLabel } from '@superone/shared/effort-labels'
import { sandboxInfoFromMode } from '@superone/shared/harness/harness-sandbox'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import { Text } from '../ui/text'
import { HarnessIcon } from '../ui/harness-icon'
import { ModelPicker } from '../ui/model-picker'
import { PermissionModeSelector } from '../ui/permission-mode-selector'
import { SandboxSelector } from '../ui/sandbox-selector'
import { SCROLL_INDICATOR_GUTTER } from '../ui/scroll-gutter'
import { optionParamsForModel } from '../model-picker-state'
import { PromptActions } from '../prompts/PromptControls'
import { patchLaunch } from '../prompts/permission-edit-state'
import { usePromptStyles } from '../prompts/styles'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'

export type CollabRequestScreenProps = {
  payload: SessionAgentRequestPayload
  /** Launches with the user's tuning applied — the same shape the desktop hands back. */
  onApprove: (launches: SessionAgentLaunchProposal[]) => void
  /** The feedback is handed back to the agent as the tool result. */
  onReject: (feedback?: string) => void
  /** The full brief opens on its own page; it is fetched there, not carried here. */
  onOpenTask: (launch: SessionAgentLaunchProposal, label: string) => void
}

type EditableConfig = Parameters<typeof patchLaunch>[1]

function isHarnessId(value: string | undefined): value is HarnessId {
  return !!value && value in HARNESS_LAUNCH_OPTIONS
}

/** Same wording the desktop status bar uses for a pending worktree. */
function workDirLabel(state: LaunchWorkDir, t: (source: string) => string): { icon: LucideIcon; label: string } {
  switch (state.kind) {
    case 'createFrom': return { icon: GitBranch, label: `${t('Create worktree from')} ${state.base}` }
    case 'attachTo': return { icon: GitBranch, label: `${t('Attach worktree to')} ${state.base}` }
    case 'createBranch': return { icon: GitBranch, label: `${t('Create worktree branch')} ${state.name || '…'}` }
    case 'local': return { icon: Monitor, label: t('Local') }
  }
}

/**
 * The page a collaboration request opens into on the phone — the desktop's
 * `SessionAgentsConfirmPrompt` laid out for a narrow column. Its tab strip
 * becomes a list where each agent expands on its own, so several configs can be
 * compared without switching. The editable run tuning is the chat status row's
 * own chips (model / effort, permission mode, sandbox) on one line, because a
 * launch is configured with exactly the vocabulary the composer already uses.
 * Feedback and the decision sit under the list, pinned, like the sheet's footer.
 */
export function CollabRequestScreen({ payload, onApprove, onReject, onOpenTask }: CollabRequestScreenProps) {
  const { tokens: { colors, spacing } } = useMobileTheme()
  const { t } = useMobileLocale()
  const { launches, profiles } = payload
  const labels = useMemo(() => buildLaunchTabLabels(launches, profiles), [launches, profiles])
  const [overrides, setOverrides] = useState<Record<string, EditableConfig>>({})
  // Each card opens independently; the first starts open so a single request reads
  // as one card, not a list of one closed row.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(launches[0] ? [launches[0].launchId] : []))
  const [feedback, setFeedback] = useState('')

  // Desktop precedence: profile defaults, then the agent's proposal, then the user's edits.
  const resolved = useMemo(
    () => launches.map((launch) => {
      const profile = profiles.find((item) => item.id === launch.agentId)
      return { ...launch, config: { ...profile?.defaultConfig, ...launch.config, ...overrides[launch.launchId] } }
    }),
    [launches, overrides, profiles],
  )

  const toggle = (launchId: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(launchId)) next.delete(launchId)
    else next.add(launchId)
    return next
  })

  return <View style={{ flex: 1 }}>
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, paddingRight: SCROLL_INDICATOR_GUTTER, gap: spacing.sm }}>
      {resolved.map((launch, index) => (
        <LaunchCard
          key={launch.launchId}
          launch={launch}
          label={labels[index]!}
          profile={profiles.find((item) => item.id === launch.agentId)}
          expanded={expanded.has(launch.launchId)}
          onToggle={() => toggle(launch.launchId)}
          onOpenTask={() => onOpenTask(launch, labels[index]!)}
          onChange={(patch) => setOverrides((current) => ({
            ...current,
            [launch.launchId]: { ...current[launch.launchId], ...patch },
          }))}
        />
      ))}
    </ScrollView>
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md }}>
      <PromptActions
        approveLabel={t('Approve')}
        rejectLabel={t(feedback.trim() ? 'Reject with feedback' : 'Reject')}
        onApprove={() => onApprove(resolved)}
        onReject={() => onReject(feedback.trim() || undefined)}
        feedback={{ value: feedback, onChange: setFeedback }}
      />
    </View>
  </View>
}

function LaunchCard({ launch, label, profile, expanded, onToggle, onOpenTask, onChange }: {
  launch: SessionAgentLaunchProposal
  label: string
  profile: SessionAgentProfile | undefined
  expanded: boolean
  onToggle: () => void
  onOpenTask: () => void
  onChange: (patch: EditableConfig) => void
}) {
  const styles = usePromptStyles()
  const { tokens: { colors, spacing } } = useMobileTheme()
  const { t } = useMobileLocale()
  const link = isLinkLaunch(launch)
  const handoff = isHandoffLaunch(launch)
  const harnessId = profile?.harnessId ?? (isHarnessId(launch.peerHarnessId) ? launch.peerHarnessId : null)
  const summary = launch.summary?.trim() || launch.task
  const hasTask = Boolean(launch.taskDeferred || launch.task?.trim())
  const Chevron = expanded ? ChevronDown : ChevronRight
  const headline = link
    ? { prefix: t('Work with'), text: peerSessionTitle(launch) }
    : { prefix: handoff ? t('Hand off to') : null, text: launchNameRoleLine(launch) }

  return <View style={[styles.card, { gap: 0, padding: 0 }]}>
    <Pressable
      testID={`collab-launch-${launch.launchId}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={label}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, { padding: spacing.md, minHeight: 56 }, pressed && styles.pressed]}
    >
      {harnessId
        ? <HarnessIcon provider={harnessId} acpAgentId={profile?.acpAgentId ?? launch.peerAcpAgentId} size={20} />
        : <Bot size={20} color={colors.mutedForeground} />}
      <View style={styles.grow}>
        <Text numberOfLines={1} style={styles.title}>{label}</Text>
        <Text numberOfLines={1} style={styles.meta}>
          {headline.prefix ? <Text style={styles.meta}>{headline.prefix}: </Text> : null}
          <Text style={[styles.meta, { color: colors.foreground }]}>{headline.text}</Text>
        </Text>
      </View>
      <Chevron size={16} color={colors.mutedForeground} />
    </Pressable>

    {expanded ? <View style={[styles.tight, { paddingHorizontal: spacing.md, paddingBottom: spacing.md }]}>
      <Text selectable style={styles.body}>{summary}</Text>
      {hasTask ? <Pressable
        accessibilityRole="button"
        onPress={onOpenTask}
        style={({ pressed }) => [styles.row, { minHeight: 32 }, pressed && styles.pressed]}
      >
        <FileText size={14} color={colors.mutedForeground} />
        <Text style={[styles.meta, styles.grow]}>{t('Show the full task')}</Text>
        <ChevronRight size={14} color={colors.mutedForeground} />
      </Pressable> : null}
      {handoff ? <Text style={styles.meta}>{t('Takes the task over in its own top-level session — no replies back to this one.')}</Text> : null}
      {link ? <LinkMeta launch={launch} /> : <SpawnMeta launch={launch} />}
      {!link && profile ? <LaunchConfigRow launch={launch} profile={profile} onChange={onChange} /> : null}
    </View> : null}
  </View>
}

/**
 * The composer status row's own chips, wired to the launch instead of a session.
 * What the user may retune is exactly what the desktop lets through: model,
 * effort, AI provider, Fast, permission mode and sandbox.
 */
function LaunchConfigRow({ launch, profile, onChange }: {
  launch: SessionAgentLaunchProposal
  profile: SessionAgentProfile
  onChange: (patch: EditableConfig) => void
}) {
  const { t } = useMobileLocale()
  const { tokens: { colors, spacing } } = useMobileTheme()
  const harness = profile.harnessId
  const { config } = launch
  // The profile's catalog is the same shape minus a required description.
  const models: ModelOption[] = useMemo(
    () => profile.models.map((item) => ({ ...item, description: item.description ?? '' })),
    [profile.models],
  )
  const model = models.find((item) => item.id === config.model)
  const fast = findCodexFastServiceTier(model)
  // Effort is hidden for a mapped provider — the desktop rule.
  const efforts = config.apiProviderId ? [] : profile.efforts.map((value) => ({ value, label: formatEffortLabel(value) }))
  const providers: RemoteProviderOption[] = profile.apiProviders.length
    ? [
      { id: null, name: t('Default provider'), brand: harness === 'codex' ? 'openai' : 'claude' },
      ...profile.apiProviders.map((provider) => ({
        id: provider.id, name: provider.name, brand: provider.brand ?? null, keyName: provider.keyName, modelEnv: provider.modelEnv,
      })),
    ]
    : []
  const permissionMode = config.permissionMode ?? HARNESS_LAUNCH_OPTIONS[harness].permissionModes[0]!
  return <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs,
    marginTop: spacing.xs, paddingVertical: 2, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
    <ModelPicker compact harness={harness}
      models={models} model={config.model ?? ''} onModel={(next) => onChange({ model: next, fastMode: false })}
      efforts={efforts} effort={config.effort ?? ''} onEffort={(effort) => onChange({ effort })}
      optionParams={optionParamsForModel(harness, model, { serviceTier: config.fastMode && fast ? fast.id : null })}
      onOptionParam={(id, value) => { if (id === 'fast') onChange({ fastMode: value === 'true' }) }}
      providers={providers} providerId={config.apiProviderId ?? null}
      onProvider={providers.length ? (id) => onChange({ apiProviderId: id, effort: undefined }) : undefined} />
    <PermissionModeSelector harness={harness} modes={HARNESS_LAUNCH_OPTIONS[harness].permissionModes}
      value={permissionMode} onChange={(mode) => onChange({ permissionMode: mode as EditableConfig['permissionMode'] })} />
    <SandboxSelector harness={harness} sandboxInfo={sandboxInfoFromMode((config.sandboxMode ?? 'off') as SandboxMode)}
      permissionMode={permissionMode} onChange={(sandboxMode) => onChange({ sandboxMode })} />
  </View>
}

/** Peer session + project, the two things a link has instead of a config. */
function LinkMeta({ launch }: { launch: SessionAgentLaunchProposal }) {
  const { t } = useMobileLocale()
  const sessionShort = shortSessionId(launch.sessionId)
  const peerProject = launch.peerProjectPath ? pathBasename(launch.peerProjectPath) : null
  if (!sessionShort && !peerProject) return null
  return <MetaRow>
    {sessionShort ? <MetaChip icon={MessageSquare} label={sessionShort} accessibilityLabel={`${t('Peer session')}: ${launch.sessionId}`} /> : null}
    {peerProject ? <MetaChip icon={FolderClosed} label={peerProject} accessibilityLabel={`${t('Peer project')}: ${launch.peerProjectPath}`} /> : null}
  </MetaRow>
}

/** Working directory and the pending worktree, read-only — the agent's call, not the user's. */
function SpawnMeta({ launch }: { launch: SessionAgentLaunchProposal }) {
  const { t } = useMobileLocale()
  const { config } = launch
  const workDir = workDirLabel(launchWorkDir(config.worktree), t)
  return <MetaRow>
    {config.cwd ? <MetaChip icon={FolderClosed} label={pathBasename(config.cwd)} accessibilityLabel={`${t('Working directory')}: ${config.cwd}`} /> : null}
    <MetaChip icon={workDir.icon} label={workDir.label} />
  </MetaRow>
}

function MetaRow({ children }: { children: ReactNode }) {
  const styles = usePromptStyles()
  return <View style={[styles.wrap, { rowGap: 4 }]}>{children}</View>
}

function MetaChip({ icon: Icon, label, accessibilityLabel }: { icon: LucideIcon; label: string; accessibilityLabel?: string }) {
  const styles = usePromptStyles()
  const { tokens: { colors } } = useMobileTheme()
  return <View accessible accessibilityLabel={accessibilityLabel ?? label} style={[styles.row, { gap: 4, maxWidth: '100%' }]}>
    <Icon size={12} color={colors.mutedForeground} />
    <Text numberOfLines={1} style={[styles.meta, { flexShrink: 1 }]}>{label}</Text>
  </View>
}
