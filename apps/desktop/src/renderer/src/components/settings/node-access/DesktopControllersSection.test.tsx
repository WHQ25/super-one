/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControllerPairingEvent, NodeHostController } from '@superone/shared/agent-types'
import { DesktopControllersSection } from './DesktopControllersSection'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, string>) => vars ? `${key} ${JSON.stringify(vars)}` : key }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

let emit: ((event: ControllerPairingEvent) => void) | null = null

function mockApp(confirm: (code: string) => Promise<void>, controllers: NodeHostController[] = []) {
  const app = {
    listNodeHostControllers: vi.fn(async () => controllers),
    getNodeHostStatus: vi.fn(async () => ({ running: false, url: null, environmentId: null, error: null })),
    onNodeHostChanged: () => () => {},
    onControllerPairingEvent: (cb: (event: ControllerPairingEvent) => void) => {
      emit = cb
      return () => { emit = null }
    },
    startControllerPairing: vi.fn(async () => 'superone://pair-controller?channel=c'),
    confirmControllerPairing: vi.fn(confirm),
    cancelControllerPairing: vi.fn(async () => {}),
    removeNodeHostController: vi.fn(async () => {}),
    setNodeHostControllerEnabled: vi.fn(async (id: string, enabled: boolean) => {
      controllers = controllers.map((c) => c.id === id ? { ...c, enabled } : c)
    }),
  }
  ;(window as unknown as { app: unknown }).app = app
  return app
}

afterEach(() => { emit = null })

describe('DesktopControllersSection', () => {
  it('shows the QR in a dialog, then asks for the phone code, and keeps the form open after a wrong code', async () => {
    mockApp(async (code) => {
      if (code !== '123456') throw new Error('Incorrect pairing code')
      emit?.({ type: 'granted', controllerName: 'MacBook' })
    })
    render(<DesktopControllersSection controlAllowed />)
    fireEvent.click(await screen.findByRole('button', { name: 'resources.remote.pairNewDesktop' }))
    await screen.findByRole('dialog')
    await screen.findByText('settings.remote.thisDevice.desktop.pairing.grants')

    act(() => emit?.({ type: 'request', controllerName: 'MacBook', phoneName: 'iPhone' }))
    const input = await screen.findByPlaceholderText('000000')
    fireEvent.change(input, { target: { value: '000000' } })
    const confirm = screen.getByRole('button', { name: 'resources.remote.confirm' })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await screen.findByText('resources.remote.codeError')

    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes the dialog and reports an expired QR', async () => {
    mockApp(async () => {})
    render(<DesktopControllersSection controlAllowed />)
    fireEvent.click(await screen.findByRole('button', { name: 'resources.remote.pairNewDesktop' }))
    await screen.findByRole('dialog')
    act(() => emit?.({ type: 'ended', reason: 'expired' }))
    await waitFor(() => expect(screen.getByText('settings.remote.thisDevice.desktop.pairing.expired')).toBeTruthy())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('switches a controller off without unpairing it', async () => {
    const app = mockApp(async () => {}, [{ id: 'c1', label: 'MacBook', pairedAt: 0, lastUsedAt: 0, enabled: true, platform: 'darwin', path: 'lan' }])
    render(<DesktopControllersSection controlAllowed />)
    fireEvent.click(await screen.findByRole('switch'))
    await screen.findByText('settings.remote.thisDevice.desktop.accessOff')
    expect(app.setNodeHostControllerEnabled).toHaveBeenCalledWith('c1', false)
    expect(app.removeNodeHostController).not.toHaveBeenCalled()
  })

  it('locks every switch off and pairing while Allow Control is off', async () => {
    mockApp(async () => {}, [{ id: 'c1', label: 'MacBook', pairedAt: 0, lastUsedAt: 0, enabled: true, platform: 'darwin', path: null }])
    render(<DesktopControllersSection controlAllowed={false} />)
    const toggle = await screen.findByRole('switch')
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('button', { name: 'resources.remote.pairNewDesktop' })).toBeDisabled()
  })
})
