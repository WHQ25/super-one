import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Plus, ChevronRight, Clipboard, X, ArrowLeft, Check, Library, RefreshCw, Trash2, Package, PackagePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { McpDetailPage } from './McpDetailPage'
import { McpbInstallDialog } from './McpbInstallDialog'
import type { McpLibraryEntry, McpServerConfig, McpServerInfo, McpServerMeta } from '../../../shared/agent-types'
import type { McpbInstalledEntry } from '../../../shared/mcpb-types'
import { cn } from '@/lib/utils'

const MCPB_EXT = '.mcpb'

function getMcpbDropPath(e: DragEvent): string | null {
  for (let i = 0; i < e.dataTransfer.files.length; i++) {
    const file = e.dataTransfer.files[i]
    const path = window.app.getPathForFile(file)
    if (path.endsWith(MCPB_EXT)) return path
  }
  return null
}

export function McpIcon({ name, meta, size = 'sm' }: { name: string; meta?: McpServerMeta; size?: 'sm' | 'md' }) {
  const icon = meta?.icons?.[0]
  const sizeClass = size === 'md' ? 'size-10 text-base' : 'size-9 text-sm'

  if (icon?.src) {
    return (
      <img
        src={icon.src}
        alt={name}
        className={cn('shrink-0 rounded-full object-cover', size === 'md' ? 'size-10' : 'size-9')}
      />
    )
  }

  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-full bg-muted font-medium uppercase text-muted-foreground', sizeClass)}>
      {name[0]}
    </div>
  )
}

function ServerCard({
  config,
  status,
  meta,
  bundle,
  interactive = true,
  statusMode = 'live',
}: {
  config: McpServerConfig
  status?: McpServerInfo
  meta?: McpServerMeta
  bundle?: McpbInstalledEntry
  interactive?: boolean
  statusMode?: 'live' | 'managed'
}) {
  const { t } = useTranslation()
  const { selectMcp, toggleMcpConfig, checkMcpServers } = useSettingsStore()
  const [reconnecting, setReconnecting] = useState(false)
  const isManaged = statusMode === 'managed'
  const serverStatus = status?.status ?? (config.disabled ? 'disabled' : isManaged ? 'connected' : 'pending')
  const isEnabled = !config.disabled
  const isConnected = serverStatus === 'connected'
  const isPending = serverStatus === 'pending' || reconnecting
  const isFailed = isEnabled && !isConnected && !isPending
  const toolCount = status?.toolCount ?? 0

  const dotColor = isManaged
    ? (config.disabled ? 'bg-red-500' : 'bg-green-500')
    : (isConnected ? 'bg-green-500' : isPending ? 'bg-yellow-500' : 'bg-red-500')
  const statusText = config.disabled
    ? t('resources.mcp.statusDisabled')
    : isManaged
      ? config.type
      : isPending
        ? t('resources.mcp.statusConnecting')
        : isFailed && status?.error
          ? status.error
          : t('resources.mcp.toolsCount', { count: toolCount })

  const handleReconnect = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setReconnecting(true)
    try {
      await checkMcpServers()
    } finally {
      setReconnecting(false)
    }
  }

  return (
    <div
      onClick={() => interactive && selectMcp(config.name)}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors',
        interactive && 'cursor-pointer hover:bg-accent/50',
        config.disabled && 'opacity-50'
      )}
    >
      <McpIcon name={config.name} meta={meta} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate">{config.name}</p>
          {bundle && (
            <Badge variant="outline" className="shrink-0 gap-1 px-1.5 py-0 text-[10px] font-normal">
              <Package className="size-2.5" />
              v{bundle.meta.version}
            </Badge>
          )}
          {!isManaged && isFailed && (
            <button
              onClick={handleReconnect}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn('size-3', reconnecting && 'animate-spin')} />
            </button>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={cn('size-2 shrink-0 rounded-full', dotColor)} />
          <span className="text-xs text-muted-foreground">{statusText}</span>
        </div>
      </div>
      {interactive && (
        <>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={isEnabled}
              onCheckedChange={(checked) => toggleMcpConfig(config.name, !checked, config.scope)}
            />
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </>
      )}
    </div>
  )
}

interface KvRow {
  key: string
  value: string
}

function KvRows({ rows, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value' }: {
  rows: KvRow[]
  onChange: (rows: KvRow[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring'
  if (rows.length === 0) return null
  return (
    <div className="space-y-2">
      {rows.map((row, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            className={cn(inputClass, '!w-auto flex-1')}
            value={row.key}
            onChange={(e) => onChange(rows.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)))}
            placeholder={keyPlaceholder}
          />
          <input
            className={cn(inputClass, '!w-auto flex-1')}
            value={row.value}
            onChange={(e) => onChange(rows.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))}
            placeholder={valuePlaceholder}
          />
          <button type="button" onClick={() => onChange(rows.filter((_, i) => i !== idx))} className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

function parseClipboardConfig(text: string): {
  name?: string
  type?: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string
  env?: KvRow[]
  url?: string
  headers?: KvRow[]
} | null {
  let trimmed = text.trim()
  // Strip trailing comma (common when copying a fragment from JSON)
  if (trimmed.endsWith(',')) trimmed = trimmed.slice(0, -1).trimEnd()

  // Try JSON parse (full object)
  try {
    const json = JSON.parse(trimmed)

    // Format: { "mcpServers": { "name": { ... } } }
    if (json.mcpServers && typeof json.mcpServers === 'object') {
      const entries = Object.entries(json.mcpServers)
      if (entries.length === 0) return null
      const [name, raw] = entries[0] as [string, Record<string, unknown>]
      return extractFromRaw(name, raw)
    }

    // Format: { "name": { command/url/... } } — a single entry object
    const keys = Object.keys(json)
    if (keys.length === 1 && typeof json[keys[0]] === 'object' && json[keys[0]] !== null) {
      const raw = json[keys[0]] as Record<string, unknown>
      if (raw.command || raw.url || raw.type) {
        return extractFromRaw(keys[0], raw)
      }
    }

    // Format: single server config object with a type/command/url field
    if (json.type || json.command || json.url) {
      return extractFromRaw(undefined, json)
    }
  } catch {
    // not valid JSON — try wrapping as "name": { ... } fragment
  }

  // Format: "name": { ... } — a JSON fragment (key-value pair without outer braces)
  const fragmentMatch = trimmed.match(/^"([^"]+)"\s*:\s*\{/)
  if (fragmentMatch) {
    try {
      const json = JSON.parse(`{${trimmed}}`)
      const name = fragmentMatch[1]
      const raw = json[name] as Record<string, unknown>
      if (raw && (raw.command || raw.url || raw.type)) {
        return extractFromRaw(name, raw)
      }
    } catch {
      // invalid fragment
    }
  }

  // Plain URL
  try {
    const urlObj = new URL(trimmed)
    if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
      return { url: trimmed, type: 'http' }
    }
  } catch {
    // not a URL
  }

  return null
}

function extractFromRaw(name: string | undefined, raw: Record<string, unknown>): ReturnType<typeof parseClipboardConfig> {
  const result: NonNullable<ReturnType<typeof parseClipboardConfig>> = {}
  if (name) result.name = name

  const t = raw.type as string | undefined
  if (t === 'http' || t === 'sse') {
    result.type = t
    if (raw.url) result.url = String(raw.url)
    if (raw.headers && typeof raw.headers === 'object') {
      result.headers = Object.entries(raw.headers as Record<string, string>).map(([key, value]) => ({ key, value: String(value) }))
    }
  } else {
    result.type = 'stdio'
    if (raw.command) result.command = String(raw.command)
    if (Array.isArray(raw.args)) result.args = (raw.args as string[]).join(' ')
    if (raw.env && typeof raw.env === 'object') {
      result.env = Object.entries(raw.env as Record<string, string>).map(([key, value]) => ({ key, value: String(value) }))
    }
  }

  return result
}

function AddServerForm({
  onClose,
  onBundleSelected,
  onBundleRejected,
}: {
  onClose: () => void
  onBundleSelected: (path: string) => void
  onBundleRejected: () => void
}) {
  const { t } = useTranslation()
  const { saveMcpConfig } = useSettingsStore()
  const [name, setName] = useState('')
  const [type, setType] = useState<'stdio' | 'http' | 'sse'>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState<KvRow[]>([])
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<KvRow[]>([])
  const [scope, setScope] = useState<'user' | 'project'>('user')
  const [authorizing, setAuthorizing] = useState(false)
  const [verified, setVerified] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [isBundleDragOver, setIsBundleDragOver] = useState(false)
  const bundleInputRef = useRef<HTMLInputElement | null>(null)

  const handleBundleDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      setIsBundleDragOver(true)
    }
  }

  const handleBundleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsBundleDragOver(false)
  }

  const handleBundleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsBundleDragOver(false)
    const path = getMcpbDropPath(e)
    if (path) {
      onBundleSelected(path)
    } else {
      onBundleRejected()
    }
  }

  const handleBundleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const path = window.app.getPathForFile(file)
      if (path.endsWith(MCPB_EXT)) onBundleSelected(path)
      else onBundleRejected()
    }
    e.target.value = ''
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const parsed = parseClipboardConfig(text)
      if (!parsed) {
        setError(t('resources.mcp.form.clipboardInvalid'))
        return
      }
      if (parsed.name) setName(parsed.name)
      if (parsed.type) setType(parsed.type)
      if (parsed.command) setCommand(parsed.command)
      if (parsed.args) setArgs(parsed.args)
      if (parsed.env) setEnv(parsed.env)
      if (parsed.url) setUrl(parsed.url)
      if (parsed.headers) setHeaders(parsed.headers)
      setError('')
    } catch {
      setError(t('resources.mcp.form.clipboardFailed'))
    }
  }

  const kvToRecord = (rows: KvRow[]): Record<string, string> => {
    const result: Record<string, string> = {}
    for (const r of rows) {
      if (r.key.trim()) result[r.key.trim()] = r.value.trim()
    }
    return result
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) return

    if (type === 'http' || type === 'sse') {
      if (!url.trim()) return

      // Verify connection & try OAuth if needed
      setAuthorizing(true)
      setVerified(false)
      let verifiedHeaders: Record<string, string>
      try {
        verifiedHeaders = await window.app.oauthAuthorize(url.trim(), kvToRecord(headers), type)
      } catch (e) {
        setError(e instanceof Error ? e.message : t('resources.mcp.form.verificationFailed'))
        setAuthorizing(false)
        return
      }
      setAuthorizing(false)
      setVerified(true)
      setAdding(true)

      await saveMcpConfig(name.trim(), { type, url: url.trim(), headers: verifiedHeaders }, scope)
    } else {
      if (!command.trim()) return
      setAdding(true)
      const parsedArgs = args.trim() ? args.trim().split(/\s+/) : []
      await saveMcpConfig(name.trim(), { type: 'stdio', command: command.trim(), args: parsedArgs, env: kvToRecord(env) }, scope)
    }
    onClose()
  }

  const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring'
  const isValid = name.trim() && (type !== 'stdio' ? url.trim() : command.trim())

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">{t('resources.mcp.form.title')}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={handlePaste} className="gap-1.5 text-xs">
          <Clipboard className="size-3.5" />
          {t('resources.mcp.form.paste')}
        </Button>
      </div>
      <input
        ref={bundleInputRef}
        type="file"
        accept=".mcpb"
        className="hidden"
        onChange={handleBundleFileInput}
      />
      <button
        type="button"
        onClick={() => bundleInputRef.current?.click()}
        onDragOver={handleBundleDragOver}
        onDragLeave={handleBundleDragLeave}
        onDrop={handleBundleDrop}
        className={cn(
          'mb-3 flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-4 text-center transition-colors',
          isBundleDragOver
            ? 'border-primary bg-primary/5 text-primary'
            : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
        )}
      >
        <PackagePlus className="size-5" />
        <span className="text-xs font-medium">{t('resources.mcp.bundle.dropZoneTitle')}</span>
        <span className="text-[11px] text-muted-foreground">{t('resources.mcp.bundle.dropZoneHint')}</span>
      </button>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t('resources.mcp.form.name')}</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('resources.mcp.form.namePlaceholder')} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t('resources.mcp.form.type')}</label>
          <div className="flex gap-2">
            {(['stdio', 'http', 'sse'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setType(t)} className={cn('rounded-md px-3 py-1 text-xs transition-colors', type === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {type === 'stdio' ? (
          <>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('resources.mcp.form.command')}</label>
              <input className={inputClass} value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t('resources.mcp.form.commandPlaceholder')} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('resources.mcp.form.args')}</label>
              <input className={inputClass} value={args} onChange={(e) => setArgs(e.target.value)} placeholder={t('resources.mcp.form.argsPlaceholder')} />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1">
                <label className="text-xs text-muted-foreground">{t('resources.mcp.form.env')}</label>
                <button type="button" onClick={() => setEnv([...env, { key: '', value: '' }])} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <Plus className="size-3.5" />
                </button>
              </div>
              <KvRows rows={env} onChange={setEnv} keyPlaceholder="KEY" valuePlaceholder="Value" />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('resources.mcp.form.url')}</label>
              <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('resources.mcp.form.urlPlaceholder')} />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1">
                <label className="text-xs text-muted-foreground">{t('resources.mcp.form.headers')}</label>
                <button type="button" onClick={() => setHeaders([...headers, { key: '', value: '' }])} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <Plus className="size-3.5" />
                </button>
              </div>
              <KvRows rows={headers} onChange={setHeaders} />
            </div>
          </>
        )}
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t('resources.mcp.form.scope')}</label>
          <div className="flex gap-2">
            {(['user', 'project'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setScope(s)} className={cn('rounded-md px-3 py-1 text-xs transition-colors', scope === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>
                {s}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          {!verified && !adding && (
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={authorizing}>{t('common.cancel')}</Button>
          )}
          {verified && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <Check className="size-3.5" />
              {t('resources.mcp.form.verified')}
            </span>
          )}
          <Button type="submit" size="sm" disabled={!isValid || authorizing || adding}>
            {authorizing ? t('resources.mcp.form.verifying') : adding ? t('resources.mcp.form.adding') : t('resources.mcp.form.add')}
          </Button>
        </div>
      </div>
    </form>
  )
}

function LibraryView({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { mcpLibrary, mcpConfigs, saveMcpConfig, fetchMcpLibrary, deleteMcpLibraryEntry } = useSettingsStore()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<'user' | 'project'>('user')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  useEffect(() => { fetchMcpLibrary() }, [fetchMcpLibrary])

  const existingNames = new Set(mcpConfigs.map((c) => c.name))
  const selectedEntries = mcpLibrary.filter((entry) => selected.has(entry.name))
  const addableEntries = selectedEntries.filter((entry) => !existingNames.has(entry.name))

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleAdd = async () => {
    if (addableEntries.length === 0) return
    setAdding(true)
    for (const entry of addableEntries) {
      const config: Partial<Pick<McpLibraryEntry, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>> = { type: entry.type }
      if (entry.type === 'stdio') {
        config.command = entry.command
        config.args = entry.args
        config.env = entry.env
      } else {
        config.url = entry.url
        config.headers = entry.headers
      }
      await saveMcpConfig(entry.name, config, scope)
    }
    setAdding(false)
    onClose()
  }

  const handleDeleteConfirm = async () => {
    if (selectedEntries.length === 0) return
    setDeleting(true)
    try {
      for (const entry of selectedEntries) {
        await deleteMcpLibraryEntry(entry.name)
      }
      setSelected(new Set())
      setDeleteConfirmOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  if (mcpLibrary.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <button onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
          </button>
          <h3 className="text-sm font-medium">{t('resources.mcp.libraryView.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground text-center py-6">
          {t('resources.mcp.libraryView.empty')}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
        </button>
        <h3 className="text-sm font-medium">{t('resources.mcp.libraryView.title')}</h3>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-4 gap-2">
        {mcpLibrary.map((entry) => {
          const isAdded = existingNames.has(entry.name)
          const isSelected = selected.has(entry.name)
          return (
            <div
              key={entry.name}
              role="button"
              tabIndex={0}
              onClick={() => toggle(entry.name)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  toggle(entry.name)
                }
              }}
              className={cn(
                'relative flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-colors text-center',
                'cursor-pointer',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : isAdded
                    ? 'border-border bg-muted/40 hover:border-muted-foreground/30'
                    : 'border-border hover:border-muted-foreground/30',
              )}
            >
              {isSelected && (
                <div className="absolute left-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-primary">
                  <Check className="size-2.5 text-primary-foreground" />
                </div>
              )}
              {isAdded && (
                <span className="absolute right-1.5 top-1.5 text-[10px] text-muted-foreground">{t('resources.mcp.libraryView.added')}</span>
              )}
              <McpIcon name={entry.name} meta={{ name: entry.name, icons: entry.icons }} />
              <span className="text-xs font-medium truncate w-full">{entry.name}</span>
            </div>
          )
        })}
      </div>

      {/* Bottom action bar */}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <div className="flex gap-2">
          {(['user', 'project'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={cn(
                'rounded-md px-3 py-1 text-xs transition-colors',
                scope === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={selectedEntries.length === 0 || adding || deleting}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 className="size-4" />
            {t('resources.mcp.libraryView.deleteButton')} {selectedEntries.length > 0 ? selectedEntries.length : ''}
          </Button>
          <Button size="sm" disabled={addableEntries.length === 0 || adding || deleting} onClick={handleAdd}>
            {adding ? t('resources.mcp.libraryView.adding') : t('resources.mcp.libraryView.addCount', { count: addableEntries.length })}
          </Button>
        </div>
      </div>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('resources.mcp.libraryView.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('resources.mcp.libraryView.deleteDescription', { count: selectedEntries.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleting || selectedEntries.length === 0}>
              {deleting ? t('resources.mcp.libraryView.deleting') : t('resources.mcp.libraryView.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ClaudeAiDetailPage({ server, onToggle }: { server: McpServerInfo; onToggle: (name: string, disabled: boolean) => void }) {
  const { t } = useTranslation()
  const { selectMcp } = useSettingsStore()
  const isDisabled = server.status === 'disabled'
  const isConnected = server.status === 'connected'
  const tools = server.tools ?? []

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <button
          onClick={() => selectMcp(null)}
          className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3" />
          {t('common.back')}
        </button>
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-base font-medium uppercase text-muted-foreground">
            {server.name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{server.name}</h2>
              <span className={cn('size-2 rounded-full', isConnected ? 'bg-green-500' : 'bg-red-500')} />
            </div>
            <span className="text-xs text-muted-foreground">claude.ai</span>
          </div>
          <Switch checked={!isDisabled} onCheckedChange={(checked) => onToggle(server.name, !checked)} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">
          {t('resources.mcp.tools')}
          {server.toolCount != null && (
            <span className="ml-2 text-xs text-muted-foreground">({server.toolCount})</span>
          )}
        </h3>
        {tools.length > 0 ? (
          <div className="space-y-2">
            {tools.map((tool) => (
              <div key={tool.name} className="rounded-md border border-border px-3 py-2">
                <p className="text-sm font-medium font-mono">{tool.name}</p>
                {tool.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{tool.description}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isConnected ? t('resources.mcp.noToolsConnected') : isDisabled ? t('resources.mcp.noToolsDisabled') : t('resources.mcp.noToolsDisconnected')}
          </p>
        )}
      </div>
    </div>
  )
}

function ClaudeAiSection({ servers, loading, onToggle }: { servers: McpServerInfo[]; loading?: boolean; onToggle: (name: string, disabled: boolean) => void }) {
  const { t } = useTranslation()
  const { selectMcp } = useSettingsStore()
  if (servers.length === 0 && !loading) return null
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('resources.mcp.claudeAiTitle')}</h3>
      {loading && servers.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4">
          <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t('resources.mcp.claudeAiFetching')}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {servers.map((server) => {
          const isDisabled = server.status === 'disabled'
          const isConnected = server.status === 'connected'
          const isPending = server.status === 'pending'
          const dotColor = isConnected ? 'bg-green-500' : isPending ? 'bg-yellow-500' : isDisabled ? 'bg-red-500' : 'bg-red-500'
          const statusText = isDisabled ? t('resources.mcp.statusDisabled') : isPending ? t('resources.mcp.statusConnecting') : isConnected ? t('resources.mcp.toolsCount', { count: server.toolCount ?? 0 }) : server.error ?? t('resources.mcp.statusFailed')
          return (
            <div
              key={server.name}
              onClick={() => selectMcp(server.name)}
              className={cn('flex items-center gap-3 rounded-lg border border-border bg-card p-3 cursor-pointer transition-colors hover:bg-accent/50', isDisabled && 'opacity-50')}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium uppercase text-muted-foreground">
                {server.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{server.name}</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className={cn('size-2 shrink-0 rounded-full', dotColor)} />
                  <span className="text-xs text-muted-foreground">{statusText}</span>
                </div>
              </div>
              <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                <Switch checked={!isDisabled} onCheckedChange={(checked) => onToggle(server.name, !checked)} />
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ServerSection({
  title,
  configs,
  mcpStatus,
  mcpMeta,
  bundlesByName,
  interactive = true,
  statusMode = 'live',
}: {
  title: string
  configs: McpServerConfig[]
  mcpStatus: McpServerInfo[]
  mcpMeta: Record<string, McpServerMeta>
  bundlesByName?: Record<string, McpbInstalledEntry>
  interactive?: boolean
  statusMode?: 'live' | 'managed'
}) {
  if (configs.length === 0) return null
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-3">
        {configs.map((config) => (
          <ServerCard
            key={config.name}
            config={config}
            status={mcpStatus.find((s) => s.name === config.name)}
            meta={mcpMeta[config.name]}
            bundle={bundlesByName?.[config.name]}
            interactive={interactive}
            statusMode={statusMode}
          />
        ))}
      </div>
    </div>
  )
}

export function McpPage() {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  const { mcpConfigs, mcpStatus, mcpMeta, mcpLibrary, mcpbInstalled, codexMcpConfigs, selectedMcpName, fetchMcpConfigs, checkMcpServers, fetchMcpLibrary, fetchMcpbInstalled, fetchCodexMcpConfigs, selectMcp, toggleMcpConfig } = useSettingsStore()
  const [addView, setAddView] = useState<'none' | 'form' | 'library'>('none')
  const [refreshing, setRefreshing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [pendingBundlePath, setPendingBundlePath] = useState<string | null>(null)
  const [installStatus, setInstallStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const isCodex = settingsProvider === 'codex'

  useEffect(() => {
    selectMcp(null)
    setAddView('none')
    fetchMcpbInstalled()
    if (isCodex) {
      fetchCodexMcpConfigs()
    } else {
      fetchMcpConfigs()
      setChecking(true)
      checkMcpServers().finally(() => setChecking(false))
      fetchMcpLibrary()
    }
  }, [currentFolder, isCodex, fetchMcpConfigs, checkMcpServers, fetchMcpLibrary, fetchMcpbInstalled, fetchCodexMcpConfigs, selectMcp])

  const handleBundleSelected = useCallback((path: string) => {
    setPendingBundlePath(path)
  }, [])

  const handleBundleRejected = useCallback(() => {
    setInstallStatus({ type: 'error', message: t('resources.mcp.bundle.notMcpbFile') })
    setTimeout(() => setInstallStatus(null), 3000)
  }, [t])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await checkMcpServers()
    } finally {
      setRefreshing(false)
    }
  }

  const claudeaiServers = isCodex ? [] : mcpStatus.filter((s) => s.scope === 'claudeai')

  const currentConfigs = isCodex ? codexMcpConfigs : mcpConfigs
  const userConfigs = currentConfigs.filter((c) => c.scope === 'user')
  const projectConfigs = currentConfigs.filter((c) => c.scope === 'project')
  const codexCardStatus = currentConfigs.map((config) => ({
    name: config.name,
    scope: config.scope,
    status: config.disabled ? 'disabled' : 'connected',
    toolCount: 0,
    tools: [],
  })) as McpServerInfo[]

  if (selectedMcpName) {
    if (!isCodex) {
      const claudeaiServer = claudeaiServers.find((s) => s.name === selectedMcpName)
      if (claudeaiServer) return <ClaudeAiDetailPage server={claudeaiServer} onToggle={(name, disabled) => toggleMcpConfig(name, disabled, 'claudeai')} />
    }
    const config = currentConfigs.find((c) => c.name === selectedMcpName)
    const status = (isCodex ? codexCardStatus : mcpStatus).find((s) => s.name === selectedMcpName)
    if (config) return <McpDetailPage config={config} status={status} meta={isCodex ? undefined : mcpMeta[config.name]} />
  }

  const hasAnyServer = currentConfigs.length > 0 || claudeaiServers.length > 0

  const bundleProvider = isCodex ? 'codex' : 'claude'
  const bundlesByName: Record<string, McpbInstalledEntry> = {}
  for (const entry of mcpbInstalled) {
    if (entry.meta.provider === bundleProvider) bundlesByName[entry.meta.name] = entry
  }

  return (
    <div className="mx-auto max-w-4xl">
      {installStatus && (
        <div className={cn(
          'mb-3 rounded-md border px-3 py-2 text-xs',
          installStatus.type === 'success' && 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
          installStatus.type === 'error' && 'border-destructive/40 bg-destructive/5 text-destructive',
        )}>
          {installStatus.message}
        </div>
      )}
      <McpbInstallDialog
        filePath={pendingBundlePath}
        provider={isCodex ? 'codex' : 'claude'}
        onClose={() => setPendingBundlePath(null)}
        onInstalled={(name) => {
          setInstallStatus({ type: 'success', message: t('resources.mcp.bundle.installed', { name }) })
          setTimeout(() => setInstallStatus(null), 3000)
        }}
        onError={(message) => {
          setInstallStatus({ type: 'error', message })
          setTimeout(() => setInstallStatus(null), 4000)
        }}
      />
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('resources.mcp.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('resources.mcp.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <ProjectSelector mode="switch" />
          {!isCodex && (
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
              {t('resources.mcp.refresh')}
            </Button>
          )}
          {!isCodex && mcpLibrary.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setAddView(addView === 'library' ? 'none' : 'library')}>
              <Library className="size-4" />
              {t('resources.mcp.library')}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setAddView(addView === 'form' ? 'none' : 'form')}>
            <Plus className="size-4" />
            {t('resources.mcp.add')}
          </Button>
        </div>
      </div>

      {addView === 'form' && (
        <div className="mb-4">
          <AddServerForm
            onClose={() => setAddView('none')}
            onBundleSelected={handleBundleSelected}
            onBundleRejected={handleBundleRejected}
          />
        </div>
      )}

      {!isCodex && addView === 'library' && (
        <div className="mb-4">
          <LibraryView onClose={() => setAddView('none')} />
        </div>
      )}

      {!hasAnyServer ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">{t('resources.mcp.empty')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isCodex ? t('resources.mcp.emptyHintCodex') : t('resources.mcp.emptyHintClaude')}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <ClaudeAiSection servers={claudeaiServers} loading={checking} onToggle={(name, disabled) => toggleMcpConfig(name, disabled, 'claudeai')} />
          <ServerSection
            title={t('resources.sectionUser')}
            configs={userConfigs}
            mcpStatus={isCodex ? codexCardStatus : mcpStatus}
            mcpMeta={isCodex ? {} : mcpMeta}
            bundlesByName={bundlesByName}
            statusMode={isCodex ? 'managed' : 'live'}
          />
          <ServerSection
            title={t('resources.sectionProject')}
            configs={projectConfigs}
            mcpStatus={isCodex ? codexCardStatus : mcpStatus}
            mcpMeta={isCodex ? {} : mcpMeta}
            bundlesByName={bundlesByName}
            statusMode={isCodex ? 'managed' : 'live'}
          />
        </div>
      )}
    </div>
  )
}
