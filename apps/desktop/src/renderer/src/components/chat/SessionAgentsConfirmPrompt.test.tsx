/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { SessionAgentRequestPayload } from '@superone/shared/agent-types'
import { SessionAgentsConfirmPrompt } from './SessionAgentsConfirmPrompt'

/** Shortcuts only fire while focus is inside [data-chat-root]. */
function renderInChat(ui: ReactElement) {
  const result = render(<div data-chat-root="" tabIndex={-1}>{ui}</div>)
  ;(result.container.querySelector('[data-chat-root]') as HTMLElement).focus()
  return result
}

function payload(): SessionAgentRequestPayload {
  return {
    profiles: [
      {
        id: 'claude-base',
        name: 'Claude',
        harnessId: 'claude',
        defaultConfig: { model: 'claude-sonnet', effort: 'high' },
        models: [{ id: 'claude-sonnet', name: 'Claude Sonnet' }],
        efforts: ['low', 'high'],
        apiProviders: [{ id: 'anthropic', name: 'Anthropic' }],
      },
      {
        id: 'codex-base',
        name: 'Codex',
        harnessId: 'codex',
        defaultConfig: { model: 'gpt-5.4', effort: 'medium' },
        models: [{ id: 'gpt-5.4', name: 'GPT5.4' }],
        efforts: ['medium', 'high'],
        apiProviders: [{ id: 'openai-key', name: 'OpenAI', brand: 'openai', keyName: 'codex2' }],
      },
    ],
    launches: [
      {
        launchId: 'review-tests',
        agentId: 'claude-base',
        task: 'Review the failing tests and report the root cause.',
        name: 'DiffBot',
        role: 'Reviewer',
        config: {
          cwd: '/Users/me/projects/super-one',
          model: 'claude-sonnet',
          effort: 'low',
          permissionMode: 'default',
          sandboxMode: 'on',
        },
      },
      {
        launchId: 'inspect-types',
        agentId: 'codex-base',
        task: 'Classify the current typecheck errors.',
        name: 'TypeBot',
        role: 'Analyst',
        config: {
          cwd: '/Users/me/projects/super-one',
          model: 'gpt-5.4',
          effort: 'high',
          permissionMode: 'plan',
          sandboxMode: 'off',
          worktree: { enabled: true, baseBranch: 'main', mode: 'branch', branchName: 'agent/types' },
        },
      },
    ],
  }
}

describe('session agents confirm prompt', () => {
  it('shows only the active agent and switches panels with Tab', () => {
    renderInChat(<SessionAgentsConfirmPrompt payload={payload()} onConfirm={vi.fn()} onReject={vi.fn()} />)

    expect(screen.getByText(/Review the failing tests/)).toBeInTheDocument()
    expect(screen.queryByText(/Classify the current typecheck errors/)).toBeNull()

    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByText(/Classify the current typecheck errors/)).toBeInTheDocument()
    expect(screen.queryByText(/Review the failing tests/)).toBeNull()
    // Shift+Tab walks back the other way.
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(screen.getByText(/Review the failing tests/)).toBeInTheDocument()
  })

  it('keeps agent-owned fields read-only while exposing the permission mode picker', () => {
    renderInChat(<SessionAgentsConfirmPrompt payload={payload()} onConfirm={vi.fn()} onReject={vi.fn()} />)

    // No editors for task / cwd / worktree / sandbox — those are the agent's decision.
    // The only text field on the prompt is the feedback box.
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByRole('textbox')).toHaveAttribute('data-feedback')
    expect(screen.queryByDisplayValue('/Users/me/projects/super-one')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    // Read-only context is still visible.
    expect(screen.getByText('super-one')).toBeInTheDocument()
    // Model/effort/provider and permission mode remain user-tunable.
    expect(screen.getByRole('button', { name: /Claude Sonnet/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Normal' })).toBeInTheDocument()
  })

  it('shows and confirms profile defaults when the requesting agent omits model and effort', () => {
    const value = payload()
    delete value.launches[0].config.model
    delete value.launches[0].config.effort
    const onConfirm = vi.fn()

    renderInChat(<SessionAgentsConfirmPrompt payload={value} onConfirm={onConfirm} onReject={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Claude Sonnet.*high/ })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm.mock.calls[0][0][0].config).toMatchObject({
      model: 'claude-sonnet',
      effort: 'high',
    })
  })

  it('offers the sandbox switch only to harnesses that honour one', () => {
    renderInChat(<SessionAgentsConfirmPrompt payload={payload()} onConfirm={vi.fn()} onReject={vi.fn()} />)

    // Claude implements sandbox modes, so its launch gets the same chip as the status bar.
    expect(screen.getByRole('button', { name: 'On' })).toBeInTheDocument()

    // Codex expresses isolation through its permission presets — no sandbox chip.
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.queryByRole('button', { name: /^(On|Off|Auto)$/ })).toBeNull()
  })

  it('uses profile display names for Codex models (not raw model ids)', () => {
    const value = payload()
    // Raw id would be `gpt-5.4`; the profile already carries the formatted label.
    value.profiles[1].models = [{ id: 'gpt-5.4', name: 'GPT5.4' }]
    value.launches[1].config.model = 'gpt-5.4'
    renderInChat(<SessionAgentsConfirmPrompt payload={value} onConfirm={vi.fn()} onReject={vi.fn()} />)

    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('button', { name: /GPT5\.4/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /gpt-5\.4/ })).toBeNull()
  })

  it('gives each agent the permission vocabulary of its own harness', () => {
    renderInChat(<SessionAgentsConfirmPrompt payload={payload()} onConfirm={vi.fn()} onReject={vi.fn()} />)

    // Claude tab: Claude's own mode names.
    expect(screen.getByRole('button', { name: 'Normal' })).toBeInTheDocument()

    // Codex tab: Codex sandbox presets. 'plan' has no Codex spelling, so it reads as the
    // preset a plain PermissionMode actually maps to on the codex backend.
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.queryByRole('button', { name: 'Normal' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Default' })).toBeInTheDocument()
  })

  it('describes the working location with the same wording as the chat status bar', () => {
    const withDetach = payload()
    withDetach.launches[0].config.worktree = { enabled: true, baseBranch: 'main', mode: 'detach' }
    const { unmount } = renderInChat(<SessionAgentsConfirmPrompt payload={withDetach} onConfirm={vi.fn()} onReject={vi.fn()} />)

    // detach → the status bar's "create from" phrasing; branch → its "create branch" phrasing.
    expect(screen.getByTitle('Create worktree from main')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByTitle('Create worktree branch agent/types')).toBeInTheDocument()
    unmount()

    // No worktree at all reads as plain "Local", exactly like the status bar.
    const noWorktree = payload()
    delete noWorktree.launches[1].config.worktree
    renderInChat(<SessionAgentsConfirmPrompt payload={noWorktree} onConfirm={vi.fn()} onReject={vi.fn()} />)
    expect(screen.getByTitle('Local')).toBeInTheDocument()
  })

  it('confirms every launch, carrying per-tab overrides and untouched agent config', () => {
    const onConfirm = vi.fn()
    renderInChat(<SessionAgentsConfirmPrompt payload={payload()} onConfirm={onConfirm} onReject={vi.fn()} />)

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    const launches = onConfirm.mock.calls[0][0]
    expect(launches).toHaveLength(2)
    expect(launches[1].config.worktree).toEqual({
      enabled: true,
      baseBranch: 'main',
      mode: 'branch',
      branchName: 'agent/types',
    })
    expect(launches[0].task).toBe('Review the failing tests and report the root cause.')
  })

  it('rejects on Escape', () => {
    const onReject = vi.fn()
    renderInChat(<SessionAgentsConfirmPrompt payload={payload()} onConfirm={vi.fn()} onReject={onReject} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it('hands the typed reason back on reject only — approving ignores it', () => {
    const onReject = vi.fn()
    const onConfirm = vi.fn()
    const { unmount } = renderInChat(<SessionAgentsConfirmPrompt payload={payload()} onConfirm={vi.fn()} onReject={onReject} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  too many agents  ' } })
    fireEvent.click(screen.getByRole('button', { name: /Reject/ }))
    expect(onReject).toHaveBeenCalledWith('too many agents')
    unmount()

    renderInChat(<SessionAgentsConfirmPrompt payload={payload()} onConfirm={onConfirm} onReject={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ignored on approve' } })
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    expect(onConfirm).toHaveBeenCalledWith(expect.any(Array))
  })

  it('submits a rejection when Enter is pressed inside the feedback box', () => {
    const onConfirm = vi.fn()
    const onReject = vi.fn()
    renderInChat(<SessionAgentsConfirmPrompt payload={payload()} onConfirm={onConfirm} onReject={onReject} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'not now' } })
    input.focus()
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(onReject).toHaveBeenCalledWith('not now')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('walks Tab past the last agent onto the feedback box', () => {
    renderInChat(<SessionAgentsConfirmPrompt payload={payload()} onConfirm={vi.fn()} onReject={vi.fn()} />)
    const input = screen.getByRole('textbox')

    fireEvent.keyDown(window, { key: 'Tab' })   // agent 1 → agent 2
    expect(document.activeElement).not.toBe(input)
    fireEvent.keyDown(window, { key: 'Tab' })   // past the last agent → feedback
    expect(document.activeElement).toBe(input)
  })
})
