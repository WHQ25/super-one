import type { Meta, StoryObj } from '@storybook/react-vite'
import type { IosSimulatorChrome, IosSimulatorChromeButton } from '@superone/shared/ios-simulator'
import { IosSimulatorDeviceChrome } from './IosSimulatorDeviceChrome'

// Apple's artwork is read from the local Xcode at runtime and never bundled, so these
// stories draw stand-ins with the same geometry the loader hands over.
const svg = (width: number, height: number, body: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${body}</svg>`,
  )}`
const fill = (color: string) => svg(1, 1, `<rect width="1" height="1" fill="${color}"/>`)
const roundedMask = (width: number, height: number, radius: { left: number; right: number }) =>
  svg(width, height, `<path fill="black" d="M${radius.left} 0H${width - radius.right}A${radius.right} ${radius.right} 0 0 1 ${width} ${radius.right}V${height - radius.right}A${radius.right} ${radius.right} 0 0 1 ${width - radius.right} ${height}H${radius.left}A${radius.left} ${radius.left} 0 0 1 0 ${height - radius.left}V${radius.left}A${radius.left} ${radius.left} 0 0 1 ${radius.left} 0Z"/>`)

const button = (overrides: Partial<IosSimulatorChromeButton> & Pick<IosSimulatorChromeButton, 'name' | 'anchor' | 'offset'>): IosSimulatorChromeButton => ({
  title: overrides.name,
  hoverOffset: { ...overrides.offset, across: overrides.offset.across - 5 },
  width: overrides.anchor === 'top' || overrides.anchor === 'bottom' ? 64 : 16,
  height: overrides.anchor === 'top' || overrides.anchor === 'bottom' ? 16 : 64,
  image: fill('#3f3f46'),
  pressedImage: fill('#18181b'),
  ...overrides,
})

// phone11 geometry (iPhone 17 Pro): a nine-slice body.
const NINE_SLICE: IosSimulatorChrome = {
  identifier: 'com.apple.dt.devicekit.chrome.phone11',
  slices: {
    topLeft: svg(110, 110, '<path d="M110 0A110 110 0 0 0 0 110V110H18V110A92 92 0 0 1 110 18Z" fill="#27272a"/>'),
    top: fill('#27272a'),
    topRight: svg(110, 110, '<path d="M0 0A110 110 0 0 1 110 110H92A92 92 0 0 0 0 18Z" fill="#27272a"/>'),
    right: svg(110, 1, '<rect x="92" width="18" height="1" fill="#27272a"/>'),
    bottomRight: svg(110, 110, '<path d="M0 110A110 110 0 0 0 110 0H92A92 92 0 0 1 0 92Z" fill="#27272a"/>'),
    bottom: svg(1, 110, '<rect y="92" width="1" height="18" fill="#27272a"/>'),
    bottomLeft: svg(110, 110, '<path d="M110 110A110 110 0 0 1 0 0H18A92 92 0 0 0 110 92Z" fill="#27272a"/>'),
    left: svg(110, 1, '<rect width="18" height="1" fill="#27272a"/>'),
  },
  corner: 110,
  screenMask: roundedMask(402, 874, { left: 62, right: 62 }),
  width: 438,
  height: 910,
  padding: { top: 0, left: 13, bottom: 0, right: 13 },
  screen: { x: 18, y: 18, width: 402, height: 874 },
  buttons: [
    button({ name: 'volume-up', title: 'Volume Up', anchor: 'left', offset: { across: 8, along: 260 }, input: 'volume-up' }),
    button({ name: 'power', title: 'Power', anchor: 'right', offset: { across: 8, along: 290 }, input: 'lock' }),
  ],
}

// phone15 geometry (iPhone Duo cover screen): placeholder slices, so one composite
// body with the hinge on the left and volume buttons on the top edge.
const COMPOSITE: IosSimulatorChrome = {
  identifier: 'com.apple.dt.devicekit.chrome.phone15',
  composite: svg(514, 706, '<path d="M4 0H434A80 80 0 0 1 514 80V626A80 80 0 0 1 434 706H4A4 4 0 0 1 0 702V4A4 4 0 0 1 4 0Z" fill="#27272a"/>'),
  screenMask: roundedMask(466, 678, { left: 8, right: 59 }),
  width: 514,
  height: 706,
  padding: { top: 14, left: 9, bottom: 0, right: 9 },
  screen: { x: 26, y: 14, width: 466, height: 678 },
  buttons: [
    button({ name: 'volume-up', title: 'Volume Up', anchor: 'top', offset: { across: 7, along: 316 }, input: 'volume-up' }),
    button({ name: 'volume-down', title: 'Volume Down', anchor: 'top', offset: { across: 7, along: 236 }, input: 'volume-down' }),
    button({ name: 'power', title: 'Sleep/Wake', anchor: 'right', offset: { across: 15, along: 202 }, input: 'lock' }),
  ],
}

const meta = {
  title: 'Device/IosSimulatorDeviceChrome',
  component: IosSimulatorDeviceChrome,
  args: { chrome: NINE_SLICE, children: null },
  render: (args) => (
    <div className="flex h-[560px] w-[720px] max-w-full items-center justify-center bg-background p-4 [container-type:size]">
      <IosSimulatorDeviceChrome {...args}>
        <div className="h-full w-full bg-gradient-to-br from-blue-700 to-purple-600" />
      </IosSimulatorDeviceChrome>
    </div>
  ),
} satisfies Meta<typeof IosSimulatorDeviceChrome>

export default meta
type Story = StoryObj<typeof meta>

export const NineSliceBody: Story = {}

export const CompositeBody: Story = { args: { chrome: COMPOSITE } }

export const NarrowPanel: Story = {
  args: { chrome: COMPOSITE },
  render: (args) => (
    <div className="flex h-[360px] w-[200px] items-center justify-center bg-background [container-type:size]">
      <IosSimulatorDeviceChrome {...args}>
        <div className="h-full w-full bg-gradient-to-br from-blue-700 to-purple-600" />
      </IosSimulatorDeviceChrome>
    </div>
  ),
}
