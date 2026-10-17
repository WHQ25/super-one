/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentProfilesPage } from './AgentProfilesPage'
import { profileManagementFixture } from './agent-profiles/agent-profile-management.test-fixtures'
import { useAppStore } from '@/stores/app'

afterEach(cleanup)

describe('Agent Profile settings UI', () => {
  it('shows dynamic defaults read-only and opens the matching harness settings', async () => {
    const { api } = profileManagementFixture()
    render(<AgentProfilesPage api={api} />)
    await screen.findByText('Effective Configuration')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }))
    await screen.findByText('Read-Only')
    fireEvent.click(screen.getByRole('button', { name: 'Configure Defaults' }))
    expect(useAppStore.getState()).toMatchObject({ settingsTab: 'harnesses', harnessListFocusKey: 'codex', harnessConfigSection: 'preferences' })
  })

  it('creates a Profile only after the user saves the displayed configuration', async () => {
    const { api } = profileManagementFixture()
    const save = vi.spyOn(api, 'save')
    render(<AgentProfilesPage api={api} />)
    await screen.findByText('Effective Configuration')
    fireEvent.click(screen.getByRole('button', { name: 'New Profile' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('Name'), { target: { value: 'Implementer' } })
    fireEvent.change(dialog.getByLabelText('Description'), { target: { value: 'Implement scoped tasks.' } })
    fireEvent.change(dialog.getByLabelText('Instructions'), { target: { value: 'Preserve unrelated files.' } })
    expect(dialog.getByText(/Allow future collaboration/)).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(dialog.getByRole('button', { name: 'Save & Approve Collaboration' }))
    await screen.findByRole('button', { name: 'Implementer' })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'claude-base', version: 'version-claude-base', reviewToken: 'review-claude-base', draft: expect.objectContaining({ instructions: 'Preserve unrelated files.' }) }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('preserves edited input when a stale review is rejected by the host', async () => {
    const { api, details } = profileManagementFixture()
    const save = vi.spyOn(api, 'save').mockRejectedValueOnce(new Error('Profile or launch defaults changed. Reload the Profile and review it again.'))
    render(<AgentProfilesPage api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reviewer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('Instructions'), { target: { value: 'Updated review instructions.' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save & Approve Collaboration' }))
    await dialog.findByText(/Profile or launch defaults changed/)
    expect(dialog.getByLabelText('Instructions')).toHaveValue('Updated review instructions.')
    details.get('reviewer')!.reviewToken = 'refreshed-review'
    fireEvent.click(dialog.getByRole('button', { name: 'Refresh Configuration' }))
    await waitFor(() => expect(dialog.queryByText(/Profile or launch defaults changed/)).not.toBeInTheDocument())
    fireEvent.click(dialog.getByRole('button', { name: 'Save & Approve Collaboration' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ reviewToken: 'refreshed-review', draft: expect.objectContaining({ instructions: 'Updated review instructions.' }) }))
  })

  it('deletes only after confirmation and removes the saved Profile from the list', async () => {
    const { api } = profileManagementFixture()
    const remove = vi.spyOn(api, 'delete')
    render(<AgentProfilesPage api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reviewer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(remove).not.toHaveBeenCalled()
    expect(dialog.getByText(/Existing sessions are kept/)).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reviewer' })).not.toBeInTheDocument())
    expect(remove).toHaveBeenCalledWith({ id: 'reviewer', version: 'version-claude-base' })
  })

  it('recovers from a load failure through Retry', async () => {
    const { api } = profileManagementFixture()
    vi.spyOn(api, 'list').mockRejectedValueOnce(new Error('Unable to load Profiles.'))
    render(<AgentProfilesPage api={api} />)
    await screen.findByText('Unable to load Profiles.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('button', { name: 'Reviewer' })
  })

  it('refreshes changed defaults on focus without removing the current list', async () => {
    const { api, details } = profileManagementFixture()
    render(<AgentProfilesPage api={api} />)
    await screen.findByText('Effective Configuration')
    details.get('claude-base')!.agent.defaultConfig.model = 'updated-default-model'
    fireEvent(window, new Event('focus'))
    expect(screen.getByRole('button', { name: 'Reviewer' })).toBeInTheDocument()
    await screen.findByText('updated-default-model')
  })

  it('ignores an older detail response after the user selects another Profile', async () => {
    const { api, details } = profileManagementFixture()
    let finish!: (detail: NonNullable<ReturnType<typeof details.get>>) => void
    const get = api.get
    vi.spyOn(api, 'get').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockImplementation(get)
    render(<AgentProfilesPage api={api} />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('claude-base'))
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }))
    await screen.findByText('Read-Only')
    await act(async () => finish(details.get('claude-base')!))
    expect(screen.getByText('Read-Only')).toBeInTheDocument()
  })
})
