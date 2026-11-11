import { useCallback, useEffect, useRef, useState } from 'react'
import { codexAccountProviderId, type CodexAccount } from '@superone/shared/codex-accounts'
import type {
  ClaudeAccount,
  ClaudeRateLimits,
  CodexAccountUsage,
  CodexRateLimits,
  ProviderRateLimits,
} from '@superone/shared/agent-types'
import type { SubscriptionUsage } from '@superone/shared/environment'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { ACP_HUB_AGENTS, claudeHubKey, codexHubKey } from './usage-hub-shared'

let cachedClaudeAccounts: ClaudeAccount[] = []
let cachedCodexAccounts: CodexAccount[] = []

export function useSubscriptionHub(activeProject: string | null) {
  const remoteProject = activeProject ? parseRemoteProjectKey(activeProject) : null
  const isRemoteProject = Boolean(remoteProject)
  const localProjectPath = !isRemoteProject ? activeProject : null
  const connectionId = remoteProject?.connectionId ?? null

  const [claudeAccounts, setClaudeAccounts] = useState<ClaudeAccount[]>(() => (
    !isRemoteProject && typeof window !== 'undefined' && typeof window.app?.claudeListAccounts === 'function'
      ? cachedClaudeAccounts
      : []
  ))
  const [claudeMeters, setClaudeMeters] = useState<Record<string, { loading?: boolean; limits?: ClaudeRateLimits | null }>>({})
  const [codexAccounts, setCodexAccounts] = useState<CodexAccount[]>(() => (
    !isRemoteProject && typeof window !== 'undefined' && typeof window.app?.codexListAccounts === 'function'
      ? cachedCodexAccounts
      : []
  ))
  const [codexMeters, setCodexMeters] = useState<Record<string, { loading?: boolean; limits?: CodexRateLimits | null; usage?: CodexAccountUsage | null }>>({})
  const [acpMeters, setAcpMeters] = useState<Record<string, { loading?: boolean; limits?: ProviderRateLimits | null }>>({})
  const [nodeUsage, setNodeUsage] = useState<{
    accounts: SubscriptionUsage[]
    loading: boolean
    error: boolean
  }>({ accounts: [], loading: false, error: false })

  const prefetchedRef = useRef(false)
  const nodeRequestVersion = useRef(0)
  const meterScopeVersion = useRef(0)

  useEffect(() => {
    prefetchedRef.current = false
    setNodeUsage({ accounts: [], loading: false, error: false })
    return () => {
      nodeRequestVersion.current++
    }
  }, [connectionId])

  useEffect(() => () => {
    meterScopeVersion.current++
  }, [localProjectPath])

  const loadNodeSubscriptions = useCallback(async (force: boolean) => {
    if (!connectionId) return
    const version = ++nodeRequestVersion.current
    setNodeUsage((prev) => ({ ...prev, loading: true, error: false }))
    try {
      const report = await window.environment.getUsage(connectionId, force)
      if (version !== nodeRequestVersion.current) return
      setNodeUsage({ accounts: report.accounts, loading: false, error: false })
    } catch {
      if (version !== nodeRequestVersion.current) return
      setNodeUsage((prev) => ({ ...prev, loading: false, error: true }))
    }
  }, [connectionId])

  const loadClaudeMeter = useCallback(async (credentialDir: string | null, force: boolean, preferCached: boolean) => {
    const scope = meterScopeVersion.current
    const key = claudeHubKey(credentialDir)
    setClaudeMeters((prev) => ({ ...prev, [key]: { ...prev[key], loading: true } }))
    try {
      const limits = await window.app?.claudeGetRateLimits?.(force, credentialDir, preferCached) ?? null
      if (scope !== meterScopeVersion.current) return
      setClaudeMeters((prev) => ({ ...prev, [key]: { loading: false, limits } }))
    } catch {
      if (scope !== meterScopeVersion.current) return
      setClaudeMeters((prev) => ({ ...prev, [key]: { ...prev[key], loading: false } }))
    }
  }, [])

  const loadCodexMeter = useCallback(async (accountId: string, force: boolean, preferCached: boolean, includeUsage = false) => {
    if (!localProjectPath) return
    const scope = meterScopeVersion.current
    const providerId = codexAccountProviderId(accountId)
    const key = codexHubKey(providerId)
    setCodexMeters((prev) => ({ ...prev, [key]: { ...prev[key], loading: true } }))
    try {
      const limitsPromise = window.app?.codexGetRateLimits?.(localProjectPath, providerId, force, preferCached) ?? Promise.resolve(null)
      const usagePromise = includeUsage
        ? (window.app?.codexGetAccountUsage?.(localProjectPath, providerId, null, force, preferCached) ?? Promise.resolve(null))
        : Promise.resolve(undefined)
      const limits = await limitsPromise.catch(() => null)
      if (scope !== meterScopeVersion.current) return
      setCodexMeters((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          loading: false,
          limits: limits ?? prev[key]?.limits ?? null,
        },
      }))
      if (includeUsage) {
        const usage = await usagePromise.catch(() => null)
        if (scope !== meterScopeVersion.current) return
        if (usage !== undefined) {
          setCodexMeters((prev) => ({
            ...prev,
            [key]: {
              ...prev[key],
              usage: usage ?? prev[key]?.usage ?? null,
            },
          }))
        }
      }
    } catch {
      if (scope !== meterScopeVersion.current) return
      setCodexMeters((prev) => ({ ...prev, [key]: { ...prev[key], loading: false } }))
    }
  }, [localProjectPath])

  const loadAcpMeter = useCallback(async (agentId: string, force: boolean) => {
    const scope = meterScopeVersion.current
    const key = `acp:${agentId}`
    setAcpMeters((prev) => ({ ...prev, [key]: { ...prev[key], loading: true } }))
    try {
      const limits = await window.app?.acpGetRateLimits?.(localProjectPath ?? '', agentId, force) ?? null
      if (scope !== meterScopeVersion.current) return
      setAcpMeters((prev) => ({ ...prev, [key]: { loading: false, limits } }))
    } catch {
      if (scope !== meterScopeVersion.current) return
      setAcpMeters((prev) => ({ ...prev, [key]: { ...prev[key], loading: false } }))
    }
  }, [localProjectPath])

  useEffect(() => {
    if (isRemoteProject) {
      setClaudeAccounts((prev) => (prev.length === 0 ? prev : []))
      setCodexAccounts((prev) => (prev.length === 0 ? prev : []))
      return
    }
    let cancelled = false
    const refreshClaude = () => {
      if (typeof window.app?.claudeListAccounts !== 'function') {
        cachedClaudeAccounts = []
        setClaudeAccounts((prev) => (prev.length === 0 ? prev : []))
        return
      }
      window.app.claudeListAccounts(false)
        .then((accounts) => {
          if (cancelled) return
          const signedIn = (accounts ?? []).filter((a) => a.loggedIn)
          cachedClaudeAccounts = signedIn
          setClaudeAccounts(signedIn)
        })
        .catch(() => {})
    }
    const refreshCodex = () => {
      if (typeof window.app?.codexListAccounts !== 'function') {
        cachedCodexAccounts = []
        setCodexAccounts((prev) => (prev.length === 0 ? prev : []))
        return
      }
      window.app.codexListAccounts(localProjectPath ?? '', false)
        .then((accounts) => {
          if (cancelled) return
          const signedIn = (accounts ?? []).filter((a) => a.signedIn && !a.unavailable)
          cachedCodexAccounts = signedIn
          setCodexAccounts(signedIn)
        })
        .catch(() => {})
    }
    refreshClaude()
    refreshCodex()
    window.addEventListener('codex-accounts-changed', refreshCodex)
    return () => {
      cancelled = true
      window.removeEventListener('codex-accounts-changed', refreshCodex)
    }
  }, [isRemoteProject, localProjectPath])

  const prefetchSubscriptions = useCallback(() => {
    prefetchedRef.current = true
    if (isRemoteProject) {
      void loadNodeSubscriptions(false)
      return
    }
    for (const account of claudeAccounts) {
      void loadClaudeMeter(account.credentialDir, false, true)
    }
    for (const account of codexAccounts) {
      void loadCodexMeter(account.id, false, true, false)
    }
    window.app?.claudeListAccounts?.(false)
      .then((accounts) => {
        const signedIn = (accounts ?? []).filter((a) => a.loggedIn)
        cachedClaudeAccounts = signedIn
        setClaudeAccounts(signedIn)
        for (const account of signedIn) {
          const key = claudeHubKey(account.credentialDir)
          if (!claudeMeters[key]) {
            void loadClaudeMeter(account.credentialDir, false, true)
          }
        }
      })
      .catch(() => {})
    if (typeof window.app?.codexListAccounts === 'function') {
      window.app.codexListAccounts(localProjectPath ?? '', false)
        .then((accounts) => {
          const signedIn = (accounts ?? []).filter((a) => a.signedIn && !a.unavailable)
          cachedCodexAccounts = signedIn
          setCodexAccounts(signedIn)
          for (const account of signedIn) {
            const key = codexHubKey(codexAccountProviderId(account.id))
            if (!codexMeters[key]) {
              void loadCodexMeter(account.id, false, true, false)
            }
          }
        })
        .catch(() => {})
    }
    for (const agent of ACP_HUB_AGENTS) {
      void loadAcpMeter(agent.agentId, false)
    }
  }, [
    isRemoteProject,
    localProjectPath,
    claudeAccounts,
    codexAccounts,
    claudeMeters,
    codexMeters,
    loadClaudeMeter,
    loadCodexMeter,
    loadAcpMeter,
    loadNodeSubscriptions,
  ])

  const ensurePrefetched = useCallback(() => {
    if (!prefetchedRef.current) prefetchSubscriptions()
  }, [prefetchSubscriptions])

  return {
    isRemoteProject,
    localProjectPath,
    connectionId,
    claudeAccounts,
    claudeMeters,
    codexAccounts,
    codexMeters,
    acpMeters,
    nodeUsage,
    loadNodeSubscriptions,
    loadClaudeMeter,
    loadCodexMeter,
    loadAcpMeter,
    prefetchSubscriptions,
    ensurePrefetched,
  }
}
