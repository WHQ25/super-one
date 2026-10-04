/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ModelOption } from '@superone/shared/agent-types'

const { error } = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error, success: vi.fn() } }))

import { acpContextWindowParam } from './AcpContextWindowSelect'
import { AcpModelSelector } from './AcpModelSelector'
import { useChatStore } from '@/stores/chat'

const PROJECT = '/ctx'
const setSessionSettings = vi.fn<(...args: unknown[]) => Promise<void>>()

const GROK: ModelOption = {
  id: 'grok-4.7',
  name: 'Grok 4.7',
  description: 'Flagship',
  contextWindow: 256_000,
  contextWindows: [256_000, 500_000],
}
const GROK_FAST: ModelOption = {
  id: 'grok-4.7-fast',
  name: 'Grok 4.7 Fast',
  description: 'Faster',
  contextWindow: 256_000,
  contextWindows: [256_000, 500_000],
}
const SINGLE: ModelOption = {
  id: 'grok-4',
  name: 'Grok 4',
  description: 'One window',
  contextWindows: [128_000],
}

function seed(models: ModelOption[], selected = models[0]?.id ?? ''): void {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    harnessResources: { claude: null, codex: null, acp: null, opencode: null, cursor: null, dsh: null },
  })
  useChatStore.getState().ensureSession(PROJECT)
  useChatStore.setState({ activeProject: PROJECT })
  const state = useChatStore.getState()
  const project = state.projectSessions[PROJECT]!
  const sessionId = project._activeSessionId!
  useChatStore.setState({
    projectSessions: {
      ...state.projectSessions,
      [PROJECT]: {
        ...project,
        _sessions: {
          ...project._sessions,
          [sessionId]: {
            ...project._sessions[sessionId]!,
            preferredProvider: 'acp',
            sessionProvider: 'acp',
            acpAgentId: 'grok-build',
            acpModelsStatus: 'ready',
            acpModels: models,
            acpModes: [
              { id: 'low', name: 'Low', description: '' },
              { id: 'high', name: 'High', description: '' },
            ],
            acpModeConfigId: 'reasoning_effort',
            selectedAcpModeId: 'high',
            selectedModel: selected,
          },
        },
      },
    },
  })
}

function checked(name: string): boolean {
  const item = screen.getByRole('menuitem', { name })
  return item.querySelector('.lucide-check') != null
}

/** Radix hides the trigger from the a11y tree while the menu is open. */
function trigger(): HTMLElement {
  const node = document.querySelector('[data-slot="dropdown-menu-trigger"]')
  if (!(node instanceof HTMLElement)) throw new Error('missing model trigger')
  return node
}

function pickedWindow(): number | null {
  const project = useChatStore.getState().projectSessions[PROJECT]
  const sessionId = project?._activeSessionId
  if (!project || !sessionId) return null
  return project._sessions[sessionId]?.selectedAcpContextWindow ?? null
}

beforeEach(() => {
  error.mockClear()
  setSessionSettings.mockReset().mockResolvedValue(undefined)
  Object.assign(window.agent, { setSessionSettings })
})

afterEach(() => {
  cleanup()
})

describe('acp context window param', () => {
  it('hides the rows unless more than one positive window is listed', () => {
    expect(acpContextWindowParam([128_000], null, null, 'Context window')).toBeNull()
    expect(acpContextWindowParam([0, 128_000], null, 128_000, 'Context window')).toBeNull()
    expect(acpContextWindowParam(undefined, null, null, 'Context window')).toBeNull()
  })

  it('checks the current listed window and offers only those sizes', () => {
    const param = acpContextWindowParam([256_000, 500_000, 1_500_000], null, 500_000, 'Context window')
    expect(param?.selected).toBe('500000')
    expect(param?.values.map((value) => value.label)).toEqual(['256K', '500K', '1.5M'])
    expect(acpContextWindowParam([256_000, 500_000], 256_000, 500_000, 'Context window')?.selected).toBe('256000')
    expect(acpContextWindowParam([256_000, 500_000], null, 128_000, 'Context window')?.selected).toBe('256000')
  })
})

describe('ACP context window inside the model menu', () => {
  it('lists the windows under the model and sends the picked count', async () => {
    const user = userEvent.setup()
    seed([GROK, GROK_FAST])
    render(<AcpModelSelector />)

    expect(document.querySelector('select')).toBeNull()
    expect(trigger()).toHaveTextContent('High')
    expect(trigger()).not.toHaveTextContent('256K')

    await user.click(trigger())
    expect(screen.getByText('Context window')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Keep current' })).toBeNull()
    expect(checked('256K')).toBe(true)
    expect(checked('500K')).toBe(false)

    await user.click(screen.getByRole('menuitem', { name: '256K' }))
    expect(setSessionSettings).not.toHaveBeenCalled()

    await user.click(screen.getByRole('menuitem', { name: '500K' }))

    expect(setSessionSettings).toHaveBeenCalledWith(PROJECT, { contextWindow: 500_000 }, undefined)
    await waitFor(() => expect(pickedWindow()).toBe(500_000))
    expect(trigger()).toHaveTextContent('High')
    expect(trigger()).not.toHaveTextContent('500K')
    expect(checked('500K')).toBe(true)
    expect(checked('256K')).toBe(false)

    await user.keyboard('{Escape}')
    await user.click(trigger())
    expect(checked('500K')).toBe(true)
    expect(screen.getByText('Context window')).toBeInTheDocument()
    expect(trigger()).not.toHaveTextContent('500K')
  })

  it('puts the check back on the current window when the agent rejects the pick', async () => {
    const user = userEvent.setup()
    setSessionSettings.mockRejectedValueOnce(new Error('invalid_params'))
    seed([GROK])
    render(<AcpModelSelector />)

    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: '500K' }))

    await waitFor(() => expect(checked('256K')).toBe(true))
    expect(checked('500K')).toBe(false)
    expect(pickedWindow()).toBeNull()
    expect(error).toHaveBeenCalled()
    expect(trigger()).not.toHaveTextContent('500K')
  })

  it('clears a pick when the model changes and hides the section for a single window', async () => {
    const user = userEvent.setup()
    seed([GROK, SINGLE])
    render(<AcpModelSelector />)

    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: '500K' }))
    await waitFor(() => expect(pickedWindow()).toBe(500_000))

    await user.click(screen.getByRole('button', { name: /Flagship/ }))
    await user.click(screen.getByRole('menuitem', { name: /One window/ }))

    await waitFor(() => expect(screen.queryByText('Context window')).not.toBeInTheDocument())
    expect(document.querySelector('select')).toBeNull()
    expect(trigger().textContent).toContain('Grok 4')
    expect(trigger().textContent).not.toContain('Grok 4.7')
    expect(trigger().textContent).toContain('High')
    expect(trigger().textContent).not.toContain('256K')
    expect(pickedWindow()).toBeNull()
  })

  it('keeps the pick when the same model is chosen again', async () => {
    const user = userEvent.setup()
    seed([GROK, GROK_FAST])
    render(<AcpModelSelector />)

    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: '500K' }))
    await waitFor(() => expect(pickedWindow()).toBe(500_000))

    await user.click(screen.getByRole('button', { name: /Flagship/ }))
    await user.click(screen.getByRole('menuitem', { name: /Flagship/ }))

    expect(pickedWindow()).toBe(500_000)
    expect(screen.getByText('Context window')).toBeInTheDocument()
    expect(checked('500K')).toBe(true)
  })
})
