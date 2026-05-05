import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Clipboard, Loader2, Package, PackagePlus, Plus, ShieldAlert, Sparkles, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useSettingsStore } from '@/stores/settings'
import { cn } from '@/lib/utils'
import type { McpbPreview, McpbProvider, McpbUserConfigField, McpbUserConfigValues } from '../../../shared/mcpb-types'

const MCPB_EXT = '.mcpb'

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
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    const json = JSON.parse(trimmed)

    if (json.mcpServers && typeof json.mcpServers === 'object') {
      const entries = Object.entries(json.mcpServers)
      if (entries.length === 0) return null
      const [name, raw] = entries[0] as [string, Record<string, unknown>]
      return extractFromRaw(name, raw)
    }

    const keys = Object.keys(json)
    if (keys.length === 1 && typeof json[keys[0]] === 'object' && json[keys[0]] !== null) {
      const raw = json[keys[0]] as Record<string, unknown>
      if (raw.command || raw.url || raw.type) {
        return extractFromRaw(keys[0], raw)
      }
    }

    if (json.type || json.command || json.url) {
      return extractFromRaw(undefined, json)
    }
  } catch {
    // not valid JSON — try wrapping as "name": { ... } fragment
  }

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

type FieldValue = string | number | boolean | string[]

function defaultValueFor(field: McpbUserConfigField): FieldValue {
  if (field.default !== undefined) return field.default
  if (field.type === 'boolean') return false
  if (field.type === 'number') return field.min ?? 0
  if (field.multiple) return []
  return ''
}

function FieldRow({ name, field, value, onChange }: {
  name: string
  field: McpbUserConfigField
  value: FieldValue
  onChange: (next: FieldValue) => void
}) {
  const { t } = useTranslation()
  const required = field.required && (
    typeof value === 'string' ? value.trim().length === 0 :
    Array.isArray(value) ? value.length === 0 :
    false
  )

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label className="text-xs font-medium">
          {field.title}
          {field.required && <span className="ml-1 text-destructive">*</span>}
          {field.sensitive && (
            <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[9px] uppercase tracking-wide">
              {t('resources.mcp.bundle.sensitiveBadge')}
            </Badge>
          )}
        </label>
        <code className="text-[10px] text-muted-foreground">{name}</code>
      </div>
      {field.description && (
        <p className="mb-1.5 text-xs text-muted-foreground">{field.description}</p>
      )}
      {field.type === 'boolean' ? (
        <Switch
          checked={Boolean(value)}
          onCheckedChange={(v) => onChange(v)}
        />
      ) : field.type === 'number' ? (
        <Input
          aria-label={field.title}
          type="number"
          value={String(value ?? '')}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      ) : field.multiple ? (
        <textarea
          aria-label={field.title}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring"
          rows={3}
          value={Array.isArray(value) ? value.join('\n') : String(value ?? '')}
          placeholder={field.type === 'directory' ? '/path/one\n/path/two' : 'one per line'}
          onChange={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
        />
      ) : (
        <Input
          aria-label={field.title}
          type={field.sensitive ? 'password' : 'text'}
          value={typeof value === 'string' ? value : String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.type === 'directory' ? '/path/to/dir' : field.type === 'file' ? '/path/to/file' : ''}
        />
      )}
      {required && (
        <p className="mt-1 text-[11px] text-destructive">{t('resources.mcp.bundle.requiredField')}</p>
      )}
    </div>
  )
}

function CollapsibleSection({ title, count, icon, children }: {
  title: string
  count: number
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  if (count === 0) return null
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent/50"
      >
        {icon}
        <span className="flex-1 font-medium">{title}</span>
        <span className="text-muted-foreground">{count}</span>
        <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-border px-3 py-2">{children}</div>}
    </div>
  )
}

function getMcpbDropPath(e: DragEvent): string | null {
  for (let i = 0; i < e.dataTransfer.files.length; i++) {
    const file = e.dataTransfer.files[i]
    const path = window.app.getPathForFile(file)
    if (path.endsWith(MCPB_EXT)) return path
  }
  return null
}

interface AddServerPanelProps {
  provider: McpbProvider
  cwd: string | null
  onClose: () => void
  onInstalled: (name: string) => void
  onError: (message: string) => void
}

export function AddServerPanel({ provider, cwd, onClose, onInstalled, onError }: AddServerPanelProps) {
  const { t } = useTranslation()
  const { saveMcpConfig, fetchMcpConfigs, fetchCodexMcpConfigs, checkMcpServers, fetchMcpbInstalled } = useSettingsStore()

  const [tab, setTab] = useState<'manual' | 'bundle'>('bundle')
  const [scope, setScope] = useState<'user' | 'project'>('user')
  const [error, setError] = useState('')

  // Manual tab state
  const [name, setName] = useState('')
  const [type, setType] = useState<'stdio' | 'http' | 'sse'>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState<KvRow[]>([])
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<KvRow[]>([])
  const [authorizing, setAuthorizing] = useState(false)
  const [verified, setVerified] = useState(false)
  const [adding, setAdding] = useState(false)

  // Bundle tab state
  const [bundlePath, setBundlePath] = useState<string | null>(null)
  const [preview, setPreview] = useState<McpbPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [bundleValues, setBundleValues] = useState<Record<string, FieldValue>>({})
  const [installing, setInstalling] = useState(false)
  const [bundleDragOver, setBundleDragOver] = useState(false)
  const bundleInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!bundlePath) {
      setPreview(null)
      setPreviewError(null)
      setBundleValues({})
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(null)
    window.app.previewMcpb(bundlePath)
      .then((p) => {
        if (cancelled) return
        setPreview(p)
        const initial: Record<string, FieldValue> = {}
        for (const [key, field] of Object.entries(p.manifest.user_config ?? {})) {
          initial[key] = defaultValueFor(field)
        }
        setBundleValues(initial)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPreviewError(err instanceof Error ? err.message : t('resources.mcp.bundle.cannotRead'))
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => { cancelled = true }
  }, [bundlePath, t])

  const userConfigEntries = useMemo(() =>
    preview ? Object.entries(preview.manifest.user_config ?? {}) : []
  , [preview])

  const handleBundleDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      setBundleDragOver(true)
    }
  }

  const handleBundleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setBundleDragOver(false)
  }

  const handleBundleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setBundleDragOver(false)
    const path = getMcpbDropPath(e)
    if (path) {
      setBundlePath(path)
    } else {
      onError(t('resources.mcp.bundle.notMcpbFile'))
    }
  }

  const handleBundleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const path = window.app.getPathForFile(file)
      if (path.endsWith(MCPB_EXT)) setBundlePath(path)
      else onError(t('resources.mcp.bundle.notMcpbFile'))
    }
    e.target.value = ''
  }

  const handleClearBundle = () => {
    setBundlePath(null)
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

  const manualValid = name.trim() && (type !== 'stdio' ? url.trim() : command.trim())
  const bundleValid = useMemo(() => {
    if (!preview) return false
    if (scope === 'project' && !cwd) return false
    if (!preview.platformSupported) return false
    if (!preview.runtime.ok) return false
    for (const [key, field] of userConfigEntries) {
      if (!field.required) continue
      const v = bundleValues[key]
      if (typeof v === 'string' && v.trim().length === 0) return false
      if (Array.isArray(v) && v.length === 0) return false
      if (v == null) return false
    }
    return true
  }, [preview, scope, cwd, bundleValues, userConfigEntries])

  const isValid = tab === 'manual' ? !!manualValid : bundleValid
  const busy = authorizing || adding || installing

  const handleManualSubmit = async () => {
    if (type === 'http' || type === 'sse') {
      if (!url.trim()) return
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

  const handleBundleSubmit = async () => {
    if (!preview || !bundlePath) return
    setInstalling(true)
    try {
      await window.app.installMcpb({
        filePath: bundlePath,
        provider,
        scope,
        cwd: scope === 'project' ? cwd ?? undefined : undefined,
        userConfig: bundleValues as McpbUserConfigValues,
        expectedManifestHash: preview.manifestHash,
      })
      const refreshConfigs = provider === 'codex' ? fetchCodexMcpConfigs : fetchMcpConfigs
      await Promise.all([fetchMcpbInstalled(), refreshConfigs(), provider === 'claude' ? checkMcpServers() : Promise.resolve()])
      onInstalled(preview.manifest.display_name ?? preview.manifest.name)
      onClose()
    } catch (err) {
      onError(err instanceof Error ? err.message : t('resources.mcp.bundle.cannotRead'))
    } finally {
      setInstalling(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!isValid) return
    if (tab === 'manual') {
      await handleManualSubmit()
    } else {
      await handleBundleSubmit()
    }
  }

  const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring'

  const submitLabel = tab === 'manual'
    ? (authorizing ? t('resources.mcp.form.verifying') : adding ? t('resources.mcp.form.adding') : t('resources.mcp.form.add'))
    : (installing ? t('resources.mcp.bundle.installing') : t('resources.mcp.bundle.install'))

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('resources.mcp.form.title')}</h3>
        <div className="flex items-center gap-2">
          {tab === 'manual' && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handlePaste}
                    aria-label={t('resources.mcp.form.paste')}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Clipboard className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {t('resources.mcp.form.pasteTooltip')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <div className="flex gap-0.5 rounded-md bg-muted/50 p-0.5">
            {(['manual', 'bundle'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => { setTab(key); setError('') }}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  tab === key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {key === 'manual' ? t('resources.mcp.form.tabManual') : t('resources.mcp.form.tabBundle')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'manual' ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('resources.mcp.form.name')}</label>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('resources.mcp.form.namePlaceholder')} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('resources.mcp.form.type')}</label>
            <div className="flex gap-2">
              {(['stdio', 'http', 'sse'] as const).map((tt) => (
                <button key={tt} type="button" onClick={() => setType(tt)} className={cn('rounded-md px-3 py-1 text-xs transition-colors', type === tt ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>
                  {tt}
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
        </div>
      ) : (
        <BundleTabBody
          bundlePath={bundlePath}
          previewLoading={previewLoading}
          preview={preview}
          previewError={previewError}
          bundleDragOver={bundleDragOver}
          bundleInputRef={bundleInputRef}
          userConfigEntries={userConfigEntries}
          values={bundleValues}
          onValuesChange={setBundleValues}
          onClear={handleClearBundle}
          onDragOver={handleBundleDragOver}
          onDragLeave={handleBundleDragLeave}
          onDrop={handleBundleDrop}
          onFileInput={handleBundleFileInput}
        />
      )}

      {/* Shared bottom: scope + error + actions */}
      <div className="mt-4 space-y-3 border-t border-border pt-3">
        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            {(['user', 'project'] as const).map((s) => {
              const disabled = s === 'project' && !cwd
              return (
                <button
                  key={s}
                  type="button"
                  disabled={disabled}
                  onClick={() => setScope(s)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs transition-colors',
                    scope === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                    disabled && 'cursor-not-allowed opacity-50 hover:bg-muted hover:text-muted-foreground',
                  )}
                >
                  {s}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2">
            {!verified && !busy && (
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
            )}
            {verified && (
              <span className="flex items-center gap-1 text-xs text-green-500">
                <Check className="size-3.5" />
                {t('resources.mcp.form.verified')}
              </span>
            )}
            <Button type="submit" size="sm" disabled={!isValid || busy}>
              {submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}

function BundleTabBody({
  bundlePath,
  previewLoading,
  preview,
  previewError,
  bundleDragOver,
  bundleInputRef,
  userConfigEntries,
  values,
  onValuesChange,
  onClear,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
}: {
  bundlePath: string | null
  previewLoading: boolean
  preview: McpbPreview | null
  previewError: string | null
  bundleDragOver: boolean
  bundleInputRef: React.RefObject<HTMLInputElement | null>
  userConfigEntries: [string, McpbUserConfigField][]
  values: Record<string, FieldValue>
  onValuesChange: (updater: (prev: Record<string, FieldValue>) => Record<string, FieldValue>) => void
  onClear: () => void
  onDragOver: (e: DragEvent) => void
  onDragLeave: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
  onFileInput: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  const { t } = useTranslation()

  return (
    <div>
      <input
        ref={bundleInputRef}
        type="file"
        accept=".mcpb"
        className="hidden"
        onChange={onFileInput}
      />
      {!bundlePath && (
        <button
          type="button"
          onClick={() => bundleInputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            'flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
            bundleDragOver
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
          )}
        >
          <PackagePlus className="size-6" />
          <span className="text-xs font-medium">{t('resources.mcp.bundle.dropZoneTitle')}</span>
          <span className="text-[11px] text-muted-foreground">{t('resources.mcp.bundle.dropZoneHint')}</span>
        </button>
      )}

      {bundlePath && previewLoading && (
        <div
          className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-8 text-center"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t('resources.mcp.bundle.readingBundle')}</span>
        </div>
      )}

      {bundlePath && previewError && !previewLoading && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium">{t('resources.mcp.bundle.cannotRead')}</div>
            <button type="button" onClick={onClear} className="shrink-0 rounded p-0.5 hover:bg-destructive/10">
              <X className="size-3.5" />
            </button>
          </div>
          <pre className="mt-1 whitespace-pre-wrap font-sans text-xs">{previewError}</pre>
        </div>
      )}

      {preview && !previewLoading && (
        <div
          className="space-y-4"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="flex items-center gap-3">
            {preview.iconDataUrl ? (
              <img src={preview.iconDataUrl} alt="" className="size-12 shrink-0 rounded-md object-cover" />
            ) : (
              <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted">
                <Package className="size-6 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="truncate text-base font-semibold">
                  {preview.manifest.display_name ?? preview.manifest.name}
                </h3>
                <Badge variant="outline" className="px-1.5 py-0 text-[10px] uppercase">
                  v{preview.manifest.version}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                by {preview.manifest.author.name} · {preview.manifest.server.type}
              </p>
              {preview.manifest.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{preview.manifest.description}</p>
              )}
            </div>
            <button type="button" onClick={onClear} className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground" aria-label="clear bundle">
              <X className="size-3.5" />
            </button>
          </div>

          {preview.warnings.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                <ShieldAlert className="size-3.5" />
                {t('resources.mcp.bundle.warningHeader')}
              </div>
              <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                {preview.warnings.map((w, i) => <li key={i}>• {w}</li>)}
              </ul>
            </div>
          )}

          {preview.conflictsWith && (
            <div className="rounded-md border border-border bg-muted/30 p-2.5 text-xs">
              {preview.conflictsWith.sameVersion
                ? t('resources.mcp.bundle.replaceExistingSameVersion')
                : t('resources.mcp.bundle.replaceExistingDifferentVersion', { version: preview.conflictsWith.existingVersion })}
            </div>
          )}

          <CollapsibleSection
            title={t('resources.mcp.bundle.toolsSection')}
            count={preview.manifest.tools.length}
            icon={<Wrench className="size-3.5 text-muted-foreground" />}
          >
            <ul className="space-y-1.5">
              {preview.manifest.tools.map((tool) => (
                <li key={tool.name} className="text-xs">
                  <code className="font-mono">{tool.name}</code>
                  {tool.description && <span className="ml-2 text-muted-foreground">{tool.description}</span>}
                </li>
              ))}
              {preview.manifest.tools_generated && (
                <li className="text-[11px] italic text-muted-foreground">{t('resources.mcp.bundle.toolsGenerated')}</li>
              )}
            </ul>
          </CollapsibleSection>

          <CollapsibleSection
            title={t('resources.mcp.bundle.promptsSection')}
            count={preview.manifest.prompts.length}
            icon={<Sparkles className="size-3.5 text-muted-foreground" />}
          >
            <ul className="space-y-1.5">
              {preview.manifest.prompts.map((p) => (
                <li key={p.name} className="text-xs">
                  <code className="font-mono">{p.name}</code>
                  {p.description && <span className="ml-2 text-muted-foreground">{p.description}</span>}
                </li>
              ))}
            </ul>
          </CollapsibleSection>

          {userConfigEntries.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('resources.mcp.bundle.configurationSection')}</div>
              {userConfigEntries.map(([key, field]) => (
                <FieldRow
                  key={key}
                  name={key}
                  field={field}
                  value={values[key] ?? defaultValueFor(field)}
                  onChange={(v) => onValuesChange((prev) => ({ ...prev, [key]: v }))}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
