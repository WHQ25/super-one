import { useCallback, useMemo } from 'react'
import { Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  getExternalCliInstallSpec,
  type ExternalCliHarnessId,
} from '@superone/shared/environment/external-cli-install'
import { codePlugin, codePluginLight } from '@/components/chat/code-plugins'
import {
  HighlightedCodeBlockPresenter,
  type HighlightedCodeBlockPresenterPorts,
} from '@/components/chat/presenters/CodeBlock'
import { ReadOnlyTerminal } from '@/components/coding/ReadOnlyTerminal'
import { useIsDark } from '@/hooks/use-is-dark'
import type { CliInstallUiState } from '@/hooks/use-external-cli-install'
import { tryCopy } from '@/lib/clipboard'

export type { CliInstallUiState }

export function ExternalCliTerminalOutput({
  title,
  output,
  testId = 'harness-cli-install-output',
}: {
  title: string
  output: string
  testId?: string
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
        <Terminal className="size-3 shrink-0" />
        <span className="truncate">{title}</span>
      </div>
      <ReadOnlyTerminal output={output} testId={testId} className="h-44" />
    </div>
  )
}

export function ExternalCliInstallBlock({
  harnessId,
  mode = 'install',
  currentVersion,
  installState,
  platform,
  onInstall,
}: {
  harnessId: ExternalCliHarnessId
  mode?: 'install' | 'upgrade'
  currentVersion?: string
  installState?: CliInstallUiState
  platform?: string
  onInstall: () => Promise<void>
}) {
  const { t } = useTranslation()
  const isDark = useIsDark()
  const effectivePlatform =
    platform ?? (typeof window !== 'undefined' ? window.app?.platform : undefined) ?? 'darwin'
  const spec = useMemo(
    () => getExternalCliInstallSpec(harnessId, effectivePlatform),
    [harnessId, effectivePlatform],
  )
  const isRunning = installState?.phase === 'running'
  const hasOutput = Boolean(installState?.output)

  const ports = useMemo<HighlightedCodeBlockPresenterPorts>(
    () => ({
      isDark,
      lightCodePlugin: codePluginLight,
      copyText: tryCopy,
      isRhaiLanguage: () => false,
      highlightRhai: () => null,
    }),
    [isDark],
  )

  const handleRun = useCallback(async () => {
    await onInstall()
  }, [onInstall])

  const isUpgrade = mode === 'upgrade'
  const errorText = useMemo(() => {
    if (installState?.phase !== 'error') return null
    if (installState.exitCode === 0) {
      return isUpgrade
        ? t('settings.harnesses.cliInstall.stillIncompatible', {
            binary: spec.binaryName,
            actual: currentVersion ?? '?',
            min: spec.minVersion,
          })
        : t('settings.harnesses.cliInstall.stillMissing', { binary: spec.binaryName })
    }
    if (installState.exitCode == null && installState.message) {
      return installState.message
    }
    return t('settings.harnesses.cliInstall.failed', {
      code: installState.exitCode ?? 1,
    })
  }, [currentVersion, installState, isUpgrade, spec.binaryName, spec.minVersion, t])

  return (
    <div className="space-y-2" data-harness-cli-install={harnessId}>
      <p className={isUpgrade ? 'text-xs text-warning' : 'text-xs text-muted-foreground'}>
        {isUpgrade
          ? t('settings.harnesses.cliInstall.upgradePrompt', {
              binary: spec.binaryName,
              actual: currentVersion ?? '?',
              min: spec.minVersion,
            })
          : t('settings.harnesses.cliInstall.prompt', { binary: spec.binaryName })}
      </p>

      <HighlightedCodeBlockPresenter
        code={isUpgrade ? spec.upgradeCommand : spec.command}
        language={spec.language}
        codePlugin={codePlugin}
        canRun
        isRunning={isRunning}
        runBash={handleRun}
        ports={ports}
      />

      {(isRunning || hasOutput) ? (
        <ExternalCliTerminalOutput
          title={
            isRunning
              ? t(
                  isUpgrade
                    ? 'settings.harnesses.cliInstall.upgrading'
                    : 'settings.harnesses.cliInstall.running',
                  { binary: spec.binaryName },
                )
              : t('common.terminal')
          }
          output={installState?.output ?? ''}
        />
      ) : null}

      {errorText ? (
        <p role="alert" className="text-xs break-words text-error">
          {errorText}
        </p>
      ) : null}
    </div>
  )
}
