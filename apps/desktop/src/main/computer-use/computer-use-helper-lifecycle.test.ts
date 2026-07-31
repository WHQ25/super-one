import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import {
  recheckComputerUsePermissionStatus,
  refreshComputerUsePermissionStatusAfterScreenGrant,
  requestMissingComputerUsePermissions,
  resetComputerUsePermissionBaselineForTests,
} from './computer-use-helper-lifecycle'
import type { HelperDoctor } from './platform/helper-protocol'

function doctor(overrides: Partial<HelperDoctor> = {}): HelperDoctor {
  return {
    accessibility: 'missing',
    screenRecording: 'missing',
    bundleId: 'com.superone.computer-use.dev',
    bundlePath: '/Applications/SuperOne Dev Computer Use.app',
    pid: 123,
    screenRecordingNeedsRelaunch: false,
    ...overrides,
  }
}

beforeEach(() => {
  resetComputerUsePermissionBaselineForTests()
})

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
      helperName: 'SuperOne Dev Computer Use',
      helperBundleId: 'com.superone.computer-use.dev',
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

describe('refreshComputerUsePermissionStatusAfterScreenGrant', () => {
  it('restarts once when Screen Recording becomes granted with sticky runtime', async () => {
    const calls: string[] = []
    const doctors = [
      doctor({
        accessibility: 'granted',
        screenRecording: 'missing',
        screenRecordingNeedsRelaunch: true,
      }),
      doctor({
        accessibility: 'granted',
        screenRecording: 'granted',
        screenRecordingNeedsRelaunch: false,
        pid: 456,
      }),
      doctor({
        accessibility: 'granted',
        screenRecording: 'granted',
        screenRecordingNeedsRelaunch: false,
        pid: 456,
      }),
    ]
    const client = {
      call: vi.fn(),
      restartHelper: vi.fn(async () => {
        calls.push('restart')
      }),
      doctor: vi.fn(async () => {
        calls.push('doctor')
        return doctors.shift()!
      }),
    }

    const afterTransition = await refreshComputerUsePermissionStatusAfterScreenGrant(
      client,
      { requested: false, screenRecording: 'missing' },
    )
    const afterStableGrant = await refreshComputerUsePermissionStatusAfterScreenGrant(
      client,
      afterTransition,
    )

    expect(calls).toEqual(['doctor', 'restart', 'doctor', 'doctor'])
    expect(client.restartHelper).toHaveBeenCalledTimes(1)
    expect(afterTransition).toMatchObject({
      screenRecording: 'granted',
      screenRecordingNeedsRelaunch: false,
      reason: 'already_granted',
    })
    expect(afterStableGrant.screenRecording).toBe('granted')
  })

  it('does not auto-restart when grant already has live runtime (e.g. after Recheck)', async () => {
    const client = {
      call: vi.fn(),
      restartHelper: vi.fn(),
      doctor: vi.fn(async () => doctor({
        accessibility: 'granted',
        screenRecording: 'granted',
        screenRecordingNeedsRelaunch: false,
      })),
    }

    const result = await refreshComputerUsePermissionStatusAfterScreenGrant(
      client,
      { requested: false, screenRecording: 'missing' },
    )

    expect(client.restartHelper).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      screenRecording: 'granted',
      screenRecordingNeedsRelaunch: false,
    })
  })

  it('does not restart while Screen Recording stays missing', async () => {
    const client = {
      call: vi.fn(),
      restartHelper: vi.fn(),
      doctor: vi.fn(async () => doctor({ accessibility: 'granted', screenRecording: 'missing' })),
    }

    const result = await refreshComputerUsePermissionStatusAfterScreenGrant(
      client,
      { requested: false, screenRecording: 'missing' },
    )

    expect(client.restartHelper).not.toHaveBeenCalled()
    expect(result).toMatchObject({ accessibility: 'granted', screenRecording: 'missing' })
  })

  it('keeps stale persisted grants missing and does not restart repeatedly', async () => {
    const client = {
      call: vi.fn(),
      restartHelper: vi.fn(async () => {}),
      doctor: vi.fn(async () => doctor({
        accessibility: 'granted',
        screenRecording: 'missing',
        screenRecordingNeedsRelaunch: true,
      })),
    }

    const afterRestart = await refreshComputerUsePermissionStatusAfterScreenGrant(
      client,
      { requested: false, screenRecording: 'missing', screenRecordingNeedsRelaunch: false },
    )
    const afterNextPoll = await refreshComputerUsePermissionStatusAfterScreenGrant(
      client,
      afterRestart,
    )

    expect(client.restartHelper).toHaveBeenCalledTimes(1)
    expect(afterRestart).toMatchObject({
      screenRecording: 'missing',
      screenRecordingNeedsRelaunch: true,
    })
    expect(afterNextPoll.screenRecording).toBe('missing')
  })

  it('does not restart for an Accessibility-only transition', async () => {
    const client = {
      call: vi.fn(),
      restartHelper: vi.fn(),
      doctor: vi.fn(async () => doctor({ accessibility: 'granted' })),
    }

    const result = await refreshComputerUsePermissionStatusAfterScreenGrant(
      client,
      {
        requested: false,
        accessibility: 'missing',
        screenRecording: 'missing',
      },
    )

    expect(client.restartHelper).not.toHaveBeenCalled()
    expect(result).toMatchObject({ accessibility: 'granted', screenRecording: 'missing' })
  })
})

describe('recheckComputerUsePermissionStatus', () => {
  it('restarts helper, re-doctors, and advances baseline so next poll does not re-restart', async () => {
    let restarts = 0
    const client = {
      call: vi.fn(),
      restartHelper: vi.fn(async () => {
        restarts += 1
      }),
      doctor: vi.fn(async () => doctor({
        accessibility: 'granted',
        screenRecording: 'granted',
        screenRecordingNeedsRelaunch: false,
      })),
    }

    const afterRecheck = await recheckComputerUsePermissionStatus(client)
    expect(client.restartHelper).toHaveBeenCalledTimes(1)
    expect(afterRecheck.screenRecording).toBe('granted')

    // Simulate next poll still receiving a "just granted" doctor while baseline is granted.
    // With needsRelaunch=false after recheck, auto path must not restart again.
    const afterPoll = await refreshComputerUsePermissionStatusAfterScreenGrant(
      client,
      afterRecheck,
    )
    expect(restarts).toBe(1)
    expect(afterPoll.screenRecording).toBe('granted')
  })

  it('dedupes concurrent recheck and sticky-grant restarts', async () => {
    let active = 0
    let maxActive = 0
    let resolveRestart!: () => void
    const restartGate = new Promise<void>((resolve) => {
      resolveRestart = resolve
    })

    const client = {
      call: vi.fn(),
      restartHelper: vi.fn(async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await restartGate
        active -= 1
      }),
      doctor: vi.fn(async () => doctor({
        accessibility: 'granted',
        screenRecording: 'granted',
        // After restart flight completes both callers re-doctor.
        screenRecordingNeedsRelaunch: false,
      })),
    }

    // First call sees sticky grant and starts restart flight.
    const stickyClient = {
      ...client,
      doctor: vi.fn()
        .mockResolvedValueOnce(doctor({
          accessibility: 'granted',
          screenRecording: 'missing',
          screenRecordingNeedsRelaunch: true,
        }))
        .mockResolvedValue(doctor({
          accessibility: 'granted',
          screenRecording: 'granted',
          screenRecordingNeedsRelaunch: false,
        })),
    }

    const stickyPromise = refreshComputerUsePermissionStatusAfterScreenGrant(
      stickyClient,
      { requested: false, screenRecording: 'missing' },
    )
    const recheckPromise = recheckComputerUsePermissionStatus(stickyClient)

    // Let both enter the single-flight restart.
    await Promise.resolve()
    resolveRestart()
    await Promise.all([stickyPromise, recheckPromise])

    expect(stickyClient.restartHelper).toHaveBeenCalledTimes(1)
    expect(maxActive).toBe(1)
  })
})
