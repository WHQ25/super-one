import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { ToolBlock } from './ToolBlock'
import {
  createDefaultPerSessionState,
  createDefaultProjectState,
  useChatStore,
} from '@/stores/chat'

const SB_PROJECT = '__storybook__'
const SB_SESSION = 'sb'
const TOOL = 'mcp__superone__media_generate_video'

function svgPlaceholder(hue: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="hsl(${hue},55%,55%)"/><text x="50%" y="50%" font-size="22" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function mockApp(): void {
  (window as any).app = {
    ...((window as any).app ?? {}),
    readFileAsDataUri: (path: string) => {
      const name = path.split('/').pop() ?? 'img'
      return Promise.resolve({ ok: true, dataUri: svgPlaceholder(200 + (path.length % 100), name) })
    },
  }
}

function seedSession(videoGenStatuses: Record<string, unknown>): void {
  const session = createDefaultPerSessionState()
  session.cwd = '/Users/me/projects/super-one'
  session.videoGenStatuses = videoGenStatuses as any
  const project = createDefaultProjectState()
  project._activeSessionId = SB_SESSION
  project._sessions = { [SB_SESSION]: session }
  project.homedir = '/Users/me'
  useChatStore.setState({
    activeProject: SB_PROJECT,
    projectSessions: { [SB_PROJECT]: project },
  })
}

function block(input: Record<string, unknown>, opts: { result?: string; status?: 'streaming' | 'complete' } = {}) {
  return (
    <ToolBlock
      toolName={TOOL}
      input={JSON.stringify(input)}
      status={opts.status ?? 'complete'}
      result={opts.result}
    />
  )
}

const PROMPT = 'A golden retriever runs across a sunlit beach at sunset, camera tracking alongside at a low angle'
const INPUT = { prompt: PROMPT, provider: 'ark', model: 'seedance-1-pro', aspect_ratio: '16:9', resolution: '1080p', duration: 6, generate_audio: true, watermark: false, camera_fixed: false }

const INPUT_REFS = { ...INPUT, first_frame_path: '/Users/me/video/start.png', last_frame_path: '/Users/me/video/end.png', reference_image_paths: ['/Users/me/video/ref-a.png', '/Users/me/video/ref-b.png', '/Users/me/video/ref-c.png'], reference_video_paths: ['/Users/me/video/source.mp4'], reference_audio_paths: ['/Users/me/video/bgm.wav'], fps: 24, seed: 42 }

function Shell({ children, w = 720 }: { children: ReactNode; w?: number }) {
  const [ready, setReady] = useState(false)
  useEffect(() => { mockApp(); setReady(true) }, [])
  if (!ready) return null
  return <div className="@container space-y-4" style={{ maxWidth: w }}>{children}</div>
}

function SeedAndRender({ genStatuses, input, result, status }: { genStatuses: Record<string, unknown>; input: Record<string, unknown>; result?: string; status?: 'streaming' | 'complete' }) {
  useEffect(() => { seedSession(genStatuses) }, [genStatuses])
  return block(input, { result, status })
}

const meta: Meta = { title: 'ClaudeCode/VideoGenToolBlock', parameters: { layout: 'padded' } }
export default meta

export const Submitted: StoryObj = { render: () => <Shell><SeedAndRender genStatuses={{ 'g1': { status: 'submitted', generationId: 'g1', prompt: PROMPT, provider: 'ark', model: 'seedance-1-pro' } }} input={INPUT} result={JSON.stringify({ status: 'submitted', generationId: 'g1' })} /></Shell> }

export const Completed: StoryObj = { render: () => <Shell><SeedAndRender genStatuses={{ 'g3': { status: 'generated', generationId: 'g3', prompt: PROMPT, provider: 'google', model: 'veo-3', savedPaths: ['/tmp/v.mp4'] } }} input={INPUT} result={JSON.stringify({ status: 'generated', generationId: 'g3', savedPaths: ['/tmp/v.mp4'] })} /></Shell> }

export const Failed: StoryObj = { render: () => <Shell><SeedAndRender genStatuses={{ 'g4': { status: 'error', generationId: 'g4', prompt: PROMPT, provider: 'ark', model: 'seedance-1-pro', error: 'Provider returned status 500: Internal server error' } }} input={INPUT} result={JSON.stringify({ status: 'error', generationId: 'g4', message: 'Provider returned status 500: Internal server error' })} /></Shell> }

export const WithWarnings: StoryObj = { render: () => <Shell><SeedAndRender genStatuses={{ 'g5': { status: 'generated', generationId: 'g5', prompt: PROMPT, provider: 'ark', model: 'seedance-1-pro', savedPaths: ['/tmp/v.mp4'], warnings: ['camera_fixed not supported', 'generate_audio ignored'] } }} input={INPUT} result={JSON.stringify({ status: 'generated', generationId: 'g5', savedPaths: ['/tmp/v.mp4'], warnings: ['camera_fixed not supported', 'generate_audio ignored'] })} /></Shell> }

export const Streaming: StoryObj = { render: () => <Shell><SeedAndRender genStatuses={{}} input={INPUT} status="streaming" /></Shell> }

export const WithReferenceMaterials: StoryObj = { render: () => <Shell><SeedAndRender genStatuses={{ 'g6': { status: 'submitted', generationId: 'g6', prompt: INPUT_REFS.prompt, provider: 'ark', model: 'seedance-1-pro' } }} input={INPUT_REFS} result={JSON.stringify({ status: 'submitted', generationId: 'g6' })} /></Shell> }

export const AllStates: StoryObj = { render: () => <Shell w={800}>{[
  { g: 'ga', status: 'submitted', r: JSON.stringify({ status: 'submitted', generationId: 'ga' }) },
  { g: 'gc', status: 'generated', r: JSON.stringify({ status: 'generated', generationId: 'gc', savedPaths: ['/tmp/a.mp4'] }) },
  { g: 'gd', status: 'error', r: JSON.stringify({ status: 'error', generationId: 'gd', message: 'Provider returned status 500' }) },
].map((s) => {
  const gs: Record<string, unknown> = { [s.g]: { status: s.status, generationId: s.g, prompt: PROMPT, provider: 'ark', model: 'seedance-1-pro', ...(s.status === 'error' ? { error: 'Provider returned status 500' } : {}), ...(s.status === 'generated' ? { savedPaths: ['/tmp/a.mp4'] } : {}) } }
  return <SeedAndRender key={s.g} genStatuses={gs} input={INPUT} result={s.r} />
})}</Shell> }
