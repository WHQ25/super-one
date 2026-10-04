import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { AskUserQuestionRequest } from '@superone/shared/agent-types'
import { AskUserQuestionForm } from './presenters/AskUserQuestionForm'
import { ModCommandOutputSite, ModQuestionSite } from './mod-ui'
import { PortableQuestionPreview } from './PortableToolRow'
import { requestNativeAsync } from './bridge'

/**
 * The phone's pending question, drawn where the desktop draws it: above the
 * composer. The answer goes to the native runtime, which clears the question.
 */
export function PortableQuestion({ request, scheme }: { request: AskUserQuestionRequest; scheme: 'light' | 'dark' }) {
  const { requestId } = request
  return (
    <div className="px-3 pt-2">
      <ModQuestionSite request={request}>
        <AskUserQuestionForm
          key={requestId}
          request={request}
          onSubmit={(answers, annotations) => void requestNativeAsync('answerQuestion', { requestId, answers, annotations }).catch(() => {})}
          onDismiss={() => void requestNativeAsync('dismissQuestion', { requestId }).catch(() => {})}
          renderPreview={(props) => <PortableQuestionPreview {...props} scheme={scheme} />}
        />
      </ModQuestionSite>
    </div>
  )
}

/**
 * Output from a command whose result is not a chat message, open as the
 * desktop's popup is until closed.
 */
export function PortableCommandOutput({ output }: { output: { command: string; content: string } }) {
  const { t } = useTranslation()
  const { command, content } = output
  return (
    <div className="px-3 pt-2">
      <section className="rounded-xl border border-border bg-card text-sm" data-command-output={command}>
        <header className="flex items-center gap-1 py-1 pl-3 pr-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">/{command}</span>
          <button type="button" aria-label={t('common.close')} className="rounded p-1 text-muted-foreground"
            onClick={() => void requestNativeAsync('dismissSlashOutput').catch(() => {})}>
            <X className="size-3.5" />
          </button>
        </header>
        <div className="max-h-64 overflow-y-auto border-t border-border px-3 py-2">
          <ModCommandOutputSite command={command} content={content}>
            {/* Command stdout is preformatted; wrapping would destroy the only structure it has. */}
            {(text) => <pre className="select-text overflow-x-auto font-mono text-xs leading-[18px] text-foreground">{text}</pre>}
          </ModCommandOutputSite>
        </div>
      </section>
    </div>
  )
}
