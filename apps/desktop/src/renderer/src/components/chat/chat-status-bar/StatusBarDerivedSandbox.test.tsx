/** @vitest-environment jsdom */

/**
 * Every harness shows a sandbox chip. Claude and Cursor own a real toggle; the
 * rest get read-only state — derived from the permission setting for Codex and
 * dsh (whose presets bundle a sandbox mode), observed over IPC for Grok (which
 * has a real sandbox SuperOne does not drive), and plain `off` for OpenCode,
 * which has no sandbox mechanism. These tests pin that the chip is display-only,
 * moves in lockstep with the permission setting, and reports Grok's real state
 * rather than assuming it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { CodexPermissionPreset, PermissionMode } from '@superone/shared/agent-types'
import { StatusBarSandbox } from './StatusBarSandbox'
import { useChatStore, type ChatProvider } from '@/stores/chat'

const PROJECT = '/tmp/derived-sandbox-chip'

function renderChip(activeProvider: ChatProvider) {
  return render(
    <StatusBarSandbox activeProvider={activeProvider} compactIndicators={false} showDivider={false} />,
  )
}

/**
 * vitest.setup installs `window.app` as a Proxy whose get trap returns a noop for
 * every key, ignoring its target — so assigning a single method is silently
 * discarded. Replace the whole object, keeping the catch-all for the members this
 * component's tree reads incidentally.
 */
function stubAcpSandbox(info: { enabled: boolean; autoAllowBash: boolean } | Error): void {
  const acpGetSandbox = vi.fn(() =>
    info instanceof Error ? Promise.reject(info) : Promise.resolve(info),
  )
  const noop = () => Promise.resolve(undefined)
  const stub = { acpGetSandbox } as Record<string, unknown>
  window.app = new Proxy(stub, {
    get: (target, prop) => (prop in target ? target[prop as string] : noop),
  }) as unknown as typeof window.app
}

beforeEach(() => {
  useChatStore.getState().ensureSession(PROJECT)
  useChatStore.setState({ activeProject: PROJECT })
  stubAcpSandbox({ enabled: false, autoAllowBash: false })
})

afterEach(() => {
  cleanup()
})

describe('Codex derived sandbox chip', () => {
  function setPreset(preset: CodexPermissionPreset): void {
    act(() => {
      useChatStore.getState().setSelectedCodexPermissionPreset(preset)
    })
  }

  it.each([
    ['read-only', 'Sandbox'],
    ['default', 'Sandbox'],
    ['auto-review', 'Sandbox'],
    ['full-access', 'Sandbox Off'],
  ] as Array<[CodexPermissionPreset, string]>)('shows preset %s as "%s"', (preset, label) => {
    setPreset(preset)
    renderChip('codex')
    expect(screen.getByLabelText(label)).toBeInTheDocument()
  })

  it('follows the preset when it changes mid-session', () => {
    setPreset('default')
    renderChip('codex')
    expect(screen.getByLabelText('Sandbox')).toBeInTheDocument()

    setPreset('full-access')
    expect(screen.getByLabelText('Sandbox Off')).toBeInTheDocument()
    expect(screen.queryByLabelText('Sandbox')).not.toBeInTheDocument()
  })
})

describe('dsh derived sandbox chip', () => {
  // setPermissionMode round-trips through IPC before it writes, so this must be
  // awaited — a sync act() asserts against the previous mode.
  async function setMode(mode: PermissionMode): Promise<void> {
    await act(async () => {
      await useChatStore.getState().setPermissionMode(mode)
    })
  }

  it.each([
    ['plan', 'Sandbox'],
    ['default', 'Sandbox'],
    // Not offered in dsh's picker; both fall back to workspace-write, so still confined.
    ['acceptEdits', 'Sandbox'],
    ['dontAsk', 'Sandbox'],
    ['bypassPermissions', 'Sandbox Off'],
  ] as Array<[PermissionMode, string]>)('shows mode %s as "%s"', async (mode, label) => {
    await setMode(mode)
    renderChip('dsh')
    expect(screen.getByLabelText(label)).toBeInTheDocument()
  })

  it('follows the permission mode when it changes mid-session', async () => {
    await setMode('default')
    renderChip('dsh')
    expect(screen.getByLabelText('Sandbox')).toBeInTheDocument()

    await setMode('bypassPermissions')
    expect(screen.getByLabelText('Sandbox Off')).toBeInTheDocument()
  })
})

describe('the chip as a whole', () => {
  it('renders no interactive control — the permission setting is the only way to change it', () => {
    const { container } = renderChip('codex')
    expect(container.querySelector('button')).toBeNull()
  })

  // OpenCode has no sandbox mechanism (no CLI flag, no Landlock/Seatbelt/seccomp
  // in its binary), so this is a standing answer, not an observation.
  it('reports off for opencode, which has no sandbox mechanism', () => {
    renderChip('opencode')
    expect(screen.getByLabelText('Sandbox Off')).toBeInTheDocument()
  })
})

describe('Grok observed sandbox', () => {
  it('reports off when Grok has no profile configured', async () => {
    stubAcpSandbox({ enabled: false, autoAllowBash: false })
    renderChip('acp')
    await waitFor(() => expect(screen.getByLabelText('Sandbox Off')).toBeInTheDocument())
  })

  // The regression this whole path exists for: Grok confined while the chip said off.
  it('reports on when Grok actually applied a profile', async () => {
    stubAcpSandbox({ enabled: true, autoAllowBash: false })
    renderChip('acp')
    await waitFor(() => expect(screen.getByLabelText('Sandbox')).toBeInTheDocument())
  })

  it('reports auto when the profile also auto-allows bash', async () => {
    stubAcpSandbox({ enabled: true, autoAllowBash: true })
    renderChip('acp')
    await waitFor(() => expect(screen.getByLabelText('Sandbox Auto')).toBeInTheDocument())
  })

  it('falls back to off when the observation fails', async () => {
    stubAcpSandbox(new Error('ipc down'))
    renderChip('acp')
    await waitFor(() => expect(screen.getByLabelText('Sandbox Off')).toBeInTheDocument())
  })
})
