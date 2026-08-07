import { useState, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import type { ConfigConfirmPayload } from '@superone/shared/agent-types'
import { SettingField, type SettingFieldValue } from '../settings/SettingField'
import { isStructuredFieldType, StructuredSettingField } from '../settings/StructuredSettingField'
import {
  TerminalPalettePicker,
  terminalPaletteSchemeForKey,
} from '../settings/TerminalPalettePicker'
import {
  MermaidThemePicker,
  mermaidThemeSchemeForKey,
} from '../settings/MermaidThemePicker'
import { useAppStore } from '@/stores/app'
import { DEFAULT_TERMINAL_FONT_SIZE } from '@/components/coding/terminal-palettes'
import { diffConfigFieldValue, formatSettingsFieldDisplay } from '@/lib/config-field-summary'
import { hasOpenRadixOverlay } from '@/lib/radix-overlay'
import { canAutofocusInChatRoot, isFocusInChat, useChatRootRef } from './is-focus-in-chat'

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
const hasOpenPopover = hasOpenRadixOverlay

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value)
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
  const chatRootRef = useChatRootRef()
  // Preview sibling font settings: prefer values from this confirm batch, else live app store.
  const storeTerminalFontSize = useAppStore((s) => s.terminalFontSize)
  const storeTerminalFontFamily = useAppStore((s) => s.terminalFontFamily)
  const previewFontSize = typeof values.terminalFontSize === 'number'
    ? values.terminalFontSize
    : (storeTerminalFontSize ?? DEFAULT_TERMINAL_FONT_SIZE)
  const previewFontFamily = values.terminalFontFamily !== undefined
    ? asNullableString(values.terminalFontFamily)
    : storeTerminalFontFamily

  const setValue = (key: string, value: ConfigValue): void => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  useEffect(() => {
    if (isCollapsed) return
    requestAnimationFrame(() => {
      if (!canAutofocusInChatRoot(chatRootRef?.current)) return
      confirmBtnRef.current?.focus()
    })
  }, [isCollapsed, chatRootRef])

  useEffect(() => {
    if (isCollapsed) return
    function onKeyDown(e: KeyboardEvent): void {
      if (!isFocusInChat(document.activeElement, chatRootRef?.current)) return
      if (hasOpenPopover()) return
      if (isEditableElement(document.activeElement)) return
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        feedbackRef.current?.focus()
        return
      }
      // Reject is always available (feedback optional).
      if (e.key === 'Escape') {
        e.preventDefault()
        onReject(feedback.trim())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isCollapsed, feedback, onReject, chatRootRef])

  const handleFeedbackKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onReject(feedback.trim())
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onReject(feedback.trim())
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
              <p className={`truncate text-xs ${isDelete ? 'text-destructive/80' : 'text-muted-foreground'}`}>
                {[resource.subtitle, resource.context?.endpointId].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        )}

        {!isDelete && (
          <div className="mb-3 flex flex-col divide-y divide-border/60 rounded border border-border/60 bg-muted/20">
            {fields.map((field) => {
              const structured = isStructuredFieldType(field.type)
              const terminalScheme = terminalPaletteSchemeForKey(field.key)
              const mermaidScheme = mermaidThemeSchemeForKey(field.key)
              const themePreview = terminalScheme !== null || mermaidScheme !== null
              const diff = diffConfigFieldValue(field.type, field.currentValue, values[field.key])
              const meta = (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-xs font-medium text-foreground">{field.label}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {diff ?? t('chat.configConfirm.currentValue', {
                      value: formatSettingsFieldDisplay(field.key, field.type, field.currentValue, emptyLabel),
                    })}
                  </span>
                  {field.note && !structured && !themePreview && (
                    <span className="truncate text-xs text-muted-foreground/70">{field.note}</span>
                  )}
                </div>
              )
              if (terminalScheme) {
                return (
                  <div key={field.key} className="flex flex-col gap-2 px-2.5 py-2">
                    {meta}
                    <TerminalPalettePicker
                      scheme={terminalScheme}
                      value={asNullableString(values[field.key])}
                      onChange={(id) => setValue(field.key, id)}
                      fontSize={previewFontSize}
                      fontFamily={previewFontFamily}
                      size="compact"
                      clearable={field.clearable}
                    />
                  </div>
                )
              }
              if (mermaidScheme) {
                return (
                  <div key={field.key} className="flex flex-col gap-2 px-2.5 py-2">
                    {meta}
                    <MermaidThemePicker
                      scheme={mermaidScheme}
                      value={asNullableString(values[field.key])}
                      onChange={(id) => setValue(field.key, id)}
                      size="compact"
                      clearable={field.clearable}
                    />
                  </div>
                )
              }
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
            className="h-7 cursor-pointer bg-destructive px-3 text-xs text-destructive-foreground hover:bg-destructive/90 focus:ring-2 focus:ring-destructive focus:outline-none"
            onClick={() => onReject(feedback.trim())}
          >
            {t('chat.configConfirm.reject')}
            <Kbd variant="inline" className="ml-1 text-destructive-foreground/70">
              {isFeedbackFocused ? '↵' : 'esc'}
            </Kbd>
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
