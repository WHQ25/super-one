import { useState, useEffect, useRef, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Settings2, Video as VideoIcon } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Textarea } from '@superone/ui/components/ui/textarea'
import { Switch } from '@superone/ui/components/ui/switch'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@superone/ui/components/ui/select'
import type {
  VideoGenParams,
  VideoGenProviderOption,
  VideoGenReferenceImage,
} from '@superone/shared/agent-types'

// Canonical definitions live in @superone/shared/agent-types (main + renderer share them);
// re-exported here so existing importers (Storybook stories) keep working unchanged.
export type { VideoGenParams, VideoGenProviderOption, VideoGenReferenceImage }

export interface VideoGenConfirmPromptProps {
  params: VideoGenParams
  providers: VideoGenProviderOption[]
  referenceImages?: VideoGenReferenceImage[]
  onConfirm: (params: VideoGenParams) => void
  onReject: (feedback: string) => void
}

function ReferenceThumb({ image, label }: { image: VideoGenReferenceImage; label: string }) {
  return (
    <div className="flex w-20 flex-none flex-col gap-1">
      <div className="h-20 w-20 overflow-hidden rounded-md border border-border bg-muted/30">
        <img src={image.dataUri} alt={label} className="h-full w-full object-cover" />
      </div>
      <span className="truncate text-center text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium text-foreground">{label}</label>
      {children}
    </div>
  )
}

function isEditableElement(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true
  return el.getAttribute('role') === 'combobox'
}

function hasOpenPopover(): boolean {
  return document.body.hasAttribute('data-scroll-locked')
}

export function VideoGenConfirmPrompt({ params, providers, referenceImages = [], onConfirm, onReject }: VideoGenConfirmPromptProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<VideoGenParams>(params)
  const [feedback, setFeedback] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isFeedbackFocused, setIsFeedbackFocused] = useState(false)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const feedbackRef = useRef<HTMLInputElement>(null)

  const provider = providers.find((p) => p.id === form.provider) ?? providers[0]
  const models = provider?.models ?? []
  const aspectRatios = provider?.aspectRatios ?? []
  const resolutions = provider?.resolutions ?? []

  const setField = <K extends keyof VideoGenParams>(key: K, value: VideoGenParams[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleProviderChange = (providerId: string): void => {
    const next = providers.find((p) => p.id === providerId)
    if (!next) return
    setForm((prev) => ({
      ...prev,
      provider: providerId,
      model: next.models[0]?.id ?? '',
      aspectRatio: next.aspectRatios[0] ?? prev.aspectRatio,
      resolution: next.resolutions[0] ?? prev.resolution,
    }))
  }

  const isValid = form.prompt.trim().length > 0 && !!form.provider && !!form.model
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

  let referenceCount = 0

  if (isCollapsed) {
    return (
      <div className="mx-3 mb-2">
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
        >
          <VideoIcon className="size-3.5 shrink-0 animate-pulse text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">{t('chat.videoGenConfirm.title')}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{form.prompt}</span>
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
            <VideoIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">{t('chat.videoGenConfirm.title')}</span>
          </div>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </button>

        {referenceImages.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {referenceImages.map((img) => {
              const label = img.role === 'reference'
                ? t('chat.videoGenConfirm.reference', { index: ++referenceCount })
                : img.role === 'first_frame'
                  ? t('chat.videoGenConfirm.startFrame')
                  : t('chat.videoGenConfirm.endFrame')
              return <ReferenceThumb key={img.path} image={img} label={label} />
            })}
          </div>
        )}

        <div className="mb-2 flex flex-col gap-1">
          <label className="text-[11px] font-medium text-foreground">{t('chat.videoGenConfirm.promptLabel')}</label>
          <Textarea
            value={form.prompt}
            onChange={(e) => setField('prompt', e.target.value)}
            rows={3}
            className="resize-none text-xs"
            placeholder={t('chat.videoGenConfirm.promptPlaceholder')}
          />
        </div>

        <div className="mb-2 grid grid-cols-2 gap-2">
          <FormField label={t('chat.videoGenConfirm.providerLabel')}>
            <Select value={form.provider} onValueChange={handleProviderChange}>
              <SelectTrigger className="!h-7 w-full text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t('chat.videoGenConfirm.modelLabel')}>
            <Select value={form.model} onValueChange={(v) => setField('model', v)}>
              <SelectTrigger className="!h-7 w-full text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <div className="mb-2 grid grid-cols-3 gap-2">
          <FormField label={t('chat.videoGenConfirm.aspectRatioLabel')}>
            <Select value={form.aspectRatio} onValueChange={(v) => setField('aspectRatio', v)}>
              <SelectTrigger className="!h-7 w-full text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {aspectRatios.map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t('chat.videoGenConfirm.resolutionLabel')}>
            <Select value={form.resolution} onValueChange={(v) => setField('resolution', v)}>
              <SelectTrigger className="!h-7 w-full text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {resolutions.map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t('chat.videoGenConfirm.durationLabel')}>
            <Input
              type="number"
              value={form.duration}
              onChange={(e) => setField('duration', Number(e.target.value) || 0)}
              className="!h-7 text-xs"
            />
          </FormField>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="mb-2 flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="size-3 shrink-0" />
          {t('chat.videoGenConfirm.advancedOptions')}
          {showAdvanced ? <ChevronUp className="size-3 shrink-0" /> : <ChevronDown className="size-3 shrink-0" />}
        </button>

        {showAdvanced && (
          <div className="mb-3 flex flex-col gap-2 rounded border border-border/60 bg-muted/20 p-2">
            <div className="grid grid-cols-2 gap-2">
              <FormField label={t('chat.videoGenConfirm.fpsLabel')}>
                <Input
                  type="number"
                  value={form.fps ?? ''}
                  onChange={(e) => setField('fps', e.target.value === '' ? undefined : Number(e.target.value))}
                  placeholder={t('chat.videoGenConfirm.fpsPlaceholder')}
                  className="!h-7 text-xs"
                />
              </FormField>
              <FormField label={t('chat.videoGenConfirm.seedLabel')}>
                <Input
                  type="number"
                  value={form.seed ?? ''}
                  onChange={(e) => setField('seed', e.target.value === '' ? undefined : Number(e.target.value))}
                  placeholder={t('chat.videoGenConfirm.seedPlaceholder')}
                  className="!h-7 text-xs"
                />
              </FormField>
            </div>
            <div className="flex items-center justify-between gap-2 rounded border border-border bg-background/40 px-2 py-1.5">
              <span className="text-[11px] font-medium text-foreground">{t('chat.videoGenConfirm.generateAudio')}</span>
              <Switch checked={form.generateAudio} onCheckedChange={(v) => setField('generateAudio', v)} />
            </div>
            <div className="flex items-center justify-between gap-2 rounded border border-border bg-background/40 px-2 py-1.5">
              <span className="text-[11px] font-medium text-foreground">{t('chat.videoGenConfirm.watermark')}</span>
              <Switch checked={form.watermark} onCheckedChange={(v) => setField('watermark', v)} />
            </div>
            <div className="flex items-center justify-between gap-2 rounded border border-border bg-background/40 px-2 py-1.5">
              <span className="text-[11px] font-medium text-foreground">{t('chat.videoGenConfirm.lockCamera')}</span>
              <Switch checked={form.cameraFixed} onCheckedChange={(v) => setField('cameraFixed', v)} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            ref={confirmBtnRef}
            size="sm"
            disabled={!isValid}
            className="h-7 cursor-pointer bg-success px-3 text-xs text-success-foreground hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-success focus:outline-none"
            onClick={() => onConfirm(form)}
          >
            {t('chat.videoGenConfirm.confirm')}
            {!isFeedbackFocused && isValid && (
              <Kbd variant="inline" className="ml-1 text-success-foreground/70">⏎</Kbd>
            )}
          </Button>
          <Button
            size="sm"
            disabled={!canReject}
            className="h-7 cursor-pointer bg-destructive px-3 text-xs text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-destructive focus:outline-none"
            onClick={() => onReject(feedback.trim())}
          >
            {t('chat.videoGenConfirm.reject')}
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
              placeholder={t('chat.videoGenConfirm.feedbackPlaceholder')}
              className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Kbd className="pointer-events-none absolute right-2">{isFeedbackFocused ? '↵' : '⇥'}</Kbd>
          </div>
        </div>
      </div>
    </div>
  )
}
