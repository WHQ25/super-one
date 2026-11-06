import { useLayoutEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { AutomationDialog } from './AutomationDialog'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'
import { focusEnvironments, focusLocal, focusRemote } from './sidebar/project-focus.fixtures'

const submitted = fn()
function FormPreview({ remote = false, offline = false, failure = false, saving = false }: { remote?: boolean; offline?: boolean; failure?: boolean; saving?: boolean }) {
  const [open, setOpen] = useState(true)
  const [savedOn, setSavedOn] = useState('')
  const environments = focusEnvironments.map((bucket) => offline && bucket.kind !== 'local' ? { ...bucket, connection: 'offline' as const } : bucket)
  useLayoutEffect(() => {
    submitted.mockClear()
    const previous = useMultiHostSidebarStore.getState().environments
    useMultiHostSidebarStore.setState({ environments })
    mockIpc('environment', 'callAutomation', async (connectionId, method, input) => {
      if (method === 'automation.list') return { automations: [] }
      submitted(connectionId, method, input)
      if (saving) return new Promise(() => {})
      if (failure) throw new Error('Could not reach Build server. Reconnect and try again.')
      setSavedOn(String(connectionId))
      return { automation: { ...(input as object), id: 'storybook-automation' } }
    })
    return () => useMultiHostSidebarStore.setState({ environments: previous })
  }, [offline, failure, saving])
  return <>
    <AutomationDialog open={open} onOpenChange={setOpen} editAutomation={null} projectPath={focusLocal.pathKey}
      initialEnvironmentId={remote ? focusRemote.environmentId : undefined} environments={environments} />
    {savedOn && <div role="status">Saved on {savedOn}</div>}
  </>
}
const meta = { title: 'Automation/AutomationDialog', component: FormPreview, parameters: { layout: 'centered' } } satisfies Meta<typeof FormPreview>
export default meta
type Story = StoryObj<typeof meta>

async function fillForm(body: ReturnType<typeof within>) {
  await userEvent.type(body.getByRole('textbox', { name: /Name|名称/ }), 'Daily review')
  await userEvent.type(body.getByRole('textbox', { name: /Prompt|提示词/ }), 'Review recent changes and report any regressions.')
}
export const Local: Story = { render: () => <FormPreview /> }
export const RemotePreselected: Story = {
  render: () => <FormPreview remote />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('combobox', { name: 'Execution Environment' })).toHaveTextContent('Build server')
    await expect(body.getByText(focusRemote.hostPath)).toBeVisible()
    await expect(await body.findByText('Schedule')).toBeVisible()
  },
}
export const RemoteDark: Story = { ...RemotePreselected, globals: { theme: 'dark' } }
export const Chinese: Story = { render: () => <FormPreview remote />, globals: { locale: 'zh' } }
export const ChangeEnvironment: Story = {
  render: () => <FormPreview />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await fillForm(body)
    await userEvent.click(body.getByRole('combobox', { name: 'Execution Environment' }))
    await userEvent.click(body.getByRole('option', { name: 'Build server' }))
    await expect(body.getByText(focusRemote.hostPath)).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'Create' }))
    await expect(submitted).toHaveBeenCalledWith('node-1', 'automation.create', expect.objectContaining({ projectId: focusRemote.projectId, name: 'Daily review' }))
    await expect(body.getByRole('status')).toHaveTextContent('Saved on node-1')
  },
}
export const Offline: Story = { render: () => <FormPreview remote offline /> }
export const SaveError: Story = {
  render: () => <FormPreview remote failure />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await fillForm(body)
    await userEvent.click(body.getByRole('button', { name: 'Create' }))
    await expect(body.getByRole('alert')).toHaveTextContent('Could not reach Build server')
    await expect(body.getByRole('textbox', { name: 'Name' })).toHaveValue('Daily review')
  },
}
export const Saving: Story = {
  render: () => <FormPreview remote saving />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await fillForm(body)
    await userEvent.click(body.getByRole('button', { name: 'Create' }))
    await expect(body.getByRole('button', { name: 'Loading...' })).toBeDisabled()
  },
}
