/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomationDialog } from './AutomationDialog'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'
import { focusEnvironments, focusLocal, focusRemote } from './sidebar/project-focus.fixtures'

const callAutomation = vi.fn(async (_connection: string, _method: string, input: unknown) => ({ automation: { ...(input as object), id: 'created' } }))
const onOpenChange = vi.fn()
function fill() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Review changes' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'Review recent changes' } })
}
function renderForm(extra: Partial<React.ComponentProps<typeof AutomationDialog>> = {}) {
  return render(<AutomationDialog open onOpenChange={onOpenChange} editAutomation={null} projectPath={focusLocal.pathKey} {...extra} />)
}
beforeEach(() => {
  useMultiHostSidebarStore.setState({ environments: focusEnvironments })
  callAutomation.mockReset().mockImplementation(async (_connection, _method, input) => ({ automation: { ...(input as object), id: 'created' } }))
  Object.assign(window.environment, { callAutomation })
  onOpenChange.mockClear()
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => useMultiHostSidebarStore.setState({ environments: [] }))

describe('automation execution environment', () => {
  it('preselects a host action’s environment and creates on that host’s matching project', async () => {
    renderForm({ initialEnvironmentId: focusRemote.environmentId })
    expect(screen.getByRole('combobox', { name: 'Execution Environment' })).toHaveTextContent('Build server')
    expect(screen.getByText(focusRemote.hostPath)).toBeInTheDocument()
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(callAutomation).toHaveBeenCalledWith('node-1', 'automation.create', expect.objectContaining({
      projectId: focusRemote.projectId, name: 'Review changes', prompt: 'Review recent changes',
    })))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('allows changing the execution host before creating and keeps forks out', async () => {
    renderForm()
    const select = screen.getByRole('combobox', { name: 'Execution Environment' })
    expect(select).toHaveTextContent('This computer')
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Build server' }))
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(callAutomation).toHaveBeenCalledWith('node-1', 'automation.create', expect.objectContaining({ projectId: focusRemote.projectId })))
  })

  it('keeps form values and an error after save fails, then retries on the same environment', async () => {
    callAutomation.mockRejectedValueOnce(new Error('Node disconnected'))
    renderForm({ initialEnvironmentId: focusRemote.environmentId })
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Node disconnected')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Review changes')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(callAutomation).toHaveBeenCalledTimes(2)
  })

  it('blocks creation if the preselected environment disconnects while the form is open', () => {
    renderForm({ initialEnvironmentId: focusRemote.environmentId })
    fill()
    act(() => useMultiHostSidebarStore.setState({ environments: focusEnvironments.map((bucket) => bucket.kind === 'local' ? bucket : { ...bucket, connection: 'offline' }) }))
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    expect(callAutomation).not.toHaveBeenCalled()
  })
})
