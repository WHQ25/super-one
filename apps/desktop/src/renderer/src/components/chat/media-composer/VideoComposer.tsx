import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { composerForSession, type OpenedComposerProps } from '../composer-slot/composer-registry'
import { MediaComposerFrame, MediaGenerateButton, MediaRunModeSelector, MediaStopButton } from './MediaComposerFrame'
import { MediaComposerResults } from './MediaComposerResults'
import { MediaComposerStatus, StatusAction } from './MediaComposerStatus'
import { MediaReferences } from './MediaReferences'
import { useVideoControls } from './MediaSelectors'
import { referenceRoles } from './media-capabilities'
import { cancelMediaGeneration, setMediaResult, useMediaRuns } from './media-composer-runs'
import { useMediaComposer } from './use-media-composer'

/** The user-started video composer, opened as `superone.video`. */
export function VideoComposer(props: OpenedComposerProps) {
  const { t } = useTranslation()
  const { instanceId, lifetime, session, active, submit, cancel } = props
  const media = useMediaComposer('video', props)
  const { form, change, run, setError } = media
  const [checking, setChecking] = useState(false)
  const statusInFlight = useRef(false)
  const pending = run.result?.status === 'running'
  const roles = referenceRoles(media.videoCapabilities)
  const controls = useVideoControls({ models: media.models, selected: media.selected, onSelectModel: media.selectModel,
    onRefreshModels: () => void media.loadModels(), modelsLoading: media.loading, settings: form, allowAuto: true, onChange: change })

  useEffect(() => {
    if (lifetime !== 'sticky' || !active || run.result || run.requestId) return
    let live = true
    void window.environment.mediaPendingVideos(session).then(results => {
      if (live && results[0] && !useMediaRuns.getState().runs[instanceId]?.requestId) setMediaResult(instanceId, results[0])
    }).catch(error => { if (live) setError(String(error)) })
    return () => { live = false }
  }, [lifetime, active, instanceId, session, run.result, run.requestId, setError])

  const checkStatus = useCallback(async () => {
    if (!active || !run.result || statusInFlight.current) return
    statusInFlight.current = true; setChecking(true); setError('')
    try {
      const result = await window.environment.mediaVideoStatus(session, run.result.generationId)
      if (useMediaRuns.getState().runs[instanceId]) setMediaResult(instanceId, result)
    } catch (error) { setError(String(error)) }
    finally { statusInFlight.current = false; setChecking(false) }
  }, [active, instanceId, run.result, session, setError])
  useEffect(() => {
    if (!active || !pending || form.paused) return
    const timer = setTimeout(() => void checkStatus(), 30_000)
    return () => clearTimeout(timer)
  }, [active, pending, form.paused, checkStatus, media.error])

  return (
    <MediaComposerFrame
      kind="video"
      prompt={form.prompt}
      onPromptChange={prompt => change({ prompt })}
      onSubmit={media.generate}
      promptDisabled={!active || media.busy}
      controlsDisabled={!active || media.busy}
      onExit={active ? cancel : undefined}
      onFiles={roles.length ? media.addFiles : undefined}
      above={run.result?.status === 'succeeded' && <MediaComposerResults target={session} result={run.result} disabled={!active}
        onUse={() => submit({ result: run.result })} onReturn={() => composerForSession(session).returnToChat()} />}
      references={roles.length > 0 && <MediaReferences kind="video" references={form.references} roles={roles} onChange={references => change({ references })} onAdd={media.addFiles} />}
      controls={controls}
      actions={<>
        <MediaRunModeSelector value={form.runMode} onChange={runMode => change({ runMode })} />
        {run.requestId
          ? <MediaStopButton label={t('mediaComposer.cancel')} disabled={!active} onClick={() => void cancelMediaGeneration(instanceId).catch(error => setError(String(error)))} />
          : <MediaGenerateButton mode={form.runMode} busy={media.delegating || pending} disabled={!media.canGenerate} onClick={media.generate} />}
      </>}
      status={<MediaComposerStatus kind="video" loading={media.loading} hasModels={!!media.models.length} error={media.error} onRetry={() => void media.loadModels()}
        busyLabel={run.requestId ? t('mediaComposer.submitting') : pending ? t('mediaComposer.pending') : undefined}>
        {pending && <>
          <span className="min-w-0 truncate text-muted-foreground/70">{t(form.paused ? 'mediaComposer.videoContinues' : 'mediaComposer.polling')}</span>
          <span className="flex-1" />
          <StatusAction disabled={!active || checking} onClick={() => void checkStatus()}>{t('mediaComposer.check')}</StatusAction>
          <StatusAction disabled={!active} onClick={() => change({ paused: !form.paused })}>{t(form.paused ? 'mediaComposer.resumePolling' : 'mediaComposer.stopPolling')}</StatusAction>
        </>}
      </MediaComposerStatus>}
    />
  )
}
