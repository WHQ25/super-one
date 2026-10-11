import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CodexAsyncUserInputQuestion } from '@superone/shared/agent-types'
import { CODEX_ASYNC_QUESTION_DISMISSED, formatCodexAsyncQuestionReply } from '@superone/shared/codex-async-question'
import { PortableMessage } from '../PortableMessage'

function AnswerBubble({ questions, answers, width = 720 }: { questions: CodexAsyncUserInputQuestion[]; answers: string[]; width?: number }) {
  return <div className="bg-background p-4" style={{ width, maxWidth: '100%' }}>
    <PortableMessage scheme="dark" pendingPermission={null} message={{
      id: 'codex_async_answer:question', role: 'user', providerId: 'codex', status: 'complete', createdAt: '',
      content: [{ type: 'text', text: formatCodexAsyncQuestionReply(questions, answers), codexAsyncQuestions: questions }],
    }} />
  </div>
}
const meta = {
  title: 'Chat/Codex Async Question/Answer Bubble', component: AnswerBubble,
  args: { questions: [{ title: 'Which environment should receive the update?', options: ['Staging', 'Production'] }], answers: ['Staging'] },
} satisfies Meta<typeof AnswerBubble>
export default meta
type Story = StoryObj<typeof meta>
export const SingleQuestion: Story = {}
export const LongQuestion: Story = { args: {
  width: 320,
  questions: [{ title: 'Which environment should receive the update, and should this include the desktop app, the mobile app, or both?\nPlease also confirm whether the existing deployment schedule and all previously selected validation steps should remain in place.', options: null }],
  answers: ['Both apps. Keep the existing deployment schedule and validation steps.'],
} }
export const MultipleQuestions: Story = { args: {
  questions: [{ title: 'Which environment?', options: ['Staging', 'Production'] }, { title: 'When should it ship?', options: null }],
  answers: ['Production', 'Friday afternoon.\n\nRun the focused checks first.'],
} }
export const ChineseNarrow: Story = { args: {
  width: 320, questions: [{ title: '这次应该覆盖哪些端？', options: ['桌面和手机', '仅桌面'] }, { title: '还有什么需要注意？', options: null }],
  answers: ['桌面和手机', '回答后保留完整问题与答案。\n测试长链接：https://example.com/very/long/path/that/should/wrap/inside/the/user/bubble'],
}, globals: { locale: 'zh', theme: 'dark' } }
export const Dismissed: Story = { args: { answers: [CODEX_ASYNC_QUESTION_DISMISSED] } }
