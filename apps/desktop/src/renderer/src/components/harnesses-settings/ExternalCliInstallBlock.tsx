import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Loader2, Terminal } from 'lucide-react'
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
import { useIsDark } from '@/hooks/use-is-dark'
import type { CliInstallUiState } from '@/hooks/use-external-cli-install'
import { parseAnsiToTailwind } from '@/lib/ansi'
import { tryCopy } from '@/lib/clipboard'

export type { CliInstallUiState }

export function AnsiTerminalLines({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n'), [text])
  return (
    <>
      {lines.map((line, i) => (
        <div key={i}>
          {line ? (
            parseAnsiToTailwind(line).map((span, j) => (
              <span key={j} className={span.className}>{span.text}</span>
            ))
          ) : (
            '\u00A0'
          )}
        </div>
      ))}
    </>
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
  const outputRef = useRef<HTMLDivElement>(null)
  const effectivePlatform =
    platform ?? (typeof window !== 'undefined' ? window.app?.platform : undefined) ?? 'darwin'
  const spec = useMemo(
    () => getExternalCliInstallSpec(harnessId, effectivePlatform),
    [harnessId, effectivePlatform],
  )
  const isRunning = installState?.phase === 'running'
  const hasOutput = Boolean(installState?.output)

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [installState?.output])

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

      {(isRunning || hasOutput) && (
        <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
          <div className="flex items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/90 px-3 py-1.5 text-[11px] text-zinc-400">
            {isRunning ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
            ) : (
              <Terminal className="size-3 shrink-0" />
            )}
            <span className="truncate">
              {isRunning
                ? t(
                    isUpgrade
                      ? 'settings.harnesses.cliInstall.upgrading'
                      : 'settings.harnesses.cliInstall.running',
                    { binary: spec.binaryName },
                  )
                : t('common.terminal')}
            </span>
          </div>
          <div
            ref={outputRef}
            data-testid="harness-cli-install-output"
            className="max-h-44 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed text-zinc-200"
          >
            {hasOutput ? <AnsiTerminalLines text={installState?.output ?? ''} /> : null}
            {isRunning && (
              <span className="inline-block h-3.5 w-1.5 animate-pulse bg-zinc-400 align-middle" />
            )}
          </div>
        </div>
      )}

      {errorText ? (
        <p role="alert" className="text-xs break-words text-error">
          {errorText}
        </p>
      ) : null}
    </div>
  )
}
