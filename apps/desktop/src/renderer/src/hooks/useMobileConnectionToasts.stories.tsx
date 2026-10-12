import type { Meta, StoryObj } from '@storybook/react'
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '@superone/ui/components/ui/button'
import type { RemoteDeviceStatus } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useMobileConnectionToasts } from './useMobileConnectionToasts'

const listeners = new Set<(status: RemoteDeviceStatus) => void>()
mockIpc('app', 'onDeviceStatusChanged', (callback) => {
  const listener = callback as (status: RemoteDeviceStatus) => void
  listeners.add(listener)
  return () => listeners.delete(listener)
})

function ConnectionPreview({ name = 'Phone', narrow = false }: { name?: string; narrow?: boolean }) {
  useMobileConnectionToasts()
  const { t } = useTranslation()
  const connect = () => {
    for (const listener of listeners) {
      listener({ id: 'preview-phone', name, online: false })
      listener({ id: 'preview-phone', name, online: true, firstConnect: true })
    }
  }
  useEffect(connect, [name])
  return <div style={{ width: narrow ? 320 : 620, maxWidth: '100%' }}>
    <Button onClick={connect}>{t('chat.remoteController.reconnect')}</Button>
    <Toaster position="bottom-center" />
  </div>
}

const meta = {
  title: 'Notifications/MobileConnection',
  component: ConnectionPreview,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ConnectionPreview>
export default meta
type Story = StoryObj<typeof meta>

export const Connected: Story = {}
export const Dark: Story = { globals: { theme: 'dark' } }
export const Chinese: Story = { globals: { locale: 'zh' } }
export const LongNameNarrow: Story = {
  args: { name: 'Hangqi’s phone with a very long device name', narrow: true },
}
export const ReconnectAndExpire: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const notice = /Phone (connected|已连接)/
    await canvas.findByText(notice)
    await userEvent.click(canvas.getByRole('button', { name: i18n.t('chat.remoteController.reconnect') }))
    expect(canvas.getAllByText(notice)).toHaveLength(1)
    await waitFor(() => expect(canvas.queryByText(notice)).toBeNull(), { timeout: 5000 })
  },
}
