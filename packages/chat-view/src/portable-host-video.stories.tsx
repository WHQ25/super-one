import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { VideoGenerationItem } from '@superone/shared/agent-types'
import { installHostBridge } from './bridge'
import { PortableHostVideo } from './PortableHostVideo'
import { PortableVideoGallery } from './PortableMediaGalleries'
import { PortableMarkdown } from './PortableMarkdown'
import { PortableNativeGallery } from './PortableNativeGallery'
import { PortableTurnProvider } from './PortableTurnAdapters'

type HostMode = 'poster' | 'portrait' | 'no-duration' | 'undecodable' | 'unavailable' | 'slow' | 'pending'

interface MockHostWindow extends Window {
  ReactNativeWebView?: { postMessage(message: string): void }
  __applyHost?: (message: unknown) => void
}

/** A first frame drawn on the fly — a tinted field with a film-strip edge — so the story needs no clip. */
function samplePoster(seed: string, width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  let hue = 0
  for (const ch of seed) hue = (hue * 31 + ch.charCodeAt(0)) % 360
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, `hsl(${hue} 55% 35%)`)
  gradient.addColorStop(1, `hsl(${(hue + 40) % 360} 60% 20%)`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  for (let y = 6; y < height; y += 18) {
    ctx.fillRect(4, y, 8, 10)
    ctx.fillRect(width - 12, y, 8, 10)
  }
  ctx.font = '13px system-ui'
  ctx.fillText(seed.split('/').pop() ?? seed, 20, height - 14)
  return canvas.toDataURL('image/jpeg', 0.8)
}

/**
 * Stand in for the React Native host: answer `loadVideoPoster` the way the
 * desktop would. A poster is always in-band, so unlike images there is no
 * relay confirmation — only "here is the frame" or "I could not cut one".
 */
function MockHost({ mode, children }: { mode: HostMode; children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const host = globalThis as unknown as MockHostWindow
    const uninstall = installHostBridge(() => {})
    host.ReactNativeWebView = {
      postMessage(raw: string) {
        const message = JSON.parse(raw) as { type: string; requestId: string; action: string; payload?: { path: string } }
        if (message.type !== 'requestNative' || message.action !== 'loadVideoPoster') return
        const reply = (body: Record<string, unknown>) =>
          host.__applyHost?.({ type: 'nativeActionResult', requestId: message.requestId, ...body })
        const path = message.payload?.path ?? ''
        if (mode === 'unavailable') { reply({ error: 'loadVideoPoster is not available on mobile' }); return }
        if (mode === 'pending') return
        if (mode === 'undecodable') { reply({ result: { ok: true, poster: null } }); return }
        const [width, height] = mode === 'portrait' ? [288, 512] : [512, 288]
        const poster = {
          dataUri: samplePoster(path, width, height),
          width,
          height,
          ...(mode === 'no-duration' ? {} : { durationMs: 8_400 + (path.length % 7) * 1000 }),
        }
        setTimeout(() => reply({ result: { ok: true, poster } }), mode === 'slow' ? 2500 : 120)
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

type HostVideoStoryProps = React.ComponentProps<typeof PortableHostVideo> & { mode: HostMode }

/** The component under a mocked host; `mode` picks how that host answers. */
function HostVideoStory({ mode, ...props }: HostVideoStoryProps) {
  return <PortableHostVideo {...props} />
}

const GALLERY_CHIP = 'h-48 flex w-40 flex-none flex-col items-center justify-center gap-1.5 overflow-hidden rounded-md border border-border bg-muted/30 p-2 text-center'

const meta = {
  title: 'Chat/SuperOne/Host video',
  component: HostVideoStory,
  parameters: { layout: 'padded' },
  argTypes: { mode: { control: 'radio', options: ['poster', 'portrait', 'no-duration', 'undecodable', 'unavailable', 'slow', 'pending'] } },
  decorators: [(Story, context) => (
    <MockHost key={String(context.args.mode)} mode={context.args.mode}>
      <div className="w-[390px] text-sm"><Story /></div>
    </MockHost>
  )],
  args: { mode: 'poster', path: `/Users/me/proj/media/videos/astronaut-${Date.now()}.mp4`, label: 'Generated video', className: GALLERY_CHIP },
} satisfies Meta<typeof HostVideoStory>

export default meta
type Story = StoryObj<typeof meta>

export const Poster: Story = {
  name: 'Poster · first frame with play badge and duration',
}

export const Portrait: Story = {
  name: 'Poster · portrait clip keeps the tile height',
  args: { mode: 'portrait', path: `/Users/me/proj/media/videos/portrait-${Date.now()}.mp4` },
}

export const NoDuration: Story = {
  name: 'Poster · no duration reported, no badge',
  args: { mode: 'no-duration', path: `/Users/me/proj/media/videos/live-${Date.now()}.webm` },
}

export const Undecodable: Story = {
  name: 'Host could not cut a frame · file-name chip stays',
  args: { mode: 'undecodable', path: '/Users/me/proj/media/videos/odd-codec.mkv' },
}

export const Unavailable: Story = {
  name: 'Host cannot answer · file-name chip stays',
  args: { mode: 'unavailable', path: '/Users/me/proj/media/videos/old-host.mp4' },
}

export const Slow: Story = {
  name: 'Slow host · skeleton until the frame lands',
  args: { mode: 'slow', path: `/Users/me/proj/media/videos/slow-${Date.now()}.mp4` },
}

export const Loading: Story = {
  name: 'Loading · the skeleton on its own',
  args: { mode: 'pending', path: '/Users/me/proj/media/videos/pending.mp4' },
}

const GENERATED = (id: string): VideoGenerationItem => ({
  id, type: 'video_generation', status: 'completed', savedPath: `/Users/me/proj/media/videos/${id}-${Date.now()}.mp4`,
})

export const Gallery: Story = {
  name: 'Turn-end gallery · one clip, as the desktop block lays it out',
  render: () => <PortableVideoGallery items={[GENERATED('astronaut')]} />,
}

export const GalleryMany: Story = {
  name: 'Turn-end gallery · tiles wrap; an in-flight clip has no tile yet',
  render: () => (
    <PortableVideoGallery
      items={[GENERATED('take-a'), GENERATED('take-b'), GENERATED('take-c'), { id: 'pending', type: 'video_generation', status: 'in_progress' }]}
    />
  ),
}

export const NativeWidgetGallery: Story = {
  name: 'widget_show native gallery · agent-titled',
  render: () => (
    <PortableNativeGallery
      payload={{ kind: 'native', nativeType: 'video-gallery', title: 'Dailies', videos: [GENERATED('scene-1'), GENERATED('scene-2')] }}
    />
  ),
}

const MARKDOWN_VIDEOS = [
  'Rendered the walkthrough; the first clip is the sidebar, the second the composer.',
  '',
  `![Sidebar walkthrough](out/sidebar-walkthrough-${Date.now()}.mp4)`,
  '',
  `![Composer](/Users/me/proj/out/composer-${Date.now()}.mov)`,
  '',
  'Both are under 30 s.',
].join('\n')

/**
 * The agent embeds a clip it wrote with `![…](clip.mp4)`, which the desktop
 * plays inline; the phone shows its first frame and plays on tap.
 */
function MarkdownVideosStory({ text = MARKDOWN_VIDEOS }: { text?: string }) {
  return (
    <PortableTurnProvider scheme="dark" pendingPermission={null} projectPath="/Users/me/proj">
      <PortableMarkdown text={text} isStreaming={false} scheme="dark" />
    </PortableTurnProvider>
  )
}

export const Markdown: Story = {
  name: 'Markdown video · project-relative and absolute paths both get a poster',
  render: () => <MarkdownVideosStory />,
}

export const MarkdownUnavailable: Story = {
  name: 'Markdown video · host cannot answer, file-name chip instead of broken alt text',
  args: { mode: 'unavailable' },
  render: () => <MarkdownVideosStory />,
}

export const MarkdownLoading: Story = {
  name: 'Markdown video · skeleton in the paragraph',
  args: { mode: 'pending' },
  render: () => <MarkdownVideosStory />,
}
