import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { HarnessId } from '@superone/shared/agent-types'
import type { ExternalCliHarnessId } from '@superone/shared/environment/external-cli-install'
import { refreshAcpResourcesAfterToggle } from '@/harness-ui/acp/refresh-after-toggle'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'

export interface CliInstallUiState {
  phase: 'idle' | 'running' | 'done' | 'error'
  output: string
  exitCode?: number
  message?: string
}

export interface RunExternalCliInstallOptions {
  label: string
  provider: HarnessId
  acpAgentId: string | null
  wasIncompatible?: boolean
  onRefreshCatalog?: () => Promise<void>
  onSucceeded?: () => void
}

const MAX_CLI_INSTALL_OUTPUT_CHARS = 65_536

function appendBoundedOutput(current: string, chunk: string): string {
  const next = current + chunk
  return next.length <= MAX_CLI_INSTALL_OUTPUT_CHARS
    ? next
    : next.slice(-MAX_CLI_INSTALL_OUTPUT_CHARS)
}

export function useExternalCliInstall() {
  const { t } = useTranslation()
  const [cliInstalls, setCliInstalls] = useState<Record<string, CliInstallUiState>>({})

  useEffect(() => {
    const unsub = window.app.onHarnessCliInstallEvent?.((event) => {
      setCliInstalls((prev) => {
        const current = prev[event.harnessId] ?? { phase: 'idle' as const, output: '' }
        if (event.phase === 'start') {
          return {
            ...prev,
            [event.harnessId]: { phase: 'running', output: '' },
          }
        }
        if (event.phase === 'output') {
          return {
            ...prev,
            [event.harnessId]: {
              ...current,
              phase: 'running',
              output: appendBoundedOutput(current.output, event.data ?? ''),
            },
          }
        }
        if (event.phase === 'done') {
          return {
            ...prev,
            [event.harnessId]: {
              ...current,
              phase: 'done',
              exitCode: event.exitCode ?? 0,
            },
          }
        }
        return {
          ...prev,
          [event.harnessId]: {
            ...current,
            phase: 'error',
            exitCode: event.exitCode,
            message: event.message,
          },
        }
      })
    })
    return () => {
      unsub?.()
    }
  }, [])

  const runInstall = useCallback(
    async (
      harnessId: ExternalCliHarnessId,
      opts: RunExternalCliInstallOptions,
    ): Promise<boolean> => {
      setCliInstalls((prev) => ({
        ...prev,
        [harnessId]: { phase: 'running', output: '' },
      }))
      const refresh = opts.onRefreshCatalog ?? (() => useAppStore.getState().refreshHarnessCatalog())
      try {
        const result = await window.app.installHarnessCli(harnessId)
        await refresh()
        if (result?.ok) {
          setCliInstalls((prev) => {
            const next = { ...prev }
            delete next[harnessId]
            return next
          })
          opts.onSucceeded?.()
          toast.success(
            t(
              opts.wasIncompatible
                ? 'settings.harnesses.cliInstall.upgraded'
                : 'settings.harnesses.cliInstall.succeeded',
              { id: opts.label },
            ),
          )
          const refreshedAcp = await refreshAcpResourcesAfterToggle(
            opts.provider,
            opts.acpAgentId,
            true,
          )
          if (!refreshedAcp) {
            void useChatStore.getState().initializeHarness(opts.provider, { force: true })
          }
          return true
        }
        setCliInstalls((prev) => {
          const current = prev[harnessId] ?? { phase: 'error' as const, output: '' }
          return {
            ...prev,
            [harnessId]: {
              ...current,
              phase: 'error',
              exitCode: result?.exitCode ?? current.exitCode,
              message: result?.message ?? current.message,
            },
          }
        })
        return false
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setCliInstalls((prev) => {
          const current = prev[harnessId] ?? { phase: 'error' as const, output: '' }
          return {
            ...prev,
            [harnessId]: {
              ...current,
              phase: 'error',
              message: msg,
            },
          }
        })
        await refresh()
        return false
      }
    },
    [t],
  )

  return { cliInstalls, runInstall }
}
