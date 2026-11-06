import type { Meta, StoryObj } from '@storybook/react-vite'
import { codexAsyncQuestionRequest } from '@superone/shared/codex-async-question'
import { AskUserQuestionForm } from './AskUserQuestionForm'

const request = codexAsyncQuestionRequest({
  id: 'long-question-tabs', type: 'agent_message', text: '',
  questions: [
    {
      title: 'Which environments should receive the release after all verification steps have completed?',
      options: ['Staging', 'Production'],
    },
    {
      title: '发布前是否需要同时检查桌面端、手机端以及远程节点上的完整用户流程？',
      options: ['全部检查', '只检查修改过的平台'],
    },
    {
      title: 'Which checks should block the release when a supported platform cannot be verified?',
      options: ['All checks', 'Required checks only'],
    },
  ],
})

const meta = {
  title: 'Chat/Question navigation',
  component: AskUserQuestionForm,
  parameters: { layout: 'padded' },
  args: {
    request,
    keyboard: { inScope: () => true, mac: false },
    onSubmit: (answers) => console.info('Question answers', answers),
    onDismiss: () => console.info('Questions dismissed'),
    renderPreview: ({ content }) => <p>{content}</p>,
  },
  decorators: [(Story) => <div style={{ maxWidth: 720 }}><Story /></div>],
} satisfies Meta<typeof AskUserQuestionForm>

export default meta
type Story = StoryObj<typeof meta>

/** The backend supplies full titles: all three tabs must remain visible. */
export const LongCodexTitles: Story = {}
export const LongCodexTitlesNarrow: Story = {
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
}
export const LongCodexTitlesTouch: Story = {
  args: { keyboard: undefined },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
}
