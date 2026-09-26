import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { DeviceEnvironmentAction, DeviceEnvironmentState } from '@superone/shared/device-environment'
import { ANDROID_FONT_SCALES, IOS_CONTENT_SIZES } from '@superone/shared/device-environment'
import { DeviceEnvironmentControls } from './DeviceEnvironmentControls'

const ios: DeviceEnvironmentState = {
  deviceId: 'ios-sim:story', appearance: 'light', locationReadable: false,
  textSize: 'large', textSizeSupported: true,
  textSizeOptions: [...IOS_CONTENT_SIZES],
  canClearLocation: true, postures: [], posture: null,
}
const android: DeviceEnvironmentState = {
  deviceId: 'android:avd:Pixel_Fold', appearance: 'dark', locationReadable: false,
  textSize: '1.3', textSizeSupported: true,
  textSizeOptions: [...ANDROID_FONT_SCALES],
  canClearLocation: false,
  postures: [{ id: 1, label: 'closed' }, { id: 2, label: 'half opened' }, { id: 3, label: 'opened' }],
  posture: null,
}

function Scenario({ initial, fail = false }: { initial: DeviceEnvironmentState; fail?: boolean }) {
  const [state, setState] = useState(initial)
  return <div className="flex min-h-[36rem] items-end justify-end p-4">
    <DeviceEnvironmentControls
      deviceId={initial.deviceId}
      provider={initial.deviceId.startsWith('ios') ? 'ios-sim' : 'android'}
      disabled={false}
      read={async () => state}
      configure={async (_deviceId, action: DeviceEnvironmentAction) => {
        if (fail) throw new Error('The simulator rejected this setting.')
        const next = action.kind === 'appearance' ? { ...state, appearance: action.value }
          : action.kind === 'text_size' ? { ...state, textSize: action.value }
          : state
        setState(next)
        return { status: 'applied', deviceId: initial.deviceId, action, state: next }
      }}
      subscribe={() => () => {}}
    />
  </div>
}

const meta = {
  title: 'Device/Environment Controls',
  component: DeviceEnvironmentControls,
  args: { deviceId: ios.deviceId, provider: 'ios-sim', disabled: false },
} satisfies Meta<typeof DeviceEnvironmentControls>
export default meta
type Story = StoryObj<typeof meta>

export const IosSimulator: Story = { render: () => <Scenario initial={ios} /> }
export const AndroidFoldable: Story = { render: () => <Scenario initial={android} /> }
export const CommandError: Story = { render: () => <Scenario initial={ios} fail /> }
export const Narrow: Story = { render: () => <div className="w-56"><Scenario initial={android} /></div> }
