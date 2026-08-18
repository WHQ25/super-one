import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownWideNarrow, Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { cn } from '@superone/ui/lib/utils'
import { acpAgentDisplayName, isGrokAcpAgent } from '@superone/shared/acp-brand'
import type {
  AcpAgentDescriptor,
  HarnessId,
  SuggestionHarnessPreference,
} from '@superone/shared/agent-types'
import { suggestionHarnessKey } from '@/lib/suggestion-harness-order'
import {
  isCatalogHarnessEnabled,
  isExperimentalAcpAgentEnabled,
  type HarnessCatalogStatus,
} from '@/lib/harness-visibility'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'

const EMPTY_ACP_AGENTS: AcpAgentDescriptor[] = []

export type HarnessPreferenceKey = string | null

export interface HarnessPreferenceOption {
  key: string
  /** Serialized preference key, or null for Auto. */
  value: HarnessPreferenceKey
  pref: SuggestionHarnessPreference | null
  label: string
}

export function isHarnessPreferenceFieldKey(key: string): boolean {
  return key === 'defaultHarness' || key === 'secondaryHarness'
}

/** Serialize a preference for settings / config tools (`claude`, `acp:grok-build`). */
export function harnessPreferenceToKey(
  pref: SuggestionHarnessPreference | null | undefined,
): HarnessPreferenceKey {
  if (!pref) return null
  if (pref.provider === 'acp') {
    const agent = pref.acpAgentId?.trim()
    return agent ? `acp:${agent}` : null
  }
  return pref.provider
}

/** Parse a settings/config-tool key back into a preference (`null` / `"auto"` → Auto). */
export function keyToHarnessPreference(
  value: unknown,
): SuggestionHarnessPreference | null {
  if (value == null || value === '' || value === 'auto') return null
  if (typeof value === 'object' && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>
    const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
    if (
      provider !== 'claude' &&
      provider !== 'codex' &&
      provider !== 'acp' &&
      provider !== 'opencode' &&
      provider !== 'dsh'
    ) {
      return null
    }
    const acpAgentId = typeof raw.acpAgentId === 'string' && raw.acpAgentId.trim()
      ? raw.acpAgentId.trim()
      : null
    if (provider === 'acp' && !acpAgentId) return null
    return {
      provider: provider as HarnessId,
      acpAgentId: provider === 'acp' ? acpAgentId : null,
    }
  }
  if (typeof value !== 'string') return null
  const key = value.trim()
  if (!key || key === 'auto') return null
  if (
    key === 'claude' ||
    key === 'codex' ||
    key === 'opencode' ||
    key === 'dsh'
  ) {
    return { provider: key, acpAgentId: null }
  }
  if (key.startsWith('acp:')) {
    const agent = key.slice(4).trim()
    return agent ? { provider: 'acp', acpAgentId: agent } : null
  }
  return null
}

export function harnessPreferencesEqual(
  a: SuggestionHarnessPreference | null | undefined,
  b: SuggestionHarnessPreference | null | undefined,
): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (a.provider !== b.provider) return false
  if (a.provider !== 'acp') return true
  return (a.acpAgentId ?? null) === (b.acpAgentId ?? null)
}

/** Human label for a stored harness preference key (config confirm “current value”). */
export function formatHarnessPreferenceLabel(
  value: unknown,
  autoLabel: string,
  labels: { claude: string; codex: string; opencode: string; deepseek: string },
): string {
  const pref = keyToHarnessPreference(value)
  if (!pref) return autoLabel
  if (pref.provider === 'claude') return labels.claude
  if (pref.provider === 'codex') return labels.codex
  if (pref.provider === 'opencode') return labels.opencode
  if (pref.provider === 'dsh') return labels.deepseek
  if (pref.provider === 'acp') return acpAgentDisplayName(pref.acpAgentId)
  return harnessPreferenceToKey(pref) ?? autoLabel
}

function HarnessOptionIcon({
  pref,
  size = 16,
  className,
}: {
  pref: SuggestionHarnessPreference | null
  size?: number
  className?: string
}) {
  if (!pref) {
    // Auto = rank by recent parent-session count (sort metaphor, not sparkle/AI).
    return (
      <ArrowDownWideNarrow
        className={cn('shrink-0 text-muted-foreground', className)}
        style={{ width: size, height: size }}
      />
    )
  }
  const Icon = resolveSessionIcon(pref.provider, pref.acpAgentId)
  if (!Icon) {
    return (
      <ArrowDownWideNarrow
        className={cn('shrink-0 text-muted-foreground', className)}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }}>
      {/* Match sidebar/title idle chrome: compact = static mark, no rich idle motion. */}
      <Icon status="default" size={size} renderLevel="compact" />
    </span>
  )
}

export interface HarnessPreferencePickerProps {
  /** Serialized key (`claude`, `acp:grok-build`) or null for Auto. */
  value: HarnessPreferenceKey
  onChange: (value: HarnessPreferenceKey) => void
  /**
   * Exclude this serialized key from the menu (except Auto).
   * Used so secondary cannot equal default.
   */
  excludeKey?: HarnessPreferenceKey
  disabled?: boolean
  /** compact: config confirm; default: General settings. */
  size?: 'compact' | 'default'
  /** When true, include Auto (null). Default true. */
  clearable?: boolean
  /** Optional left-side label on the same row (unused today; reserved for layout parity). */
  label?: ReactNode
}

/**
 * Shared Default / Secondary harness dropdown used by General settings and
 * the SuperOne config_confirm prompt.
 */
export function HarnessPreferencePicker({
  value,
  onChange,
  excludeKey = null,
  disabled = false,
  size = 'default',
  clearable = true,
}: HarnessPreferencePickerProps) {
  const { t } = useTranslation()
  const experimentalAgentsEnabled = useAppStore((s) => s.experimentalAgentsEnabled)
  const enabledExperimentalAgents = useAppStore((s) => s.enabledExperimentalAgents)
  const acpAgents = useChatStore((s) => s.harnessResources.acp?.agents ?? EMPTY_ACP_AGENTS)
  const initializeHarness = useChatStore((s) => s.initializeHarness)
  const [harnessCatalog, setHarnessCatalog] = useState<HarnessCatalogStatus[] | null>(null)

  useEffect(() => {
    void initializeHarness('acp')
  }, [initializeHarness])

  useEffect(() => {
    let cancelled = false
    window.app
      .listHarnesses?.()
      .then((list) => {
        if (cancelled) return
        setHarnessCatalog(
          Array.isArray(list)
            ? list.map((r) => ({ id: r.id, enabled: r.enabled, state: r.state }))
            : null,
        )
      })
      .catch(() => {
        if (!cancelled) setHarnessCatalog(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const options = useMemo((): HarnessPreferenceOption[] => {
    const autoLabel = t('settings.general.defaultHarness.auto')
    const list: HarnessPreferenceOption[] = []
    if (clearable) {
      list.push({ key: 'auto', value: null, pref: null, label: autoLabel })
    }
    if (isCatalogHarnessEnabled(harnessCatalog, 'claude')) {
      list.push({
        key: 'claude',
        value: 'claude',
        pref: { provider: 'claude', acpAgentId: null },
        label: t('settings.general.harnessOptions.claude'),
      })
    }
    if (isCatalogHarnessEnabled(harnessCatalog, 'codex')) {
      list.push({
        key: 'codex',
        value: 'codex',
        pref: { provider: 'codex', acpAgentId: null },
        label: t('settings.general.harnessOptions.codex'),
      })
    }
    if (isCatalogHarnessEnabled(harnessCatalog, 'dsh')) {
      list.push({
        key: 'dsh',
        value: 'dsh',
        pref: { provider: 'dsh', acpAgentId: null },
        label: t('settings.general.harnessOptions.deepseek'),
      })
    }
    const visibleAgents = acpAgents.filter((agent) => {
      if (agent.id === 'opencode') return false
      if (isGrokAcpAgent(agent.id)) {
        return isCatalogHarnessEnabled(harnessCatalog, 'acp-grok')
      }
      return isExperimentalAcpAgentEnabled(agent.id, {
        enabledExperimentalAgents,
        legacyExperimentalAgentsEnabled: experimentalAgentsEnabled,
      })
    })
    for (const agent of visibleAgents) {
      const key = suggestionHarnessKey('acp', agent.id)
      list.push({
        key,
        value: key,
        pref: { provider: 'acp', acpAgentId: agent.id },
        label: agent.name || acpAgentDisplayName(agent.id),
      })
    }
    if (
      isCatalogHarnessEnabled(harnessCatalog, 'opencode') ||
      experimentalAgentsEnabled
    ) {
      list.push({
        key: 'opencode',
        value: 'opencode',
        pref: { provider: 'opencode', acpAgentId: null },
        label: t('settings.general.harnessOptions.opencode'),
      })
    }
    // Keep a currently selected ACP agent visible even if not in the live list.
    if (value && value.startsWith('acp:') && !list.some((o) => o.value === value)) {
      const agentId = value.slice(4)
      list.push({
        key: value,
        value,
        pref: { provider: 'acp', acpAgentId: agentId },
        label: acpAgentDisplayName(agentId),
      })
    }
    if (excludeKey == null) return list
    return list.filter((o) => o.value == null || o.value !== excludeKey)
  }, [acpAgents, clearable, enabledExperimentalAgents, excludeKey, experimentalAgentsEnabled, harnessCatalog, t, value])

  const selected = options.find((o) => o.value === value)
    ?? (value == null
      ? { key: 'auto', value: null, pref: null, label: t('settings.general.defaultHarness.auto') }
      : {
        key: value,
        value,
        pref: keyToHarnessPreference(value),
        label: formatHarnessPreferenceLabel(value, t('settings.general.defaultHarness.auto'), {
          claude: t('settings.general.harnessOptions.claude'),
          codex: t('settings.general.harnessOptions.codex'),
          opencode: t('settings.general.harnessOptions.opencode'),
          deepseek: t('settings.general.harnessOptions.deepseek'),
        }),
      })

  const isCompact = size === 'compact'
  const iconSize = isCompact ? 14 : 16

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={
            isCompact
              ? 'flex min-w-36 max-w-48 items-center justify-between gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60'
              : 'flex min-w-36 max-w-48 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60'
          }
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <HarnessOptionIcon pref={selected.pref} size={iconSize} />
            <span className="truncate">{selected.label}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.key}
            onClick={() => onChange(option.value)}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex min-w-0 items-center gap-2">
              <HarnessOptionIcon pref={option.pref} size={iconSize} />
              <span className="truncate">{option.label}</span>
            </span>
            {option.value === value && <Check className="size-4 shrink-0 text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
