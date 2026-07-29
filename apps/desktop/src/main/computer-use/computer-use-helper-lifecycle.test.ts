import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { requestMissingComputerUsePermissions } from './computer-use-helper-lifecycle'
import type { HelperDoctor } from './platform/helper-protocol'

function doctor(overrides: Partial<HelperDoctor> = {}): HelperDoctor {
  return {
    accessibility: 'missing',
    screenRecording: 'missing',
    bundleId: 'com.superone.computer-use.dev',
    bundlePath: '/Applications/SuperOne Dev Computer Use.app',
    pid: 123,
    screenRecordingNeedsRelaunch: true,
    ...overrides,
  }
}

describe('requestMissingComputerUsePermissions', () => {
  it('requests Accessibility before Screen Recording and restarts after a new capture grant', async () => {
    const calls: string[] = []
    const finalDoctor = doctor({
      accessibility: 'granted',
      screenRecording: 'granted',
      screenRecordingNeedsRelaunch: false,
    })
    const client = {
      call: vi.fn(async (method: string) => {
        calls.push(method)
        if (method === 'request_screen_recording') {
          return { screenRecording: 'granted' }
        }
        return { accessibility: 'missing' }
      }),
      restartHelper: vi.fn(async () => {
        calls.push('restart')
      }),
      doctor: vi.fn(async () => {
        calls.push('doctor')
        return finalDoctor
      }),
    }

    const result = await requestMissingComputerUsePermissions(client, doctor())

    expect(calls).toEqual([
      'request_accessibility',
      'request_screen_recording',
      'restart',
      'doctor',
    ])
    expect(result).toMatchObject({
      requested: true,
      accessibility: 'granted',
      screenRecording: 'granted',
      reason: 'already_granted',
    })
  })

  it('does not request or restart when both permissions are already granted', async () => {
    const grantedDoctor = doctor({
      accessibility: 'granted',
      screenRecording: 'granted',
      screenRecordingNeedsRelaunch: false,
    })
    const client = {
      call: vi.fn(),
      restartHelper: vi.fn(),
      doctor: vi.fn(),
    }

    const result = await requestMissingComputerUsePermissions(client, grantedDoctor)

    expect(client.call).not.toHaveBeenCalled()
    expect(client.restartHelper).not.toHaveBeenCalled()
    expect(result).toMatchObject({ requested: false, reason: 'already_granted' })
  })

  it('does not restart when Screen Recording remains missing', async () => {
    const client = {
      call: vi.fn(async (method: string) => (
        method === 'request_screen_recording'
          ? { screenRecording: 'missing' }
          : { accessibility: 'missing' }
      )),
      restartHelper: vi.fn(),
      doctor: vi.fn(async () => doctor()),
    }

    const result = await requestMissingComputerUsePermissions(client, doctor())

    expect(client.call).toHaveBeenNthCalledWith(1, 'request_accessibility')
    expect(client.call).toHaveBeenNthCalledWith(2, 'request_screen_recording')
    expect(client.restartHelper).not.toHaveBeenCalled()
    expect(result).toMatchObject({ requested: true, screenRecording: 'missing' })
  })
})
