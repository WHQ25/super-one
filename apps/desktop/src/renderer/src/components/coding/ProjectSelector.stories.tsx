import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { useAppStore } from '@/stores/app'
import { ProjectSelector } from './ProjectSelector'

const meta: Meta<typeof ProjectSelector> = {
  title: 'Coding/ProjectSelector',
  component: ProjectSelector,
  parameters: { layout: 'centered' },
  beforeEach: () => {
    const previous = useAppStore.getState()
    const environment = window.environment
    const getAppSettings = window.app.getAppSettings
    useAppStore.setState({
      selectedHostConnectionId: 'local',
      currentFolder: '/demo/project',
      recentFolders: [{ id: 'demo', path: '/demo/project', name: 'Demo Project', addedAt: '', lastOpened: '' }],
      selectProject: async () => {},
      fetchRecentFolders: async () => {},
    })
    window.app.getAppSettings = async () => ({ defaultClonePaths: {} }) as Awaited<ReturnType<typeof getAppSettings>>
    window.environment = {
      ...environment,
      browsePath: async () => ({ path: '/demo', entries: [{ name: 'project', path: '/demo/project', type: 'directory' }] }),
      openProject: async () => ({ projectId: 'demo', path: '/demo/project', name: 'Demo Project' }),
    }
    return () => {
      useAppStore.setState(previous)
      window.environment = environment
      window.app.getAppSettings = getAppSettings
    }
  },
}
export default meta
type Story = StoryObj<typeof ProjectSelector>
export const AddProject: Story = {}
export const Compact: Story = { args: { compact: true } }
export const Empty: Story = {
  beforeEach: () => { useAppStore.setState({ currentFolder: null, recentFolders: [] }) },
}
export const Dark: Story = { decorators: [(Story) => <div className="dark bg-background p-6"><Story /></div>] }

const manyFolders = Array.from({ length: 16 }, (_, index) => ({
  id: `project-${index}`,
  path: `/demo/project-${index}`,
  name: `Project ${index}`,
  addedAt: '',
  lastOpened: '',
}))

/** A long menu fades the project rows. Add Project stays pinned under the list. */
export const ManyProjects: Story = {
  beforeEach: () => {
    useAppStore.setState({
      currentFolder: '/demo/project-0',
      recentFolders: manyFolders,
    })
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Project 0/ }))
    const scroller = document.querySelector('[data-slot="dropdown-menu-content"] [data-slot="scroll-area-viewport"]')
    await expect(scroller).not.toBeNull()
    await expect(scroller).toHaveClass('scroll-edge-fade-y')
    await expect(scroller?.closest('[data-slot="scroll-area"]')).toHaveClass('max-h-48')
    const add = within(document.body).getByRole('menuitem', { name: 'Add Project...' })
    await expect(scroller!.contains(add)).toBe(false)
  },
}

export const ManyProjectsDark: Story = {
  ...ManyProjects,
  globals: { theme: 'dark' },
}
