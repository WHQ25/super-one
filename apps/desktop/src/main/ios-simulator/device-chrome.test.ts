import { describe, expect, it, vi } from 'vitest'
import {
  IosSimulatorChromeLoader,
  chromeBundleName,
  chromePadding,
  deviceRect,
  isSafeChromeAssetName,
  parseChromeButtons,
  parseMediaBox,
} from './device-chrome'

describe('chromeBundleName', () => {
  it('takes the trailing component of the DeviceKit identifier', () => {
    expect(chromeBundleName('com.apple.dt.devicekit.chrome.phone11')).toBe('phone11')
  })

  it('refuses anything that could escape the chrome directory', () => {
    // The identifier comes out of a plist on disk, so it is untrusted input.
    expect(chromeBundleName('com.apple.chrome./../../etc/passwd')).toBeNull()
    expect(chromeBundleName('')).toBeNull()
  })
})

describe('parseMediaBox', () => {
  it('reads the artwork size in points', () => {
    const pdf = Buffer.from('%PDF-1.5\n/Type /Page /MediaBox [ 0 0 436 908 ]\n')

    expect(parseMediaBox(pdf)).toEqual({ width: 436, height: 908 })
  })

  it('finds the page box Apple writes near the END of the file', () => {
    // Real chrome artwork puts /MediaBox around byte 5600-7600. Reading only a
    // prefix made every device silently fall back to the drawn shell.
    const pdf = Buffer.concat([
      Buffer.alloc(6000, 0x20),
      Buffer.from('/MediaBox [0 0 474 990] /Count 1'),
    ])

    expect(parseMediaBox(pdf)).toEqual({ width: 474, height: 990 })
  })

  it('returns null when there is no usable page box', () => {
    expect(parseMediaBox(Buffer.from('%PDF-1.5\nno box here'))).toBeNull()
    expect(parseMediaBox(Buffer.from('/MediaBox [0 0 0 0]'))).toBeNull()
  })
})

describe('deviceRect', () => {
  it('reproduces the box Apple drew for an iPhone 16 to the point', () => {
    // phone9 ships a 429x888 composite around a 393x852 screen, and its sizing
    // reports an 18pt frame — the two agree exactly.
    const rect = deviceRect(
      { width: 393, height: 852 },
      { leftWidth: 18, rightWidth: 18, topHeight: 18, bottomHeight: 18 },
    )

    expect(rect.width).toBe(429)
    expect(rect.height).toBe(888)
    expect(rect.screen).toEqual({ x: 18, y: 18, width: 393, height: 852 })
  })

  it('frames each device on its own rather than on the one the composite was drawn for', () => {
    // The regression: one composite ships per chrome bundle, sized for a single
    // model. Centring an iPhone Air's 420x912 screen in the iPhone 17 Pro Max
    // composite gave it a 27pt bezel across and 39pt down — a visibly wrong device.
    const air = deviceRect(
      { width: 420, height: 912 },
      { leftWidth: 18, rightWidth: 18, topHeight: 18, bottomHeight: 18 },
    )

    expect(air.width).toBe(456)
    expect(air.height).toBe(948)
  })

  it('keeps an asymmetric frame asymmetric', () => {
    const rect = deviceRect(
      { width: 100, height: 100 },
      { leftWidth: 10, rightWidth: 30, topHeight: 5, bottomHeight: 40 },
    )

    expect(rect).toEqual({
      width: 140,
      height: 145,
      screen: { x: 10, y: 5, width: 100, height: 100 },
    })
  })
})

describe('parseChromeButtons', () => {
  const art = new Map([['Vol BTN', {
    size: { width: 16, height: 64 },
    image: 'data:image/png;base64,AA==',
    pressedImage: 'data:image/png;base64,BB==',
  }]])

  it('names the axes Apple leaves implicit in its x/y pair', () => {
    const [button] = parseChromeButtons({
      inputs: [{
        name: 'volume-up',
        accessibilityTitle: 'Volume Up',
        type: 'button',
        image: 'Vol BTN',
        anchor: 'left',
        offsets: { normal: { x: 8, y: 221 }, rollover: { x: 3, y: 221 } },
      }],
    }, art)

    expect(button).toEqual({
      name: 'volume-up',
      title: 'Volume Up',
      anchor: 'left',
      // On a side button x is how far it pokes out and y is how far down it sits.
      offset: { across: 8, along: 221 },
      // Hovering slides it further out and never moves it along the edge.
      hoverOffset: { across: 3, along: 221 },
      width: 16,
      height: 64,
      image: 'data:image/png;base64,AA==',
      pressedImage: 'data:image/png;base64,BB==',
      input: 'volume-up',
    })
  })

  it('swaps the axes for a button that sits on a horizontal edge', () => {
    const [button] = parseChromeButtons({
      inputs: [{
        name: 'power',
        type: 'button',
        image: 'Vol BTN',
        anchor: 'top',
        // An iPad's top button: only y changes on hover, so y is the poke-out and
        // the negative x measures its position from the right-hand corner.
        offsets: { normal: { x: -74, y: 8 }, rollover: { x: -74, y: 3 } },
      }],
    }, art)

    expect(button?.offset).toEqual({ across: 8, along: -74 })
    expect(button?.hoverOffset).toEqual({ across: 3, along: -74 })
  })

  it('drops a sign that only restates the anchor', () => {
    const [button] = parseChromeButtons({
      inputs: [{
        name: 'power', type: 'button', image: 'Vol BTN', anchor: 'right',
        offsets: { normal: { x: -8, y: 262 } },
      }],
    }, art)

    expect(button?.offset).toEqual({ across: 8, along: 262 })
    expect(button?.input).toBe('lock')
  })

  it('falls back to the resting offset when Apple ships no rollover', () => {
    const [button] = parseChromeButtons({
      inputs: [{
        name: 'action', type: 'button', image: 'Vol BTN', anchor: 'left',
        offsets: { normal: { x: 8, y: 160 } },
      }],
    }, art)

    expect(button?.hoverOffset).toEqual({ across: 8, along: 160 })
    // It still occupies space in the artwork; it just cannot be pressed.
    expect(button?.input).toBeUndefined()
  })

  it('skips entries whose artwork is missing from disk', () => {
    expect(parseChromeButtons({
      inputs: [{ name: 'power', type: 'button', image: 'Missing BTN', offsets: { normal: { x: 0, y: 0 } } }],
    }, art)).toEqual([])
  })
})

describe('IosSimulatorChromeLoader', () => {
  const SLICES = {
    topLeft: 'Phone TL', top: 'Phone Top', topRight: 'Phone TR', right: 'Phone Right',
    bottomRight: 'Phone BR', bottom: 'Phone Base', bottomLeft: 'Phone BL', left: 'Phone Left',
  }

  function deps(overrides: Record<string, unknown> = {}) {
    return {
      readPlist: vi.fn(async () => ({
        chromeIdentifier: 'com.apple.dt.devicekit.chrome.phone11',
        framebufferMask: 'MASK-UUID',
        mainScreenWidth: 1206,
        mainScreenHeight: 2622,
        mainScreenScale: 3,
      })),
      readFile: vi.fn(async (path: string) =>
        path.endsWith('chrome.json')
          ? Buffer.from(JSON.stringify({
            identifier: 'com.apple.dt.devicekit.chrome.phone11',
            images: {
              ...SLICES,
              sizing: { leftWidth: 18, rightWidth: 18, topHeight: 18, bottomHeight: 18 },
              devicePadding: { top: 0, left: 9, bottom: 0, right: 9 },
            },
            inputs: [{
              name: 'volume-up', type: 'button', image: 'Vol BTN', anchor: 'left',
              offsets: { normal: { x: 8, y: 221 }, rollover: { x: 3, y: 221 } },
            }],
          }))
          : path.includes('Phone TL')
            ? Buffer.from('/MediaBox [0 0 110 110]')
            : Buffer.from('/MediaBox [0 0 16 64]')),
      rasterize: vi.fn(async () => Buffer.from('png-bytes')),
      ensureDir: vi.fn(async () => {}),
      removeFile: vi.fn(async () => {}),
      ...overrides,
    }
  }

  it('builds the body from the nine-slice edges and sizes it per device', async () => {
    const loader = new IosSimulatorChromeLoader('/tmp/scratch', deps())

    const chrome = await loader.load('com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro', '/bundle')

    expect(chrome?.width).toBe(438)
    expect(chrome?.screen).toEqual({ x: 18, y: 18, width: 402, height: 874 })
    expect(chrome?.corner).toBe(110)
    expect(Object.keys(chrome!.slices).sort()).toEqual(Object.keys(SLICES).sort())
    expect(chrome?.slices.topLeft.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('carries the margin the buttons protrude into', async () => {
    const loader = new IosSimulatorChromeLoader('/tmp/scratch', deps())

    const chrome = await loader.load('type-padding', '/bundle')

    // Apple reserves 9pt, but the hovered volume button reaches 13pt out, so the
    // artwork widens it — otherwise it clips exactly when the user aims at it.
    expect(chrome?.padding).toEqual({ top: 0, left: 13, bottom: 0, right: 9 })
    expect(chrome?.buttons[0]?.image.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('reads the artwork once per device type', async () => {
    const shared = deps()
    const loader = new IosSimulatorChromeLoader('/tmp/scratch', shared)

    await loader.load('type-a', '/bundle')
    await loader.load('type-a', '/bundle')

    expect(shared.readPlist).toHaveBeenCalledTimes(1)
  })

  it('falls back to the drawn shell rather than a body with a hole in it', async () => {
    // A chrome missing one edge would otherwise render seven slices and a gap.
    const loader = new IosSimulatorChromeLoader('/tmp/scratch', deps({
      readFile: vi.fn(async (path: string) =>
        path.endsWith('chrome.json')
          ? Buffer.from(JSON.stringify({
            images: {
              ...SLICES,
              left: undefined,
              sizing: { leftWidth: 18, rightWidth: 18, topHeight: 18, bottomHeight: 18 },
            },
          }))
          : Buffer.from('/MediaBox [0 0 110 110]')),
    }))

    await expect(loader.load('type-partial', '/bundle')).resolves.toBeNull()
  })

  it('falls back to null rather than failing the panel when Xcode has no artwork', async () => {
    const loader = new IosSimulatorChromeLoader('/tmp/scratch', deps({
      readFile: vi.fn(async () => { throw new Error('ENOENT') }),
    }))

    await expect(loader.load('type-b', '/bundle')).resolves.toBeNull()
  })

  it('drops every rasterised intermediate once it is a data URL', async () => {
    const shared = deps()
    const loader = new IosSimulatorChromeLoader('/tmp/scratch', shared)

    const chrome = await loader.load('type-c', '/bundle')

    // The PNGs are read straight back into the payload, so leaving them behind grew
    // the scratch directory by a full set of artwork per device type ever previewed.
    expect(chrome).not.toBeNull()
    expect(shared.removeFile).toHaveBeenCalledTimes(shared.rasterize.mock.calls.length)
    for (const [, , outPath] of shared.rasterize.mock.calls) {
      expect(shared.removeFile).toHaveBeenCalledWith(outPath)
    }
  })

  it('refuses a framebuffer mask name that would escape the device bundle', async () => {
    const loader = new IosSimulatorChromeLoader('/tmp/scratch', deps({
      readPlist: vi.fn(async () => ({
        chromeIdentifier: 'com.apple.dt.devicekit.chrome.phone11',
        framebufferMask: '../../../../etc/passwd',
        mainScreenWidth: 1206,
        mainScreenHeight: 2622,
        mainScreenScale: 3,
      })),
    }))

    // Degrades to the CSS shell like any other unreadable artwork, and `onError`
    // carries the reason rather than the panel silently drawing nothing.
    const reported: unknown[] = []
    loader.onError = (_id, error) => reported.push(error)
    await expect(loader.load('type-d', '/bundle')).resolves.toBeNull()
    expect(String(reported[0])).toMatch(/Unusable framebuffer mask/)
  })
})

describe('chromePadding', () => {
  const button = {
    name: 'volume-up', title: 'Volume Up', anchor: 'left' as const,
    offset: { across: 8, along: 221 }, hoverOffset: { across: 3, along: 221 },
    width: 16, height: 64, image: 'img',
  }

  it('widens Apple\'s reservation to whatever the hovered button actually reaches', () => {
    const padding = chromePadding({ top: 0, left: 9, bottom: 0, right: 9 }, [button])

    expect(padding.left).toBe(13)
    // Untouched edges keep Apple's own number.
    expect(padding.right).toBe(9)
  })

  it('keeps the larger reservation when Apple already allowed enough', () => {
    const padding = chromePadding({ top: 0, left: 40, bottom: 0, right: 0 }, [button])

    expect(padding.left).toBe(40)
  })

  it('measures a top button across its height, not its width', () => {
    const padding = chromePadding({ top: 9, left: 0, bottom: 0, right: 0 }, [{
      ...button, anchor: 'top', width: 63, height: 16,
    }])

    expect(padding.top).toBe(13)
  })
})

describe('isSafeChromeAssetName', () => {
  it('accepts the names Apple actually ships, spaces and all', () => {
    for (const name of ['Phone TL', 'Vol BTN', 'Phone Base', 'Vol BTN Dn', 'MASK-UUID']) {
      expect(isSafeChromeAssetName(name)).toBe(true)
    }
  })

  it('refuses anything that could walk out of the bundle it was read from', () => {
    // These come out of chrome.json and profile.plist, which are files on disk
    // rather than values this process produced — the same reasoning that already
    // guarded `chromeBundleName`, applied to the strings joined beside it.
    for (const name of ['..', '../../etc/passwd', 'a/b', 'a\\b', '.hidden', '']) {
      expect(isSafeChromeAssetName(name)).toBe(false)
    }
  })
})
