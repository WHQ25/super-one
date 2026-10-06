import { useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, Bot, Clapperboard, ImagePlus, Loader2, Sparkles, Square } from 'lucide-react'
import type { MediaComposerKind } from '@superone/shared/media-composer'
import { AutoResizeTextarea } from '@superone/ui/components/ui/auto-resize-textarea'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { ComposerModeChip } from '../ComposerModeChip'
import { MediaOptionSelector } from './MediaOptionSelector'
import { OverflowControls, type ToolbarControl } from './OverflowControls'

export type MediaRunMode = 'direct' | 'agent'

/** The most common controls stay on the toolbar; the rest live in More Settings. */
const MAX_TOOLBAR_CONTROLS = 4
const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

/**
 * The media generation composer, laid out like the chat composer: optional rows
 * above the prompt, a toolbar with the mode chip and selectors, and a status row
 * under the box. Files dropped or pasted anywhere on the box go to `onFiles`.
 */
export function MediaComposerFrame({
  kind, prompt, onPromptChange, onSubmit, promptDisabled, controlsDisabled, onExit, above, references, controls, actions, status, onFiles,
}: {
  kind: MediaComposerKind
  prompt: string
  onPromptChange: (prompt: string) => void
  onSubmit: () => void
  promptDisabled?: boolean
  controlsDisabled?: boolean
  /** Leaves the mode; without it the chip is a plain label. */
  onExit?: () => void
  above?: ReactNode
  references?: ReactNode
  /** Toolbar controls in priority order; past the fourth, or when out of room, they move to the settings panel. */
  controls: ToolbarControl[]
  actions: ReactNode
  status?: ReactNode
  onFiles?: (files: File[]) => void
}) {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState(false)
  const acceptsFiles = !!onFiles && !controlsDisabled
  const dropTarget = acceptsFiles ? {
    onDragOver: (event: DragEvent) => { if (!hasFiles(event)) return; event.preventDefault(); setDragging(true) },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) },
    onDrop: (event: DragEvent) => { if (!hasFiles(event)) return; event.preventDefault(); setDragging(false); onFiles(Array.from(event.dataTransfer.files)) },
  } : {}
  const paste = (event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData.files)
    if (!acceptsFiles || !files.length) return
    event.preventDefault()
    onFiles(files)
  }
  return (
    <div className="@container" data-media-composer={kind}>
      <div className={cn('relative mx-3 mb-1 rounded-xl border border-border px-3 py-2', dragging && 'ring-2 ring-inset ring-primary/50')} {...dropTarget}>
        {above}
        <div inert={controlsDisabled} className={cn(controlsDisabled && 'opacity-60')}>{references}</div>
        <AutoResizeTextarea
          aria-label={t('mediaComposer.prompt')}
          value={prompt}
          onValueChange={onPromptChange}
          onSubmit={onSubmit}
          onPaste={paste}
          disabled={promptDisabled}
          maxRows={5}
          maxLength={32_000}
          placeholder={t(kind === 'image' ? 'mediaComposer.imagePlaceholder' : 'mediaComposer.videoPlaceholder')}
          className="min-h-9 rounded-none border-0 bg-transparent px-0 py-1.5 text-sm leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="mt-1.5 flex items-center gap-1">
          <ComposerModeChip
            icon={kind === 'image' ? ImagePlus : Clapperboard}
            label={t(kind === 'image' ? 'mediaComposer.imageMode' : 'mediaComposer.videoMode')}
            title={onExit && t(kind === 'image' ? 'mediaComposer.exitImage' : 'mediaComposer.exitVideo')}
            onExit={onExit}
            className={cn('text-primary', onExit && 'hover:bg-primary/10')}
          />
          <OverflowControls controls={controls} max={MAX_TOOLBAR_CONTROLS} moreLabel={t('mediaComposer.moreSettings')} disabled={controlsDisabled} />
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        </div>
      </div>
      {/* Collapses when there is nothing to report, leaving the box the same bottom gap as the other composers. */}
      {status && <div className="flex min-h-5 items-center gap-2 overflow-hidden whitespace-nowrap px-3 pb-0.5 text-xs text-muted-foreground empty:hidden @lg:px-7">{status}</div>}
    </div>
  )
}

/** Primary action: generate here, or hand the request to the agent. */
export function MediaGenerateButton({ mode = 'direct', disabled, busy, label, onClick }: {
  mode?: MediaRunMode; disabled?: boolean; busy?: boolean; label?: string; onClick: () => void
}) {
  const { t } = useTranslation()
  const Icon = busy ? Loader2 : mode === 'agent' ? ArrowUp : Sparkles
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border pl-1.5 pr-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      <Icon className={cn('size-3.5 shrink-0', busy && 'animate-spin')} />
      {label ?? t(mode === 'agent' ? 'mediaComposer.sendToAgent' : 'mediaComposer.generate')}
    </button>
  )
}

export function MediaStopButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <IconButton variant="ghost" tooltip={label} disabled={disabled} onClick={onClick} className="size-6 rounded-full border border-border disabled:opacity-30">
      <Square className="size-3 rounded-[2px]" />
    </IconButton>
  )
}

/** Whether a user-started request runs here or goes to the agent as a chat message. */
export function MediaRunModeSelector({ value, onChange }: { value: MediaRunMode; onChange: (mode: MediaRunMode) => void }) {
  const { t } = useTranslation()
  const leading = (Icon: typeof Bot) => <Icon className="mt-0.5 size-3.5 shrink-0 self-start text-muted-foreground" />
  return (
    <MediaOptionSelector
      title={t('mediaComposer.runMode')}
      label={t(value === 'agent' ? 'mediaComposer.runAgent' : 'mediaComposer.runDirect')}
      value={value}
      onChange={mode => onChange(mode as MediaRunMode)}
      groups={[{ label: t('mediaComposer.runMode'), options: [
        { value: 'direct', label: t('mediaComposer.runDirect'), description: t('mediaComposer.runDirectHint'), leading: leading(Sparkles) },
        { value: 'agent', label: t('mediaComposer.runAgent'), description: t('mediaComposer.runAgentHint'), leading: leading(Bot) },
      ] }]}
    />
  )
}
