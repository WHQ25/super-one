import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationIntent } from '@superone/shared/notifications'

/** One fake Electron `Notification`, recording what the channel did to it. */
class FakeNotification {
  static instances: FakeNotification[] = []
  static supported = true
  readonly handlers = new Map<string, () => void>()
  shown = false
  closed = false

  constructor(readonly options: {
    title: string
    body: string
    id?: string
    silent?: boolean
    icon?: unknown
    timeoutType?: string
  }) {
    FakeNotification.instances.push(this)
  }

  on(event: string, handler: () => void): this {
    this.handlers.set(event, handler)
    return this
  }

  show(): void { this.shown = true }
  close(): void { this.closed = true }
  static isSupported(): boolean { return FakeNotification.supported }
}

vi.mock('electron', () => ({ Notification: FakeNotification }))
const logMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logger', () => ({ default: logMock }))

const { DesktopNotificationChannel } = await import('./desktop-notification-channel')

function intent(overrides: Partial<NotificationIntent> = {}): NotificationIntent {
  return {
    id: 'req-1',
    kind: 'permission',
    sessionId: 'sid',
    projectPath: '/repo',
    title: 'Fix login needs permission',
    body: 'Waiting for approval to run Bash.',
    createdAt: 1,
    ...overrides,
  }
}

describe('DesktopNotificationChannel', () => {
  beforeEach(() => {
    FakeNotification.instances = []
    FakeNotification.supported = true
    logMock.info.mockClear()
    logMock.warn.mockClear()
  })

  it('reports availability from the OS rather than assuming it', () => {
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
    expect(channel.isAvailable()).toBe(true)
    FakeNotification.supported = false
    expect(channel.isAvailable()).toBe(false)
  })

  it('shows a non-silent banner carrying the intent copy', () => {
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
    channel.deliver(intent())

    const shown = FakeNotification.instances[0]
    expect(shown.shown).toBe(true)
    expect(shown.options).toMatchObject({
      title: 'Fix login needs permission',
      body: 'Waiting for approval to run Bash.',
      silent: false,
    })
  })

  it('never lets the OS time the banner out — the user may be away for hours', () => {
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
    channel.deliver(intent())

    // Linux + Windows honour this; without it the one notification that matters
    // disappears while nobody is at the machine.
    expect(FakeNotification.instances[0].options.timeoutType).toBe('never')
  })

  it('keys the OS notification by our request id instead of a random UUID', () => {
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
    channel.deliver(intent({ id: 'req-42' }))

    expect(FakeNotification.instances[0].options.id).toBe('req-42')
  })

  it('passes an icon when the host supplies one, and omits it otherwise', () => {
    const icon = { fake: 'icon' } as never
    new DesktopNotificationChannel({ onActivate: vi.fn(), getIcon: () => icon }).deliver(intent())
    expect(FakeNotification.instances[0].options.icon).toBe(icon)

    new DesktopNotificationChannel({ onActivate: vi.fn(), getIcon: () => null }).deliver(intent())
    expect('icon' in FakeNotification.instances[1].options).toBe(false)
  })

  it('logs posting and delivery separately so a swallowed notification is visible', () => {
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
    channel.deliver(intent({ id: 'req-9' }))
    const shown = FakeNotification.instances[0]

    // `show()` succeeded, but the OS has not confirmed delivery yet.
    expect(logMock.info).toHaveBeenCalledWith(
      expect.stringContaining('posted'), 'permission', 'sid', 'req-9',
    )
    expect(logMock.info).not.toHaveBeenCalledWith(expect.stringContaining('shown id'), 'req-9')

    shown.handlers.get('show')!()
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('shown id'), 'req-9')
  })

  it('routes a click back with the session to focus', () => {
    const onActivate = vi.fn()
    const channel = new DesktopNotificationChannel({ onActivate })
    const target = intent()
    channel.deliver(target)

    FakeNotification.instances[0].handlers.get('click')!()

    expect(onActivate).toHaveBeenCalledWith(target)
  })

  it('closes the banner when the interaction is answered elsewhere', () => {
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
    channel.deliver(intent({ id: 'req-1' }))

    channel.withdraw('req-1')

    expect(FakeNotification.instances[0].closed).toBe(true)
  })

  it('ignores a withdraw for an id it never showed', () => {
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
    channel.deliver(intent({ id: 'req-1' }))

    expect(() => channel.withdraw('other')).not.toThrow()
    expect(FakeNotification.instances[0].closed).toBe(false)
  })

  it('does not try to close a banner the user already dismissed', () => {
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
    channel.deliver(intent({ id: 'req-1' }))
    const shown = FakeNotification.instances[0]

    shown.handlers.get('close')!()
    channel.withdraw('req-1')

    expect(shown.closed).toBe(false)
  })

  it('closes everything outstanding on dispose', () => {
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
    channel.deliver(intent({ id: 'a' }))
    channel.deliver(intent({ id: 'b' }))

    channel.dispose()

    expect(FakeNotification.instances.map((n) => n.closed)).toEqual([true, true])
  })
})

describe('priming the macOS authorization prompt', () => {
  const platform = process.platform

  function setPlatform(value: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value, configurable: true })
  }

  beforeEach(() => {
    FakeNotification.instances = []
    FakeNotification.supported = true
  })

  afterEach(() => {
    setPlatform(platform)
  })

  it('posts one banner on macOS so the prompt lands where it can be explained', () => {
    setPlatform('darwin')
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })

    expect(channel.primePermission({ title: 'On', body: 'Body' })).toBe(true)
    expect(FakeNotification.instances).toHaveLength(1)
    expect(FakeNotification.instances[0]!.shown).toBe(true)
    expect(FakeNotification.instances[0]!.options).toMatchObject({ title: 'On', silent: true })
  })

  it('stays out of the withdraw bookkeeping', () => {
    // There is no interaction behind it, so nothing should ever retract it --
    // and dispose must not try, since the banner carries no intent id.
    setPlatform('darwin')
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
    channel.primePermission({ title: 'On', body: 'Body' })

    channel.dispose()

    expect(FakeNotification.instances[0]!.closed).toBe(false)
  })

  it('does nothing off macOS, where there is no prompt to spend', () => {
    for (const other of ['win32', 'linux'] as NodeJS.Platform[]) {
      setPlatform(other)
      const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
      expect(channel.primePermission({ title: 'On', body: 'Body' })).toBe(false)
    }
    expect(FakeNotification.instances).toHaveLength(0)
  })

  it('does nothing when the OS cannot show notifications at all', () => {
    setPlatform('darwin')
    FakeNotification.supported = false
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
    expect(channel.primePermission({ title: 'On', body: 'Body' })).toBe(false)
    FakeNotification.supported = true
  })
})
