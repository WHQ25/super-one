import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ChatMessagePresenter } from './ChatMessage'
import { SendFailureResendButton } from './SendFailureResendButton'

/** Local interaction only: Resend never reaches a host. */
function FailedUserMessage({ text, error }: { text: string; error: string }) {
  const [failed, setFailed] = useState(true)
  return (
    <ChatMessagePresenter
      isUser
      isCollaboration={false}
      body={<p className="whitespace-pre-wrap">{text}</p>}
      interrupted={false}
      interruptedLabel=""
      sendFailure={failed ? <SendFailureResendButton error={error} onResend={() => setFailed(false)} /> : undefined}
    />
  )
}

const meta = {
  title: 'Chat/Send Failure Resend',
  component: FailedUserMessage,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="flex w-full max-w-2xl flex-col"><Story /></div>],
  args: { text: '进度', error: 'websocket closed' },
  render: (args) => <FailedUserMessage key={JSON.stringify(args)} {...args} />,
} satisfies Meta<typeof FailedUserMessage>

export default meta
type Story = StoryObj<typeof meta>

/** A dropped connection: the tooltip only offers Resend. */
export const RemoteUnavailable: Story = {}

/** A refusal: the tooltip adds the host's reason under Resend. */
export const HostRefused: Story = {
  args: { error: 'Attachment: screenshot.png is larger than 20 MB' },
}

export const LongMessage: Story = {
  args: {
    text: '整个过程约 2～3 分钟。影响是：这段时间 node6 所在的 14 个他人资源组不能把新任务调度到 node6，已有的任务不受影响。执行的话需要执行机浏览器登录平台，我先检查登录状态。',
  },
}

export const Narrow: Story = {
  decorators: [(Story) => <div className="flex w-[280px] flex-col"><Story /></div>],
}
