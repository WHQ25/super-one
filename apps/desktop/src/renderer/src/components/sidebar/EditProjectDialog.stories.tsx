import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { RecentFolder } from '@superone/shared/agent-types'
import { EditProjectDialog } from './EditProjectDialog'

const project: RecentFolder = {
  id: 'p1',
  name: 'super-one',
  path: '/Users/a/src/super-one',
  addedAt: '2026-10-09T00:00:00.000Z',
  lastOpened: '2026-10-09T00:00:00.000Z',
  extraDirs: ['/Users/a/src/super-one/packages/ui'],
}

const meta = {
  title: 'Sidebar/EditProjectDialog',
  component: EditProjectDialog,
  parameters: { layout: 'centered' },
  args: {
    target: project,
    onClose: () => {},
    onSaved: () => {},
  },
} satisfies Meta<typeof EditProjectDialog>

export default meta
type Story = StoryObj<typeof meta>

export const WorkspaceFolders: Story = {
  name: 'Primary folder and an extra folder',
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const primary = await body.findByText('~/src/super-one')
    expect(primary.closest('div')?.parentElement?.textContent).toContain('Primary')
    expect(body.getByText('~/src/super-one/packages/ui')).toBeTruthy()
    expect(body.getAllByRole('button', { name: 'Remove Folder' })).toHaveLength(1)
    await userEvent.click(body.getByRole('button', { name: 'Remove Folder' }))
    expect(body.queryByText('~/src/super-one/packages/ui')).toBeNull()
    expect(body.getByText('~/src/super-one')).toBeTruthy()
    expect(body.getByText('Primary')).toBeTruthy()
  },
}

export const PrimaryOnly: Story = {
  name: 'Only the primary folder',
  args: { target: { ...project, extraDirs: [] } },
}

export const LongPath: Story = {
  name: 'Long primary path',
  args: {
    target: {
      ...project,
      path: '/Users/a/work/checkout/packages/desktop/src/renderer/components/sidebar',
      extraDirs: ['/Users/a/work/checkout/packages/desktop/src/renderer/components/sidebar/multi-host'],
    },
  },
}

export const Remote: Story = {
  name: 'Remote checkout',
  args: {
    target: {
      ...project,
      path: 'remote:cli-1:/srv/app',
      extraDirs: ['/srv/app/packages/ui'],
    },
  },
}
