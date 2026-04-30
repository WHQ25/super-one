import { useEffect, useState } from 'react'
import { CalendarClock, Check, ChevronDown, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SchedulePicker } from './SchedulePicker'
import { useChatStore, selectClaudeModels, selectCodexModels } from '@/stores/chat'
import { modes as permissionModes } from '@/components/chat/PermissionModeSelector'
import { sandboxModes } from '@/components/chat/SandboxModeSelector'
import { formatCodexModelLabel, formatReasoningEffortLabel } from '@/components/chat/chat-input-utils'
import type { AgentType, Automation, AgentRunConfig, AutomationSchedule, ClaudeRunConfig, CodexRunConfig, EffortLevel } from '../../../shared/agent-types'

const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

const defaultClaudeConfig: ClaudeRunConfig = {
  type: 'claude',
  permissionMode: 'bypassPermissions',
  sandboxMode: 'off',
}

const defaultCodexConfig: CodexRunConfig = {
  type: 'codex',
  permissionPreset: 'full-access',
}

const defaultSchedule: AutomationSchedule = {
  type: 'recurring',
  preset: 'daily',
  cron: '0 9 * * *',
  timeOfDay: '09:00',
}

interface FormState {
  name: string
  prompt: string
  agentType: AgentType
  claudeConfig: ClaudeRunConfig
  codexConfig: CodexRunConfig
  schedule: AutomationSchedule
  enabled: boolean
}

function initForm(automation?: Automation | null): FormState {
  if (!automation) {
    return {
      name: '',
      prompt: '',
      agentType: 'claude',
      claudeConfig: { ...defaultClaudeConfig },
      codexConfig: { ...defaultCodexConfig },
      schedule: { ...defaultSchedule },
      enabled: true,
    }
  }
  const agentType = automation.agentConfig.type
  return {
    name: automation.name,
    prompt: automation.prompt,
    agentType,
    claudeConfig: agentType === 'claude' ? { ...automation.agentConfig } as ClaudeRunConfig : { ...defaultClaudeConfig },
    codexConfig: agentType === 'codex' ? { ...automation.agentConfig } as CodexRunConfig : { ...defaultCodexConfig },
    schedule: { ...automation.schedule },
    enabled: automation.enabled,
  }
}

function PopoverSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  renderTrigger,
  renderOption,
  width = 'w-52',
}: {
  label: string
  value: T
  options: { id: T; label: string; description?: string; icon?: React.ReactNode; color?: string }[]
  onChange: (v: T) => void
  renderTrigger?: (option: (typeof options)[number] | undefined) => React.ReactNode
  renderOption?: (option: (typeof options)[number], selected: boolean) => React.ReactNode
  width?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.id === value)

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className={`flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted ${current?.color ?? ''}`}>
            {renderTrigger ? renderTrigger(current) : (
              <>
                {current?.icon}
                <span>{current?.label ?? t('resources.automation.select')}</span>
              </>
            )}
            <ChevronDown className={`size-3 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" side="bottom" className={`${width} border-border bg-card p-1`}>
          {options.map((option) => {
            const selected = option.id === value
            return (
              <button
                key={option.id}
                onClick={() => { onChange(option.id); setOpen(false) }}
                className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  selected ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/50'
                }`}
              >
                {renderOption ? renderOption(option, selected) : (
                  <>
                    <div className={`flex items-center gap-1.5 font-medium ${option.color ?? ''}`}>
                      {option.icon}
                      {option.label}
                      {selected && <Check className="ml-auto size-3.5 shrink-0" />}
                    </div>
                    {option.description && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{option.description}</div>
                    )}
                  </>
                )}
              </button>
            )
          })}
        </PopoverContent>
      </Popover>
    </div>
  )
}

export function AutomationDialog({
  open,
  onOpenChange,
  editAutomation,
  projectPath,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editAutomation: Automation | null
  projectPath: string
  onSaved?: () => void
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(() => initForm(editAutomation))
  const [showAgentSettings, setShowAgentSettings] = useState(false)

  const availableModels = useChatStore(selectClaudeModels)
  const cachedCodexModels = useChatStore(selectCodexModels)

  useEffect(() => {
    if (open) {
      setForm(initForm(editAutomation))
      setShowAgentSettings(!!editAutomation)
    }
  }, [open, editAutomation])

  const handleSubmit = async () => {
    const agentConfig: AgentRunConfig = form.agentType === 'claude' ? form.claudeConfig : form.codexConfig
    const data = { name: form.name, prompt: form.prompt, agentConfig, schedule: form.schedule }
    if (editAutomation) {
      await window.app.updateAutomation(editAutomation.id, { ...data, enabled: form.enabled })
    } else {
      await window.app.createAutomation(projectPath, data)
    }
    onSaved?.()
    onOpenChange(false)
  }

  const handleDelete = async () => {
    if (!editAutomation) return
    await window.app.deleteAutomation(editAutomation.id)
    onSaved?.()
    onOpenChange(false)
  }

  const updateClaude = (patch: Partial<ClaudeRunConfig>) => {
    setForm((f) => ({ ...f, claudeConfig: { ...f.claudeConfig, ...patch } }))
  }

  const updateCodex = (patch: Partial<CodexRunConfig>) => {
    setForm((f) => ({ ...f, codexConfig: { ...f.codexConfig, ...patch } }))
  }

  const isValid = form.name.trim() && form.prompt.trim()

  const claudeModelOptions = [
    { id: '', label: t('resources.automation.defaultValue') },
    ...(availableModels ?? []).map((m) => ({ id: m.id, label: m.name, description: m.description })),
  ]

  const codexModelOptions = [
    { id: '', label: t('resources.automation.defaultValue') },
    ...(cachedCodexModels ?? []).map((m) => ({ id: m.id, label: formatCodexModelLabel(m.id || m.name) })),
  ]

  const effortOptions = [
    { id: '' as EffortLevel | '', label: t('resources.automation.defaultValue') },
    ...EFFORT_LEVELS.map((l) => ({ id: l as EffortLevel | '', label: t(`settings.preferences.effort.levels.${l}`) })),
  ]

  const codexReasoningOptions = [
    { id: '', label: t('resources.automation.defaultValue') },
    ...(['minimal', 'low', 'medium', 'high', 'xhigh'] as const).map((v) => ({
      id: v,
      label: formatReasoningEffortLabel(v),
    })),
  ]

  const codexPermOptions = [
    { id: 'default' as const, label: t('resources.automation.defaultValue'), description: t('resources.automation.defaultDesc') },
    { id: 'full-access' as const, label: t('resources.automation.fullAccess'), description: t('resources.automation.fullAccessDesc') },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-muted-foreground" />
            {editAutomation ? t('resources.automation.editTitle') : t('resources.automation.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {editAutomation ? t('resources.automation.editDescription') : t('resources.automation.createDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-6 py-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t('resources.automation.name')}</span>
            <input
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t('resources.automation.namePlaceholder')}
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t('resources.automation.provider')}</span>
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {(['claude', 'codex'] as AgentType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, agentType: t }))}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    form.agentType === t
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t === 'claude' ? 'Claude Code' : 'Codex'}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t('resources.automation.prompt')}</span>
            <textarea
              className="min-h-[80px] resize-y rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              placeholder={t('resources.automation.promptPlaceholder')}
              rows={3}
            />
          </label>

          <SchedulePicker
            value={form.schedule}
            onChange={(schedule) => setForm((f) => ({ ...f, schedule }))}
          />

          {editAutomation && (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="flex flex-col">
                <span className="text-xs font-medium">{t('resources.automation.enabled')}</span>
                <span className="text-[10px] text-muted-foreground">
                  {form.enabled ? t('resources.automation.enabledOn') : t('resources.automation.enabledOff')}
                </span>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              />
            </div>
          )}

          <div className="border-t border-border pt-3">
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => setShowAgentSettings(!showAgentSettings)}
            >
              {showAgentSettings ? t('resources.automation.agentSettingsHide') : t('resources.automation.agentSettingsShow')}
            </button>

            {showAgentSettings && (
              <div className="mt-3 flex flex-col gap-3">
                {form.agentType === 'claude' && (
                  <>
                    <PopoverSelect
                      label={t('resources.automation.model')}
                      value={form.claudeConfig.model ?? ''}
                      options={claudeModelOptions}
                      onChange={(v) => updateClaude({ model: v || undefined })}
                      width="w-64"
                    />
                    <PopoverSelect
                      label={t('resources.automation.effort')}
                      value={(form.claudeConfig.effort ?? '') as string}
                      options={effortOptions as { id: string; label: string }[]}
                      onChange={(v) => updateClaude({ effort: (v || undefined) as EffortLevel | undefined })}
                    />
                    <PopoverSelect
                      label={t('resources.automation.permission')}
                      value={form.claudeConfig.permissionMode ?? 'bypassPermissions'}
                      options={permissionModes.map((m) => ({ ...m, label: t(`chat.permissionModes.${m.id}.label`), description: t(`chat.permissionModes.${m.id}.description`) }))}
                      onChange={(v) => updateClaude({ permissionMode: v as ClaudeRunConfig['permissionMode'] })}
                    />
                    <PopoverSelect
                      label={t('resources.automation.sandbox')}
                      value={form.claudeConfig.sandboxMode ?? 'on'}
                      options={sandboxModes.map((m) => ({ ...m, label: t(`chat.sandboxModes.${m.id}.label`), description: t(`chat.sandboxModes.${m.id}.description`) }))}
                      onChange={(v) => updateClaude({ sandboxMode: v as ClaudeRunConfig['sandboxMode'] })}
                    />
                  </>
                )}

                {form.agentType === 'codex' && (
                  <>
                    <PopoverSelect
                      label={t('resources.automation.model')}
                      value={form.codexConfig.model ?? ''}
                      options={codexModelOptions}
                      onChange={(v) => updateCodex({ model: v || undefined })}
                      width="w-64"
                    />
                    <PopoverSelect
                      label={t('resources.automation.reasoning')}
                      value={(form.codexConfig.reasoningEffort ?? '') as string}
                      options={codexReasoningOptions as { id: string; label: string }[]}
                      onChange={(v) => updateCodex({ reasoningEffort: (v || undefined) as CodexRunConfig['reasoningEffort'] })}
                    />
                    <PopoverSelect
                      label={t('resources.automation.permission')}
                      value={form.codexConfig.permissionPreset ?? 'default'}
                      options={codexPermOptions}
                      onChange={(v) => updateCodex({ permissionPreset: v as CodexRunConfig['permissionPreset'] })}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <div>
            {editAutomation && (
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleDelete}>
                <Trash2 className="size-3.5" /> {t('resources.providerDialog.delete')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSubmit} disabled={!isValid}>{editAutomation ? t('resources.automation.save') : t('resources.automation.create')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
