/** @vitest-environment jsdom */
import { fireEvent, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { api, openComposer, openWithoutWaiting, owner, useMediaComposerHarness } from './media-composer-test-harness'

useMediaComposerHarness()

it('keeps a video pending after a transport error and resumes status checks without resubmitting', async () => {
  api.mediaGenerate.mockResolvedValue({ generationId: 'video', kind: 'video', status: 'running', files: [] })
  api.mediaVideoStatus.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ generationId: 'video', kind: 'video', status: 'succeeded', files: [{ path: '/video.mp4', agentPath: '/video.mp4', mediaType: 'video/mp4' }] })
  await openComposer('video')
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Check Status' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('offline')
  expect(screen.getByText('Video is generating')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Check Status' }))
  expect(await screen.findByRole('button', { name: 'Insert into Draft' })).toBeEnabled()
  expect(api.mediaGenerate).toHaveBeenCalledTimes(1)
})

it('restores a durable video handle when the composer is reopened', async () => {
  api.mediaPendingVideos.mockResolvedValue([{ generationId: 'restored', kind: 'video', status: 'running', files: [] }])
  await openWithoutWaiting('video')
  expect(await screen.findByText('Video is generating')).toBeInTheDocument()
  expect(api.mediaGenerate).not.toHaveBeenCalled()
  expect(api.mediaPendingVideos).toHaveBeenCalledWith(owner)
})

const ark = { aspectRatios: ['16:9', '9:16'], resolutions: ['854x480', '1280x720', '1920x1080'], durations: [5, 10],
  seed: true, generateAudio: true, watermark: true, cameraFixed: true, firstFrame: true, lastFrame: true, references: true }
const sora = { aspectRatios: [], resolutions: ['1280x720', '720x1280'], durations: [4, 8, 12],
  seed: false, generateAudio: false, watermark: false, cameraFixed: false, firstFrame: false, lastFrame: false, references: false }

it('offers the controls the selected model reads and sends them with a direct generation', async () => {
  api.mediaModels.mockResolvedValue([{ providerId: 'key', providerLabel: 'Ark', model: 'seedance', label: 'Seedance', default: true, video: ark }])
  api.mediaGenerate.mockResolvedValue({ generationId: 'video', kind: 'video', status: 'running', files: [] })
  await openComposer('video', { duration: 10, resolution: '1920x1080', aspectRatio: '9:16', seed: 42 })
  expect(screen.getByRole('button', { name: 'Duration: 10 s' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Resolution: 1080p' })).toBeInTheDocument()
  // Past the four most common controls, the rest live in More Settings.
  expect(screen.queryByRole('button', { name: 'Generate Audio' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'More Settings' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Generate Audio' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Watermark' }))
  expect(screen.getByRole('switch', { name: 'Generate Audio' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('spinbutton', { name: 'Seed' })).toHaveValue(42)
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  expect(api.mediaGenerate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'video', duration: 10, resolution: '1920x1080', aspectRatio: '9:16',
    seed: 42, generateAudio: true, watermark: true }))
})

it('hides controls and reference inputs a model does not read', async () => {
  api.mediaModels.mockResolvedValue([{ providerId: 'key', providerLabel: 'OpenAI', model: 'sora-2', label: 'Sora 2', default: true, video: sora }])
  await openComposer('video')
  expect(screen.queryByRole('button', { name: /^Aspect Ratio/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Generate Audio' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Seed/ })).not.toBeInTheDocument()
  expect(screen.queryByText('Drop reference images here, or click to choose')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Resolution: Auto' })).toBeInTheDocument()
})
