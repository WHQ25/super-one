import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { SessionChip, SessionLinkContext } from './SessionChip'
import { createSessionLinkCache } from './session-link-cache'

function Preview({ harness = 'codex', unavailable = false, delay = 0, fail = false, width = 390, label = 'Investigate session links' }) {
  const [error, setError] = useState('')
  const ports = useMemo(() => ({
    cache: createSessionLinkCache(async refs => {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      return refs.map(ref => unavailable ? { status: 'unavailable' as const, ref } : { status: 'ok' as const, metadata: { ref, harness, acpAgentId: harness === 'acp' ? 'grok-build' : null, environmentLabel: 'My desktop' } })
    }),
    open: async () => { await new Promise(resolve => setTimeout(resolve, 800)); if (fail) throw new Error('Host is offline'); setError('Session opened') },
    onError: (reason: unknown) => setError(String(reason)),
  }), [harness, unavailable, delay, fail])
  return <SessionLinkContext.Provider value={{ sourceEnvironmentId: 'source-host', ports }}><div style={{ width, maxWidth: '100%' }} className="text-sm">Continue in <SessionChip href="session://localhost/example-session" label={label} /> to see the investigation.{error && <p role="status">{error}</p>}</div></SessionLinkContext.Provider>
}
const meta = { title: 'Chat/SuperOne/Session chip', component: Preview, parameters: { layout: 'padded' } } satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>
export const Normal: Story = {}
export const Loading: Story = { args: { delay: 6000 } }
export const AcpBrand: Story = { args: { harness: 'acp' } }
export const LongTitle: Story = { args: { width: 200, label: '调研跨宿主会话跳转、移动端草稿保护与远程节点身份校验的完整实现细节' } }
export const Offline: Story = { args: { unavailable: true, fail: true } }
export const FailedOpening: Story = { args: { fail: true } }
export const Gallery: Story = { render: () => <div className="space-y-5" style={{ width: 390, maxWidth: '100%' }}>
  <Preview label="SessionChip implementation" />
  <Preview harness="acp" label="Grok design review" />
  <Preview width={200} label="调研跨宿主会话跳转、移动端草稿保护与远程节点身份校验的完整实现细节" />
  <Preview unavailable fail label="Offline session" />
</div> }
