import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ExternalCliHarnessId } from '@superone/shared/environment/external-cli-install'
import { refreshAcpResourcesAfterToggle } from '@/harness-ui/acp/refresh-after-toggle'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import type { CliInstallUiState } from './ExternalCliInstallBlock'
import {
  catalogIsOn,
  type CatalogRow,
  type ListItem,
  type ProgressState,
} from './HarnessesSettingsParts'

const MAX_CLI_INSTALL_OUTPUT_CHARS = 65_536

function appendBoundedOutput(current: string, chunk: string): string {
  const next = current + chunk
  return next.length <= MAX_CLI_INSTALL_OUTPUT_CHARS
    ? next
    : next.slice(-MAX_CLI_INSTALL_OUTPUT_CHARS)
}

export function sortHarnessItemsByOrder(
  items: ListItem[],
  order: string[],
  getKey: (item: ListItem) => string,
): ListItem[] {
  if (order.length === 0 || items.length <= 1) return items
  const index = new Map(order.map((key, i) => [key, i] as const))
  return [...items].sort((a, b) => {
    const ai = index.get(getKey(a))
    const bi = index.get(getKey(b))
    if (ai == null && bi == null) return 0
    if (ai == null) return 1
    if (bi == null) return -1
    return ai - bi
  })
}

export function useHarnessesCatalogState(getOrderKey: (item: ListItem) => string) {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<CatalogRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<Record<string, ProgressState>>({})
  const [cliInstalls, setCliInstalls] = useState<Record<string, CliInstallUiState>>({})
  const [authRefreshSeq, setAuthRefreshSeq] = useState(0)
  const [enabledExperimentalAgents, setEnabledExperimentalAgents] = useState<string[]>([])
  const [harnessOrder, setHarnessOrder] = useState<string[]>([])
  const [savingOrder, setSavingOrder] = useState(false)

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((s) => {
      if (!mounted) return
      setEnabledExperimentalAgents(s.enabledExperimentalAgents ?? [])
      setHarnessOrder(Array.isArray(s.harnessOrder) ? s.harnessOrder : [])
    })
    const unsub = window.app.onAppSettingsChange?.((s) => {
      if (!mounted) return
      setEnabledExperimentalAgents(s.enabledExperimentalAgents ?? [])
      setHarnessOrder(Array.isArray(s.harnessOrder) ? s.harnessOrder : [])
    })
    return () => {
      mounted = false
      unsub?.()
    }
  }, [])

  const refreshCatalog = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = (await window.app.listHarnesses()) as CatalogRow[]
      setCatalog(Array.isArray(list) ? list : [])
      await useAppStore.getState().refreshHarnessCatalog()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setCatalog(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshCatalog()
  }, [refreshCatalog])

  useEffect(() => {
    const unsub = window.app.onHarnessInstallProgress?.((event) => {
      setProgress((prev) => ({
        ...prev,
        [event.harnessId]: {
          received: event.received,
          total: event.total,
          phase: event.phase,
          message: event.message,
        },
      }))
      if (event.phase === 'done' || event.phase === 'error') {
        void refreshCatalog()
      }
    })
    return () => {
      unsub?.()
    }
  }, [refreshCatalog])

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

  const catalogById = useMemo(() => {
    const m = new Map<string, CatalogRow>()
    for (const row of catalog ?? []) m.set(row.id, row)
    return m
  }, [catalog])

  const isItemEnabled = useCallback(
    (item: ListItem): boolean => catalogIsOn(catalogById.get(item.catalogId)),
    [catalogById],
  )

  const setExperimentalAgentEnabled = useCallback(
    async (agentId: string, enabled: boolean): Promise<void> => {
      const next = enabled
        ? [...new Set([...enabledExperimentalAgents, agentId])]
        : enabledExperimentalAgents.filter((id) => id !== agentId)
      const result = await window.app.saveAppSettings({
        enabledExperimentalAgents: next,
        experimentalAgentsEnabled: false,
      })
      setEnabledExperimentalAgents(result.enabledExperimentalAgents ?? next)
      useAppStore.getState().setExperimentalAgentsEnabled(result.experimentalAgentsEnabled)
    },
    [enabledExperimentalAgents],
  )

  const installExternalCli = useCallback(
    async (item: ListItem, harnessId: ExternalCliHarnessId): Promise<void> => {
      setCliInstalls((prev) => ({
        ...prev,
        [harnessId]: { phase: 'running', output: '' },
      }))
      try {
        const result = await window.app.installHarnessCli(harnessId)
        await refreshCatalog()
        if (result?.ok) {
          setCliInstalls((prev) => {
            const next = { ...prev }
            delete next[harnessId]
            return next
          })
          setAuthRefreshSeq((n) => n + 1)
          toast.success(t('settings.harnesses.cliInstall.succeeded', { id: item.label }))
          const acpAgentId = item.kind === 'catalog' ? item.acpAgentId : item.acpAgentId
          const refreshedAcp = await refreshAcpResourcesAfterToggle(
            item.provider,
            acpAgentId,
            true,
          )
          if (!refreshedAcp) {
            void useChatStore.getState().initializeHarness(item.provider, { force: true })
          }
          return
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
        await refreshCatalog()
      }
    },
    [refreshCatalog, t],
  )

  const persistEnabledOrder = useCallback(
    async (nextEnabled: ListItem[]): Promise<void> => {
      const enabledKeys = nextEnabled.map(getOrderKey)
      const enabledSet = new Set(enabledKeys)
      const retained = harnessOrder.filter((k) => !enabledSet.has(k))
      const nextOrder = [...enabledKeys, ...retained]
      if (
        nextOrder.length === harnessOrder.length
        && nextOrder.every((k, i) => k === harnessOrder[i])
      ) {
        return
      }
      setHarnessOrder(nextOrder)
      setSavingOrder(true)
      try {
        const result = await window.app.saveAppSettings({ harnessOrder: nextOrder })
        setHarnessOrder(Array.isArray(result.harnessOrder) ? result.harnessOrder : nextOrder)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
        const s = await window.app.getAppSettings().catch(() => null)
        if (s) setHarnessOrder(Array.isArray(s.harnessOrder) ? s.harnessOrder : [])
      } finally {
        setSavingOrder(false)
      }
    },
    [getOrderKey, harnessOrder],
  )

  return {
    catalog,
    catalogById,
    loading,
    busyKey,
    setBusyKey,
    error,
    setError,
    progress,
    cliInstalls,
    authRefreshSeq,
    harnessOrder,
    setHarnessOrder,
    savingOrder,
    refreshCatalog,
    isItemEnabled,
    setExperimentalAgentEnabled,
    installExternalCli,
    persistEnabledOrder,
  }
}
