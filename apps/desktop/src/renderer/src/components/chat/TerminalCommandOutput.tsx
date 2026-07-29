import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'

const COMMAND_CLAMP = 'line-clamp-3'
const OUTPUT_MAX_HEIGHT = 'max-h-72'

interface TerminalCommandOutputProps {
  command: string
  hasOutput: boolean
  children: ReactNode
  outputPrefix?: ReactNode
  outputRef?: RefObject<HTMLDivElement | null>
  outputVersion?: unknown
  outputFull?: boolean
  onOutputFullChange?: (outputFull: boolean) => void
}

export function TerminalCommandOutput({
  command,
  hasOutput,
  children,
  outputPrefix,
  outputRef,
  outputVersion,
  outputFull: controlledOutputFull,
  onOutputFullChange,
}: TerminalCommandOutputProps) {
  const { t } = useTranslation()
  const commandRef = useRef<HTMLDivElement>(null)
  const internalOutputRef = useRef<HTMLDivElement>(null)
  const resolvedOutputRef = outputRef ?? internalOutputRef
  const [commandExpanded, setCommandExpanded] = useState(false)
  const [commandClippable, setCommandClippable] = useState(false)
  const [internalOutputFull, setInternalOutputFull] = useState(false)
  const [outputOverflows, setOutputOverflows] = useState(false)
  const outputFull = controlledOutputFull ?? internalOutputFull

  const setOutputFull = (next: boolean): void => {
    if (controlledOutputFull === undefined) setInternalOutputFull(next)
    onOutputFullChange?.(next)
  }

  useLayoutEffect(() => {
    if (!command) {
      setCommandClippable(false)
      return
    }
    const el = commandRef.current
    if (!el) return
    if (commandExpanded) {
      setCommandClippable(command.includes('\n') || command.length > 80 || el.scrollHeight > el.clientHeight + 1)
      return
    }
    setCommandClippable(el.scrollHeight > el.clientHeight + 1)
  }, [command, commandExpanded])

  useLayoutEffect(() => {
    if (outputFull || !hasOutput) {
      if (!hasOutput) setOutputOverflows(false)
      return
    }
    const el = resolvedOutputRef.current
    if (!el) return
    setOutputOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [hasOutput, outputFull, outputVersion, resolvedOutputRef])

  const commandExpandable = commandClippable || commandExpanded
  const outputExpandable = (outputOverflows || outputFull) && hasOutput

  return (
    <div
      className="bg-terminal-bg font-mono text-xs leading-relaxed"
      onClick={(event) => event.stopPropagation()}
    >
      {command && (
        <div className="px-3 pt-2">
          <div
            ref={commandRef}
            role={commandExpandable ? 'button' : undefined}
            tabIndex={commandExpandable ? 0 : undefined}
            title={commandExpandable
              ? (commandExpanded ? t('chat.toolBlock.collapseCommand') : t('chat.toolBlock.showFullCommand'))
              : undefined}
            className={cn(
              'text-terminal-fg whitespace-pre-wrap break-all',
              !commandExpanded && COMMAND_CLAMP,
              commandExpandable && 'cursor-pointer',
            )}
            onClick={() => {
              if (commandExpandable) setCommandExpanded((value) => !value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                if (commandExpandable) setCommandExpanded((value) => !value)
              }
            }}
          >
            <span className="text-terminal-prompt">$ </span>{command}
          </div>
        </div>
      )}
      <div
        ref={resolvedOutputRef}
        role={outputExpandable ? 'button' : undefined}
        tabIndex={outputExpandable ? 0 : undefined}
        title={outputExpandable
          ? (outputFull ? t('chat.toolBlock.collapseOutput') : t('chat.toolBlock.showFullOutput'))
          : undefined}
        className={cn(
          'overflow-x-auto px-3 py-1.5 whitespace-pre-wrap',
          outputFull ? 'overflow-y-visible' : cn(OUTPUT_MAX_HEIGHT, 'overflow-y-auto'),
          outputExpandable && 'cursor-pointer',
        )}
        onClick={() => {
          if (outputExpandable) setOutputFull(!outputFull)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (outputExpandable) setOutputFull(!outputFull)
          }
        }}
      >
        {outputPrefix}
        {children}
      </div>
    </div>
  )
}
