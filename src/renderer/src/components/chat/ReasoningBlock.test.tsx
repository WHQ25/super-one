/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReasoningBlock } from './ReasoningBlock'

describe('ReasoningBlock', () => {
  it('auto-expands once showContent flips true during streaming', () => {
    const { rerender } = render(
      <ReasoningBlock text="" blockDone={false} showContent={false} />,
    )
    expect(screen.queryByText(/thought delta/)).not.toBeInTheDocument()

    rerender(
      <ReasoningBlock text="thought delta" blockDone={false} showContent={true} />,
    )
    expect(screen.getByText('thought delta')).toBeInTheDocument()
  })

  it('stays expanded when content mounts with text during streaming', () => {
    render(<ReasoningBlock text="hello" blockDone={false} showContent={true} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('respects user collapse after auto-expand', () => {
    const { rerender } = render(
      <ReasoningBlock text="" blockDone={false} showContent={false} />,
    )
    rerender(
      <ReasoningBlock text="first chunk" blockDone={false} showContent={true} />,
    )
    expect(screen.getByText('first chunk')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Thinking...'))
    expect(screen.queryByText('first chunk')).not.toBeInTheDocument()

    rerender(
      <ReasoningBlock text="first chunk more" blockDone={false} showContent={true} />,
    )
    expect(screen.queryByText('first chunk more')).not.toBeInTheDocument()
  })

  it('collapses on done when collapseOnDone is true', () => {
    const { rerender } = render(
      <ReasoningBlock text="thinking text" blockDone={false} showContent={true} />,
    )
    expect(screen.getByText('thinking text')).toBeInTheDocument()

    rerender(
      <ReasoningBlock text="thinking text" blockDone={true} showContent={true} />,
    )
    expect(screen.queryByText('thinking text')).not.toBeInTheDocument()
  })
})
