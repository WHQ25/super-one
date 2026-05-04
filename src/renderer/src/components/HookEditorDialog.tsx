import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HookConfig, HookEntry, HookEntryType, HookEventName, HookSavePayload, HookScope } from '../../../shared/agent-types'

const PRIMARY_EVENTS: HookEventName[] = [
  'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop',
  'SubagentStop', 'SessionStart', 'SessionEnd', 'Notification',
]

const SECONDARY_EVENTS: HookEventName[] = [
  'PostToolUseFailure', 'PostToolBatch', 'UserPromptExpansion',
  'StopFailure', 'SubagentStart',
  'PreCompact', 'PostCompact',
  'PermissionRequest', 'PermissionDenied',
  'Setup', 'TeammateIdle',
  'TaskCreated', 'TaskCompleted',
  'Elicitation', 'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate', 'WorktreeRemove',
  'InstructionsLoaded', 'CwdChanged', 'FileChanged',
]

const SCOPES: { value: HookScope; labelKey: string }[] = [
  { value: 'user', labelKey: 'resources.hooks.scope.user' },
  { value: 'project', labelKey: 'resources.hooks.scope.project' },
  { value: 'local', labelKey: 'resources.hooks.scope.local' },
]

const TYPES: { value: HookEntryType; labelKey: string }[] = [
  { value: 'command', labelKey: 'resources.hooks.types.command' },
  { value: 'prompt', labelKey: 'resources.hooks.types.prompt' },
  { value: 'agent', labelKey: 'resources.hooks.types.agent' },
  { value: 'http', labelKey: 'resources.hooks.types.http' },
  { value: 'mcp_tool', labelKey: 'resources.hooks.types.mcp_tool' },
]

interface HookFormState {
  scope: HookScope
  event: HookEventName
  matcher: string
  type: HookEntryType
  command: string
  shell: 'bash' | 'powershell' | ''
  async: boolean
  asyncRewake: boolean
  prompt: string
  model: string
  url: string
  headers: string
  allowedEnvVars: string
  server: string
  tool: string
  toolInput: string
  ifRule: string
  timeout: string
  statusMessage: string
  once: boolean
}

function initialState(initial?: HookConfig): HookFormState {
  const e = initial?.entry
  const headers = e?.type === 'http' && e.headers ? JSON.stringify(e.headers, null, 2) : ''
  const allowedEnvVars = e?.type === 'http' && e.allowedEnvVars ? e.allowedEnvVars.join(',') : ''
  const toolInput = e?.type === 'mcp_tool' && e.input ? JSON.stringify(e.input, null, 2) : ''
  return {
    scope: initial?.scope ?? 'user',
    event: initial?.event ?? 'PreToolUse',
    matcher: initial?.matcher ?? '',
    type: e?.type ?? 'command',
    command: e?.type === 'command' ? e.command : '',
    shell: (e?.type === 'command' && e.shell) || '',
    async: (e?.type === 'command' && e.async) || false,
    asyncRewake: (e?.type === 'command' && e.asyncRewake) || false,
    prompt: (e?.type === 'prompt' || e?.type === 'agent') ? e.prompt : '',
    model: (e?.type === 'prompt' || e?.type === 'agent') ? (e.model ?? '') : '',
    url: e?.type === 'http' ? e.url : '',
    headers,
    allowedEnvVars,
    server: e?.type === 'mcp_tool' ? e.server : '',
    tool: e?.type === 'mcp_tool' ? e.tool : '',
    toolInput,
    ifRule: e?.if ?? '',
    timeout: e?.timeout != null ? String(e.timeout) : '',
    statusMessage: e?.statusMessage ?? '',
    once: e?.once ?? false,
  }
}

type BuildResult = { ok: true; payload: HookSavePayload } | { ok: false; error: string }

function buildPayload(form: HookFormState, t: (k: string) => string): BuildResult {
  const base: { if?: string; timeout?: number; statusMessage?: string; once?: boolean } = {}
  if (form.ifRule.trim()) base.if = form.ifRule.trim()
  if (form.timeout.trim()) {
    const n = Number(form.timeout)
    if (Number.isNaN(n) || n <= 0) return { ok: false, error: t('resources.hooks.errors.invalidTimeout') }
    base.timeout = n
  }
  if (form.statusMessage.trim()) base.statusMessage = form.statusMessage.trim()
  if (form.once) base.once = true

  let entry: HookEntry
  switch (form.type) {
    case 'command': {
      if (!form.command.trim()) return { ok: false, error: t('resources.hooks.errors.commandRequired') }
      const e: HookEntry = { ...base, type: 'command', command: form.command.trim() }
      if (form.shell) e.shell = form.shell
      if (form.async) e.async = true
      if (form.asyncRewake) e.asyncRewake = true
      entry = e
      break
    }
    case 'prompt': {
      if (!form.prompt.trim()) return { ok: false, error: t('resources.hooks.errors.promptRequired') }
      const e: HookEntry = { ...base, type: 'prompt', prompt: form.prompt.trim() }
      if (form.model.trim()) e.model = form.model.trim()
      entry = e
      break
    }
    case 'agent': {
      if (!form.prompt.trim()) return { ok: false, error: t('resources.hooks.errors.promptRequired') }
      const e: HookEntry = { ...base, type: 'agent', prompt: form.prompt.trim() }
      if (form.model.trim()) e.model = form.model.trim()
      entry = e
      break
    }
    case 'http': {
      if (!form.url.trim()) return { ok: false, error: t('resources.hooks.errors.urlRequired') }
      const e: HookEntry = { ...base, type: 'http', url: form.url.trim() }
      if (form.headers.trim()) {
        try {
          const parsed = JSON.parse(form.headers)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) e.headers = parsed
          else return { ok: false, error: t('resources.hooks.errors.headersJson') }
        } catch {
          return { ok: false, error: t('resources.hooks.errors.headersJson') }
        }
      }
      if (form.allowedEnvVars.trim()) {
        e.allowedEnvVars = form.allowedEnvVars.split(',').map((s) => s.trim()).filter(Boolean)
      }
      entry = e
      break
    }
    case 'mcp_tool': {
      if (!form.server.trim() || !form.tool.trim()) return { ok: false, error: t('resources.hooks.errors.mcpToolRequired') }
      const e: HookEntry = { ...base, type: 'mcp_tool', server: form.server.trim(), tool: form.tool.trim() }
      if (form.toolInput.trim()) {
        try {
          const parsed = JSON.parse(form.toolInput)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) e.input = parsed
          else return { ok: false, error: t('resources.hooks.errors.toolInputJson') }
        } catch {
          return { ok: false, error: t('resources.hooks.errors.toolInputJson') }
        }
      }
      entry = e
      break
    }
  }

  return {
    ok: true,
    payload: {
      scope: form.scope,
      event: form.event,
      matcher: form.matcher.trim() || undefined,
      entry,
    },
  }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: HookConfig
  onSubmit: (payload: HookSavePayload, replaceId?: string) => Promise<void>
}

export function HookEditorDialog({ open, onOpenChange, initial, onSubmit }: Props) {
  const { t } = useTranslation()
  const [form, setForm] = useState<HookFormState>(() => initialState(initial))
  const [error, setError] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(initialState(initial))
      setError(null)
      setAdvancedOpen(false)
    }
  }, [open, initial])

  const update = <K extends keyof HookFormState>(key: K, value: HookFormState[K]) => {
    setForm((s) => ({ ...s, [key]: value }))
  }

  const handleSave = async () => {
    setError(null)
    const result = buildPayload(form, t)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaving(true)
    try {
      await onSubmit(result.payload, initial?.id)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initial ? t('resources.hooks.editor.titleEdit') : t('resources.hooks.editor.titleNew')}
          </DialogTitle>
          <DialogDescription>{t('resources.hooks.editor.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('resources.hooks.editor.fields.scope')}>
              <Select value={form.scope} onValueChange={(v) => update('scope', v as HookScope)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{t(s.labelKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label={t('resources.hooks.editor.fields.event')}>
              <Select value={form.event} onValueChange={(v) => update('event', v as HookEventName)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <div className="px-2 py-1 text-xs uppercase tracking-wider text-muted-foreground">
                    {t('resources.hooks.editor.eventGroup.common')}
                  </div>
                  {PRIMARY_EVENTS.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                  <div className="mt-1 border-t border-border px-2 pt-1.5 pb-1 text-xs uppercase tracking-wider text-muted-foreground">
                    {t('resources.hooks.editor.eventGroup.more')}
                  </div>
                  {SECONDARY_EVENTS.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field
            label={t('resources.hooks.editor.fields.matcher')}
            hint={t('resources.hooks.editor.fields.matcherHint')}
          >
            <Input
              value={form.matcher}
              onChange={(e) => update('matcher', e.target.value)}
              placeholder="Bash(git push *)"
            />
          </Field>

          <Field label={t('resources.hooks.editor.fields.type')}>
            <div className="flex gap-1.5 rounded-md border border-border bg-muted/40 p-1">
              {TYPES.map((tp) => (
                <button
                  key={tp.value}
                  type="button"
                  onClick={() => update('type', tp.value)}
                  className={cn(
                    'flex-1 rounded px-2 py-1 text-xs transition-colors',
                    form.type === tp.value
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(tp.labelKey)}
                </button>
              ))}
            </div>
          </Field>

          {form.type === 'command' && (
            <CommandFields form={form} update={update} />
          )}
          {(form.type === 'prompt' || form.type === 'agent') && (
            <PromptFields form={form} update={update} t={t} />
          )}
          {form.type === 'http' && <HttpFields form={form} update={update} t={t} />}
          {form.type === 'mcp_tool' && <McpToolFields form={form} update={update} t={t} />}

          <div className="rounded-md border border-border">
            <button
              type="button"
              onClick={() => setAdvancedOpen((s) => !s)}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground"
            >
              {advancedOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              {t('resources.hooks.editor.advanced')}
            </button>
            {advancedOpen && (
              <div className="space-y-3 border-t border-border p-3">
                <Field label="if" hint={t('resources.hooks.editor.fields.ifHint')}>
                  <Input value={form.ifRule} onChange={(e) => update('ifRule', e.target.value)} placeholder="Bash(git *)" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('resources.hooks.editor.fields.timeout')}>
                    <Input value={form.timeout} onChange={(e) => update('timeout', e.target.value)} placeholder="60" />
                  </Field>
                  <Field label={t('resources.hooks.editor.fields.statusMessage')}>
                    <Input value={form.statusMessage} onChange={(e) => update('statusMessage', e.target.value)} />
                  </Field>
                </div>
                <SwitchRow label={t('resources.hooks.editor.fields.once')} hint={t('resources.hooks.editor.fields.onceHint')} value={form.once} onChange={(v) => update('once', v)} />
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  )
}

function SwitchRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-xs font-medium">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground/70">{hint}</div>}
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  )
}

type Updater = <K extends keyof HookFormState>(k: K, v: HookFormState[K]) => void

function CommandFields({ form, update }: { form: HookFormState; update: Updater }) {
  const { t } = useTranslation()
  return (
    <>
      <Field label={t('resources.hooks.editor.fields.command')}>
        <Textarea
          value={form.command}
          onChange={(e) => update('command', e.target.value)}
          rows={3}
          className="font-mono"
          placeholder='echo "hook fired"'
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('resources.hooks.editor.fields.shell')}>
          <Select value={form.shell || 'auto'} onValueChange={(v) => update('shell', v === 'auto' ? '' : (v as 'bash' | 'powershell'))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('resources.hooks.editor.fields.shellAuto')}</SelectItem>
              <SelectItem value="bash">bash</SelectItem>
              <SelectItem value="powershell">powershell</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <SwitchRow
        label={t('resources.hooks.editor.fields.async')}
        hint={t('resources.hooks.editor.fields.asyncHint')}
        value={form.async}
        onChange={(v) => update('async', v)}
      />
      <SwitchRow
        label={t('resources.hooks.editor.fields.asyncRewake')}
        hint={t('resources.hooks.editor.fields.asyncRewakeHint')}
        value={form.asyncRewake}
        onChange={(v) => update('asyncRewake', v)}
      />
    </>
  )
}

function PromptFields({ form, update, t }: { form: HookFormState; update: Updater; t: (k: string) => string }) {
  return (
    <>
      <Field label={t('resources.hooks.editor.fields.prompt')} hint={t('resources.hooks.editor.fields.promptHint')}>
        <Textarea
          value={form.prompt}
          onChange={(e) => update('prompt', e.target.value)}
          rows={4}
          placeholder="Verify the change is safe..."
        />
      </Field>
      <Field label={t('resources.hooks.editor.fields.model')}>
        <Input value={form.model} onChange={(e) => update('model', e.target.value)} placeholder="claude-haiku-4-5" />
      </Field>
    </>
  )
}

function HttpFields({ form, update, t }: { form: HookFormState; update: Updater; t: (k: string) => string }) {
  return (
    <>
      <Field label={t('resources.hooks.editor.fields.url')}>
        <Input value={form.url} onChange={(e) => update('url', e.target.value)} placeholder="https://hooks.example.com/notify" />
      </Field>
      <Field label={t('resources.hooks.editor.fields.headers')} hint={t('resources.hooks.editor.fields.headersHint')}>
        <Textarea
          value={form.headers}
          onChange={(e) => update('headers', e.target.value)}
          rows={3}
          className="font-mono"
          placeholder='{ "Authorization": "Bearer $MY_TOKEN" }'
        />
      </Field>
      <Field label={t('resources.hooks.editor.fields.allowedEnvVars')} hint={t('resources.hooks.editor.fields.allowedEnvVarsHint')}>
        <Input value={form.allowedEnvVars} onChange={(e) => update('allowedEnvVars', e.target.value)} placeholder="MY_TOKEN, GITHUB_TOKEN" />
      </Field>
    </>
  )
}

function McpToolFields({ form, update, t }: { form: HookFormState; update: Updater; t: (k: string) => string }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('resources.hooks.editor.fields.mcpServer')}>
          <Input value={form.server} onChange={(e) => update('server', e.target.value)} placeholder="superone" />
        </Field>
        <Field label={t('resources.hooks.editor.fields.mcpTool')}>
          <Input value={form.tool} onChange={(e) => update('tool', e.target.value)} placeholder="my_tool" />
        </Field>
      </div>
      <Field label={t('resources.hooks.editor.fields.mcpInput')} hint={t('resources.hooks.editor.fields.mcpInputHint')}>
        <Textarea
          value={form.toolInput}
          onChange={(e) => update('toolInput', e.target.value)}
          rows={3}
          className="font-mono"
          placeholder='{ "file": "${tool_input.file_path}" }'
        />
      </Field>
    </>
  )
}
