import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { ExternalCliHarnessId } from '@superone/shared/environment/external-cli-install'
import { useExternalCliInstall } from '@/hooks/use-external-cli-install'
import { useAppStore } from '@/stores/app'
import {
  catalogIsOn,
  type CatalogRow,
  type ListItem,
  type ProgressState,
} from './HarnessesSettingsParts'

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
  const [catalog, setCatalog] = useState<CatalogRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<Record<string, ProgressState>>({})
  const [authRefreshSeq, setAuthRefreshSeq] = useState(0)
  const [enabledExperimentalAgents, setEnabledExperimentalAgents] = useState<string[]>([])
  const [harnessOrder, setHarnessOrder] = useState<string[]>([])
  const [savingOrder, setSavingOrder] = useState(false)
  const { cliInstalls, runInstall } = useExternalCliInstall()

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
      const wasIncompatible = catalogById.get(harnessId)?.state === 'incompatible'
      await runInstall(harnessId, {
        label: item.label,
        provider: item.provider,
        acpAgentId: item.acpAgentId,
        wasIncompatible,
        onRefreshCatalog: refreshCatalog,
        onSucceeded: () => setAuthRefreshSeq((n) => n + 1),
      })
    },
    [catalogById, refreshCatalog, runInstall],
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
