import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { DeviceEnvironmentAction } from '@superone/shared/device-environment'
import { iosSimulatorFoldAt, iosSimulatorFoldForm, type IosSimulatorFoldPosition } from '@superone/shared/ios-simulator'
import { DeviceHingeControl } from './DeviceHingeControl'

/** Moves the way the host does: a short sweep, then the new angle comes back as state. */
function Scenario({ initial, fail = false, disabled = false }: { initial: number; fail?: boolean; disabled?: boolean }) {
  const [fold, setFold] = useState<IosSimulatorFoldPosition>(iosSimulatorFoldAt(initial)!)
  const [preview, setPreview] = useState<number | null>(null)
  const [formPreview, setFormPreview] = useState<number | null>(null)
  return <div className="flex min-h-48 flex-col items-center justify-end gap-2 p-4">
    <div className="rounded-xl border bg-card px-2 py-1.5">
      <DeviceHingeControl
        deviceId="ios-sim:duo"
        fold={fold}
        disabled={disabled}
        onPreview={setPreview}
        onFormPreview={setFormPreview}
        configure={async (deviceId, action: DeviceEnvironmentAction) => {
          await new Promise((resolve) => setTimeout(resolve, 600))
          if (fail) throw new Error('The guest refused the fold (70): SpringBoard is busy.')
          if (action.kind === 'hinge') setFold(iosSimulatorFoldAt(action.degrees)!)
          return { status: 'verified', deviceId, action, state: {} as never }
        }}
      />
    </div>
    <p className="text-xs text-muted-foreground">
      3D body: {preview ?? fold.hingeDegrees}°, as {iosSimulatorFoldForm(formPreview ?? fold.hingeDegrees)}
    </p>
  </div>
}

const meta = {
  title: 'Device/Hinge Control',
  component: DeviceHingeControl,
  args: { deviceId: 'ios-sim:duo', fold: { hingeDegrees: 0, tent: false, laptop: false }, disabled: false, onPreview: () => {}, onFormPreview: () => {} },
} satisfies Meta<typeof DeviceHingeControl>
export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = { render: () => <Scenario initial={0} /> }
export const Tent: Story = { render: () => <Scenario initial={45} /> }
export const HalfOpened: Story = { render: () => <Scenario initial={75} /> }
export const Opened: Story = { render: () => <Scenario initial={180} /> }
export const Laptop: Story = { render: () => <Scenario initial={90} /> }
export const Disabled: Story = { render: () => <Scenario initial={0} disabled /> }
export const MoveRefused: Story = { render: () => <Scenario initial={0} fail /> }
