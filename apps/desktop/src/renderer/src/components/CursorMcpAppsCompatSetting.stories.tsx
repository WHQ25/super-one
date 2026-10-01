import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { CursorMcpAppsCompatSetting } from './CursorMcpAppsCompatSetting'
import { SettingsSection } from './settings/SettingsSection'

function Preview({ enabled = false, disabled = false, width = 640 }: {
  enabled?: boolean
  disabled?: boolean
  width?: number
}) {
  const [checked, setChecked] = useState(enabled)
  return (
    <div className="bg-background p-5 text-foreground" style={{ width, maxWidth: '100%' }}>
      <SettingsSection>
        <CursorMcpAppsCompatSetting enabled={checked} disabled={disabled} onChange={setChecked} />
      </SettingsSection>
    </div>
  )
}

const meta = {
  title: 'Settings/Harnesses/Cursor/MCP Apps Compatibility',
  component: Preview,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>

export const Off: Story = { args: { enabled: false } }
export const On: Story = { args: { enabled: true } }
export const Saving: Story = { args: { enabled: true, disabled: true } }
export const Chinese: Story = { args: { enabled: false }, globals: { locale: 'zh' } }
export const Narrow: Story = { args: { enabled: false, width: 320 } }
export const ChineseNarrow: Story = { args: { enabled: true, width: 320 }, globals: { locale: 'zh' } }
export const Dark: Story = { args: { enabled: true }, globals: { theme: 'dark' } }
