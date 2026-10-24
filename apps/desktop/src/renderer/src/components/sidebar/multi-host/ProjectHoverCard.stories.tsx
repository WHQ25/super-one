import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { projectHoverFolders } from '@/lib/multi-host/project-hover'
import { ProjectHoverBody, ProjectHoverCard } from './ProjectHoverCard'
import { SessionHoverCardTrigger } from './SessionHoverCard'

const folders = projectHoverFolders('/Users/a/src/super-one', ['/Users/a/src/super-one/packages/ui'])

const meta = {
  title: 'Sidebar/ProjectHoverCard',
  component: ProjectHoverCard,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ProjectHoverCard>

export default meta
type Story = StoryObj<typeof meta>

function Frame({ children, width = 288 }: { children: ReactNode; width?: number }) {
  return (
    <div className="bg-popover p-3 text-popover-foreground" style={{ width }}>
      {children}
    </div>
  )
}

export const GitHub: Story = {
  args: { name: 'super-one', children: null },
  render: () => (
    <Frame>
      <ProjectHoverBody
        name="super-one"
        repoIdentity="git:git@github.com:acme/super-one.git"
        folders={folders}
        sessionCount={12}
        sessionPaths={[]}
        onEdit={() => {}}
      />
    </Frame>
  ),
}

export const OtherRemote: Story = {
  name: 'Git host that is not GitHub',
  args: { name: 'super-one', children: null },
  render: () => (
    <Frame>
      <ProjectHoverBody
        name="super-one"
        repoIdentity="git:https://gitlab.com/acme/super-one.git"
        folders={projectHoverFolders('/srv/super-one')}
        sessionCount={1}
        sessionPaths={[]}
        onEdit={() => {}}
      />
    </Frame>
  ),
}

export const NoRemote: Story = {
  name: 'Folder with no git origin',
  args: { name: 'notes', children: null },
  render: () => (
    <Frame>
      <ProjectHoverBody
        name="notes"
        repoIdentity={null}
        folders={projectHoverFolders('/Users/a/notes')}
        sessionCount={0}
        sessionPaths={[]}
        onEdit={() => {}}
      />
    </Frame>
  ),
}

export const LongFolders: Story = {
  name: 'Several folders with a long path',
  args: { name: 'super-one', children: null },
  render: () => (
    <Frame width={220}>
      <ProjectHoverBody
        name="super-one-with-a-very-long-project-name"
        repoIdentity="git:https://github.com/acme/super-one.git"
        folders={projectHoverFolders('/Users/a/src/super-one', [
          '/Users/a/src/super-one/packages/ui',
          '/Users/a/work/checkout/packages/desktop/src/renderer',
        ])}
        sessionCount={128}
        sessionPaths={[]}
        onEdit={() => {}}
      />
    </Frame>
  ),
}

export const Anchored: Story = {
  name: 'Opens 4px to the right of the row',
  args: { name: 'super-one', children: null },
  render: () => (
    <div className="w-64 bg-sidebar p-2 text-sidebar-foreground">
      <ProjectHoverCard
        open
        name="super-one"
        repoIdentity="git:https://github.com/acme/super-one.git"
        folders={folders}
        sessionCount={4}
        sessionPaths={[]}
        onEdit={() => {}}
      >
        <SessionHoverCardTrigger>
          <div className="flex h-9 items-center rounded-md px-2.5 text-sm">super-one</div>
        </SessionHoverCardTrigger>
      </ProjectHoverCard>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const card = await body.findByText('acme/super-one')
    expect(card.closest('[data-slot="hover-card-content"]')?.getAttribute('data-side')).toBe('right')
    expect(card.closest('[data-slot="hover-card-content"]')?.getAttribute('data-align')).toBe('start')
  },
}

export const Edit: Story = {
  args: { name: 'super-one', children: null },
  render: () => (
    <Frame>
      <ProjectHoverBody
        name="super-one"
        repoIdentity="git:https://github.com/acme/super-one.git"
        folders={folders}
        sessionCount={2}
        sessionPaths={[]}
        onEdit={() => {
          const marker = document.createElement('div')
          marker.dataset.projectEdited = 'true'
          document.body.append(marker)
        }}
      />
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Edit Project' }))
    expect(document.querySelector('[data-project-edited]')).not.toBeNull()
  },
}
