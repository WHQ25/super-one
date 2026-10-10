/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '@superone/shared/agent-types'

const getAppSettings = vi.fn()
let settingsChanged: ((settings: AppSettings) => void) | undefined
const modUi = vi.fn(async (_connection: string, _session: string, op: string) => (op === 'panes' ? { panes: [], shownId: null, focusedId: null, focusRequestedId: null } : {}))

Object.assign(window, {
  app: {
    getAppSettings,
    onAppSettingsChange: (callback: (settings: AppSettings) => void) => {
      settingsChanged = callback
      return () => {}
    },
  },
  environment: { modUi },
})

const settings = (drawModInterfaces: boolean) => ({ agentPreference: { claude: { drawModInterfaces } } }) as AppSettings

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const ops = () => modUi.mock.calls.map(([connection, session, op]) => `${connection}:${session}:${op}`)

const firstRead = deferred<AppSettings>()
getAppSettings.mockReturnValue(firstRead.promise)

const { disposeModUiClient, getModUiClient, routeModEvent } = await import('./registry')

beforeEach(() => {
  modUi.mockClear()
})

describe('mod clients and the Draw Mod Interfaces preference', () => {
  it('attaches nothing until the preference is read, then the sessions that announced mods', async () => {
    expect(getModUiClient('/p', 's1')).toBeNull()
    expect(routeModEvent({ type: 'mod_ui_state', available: true }, '/p', 's2')).toBe(true)
    expect(modUi).not.toHaveBeenCalled()

    firstRead.resolve(settings(true))
    await vi.waitFor(() => expect(ops()).toContain('local:s2:attach'))
    expect(ops()).not.toContain('local:s1:attach')
    expect(getModUiClient('/p', 's1')).not.toBeNull()
  })

  it('detaches every client when turned off and creates none until it is on again', async () => {
    const client = getModUiClient('/p', 's3')!
    await vi.waitFor(() => expect(client.isAvailable).toBe(true))
    modUi.mockClear()

    settingsChanged!(settings(false))
    expect(ops()).toEqual(expect.arrayContaining(['local:s1:detach', 'local:s2:detach', 'local:s3:detach']))
    expect(getModUiClient('/p', 's3')).toBeNull()
    expect(routeModEvent({ type: 'mod_ui_state', available: true }, '/p', 's3')).toBe(true)

    settingsChanged!(settings(true))
    expect(getModUiClient('/p', 's3')).not.toBe(client)
  })
})
