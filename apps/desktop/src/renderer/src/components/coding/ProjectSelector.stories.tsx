import type { Meta, StoryObj } from '@storybook/react-vite'
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
