import type { Meta, StoryObj } from '@storybook/react-vite'
import { WorkDirEnvironmentList, WorkDirEnvironmentMenu, type WorkDirEnvironmentMenuProps } from './WorkDirEnvironmentMenu'
import type { WorkDirEnvironmentOption } from './work-dir-environment'

const local: WorkDirEnvironmentOption = {
  environmentId: 'local-env',
  connectionId: 'local',
  label: 'This Mac',
  kind: 'current',
  needsUpgrade: false,
  hostKind: 'local',
}

const office: WorkDirEnvironmentOption = {
  environmentId: 'office',
  connectionId: 'office',
  label: 'Office',
  kind: 'selectable',
  needsUpgrade: false,
  hostKind: 'cli-node',
}

function options(extra: WorkDirEnvironmentOption[]): WorkDirEnvironmentOption[] {
  return [local, ...extra]
}

function Frame({ width = 320, picking = true, ...props }: WorkDirEnvironmentMenuProps & { width?: number }) {
  return (
    <div className="rounded-lg border bg-popover text-popover-foreground" style={{ width }}>
      <WorkDirEnvironmentMenu {...props} picking={picking} />
      {picking && !props.readOnly && (
        <WorkDirEnvironmentList options={props.options} onSelect={props.onSelect} onClone={props.onClone} />
      )}
    </div>
  )
}

const meta = {
  title: 'Chat/WorkDirEnvironmentMenu',
  component: WorkDirEnvironmentMenu,
  args: {
    visible: true,
    options: options([office]),
    selectedId: 'local-env',
    picking: true,
    onSelect: () => {},
    onClone: () => {},
  },
} satisfies Meta<typeof WorkDirEnvironmentMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Selectable: Story = {
  render: (args) => <Frame {...args} />,
}

export const NeedsUpgrade: Story = {
  render: (args) => (
    <Frame
      {...args}
      options={options([{ ...office, kind: 'needs-upgrade', needsUpgrade: true, label: 'Office' }])}
    />
  ),
}

export const CloneHere: Story = {
  render: (args) => (
    <Frame {...args} options={options([{ ...office, kind: 'clone-here', label: 'Office' }])} />
  ),
}

export const Offline: Story = {
  render: (args) => (
    <Frame {...args} options={options([{ ...office, kind: 'offline', label: 'Office' }])} />
  ),
}

export const NotAGitRepo: Story = {
  render: (args) => (
    <Frame {...args} options={options([{ ...office, kind: 'not-a-git-repo', label: 'Office' }])} />
  ),
}

export const ReadOnly: Story = {
  render: (args) => <Frame {...args} readOnly picking={false} />,
}

export const Loading: Story = {
  render: (args) => <Frame {...args} loading options={[]} picking={false} />,
}

export const ErrorState: Story = {
  render: (args) => <Frame {...args} error="Office did not answer." picking={false} />,
}

export const Empty: Story = {
  name: 'Only this machine',
  render: (args) => <Frame {...args} options={[local]} picking={false} />,
}

export const LongLabel: Story = {
  render: (args) => (
    <Frame
      {...args}
      options={options([{
        ...office,
        label: 'office-build-machine.corp.example.com — very long environment name',
      }])}
    />
  ),
}

export const Narrow: Story = {
  render: (args) => <Frame {...args} width={180} />,
}

export const Dark: Story = {
  globals: { theme: 'dark' },
  render: (args) => <Frame {...args} />,
}
