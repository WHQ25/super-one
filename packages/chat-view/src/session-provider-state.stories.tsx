import { useState } from 'react'
import i18n from 'i18next'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent } from 'storybook/test'
import type { SessionInboxItem } from '@superone/shared/session-inbox'
import { SessionProviderState } from './SessionProviderState'

const items: SessionInboxItem[] = [
  { id: 'queued', text: 'Finish the current command, then review the migration.', delivery: 'queue', createdAt: 1, attachmentCount: 0 },
  { id: 'steered', text: 'Use the attached screenshot to adjust the spacing.', delivery: 'steer', createdAt: 2, attachmentCount: 2 },
]
type Props = React.ComponentProps<typeof SessionProviderState> & { width?: number; failFirst?: boolean; loading?: boolean }
function InteractiveState({ width = 560, failFirst = false, loading = false, ...props }: Props) {
  const [pending, setPending] = useState(props.items), [failed, setFailed] = useState(false)
  const [connection, setConnection] = useState(props.connection)
  return <div style={{ width, maxWidth: '100%' }}><SessionProviderState {...props} items={pending} connection={connection}
    onReconnect={async () => setConnection({ state: 'connected', attempt: 1 })}
    onAction={async (id, action) => {
      if (loading) await new Promise(() => {})
      if (failFirst && !failed) { setFailed(true); throw new Error('The connection changed. Try again.') }
      setPending((current) => action === 'cancel' ? current?.filter((item) => item.id !== id)
        : current?.map((item) => item.id === id ? { ...item, delivery: action } : item))
    }} /></div>
}
const meta = { title: 'Chat/Session provider state', component: InteractiveState, args: { items, onAction: async () => {} } } satisfies Meta<typeof InteractiveState>
export default meta
type Story = StoryObj<typeof meta>
export const Pending: Story = { play: async ({ canvas }) => {
  await userEvent.click(canvas.getByRole('button', { name: i18n.t('chat.nativeInbox.toSteer') }))
  await expect(canvas.getAllByRole('button', { name: i18n.t('chat.nativeInbox.toQueue') })).toHaveLength(2)
  await userEvent.click(canvas.getAllByRole('button', { name: i18n.t('chat.nativeInbox.cancel') })[0])
  await expect(canvas.queryByText(items[0].text)).toBeNull()
} }
export const Empty: Story = { args: { items: [] } }
export const Recovering: Story = { args: { connection: { state: 'recovering', attempt: 3 } } }
export const Disconnected: Story = { args: { connection: { state: 'disconnected', attempt: 5 } }, play: async ({ canvas }) => {
  await userEvent.click(canvas.getByRole('button', { name: i18n.t('common.retry') }))
  await expect(canvas.queryByRole('alert')).toBeNull()
} }
export const ReadOnly: Story = { args: { disabled: true } }
export const Saving: Story = { args: { loading: true }, play: async ({ canvas }) => {
  await userEvent.click(canvas.getAllByRole('button', { name: i18n.t('chat.nativeInbox.cancel') })[0])
  await expect(canvas.getAllByRole('button', { name: i18n.t('chat.nativeInbox.cancel') })[1]).toBeDisabled()
} }
export const ErrorRetry: Story = { args: { failFirst: true }, play: async ({ canvas }) => {
  const button = canvas.getAllByRole('button', { name: i18n.t('chat.nativeInbox.cancel') })[0]
  await userEvent.click(button)
  await expect(canvas.getByRole('alert')).toHaveTextContent('Try again')
  await userEvent.click(button)
  await expect(canvas.queryByRole('alert')).toBeNull()
} }
export const LongNarrow: Story = { args: { width: 320, items: [{ ...items[0], text: 'Review the connection recovery and pending input controls on a narrow screen. '.repeat(6) }, items[1]] } }
