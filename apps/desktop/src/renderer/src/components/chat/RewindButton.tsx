import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { Trans, useTranslation } from 'react-i18next'
import { History, TriangleAlert } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore } from '@/stores/chat'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@superone/ui/components/ui/tooltip'
import type { RewindFilesResult } from '@superone/shared/agent-types'
import { isFocusInChat } from './is-focus-in-chat'

type RewindMode = 'code' | 'conversation' | 'code_and_chat'

interface RewindButtonProps {
  checkpointId: string
  rewound?: RewindMode
  className?: string
}


interface RewindOption {
  key: RewindMode | 'cancel'
  labelKey: 'codeAndChat' | 'conversation' | 'code' | 'cancel'
}

const codeOptions: RewindOption[] = [
  { key: 'code_and_chat', labelKey: 'codeAndChat' },
  { key: 'conversation', labelKey: 'conversation' },
  { key: 'code', labelKey: 'code' },
  { key: 'cancel', labelKey: 'cancel' },
]

const chatOnlyOptions: RewindOption[] = [
  { key: 'conversation', labelKey: 'conversation' },
  { key: 'cancel', labelKey: 'cancel' },
]

const codeAndChatOptions: RewindOption[] = [
  { key: 'code_and_chat', labelKey: 'codeAndChat' },
  { key: 'conversation', labelKey: 'conversation' },
  { key: 'cancel', labelKey: 'cancel' },
]

export function RewindButton({ checkpointId, rewound, className }: RewindButtonProps) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<RewindFilesResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [rewindingMode, setRewindingMode] = useState<RewindMode | null>(null)

  const previewRewind = useChatStore((s) => s.previewRewind)
  const rewindFiles = useChatStore((s) => s.rewindFiles)
  const rewindCodeAndChat = useChatStore((s) => s.rewindCodeAndChat)
  const rewindConversation = useChatStore((s) => s.rewindConversation)

  const fetchPreview = useCallback(async () => {
    if (loading) return
    setPreview(null)
    setLoading(true)
    try {
      const result = await previewRewind(checkpointId)
      setPreview(result)
    } catch {
      setPreview({ canRewind: false, error: t('chat.rewind.previewFailed') })
    }
    setLoading(false)
  }, [loading, previewRewind, checkpointId])

  const codeAlreadyRestored = rewound === 'code'

  const handleClick = () => {
    setDialogOpen(true)
    if (!codeAlreadyRestored) fetchPreview()
  }

  const handleRewind = async (mode: RewindMode) => {
    setRewindingMode(mode)
    try {
      if (mode === 'code_and_chat') {
        await rewindCodeAndChat(checkpointId)
        toast.success(t('chat.rewind.toast.codeAndChat'))
      } else if (mode === 'conversation') {
        await rewindConversation(checkpointId)
        toast.success(t('chat.rewind.toast.conversation'))
      } else {
        await rewindFiles(checkpointId)
        toast.success(t('chat.rewind.toast.code'))
      }
      setRewindingMode(null)
      setDialogOpen(false)
    } catch (e) {
      setRewindingMode(null)
      setDialogOpen(false)
      throw e
    }
  }

  const handleSelect = useCallback((opt: RewindOption) => {
    if (rewindingMode) return
    if (opt.key === 'cancel') {
      setDialogOpen(false)
    } else {
      handleRewind(opt.key)
    }
  }, [rewindingMode, checkpointId])

  const fileCount = preview?.filesChanged?.length ?? 0
  const ins = preview?.insertions ?? 0
  const del = preview?.deletions ?? 0
  const hasCodeChanges = fileCount > 0
  const options = codeAlreadyRestored
    ? chatOnlyOptions
    : hasCodeChanges
      ? preview?.supportsCodeOnly === false ? codeAndChatOptions : codeOptions
      : chatOnlyOptions

  useEffect(() => {
    if (!dialogOpen || !preview?.canRewind) return
    const handler = (e: KeyboardEvent) => {
      if (!isFocusInChat()) return
      const num = parseInt(e.key)
      if (num >= 1 && num <= options.length) {
        e.preventDefault()
        handleSelect(options[num - 1])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dialogOpen, preview?.canRewind, options, handleSelect])

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleClick}
              className={cn(
                'cursor-pointer rounded p-0.5 transition-opacity text-muted-foreground hover:text-foreground',
                className,
              )}
            >
              <History className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span>{t('tooltips.rewind')}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="gap-4 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><History className="size-4" /> {t('chat.rewind.title')}</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            {t('chat.rewind.confirmDescription')}
          </p>

          {!rewound && !preview && loading && (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          )}

          {!rewound && preview && !preview.canRewind && (
            <p className="text-sm text-destructive">
              {preview.error ?? t('chat.rewind.cannotRestore')}
            </p>
          )}

          {(codeAlreadyRestored || preview?.canRewind) && (
            <>
              {!rewound && hasCodeChanges && (
                <p className="text-sm text-muted-foreground">
                  <Trans
                    i18nKey="chat.rewind.changes"
                    values={{ ins, del, file: preview!.filesChanged![0].split('/').pop() }}
                    components={{
                      green: <span className="text-green-500" />,
                      red: <span className="text-red-500" />,
                      file: <span className="text-foreground" />,
                    }}
                  />
                  {fileCount > 1 && t('chat.rewind.andOtherFiles', { count: fileCount - 1 })}
                </p>
              )}

              {codeAlreadyRestored && (
                <p className="text-sm text-green-500">{t('chat.rewind.codeAlreadyRestored')}</p>
              )}

              <div className="space-y-0.5">
                {options.map((opt, i) => (
                  <button
                    key={opt.key}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    onClick={() => handleSelect(opt)}
                    disabled={!!rewindingMode && opt.key !== 'cancel'}
                  >
                    <span className={rewindingMode === opt.key ? 'text-muted-foreground' : ''}>
                      {rewindingMode === opt.key ? t('chat.rewind.restoring') : t(`chat.rewind.options.${opt.labelKey}`)}
                    </span>
                    <CommandShortcut>{i + 1}</CommandShortcut>
                  </button>
                ))}
              </div>

              {!rewound && hasCodeChanges && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <TriangleAlert className="size-3 shrink-0" />
                  {t('chat.rewind.noEffectNote')}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
