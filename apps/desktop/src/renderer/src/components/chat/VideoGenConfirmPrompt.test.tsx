/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VideoGenConfirmPrompt, type VideoGenParams } from './VideoGenConfirmPrompt'

const params: VideoGenParams = {
  prompt: 'A quiet street', provider: 'ark', model: 'seedance', aspectRatio: '16:9', resolution: '720p',
  duration: 5, generateAudio: false, watermark: false, cameraFixed: false,
}

describe('video generation feedback', () => {
  it.each([{ shiftKey: true }, { altKey: true }])('keeps feedback newlines without starting generation %j', (modifier) => {
    const onConfirm = vi.fn()
    const onReject = vi.fn()
    render(<VideoGenConfirmPrompt params={params} providers={[
      { id: 'ark', label: 'Ark', models: [{ id: 'seedance', label: 'Seedance' }], aspectRatios: ['16:9'], resolutions: ['720p'] },
    ]} onConfirm={onConfirm} onReject={onReject} />)
    const feedback = screen.getByPlaceholderText(/feedback/i) as HTMLTextAreaElement
    feedback.focus()
    fireEvent.change(feedback, { target: { value: 'Use a slower camera movement' } })
    feedback.setSelectionRange(feedback.value.length, feedback.value.length)
    fireEvent.keyDown(feedback, { key: 'Enter', ...modifier })
    fireEvent.change(feedback, { target: { value: `${feedback.value}Keep the original lighting` } })
    expect(onReject).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.keyDown(feedback, { key: 'Enter' })
    expect(onReject).toHaveBeenCalledExactlyOnceWith('Use a slower camera movement\nKeep the original lighting')
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
