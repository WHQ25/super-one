import { useCallback, useMemo } from 'react'
import { ArrowUpCircle, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { HarnessId } from '@superone/shared/agent-types'
import {
  extractCliFailureReason,
  getExternalCliInstallSpec,
  type ExternalCliHarnessId,
} from '@superone/shared/environment/external-cli-install'
import { Button } from '@superone/ui/components/ui/button'
import { resolveSessionIcon, resolveSessionIconFromBrandKey } from '@/components/harness/resolve-session-icon'
import { ExternalCliTerminalOutput } from '@/components/harnesses-settings/ExternalCliInstallBlock'
import { useExternalCliInstall } from '@/hooks/use-external-cli-install'

export interface HarnessUpgradeComposerProps {
  harnessId: ExternalCliHarnessId
  label: string
  provider: HarnessId
  acpAgentId?: string | null
  currentVersion?: string
  remoteOn?: boolean
  platform?: string
}

const DEFAULT_ACP_AGENT_IDS: Partial<Record<ExternalCliHarnessId, string>> = {
  'acp-antigravity': 'antigravity',
  'acp-grok': 'grok-build',
}

function defaultAcpAgentId(harnessId: ExternalCliHarnessId): string | null {
  return DEFAULT_ACP_AGENT_IDS[harnessId] ?? null
}

export function HarnessUpgradeComposer({
  harnessId,
  label,
  provider,
  acpAgentId,
  currentVersion,
  remoteOn = false,
  platform,
}: HarnessUpgradeComposerProps) {
  const { t } = useTranslation()
  const { cliInstalls, runInstall } = useExternalCliInstall()

  const effectivePlatform =
    platform ?? (typeof window !== 'undefined' ? window.app?.platform : undefined) ?? 'darwin'
  const spec = useMemo(
    () => getExternalCliInstallSpec(harnessId, effectivePlatform),
    [harnessId, effectivePlatform],
  )
  const installState = cliInstalls[harnessId]
  const isRunning = installState?.phase === 'running'
  const isError = installState?.phase === 'error'
  const hasOutput = Boolean(installState?.output)

  const HarnessIcon =
    resolveSessionIconFromBrandKey(harnessId) ?? resolveSessionIcon(provider, acpAgentId)

  const handleUpgrade = useCallback(() => {
    void runInstall(harnessId, {
      label,
      provider,
      acpAgentId: acpAgentId ?? defaultAcpAgentId(harnessId),
      wasIncompatible: true,
    })
  }, [acpAgentId, harnessId, label, provider, runInstall])

  const errorText = useMemo(() => {
    if (!isError || !installState) return null
    if (installState.exitCode === 0) {
      return t('settings.harnesses.cliInstall.stillIncompatible', {
        binary: spec.binaryName,
        actual: currentVersion ?? '?',
        min: spec.minVersion,
      })
    }
    const reason = extractCliFailureReason(installState.output)
    if (installState.exitCode == null && installState.message) {
      return installState.message
    }
    const base = t('settings.harnesses.cliInstall.failed', {
      code: installState.exitCode ?? 1,
    })
    return reason ? `${base} ${reason}` : base
  }, [currentVersion, installState, isError, spec.binaryName, spec.minVersion, t])

  if (remoteOn) {
    return (
      <div
        data-testid="harness-upgrade-composer"
        data-harness-upgrade={harnessId}
        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-sm text-muted-foreground"
      >
        {HarnessIcon ? (
          <span className="inline-flex shrink-0">
            <HarnessIcon status="default" size={18} renderLevel="compact" />
          </span>
        ) : null}
        <span>
          {t('settings.harnesses.cliInstall.composerRemoteIncompatible', {
            label,
            min: spec.minVersion,
          })}
        </span>
      </div>
    )
  }

  return (
    <div
      data-testid="harness-upgrade-composer"
      data-harness-upgrade={harnessId}
      className="mx-auto w-full max-w-3xl px-4 pb-3"
    >
      <div className="space-y-2.5 rounded-2xl border border-warning/35 bg-card/95 p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {HarnessIcon ? (
              <span className="inline-flex shrink-0">
                <HarnessIcon status="default" size={20} renderLevel="compact" />
              </span>
            ) : null}
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {t('settings.harnesses.cliInstall.composerUpgradeTitle', { label })}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 font-mono text-xs text-warning">
                  {currentVersion ? <span>{currentVersion}</span> : null}
                  {currentVersion ? <span>→</span> : null}
                  <span>
                    {t('settings.harnesses.cliInstall.minVersionBadge', {
                      min: spec.minVersion,
                    })}
                  </span>
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settings.harnesses.cliInstall.composerUpgradeHint', {
                  binary: spec.binaryName,
                  actual: currentVersion ?? '?',
                  min: spec.minVersion,
                })}
              </p>
            </div>
          </div>

          <Button
            size="sm"
            disabled={isRunning}
            onClick={handleUpgrade}
            className="shrink-0 gap-1.5"
          >
            {isRunning ? (
              t('settings.harnesses.cliInstall.upgrading', { binary: spec.binaryName })
            ) : isError ? (
              <>
                <RotateCcw className="size-3.5" />
                {t('settings.harnesses.cliInstall.retryUpgradeAction')}
              </>
            ) : (
              <>
                <ArrowUpCircle className="size-3.5" />
                {t('settings.harnesses.cliInstall.upgradeAction')}
              </>
            )}
          </Button>
        </div>

        {(isRunning || hasOutput) ? (
          <ExternalCliTerminalOutput
            title={spec.upgradeCommand}
            output={installState?.output ?? ''}
            testId="composer-cli-upgrade-output"
          />
        ) : null}

        {errorText ? (
          <p role="alert" className="text-xs break-words text-error">
            {errorText}
          </p>
        ) : null}
      </div>
    </div>
  )
}
