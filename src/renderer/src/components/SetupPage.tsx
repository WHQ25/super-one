import { useEffect, useRef, useMemo } from 'react'
import { Download, CheckCircle, XCircle, ArrowRight, Loader2, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app'
import { useShallow } from 'zustand/react/shallow'
import type { SetupEvent } from '../../../shared/agent-types'
import { parseAnsiToTailwind } from '@/lib/ansi'

function TerminalOutput({ text }: { text: string }): React.JSX.Element {
  const lines = useMemo(() => text.split('\n'), [text])

  return (
    <>
      {lines.map((line, i) => (
        <div key={i}>
          {line ? (
            parseAnsiToTailwind(line).map((span, j) => (
              <span key={j} className={span.className}>{span.text}</span>
            ))
          ) : (
            '\u00A0'
          )}
        </div>
      ))}
    </>
  )
}

export function SetupPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { installStatus, installOutput, startInstall, handleSetupEvent, continueToMain } = useAppStore(useShallow((s) => ({ installStatus: s.installStatus, installOutput: s.installOutput, startInstall: s.startInstall, handleSetupEvent: s.handleSetupEvent, continueToMain: s.continueToMain })))
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const cleanup = window.app.onSetupEvent((event: SetupEvent) => {
      handleSetupEvent(event)
    })
    return cleanup
  }, [handleSetupEvent])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [installOutput])

  const isInstalling = installStatus === 'installing'

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
      <div className="text-center">
        {installStatus === 'idle' && (
          <>
            <h1 className="text-2xl font-bold">{t('shell.setup.required.title')}</h1>
            <p className="mt-2 text-muted-foreground">
              {t('shell.setup.required.description')}
            </p>
          </>
        )}
        {isInstalling && (
          <>
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="size-5 animate-spin text-primary" />
              <h1 className="text-2xl font-bold">{t('shell.setup.installing.title')}</h1>
            </div>
            <p className="mt-2 text-muted-foreground">
              {t('shell.setup.installing.description')}
            </p>
          </>
        )}
        {installStatus === 'success' && (
          <>
            <div className="flex items-center justify-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle className="size-5" />
              <h1 className="text-2xl font-bold">{t('shell.setup.success.title')}</h1>
            </div>
            <p className="mt-2 text-muted-foreground">{t('shell.setup.success.description')}</p>
          </>
        )}
        {installStatus === 'error' && (
          <>
            <div className="flex items-center justify-center gap-2 text-red-600 dark:text-red-400">
              <XCircle className="size-5" />
              <h1 className="text-2xl font-bold">{t('shell.setup.error.title')}</h1>
            </div>
            <p className="mt-2 text-muted-foreground">
              {t('shell.setup.error.description')}
            </p>
          </>
        )}
      </div>

      {installStatus === 'idle' && (
        <Button size="lg" onClick={startInstall}>
          <Download className="size-5" />
          {t('shell.setup.install')}
        </Button>
      )}
      {installStatus === 'success' && (
        <Button size="lg" onClick={continueToMain}>
          {t('common.continue')}
          <ArrowRight className="size-5" />
        </Button>
      )}
      {installStatus === 'error' && (
        <Button size="lg" variant="outline" onClick={startInstall}>
          {t('common.retry')}
        </Button>
      )}

      {(isInstalling || installOutput) && (
        <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-lg dark:border-zinc-600">
          <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-4 py-2">
            <div className="flex gap-1.5">
              <span className="size-3 rounded-full bg-red-500" />
              <span className="size-3 rounded-full bg-yellow-500" />
              <span className="size-3 rounded-full bg-green-500" />
            </div>
            <div className="flex flex-1 items-center justify-center gap-1.5 text-xs text-zinc-400">
              <Terminal className="size-3" />
              <span>{t('common.terminal')}</span>
            </div>
            <div className="w-[42px]" />
          </div>
          <div
            ref={outputRef}
            className="overflow-auto p-4 font-mono text-xs leading-relaxed"
            style={{ maxHeight: '280px' }}
          >
            <TerminalOutput text={installOutput} />
            {isInstalling && (
              <span className="inline-block h-4 w-1.5 animate-pulse bg-zinc-400" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
