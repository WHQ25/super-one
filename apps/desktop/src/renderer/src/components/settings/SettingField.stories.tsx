import type { Meta, StoryObj } from '@storybook/react-vite'
import { SettingField } from './SettingField'

const meta: Meta<typeof SettingField> = {
  title: 'Settings/SettingField',
  component: SettingField,
  parameters: { layout: 'padded' },
  args: {
    onChange: (value) => console.log('change', value),
  },
}

export default meta
type Story = StoryObj<typeof SettingField>

export const Boolean: Story = {
  args: {
    field: { key: 'liquidGlass', label: 'Liquid Glass', type: 'boolean' },
    value: true,
  },
}

export const Enum: Story = {
  args: {
    field: {
      key: 'defaultEffort',
      label: 'Default Effort',
      type: 'enum',
      enumValues: ['low', 'medium', 'high', 'xhigh', 'max'],
      clearable: true,
    },
    value: 'high',
  },
}

export const Number: Story = {
  args: {
    field: { key: 'terminalFontSize', label: 'Terminal Font Size', type: 'number', min: 12, max: 22 },
    value: 14,
  },
}

export const StringField: Story = {
  args: {
    field: { key: 'uiFontFamily', label: 'UI Font', type: 'string', clearable: true },
    value: 'Inter',
  },
}

export const Json: Story = {
  args: {
    field: { key: 'schedule', label: 'Schedule', type: 'json' },
    value: JSON.stringify({ type: 'recurring', preset: 'daily', timeOfDay: '09:00' }, null, 2),
  },
}

export const CompactRow: Story = {
  render: () => (
    <div className="flex flex-col divide-y divide-border/60 rounded border border-border/60 bg-muted/20">
      <div className="flex items-center justify-between gap-3 px-2.5 py-2">
        <span className="text-[11px] font-medium text-foreground">Analytics</span>
        <SettingField
          field={{ key: 'analyticsEnabled', label: 'Analytics', type: 'boolean' }}
          value={false}
          onChange={(v) => console.log('change', v)}
          size="compact"
        />
      </div>
      <div className="flex items-center justify-between gap-3 px-2.5 py-2">
        <span className="text-[11px] font-medium text-foreground">Update Channel</span>
        <SettingField
          field={{ key: 'updateChannel', label: 'Update Channel', type: 'enum', enumValues: ['alpha', 'beta', 'stable'], clearable: true }}
          value="beta"
          onChange={(v) => console.log('change', v)}
          size="compact"
        />
      </div>
    </div>
  ),
}
