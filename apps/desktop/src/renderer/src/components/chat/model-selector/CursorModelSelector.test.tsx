/** @vitest-environment jsdom */

/**
 * Regression: a fresh install that enabled Cursor without an API key gets a
 * model catalog whose params carry no `values`. `defaultCursorModelParams`
 * then yields `{}`, so the seed effect's own guard
 * (`Object.keys(cursorModelParams).length > 0`) never becomes true — the effect
 * depends on the value it writes, so each empty write re-arms it. React bails
 * with error #185 (Maximum update depth exceeded) and blanks the window.
 *
 * Same shape as the ClaudeModelSelector storm fixed in 5754040a.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

vi.mock('./GroupedModelEffortSelector', () => ({
  GroupedModelEffortSelector: () => <div data-testid="model-selector" />,
}))

import { CursorModelSelector } from './CursorModelSelector'
import { useChatStore } from '@/stores/chat'

/** Catalog shape produced when the Cursor key is missing: params, but no values. */
const DEGRADED_MODEL = {
  id: 'cursor-composer',
  name: 'Composer',
  parameters: [
    { id: 'optimize_for', values: [] },
    { id: 'thinking', values: [] },
  ],
}

/** Catalog shape a configured user gets — every param has a usable value. */
const HEALTHY_MODEL = {
  id: 'cursor-composer',
  name: 'Composer',
  parameters: [{ id: 'optimize_for', values: [{ value: 'balanced' }] }],
}

let paramWrites: Record<string, string>[] = []
const realSetCursorModelParams = useChatStore.getState().setCursorModelParams

function seedStore(model: unknown): void {
  useChatStore.setState({
    harnessResources: {
      claude: null,
      codex: null,
      acp: null,
      opencode: null,
      cursor: { models: [model] } as never,
    },
  })
  useChatStore.getState().ensureSession('/白屏')
  useChatStore.setState({ activeProject: '/白屏' })
  useChatStore.getState().setSelectedModel('cursor-composer')

  // Count every seed write without changing behaviour. Always wrap the pristine
  // action — re-wrapping the previous test's wrapper would nest them and count
  // one call twice.
  useChatStore.setState({
    setCursorModelParams: (params: Record<string, string>) => {
      paramWrites.push(params)
      realSetCursorModelParams(params)
    },
  })
}

beforeEach(() => {
  paramWrites = []
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Let every queued microtask + timer settle — a storm needs turns to build. */
async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('CursorModelSelector seeding defaults from a degraded catalog', () => {
  it('writes the empty default map at most once instead of re-arming forever', async () => {
    seedStore(DEGRADED_MODEL)

    render(<CursorModelSelector />)
    await settle()

    expect(paramWrites.length).toBeLessThanOrEqual(1)
  })

  it('seeds once when the catalog is healthy', async () => {
    seedStore(HEALTHY_MODEL)

    render(<CursorModelSelector />)
    await settle()

    expect(paramWrites).toEqual([{ optimize_for: 'balanced' }])
  })
})
