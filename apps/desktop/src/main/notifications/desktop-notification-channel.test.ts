import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationIntent } from '@superone/shared/notifications'
import { NOTIFICATION_KINDS } from '@superone/shared/notifications'

/** One fake Electron `Notification`, recording what the channel did to it. */
class FakeNotification {
  static instances: FakeNotification[] = []
  static supported = true
  readonly handlers = new Map<string, (details?: { reason?: string }) => void>()
  shown = false
  closed = false

  constructor(readonly options: {
    title: string
    body: string
    id?: string
    silent?: boolean
    icon?: unknown
    timeoutType?: string
    toastXml?: string
  }) {
    FakeNotification.instances.push(this)
  }

  on(event: string, handler: (details?: { reason?: string }) => void): this {
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

  it('keeps Linux banners persistent while Windows banners use the system duration', () => {
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
    channel.deliver(intent())

    expect(FakeNotification.instances[0].options.timeoutType).toBe(process.platform === 'win32' ? 'default' : 'never')
  })

  it('keys the OS notification by our request id instead of a random UUID', () => {
    const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
    channel.deliver(intent({ id: 'req-42' }))

    const id = FakeNotification.instances[0].options.id
    channel.deliver(intent({ id: 'req-42' }))
    expect(FakeNotification.instances[1].options.id).toBe(id)
    if (process.platform !== 'win32') expect(id).toBe('req-42')
  })

  describe('Windows host-scoped ids', () => {
    const platform = process.platform
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    })

    it('fits Windows tag limits while keeping node identities, activation and withdrawal intact', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      const onActivate = vi.fn()
      const channel = new DesktopNotificationChannel({ onActivate })
      const remote = intent({ id: 'remote:node-a:completed:same-session', projectPath: 'remote:node-a:/srv/project' })
      channel.deliver(remote)
      channel.deliver(intent({ id: 'remote:node-b:completed:same-session' }))
      const [a, b] = FakeNotification.instances
      expect(a.options.id!.length).toBeLessThanOrEqual(16)
      expect(a.options.id).not.toBe(b.options.id)
      a.handlers.get('click')!()
      expect(onActivate).toHaveBeenCalledWith(remote)

      channel.deliver(remote)
      const replacement = FakeNotification.instances[2]
      expect(replacement.options.id).toBe(a.options.id)
      channel.withdraw(remote.id)
      expect(replacement.closed).toBe(true)
    })
  })

  describe('compact Windows banners', () => {
    const platform = process.platform
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    })
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    })

    it.each(NOTIFICATION_KINDS)('auto-hides %s without a duplicate logo or action row', kind => {
      const getIcon = vi.fn()
      const channel = new DesktopNotificationChannel({ onActivate: vi.fn(), getIcon })
      channel.deliver(intent({ kind }))
      const options = FakeNotification.instances[0].options
      expect(options.timeoutType).toBe('default')
      expect(options.toastXml).toContain('hint-maxLines="1"')
      expect(options.toastXml).not.toMatch(/<(image|actions)\b|scenario="reminder"/)
      expect(options).not.toHaveProperty('icon')
      expect(getIcon).not.toHaveBeenCalled()
    })

    it('can retract a notification from Action Center after its banner times out', () => {
      const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
      channel.deliver(intent())
      const notification = FakeNotification.instances[0]
      notification.handlers.get('close')!({ reason: 'timedOut' })
      expect(notification.closed).toBe(false)
      channel.withdraw('req-1')
      expect(notification.closed).toBe(true)
    })

    it('keeps remote session activation available after the banner times out', () => {
      const onActivate = vi.fn()
      const channel = new DesktopNotificationChannel({ onActivate })
      const remote = intent({ projectPath: 'remote:vps:/srv/project', title: 'VPS · Fix login' })
      channel.deliver(remote)
      const notification = FakeNotification.instances[0]
      notification.handlers.get('close')!({ reason: 'timedOut' })
      expect(notification.closed).toBe(false)
      notification.handlers.get('click')!()
      expect(onActivate).toHaveBeenCalledWith(remote)
    })

    it('releases a notification the user explicitly dismisses', () => {
      const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
      channel.deliver(intent())
      const notification = FakeNotification.instances[0]
      notification.handlers.get('close')!({ reason: 'userCanceled' })
      channel.withdraw('req-1')
      expect(notification.closed).toBe(false)
    })

    it('does not lose a replacement when Windows closes its earlier banner', () => {
      const channel = new DesktopNotificationChannel({ onActivate: vi.fn() })
      channel.deliver(intent())
      channel.deliver(intent())
      FakeNotification.instances[0].handlers.get('close')!({ reason: 'applicationHidden' })
      channel.withdraw('req-1')
      expect(FakeNotification.instances[1].closed).toBe(true)
    })
  })

  describe('icon', () => {
    const platform = process.platform
    const icon = { fake: 'icon' } as never
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    })

    it('passes the host icon on Linux, and omits it when the host has none', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      new DesktopNotificationChannel({ onActivate: vi.fn(), getIcon: () => icon }).deliver(intent())
      expect(FakeNotification.instances[0].options.icon).toBe(icon)

      new DesktopNotificationChannel({ onActivate: vi.fn(), getIcon: () => null }).deliver(intent())
      expect('icon' in FakeNotification.instances[1].options).toBe(false)
    })

    it('never passes an icon on macOS — it would render as a duplicate trailing attachment', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      const getIcon = vi.fn(() => icon)
      new DesktopNotificationChannel({ onActivate: vi.fn(), getIcon }).deliver(intent())
      expect('icon' in FakeNotification.instances[0].options).toBe(false)
      expect(getIcon).not.toHaveBeenCalled()
    })
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
