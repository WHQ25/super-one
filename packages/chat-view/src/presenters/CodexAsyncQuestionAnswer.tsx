import { useTranslation } from 'react-i18next'
import type { CodexAsyncUserInputQuestion } from '@superone/shared/agent-types'
import { CODEX_ASYNC_QUESTION_DISMISSED, parseCodexAsyncQuestionReply } from '@superone/shared/codex-async-question'
import { UserTextPresenter } from './UserText'

/** Q&A content inside an ordinary user bubble, independent of the source turn. */
export function CodexAsyncQuestionAnswer({ questions, reply }: { questions: CodexAsyncUserInputQuestion[]; reply: string }) {
  const { t } = useTranslation()
  const answers = parseCodexAsyncQuestionReply(questions, reply)
  const pairs = answers
    ? questions.map((q, index) => ({ question: q.title, answer: answers[index] }))
    : [{ question: questions.map(q => q.title).join('\n\n'), answer: reply }]
  return (
    <dl className="flex min-w-0 flex-col gap-3 break-normal" data-codex-async-answer="">
      {pairs.map((pair, index) => (
        <div key={index} className="flex min-w-0 flex-col gap-2">
          <dt>
            <blockquote className="border-l-2 border-muted-foreground/30 pl-3 whitespace-pre-wrap leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{pair.question}</blockquote>
          </dt>
          <dd className="whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
            <UserTextPresenter text={pair.answer === CODEX_ASYNC_QUESTION_DISMISSED ? t('chat.toolBlock.dismissed') : pair.answer} isPaste={false} />
          </dd>
        </div>
      ))}
    </dl>
  )
}
