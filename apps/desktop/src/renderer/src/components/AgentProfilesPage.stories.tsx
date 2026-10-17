import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within, waitFor } from 'storybook/test'
import { AgentProfilesPage } from './AgentProfilesPage'
import { profileManagementFixture } from './agent-profiles/agent-profile-management.test-fixtures'

const meta: Meta<typeof AgentProfilesPage> = {
  title: 'Settings/AgentProfilesPage', component: AgentProfilesPage, parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="min-h-[800px] bg-background text-foreground"><Story /></div>],
}
export default meta
type Story = StoryObj<typeof AgentProfilesPage>

function Preview({ state }: { state?: 'empty' | 'loading' | 'error' | 'unavailable' | 'review' }) {
  const [{ api, details }] = useState(profileManagementFixture)
  const [previewApi] = useState(() => {
    if (state === 'empty') details.clear()
    if (state === 'unavailable') for (const profile of details.values()) profile.available = false
    if (state === 'review') details.get('reviewer')!.approved = false
    return { ...api, ...(state === 'loading' ? { list: () => new Promise<never>(() => {}) } : state === 'error' ? { list: async () => { throw new Error('Unable to load Profiles. Please try again.') } } : {}) }
  })
  return <AgentProfilesPage api={previewApi} />
}

export const DefaultProfiles: Story = { render: () => <Preview /> }
export const SavedProfile: Story = { render: () => <Preview />, play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Reviewer' }))
  await expect(within(canvasElement).findByText('Preserve all existing files.', { exact: false })).resolves.toBeInTheDocument()
} }
export const ReadOnlyCodex: Story = { render: () => <Preview />, play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Codex' }))
  await expect(within(canvasElement).findByText('Read-Only')).resolves.toBeInTheDocument()
} }
export const Loading: Story = { render: () => <Preview state="loading" /> }
export const Empty: Story = { render: () => <Preview state="empty" /> }
export const LoadError: Story = { render: () => <Preview state="error" /> }
export const HarnessUnavailable: Story = { render: () => <Preview state="unavailable" /> }
export const NeedsReview: Story = { render: () => <Preview state="review" />, play: SavedProfile.play }
export const NarrowChinese: Story = { globals: { locale: 'zh', theme: 'dark' }, render: () => <div className="max-w-[560px]"><Preview /></div> }
export const EditLongInstructions: Story = { render: () => <Preview />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await userEvent.click(await canvas.findByRole('button', { name: 'Reviewer' }))
  await userEvent.click(await canvas.findByRole('button', { name: 'Edit' }))
  await userEvent.type(await within(document.body).findByLabelText('Instructions'), '\nIf a test is missing, explain the unverified boundary before making a claim.'.repeat(8))
} }
export const CreateAndDelete: Story = { render: () => <Preview />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  const body = within(document.body)
  const create = await canvas.findByRole('button', { name: 'New Profile' })
  await waitFor(() => expect(create).toBeEnabled())
  await userEvent.click(create)
  await userEvent.type(await body.findByLabelText('Name'), 'Implementer')
  await userEvent.type(body.getByLabelText('Description'), 'Implement scoped changes.')
  await userEvent.click(body.getByRole('button', { name: 'Save & Approve Collaboration' }))
  await userEvent.click(await canvas.findByRole('button', { name: 'Delete' }))
  await userEvent.click(within(await body.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
  await expect(canvas.queryByRole('button', { name: 'Implementer' })).not.toBeInTheDocument()
  canvasElement.dataset.profileCrudVerified = 'true'
} }
