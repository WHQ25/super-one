import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Input } from '@superone/ui/components/ui/input'
import { Button } from '@superone/ui/components/ui/button'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import { buildCatalogModelIndex, normalizeModelId } from '@superone/shared/platform-registry'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { ProviderModelsList } from './providers/ProviderModelsList'
import { SettingsRow, SettingsSection, settingsRowClassName } from './settings/SettingsSection'
import { SettingsSegmentedControl } from './settings/SettingsSegmentedControl'

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

  const saveRuntimeButton = (
    <div className="flex justify-end">
      <Button type="button" size="sm" variant="outline" className="h-7" disabled={saving} onClick={() => void saveRuntime()}>
        {t('settings.harnesses.cursor.saveRuntime')}
      </Button>
    </div>
  )

  return (
    <div className="space-y-5">
      {showAccount ? <>
      <SettingsSection title={t('settings.harnesses.cursor.apiKeyTitle')}>
        <SettingsRow
          label={authStatus.configured ? (
            <span className="text-success">
              {t('settings.harnesses.cursor.apiKeyConfigured', { name: configuredLabel })}
            </span>
          ) : (
            <span className="text-warning">{t('settings.harnesses.cursor.apiKeyMissing')}</span>
          )}
          description={<>
            {t('settings.harnesses.cursor.apiKeyDescription')}{' '}
            <a
              className="underline underline-offset-2"
              href="https://cursor.com/dashboard/api"
              target="_blank"
              rel="noreferrer"
            >
              cursor.com/dashboard/api
            </a>
          </>}
          footer={(
            <div className="flex gap-2">
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={authStatus.configured ? t('settings.harnesses.cursor.apiKeyReplacePlaceholder') : 'cursor_…'}
                className="h-7 bg-background font-mono text-xs"
                autoComplete="off"
              />
              <Button type="button" size="sm" className="h-7" disabled={!apiKey.trim() || saving} onClick={() => void saveKey()}>
                {authStatus.configured
                  ? t('settings.harnesses.cursor.replaceKey')
                  : t('settings.harnesses.cursor.saveKey')}
              </Button>
            </div>
          )}
        />
        <div className={cn(settingsRowClassName, 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2')}>
          <p className="min-w-0 flex-1 basis-56 text-xs text-muted-foreground">
            {t('settings.harnesses.cursor.browserLoginDescription')}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7"
              disabled={browserLoggingIn || saving}
              onClick={() => void browserLogout()}
            >
              {t('settings.harnesses.cursor.browserLogout')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              disabled={browserLoggingIn || saving}
              onClick={() => void browserLogin()}
            >
              {t('settings.harnesses.cursor.browserLogin')}
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.harnesses.cursor.usageTitle')}>
        <div className={settingsRowClassName}>
          <p className="text-xs text-muted-foreground">{t('settings.harnesses.cursor.usageEmpty')}</p>
          <div className="mt-2 flex gap-2">
            <Input
              value={usageAgentId}
              onChange={(e) => setUsageAgentId(e.target.value)}
              placeholder={providerSessionId || 'agent-… / bc-…'}
              className="h-7 bg-background font-mono text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              disabled={usageLoading}
              onClick={() => void loadUsage()}
            >
              {t('settings.harnesses.cursor.usageRefresh')}
            </Button>
          </div>
          {usage ? (
            <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
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
      </SettingsSection>
      </> : null}

      {showPreferences ? <>
      <SettingsSection>
        <SettingsRow
          label={t('settings.harnesses.cursor.toolPresetTitle')}
          description={t('settings.harnesses.cursor.toolPresetDescription')}
        >
          <SettingsSegmentedControl
            value={toolPreset}
            onChange={setToolPreset}
            disabled={saving}
            label={t('settings.harnesses.cursor.toolPresetTitle')}
            options={[
              { value: 'default', label: t('settings.harnesses.cursor.toolPresetDefault') },
              { value: 'readonly', label: t('settings.harnesses.cursor.toolPresetReadonly') },
              { value: 'no-shell', label: t('settings.harnesses.cursor.toolPresetNoShell') },
            ]}
          />
        </SettingsRow>
        <SettingsRow
          label={t('settings.harnesses.cursor.settingSourcesTitle')}
          description={t('settings.harnesses.cursor.settingSourcesDescription')}
          footer={(
            <div className="space-y-2">
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
          )}
        />
        <SettingsRow
          label={t('settings.harnesses.cursor.forceRecoverTitle')}
          description={t('settings.harnesses.cursor.forceRecoverDescription')}
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            disabled={forceRecovering || !canForceRecover}
            onClick={() => void forceRecover()}
          >
            {t('settings.harnesses.cursor.forceRecoverAction')}
          </Button>
        </SettingsRow>
      </SettingsSection>
      {saveRuntimeButton}
      </> : null}

      {showCloud ? <>
      <SettingsSection>
        <SettingsRow
          label={t('settings.harnesses.cursor.cloudTitle')}
          description={t('settings.harnesses.cursor.cloudDescription')}
        >
          <Switch checked={cloud} onCheckedChange={setCloud} disabled={saving} />
        </SettingsRow>
        {cloud ? <>
          <div className={cn(settingsRowClassName, 'space-y-2')}>
            <SettingsSegmentedControl
              value={cloudEnvType}
              onChange={setCloudEnvType}
              disabled={saving}
              label={t('settings.harnesses.cursor.cloudTitle')}
              options={(['cloud', 'pool', 'machine'] as const).map((env) => ({ value: env, label: env }))}
            />
            <Input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
              className="h-7 bg-background font-mono text-xs"
              list="cursor-repo-suggestions"
            />
            {repos.length > 0 ? (
              <datalist id="cursor-repo-suggestions">
                {repos.map((r) => (
                  <option key={r.url} value={r.url} />
                ))}
              </datalist>
            ) : null}
          </div>
          <SettingsRow label={t('settings.harnesses.cursor.autoCreatePr')}>
            <Switch checked={autoCreatePR} onCheckedChange={setAutoCreatePR} disabled={saving} />
          </SettingsRow>
          <SettingsRow label={t('settings.harnesses.cursor.workOnCurrentBranch')}>
            <Switch
              checked={workOnCurrentBranch}
              onCheckedChange={setWorkOnCurrentBranch}
              disabled={saving}
            />
          </SettingsRow>
          <SettingsRow
            label={t('settings.harnesses.cursor.envVarsTitle')}
            description={t('settings.harnesses.cursor.envVarsDescription')}
            footer={(
              <textarea
                value={envVarsText}
                onChange={(e) => setEnvVarsText(e.target.value)}
                placeholder={t('settings.harnesses.cursor.envVarsPlaceholder')}
                rows={3}
                className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
                disabled={saving}
              />
            )}
          />
        </> : null}
      </SettingsSection>

      {cloud ? (
        <SettingsSection
          title={t('settings.harnesses.cursor.cloudAgentsTitle')}
          actions={(
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7"
              disabled={cloudAgentsLoading || saving}
              onClick={() => void refreshCloudAgents()}
            >
              {t('settings.harnesses.cursor.cloudAgentsRefresh')}
            </Button>
          )}
        >
          {cloudAgents.length === 0 ? (
            <p className={cn(settingsRowClassName, 'text-xs text-muted-foreground')}>
              {cloudAgentsLoading ? '…' : t('settings.harnesses.cursor.cloudAgentsEmpty')}
            </p>
          ) : (
            cloudAgents.map((agent) => (
              <div
                key={agent.agentId}
                className={cn(settingsRowClassName, 'flex items-start justify-between gap-3')}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{agent.name || agent.agentId}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{agent.agentId}</p>
                  {agent.summary ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{agent.summary}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => void archiveAgent(agent.agentId)}
                  >
                    {t('settings.harnesses.cursor.cloudAgentsArchive')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive"
                    onClick={() => void deleteAgent(agent.agentId)}
                  >
                    {t('settings.harnesses.cursor.cloudAgentsDelete')}
                  </Button>
                </div>
              </div>
            ))
          )}
        </SettingsSection>
      ) : null}
      {saveRuntimeButton}
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
