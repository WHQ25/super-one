/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ToolName, ToolRow, ToolSummary, toolOutcomeLabel, withStreamingEllipsis } from './tool-row'

describe('ToolRow', () => {
  it('owns shared error chrome and lazily mounts progressive details', () => {
    const { container } = render(
      <ToolRow
        icon={<span>tool icon</span>}
        tone="error"
        expandable
        details={<div>diagnostic detail</div>}
        mountDetails="expanded"
      >
        <ToolName tone="error">Run Command</ToolName>
        <ToolSummary>bun run test</ToolSummary>
      </ToolRow>,
    )

    expect(container.querySelector('.tool-node')).toHaveClass('errored', 'bg-warning/10')
    expect(screen.getByText('Error')).toBeTruthy()
    expect(screen.queryByText('diagnostic detail')).toBeNull()

    fireEvent.click(screen.getByText('Run Command'))
    expect(screen.getByText('diagnostic detail')).toBeTruthy()
  })
})

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
