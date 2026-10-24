/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TranscriptStateProvider } from '@superone/ui/lib/transcript-state'
import { ReasoningBlock } from './ReasoningBlock'

describe('ReasoningBlock', () => {
  it('stays collapsed when showContent flips true during streaming', () => {
    const { rerender } = render(
      <ReasoningBlock text="" blockDone={false} showContent={false} />,
    )
    expect(screen.queryByText(/thought delta/)).not.toBeInTheDocument()

    rerender(
      <ReasoningBlock text="thought delta" blockDone={false} showContent={true} />,
    )
    expect(screen.queryByText('thought delta')).not.toBeInTheDocument()
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('stays collapsed when content mounts during streaming', () => {
    render(<ReasoningBlock text="hello" blockDone={false} showContent={true} />)
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('keeps a manual expand open as more text streams', () => {
    const { rerender } = render(
      <ReasoningBlock text="first chunk" blockDone={false} showContent={true} />,
    )
    fireEvent.click(screen.getByText('Thinking...'))
    expect(screen.getByText('first chunk')).toBeInTheDocument()

    rerender(
      <ReasoningBlock text="first chunk more" blockDone={false} showContent={true} />,
    )
    expect(screen.getByText('first chunk more')).toBeInTheDocument()
  })

  it('keeps a manual collapse closed as more text streams', () => {
    const { rerender } = render(
      <ReasoningBlock text="first chunk" blockDone={false} showContent={true} />,
    )
    fireEvent.click(screen.getByText('Thinking...'))
    fireEvent.click(screen.getByText('Thinking...'))
    expect(screen.queryByText('first chunk')).not.toBeInTheDocument()

    rerender(
      <ReasoningBlock text="first chunk more" blockDone={false} showContent={true} />,
    )
    expect(screen.queryByText('first chunk more')).not.toBeInTheDocument()
  })

  it('collapses a manually opened block when it finishes', () => {
    const { rerender } = render(
      <ReasoningBlock text="thinking text" blockDone={false} showContent={true} />,
    )
    fireEvent.click(screen.getByText(/^Thinking/))
    expect(screen.getByText('thinking text')).toBeInTheDocument()

    rerender(
      <ReasoningBlock text="thinking text" blockDone={true} showContent={true} />,
    )
    expect(screen.queryByText('thinking text')).not.toBeInTheDocument()
  })

  it('shows the persisted duration when a completed block mounts (e.g. after a session switch)', () => {
    const started = Date.now() - 7000
    render(
      <ReasoningBlock text="done" blockDone={true} startedAt={started} endedAt={started + 5000} showContent={true} />,
    )
    expect(screen.getByText('Thought for 5s')).toBeInTheDocument()
  })

  it('falls back to no duration when timestamps are absent and it mounts done', () => {
    render(<ReasoningBlock text="done" blockDone={true} showContent={true} />)
    expect(screen.getByText('Thought')).toBeInTheDocument()
  })

  it('collapses reasoning that finishes while its row is unmounted', () => {
    const values = new Map<string, unknown>()
    const view = (text: string, done: boolean, visible = true) => (
      <TranscriptStateProvider values={values} scope="turn">
        {visible && <ReasoningBlock text={text} blockDone={done} showContent={!!text} />}
      </TranscriptStateProvider>
    )
    const { rerender } = render(view('', false))
    rerender(view('reasoning delta', false))
    expect(screen.queryByText('reasoning delta')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/^Thinking/))
    expect(screen.getByText('reasoning delta')).toBeVisible()

    rerender(view('reasoning delta', false, false))
    rerender(view('reasoning delta', true))
    expect(screen.getByText(/^Thought/)).toBeVisible()
    expect(screen.queryByText('reasoning delta')).not.toBeInTheDocument()
  })

  it('preserves a completed block manually expanded before its row is unmounted', () => {
    const values = new Map<string, unknown>()
    const view = (visible = true) => (
      <TranscriptStateProvider values={values} scope="turn">
        {visible && <ReasoningBlock text="finished reasoning" blockDone />}
      </TranscriptStateProvider>
    )
    const { rerender } = render(view())
    fireEvent.click(screen.getByText('Thought'))
    expect(screen.getByText('finished reasoning')).toBeVisible()

    rerender(view(false))
    rerender(view())
    expect(screen.getByText('finished reasoning')).toBeVisible()
  })

  it('preserves a manual collapse when a live row is remounted', () => {
    const values = new Map<string, unknown>()
    const view = (visible = true) => (
      <TranscriptStateProvider values={values} scope="turn">
        {visible && <ReasoningBlock text="live reasoning" blockDone={false} />}
      </TranscriptStateProvider>
    )
    const { rerender } = render(view())
    expect(screen.queryByText('live reasoning')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/^Thinking/))
    expect(screen.getByText('live reasoning')).toBeVisible()
    fireEvent.click(screen.getByText(/^Thinking/))
    expect(screen.queryByText('live reasoning')).not.toBeInTheDocument()

    rerender(view(false))
    rerender(view())
    expect(screen.queryByText('live reasoning')).not.toBeInTheDocument()
  })

  it('preserves a manual expand when a live row is remounted', () => {
    const values = new Map<string, unknown>()
    const view = (visible = true) => (
      <TranscriptStateProvider values={values} scope="turn">
        {visible && <ReasoningBlock text="live reasoning" blockDone={false} />}
      </TranscriptStateProvider>
    )
    const { rerender } = render(view())
    fireEvent.click(screen.getByText(/^Thinking/))
    expect(screen.getByText('live reasoning')).toBeVisible()

    rerender(view(false))
    rerender(view())
    expect(screen.getByText('live reasoning')).toBeVisible()
  })

  it('keeps deferred reasoning open on completion when automatic collapse is disabled', () => {
    const values = new Map<string, unknown>()
    const view = (done: boolean, visible = true) => (
      <TranscriptStateProvider values={values} scope="turn">
        {visible && <ReasoningBlock text="deferred reasoning" blockDone={done} collapseOnDone={false} />}
      </TranscriptStateProvider>
    )
    const { rerender } = render(view(false))
    fireEvent.click(screen.getByText(/^Thinking/))
    expect(screen.getByText('deferred reasoning')).toBeVisible()

    rerender(view(false, false))
    rerender(view(true))
    expect(screen.getByText('deferred reasoning')).toBeVisible()
  })
})
