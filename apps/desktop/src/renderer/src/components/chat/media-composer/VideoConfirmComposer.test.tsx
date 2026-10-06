/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VIDEO_GEN_PARAMS_FIELD, type VideoGenConfirmPayload } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { VideoConfirmComposer } from './VideoConfirmComposer'

const previousChat = useChatStore.getState()
const previousApp = window.app
const respond = vi.fn()
const payload: VideoGenConfirmPayload = {
  params: { prompt: 'A fox runs through snow', provider: 'ark', model: 'seedance', aspectRatio: '16:9', resolution: '720p', duration: 5,
    seed: 7, generateAudio: false, watermark: false, cameraFixed: false },
  providers: [
    { id: 'ark', label: 'Ark', models: [{ id: 'seedance', label: 'Seedance' }], aspectRatios: ['16:9', '9:16'], resolutions: ['720p', '1080p'] },
    { id: 'google', label: 'Google', models: [{ id: 'veo', label: 'Veo' }], aspectRatios: ['16:9'], resolutions: ['1080p'] },
  ],
  referenceImages: [{ path: '/refs/start.png', role: 'first_frame' }],
}
const request = { requestId: 'video-1', toolName: 'media_generate_video', input: {}, allowAlwaysAllow: false, requestKind: 'video_gen_confirm' as const, videoGenConfirm: payload }

beforeEach(() => {
  respond.mockReset().mockResolvedValue(undefined)
  useChatStore.setState({ respondToPermission: respond })
  window.app = Object.assign(Object.create(previousApp), { readFileAsDataUri: vi.fn().mockResolvedValue({ ok: true, dataUri: 'data:image/png;base64,AAAA' }) })
})
afterEach(() => { useChatStore.setState(previousChat); window.app = previousApp })

it('shows the agent request with its reference frames and returns the edited parameters on Generate', async () => {
  render(<VideoConfirmComposer request={request} />)
  expect(await screen.findByRole('img', { name: 'start.png' })).toBeInTheDocument()
  expect(screen.getByText('Start Frame')).toBeInTheDocument()
  expect(screen.queryByTitle('Exit Video Generation')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Generate With/ })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'A fox runs through deep snow' } })
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  expect(respond).toHaveBeenCalledWith('video-1', true, undefined, undefined, undefined, undefined, { [VIDEO_GEN_PARAMS_FIELD]: expect.any(String) }, undefined)
  const params = JSON.parse(respond.mock.calls[0]![6][VIDEO_GEN_PARAMS_FIELD])
  expect(params).toEqual({ ...payload.params, prompt: 'A fox runs through deep snow' })
})

it('rejects with optional feedback for the agent', async () => {
  render(<VideoConfirmComposer request={request} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Tell the agent what to change (optional)' }), { target: { value: 'Make it vertical' } })
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
  await waitFor(() => expect(respond).toHaveBeenCalledWith('video-1', false, undefined, undefined, undefined, undefined, { feedback: 'Make it vertical' }, undefined))
})

it('cannot generate without a prompt', () => {
  render(<VideoConfirmComposer request={request} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: '  ' } })
  expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
})

it('fits the agent request to the model controls and returns the switches the model reads', async () => {
  const capabilities = { aspectRatios: ['16:9', '9:16'], resolutions: ['854x480', '1280x720', '1920x1080'], durations: [5, 10],
    seed: true, generateAudio: false, watermark: true, cameraFixed: false, firstFrame: true, lastFrame: true, references: true }
  const fitted = { ...request, videoGenConfirm: { ...payload, params: { ...payload.params, resolution: '720p', duration: 5, generateAudio: true },
    providers: [{ ...payload.providers[0]!, models: [{ id: 'seedance', label: 'Seedance', capabilities }] }] } }
  render(<VideoConfirmComposer request={fitted} />)
  expect(screen.getByRole('button', { name: 'Resolution: 720p' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'More Settings' }))
  expect(screen.queryByRole('switch', { name: 'Generate Audio' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('switch', { name: 'Watermark' }))
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  const params = JSON.parse(respond.mock.calls[0]![6][VIDEO_GEN_PARAMS_FIELD])
  expect(params).toMatchObject({ resolution: '1280x720', seed: 7, generateAudio: false, watermark: true, cameraFixed: false })
})
