import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Loader2, Package, ShieldAlert, Sparkles, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settings'
import { cn } from '@/lib/utils'
import type { ResourceScope } from '../../../shared/agent-types'
import type { McpbPreview, McpbProvider, McpbUserConfigField, McpbUserConfigValues } from '../../../shared/mcpb-types'

interface McpbInstallDialogProps {
  filePath: string | null
  provider: McpbProvider
  onClose: () => void
  onInstalled: (name: string) => void
  onError: (message: string) => void
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

export function McpbInstallDialog({ filePath, provider, onClose, onInstalled, onError }: McpbInstallDialogProps) {
  const { t } = useTranslation()
  const fetchMcpConfigs = useSettingsStore((s) => s.fetchMcpConfigs)
  const fetchCodexMcpConfigs = useSettingsStore((s) => s.fetchCodexMcpConfigs)
  const checkMcpServers = useSettingsStore((s) => s.checkMcpServers)
  const fetchMcpbInstalled = useSettingsStore((s) => s.fetchMcpbInstalled)

  const [preview, setPreview] = useState<McpbPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [scope, setScope] = useState<ResourceScope | null>(null)
  const [values, setValues] = useState<Record<string, FieldValue>>({})
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (!filePath) {
      setPreview(null)
      setPreviewError(null)
      setScope(null)
      setValues({})
      return
    }
    let cancelled = false
    setLoading(true)
    setPreviewError(null)
    window.app.previewMcpb(filePath)
      .then((p) => {
        if (cancelled) return
        setPreview(p)
        const initial: Record<string, FieldValue> = {}
        for (const [key, field] of Object.entries(p.manifest.user_config ?? {})) {
          initial[key] = defaultValueFor(field)
        }
        setValues(initial)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPreviewError(err instanceof Error ? err.message : t('resources.mcp.bundle.cannotRead'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [filePath])

  const userConfigEntries = useMemo(() =>
    preview ? Object.entries(preview.manifest.user_config ?? {}) : []
  , [preview])

  const isValid = useMemo(() => {
    if (!preview) return false
    if (!scope) return false
    if (!preview.platformSupported) return false
    if (!preview.runtime.ok) return false
    for (const [key, field] of userConfigEntries) {
      if (!field.required) continue
      const v = values[key]
      if (typeof v === 'string' && v.trim().length === 0) return false
      if (Array.isArray(v) && v.length === 0) return false
      if (v == null) return false
    }
    return true
  }, [preview, scope, values, userConfigEntries])

  const handleInstall = async () => {
    if (!preview || !filePath || !scope) return
    setInstalling(true)
    try {
      await window.app.installMcpb({
        filePath,
        provider,
        scope,
        userConfig: values as McpbUserConfigValues,
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

  const open = Boolean(filePath)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !installing) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('resources.mcp.bundle.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('resources.mcp.bundle.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('resources.mcp.bundle.readingBundle')}
          </div>
        )}

        {previewError && !loading && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <div className="font-medium">{t('resources.mcp.bundle.cannotRead')}</div>
            <pre className="mt-1 whitespace-pre-wrap font-sans text-xs">{previewError}</pre>
          </div>
        )}

        {preview && !loading && (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <div className="flex items-center gap-3">
              {preview.iconDataUrl ? (
                <img src={preview.iconDataUrl} alt="" className="size-12 rounded-md object-cover" />
              ) : (
                <div className="flex size-12 items-center justify-center rounded-md bg-muted">
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
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{preview.manifest.description}</p>
              </div>
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

            <div>
              <label className="mb-1.5 block text-xs font-medium">{t('resources.mcp.bundle.scopeLabel')}</label>
              <div className="flex gap-2">
                {(['user', 'project'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-xs transition-colors',
                      scope === s
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
                    )}
                  >
                    {s === 'user' ? t('resources.mcp.bundle.scopeUser') : t('resources.mcp.bundle.scopeProject')}
                  </button>
                ))}
              </div>
              {!scope && (
                <p className="mt-1 text-[11px] text-muted-foreground">{t('resources.mcp.bundle.scopeHint')}</p>
              )}
            </div>

            {userConfigEntries.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('resources.mcp.bundle.configurationSection')}</div>
                {userConfigEntries.map(([key, field]) => (
                  <FieldRow
                    key={key}
                    name={key}
                    field={field}
                    value={values[key] ?? defaultValueFor(field)}
                    onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={installing}>{t('resources.mcp.bundle.cancel')}</Button>
          <Button onClick={handleInstall} disabled={!isValid || installing}>
            {installing && <Loader2 className="size-3.5 animate-spin" />}
            {installing ? t('resources.mcp.bundle.installing') : t('resources.mcp.bundle.install')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
