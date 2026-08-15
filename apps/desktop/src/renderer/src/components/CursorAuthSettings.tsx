import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Input } from '@superone/ui/components/ui/input'
import { Button } from '@superone/ui/components/ui/button'
import { Switch } from '@superone/ui/components/ui/switch'
import { buildCatalogModelIndex, normalizeModelId } from '@superone/shared/platform-registry'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { ProviderModelsList } from './providers/ProviderModelsList'

type CursorAuthStatus = {
  configured: boolean
  apiKeyName: string | null
  userEmail: string | null
}

type SettingSource = 'project' | 'user' | 'plugins'
type ToolPreset = 'default' | 'readonly' | 'no-shell' | 'custom'

type CloudAgentRow = {
  agentId: string
  name?: string
  summary?: string
  status?: string
  archived?: boolean
  lastModified?: number
}

type UsageSnapshot = {
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    totalTokens: number
  }
  cost?: { rawCostCents: number; chargedCents: number }
  runs: Array<{ runId: string }>
}

/** Nested Cursor harness tabs — mirrors Claude/Codex config sections. */
export type CursorSettingsSection = 'account' | 'preferences' | 'models' | 'cloud'

/**
 * Cursor User API Key + local/cloud runtime controls.
 * Shown under Settings → Harnesses → Cursor, split by `section` tab.
 */
export function CursorAuthSettings({
  onAuthChanged,
  section = 'account',
}: {
  onAuthChanged?: () => void
  section?: CursorSettingsSection
}) {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [authStatus, setAuthStatus] = useState<CursorAuthStatus>({
    configured: false,
    apiKeyName: null,
    userEmail: null,
  })
  const [cloud, setCloud] = useState(false)
  const [autoCreatePR, setAutoCreatePR] = useState(false)
  const [workOnCurrentBranch, setWorkOnCurrentBranch] = useState(false)
  const [cloudEnvType, setCloudEnvType] = useState<'cloud' | 'pool' | 'machine'>('cloud')
  const [repoUrl, setRepoUrl] = useState('')
  const [repos, setRepos] = useState<Array<{ url: string }>>([])
  const [envVarsText, setEnvVarsText] = useState('')
  const [settingSources, setSettingSources] = useState<SettingSource[]>(['project', 'user'])
  const [disabledModelIds, setDisabledModelIds] = useState<string[]>([])
  const [modelsSaving, setModelsSaving] = useState(false)
  const [cloudAgents, setCloudAgents] = useState<CloudAgentRow[]>([])
  const [cloudAgentsLoading, setCloudAgentsLoading] = useState(false)
  const [forceRecovering, setForceRecovering] = useState(false)
  const [toolPreset, setToolPreset] = useState<ToolPreset>('default')
  const [browserLoggingIn, setBrowserLoggingIn] = useState(false)
  const [usageAgentId, setUsageAgentId] = useState('')
  const [usage, setUsage] = useState<UsageSnapshot | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const initializeHarness = useChatStore((s) => s.initializeHarness)
  const setHarnessResources = useChatStore((s) => s.setHarnessResources)
  const activeSessionId = useActiveSession((s) => s._activeSessionId ?? s.session?.sessionId ?? null)
  const sessionProvider = useActiveSession((s) => s.sessionProvider ?? s.preferredProvider)
  const providerSessionId = useActiveSession((s) => s._providerSessionId)
  const cursorResources = useChatStore((s) => s.harnessResources.cursor)
  const catalogModels = cursorResources?.models ?? []
  const { catalog } = useModelCatalog()
  const catalogModelIndex = useMemo(
    () => (catalog ? buildCatalogModelIndex(catalog) : null),
    [catalog],
  )

  const activeCursorSessionId = useMemo(() => {
    if (activeSessionId && sessionProvider === 'cursor') return activeSessionId
    return null
  }, [activeSessionId, sessionProvider])

  // local.force is agent-scoped (bc-* = cloud), not the settings Cloud toggle.
  const isCloudAgent = Boolean(providerSessionId?.startsWith('bc-'))
  const canForceRecover = Boolean(activeCursorSessionId) && !isCloudAgent

  const refreshAuthStatus = useCallback(async () => {
    try {
      const status = await window.app.getCursorAuthStatus()
      setAuthStatus(status)
    } catch {
      setAuthStatus({ configured: false, apiKeyName: null, userEmail: null })
    }
  }, [])

  const loadBaseConfig = useCallback(async () => {
    try {
      const config = await window.app.getCursorBaseConfig()
      setDisabledModelIds(config.disabledModelIds ?? [])
      setCloud(config.runtime === 'cloud')
      setAutoCreatePR(Boolean(config.autoCreatePR))
      setWorkOnCurrentBranch(Boolean(config.workOnCurrentBranch))
      setCloudEnvType(config.cloudEnvType ?? 'cloud')
      setRepoUrl(config.repos?.[0]?.url ?? '')
      const sources = (config.settingSources ?? ['project', 'user']).filter(
        (s): s is SettingSource => s === 'project' || s === 'user' || s === 'plugins',
      )
      setSettingSources(sources.length ? sources : ['project', 'user'])
      const preset = config.toolPreset
      setToolPreset(
        preset === 'readonly' || preset === 'no-shell' || preset === 'custom' || preset === 'default'
          ? preset
          : 'default',
      )
      const env = config.cloudEnvVars ?? {}
      setEnvVarsText(
        Object.entries(env)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n'),
      )
    } catch {
      setDisabledModelIds([])
    }
  }, [])

  const refreshCloudAgents = useCallback(async () => {
    if (!window.app.cursorListAgents) return
    setCloudAgentsLoading(true)
    try {
      const result = await window.app.cursorListAgents({
        runtime: 'cloud',
        limit: 20,
        includeArchived: false,
      }) as { items?: CloudAgentRow[] } | CloudAgentRow[]
      const items = Array.isArray(result) ? result : (result.items ?? [])
      setCloudAgents(items)
    } catch {
      setCloudAgents([])
    } finally {
      setCloudAgentsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshAuthStatus()
    void loadBaseConfig()
    void initializeHarness('cursor')
    void window.app.cursorListRepositories?.()
      .then((list) => setRepos(list))
      .catch(() => setRepos([]))
  }, [refreshAuthStatus, loadBaseConfig, initializeHarness])

  useEffect(() => {
    if (cursorResources?.disabledModelIds) {
      setDisabledModelIds(cursorResources.disabledModelIds)
    }
  }, [cursorResources?.disabledModelIds])

  useEffect(() => {
    if (cloud && authStatus.configured) {
      void refreshCloudAgents()
    }
  }, [cloud, authStatus.configured, refreshCloudAgents])

  const disabledSet = useMemo(() => new Set(disabledModelIds), [disabledModelIds])
  const modelListItems = useMemo(
    () =>
      catalogModels.map((model) => ({
        id: model.id,
        name: model.name || model.id,
        enabled: !disabledSet.has(model.id),
        catalog: catalogModelIndex?.get(normalizeModelId(model.id)) ?? null,
      })),
    [catalogModels, catalogModelIndex, disabledSet],
  )

  function parseEnvVarsText(text: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (!key || key.startsWith('CURSOR_')) continue
      out[key] = value
    }
    return out
  }

  function toggleSettingSource(source: SettingSource, enabled: boolean) {
    setSettingSources((prev) => {
      if (enabled) return prev.includes(source) ? prev : [...prev, source]
      return prev.filter((s) => s !== source)
    })
  }

  /**
   * Persist the disabled-model blacklist and refresh in-memory Cursor resources.
   */
  async function persistDisabledModelIds(nextDisabled: string[]) {
    setModelsSaving(true)
    try {
      await window.app.updateCursorBaseConfig({ disabledModelIds: nextDisabled })
      setDisabledModelIds(nextDisabled)
      const current = useChatStore.getState().harnessResources.cursor
      if (current) {
        setHarnessResources('cursor', { ...current, disabledModelIds: nextDisabled })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setModelsSaving(false)
    }
  }

  /** Re-probe Cursor models. initializeHarness is otherwise once-per-session. */
  async function refreshCursorModels() {
    setModelsSaving(true)
    try {
      await initializeHarness('cursor', { force: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setModelsSaving(false)
    }
  }

  async function refreshAuth() {
    try {
      await window.app.probeHarness?.('cursor')
    } catch {
      /* probe may fail until key validates against Cursor API */
    }
    // Force re-probe models — initializeHarness is otherwise once-per-session.
    await initializeHarness('cursor', { force: true })
    await refreshAuthStatus()
    await loadBaseConfig()
    onAuthChanged?.()
  }

  async function saveKey() {
    if (!apiKey.trim() || saving) return
    setSaving(true)
    try {
      await window.app.setCursorApiKey(apiKey.trim())
      setApiKey('')
      toast.success(t('settings.harnesses.cursor.apiKeySaved'))
      await refreshAuth()
      void window.app.cursorListRepositories?.()
        .then((list) => setRepos(list))
        .catch(() => undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function browserLogin() {
    if (browserLoggingIn) return
    setBrowserLoggingIn(true)
    try {
      const result = await window.app.cursorSdkLogin?.()
      const email = result?.email ? ` (${result.email})` : ''
      toast.success(t('settings.harnesses.cursor.browserLoginDone', { email }))
      await refreshAuth()
      void window.app.cursorListRepositories?.()
        .then((list) => setRepos(list))
        .catch(() => undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBrowserLoggingIn(false)
    }
  }

  async function browserLogout() {
    try {
      await window.app.cursorSdkLogout?.()
      toast.success(t('settings.harnesses.cursor.browserLogout'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function loadUsage() {
    const id = usageAgentId.trim() || providerSessionId || ''
    if (!id) {
      toast.error(t('settings.harnesses.cursor.usageEmpty'))
      return
    }
    setUsageLoading(true)
    try {
      const result = await window.app.cursorGetUsage?.(id)
      setUsage(result as UsageSnapshot)
      setUsageAgentId(id)
    } catch (error) {
      setUsage(null)
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setUsageLoading(false)
    }
  }

  async function saveRuntime() {
    setSaving(true)
    try {
      await window.app.updateCursorBaseConfig({
        runtime: cloud ? 'cloud' : 'local',
        autoCreatePR: cloud ? autoCreatePR : false,
        workOnCurrentBranch: cloud ? workOnCurrentBranch : false,
        cloudEnvType: cloud ? cloudEnvType : 'cloud',
        settingSources,
        toolPreset,
        // Named presets expand at runtime; clear stored lists so they do not stick.
        tools: undefined,
        disallowedTools: undefined,
        cloudEnvVars: cloud ? parseEnvVarsText(envVarsText) : {},
        ...(cloud && repoUrl.trim()
          ? { repos: [{ url: repoUrl.trim() }] }
          : { repos: [] }),
      })
      toast.success(
        cloud
          ? t('settings.harnesses.cursor.cloudEnabled')
          : t('settings.harnesses.cursor.localEnabled'),
      )
      void initializeHarness('cursor', { force: true })
      if (cloud) void refreshCloudAgents()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function forceRecover() {
    if (isCloudAgent) {
      toast.error(t('settings.harnesses.cursor.forceRecoverLocalOnly'))
      return
    }
    if (!activeCursorSessionId) {
      toast.error(t('settings.harnesses.cursor.forceRecoverNeedSession'))
      return
    }
    setForceRecovering(true)
    try {
      await window.app.cursorForceRecover?.(activeCursorSessionId, 'Continue.')
      toast.success(t('settings.harnesses.cursor.forceRecoverDone'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setForceRecovering(false)
    }
  }

  async function archiveAgent(agentId: string) {
    try {
      await window.app.cursorArchiveAgent?.(agentId)
      void refreshCloudAgents()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function deleteAgent(agentId: string) {
    try {
      await window.app.cursorDeleteAgent?.(agentId)
      void refreshCloudAgents()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const configuredLabel = authStatus.apiKeyName
    || authStatus.userEmail
    || t('settings.harnesses.cursor.apiKeyConfiguredAnonymous')
  const showAccount = section === 'account'
  const showPreferences = section === 'preferences'
  const showModels = section === 'models'
  const showCloud = section === 'cloud'

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      {showAccount ? <>
      <div>
        <p className="text-sm font-medium">{t('settings.harnesses.cursor.apiKeyTitle')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('settings.harnesses.cursor.apiKeyDescription')}{' '}
          <a
            className="underline underline-offset-2"
            href="https://cursor.com/dashboard/api"
            target="_blank"
            rel="noreferrer"
          >
            cursor.com/dashboard/api
          </a>
        </p>
        {authStatus.configured ? (
          <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            {t('settings.harnesses.cursor.apiKeyConfigured', { name: configuredLabel })}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
            {t('settings.harnesses.cursor.apiKeyMissing')}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={authStatus.configured ? t('settings.harnesses.cursor.apiKeyReplacePlaceholder') : 'cursor_…'}
          className="font-mono text-xs"
          autoComplete="off"
        />
        <Button type="button" size="sm" disabled={!apiKey.trim() || saving} onClick={() => void saveKey()}>
          {authStatus.configured
            ? t('settings.harnesses.cursor.replaceKey')
            : t('settings.harnesses.cursor.saveKey')}
        </Button>
      </div>

      <div className="space-y-1.5 rounded-md border border-border/60 p-2">
        <p className="text-xs text-muted-foreground">
          {t('settings.harnesses.cursor.browserLoginDescription')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={browserLoggingIn || saving}
            onClick={() => void browserLogin()}
          >
            {t('settings.harnesses.cursor.browserLogin')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={browserLoggingIn || saving}
            onClick={() => void browserLogout()}
          >
            {t('settings.harnesses.cursor.browserLogout')}
          </Button>
        </div>
      </div>
      </> : null}

      {showPreferences ? <>
      <div className="space-y-2">
        <div>
          <p className="text-sm font-medium">{t('settings.harnesses.cursor.toolPresetTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('settings.harnesses.cursor.toolPresetDescription')}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {([
            ['default', t('settings.harnesses.cursor.toolPresetDefault')],
            ['readonly', t('settings.harnesses.cursor.toolPresetReadonly')],
            ['no-shell', t('settings.harnesses.cursor.toolPresetNoShell')],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              disabled={saving}
              onClick={() => setToolPreset(id)}
              className={
                toolPreset === id
                  ? 'rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground'
                  : 'rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted'
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div>
          <p className="text-sm font-medium">{t('settings.harnesses.cursor.settingSourcesTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('settings.harnesses.cursor.settingSourcesDescription')}
          </p>
        </div>
        {([
          ['project', t('settings.harnesses.cursor.settingSourceProject')],
          ['user', t('settings.harnesses.cursor.settingSourceUser')],
          ['plugins', t('settings.harnesses.cursor.settingSourcePlugins')],
        ] as const).map(([id, label]) => (
          <div key={id} className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <Switch
              checked={settingSources.includes(id)}
              onCheckedChange={(next) => toggleSettingSource(id, next)}
              disabled={saving}
            />
          </div>
        ))}
      </div>
      </> : null}

      {showCloud ? <>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('settings.harnesses.cursor.cloudTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('settings.harnesses.cursor.cloudDescription')}
          </p>
        </div>
        <Switch checked={cloud} onCheckedChange={setCloud} disabled={saving} />
      </div>

      {cloud ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {(['cloud', 'pool', 'machine'] as const).map((env) => (
              <button
                key={env}
                type="button"
                disabled={saving}
                onClick={() => setCloudEnvType(env)}
                className={
                  cloudEnvType === env
                    ? 'rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground'
                    : 'rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted'
                }
              >
                {env}
              </button>
            ))}
          </div>
          <Input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/org/repo"
            className="font-mono text-xs"
            list="cursor-repo-suggestions"
          />
          {repos.length > 0 ? (
            <datalist id="cursor-repo-suggestions">
              {repos.map((r) => (
                <option key={r.url} value={r.url} />
              ))}
            </datalist>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">{t('settings.harnesses.cursor.autoCreatePr')}</p>
            <Switch checked={autoCreatePR} onCheckedChange={setAutoCreatePR} disabled={saving} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">{t('settings.harnesses.cursor.workOnCurrentBranch')}</p>
            <Switch
              checked={workOnCurrentBranch}
              onCheckedChange={setWorkOnCurrentBranch}
              disabled={saving}
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">{t('settings.harnesses.cursor.envVarsTitle')}</p>
            <p className="text-[11px] text-muted-foreground">
              {t('settings.harnesses.cursor.envVarsDescription')}
            </p>
            <textarea
              value={envVarsText}
              onChange={(e) => setEnvVarsText(e.target.value)}
              placeholder={t('settings.harnesses.cursor.envVarsPlaceholder')}
              rows={3}
              className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5 rounded-md border border-border/60 p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">{t('settings.harnesses.cursor.cloudAgentsTitle')}</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={cloudAgentsLoading || saving}
                onClick={() => void refreshCloudAgents()}
              >
                {t('settings.harnesses.cursor.cloudAgentsRefresh')}
              </Button>
            </div>
            {cloudAgents.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {cloudAgentsLoading ? '…' : t('settings.harnesses.cursor.cloudAgentsEmpty')}
              </p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {cloudAgents.map((agent) => (
                  <div
                    key={agent.agentId}
                    className="flex items-start justify-between gap-2 rounded px-1.5 py-1 hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{agent.name || agent.agentId}</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">{agent.agentId}</p>
                      {agent.summary ? (
                        <p className="line-clamp-2 text-[11px] text-muted-foreground">{agent.summary}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col gap-0.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-[10px]"
                        onClick={() => void archiveAgent(agent.agentId)}
                      >
                        {t('settings.harnesses.cursor.cloudAgentsArchive')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-[10px] text-destructive"
                        onClick={() => void deleteAgent(agent.agentId)}
                      >
                        {t('settings.harnesses.cursor.cloudAgentsDelete')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void saveRuntime()}>
        {t('settings.harnesses.cursor.saveRuntime')}
      </Button>
      </> : null}

      {showPreferences ? <>
      <div className="space-y-2 border-t border-border pt-3">
        <div>
          <p className="text-sm font-medium">{t('settings.harnesses.cursor.forceRecoverTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('settings.harnesses.cursor.forceRecoverDescription')}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={forceRecovering || !canForceRecover}
          onClick={() => void forceRecover()}
        >
          {t('settings.harnesses.cursor.forceRecoverAction')}
        </Button>
      </div>
      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void saveRuntime()}>
        {t('settings.harnesses.cursor.saveRuntime')}
      </Button>
      </> : null}

      {showAccount ? <>
      <div className="space-y-2 border-t border-border pt-3">
        <div>
          <p className="text-sm font-medium">{t('settings.harnesses.cursor.usageTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('settings.harnesses.cursor.usageEmpty')}
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            value={usageAgentId}
            onChange={(e) => setUsageAgentId(e.target.value)}
            placeholder={providerSessionId || 'agent-… / bc-…'}
            className="font-mono text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={usageLoading}
            onClick={() => void loadUsage()}
          >
            {t('settings.harnesses.cursor.usageRefresh')}
          </Button>
        </div>
        {usage ? (
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p>
              {t('settings.harnesses.cursor.usageTokens', {
                input: usage.usage.inputTokens,
                output: usage.usage.outputTokens,
                total: usage.usage.totalTokens,
              })}
            </p>
            {usage.cost ? (
              <p>
                {t('settings.harnesses.cursor.usageCost', {
                  charged: usage.cost.chargedCents.toFixed(2),
                  raw: usage.cost.rawCostCents.toFixed(2),
                })}
              </p>
            ) : null}
            <p className="font-mono text-[10px]">{usage.runs.length} run(s)</p>
          </div>
        ) : null}
      </div>
      </> : null}

      {showModels ? (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          {t('settings.harnesses.cursor.modelsDescription')}
        </p>
        <ProviderModelsList
          items={modelListItems}
          providerBrand="cursor"
          emptyMessage={t('settings.harnesses.cursor.modelsEmpty')}
          refreshing={modelsSaving}
          onRefresh={() => void refreshCursorModels()}
          onToggle={(id, enabled) => {
            const nextDisabled = enabled
              ? disabledModelIds.filter((existing) => existing !== id)
              : [...new Set([...disabledModelIds, id])]
            void persistDisabledModelIds(nextDisabled)
          }}
        />
      </div>
      ) : null}
    </div>
  )
}
