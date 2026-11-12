import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { EditorSettingsSection } from './EditorSettingsSection'

mockIpc('app', 'saveAppSettings', async (...args: unknown[]) => {
  const patch = (args[0] ?? {}) as {
    editorVimMode?: boolean
    editorRelativeLineNumbers?: boolean
  }
  if (typeof patch.editorVimMode === 'boolean') {
    useAppStore.setState({ editorVimMode: patch.editorVimMode })
  }
  if (typeof patch.editorRelativeLineNumbers === 'boolean') {
    useAppStore.setState({ editorRelativeLineNumbers: patch.editorRelativeLineNumbers })
  }
  return {
    editorVimMode: useAppStore.getState().editorVimMode,
    editorRelativeLineNumbers: useAppStore.getState().editorRelativeLineNumbers,
  }
})

function seed(enabled: boolean) {
  return (Story: () => ReactElement) => {
    useAppStore.setState({
      editorVimMode: enabled,
      editorRelativeLineNumbers: enabled,
    })
    return <Story />
  }
}

const meta: Meta<typeof EditorSettingsSection> = {
  title: 'Settings/EditorSettingsSection',
  component: EditorSettingsSection,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof EditorSettingsSection>

export const Disabled: Story = {
  decorators: [seed(false)],
}

export const Enabled: Story = {
  decorators: [seed(true)],
}

export const NarrowLayout: Story = {
  decorators: [
    seed(true),
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
}
