import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import {
  ANDROID_PHONE_REFERENCE_MODEL, type DeviceDescriptor, type DeviceFrame, type DeviceState,
} from '@superone/shared/device'
import type { IosSimulatorChrome, IosSimulatorFoldState } from '@superone/shared/ios-simulator'
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
const ANDROID_PHONE: DeviceDescriptor = {
  ...WITH_BODY,
  id: 'android:avd:Medium_Phone', provider: 'android', platform: 'android',
  name: 'Medium Phone', model: 'Medium Phone', kind: 'phone', kindName: 'Android Phone',
  platformVersion: 'Android 16',
}

const DUO: DeviceDescriptor = { ...simulator('iPhone Duo'), platformVersion: 'iOS 27.1', running: true }

const svg = (width: number, height: number, body: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${body}</svg>`,
  )}`

// phone14 geometry (the Duo's inner panel), drawn in its portrait framebuffer: a
// composite body with the hinge across the middle, and volume buttons on the edge
// that is the top of the opened device. Apple's artwork is never bundled.
const DUO_INNER_CHROME: IosSimulatorChrome = {
  identifier: 'com.apple.dt.devicekit.chrome.phone14',
  composite: svg(660, 924, '<rect width="660" height="924" rx="64" fill="#27272a"/><rect y="461" width="17" height="2" fill="#71717a"/><rect x="643" y="461" width="17" height="2" fill="#71717a"/>'),
  screenMask: svg(626, 890, '<rect width="626" height="890" rx="48" fill="black"/>'),
  width: 660,
  height: 924,
  padding: { top: 10, left: 10, bottom: 10, right: 10 },
  screen: { x: 17, y: 17, width: 626, height: 890 },
  buttons: [114, 188].map((along, index) => ({
    name: index ? 'volume-down' : 'volume-up',
    title: index ? 'Volume Down' : 'Volume Up',
    anchor: 'left' as const,
    offset: { across: 8, along },
    hoverOffset: { across: 5, along },
    width: 16,
    height: 63,
    image: svg(16, 63, '<rect width="16" height="15" rx="3" fill="#3f3f46"/>'),
    input: index ? 'volume-down' as const : 'volume-up' as const,
  })),
}

/** A portrait framebuffer holding the opened device's landscape picture, turned. */
async function innerPanelFrame(deviceId: string): Promise<DeviceFrame> {
  const canvas = new OffscreenCanvas(669, 951)
  const context = canvas.getContext('2d')!
  const gradient = context.createLinearGradient(0, 0, 669, 951)
  gradient.addColorStop(0, '#dbeafe')
  gradient.addColorStop(1, '#fce7f3')
  context.fillStyle = gradient
  context.fillRect(0, 0, 669, 951)
  context.translate(669 / 2, 951 / 2)
  context.rotate(-Math.PI / 2)
  context.fillStyle = '#18181b'
  context.font = '600 40px system-ui'
  context.textAlign = 'center'
  context.fillText('Inner panel, opened', 0, 12)
  const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
  return {
    deviceId, sequence: 1, timestampMs: 0, mimeType: 'image/png', keyframe: true,
    codecConfig: false, data: png,
  }
}

const foldedState = (fold: IosSimulatorFoldState, orientation: DeviceState['orientation'] = 'portrait'): DeviceState => ({
  deviceId: DUO.id, owner: 'story', device: DUO, phase: 'ready', interactive: true,
  orientation, pixelWidth: 2007, pixelHeight: 2853,
  ios: { previewMode: 'native-h264', hardwareKeyboardConnected: true, hardwareKeyboardAvailable: true, fold },
})

/** A panel with nothing bound yet: the header and its view switch, over a device not yet started. */
const devicePanel = (view3d: boolean, chrome: IosSimulatorChrome | null = null): Decorator => (Story) => {
  writeDeviceView3d(view3d)
  mockIpc('app', 'listDeviceModels', async () => [WITH_BODY.model, ANDROID_PHONE_REFERENCE_MODEL])
  ;(window as unknown as { environment: unknown }).environment = {
    iosSimulatorChrome: async () => chrome,
    onDeviceState: () => () => {},
    onDeviceFrame: (deviceId: string, listener: (frame: DeviceFrame) => void) => {
      if (chrome) void innerPanelFrame(deviceId).then(listener)
      return () => {}
    },
    onDeviceRotateGesture: () => () => {},
    deviceInput: async () => ({ ok: true }),
    deviceEnvironment: async () => { throw new Error('Settings need a live simulator.') },
    onDeviceEnvironmentChanged: () => () => {},
    deviceConfigure: async () => { throw new Error('Folding needs a live simulator.') },
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
/** Ordinary Android AVDs share the local Pixel 10 Pro reference shell. */
export const AndroidPhone: Story = {
  args: { devices: [ANDROID_PHONE], device: ANDROID_PHONE },
  decorators: [devicePanel(false)],
}
/** No 3D body for this model on this machine: no switch at all, not a disabled one. */
export const NoModel: Story = {
  args: { devices: [simulator('iPhone SE 3rd generation')], device: simulator('iPhone SE 3rd generation') },
  decorators: [devicePanel(false)],
}
/**
 * An opened iPhone Duo: the inner panel's portrait framebuffer and chrome, turned a
 * quarter clockwise so the device lies landscape with its buttons on top, as live.
 */
export const FoldOpened: Story = {
  args: {
    devices: [DUO], device: DUO,
    sessionState: foldedState({ hingeDegrees: 180, tent: false, panel: 'inner', panelRotation: 90 }),
  },
  decorators: [devicePanel(false, DUO_INNER_CHROME)],
}
/**
 * Standing as a tent: half open, the cover lit, and turned a quarter clockwise so the
 * hinge is on top. The toolbar presses the cover screen.
 */
export const FoldTent: Story = {
  args: {
    devices: [DUO], device: DUO,
    sessionState: foldedState({ hingeDegrees: 60, tent: true, panel: 'cover', panelRotation: 0 }, 'landscape-right'),
  },
  decorators: [devicePanel(false)],
}
export const Narrow: Story = {
  decorators: [devicePanel(false), (Story) => <div className="h-full w-[260px]"><Story /></div>],
}
