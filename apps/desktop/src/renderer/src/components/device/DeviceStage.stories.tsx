import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { DeviceDescriptor } from '@superone/shared/device'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { writeDeviceView3d } from './device-3d'
import { DeviceStage } from './DeviceStage'

function simulator(model: string): DeviceDescriptor {
  return {
    id: `ios-sim:${model}`,
    provider: 'ios-sim',
    platform: 'ios',
    name: model,
    kind: 'iphone',
    kindName: 'iPhone',
    kindRank: 0,
    model,
    platformVersion: 'iOS 26.5',
    versionRank: 26005,
    running: false,
    available: true,
  }
}

const WITH_BODY = simulator('iPhone 17 Pro')

/** A panel with nothing bound yet: the header and its view switch, over a device not yet started. */
const devicePanel = (view3d: boolean): Decorator => (Story) => {
  writeDeviceView3d(view3d)
  mockIpc('app', 'listDeviceModels', async () => [WITH_BODY.model])
  ;(window as unknown as { environment: unknown }).environment = {
    iosSimulatorChrome: async () => null,
    onDeviceState: () => () => {},
    onDeviceFrame: () => () => {},
    onDeviceRotateGesture: () => () => {},
    deviceInput: async () => ({ ok: true }),
    openDeviceStream: () => {},
    closeDeviceStream: () => {},
  }
  return <Story />
}

const meta = {
  title: 'Device/DeviceStage',
  component: DeviceStage,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="h-[640px] w-[420px] border-r bg-background"><Story /></div>],
  args: {
    sessionId: 'story',
    devices: [WITH_BODY],
    device: WITH_BODY,
    sessionState: null,
    busy: false,
    checking: false,
    launching: false,
    onSelectDevice: () => {},
    onLaunchDevice: () => {},
    onDetach: () => {},
    onTerminate: () => {},
  },
} satisfies Meta<typeof DeviceStage>
export default meta
type Story = StoryObj<typeof meta>

/** The 2D | 3D switch sits beside the device name when this machine has the model's body. */
export const FlatSelected: Story = { decorators: [devicePanel(false)] }
export const ThreeDSelected: Story = { decorators: [devicePanel(true)] }
/** No 3D body for this model on this machine: no switch at all, not a disabled one. */
export const NoModel: Story = {
  args: { devices: [simulator('iPhone SE 3rd generation')], device: simulator('iPhone SE 3rd generation') },
  decorators: [devicePanel(false)],
}
export const Narrow: Story = {
  decorators: [devicePanel(false), (Story) => <div className="h-full w-[260px]"><Story /></div>],
}
