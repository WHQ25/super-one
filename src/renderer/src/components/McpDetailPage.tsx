import { useState } from 'react'
import { ArrowLeft, Trash2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useSettingsStore } from '@/stores/settings'
import { McpIcon } from './McpPage'
import type { McpServerConfig, McpServerInfo, McpServerMeta } from '../../../shared/agent-types'
import { cn } from '@/lib/utils'

export function McpDetailPage({ config, status, meta }: { config: McpServerConfig; status?: McpServerInfo; meta?: McpServerMeta }) {
  const { selectMcp, saveMcpConfig, deleteMcpConfig, reconnectMcpServer, fetchMcpStatus } = useSettingsStore()
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

  const handleSave = async () => {
    if (config.type === 'http') {
      const parsedHeaders: Record<string, string> = {}
      if (headers.trim()) {
        for (const line of headers.trim().split('\n')) {
          const idx = line.indexOf(':')
          if (idx > 0) parsedHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
        }
      }
      await saveMcpConfig(config.name, { type: 'http', url: url.trim(), headers: parsedHeaders }, config.scope)
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
    await deleteMcpConfig(config.name, config.scope)
    selectMcp(null)
  }

  const handleAuthorize = async () => {
    setAuthorizing(true)
    try {
      await reconnectMcpServer(config.name)
      // Poll status for a few seconds to pick up auth result
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        await fetchMcpStatus()
      }
    } catch {
      // ignore — status will reflect the result
    } finally {
      setAuthorizing(false)
    }
  }

  const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring font-mono'
  const tools = status?.tools ?? []
  const isConnected = status?.status === 'connected'
  const needsAuth = status?.status === 'needs-auth'

  // Build description lookup from probe meta (more reliable than SDK status)
  const metaToolMap = new Map(meta?.tools?.map((t) => [t.name, t.description]) ?? [])

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => selectMcp(null)}
          className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3" />
          Back
        </button>
        <div className="flex items-center gap-3">
          <McpIcon name={config.name} meta={meta} size="md" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{config.name}</h2>
              <span className={cn('size-2 rounded-full', isConnected ? 'bg-green-500' : needsAuth ? 'bg-yellow-500' : 'bg-red-500')} />
            </div>
            <div className="flex items-center gap-2">
              {meta?.description && (
                <span className="text-xs text-muted-foreground">{meta.description}</span>
              )}
              {!meta?.description && (
                <>
                  <Badge variant="secondary" className="text-[10px]">{config.scope}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{config.type}</Badge>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Auth banner */}
        {needsAuth && (
          <div className="flex items-center gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
            <ShieldAlert className="size-5 shrink-0 text-yellow-500" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Authorization Required</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                This server requires OAuth authorization to connect.
                {status?.error && <span className="ml-1">({status.error})</span>}
              </p>
            </div>
            <Button size="sm" onClick={handleAuthorize} disabled={authorizing}>
              {authorizing ? 'Authorizing...' : 'Authorize'}
            </Button>
          </div>
        )}

        {/* Config section */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">Configuration</h3>
            {!editing ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" onClick={handleSave}>Save</Button>
              </div>
            )}
          </div>

          {config.type === 'stdio' ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Command</label>
                {editing ? (
                  <input className={inputClass} value={command} onChange={(e) => setCommand(e.target.value)} />
                ) : (
                  <p className="text-sm font-mono text-foreground">{config.command}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Args</label>
                {editing ? (
                  <input className={inputClass} value={args} onChange={(e) => setArgs(e.target.value)} />
                ) : (
                  <p className="text-sm font-mono text-foreground">{(config.args ?? []).join(' ') || '—'}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Environment</label>
                {editing ? (
                  <textarea className={cn(inputClass, 'h-20 resize-none')} value={env} onChange={(e) => setEnv(e.target.value)} placeholder="KEY=VALUE" />
                ) : (
                  <div className="text-sm font-mono text-foreground">
                    {Object.keys(config.env ?? {}).length > 0
                      ? Object.entries(config.env!).map(([k, v]) => (
                          <p key={k}>{k}={v}</p>
                        ))
                      : <p className="text-muted-foreground">—</p>
                    }
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">URL</label>
                {editing ? (
                  <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} />
                ) : (
                  <p className="text-sm font-mono text-foreground">{config.url}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Headers</label>
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
              </div>
            </div>
          )}
        </div>

        {/* Tools section */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">
            Tools
            {status?.toolCount != null && (
              <span className="ml-2 text-xs text-muted-foreground">({status.toolCount})</span>
            )}
          </h3>
          {tools.length > 0 ? (
            <div className="space-y-2">
              {tools.map((tool) => {
                const desc = tool.description || metaToolMap.get(tool.name)
                return (
                  <div key={tool.name} className="rounded-md border border-border px-3 py-2">
                    <p className="text-sm font-medium font-mono">{tool.name}</p>
                    {desc && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isConnected ? 'No tools available' : 'Connect the server to see available tools'}
            </p>
          )}
        </div>

        {/* Uninstall */}
        <div className="rounded-lg border border-destructive/30 bg-card p-4">
          <h3 className="mb-1 text-sm font-medium text-destructive">Uninstall</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Remove this MCP server configuration. This cannot be undone.
          </p>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Are you sure?</span>
              <Button size="sm" variant="destructive" onClick={handleDelete}>
                <Trash2 className="mr-1 size-3" />
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="mr-1 size-3" />
              Uninstall Server
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
