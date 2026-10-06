import { useCallback, useEffect, useState } from 'react'
import type { MediaComposerKind, MediaComposerModel, MediaComposerReference } from '@superone/shared/media-composer'
import { useAppStore } from '@/stores/app'
import { composerForSession, type OpenedComposerProps } from '../composer-slot/composer-registry'
import type { MediaRunMode } from './MediaComposerFrame'
import { useReferenceFiles } from './MediaReferences'
import { GENERIC_IMAGE, GENERIC_VIDEO, fitImageSettings, fitVideoSettings, referenceRoles } from './media-capabilities'
import { delegateMediaToAgent } from './media-composer-output'
import { runMediaGeneration, useMediaRuns, type MediaRun } from './media-composer-runs'

export interface MediaComposerForm {
  prompt: string
  providerId?: string
  model?: string
  references: MediaComposerReference[]
  size?: string
  aspectRatio?: string
  duration?: number
  resolution?: string
  seed?: number
  generateAudio?: boolean
  watermark?: boolean
  cameraFixed?: boolean
  runMode: MediaRunMode
  paused?: boolean
}

const EMPTY_RUN: MediaRun = {}

export function openProviderSettings() {
  useAppStore.getState().setSettingsTab('providers')
  useAppStore.getState().navigateTo('settings')
}

/** State shared by the user-started image and video composers. */
export function useMediaComposer(kind: MediaComposerKind, { instanceId, session, value, onValueChange, active }: OpenedComposerProps) {
  const [models, setModels] = useState<MediaComposerModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [delegating, setDelegating] = useState(false)
  const run = useMediaRuns(state => state.runs[instanceId] ?? EMPTY_RUN)
  const form: MediaComposerForm = {
    ...value,
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
    references: Array.isArray(value.references) ? value.references : [],
    runMode: value.runMode === 'agent' ? 'agent' : 'direct',
  }
  const change = (patch: Partial<MediaComposerForm>) => onValueChange({ ...value, ...patch })
  const selected = form.providerId || form.model ? models.find(model => model.providerId === form.providerId && model.model === form.model)
    : models.find(model => model.default) ?? models[0]
  const videoCapabilities = selected?.video ?? GENERIC_VIDEO
  // New files arrive as plain references; a model without them gives each a role it reads.
  const addFiles = useReferenceFiles(form.references, references => change({
    references: kind === 'video' ? fitVideoSettings({ references }, videoCapabilities, true).references : references }))

  const loadModels = useCallback(async () => {
    setLoading(true); setError('')
    try { setModels(await window.environment.mediaModels(kind)) }
    catch (cause) { setError(String(cause)) }
    finally { setLoading(false) }
  }, [kind])
  useEffect(() => { void loadModels() }, [loadModels])

  const busy = !!run.requestId || run.result?.status === 'running' || delegating
  const canGenerate = active && !busy && !loading && !!selected && !!form.prompt.trim()
  // References only travel when the model reads image inputs at all.
  const references = kind === 'video' && !referenceRoles(videoCapabilities).length ? [] : form.references
  const settings = kind === 'image'
    ? { aspectRatio: form.aspectRatio || undefined, size: form.size || undefined }
    : { aspectRatio: form.aspectRatio || undefined, duration: form.duration, resolution: form.resolution || undefined,
        seed: form.seed, generateAudio: form.generateAudio, watermark: form.watermark, cameraFixed: form.cameraFixed }
  const generate = () => {
    if (!canGenerate) return
    setError('')
    if (form.runMode === 'agent') {
      setDelegating(true)
      void delegateMediaToAgent(session, { kind, model: selected, prompt: form.prompt, references, ...settings })
        .then(() => composerForSession(session).returnToChat())
        .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setDelegating(false))
      return
    }
    void runMediaGeneration(instanceId, { ...session, requestId: crypto.randomUUID(), kind,
      providerId: selected.providerId, model: selected.model, prompt: form.prompt, references, ...settings })
  }
  const selectModel = (model: MediaComposerModel) => change({ providerId: model.providerId, model: model.model,
    ...(kind === 'image' ? fitImageSettings(form, model.image ?? GENERIC_IMAGE) : fitVideoSettings(form, model.video ?? GENERIC_VIDEO, true)) })
  return { form, change, models, selected, selectModel, videoCapabilities, loading, loadModels, run, busy, delegating, canGenerate, generate, addFiles,
    error: error || run.error || run.result?.error || '', setError }
}
