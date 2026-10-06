import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import { VIDEO_GEN_PARAMS_FIELD, type PermissionRequest, type VideoGenConfirmPayload, type VideoGenParams } from '@superone/shared/agent-types'
import type { MediaComposerModel } from '@superone/shared/media-composer'
import { useScopedSessionActions } from '@/stores/chat'
import { PermissionFeedbackInput } from '../PermissionActionBar'
import { MediaComposerFrame, MediaGenerateButton } from './MediaComposerFrame'
import { StatusAction } from './MediaComposerStatus'
import { MediaReferenceStrip } from './MediaReferences'
import { useVideoControls } from './MediaSelectors'
import { fitVideoSettings, type VideoSettings } from './media-capabilities'

/** Fits the agent's parameters to the model's controls; values a model does not read are cleared. */
function fitParams(params: VideoGenParams, model: MediaComposerModel | undefined): VideoGenParams {
  // Without reported capabilities the agent's values stand; the controls fall back to the common ones.
  if (!model?.video) return params
  const fitted = fitVideoSettings(params, model.video, false)
  return { ...fitted, aspectRatio: fitted.aspectRatio ?? '', resolution: fitted.resolution ?? '', duration: fitted.duration ?? params.duration,
    generateAudio: !!fitted.generateAudio, watermark: !!fitted.watermark, cameraFixed: !!fitted.cameraFixed }
}

/**
 * The video composer reviewing an agent's `media_generate_video` request. The
 * user may edit everything the tool accepts; Generate returns the final
 * parameters, which the tool submits.
 */
export function VideoConfirmComposer({ request }: { request: PermissionRequest & { videoGenConfirm: VideoGenConfirmPayload } }) {
  const { t } = useTranslation()
  const { respondToPermission } = useScopedSessionActions()
  const payload = request.videoGenConfirm
  const [feedback, setFeedback] = useState('')
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const models = useMemo(() => {
    const listed: MediaComposerModel[] = payload.providers.flatMap(provider => provider.models.map(model => ({
      providerId: provider.id, providerLabel: provider.label, model: model.id, label: model.label, default: false,
      ...(model.capabilities ? { video: model.capabilities } : {}),
    })))
    const { provider, model } = payload.params
    // Keep the agent's own choice visible even when the catalog does not list it.
    return listed.some(item => item.providerId === provider && item.model === model) ? listed
      : [{ providerId: provider, providerLabel: payload.providers.find(item => item.id === provider)?.label ?? provider, model, label: model, default: false }, ...listed]
  }, [payload])
  const find = (provider: string, model: string) => models.find(item => item.providerId === provider && item.model === model)
  const [form, setForm] = useState<VideoGenParams>(() => fitParams(payload.params, find(payload.params.provider, payload.params.model)))
  const selected = find(form.provider, form.model)

  useEffect(() => {
    let live = true
    void Promise.all(payload.referenceImages.map(async ref => {
      const loaded = await window.app.readFileAsDataUri(ref.path).catch(() => null)
      return loaded?.ok ? [ref.path, loaded.dataUri] as const : null
    })).then(entries => { if (live) setThumbnails(Object.fromEntries(entries.filter(entry => entry !== null))) })
    return () => { live = false }
  }, [payload.referenceImages])
  let referenceIndex = 0
  const references = payload.referenceImages.flatMap(ref => thumbnails[ref.path] ? [{
    key: ref.path, src: thumbnails[ref.path]!, name: ref.path.split(/[\\/]/).at(-1) ?? ref.path,
    label: ref.role === 'first_frame' ? t('mediaComposer.first') : ref.role === 'last_frame' ? t('mediaComposer.last')
      : t('mediaComposer.referenceNumber', { index: ++referenceIndex }),
  }] : [])

  const valid = !!form.prompt.trim() && !!form.provider && !!form.model
  const confirm = () => {
    if (!valid) return
    void respondToPermission(request.requestId, true, undefined, undefined, undefined, undefined, { [VIDEO_GEN_PARAMS_FIELD]: JSON.stringify(form) })
  }
  const reject = () => void respondToPermission(request.requestId, false, undefined, undefined, undefined, undefined, { feedback: feedback.trim() })
  const selectModel = (model: MediaComposerModel) => setForm(previous => fitParams({ ...previous, provider: model.providerId, model: model.model }, model))
  const controls = useVideoControls({ models, selected, onSelectModel: selectModel, settings: form, allowAuto: false,
    onChange: (patch: VideoSettings) => setForm(previous => ({ ...previous, ...patch,
      aspectRatio: patch.aspectRatio ?? previous.aspectRatio, resolution: patch.resolution ?? previous.resolution, duration: patch.duration ?? previous.duration,
      generateAudio: patch.generateAudio ?? previous.generateAudio, watermark: patch.watermark ?? previous.watermark, cameraFixed: patch.cameraFixed ?? previous.cameraFixed })) })
  return (
    <MediaComposerFrame
      kind="video"
      prompt={form.prompt}
      onPromptChange={prompt => setForm(previous => ({ ...previous, prompt }))}
      onSubmit={confirm}
      references={<MediaReferenceStrip items={references} />}
      controls={controls}
      actions={<>
        <StatusAction className="h-6 px-2" onClick={reject}>{t('mediaComposer.reject')}</StatusAction>
        <MediaGenerateButton disabled={!valid} onClick={confirm} />
      </>}
      status={<>
        <Bot className="size-3.5 shrink-0" />
        <span className="shrink-0">{t('mediaComposer.agentVideoRequest')}</span>
        <div className="min-w-0 flex-1 py-0.5">
          <PermissionFeedbackInput value={feedback} onChange={setFeedback} onFocusChange={() => {}} onSubmit={reject} placeholder={t('mediaComposer.rejectFeedback')} />
        </div>
      </>}
    />
  )
}
