import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { composerForSession, type OpenedComposerProps } from '../composer-slot/composer-registry'
import { MediaComposerFrame, MediaGenerateButton, MediaRunModeSelector, MediaStopButton } from './MediaComposerFrame'
import { MediaComposerResults } from './MediaComposerResults'
import { MediaReferences } from './MediaReferences'
import { useImageControls } from './MediaSelectors'
import { MediaComposerStatus } from './MediaComposerStatus'
import { cancelMediaGeneration } from './media-composer-runs'
import { useMediaComposer } from './use-media-composer'

/** The user-started image composer, opened as `superone.image`. */
export function ImageComposer(props: OpenedComposerProps) {
  const { t } = useTranslation()
  const { instanceId, session, active, submit, cancel } = props
  const media = useMediaComposer('image', props)
  const { form, change, run } = media
  const generating = !!run.requestId
  const controls = useImageControls({ models: media.models, selected: media.selected, onSelectModel: media.selectModel,
    onRefreshModels: () => void media.loadModels(), modelsLoading: media.loading, aspectRatio: form.aspectRatio, size: form.size, onChange: change })
  return (
    <MediaComposerFrame
      kind="image"
      prompt={form.prompt}
      onPromptChange={prompt => change({ prompt })}
      onSubmit={media.generate}
      promptDisabled={!active || media.busy}
      controlsDisabled={!active || media.busy}
      onExit={active ? cancel : undefined}
      onFiles={media.addFiles}
      above={<>
        {generating && <div className="pb-2 pt-1"><div className="flex h-30 w-40 animate-pulse items-center justify-center rounded-lg bg-muted" role="status" aria-label={t('mediaComposer.generating')}><Loader2 className="size-4 animate-spin text-muted-foreground" /></div></div>}
        {run.result?.status === 'succeeded' && <MediaComposerResults target={session} result={run.result} disabled={!active}
          onUse={() => submit({ result: run.result })} onReturn={() => composerForSession(session).returnToChat()} />}
      </>}
      references={<MediaReferences kind="image" references={form.references} onChange={references => change({ references })} onAdd={media.addFiles} />}
      controls={controls}
      actions={<>
        <MediaRunModeSelector value={form.runMode} onChange={runMode => change({ runMode })} />
        {generating
          ? <MediaStopButton label={t('mediaComposer.cancel')} disabled={!active} onClick={() => void cancelMediaGeneration(instanceId).catch(error => media.setError(String(error)))} />
          : <MediaGenerateButton mode={form.runMode} busy={media.delegating} disabled={!media.canGenerate} onClick={media.generate} />}
      </>}
      status={<MediaComposerStatus kind="image" loading={media.loading} hasModels={!!media.models.length} error={media.error} onRetry={() => void media.loadModels()}
        busyLabel={generating ? t('mediaComposer.generating') : undefined} />}
    />
  )
}
