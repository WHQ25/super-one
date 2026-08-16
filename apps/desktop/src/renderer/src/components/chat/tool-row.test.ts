import { describe, expect, it } from 'vitest'
import { toolOutcomeLabel, withStreamingEllipsis } from './tool-row'

describe('toolOutcomeLabel', () => {
  it('uses verb + noun when denied or failed, and noun + past participle when done', () => {
    expect(toolOutcomeLabel({
      streaming: false,
      interrupted: true,
      streamingLabel: 'Generating image',
      actionLabel: 'Generate Image',
      doneLabel: 'Image Generated',
    })).toBe('Generate Image')
    expect(toolOutcomeLabel({
      streaming: false,
      interrupted: false,
      streamingLabel: 'Generating image',
      actionLabel: 'Generate Image',
      doneLabel: 'Image Generated',
    })).toBe('Image Generated')
  })
})

describe('withStreamingEllipsis', () => {
  it('appends an ellipsis only while streaming', () => {
    expect(withStreamingEllipsis('Reading settings', true)).toBe('Reading settings…')
    expect(withStreamingEllipsis('Settings Read', false)).toBe('Settings Read')
  })

  it('does not double an existing ellipsis', () => {
    expect(withStreamingEllipsis('Packing…', true)).toBe('Packing…')
    expect(withStreamingEllipsis('Generating widget…', true)).toBe('Generating widget…')
  })
})
