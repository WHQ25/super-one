import type { Meta, StoryObj } from '@storybook/react-vite'
import { SystemNoticeRow } from './SystemNoticeRow'

const meta: Meta<typeof SystemNoticeRow> = {
  title: 'Chat/SystemNotice', component: SystemNoticeRow, parameters: { layout: 'padded' },
  args: { meta: { source: 'Claude Code', level: 'warning' }, text: 'A hook callback failed. The requested action was blocked.' },
}
export default meta
type Story = StoryObj<typeof meta>

export const HookWarning: Story = {}
export const Levels: Story = {
  render: () => <div className="max-w-xl space-y-4">{(['info', 'notice', 'suggestion', 'warning'] as const).map(level =>
    <SystemNoticeRow key={level} meta={{ source: 'Claude Code', level }} text={`${level}: <b>provider text</b> is shown literally.`} />,
  )}</div>,
}
export const StorageFailure: Story = {
  args: {
    meta: { source: 'Claude Code', kind: 'storage', level: 'warning', code: 'EDQUOT', details: { lost: ['transcript', 'global_config'], transcriptSessionIds: ['previous-session', 'current-session'] } },
    text: 'Could not save session transcripts and configuration because the disk quota is exhausted. Resuming affected sessions may omit part of the conversation.',
  },
}
export const NarrowDark: Story = {
  ...StorageFailure, decorators: [Story => <div className="dark w-70 bg-background p-3 text-foreground"><Story /></div>],
}
export const LongChinese: Story = {
  args: { meta: { source: 'Claude Code', level: 'warning' }, text: '权限钩子执行失败，已阻止本次操作。请检查钩子的配置和输出后重试。'.repeat(8) },
  decorators: [Story => <div className="w-70"><Story /></div>],
}
