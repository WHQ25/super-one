import { formatBytes } from '@superone/shared/format-bytes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileX2, FileWarning, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Button } from '@superone/ui/components/ui/button'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import type { PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import { PdfPreview } from '@/components/chat/PdfPreview'
import { CopyableMarkdown } from '@/components/chat/CopyableMarkdown'
import { ImagePreview } from '@/components/coding/ImagePreview'
import { NotebookPreview } from '@/components/coding/NotebookPreview'
import { FileWithDiffView } from '@/components/coding/source-control/FileWithDiffView'
import type { PreviewerLoadError, PreviewerLoadState } from './use-previewer-file'

export type PreviewerStageMode = 'card' | 'fullscreen'

interface PreviewerStageProps {
  file: PreviewerFile
  state: PreviewerLoadState
  mode: PreviewerStageMode
  projectPath?: string | null
  onUndecodable: () => void
  onRetry: () => void
}

function errorLabelKey(error: PreviewerLoadError): string {
  switch (error) {
    case 'missing': return 'chat.filesPreviewer.missing'
    case 'binary': return 'chat.filesPreviewer.unpreviewableBinary'
    case 'too_large': return 'chat.filesPreviewer.unpreviewableTooLarge'
    case 'outside': return 'chat.filesPreviewer.unpreviewableOutside'
    case 'undecodable': return 'chat.filesPreviewer.undecodable'
    case 'io': return 'chat.filesPreviewer.readFailed'
  }
}

/** Only a verdict that can change with time is worth a retry button. */
function isRetryable(error: PreviewerLoadError): boolean {
  return error === 'missing' || error === 'undecodable' || error === 'io'
}

function StageError({ file, error, onRetry }: { file: PreviewerFile; error: PreviewerLoadError; onRetry: () => void }) {
  const { t } = useTranslation()
  const [retrying, setRetrying] = useState(false)
  const Icon = error === 'missing' ? FileX2 : FileWarning
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground" data-testid="previewer-error">
      <Icon className="size-6" />
      <div className="max-w-full truncate font-mono text-xs">{file.name}</div>
      <div className="text-sm">{t(errorLabelKey(error))}</div>
      {file.size !== undefined && error !== 'missing' && (
        <div className="text-xs">{formatBytes(file.size)}</div>
      )}
      {isRetryable(error) && (
        <Button
          variant="outline"
          size="sm"
          className="mt-1"
          disabled={retrying}
          data-previewer-control
          onClick={(e) => {
            e.stopPropagation()
            setRetrying(true)
            Promise.resolve(onRetry()).finally(() => setRetrying(false))
          }}
        >
          <RefreshCw className={cn('size-3.5', retrying && 'animate-spin')} />
          {t('chat.filesPreviewer.retry')}
        </Button>
      )}
    </div>
  )
}

/**
 * One slide. In `card` mode the content is passive: text selection is off here
 * and the card intercepts clicks in the capture phase, so Markdown links and
 * copy buttons never fire and every click means "open". Media keep their
 * native control bar — play/seek works, and the card treats a click there as
 * not-a-click. `fullscreen` mode mounts the panel's full renderers with
 * everything on.
 */
export function PreviewerStage({ file, state, mode, projectPath, onUndecodable, onRetry }: PreviewerStageProps) {
  const { t } = useTranslation()
  const card = mode === 'card'

  if (state.status === 'error') return <StageError file={file} error={state.error} onRetry={onRetry} />
  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground" data-testid="previewer-loading">
        <Loader2 className="size-5 animate-spin" />
        <span className="sr-only">{t('chat.filesPreviewer.loading')}</span>
      </div>
    )
  }

  const inert = card ? 'select-none' : ''

  switch (file.kind) {
    case 'image':
      return card
        ? (
          <img
            src={state.url}
            alt={file.name}
            draggable={false}
            onError={onUndecodable}
            className={cn('max-h-full max-w-full object-contain', inert)}
          />
        )
        : <ImagePreview src={state.url!} alt={file.name} disableArrowKeys />
    case 'pdf':
      return (
        <div className={cn('h-full w-full', inert)}>
          <PdfPreview url={state.url!} className="h-full" variant={card ? 'stage' : 'full'} />
        </div>
      )
    case 'video':
      return (
        <video
          src={state.url}
          controls
          preload="metadata"
          onError={onUndecodable}
          data-previewer-media
          {...(card ? { controlsList: 'nodownload nofullscreen noremoteplayback', disablePictureInPicture: true } : {})}
          className="max-h-full max-w-full"
        />
      )
    case 'audio':
      return (
        <audio
          src={state.url}
          controls
          preload="metadata"
          onError={onUndecodable}
          data-previewer-media
          {...(card ? { controlsList: 'nodownload' } : {})}
          className="w-full max-w-md"
        />
      )
    case 'markdown':
      return (
        <div className={cn('h-full w-full overflow-auto py-4', card ? 'px-6 text-sm' : 'px-8')}>
          <div className={inert}>
            <CopyableMarkdown text={state.content ?? ''} isStreaming={false} projectPath={projectPath ?? undefined} />
          </div>
        </div>
      )
    case 'notebook':
      return (
        <div className="h-full w-full overflow-auto">
          <div className={inert}>
            <NotebookPreview content={state.content ?? ''} />
          </div>
        </div>
      )
    case 'text':
      return (
        <div className={cn('h-full w-full', inert)}>
          <FileWithDiffView filePath={file.absolutePath} content={state.content ?? ''} diff="" />
        </div>
      )
    default:
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <FileIcon name={file.name} size={24} />
          <span className="font-mono text-xs">{file.name}</span>
        </div>
      )
  }
}
