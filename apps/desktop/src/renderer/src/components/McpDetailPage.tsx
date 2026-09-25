import { useState, type ReactNode } from 'react'
import { ArrowLeft, Trash2, ShieldAlert, Package, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Badge } from '@superone/ui/components/ui/badge'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { McpIcon } from './McpPage'
import { SettingsCard, SettingsRow, SettingsSection, settingsRowClassName } from '@/components/settings/SettingsSection'
import type { McpServerConfig, McpServerInfo, McpServerMeta, McpToolInfo } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'

/** Back link plus server identity; shared by configured and claude.ai server detail views. */
export function McpDetailHeader({ icon, name, statusDotClass, badges, subtitle, trailing }: {
  icon: ReactNode
  name: string
  statusDotClass: string
  badges?: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
}) {
  const { t } = useTranslation()
  const { selectMcp } = useSettingsStore()
  return (
    <div>
      <button
        onClick={() => selectMcp(null)}
        className="mb-3 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        {t('common.back')}
      </button>
      <div className="flex items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-base font-semibold">{name}</h2>
            <span className={cn('size-2 shrink-0 rounded-full', statusDotClass)} />
            {badges}
          </div>
          {subtitle && <div className="mt-0.5 flex min-w-0 items-center gap-2">{subtitle}</div>}
        </div>
        {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
      </div>
    </div>
  )
}

/** The server's tool list, one row per tool, or a muted line explaining why there are none. */
export function McpToolsSection({ tools, toolCount, emptyText, describe }: {
  tools: McpToolInfo[]
  toolCount?: number
  emptyText: string
  /** Fallback description lookup (probe meta is more reliable than SDK status). */
  describe?: (tool: McpToolInfo) => string | undefined
}) {
  const { t } = useTranslation()
  return (
    <SettingsSection title={t('resources.mcp.tools')} description={toolCount != null ? `(${toolCount})` : undefined}>
      {tools.length > 0 ? (
        tools.map((tool) => {
          const desc = tool.description || describe?.(tool)
          return (
            <SettingsRow
              key={tool.name}
              label={<span className="font-mono break-all">{tool.name}</span>}
              description={desc}
            />
          )
        })
      ) : (
        <p className={cn(settingsRowClassName, 'text-sm text-muted-foreground')}>{emptyText}</p>
      )}
    </SettingsSection>
  )
}

function ConfigField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={settingsRowClassName}>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

export function McpDetailPage({ config, status, meta }: { config: McpServerConfig; status?: McpServerInfo; meta?: McpServerMeta }) {
  const { t } = useTranslation()
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  const { selectMcp, saveMcpConfig, deleteMcpConfig, checkMcpServers, mcpbInstalled, uninstallMcpb, revealMcpb } = useSettingsStore()
  const bundleProvider = settingsProvider === 'dsh' ? null : settingsProvider === 'codex' ? 'codex' : 'claude'
  const bundle = bundleProvider
    ? mcpbInstalled.find((b) => b.meta.name === config.name && b.meta.provider === bundleProvider)
    : undefined
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)

  // Editable fields
  const [command, setCommand] = useState(config.command ?? '')
  const [args, setArgs] = useState((config.args ?? []).join(' '))
  const [env, setEnv] = useState(
    Object.entries(config.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')
  )
  const [url, setUrl] = useState(config.url ?? '')
  const [headers, setHeaders] = useState(
    Object.entries(config.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n')
  )

  const parseHeadersInput = (value: string): Record<string, string> => {
    const parsed: Record<string, string> = {}
    if (!value.trim()) return parsed
    for (const line of value.trim().split('\n')) {
      const idx = line.indexOf(':')
      if (idx > 0) parsed[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
    return parsed
  }

  const handleSave = async () => {
    if (config.type === 'http' || config.type === 'sse') {
      await saveMcpConfig(config.name, { type: config.type, url: url.trim(), headers: parseHeadersInput(headers) }, config.scope)
    } else {
      const parsedArgs = args.trim() ? args.trim().split(/\s+/) : []
      const parsedEnv: Record<string, string> = {}
      if (env.trim()) {
        for (const line of env.trim().split('\n')) {
          const idx = line.indexOf('=')
          if (idx > 0) parsedEnv[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
        }
      }
      await saveMcpConfig(config.name, { type: 'stdio', command: command.trim(), args: parsedArgs, env: parsedEnv }, config.scope)
    }
    setEditing(false)
  }

  const handleDelete = async () => {
    if (bundle) {
      await uninstallMcpb(config.name)
    } else {
      await deleteMcpConfig(config.name, config.scope)
    }
    selectMcp(null)
  }

  const handleReveal = async () => {
    if (!bundle) return
    try { await revealMcpb(config.name) } catch { /* ignore */ }
  }

  const handleAuthorize = async () => {
    if (config.type !== 'http' && config.type !== 'sse') return
    const serverUrl = url.trim() || config.url?.trim() || ''
    if (!serverUrl) return

    setAuthorizing(true)
    try {
      const verifiedHeaders = await window.app.oauthAuthorize(serverUrl, parseHeadersInput(headers), config.type)
      await saveMcpConfig(config.name, { type: config.type, url: serverUrl, headers: verifiedHeaders }, config.scope)
      await checkMcpServers()
    } catch {
      // ignore — status will reflect the result
    }
    setAuthorizing(false)
  }

  const inputClass = 'w-full rounded-md border border-border bg-background px-2.5 py-1 text-sm outline-none focus:border-ring font-mono'
  const valueClass = 'text-sm font-mono text-foreground break-all'
  const tools = status?.tools ?? []
  const isConnected = status?.status === 'connected'
  const needsAuth = status?.status === 'needs-auth'

  // Build description lookup from probe meta (more reliable than SDK status)
  const metaToolMap = new Map(meta?.tools?.map((t) => [t.name, t.description]) ?? [])

  return (
    <div className="space-y-5">
      <McpDetailHeader
        icon={<McpIcon name={config.name} meta={meta} bundle={bundle} size="md" />}
        name={config.name}
        statusDotClass={isConnected ? 'bg-success' : needsAuth ? 'bg-warning' : 'bg-error'}
        badges={bundle && (
          <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
            <Package className="size-2.5" />
            {t('resources.mcp.detail.bundleBadge', { version: bundle.meta.version })}
          </Badge>
        )}
        subtitle={meta?.description ? (
          <span className="text-xs text-muted-foreground">{meta.description}</span>
        ) : (
          <>
            <Badge variant="secondary" className="text-[10px]">{config.scope}</Badge>
            <Badge variant="secondary" className="text-[10px]">{config.type}</Badge>
          </>
        )}
        trailing={bundle && (
          <Button size="sm" variant="ghost" onClick={handleReveal} className="h-7">
            <FolderOpen className="size-3.5" />
            {t('resources.mcp.detail.bundleReveal')}
          </Button>
        )}
      />

      {/* Auth banner */}
      {needsAuth && (
        <SettingsCard className="bg-warning/10">
          <SettingsRow
            label={
              <span className="flex items-center gap-2">
                <ShieldAlert className="size-4 shrink-0 text-warning" />
                {t('resources.mcp.detail.authTitle')}
              </span>
            }
            description={
              <>
                {t('resources.mcp.detail.authDescription')}
                {status?.error && <span className="ml-1">({status.error})</span>}
              </>
            }
          >
            <Button size="sm" className="h-7" onClick={handleAuthorize} disabled={authorizing}>
              {authorizing ? t('resources.mcp.detail.authorizing') : t('resources.mcp.detail.authorize')}
            </Button>
          </SettingsRow>
        </SettingsCard>
      )}

      {/* Config section */}
      <SettingsSection
        title={t('resources.mcp.detail.configuration')}
        actions={!editing ? (
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(true)}>{t('resources.mcp.detail.edit')}</Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
            <Button size="sm" className="h-7" onClick={handleSave}>{t('common.save')}</Button>
          </>
        )}
      >
        {config.type === 'stdio' ? (
          <>
            <ConfigField label={t('resources.mcp.detail.commandLabel')}>
              {editing ? (
                <input className={inputClass} value={command} onChange={(e) => setCommand(e.target.value)} />
              ) : (
                <p className={valueClass}>{config.command}</p>
              )}
            </ConfigField>
            <ConfigField label={t('resources.mcp.detail.argsLabel')}>
              {editing ? (
                <input className={inputClass} value={args} onChange={(e) => setArgs(e.target.value)} />
              ) : (
                <p className={valueClass}>{(config.args ?? []).join(' ') || '—'}</p>
              )}
            </ConfigField>
            <ConfigField label={t('resources.mcp.detail.environmentLabel')}>
              {editing ? (
                <textarea className={cn(inputClass, 'h-20 resize-none')} value={env} onChange={(e) => setEnv(e.target.value)} placeholder="KEY=VALUE" />
              ) : (
                <div className={valueClass}>
                  {Object.keys(config.env ?? {}).length > 0
                    ? Object.entries(config.env!).map(([k, v]) => (
                        <p key={k}>{k}={v}</p>
                      ))
                    : <p className="text-muted-foreground">—</p>
                  }
                </div>
              )}
            </ConfigField>
          </>
        ) : (
          <>
            <ConfigField label={t('resources.mcp.detail.urlLabel')}>
              {editing ? (
                <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} />
              ) : (
                <p className={valueClass}>{config.url}</p>
              )}
            </ConfigField>
            <ConfigField label={t('resources.mcp.detail.headersLabel')}>
              {editing ? (
                <textarea className={cn(inputClass, 'h-20 resize-none')} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="Key: Value" />
              ) : (
                <div className="text-sm font-mono text-foreground">
                  {Object.keys(config.headers ?? {}).length > 0
                    ? Object.entries(config.headers!).map(([k, v]) => (
                        <p key={k} className="truncate">{k}: {v}</p>
                      ))
                    : <p className="text-muted-foreground">—</p>
                  }
                </div>
              )}
            </ConfigField>
          </>
        )}
      </SettingsSection>

      {/* Tools section */}
      <McpToolsSection
        tools={tools}
        toolCount={status?.toolCount}
        emptyText={isConnected ? t('resources.mcp.noToolsConnected') : t('resources.mcp.noToolsDisconnected')}
        describe={(tool) => metaToolMap.get(tool.name)}
      />

      {/* Uninstall */}
      <SettingsCard>
        <SettingsRow
          label={<span className="text-destructive">{t('resources.mcp.detail.uninstallTitle')}</span>}
          description={t('resources.mcp.detail.uninstallDescription')}
        >
          {confirmDelete ? (
            <>
              <span className="text-xs text-muted-foreground">{t('resources.mcp.detail.confirmQuestion')}</span>
              <Button size="sm" variant="destructive" className="h-7" onClick={handleDelete}>
                <Trash2 className="size-3.5" />
                {t('resources.mcp.detail.confirm')}
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
            </>
          ) : (
            <Button size="sm" variant="destructive" className="h-7" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-3.5" />
              {t('resources.mcp.detail.uninstall')}
            </Button>
          )}
        </SettingsRow>
      </SettingsCard>
    </div>
  )
}
