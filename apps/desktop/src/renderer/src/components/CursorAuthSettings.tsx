import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Input } from '@superone/ui/components/ui/input'
import { Button } from '@superone/ui/components/ui/button'
import { Switch } from '@superone/ui/components/ui/switch'
import { useChatStore } from '@/stores/chat'

type CursorAuthStatus = {
  configured: boolean
  apiKeyName: string | null
  userEmail: string | null
}

/**
 * Cursor User API Key + optional cloud runtime controls.
 * Shown on Settings → Harnesses when the Cursor catalog harness is selected.
 */
export function CursorAuthSettings({ onAuthChanged }: { onAuthChanged?: () => void }) {
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
  const initializeHarness = useChatStore((s) => s.initializeHarness)

  const refreshAuthStatus = useCallback(async () => {
    try {
      const status = await window.app.getCursorAuthStatus()
      setAuthStatus(status)
    } catch {
      setAuthStatus({ configured: false, apiKeyName: null, userEmail: null })
    }
  }, [])

  useEffect(() => {
    void refreshAuthStatus()
    void window.app.cursorListRepositories?.()
      .then((list) => setRepos(list))
      .catch(() => setRepos([]))
  }, [refreshAuthStatus])

  async function refreshAuth() {
    try {
      await window.app.probeHarness?.('cursor')
    } catch {
      /* probe may fail until key validates against Cursor API */
    }
    // Force re-probe models — initializeHarness is otherwise once-per-session.
    await initializeHarness('cursor', { force: true })
    await refreshAuthStatus()
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

  async function saveRuntime() {
    setSaving(true)
    try {
      await window.app.updateCursorBaseConfig({
        runtime: cloud ? 'cloud' : 'local',
        autoCreatePR: cloud ? autoCreatePR : false,
        workOnCurrentBranch: cloud ? workOnCurrentBranch : false,
        cloudEnvType: cloud ? cloudEnvType : 'cloud',
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const configuredLabel = authStatus.apiKeyName
    || authStatus.userEmail
    || t('settings.harnesses.cursor.apiKeyConfiguredAnonymous')

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
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

      <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
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
        </div>
      ) : null}

      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void saveRuntime()}>
        {t('settings.harnesses.cursor.saveRuntime')}
      </Button>
    </div>
  )
}
