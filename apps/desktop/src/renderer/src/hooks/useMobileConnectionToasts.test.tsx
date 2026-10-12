/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster, toast } from 'sonner'
import type { RemoteDeviceStatus } from '@superone/shared/agent-types'
import { useMobileConnectionToasts } from './useMobileConnectionToasts'

const PHONE: RemoteDeviceStatus = { id: 'phone-1', name: 'Phone', online: true, firstConnect: true }
let emit: (status: RemoteDeviceStatus) => void
let unsubscribe = vi.fn<() => void>()
const originalSubscribe = window.app.onDeviceStatusChanged

function Preview() {
  useMobileConnectionToasts()
  return <Toaster position="bottom-center" />
}

async function advance(ms: number) {
  // Let React commit between Sonner's dismissal frame and exit animation.
  for (let remaining = ms; remaining > 0; remaining -= 100) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(100, remaining)) })
  }
}

async function connect(status = PHONE) {
  act(() => emit(status))
  await advance(1)
}

describe('mobile connection notifications', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    unsubscribe = vi.fn()
    window.app.onDeviceStatusChanged = (callback) => {
      emit = callback
      return unsubscribe
    }
  })

  afterEach(async () => {
    cleanup()
    toast.dismiss()
    await advance(1000)
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.app.onDeviceStatusChanged = originalSubscribe
  })

  it('automatically removes the connection notice after four seconds', async () => {
    render(<Preview />)
    await connect()
    expect(screen.getByText('Phone connected')).toBeInTheDocument()
    await advance(4500)
    expect(screen.queryByText('Phone connected')).not.toBeInTheDocument()
  })

  it('expires while the desktop window is hidden', async () => {
    render(<Preview />)
    await connect()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
    await advance(4500)
    expect(screen.queryByText('Phone connected')).not.toBeInTheDocument()
  })

  it('expires even while the pointer hovers over the notification', async () => {
    const { container } = render(<Preview />)
    await connect()
    fireEvent.mouseEnter(container.querySelector('[data-sonner-toaster][data-y-position="top"]')!)
    await advance(4500)
    expect(screen.queryByText('Phone connected')).not.toBeInTheDocument()
  })

  it('keeps one notice per phone across disconnect and reconnect', async () => {
    render(<Preview />)
    await connect()
    act(() => emit({ ...PHONE, online: false, firstConnect: false }))
    await connect()
    expect(screen.getAllByText('Phone connected')).toHaveLength(1)
    await advance(4500)
    expect(screen.queryByText('Phone connected')).not.toBeInTheDocument()
  })

  it('does not notify when an online phone only switches transport', async () => {
    render(<Preview />)
    await connect({ ...PHONE, firstConnect: false, transport: 'lan' })
    expect(screen.queryByText('Phone connected')).not.toBeInTheDocument()
  })

  it('refreshes the expiry deadline when the same phone reconnects', async () => {
    render(<Preview />)
    await connect()
    await advance(3000)
    act(() => emit({ ...PHONE, online: false, firstConnect: false }))
    await connect()
    await advance(1500)
    expect(screen.getAllByText('Phone connected')).toHaveLength(1)
    await advance(3000)
    expect(screen.queryByText('Phone connected')).not.toBeInTheDocument()
    await connect()
    expect(screen.getByText('Phone connected')).toBeInTheDocument()
  })

  it('expires each phone independently', async () => {
    render(<Preview />)
    await connect()
    await advance(3000)
    await connect({ ...PHONE, id: 'phone-2', name: 'Second phone' })
    await advance(1500)
    expect(screen.queryByText('Phone connected')).not.toBeInTheDocument()
    expect(screen.getByText('Second phone connected')).toBeInTheDocument()
    await advance(3000)
    expect(screen.queryByText('Second phone connected')).not.toBeInTheDocument()
  })

  it('removes the notice and subscription when unmounted', async () => {
    const { unmount } = render(<Preview />)
    await connect()
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(toast.getToasts().filter((item) => 'title' in item && item.title === 'Phone connected')).toHaveLength(0)
  })
})
