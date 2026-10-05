import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ImagePlus, Loader2, Video } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Label } from '@superone/ui/components/ui/label'
import { AutoResizeTextarea } from '@superone/ui/components/ui/auto-resize-textarea'
import type { MediaComposerKind, MediaComposerModel } from '@superone/shared/media-composer'
import { useAppStore } from '@/stores/app'
import { composerForSession, type OpenedComposerProps } from '../composer-slot/composer-registry'
import { MediaComposerFields, type MediaComposerForm } from './MediaComposerFields'
import { MediaComposerResults } from './MediaComposerResults'
import { cancelMediaGeneration, markMediaDelivery, runMediaGeneration, setMediaResult, useMediaRuns, type MediaRun } from './media-composer-runs'
import { sendMediaToAgent } from './media-composer-output'

const EMPTY_RUN: MediaRun = {}
export function ImageComposer(props: OpenedComposerProps) { return <MediaComposer {...props} kind="image" /> }
export function VideoComposer(props: OpenedComposerProps) { return <MediaComposer {...props} kind="video" /> }

function MediaComposer({ kind, instanceId, lifetime, session, value, onValueChange, active, submit, cancel }: OpenedComposerProps & { kind: MediaComposerKind }) {
  const { t } = useTranslation()
  const id = useId()
  const [models, setModels] = useState<MediaComposerModel[]>([])
  const [modelError, setModelError] = useState('')
  const [loading, setLoading] = useState(true)
  const [statusError, setStatusError] = useState('')
  const [checking, setChecking] = useState(false)
  const statusInFlight = useRef(false)
  const run = useMediaRuns(state => state.runs[instanceId] ?? EMPTY_RUN)
  const form: MediaComposerForm = {
    ...value,
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
    references: Array.isArray(value.references) ? value.references : [], output: value.output === 'agent' ? 'agent' : 'caller',
  }
  const change = (patch: Partial<MediaComposerForm>) => onValueChange({ ...value, ...patch })
  const selected = form.providerId || form.model ? models.find(model => model.providerId === form.providerId && model.model === form.model)
    : models.find(model => model.default) ?? models[0]
  const pending = run.result?.status === 'running'
  const sending = run.delivery === 'sending'
  const busy = !!run.requestId || pending || sending

  const loadModels = useCallback(async () => {
    setLoading(true); setModelError('')
    try { setModels(await window.environment.mediaModels(kind)) }
    catch (error) { setModelError(String(error)) }
    finally { setLoading(false) }
  }, [kind])
  useEffect(() => { void loadModels() }, [loadModels])
  useEffect(() => {
    if (kind !== 'video' || lifetime !== 'sticky' || !active || run.result || run.requestId) return
    let live = true
    void window.environment.mediaPendingVideos(session).then(results => {
      if (live && results[0] && !useMediaRuns.getState().runs[instanceId]?.requestId) setMediaResult(instanceId, results[0])
    }).catch(error => { if (live) setStatusError(String(error)) })
    return () => { live = false }
  }, [kind, lifetime, active, instanceId, session, run.result, run.requestId])

  const checkStatus = useCallback(async () => {
    if (!active || !run.result || statusInFlight.current) return
    statusInFlight.current = true; setChecking(true); setStatusError('')
    try {
      const result = await window.environment.mediaVideoStatus(session, run.result.generationId)
      if (useMediaRuns.getState().runs[instanceId]) setMediaResult(instanceId, result)
    } catch (error) { setStatusError(String(error)) }
    finally { statusInFlight.current = false; setChecking(false) }
  }, [active, instanceId, run.result, session])
  useEffect(() => {
    if (!active || !pending || form.paused) return
    const timer = setTimeout(() => void checkStatus(), 30_000)
    return () => clearTimeout(timer)
  }, [active, pending, form.paused, checkStatus, statusError])

  useEffect(() => {
    const result = run.result
    if (!active || result?.status !== 'succeeded' || form.output !== 'agent') return
    if (run.delivery === 'sent') { submit({ result }); return }
    if (run.delivery) return
    markMediaDelivery(instanceId, 'sending')
    void sendMediaToAgent(session, result).then(() => markMediaDelivery(instanceId, 'sent')).catch(error => {
      markMediaDelivery(instanceId, 'failed', error instanceof Error && error.message === 'remoteVideoUnavailable' ? t('mediaComposer.remoteVideoUnavailable') : String(error))
      // Keep the completed result available for an explicit retry.
    })
  }, [active, run.result, run.delivery, form.output, instanceId, session, submit, t])

  const generate = () => {
    if (!active || busy || !form.prompt.trim() || !selected) return
    setStatusError('')
    void runMediaGeneration(instanceId, { ...session, requestId: crypto.randomUUID(), kind,
      providerId: selected.providerId, model: selected.model, prompt: form.prompt, references: form.references,
      size: form.size || undefined, aspectRatio: form.aspectRatio || undefined,
      duration: form.duration, resolution: form.resolution || undefined })
  }
  const returnToChat = () => composerForSession(session).returnToChat()
  return <div className="@container mx-3 mb-1 flex flex-col gap-3 rounded-xl border border-border bg-card p-3" data-media-composer={kind}>
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-sm font-medium">{kind === 'image' ? <ImagePlus className="size-4" /> : <Video className="size-4" />}{t(`mediaComposer.${kind}`)}</span>
      <Button size="sm" variant="ghost" disabled={!active || sending} onClick={cancel}><ArrowLeft className="size-3.5" />{t('mediaComposer.chat')}</Button>
    </div>
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">{t('mediaComposer.prompt')}</Label>
      <AutoResizeTextarea id={id} value={form.prompt} disabled={!active || busy} onValueChange={prompt => change({ prompt })} onSubmit={generate}
        maxRows={6} maxLength={32_000} placeholder={t(kind === 'image' ? 'mediaComposer.imagePlaceholder' : 'mediaComposer.videoPlaceholder')} className="min-h-8 text-sm" />
    </div>
    {loading ? <p role="status" className="text-xs text-muted-foreground">{t('mediaComposer.loading')}</p> : !models.length ? <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs text-muted-foreground">{t('mediaComposer.noModels')}</p>
      <Button size="sm" variant="outline" disabled={!active} onClick={() => {
        useAppStore.getState().setSettingsTab('providers'); useAppStore.getState().navigateTo('settings')
      }}>{t('mediaComposer.settings')}</Button>
      <Button size="sm" variant="ghost" disabled={!active} onClick={() => void loadModels()}>{t('mediaComposer.retry')}</Button>
    </div> : <MediaComposerFields kind={kind} form={form} models={models} selected={selected} disabled={!active || busy} change={change} />}
    {(modelError || run.error || statusError || run.result?.error) && <p role="alert" className="break-words text-xs text-destructive">{modelError || run.error || statusError || run.result?.error}</p>}
    {pending && <div className="flex flex-col gap-2 rounded-lg border border-border p-2" role="status">
      <span className="flex items-center gap-2 text-xs"><Loader2 className="size-3.5 animate-spin" />{t('mediaComposer.pending')}</span>
      <p className="text-xs text-muted-foreground">{t('mediaComposer.videoContinues')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!active || checking} onClick={() => void checkStatus()}>{t('mediaComposer.check')}</Button>
        <Button size="sm" variant="ghost" disabled={!active} onClick={() => change({ paused: !form.paused })}>{t(form.paused ? 'mediaComposer.resumePolling' : 'mediaComposer.stopPolling')}</Button>
      </div>
    </div>}
    {run.result?.status === 'succeeded' && <MediaComposerResults target={session} result={run.result} disabled={!active || sending}
      onUse={() => submit({ result: run.result })} onReturn={returnToChat} />}
    <div className="flex items-center gap-2">
      <Button size="sm" disabled={!active || busy || loading || !selected || !form.prompt.trim()} onClick={generate}>
        {(run.requestId || sending) && <Loader2 className="size-3.5 animate-spin" />}
        {run.requestId ? t(kind === 'image' ? 'mediaComposer.generating' : 'mediaComposer.submitting') : t('mediaComposer.generate')}
      </Button>
      {run.requestId && <Button size="sm" variant="ghost" disabled={!active} onClick={() => void cancelMediaGeneration(instanceId).catch(error => setStatusError(String(error)))}>{t('mediaComposer.cancel')}</Button>}
    </div>
  </div>
}
