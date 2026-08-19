/** @vitest-environment jsdom */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeepseekPresetRoster } from '@superone/shared/agent-types'
import { DeepseekPresetSelector } from './DeepseekPresetSelector'

const hoisted = vi.hoisted(() => ({
  setDshPreset: vi.fn(),
  session: { _providerSessionId: null as string | null, dshPreset: null as string | null },
}))

vi.mock('@/stores/chat', () => ({
  useActiveSession: (selector: (s: typeof hoisted.session) => unknown) => selector(hoisted.session),
  useChatStore: (selector: (s: { setDshPreset: unknown }) => unknown) =>
    selector({ setDshPreset: hoisted.setDshPreset }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const ROSTER: DeepseekPresetRoster = {
  presets: [
    { id: 'standard', name: '标准模式', description: '功能完整的编码 Agent', trust: 'system', order: 1, broken: null },
    { id: 'minimal', name: '极简模式', description: '双工具编码 Agent', trust: 'system', order: 3, broken: null },
    { id: 'broken-one', name: 'broken-one', description: null, trust: 'user', order: null, broken: 'composition is unparsable' },
  ],
  current: null,
  switchable: true,
}

const listPresets = vi.fn<() => Promise<DeepseekPresetRoster>>()
const setPreset = vi.fn<() => Promise<{ ok: boolean }>>()
const setSessionSettings = vi.fn()

beforeEach(() => {
  hoisted.setDshPreset.mockReset()
  hoisted.session._providerSessionId = null
  hoisted.session.dshPreset = null
  listPresets.mockReset().mockResolvedValue(ROSTER)
  setPreset.mockReset().mockResolvedValue({ ok: true })
  Object.assign(window, {
    app: { listDeepseekPresets: listPresets, setDeepseekPreset: setPreset },
    agent: { setSessionSettings },
  })
})

describe('DeepseekPresetSelector', () => {
  it('shows every preset with its description, and a broken one with its reason', async () => {
    render(<DeepseekPresetSelector />)
    await userEvent.click(await screen.findByRole('button'))

    // Scoped to the menu: the selected preset's name also labels the trigger.
    const menu = within(screen.getByRole('menu'))
    expect(menu.getByText('标准模式')).toBeInTheDocument()
    expect(menu.getByText('双工具编码 Agent')).toBeInTheDocument()
    // A broken preset stays listed: hiding it would leave its directory
    // occupying the id with nothing on screen to delete.
    expect(menu.getByText('composition is unparsable')).toBeInTheDocument()
  })

  it('records a pick as a draft when the session has no agent yet', async () => {
    render(<DeepseekPresetSelector />)
    await userEvent.click(await screen.findByRole('button'))
    await userEvent.click(screen.getByText('极简模式'))

    expect(hoisted.setDshPreset).toHaveBeenCalledWith('minimal')
    // No live composition to re-link, so nothing is switched — the next
    // creation reads the draft instead.
    expect(setPreset).not.toHaveBeenCalled()
  })

  it('recomposes a live blank session instead of drafting', async () => {
    hoisted.session._providerSessionId = 'dsh-1'
    listPresets.mockResolvedValue({ ...ROSTER, current: 'standard' })
    render(<DeepseekPresetSelector />)
    await userEvent.click(await screen.findByRole('button'))
    await userEvent.click(screen.getByText('极简模式'))

    expect(setPreset).toHaveBeenCalledWith('dsh-1', 'minimal')
  })

  it('goes read-only once the session has run a turn', async () => {
    hoisted.session._providerSessionId = 'dsh-1'
    listPresets.mockResolvedValue({ ...ROSTER, current: 'standard', switchable: false })
    render(<DeepseekPresetSelector />)

    // Swapping the catalog now would strand tool calls already in the log, so
    // the control shows the composition and refuses to change it.
    const trigger = await screen.findByRole('button')
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveTextContent('标准模式')
  })
})
