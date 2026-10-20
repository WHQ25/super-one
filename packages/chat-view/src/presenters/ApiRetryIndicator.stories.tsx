import type { Meta, StoryObj } from '@storybook/react-vite'
import { ApiRetryIndicator } from './ChatMessageIndicators'
import { initializeChatViewI18n } from '../i18n'

void initializeChatViewI18n('en')

const dump = 'API error (status 500 Internal Server Error): {"error":"upstream exploded","request_id":"req_123","model":"grok-4"}'

const meta = {
  title: 'Chat/API Retry',
  component: ApiRetryIndicator,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-80"><Story /></div>],
} satisfies Meta<typeof ApiRetryIndicator>

export default meta
type Story = StoryObj<typeof meta>

/** Grok's retry reason is an API dump. The banner keeps the attempt count. */
export const Retrying: Story = {
  args: {
    info: { attempt: 2, maxRetries: 5, delayMs: 0, phase: 'retrying', message: dump },
  },
}

/** A short clause from other harnesses stays on the line. */
export const ShortReason: Story = {
  args: {
    info: { attempt: 1, maxRetries: 3, delayMs: 4_000, phase: 'retrying', message: 'rate limited' },
  },
}

export const Exhausted: Story = {
  args: {
    info: { attempt: 5, delayMs: 0, phase: 'exhausted', message: dump },
  },
}

export const Failed: Story = {
  args: {
    info: { attempt: 0, delayMs: 0, phase: 'failed', message: 'timeout' },
    onRetry: () => {},
  },
}
