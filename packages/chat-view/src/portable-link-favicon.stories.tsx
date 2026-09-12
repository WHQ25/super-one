import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { installHostBridge } from './bridge'
import { resetHostFaviconCache } from './host-favicon'
import { PortableMarkdown } from './PortableMarkdown'
import { PortableTurnProvider } from './PortableTurnAdapters'

type HostMode = 'colour' | 'monochrome' | 'none' | 'slow' | 'unavailable'

interface MockHostWindow extends Window {
  ReactNativeWebView?: { postMessage(message: string): void }
  __applyHost?: (message: unknown) => void
}

/**
 * A 32×32 icon drawn on the fly: a coloured badge, or a dark-grey ring on
 * transparent — the kind of monochrome icon that sinks into a dark background
 * unless the presenter re-tints it.
 */
function sampleIcon(seed: string, monochrome: boolean): string {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')!
  let hue = 0
  for (const ch of seed) hue = (hue * 31 + ch.charCodeAt(0)) % 360
  if (monochrome) {
    ctx.fillStyle = '#333'
    ctx.beginPath()
    ctx.arc(16, 16, 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.clearRect(11, 11, 10, 10)
  } else {
    ctx.fillStyle = `hsl(${hue} 65% 45%)`
    ctx.beginPath()
    ctx.roundRect(2, 2, 28, 28, 7)
    ctx.fill()
    ctx.fillStyle = 'white'
    ctx.font = 'bold 18px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(seed[0]?.toUpperCase() ?? '?', 16, 17)
  }
  return canvas.toDataURL('image/png')
}

/**
 * Stand in for the React Native host: answer `resolveFavicon` the way the
 * desktop would from its cache. Each origin gets a distinct badge so a
 * transcript citing several sites reads the way it does on the desktop.
 */
function MockHost({ mode, children }: { mode: HostMode; children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const host = globalThis as unknown as MockHostWindow
    const uninstall = installHostBridge(() => {})
    resetHostFaviconCache()
    host.ReactNativeWebView = {
      postMessage(raw: string) {
        const message = JSON.parse(raw) as { type: string; requestId: string; action: string; payload?: { url: string } }
        if (message.type !== 'requestNative' || message.action !== 'resolveFavicon') return
        const reply = (body: Record<string, unknown>) =>
          host.__applyHost?.({ type: 'nativeActionResult', requestId: message.requestId, ...body })
        if (mode === 'unavailable') { reply({ error: 'resolveFavicon is not available' }); return }
        if (mode === 'none') { reply({ result: { ok: true, dataUrl: null } }); return }
        const origin = new URL(message.payload?.url ?? 'https://example.com').hostname
        const dataUrl = sampleIcon(origin, mode === 'monochrome')
        setTimeout(() => reply({ result: { ok: true, dataUrl } }), mode === 'slow' ? 2500 : 120)
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

type LinkStoryProps = React.ComponentProps<typeof PortableMarkdown> & { mode: HostMode }

/** The markdown under a mocked host; `mode` picks how that host answers. */
function LinkFaviconStory({ mode, ...props }: LinkStoryProps) {
  return <PortableMarkdown {...props} />
}

const meta = {
  title: 'Chat/SuperOne/Link favicon',
  component: LinkFaviconStory,
  parameters: { layout: 'padded' },
  argTypes: { mode: { control: 'radio', options: ['colour', 'monochrome', 'none', 'slow', 'unavailable'] } },
  decorators: [(Story, context) => {
    const scheme = context.globals.theme === 'light' ? 'light' : 'dark'
    return (
      <MockHost key={`${String(context.args.mode)}-${scheme}`} mode={context.args.mode}>
        <PortableTurnProvider scheme={scheme} pendingPermission={null} projectPath="/Users/me/proj">
          <div className="w-[390px] text-sm"><Story args={{ ...context.args, scheme }} /></div>
        </PortableTurnProvider>
      </MockHost>
    )
  }],
  args: {
    mode: 'colour',
    text: 'The docs live at [react.dev](https://react.dev/reference/react) and the source on [GitHub](https://github.com/facebook/react).',
    isStreaming: false,
    scheme: 'dark',
  },
} satisfies Meta<typeof LinkFaviconStory>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'Default · one icon per site',
}

export const Monochrome: Story = {
  name: 'Monochrome icon · re-tinted to the foreground in dark mode',
  args: { mode: 'monochrome' },
}

export const NoIcon: Story = {
  name: 'No icon found · globe stays',
  args: { mode: 'none' },
}

export const Slow: Story = {
  name: 'Slow host · globe until the icon lands',
  args: { mode: 'slow' },
}

export const Unavailable: Story = {
  name: 'Host cannot answer · globe stays',
  args: { mode: 'unavailable' },
}

export const MixedLinks: Story = {
  name: 'Mixed · file chip, mailto and web links side by side',
  args: {
    text: [
      '- [ToolRow.tsx](src/components/ToolRow.tsx:42) — a file chip carries no favicon',
      '- [mail the team](mailto:team@example.com) — non-http links carry none either',
      '- [Expo docs](https://docs.expo.dev/) and [MDN](https://developer.mozilla.org/)',
    ].join('\n'),
  },
}

export const LongLabel: Story = {
  name: 'Long label · icon stays on the first line',
  args: {
    text: 'See [a very long link label that keeps going and wraps onto a second line in a phone column](https://example.com/a/very/long/path).',
  },
}
