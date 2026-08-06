import { describe, expect, it } from 'vitest'
import {
  compareCliVersions,
  decideRemoteCliAction,
  desktopUpgradeRequiredMessage,
  relationDesktopToRemote,
  shouldBlockDesktopForNewerNode,
} from './cli-version'

describe('compareCliVersions', () => {
  it('orders core versions', () => {
    expect(compareCliVersions('0.49.4-alpha', '0.49.5-alpha')).toBeLessThan(0)
    expect(compareCliVersions('0.50.0', '0.49.9')).toBeGreaterThan(0)
    expect(compareCliVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('ranks prerelease below release of the same core', () => {
    expect(compareCliVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0)
    expect(compareCliVersions('1.0.0', '1.0.0-beta')).toBeGreaterThan(0)
  })

  it('orders alpha before beta at same core', () => {
    expect(compareCliVersions('0.49.5-alpha', '0.49.5-beta')).toBeLessThan(0)
  })
})

describe('decideRemoteCliAction', () => {
  it('installs when remote has no superone', () => {
    expect(
      decideRemoteCliAction({
        desktopVersion: '0.49.5-alpha',
        remotePath: null,
        remoteVersion: null,
      }),
    ).toEqual({ action: 'install', targetVersion: '0.49.5-alpha' })
  })

  it('reuses when versions match', () => {
    expect(
      decideRemoteCliAction({
        desktopVersion: '0.49.5-alpha',
        remotePath: '/home/u/.local/bin/superone',
        remoteVersion: '0.49.5-alpha',
      }),
    ).toEqual({ action: 'reuse', remoteVersion: '0.49.5-alpha' })
  })

  it('upgrades node when desktop is newer', () => {
    expect(
      decideRemoteCliAction({
        desktopVersion: '0.49.6-alpha',
        remotePath: '/home/u/.local/bin/superone',
        remoteVersion: '0.49.5-alpha',
      }),
    ).toEqual({
      action: 'upgrade_node',
      targetVersion: '0.49.6-alpha',
      remoteVersion: '0.49.5-alpha',
    })
  })

  it('requires desktop upgrade when node is newer', () => {
    const d = decideRemoteCliAction({
      desktopVersion: '0.49.5-alpha',
      remotePath: '/home/u/.local/bin/superone',
      remoteVersion: '0.50.0-alpha',
    })
    expect(d.action).toBe('upgrade_desktop')
    if (d.action === 'upgrade_desktop') {
      expect(d.code).toBe('desktop_upgrade_required')
      expect(d.message).toContain('0.50.0-alpha')
      expect(d.message).toContain('0.49.5-alpha')
      expect(d.message).toBe(
        desktopUpgradeRequiredMessage('0.49.5-alpha', '0.50.0-alpha'),
      )
    }
  })

  it('upgrades node when remote version is unknown', () => {
    expect(
      decideRemoteCliAction({
        desktopVersion: '0.49.5-alpha',
        remotePath: '/usr/local/bin/superone',
        remoteVersion: null,
      }),
    ).toEqual({
      action: 'upgrade_node_unknown',
      targetVersion: '0.49.5-alpha',
      remotePath: '/usr/local/bin/superone',
    })
  })
})

describe('relation helpers', () => {
  it('classifies desktop older/newer', () => {
    expect(relationDesktopToRemote('0.49.5-alpha', '0.50.0-alpha')).toBe('desktop_older')
    expect(relationDesktopToRemote('0.50.0-alpha', '0.49.5-alpha')).toBe('desktop_newer')
    expect(relationDesktopToRemote('1.0.0', '1.0.0')).toBe('equal')
    expect(relationDesktopToRemote('1.0.0', null)).toBe('unknown')
  })

  it('blocks connect when desktop is older', () => {
    expect(shouldBlockDesktopForNewerNode('0.49.5-alpha', '0.50.0-alpha')).toBe(true)
    expect(shouldBlockDesktopForNewerNode('0.50.0-alpha', '0.49.5-alpha')).toBe(false)
    expect(shouldBlockDesktopForNewerNode('0.50.0-alpha', null)).toBe(false)
  })
})
