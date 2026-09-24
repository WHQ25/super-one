import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { HarnessId, PermissionMode, SandboxMode } from '@superone/shared/agent-types'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'
import { invalidateDefaultPermissionModeCache } from '@/stores/chat'
import { modes as permissionModes } from '@/components/chat/PermissionModeSelector'
import { PermissionModeList } from '@/components/chat/PermissionModeList'
import { AcpPermissionModeList, acpPermissionModeOption } from '@/components/chat/AcpPermissionModeList'
import { noteAcpAutoFailClosed } from '@/lib/acp-auto-honesty'
import { PERMISSION_POPOVER_CLASS } from '@/components/chat/permissionPopoverStyles'
import { sandboxModes } from '@/components/chat/SandboxModeSelector'
import {
  CURSOR_PERMISSION_MODES,
  resolveCursorPermissionMode,
} from '@/components/chat/cursorPermissionModes'
import {
  CursorPermissionModeList,
  cursorPermissionModeOption,
} from '@/components/chat/CursorPermissionModeList'
import { SandboxStatusBlock } from '@/components/preferences/SandboxStatusBlock'

/**
 * Permission mode (and sandbox, where the harness owns one) a new session on
 * `harnessId` starts in.
 *
 * One component for every harness rather than a copy per preferences page: the
 * rows differ only in which modes the harness declares, and that difference is
 * data (`HARNESS_LAUNCH_OPTIONS`), not markup. Codex is the one harness that
 * does not use this — it stores a preset, which its own page renders.
 */
export function SessionDefaultsSection({ harnessId, autoEligibility }: {
  harnessId: HarnessId
  /**
   * Claude gates `auto` on the account's plan. Passed in rather than resolved
   * here: it is one harness's knowledge, and a generic section that reached for
   * a Claude account would be the same leak this refactor removed.
   */
  autoEligibility?: Parameters<typeof PermissionModeList>[0]['autoEligibility']
}) {
  const { t } = useTranslation()
  const sandboxCapability = useAppStore((s) => s.sandboxCapability)
  const sandboxProbe = useAppStore((s) => s.sandboxProbe)
  const probeSandbox = useAppStore((s) => s.probeSandbox)

  const [permissionMode, setPermissionMode] = useState<PermissionMode | ''>('')
  const [sandboxMode, setSandboxMode] = useState<SandboxMode | ''>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [permOpen, setPermOpen] = useState(false)
  const [sandboxOpen, setSandboxOpen] = useState(false)

  const offeredModes = HARNESS_LAUNCH_OPTIONS[harnessId].permissionModes
  const offeredSandboxModes = HARNESS_LAUNCH_OPTIONS[harnessId].sandboxModes

  useEffect(() => {
    let mounted = true
    setLoading(true)
    window.app.getAppSettings().then((settings) => {
      if (!mounted) return
      const preference = settings.agentPreference[harnessId] as {
        defaultPermissionMode?: PermissionMode | ''
        defaultSandboxMode?: SandboxMode | ''
      }
      setPermissionMode(preference?.defaultPermissionMode ?? '')
      setSandboxMode(preference?.defaultSandboxMode ?? '')
    }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [harnessId])

  async function save(
    patch: { defaultPermissionMode?: PermissionMode | ''; defaultSandboxMode?: SandboxMode | '' },
    successMessage: string,
  ) {
    if (saving) return
    setSaving(true)
    try {
      await window.app.saveAppSettings({ agentPreference: { [harnessId]: patch } })
      if (patch.defaultPermissionMode !== undefined) setPermissionMode(patch.defaultPermissionMode)
      if (patch.defaultSandboxMode !== undefined) setSandboxMode(patch.defaultSandboxMode)
      // Every harness reads its mode through the same renderer cache.
      invalidateDefaultPermissionModeCache()
      toast.success(successMessage)
    } finally {
      setSaving(false)
    }
  }

  const disabled = loading || saving
  const sandboxSupportLevel = sandboxCapability?.supportLevel ?? 'always'
  const fallbackSandboxMode: SandboxMode = sandboxCapability?.defaultMode ?? 'on'
  // An unset preference shows what the harness would actually start in, so the
  // row never claims a mode the session would not use.
  const activePermMode = permissionMode || offeredModes[0]!
  const activeSandboxMode = sandboxMode || fallbackSandboxMode
  /**
   * Cursor's ladder is a different vocabulary, not a subset of the shared one:
   * `agent` has no entry in the shared descriptor table and its labels live in
   * their own i18n namespace. So this row dispatches on it exactly the way the
   * chat status bar does, rather than rendering a mode it cannot name.
   */
  const cursorOption = harnessId === 'cursor'
    ? cursorPermissionModeOption(resolveCursorPermissionMode(activePermMode))
    : null
  const acpOption = harnessId === 'acp' ? acpPermissionModeOption(activePermMode) : null
  const currentPerm = acpOption
    ?? cursorOption
    ?? permissionModes.find((m) => m.id === activePermMode)
    ?? permissionModes[0]!
  const currentPermLabel = acpOption
    ? t(`chat.acpPermissionModes.${acpOption.labelKey}.label`)
    : cursorOption
      ? t(`chat.cursorPermissionModes.${cursorOption.labelKey}.label`)
      : t(`chat.permissionModes.${currentPerm.id}.label`)
  const currentSandbox = sandboxModes.find((m) => m.id === activeSandboxMode) ?? sandboxModes[1]!
  const sandboxOptionDisabled = (id: SandboxMode): boolean =>
    id !== 'off' && sandboxSupportLevel === 'unsupported'
  const sandboxTriggerDisabled = disabled || sandboxSupportLevel === 'unsupported'

  return (
    <>
      <div className="flex items-center justify-between gap-4 border-b border-border p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('settings.preferences.permissionMode.label')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('settings.preferences.permissionMode.description')}
          </p>
        </div>
        <Popover open={permOpen} onOpenChange={setPermOpen}>
          <PopoverTrigger asChild>
            <button
              disabled={disabled}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${currentPerm.color} ${currentPerm.hoverBg}`}
            >
              {currentPerm.icon}
              <span>{currentPermLabel}</span>
              <ChevronDown className={`size-3 transition-transform duration-200 ${permOpen ? 'rotate-180' : ''}`} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" side="bottom" className={cn(PERMISSION_POPOVER_CLASS, 'bg-card')}>
            {acpOption ? (
              <AcpPermissionModeList
                activeMode={acpOption.id}
                onSelect={(mode) => {
                  setPermOpen(false)
                  if (mode === 'auto') {
                    noteAcpAutoFailClosed(toast.info, t('chat.acpPermissionModes.autoFailClosedToast'))
                  }
                  void save({ defaultPermissionMode: mode }, t('settings.preferences.permissionMode.updated'))
                }}
              />
            ) : cursorOption ? (
              <CursorPermissionModeList
                activeMode={cursorOption.id}
                availableModes={CURSOR_PERMISSION_MODES}
                onSelect={(mode) => {
                  setPermOpen(false)
                  void save({ defaultPermissionMode: mode }, t('settings.preferences.permissionMode.updated'))
                }}
              />
            ) : (
              <PermissionModeList
                activeMode={activePermMode}
                availableModes={offeredModes}
                autoEligibility={autoEligibility}
                onSelect={(mode) => {
                  setPermOpen(false)
                  void save({ defaultPermissionMode: mode }, t('settings.preferences.permissionMode.updated'))
                }}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>

      {offeredSandboxModes.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-4 border-b border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.preferences.sandbox.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.preferences.sandbox.description')}
              </p>
            </div>
            <Popover open={sandboxOpen} onOpenChange={setSandboxOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={sandboxTriggerDisabled}
                  title={sandboxSupportLevel === 'unsupported' ? t('settings.preferences.sandbox.statusUnsupported') : undefined}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${currentSandbox.color} ${currentSandbox.hoverBg}`}
                >
                  {currentSandbox.icon}
                  <span>{t(`chat.sandboxModes.${currentSandbox.id}.label`)}</span>
                  <ChevronDown className={`size-3 transition-transform duration-200 ${sandboxOpen ? 'rotate-180' : ''}`} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-56 border-border bg-card p-1">
                <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('settings.preferences.sandbox.menuTitle')}</div>
                {sandboxModes
                  .filter((mode) => offeredSandboxModes.includes(mode.id))
                  .map((mode) => {
                    const isDisabled = sandboxOptionDisabled(mode.id)
                    return (
                      <button
                        key={mode.id}
                        disabled={isDisabled}
                        aria-disabled={isDisabled}
                        onClick={() => {
                          if (isDisabled) return
                          setSandboxOpen(false)
                          void save({ defaultSandboxMode: mode.id }, t('settings.preferences.sandbox.updated'))
                        }}
                        title={isDisabled ? t('settings.preferences.sandbox.statusUnsupported') : undefined}
                        className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                          mode.id === activeSandboxMode
                            ? 'bg-muted text-foreground'
                            : 'text-foreground hover:bg-muted/50'
                        } ${isDisabled ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : ''}`}
                      >
                        <div className={`flex items-center gap-1.5 font-medium ${mode.color}`}>
                          {mode.icon}
                          {t(`chat.sandboxModes.${mode.id}.label`)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">{t(`chat.sandboxModes.${mode.id}.description`)}</div>
                      </button>
                    )
                  })}
              </PopoverContent>
            </Popover>
          </div>
          {sandboxSupportLevel !== 'always' && (
            <SandboxStatusBlock
              supportLevel={sandboxSupportLevel}
              probe={sandboxProbe}
              capabilityReason={sandboxCapability?.unsupportedReason}
              onProbe={() => { void probeSandbox(true) }}
            />
          )}
        </>
      )}
    </>
  )
}

/**
 * Whole preferences page for a harness whose only app-level settings are these.
 * Claude and Codex have richer pages of their own and compose the section above
 * directly instead.
 */
export function HarnessPreferencesPage({ harnessId, children }: {
  harnessId: HarnessId
  /** Harness-specific rows, below the session defaults in the same card. */
  children?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="w-full">
      <div className="rounded-lg border border-border">
        <div className="border-b border-border px-4 py-2">
          <p className="text-xs font-medium text-muted-foreground">{t('settings.preferences.sections.user')}</p>
        </div>
        <SessionDefaultsSection harnessId={harnessId} />
        {children}
      </div>
    </div>
  )
}
