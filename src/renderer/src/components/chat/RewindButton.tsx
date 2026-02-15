import { useState, useCallback, useEffect } from 'react'
import { Check, History, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/stores/chat'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CommandShortcut } from '@/components/ui/command'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { RewindFilesResult } from '../../../../shared/agent-types'

type RewindMode = 'code' | 'conversation' | 'code_and_chat'

interface RewindButtonProps {
  checkpointId: string
  rewound?: RewindMode
  className?: string
}

const rewoundLabels: Record<RewindMode, string> = {
  code: 'Code restored',
  conversation: 'Conversation restored',
  code_and_chat: 'Code & conversation restored',
}

interface RewindOption {
  key: RewindMode | 'cancel'
  label: string
}

const codeOptions: RewindOption[] = [
  { key: 'code_and_chat', label: 'Restore code and conversation' },
  { key: 'conversation', label: 'Restore conversation' },
  { key: 'code', label: 'Restore code' },
  { key: 'cancel', label: 'Never mind' },
]

const chatOnlyOptions: RewindOption[] = [
  { key: 'conversation', label: 'Restore conversation' },
  { key: 'cancel', label: 'Never mind' },
]

export function RewindButton({ checkpointId, rewound, className }: RewindButtonProps) {
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
      setPreview({ canRewind: false, error: 'Preview failed' })
    } finally {
      setLoading(false)
    }
  }, [loading, previewRewind, checkpointId])

  const handleClick = () => {
    if (rewound) return
    setDialogOpen(true)
    fetchPreview()
  }

  const handleRewind = async (mode: RewindMode) => {
    setRewindingMode(mode)
    try {
      if (mode === 'code_and_chat') {
        await rewindCodeAndChat(checkpointId)
      } else if (mode === 'conversation') {
        await rewindConversation(checkpointId)
      } else {
        await rewindFiles(checkpointId)
      }
    } finally {
      setRewindingMode(null)
      setDialogOpen(false)
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
  const options = hasCodeChanges ? codeOptions : chatOnlyOptions

  useEffect(() => {
    if (!dialogOpen || !preview?.canRewind) return
    const handler = (e: KeyboardEvent) => {
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
                'cursor-pointer rounded p-0.5 transition-opacity',
                rewound
                  ? 'text-green-500'
                  : 'text-muted-foreground hover:text-foreground',
                className,
              )}
            >
              {rewound ? <Check className="size-3" /> : <History className="size-3" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {rewound
              ? <span className="text-green-400">{rewoundLabels[rewound]}</span>
              : <span>Rewind</span>
            }
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="gap-4 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rewind</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Confirm you want to restore to the point before you sent this message.
          </p>

          {!preview && loading && (
            <p className="text-sm text-muted-foreground">Loading...</p>
          )}

          {preview && !preview.canRewind && (
            <p className="text-sm text-destructive">
              {preview.error ?? 'Cannot restore to this checkpoint.'}
            </p>
          )}

          {preview?.canRewind && (
            <>
              <div className="space-y-0.5 text-sm text-muted-foreground">
                <p>The conversation will be forked.</p>
                {hasCodeChanges && (
                  <p>
                    The code will be restored{' '}
                    {ins > 0 && <span className="text-green-500">+{ins}</span>}
                    {ins > 0 && del > 0 && ' '}
                    {del > 0 && <span className="text-red-500">-{del}</span>}
                    {' in '}
                    <span className="text-foreground">{preview.filesChanged![0].split('/').pop()}</span>
                    {fileCount > 1 && ` and ${fileCount - 1} other file${fileCount - 1 !== 1 ? 's' : ''}`}
                    .
                  </p>
                )}
              </div>

              <div className="space-y-0.5">
                {options.map((opt, i) => (
                  <button
                    key={opt.key}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    onClick={() => handleSelect(opt)}
                    disabled={!!rewindingMode && opt.key !== 'cancel'}
                  >
                    <span className={rewindingMode === opt.key ? 'text-muted-foreground' : ''}>
                      {rewindingMode === opt.key ? 'Restoring...' : opt.label}
                    </span>
                    <CommandShortcut>{i + 1}</CommandShortcut>
                  </button>
                ))}
              </div>

              {hasCodeChanges && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <TriangleAlert className="size-3 shrink-0" />
                  Rewinding does not affect files edited manually or via bash.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
