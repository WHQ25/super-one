import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { installHostBridge } from './bridge'
import { PortableHostImage } from './PortableHostImage'
import { PortableNativeGallery } from './PortableNativeGallery'

type HostMode = 'lan' | 'relay' | 'unavailable' | 'slow'

interface MockHostWindow extends Window {
  ReactNativeWebView?: { postMessage(message: string): void }
  __applyHost?: (message: unknown) => void
}

/** A 96×64 PNG drawn on the fly so the story needs no fixture file. */
function samplePng(seed: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  let hue = 0
  for (const ch of seed) hue = (hue * 31 + ch.charCodeAt(0)) % 360
  ctx.fillStyle = `hsl(${hue} 60% 45%)`
  ctx.fillRect(0, 0, 96, 64)
  ctx.fillStyle = 'white'
  ctx.font = '12px system-ui'
  ctx.fillText(seed.split('/').pop() ?? seed, 6, 36)
  return canvas.toDataURL('image/png')
}

/**
 * Stand in for the React Native host: answer `loadImage` the way each transport
 * would. Relay answers `confirmRequired` until the request carries `confirmed`.
 */
function MockHost({ mode, children }: { mode: HostMode; children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const host = globalThis as unknown as MockHostWindow
    const uninstall = installHostBridge(() => {})
    host.ReactNativeWebView = {
      postMessage(raw: string) {
        const message = JSON.parse(raw) as { type: string; requestId: string; action: string; payload?: { path: string; confirmed?: boolean } }
        if (message.type !== 'requestNative' || message.action !== 'loadImage') return
        const reply = (body: Record<string, unknown>) =>
          host.__applyHost?.({ type: 'nativeActionResult', requestId: message.requestId, ...body })
        const path = message.payload?.path ?? ''
        if (mode === 'unavailable') { reply({ error: 'loadImage is not available on mobile' }); return }
        if (mode === 'relay' && !message.payload?.confirmed) { reply({ result: { ok: true, confirmRequired: true, size: 412_000 } }); return }
        setTimeout(() => reply({ result: { ok: true, dataUri: samplePng(path) } }), mode === 'slow' ? 2500 : 120)
      },
    }
    setReady(true)
    return () => {
      uninstall()
      delete host.ReactNativeWebView
    }
  }, [mode])
  return ready ? <>{children}</> : null
}

type HostImageStoryProps = React.ComponentProps<typeof PortableHostImage> & { mode: HostMode }

/** The component under a mocked host; `mode` picks how that host answers. */
function HostImageStory({ mode, ...props }: HostImageStoryProps) {
  return <PortableHostImage {...props} />
}

const meta = {
  title: 'Chat/SuperOne/Host image',
  component: HostImageStory,
  parameters: { layout: 'padded' },
  argTypes: { mode: { control: 'radio', options: ['lan', 'relay', 'unavailable', 'slow'] } },
  decorators: [(Story, context) => (
    <MockHost key={String(context.args.mode)} mode={context.args.mode}>
      <div className="w-[390px] text-sm"><Story /></div>
    </MockHost>
  )],
  args: { mode: 'lan', path: `/Users/me/proj/.superone/screenshots/checkout-${Date.now()}.png`, label: 'Screenshot' },
} satisfies Meta<typeof HostImageStory>

export default meta
type Story = StoryObj<typeof meta>

export const Lan: Story = {
  name: 'LAN · picture appears on its own',
}

export const Relay: Story = {
  name: 'Relay · asks before staging the bytes',
  args: { mode: 'relay', path: `/Users/me/proj/.superone/screenshots/relay-${Date.now()}.png` },
}

export const Unavailable: Story = {
  name: 'Host cannot answer · plain preview chip stays',
  args: { mode: 'unavailable', path: '/Users/me/proj/.superone/screenshots/old-host.png' },
}

export const Slow: Story = {
  name: 'Slow host · chip until the bytes land',
  args: { mode: 'slow', path: `/Users/me/proj/.superone/screenshots/slow-${Date.now()}.png` },
}

export const Gallery: Story = {
  name: 'Generated-image gallery · two thumbnails',
  render: () => (
    <PortableNativeGallery
      payload={{
        kind: 'native',
        nativeType: 'image-gallery',
        title: 'Generated images',
        images: [
          { id: 'a', type: 'image_generation', status: 'completed', savedPath: `/Users/me/proj/media/concept-a-${Date.now()}.png` },
          { id: 'b', type: 'image_generation', status: 'completed', savedPath: `/Users/me/proj/media/concept-b-${Date.now()}.png` },
        ],
      }}
    />
  ),
}
