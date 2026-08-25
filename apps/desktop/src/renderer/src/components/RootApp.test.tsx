/** @vitest-environment jsdom */

import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowMiniMode } from '@superone/shared/agent-types'
import { RootApp } from './RootApp'
import {
  enterMiniWindow,
  exitMiniWindow,
  useWindowMiniModeStore,
} from '@/stores/window-mini-mode'

// The fold choreography is what's under test — this stand-in lets the test assert
// DOM identity without booting the whole app shell.
vi.mock('../App', () => ({
  default: () => (
    <div data-testid="full-app" data-main-area="">
      <div data-testid="chat-content" data-main-inner="" />
    </div>
  ),
}))
const MODE: WindowMiniMode = { projectPath: '/project', sessionId: 'sid-1', title: 'Saved' }

// Only has to outrun the fold, not match it exactly.
const FOLD_TOTAL = 600

// The stubs resolve like main does — once the window animation has landed. The
// renderer switches shells off that resolution, not off a clock of its own.
const ANIMATION_MS = 400

let push: ((mode: WindowMiniMode | null) => void) | null = null
const convert = vi.fn()
const restore = vi.fn()

function stubWindowApp(initial: WindowMiniMode | null) {
  push = null
  convert.mockReset()
  restore.mockReset()
  convert.mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, ANIMATION_MS)))
  restore.mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, ANIMATION_MS)))
  Object.assign(window.app, {
    getWindowMiniMode: () => Promise.resolve(initial),
    convertWindowToMini: convert,
    restoreWindowFromMini: restore,
    onWindowMiniModeChanged: (cb: (mode: WindowMiniMode | null) => void) => {
      push = cb
      return () => { push = null }
    },
  })
}

describe('RootApp mini-window fold', () => {
  beforeEach(() => {
    useWindowMiniModeStore.setState({ mode: null, phase: 'app', panelsFolded: false })
    stubWindowApp(null)
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the same app and chat DOM mounted after the window becomes mini', async () => {
    render(<RootApp />)
    const app = screen.getByTestId('full-app')
    const chat = screen.getByTestId('chat-content')

    await act(async () => { enterMiniWindow(MODE) })

    // The shell stays on screen for the whole fold, and `panelsFolded` stays false —
    // the panels' width is tracked off the live window size until the fold lands.
    expect(useWindowMiniModeStore.getState()).toMatchObject({ phase: 'folding', panelsFolded: false })
    expect(screen.getByTestId('full-app')).toBeInTheDocument()
    const steps = convert.mock.calls[0]?.[3] as Array<Record<string, number>>
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({ height: 640 })

    await act(async () => { await vi.advanceTimersByTimeAsync(FOLD_TOTAL) })
    expect(screen.getByTestId('full-app')).toBe(app)
    expect(screen.getByTestId('chat-content')).toBe(chat)
    expect(screen.queryByTestId('mini-app')).not.toBeInTheDocument()
  })

  it('enters mini phase when main reports the fold landed, not on a clock of its own', async () => {
    render(<RootApp />)
    await act(async () => { enterMiniWindow(MODE) })

    // Main's animation runs long (IPC hop, starved timer) — the shell must stay up
    // for as long as the window is actually moving.
    await act(async () => { await vi.advanceTimersByTimeAsync(ANIMATION_MS - 50) })
    expect(useWindowMiniModeStore.getState().phase).toBe('folding')

    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(useWindowMiniModeStore.getState().phase).toBe('mini')
  })

  it('lets chat content reflow against every intermediate window width', async () => {
    render(<RootApp />)
    await act(async () => { enterMiniWindow(MODE) })

    const chat = screen.getByTestId('chat-content')
    expect(chat).not.toHaveStyle({ position: 'absolute' })
    expect(chat.style.width).toBe('')
  })

  it('still finishes the fold on the safety deadline when the IPC never resolves', async () => {
    convert.mockImplementation(() => new Promise<void>(() => {}))
    render(<RootApp />)
    await act(async () => { enterMiniWindow(MODE) })

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(useWindowMiniModeStore.getState().phase).toBe('mini')
  })

  it('keeps the same app mounted while reopening the panels in reverse', async () => {
    render(<RootApp />)
    const app = screen.getByTestId('full-app')
    const chat = screen.getByTestId('chat-content')
    await act(async () => { enterMiniWindow(MODE) })
    await act(async () => { await vi.advanceTimersByTimeAsync(FOLD_TOTAL) })

    await act(async () => { exitMiniWindow() })
    // The shell stays folded while the reverse animation starts; neither it nor the
    // chat content is remounted for the mini → app transition.
    expect(useWindowMiniModeStore.getState()).toMatchObject({ phase: 'unfolding', panelsFolded: true })
    expect(restore).not.toHaveBeenCalled()
    await waitFor(() => expect(restore).toHaveBeenCalled())
    expect(screen.getByTestId('full-app')).toBe(app)
    expect(screen.getByTestId('chat-content')).toBe(chat)
    // Still rendered shut while the tracker opens them against the growing window.
    expect(useWindowMiniModeStore.getState().panelsFolded).toBe(true)

    await act(async () => { await vi.advanceTimersByTimeAsync(FOLD_TOTAL) })
    expect(useWindowMiniModeStore.getState()).toMatchObject({ phase: 'app', panelsFolded: false })
  })

  it('lands in mini phase without replacing the app when a reload finds a converted window', async () => {
    stubWindowApp(MODE)
    render(<RootApp />)
    await waitFor(() => expect(useWindowMiniModeStore.getState().phase).toBe('mini'))
    expect(screen.getByTestId('full-app')).toBeInTheDocument()
    expect(screen.queryByTestId('mini-app')).not.toBeInTheDocument()
  })

  it('unfolds when main reports the window grew back on its own', async () => {
    render(<RootApp />)
    await act(async () => { enterMiniWindow(MODE) })
    await act(async () => { await vi.advanceTimersByTimeAsync(FOLD_TOTAL) })

    await act(async () => { push?.(null) })
    await waitFor(() => expect(screen.getByTestId('full-app')).toBeInTheDocument())
  })
})
