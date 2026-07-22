import { useState, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import type { ConfigConfirmPayload } from '@superone/shared/agent-types'
import { SettingField, type SettingFieldValue } from '../settings/SettingField'
import { isStructuredFieldType, StructuredSettingField } from '../settings/StructuredSettingField'
import { diffConfigFieldValue, formatConfigFieldValue } from '@/lib/config-field-summary'

type ConfigValue = unknown

export interface ConfigConfirmPromptProps {
  payload: ConfigConfirmPayload
  onConfirm: (values: Record<string, ConfigValue>) => void
  onReject: (feedback: string) => void
}

function isEditableElement(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true
  return el.getAttribute('role') === 'combobox'
}

// Modal layers lock scroll; non-modal ones (the add-model Popover) only mount a popper wrapper — both
// must swallow Escape/Tab so dismissing a picker never reaches the reject shortcut.
function hasOpenPopover(): boolean {
  return document.body.hasAttribute('data-scroll-locked') || !!document.querySelector('[data-radix-popper-content-wrapper]')
}

export function ConfigConfirmPrompt({ payload, onConfirm, onReject }: ConfigConfirmPromptProps) {
  const { t } = useTranslation()
  const resource = payload.resource
  const isDelete = resource?.operation === 'delete'
  const fields = resource?.fields ?? payload.fields ?? []
  const [values, setValues] = useState<Record<string, ConfigValue>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.proposedValue])),
  )
  const [feedback, setFeedback] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isFeedbackFocused, setIsFeedbackFocused] = useState(false)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const feedbackRef = useRef<HTMLInputElement>(null)

  const setValue = (key: string, value: ConfigValue): void => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const canReject = feedback.trim().length > 0

  useEffect(() => {
    if (isCollapsed) return
    requestAnimationFrame(() => confirmBtnRef.current?.focus())
  }, [isCollapsed])

  useEffect(() => {
    if (isCollapsed) return
    function onKeyDown(e: KeyboardEvent): void {
      if (hasOpenPopover()) return
      if (isEditableElement(document.activeElement)) return
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        feedbackRef.current?.focus()
        return
      }
      if (e.key === 'Escape' && canReject) {
        e.preventDefault()
        onReject(feedback.trim())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isCollapsed, canReject, feedback, onReject])

  const handleFeedbackKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (canReject) onReject(feedback.trim())
    } else if (e.key === 'Escape') {
      e.preventDefault()
      feedbackRef.current?.blur()
    }
  }

  const emptyLabel = t('chat.configConfirm.emptyValue')

  if (isCollapsed) {
    return (
      <div className="mx-3 mb-2">
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
        >
          <SlidersHorizontal className="size-3.5 shrink-0 animate-pulse text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">{t('chat.configConfirm.title')}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {resource ? [resource.title, resource.subtitle].filter(Boolean).join(' — ') : fields.map((f) => f.label).join(', ')}
          </span>
          <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </div>
    )
  }

  return (
    <div className="mx-3 mb-2">
      <div className="rounded-lg border border-border bg-card p-3">
        <button
          type="button"
          onClick={() => setIsCollapsed(true)}
          className="group mb-2 flex w-full cursor-pointer items-center justify-between gap-2 text-left"
        >
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">{t('chat.configConfirm.title')}</span>
          </div>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </button>

        {resource && (
          <div className={`mb-3 rounded border px-2.5 py-2 ${isDelete ? 'border-destructive/40 bg-destructive/10' : 'border-border/60 bg-muted/20'}`}>
            <p className={`truncate text-xs font-medium ${isDelete ? 'text-destructive' : 'text-foreground'}`}>{resource.title}</p>
            {(resource.subtitle || resource.context?.endpointId) && (
              <p className={`truncate text-[10px] ${isDelete ? 'text-destructive/80' : 'text-muted-foreground'}`}>
                {[resource.subtitle, resource.context?.endpointId].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        )}

        {!isDelete && (
          <div className="mb-3 flex flex-col divide-y divide-border/60 rounded border border-border/60 bg-muted/20">
            {fields.map((field) => {
              const structured = isStructuredFieldType(field.type)
              const diff = diffConfigFieldValue(field.type, field.currentValue, values[field.key])
              const meta = (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[11px] font-medium text-foreground">{field.label}</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {diff ?? t('chat.configConfirm.currentValue', { value: formatConfigFieldValue(field.type, field.currentValue, emptyLabel) })}
                  </span>
                  {field.note && !structured && <span className="truncate text-[10px] text-muted-foreground/70">{field.note}</span>}
                </div>
              )
              return structured ? (
                <div key={field.key} className="flex flex-col gap-2 px-2.5 py-2">
                  {meta}
                  <StructuredSettingField field={field} value={values[field.key]} onChange={(v) => setValue(field.key, v)} />
                </div>
              ) : (
                <div key={field.key} className="flex items-center justify-between gap-3 px-2.5 py-2">
                  {meta}
                  <div className="flex-none">
                    <SettingField
                      field={field}
                      value={values[field.key] as SettingFieldValue}
                      onChange={(v) => setValue(field.key, v)}
                      size="compact"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            ref={confirmBtnRef}
            size="sm"
            className={
              isDelete
                ? 'h-7 cursor-pointer bg-destructive px-3 text-xs text-destructive-foreground hover:bg-destructive/90 focus:ring-2 focus:ring-destructive focus:outline-none'
                : 'h-7 cursor-pointer bg-success px-3 text-xs text-success-foreground hover:bg-success/90 focus:ring-2 focus:ring-success focus:outline-none'
            }
            onClick={() => onConfirm(values)}
          >
            {isDelete ? t('chat.configConfirm.deleteConfirm') : t('chat.configConfirm.confirm')}
            {!isFeedbackFocused && (
              <Kbd variant="inline" className={isDelete ? 'ml-1 text-destructive-foreground/70' : 'ml-1 text-success-foreground/70'}>⏎</Kbd>
            )}
          </Button>
          <Button
            size="sm"
            disabled={!canReject}
            className="h-7 cursor-pointer bg-destructive px-3 text-xs text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-destructive focus:outline-none"
            onClick={() => onReject(feedback.trim())}
          >
            {t('chat.configConfirm.reject')}
            {canReject && (
              <Kbd variant="inline" className="ml-1 text-destructive-foreground/70">{isFeedbackFocused ? '↵' : 'esc'}</Kbd>
            )}
          </Button>
          <div className="relative flex min-w-0 basis-full items-center @lg:basis-0 @lg:flex-1">
            <input
              ref={feedbackRef}
              type="text"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onFocus={() => setIsFeedbackFocused(true)}
              onBlur={() => setIsFeedbackFocused(false)}
              onKeyDown={handleFeedbackKeyDown}
              placeholder={t('chat.configConfirm.feedbackPlaceholder')}
              className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Kbd className="pointer-events-none absolute right-2">{isFeedbackFocused ? '↵' : '⇥'}</Kbd>
          </div>
        </div>
      </div>
    </div>
  )
}
