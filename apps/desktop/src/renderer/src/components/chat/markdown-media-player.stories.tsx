import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import sampleVideo from '../../../../../../mobile/assets/preview/sample-clip.mp4?url'
import sampleAudio from '../../../../../../mobile/assets/audio/incallmanager_ringback.mp3?url'
import songWithCover from './__fixtures__/song-with-cover.mp3?url'
import voiceMemo from './__fixtures__/voice-memo.mp3?url'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { MarkdownAudioPlayer, MarkdownVideoPlayer } from './markdown-media-player'

// No media server here: every fixture is served by Storybook itself.
mockIpc('app', 'getMediaServerPort', async () => 0)

function Column({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="text-sm leading-relaxed text-foreground" style={{ maxWidth: width }}>
      <p>Here is the recording of the sidebar walkthrough:</p>
      {children}
      <p>The clip starts with the collapsed sidebar.</p>
    </div>
  )
}

const meta: Meta = {
  title: 'Chat/MarkdownMediaPlayer',
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj

export const Video: Story = {
  render: () => <Column><MarkdownVideoPlayer src={sampleVideo} /></Column>,
}

export const VerticalVideoVolume: Story = {
  ...Video,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const mute = canvas.getByRole('button', { name: 'Mute' })
    await userEvent.hover(mute)
    const slider = await canvas.findByRole('slider', { name: 'Volume' })
    await expect(slider).toHaveAttribute('aria-orientation', 'vertical')
    await expect(slider.getBoundingClientRect().bottom).toBeLessThan(mute.getBoundingClientRect().top)
  },
}

/** Authored `<video width>` keeps its size; the player stays centered. */
export const VideoAuthoredWidth: Story = {
  render: () => <Column><MarkdownVideoPlayer src={sampleVideo} width={640} /></Column>,
}

export const VideoNarrow: Story = {
  render: () => <Column width={320}><MarkdownVideoPlayer src={sampleVideo} width={640} /></Column>,
}

/** Right-click a local clip: save, reveal, mention, and copy its path. */
export const VideoFileMenu: Story = {
  render: () => (
    <Column>
      <MarkdownVideoPlayer
        src={sampleVideo}
        filePath="/Users/me/clips/walkthrough.mp4"
        copyText="![walkthrough](/Users/me/clips/walkthrough.mp4)"
      />
    </Column>
  ),
  play: async ({ canvasElement }) => {
    const video = canvasElement.querySelector('video')
    if (!video) throw new Error('missing video')
    await userEvent.pointer({ keys: '[MouseRight]', target: video })
    const menu = within(document.body)
    await expect(menu.findByRole('menuitem', { name: 'Save As' })).resolves.toBeVisible()
    await expect(menu.findByRole('menuitem', { name: 'Copy Path' })).resolves.toBeVisible()
    await expect(menu.findByRole('menuitem', { name: 'Add to Chat' })).resolves.toBeVisible()
    await expect(menu.findByRole('menuitem', { name: 'Open Folder' })).resolves.toBeVisible()
  },
}

/** A source that never loads: seeking is disabled and the timer reads 0:00. */
export const VideoUnavailable: Story = {
  render: () => <Column><MarkdownVideoPlayer src="local-file:///missing/clip.mp4" width={480} height={270} /></Column>,
}

/** No tags: titled by its file name, with the placeholder cover and no lyrics button. */
export const Audio: Story = {
  render: () => <Column><MarkdownAudioPlayer src={sampleAudio} source="local-file:///Users/me/Recordings/ringback%20tone.mp3" /></Column>,
}

/** ID3 title, artist, album and front cover; the embedded `SYLT` lyrics opened. */
export const AudioWithCoverAndLyrics: Story = {
  render: () => <Column><MarkdownAudioPlayer src={songWithCover} /></Column>,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Show Lyrics' }))
  },
}

/** Untagged recording whose lyrics come from `voice-memo.lrc` beside it. */
export const AudioSidecarLyrics: Story = {
  render: () => <Column><MarkdownAudioPlayer src={voiceMemo} /></Column>,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Show Lyrics' }))
  },
}

export const AudioNarrow: Story = {
  render: () => <Column width={300}><MarkdownAudioPlayer src={songWithCover} /></Column>,
}

/** A source that never loads: the file name still titles it, and seeking stays disabled. */
export const AudioUnavailable: Story = {
  render: () => <Column><MarkdownAudioPlayer src="local-file:///missing/interview.m4a" /></Column>,
}
