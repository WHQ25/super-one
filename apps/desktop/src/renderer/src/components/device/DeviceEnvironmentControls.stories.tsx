import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { DeviceEnvironmentAction, DeviceEnvironmentState } from '@superone/shared/device-environment'
import { ANDROID_FONT_SCALES, IOS_CONTENT_SIZES } from '@superone/shared/device-environment'
import { DeviceEnvironmentControls } from './DeviceEnvironmentControls'

const ios: DeviceEnvironmentState = {
  deviceId: 'ios-sim:story', appearance: 'light', locationReadable: false,
  textSize: 'large', textSizeSupported: true,
  textSizeOptions: [...IOS_CONTENT_SIZES],
  canClearLocation: true, postures: [], posture: null, hingeDegrees: null,
}
const iosFoldable: DeviceEnvironmentState = {
  ...ios,
  deviceId: 'ios-sim:duo',
  postures: [{ id: 1, label: 'closed' }, { id: 2, label: 'half opened' }, { id: 3, label: 'opened' }],
  posture: 2,
  hingeDegrees: 75,
}
const android: DeviceEnvironmentState = {
  deviceId: 'android:avd:Pixel_Fold', appearance: 'dark', locationReadable: false,
  textSize: '1.3', textSizeSupported: true,
  textSizeOptions: [...ANDROID_FONT_SCALES],
  canClearLocation: false,
  postures: [{ id: 1, label: 'closed' }, { id: 2, label: 'half opened' }, { id: 3, label: 'opened' }],
  posture: null,
  hingeDegrees: null,
}

function Scenario({ initial, fail = false, finishes }: { initial: DeviceEnvironmentState; fail?: boolean; finishes?: string[] }) {
  const [state, setState] = useState(initial)
  const [finish, setFinish] = useState(finishes?.[0])
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
      bodyColor={finishes && finish ? { options: finishes, value: finish, onChange: setFinish } : undefined}
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
/** A foldable that takes any angle: its hinge is the toolbar's, so none shows here. */
export const IosFoldable: Story = { render: () => <Scenario initial={iosFoldable} /> }
export const AndroidFoldable: Story = { render: () => <Scenario initial={android} /> }
/** In the 3D view, a body whose scene ships several finishes: the Duo's two, an iPhone 18 Pro's four. */
export const BodyColor: Story = { render: () => <Scenario initial={iosFoldable} finishes={['Light', 'Dark']} /> }
export const BodyColorMany: Story = {
  render: () => <Scenario initial={ios} finishes={['Black', 'Burgundy', 'Glacier', 'Silver']} />,
}
export const CommandError: Story = { render: () => <Scenario initial={ios} fail /> }
export const Narrow: Story = { render: () => <div className="w-56"><Scenario initial={android} /></div> }
