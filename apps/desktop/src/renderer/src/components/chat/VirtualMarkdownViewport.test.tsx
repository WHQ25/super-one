/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FullscreenGlassDialog } from './FullscreenGlassDialog'
import { VirtualMarkdownViewport } from './VirtualMarkdownViewport'
import { VirtualTranscriptContext, useVirtualTranscript } from './virtual-transcript-context'

function ContextProbe({ label }: { label: string }) {
  const ctx = useVirtualTranscript()
  return <span>{`${label}:${ctx === null ? 'null' : 'present'}`}</span>
}

describe('VirtualTranscriptContext isolation', () => {
  const outerContext = {
    viewportRef: { current: null },
    observeBlock: vi.fn(() => () => {}),
    preserveBlockAnchor: vi.fn(),
  }

  it('resets VirtualTranscriptContext to null when VirtualMarkdownViewport is disabled', () => {
    render(
      <VirtualTranscriptContext.Provider value={outerContext}>
        <VirtualMarkdownViewport enabled={false}>
          <ContextProbe label="viewport" />
        </VirtualMarkdownViewport>
      </VirtualTranscriptContext.Provider>,
    )
    expect(screen.getByText('viewport:null')).toBeVisible()
  })

  it('resets VirtualTranscriptContext to null inside FullscreenGlassDialog portal', () => {
    render(
      <VirtualTranscriptContext.Provider value={outerContext}>
        <FullscreenGlassDialog open onOpenChange={() => {}} title="Preview">
          <ContextProbe label="dialog" />
        </FullscreenGlassDialog>
      </VirtualTranscriptContext.Provider>,
    )
    expect(screen.getByText('dialog:null')).toBeVisible()
  })
})
