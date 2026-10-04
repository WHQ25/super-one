import { expect, it } from 'vitest'
import { asDeviceModUiRequest, asNodeCallerModUiRequest, asNodeReaderModEvent, mobileModClientId, nodeModClientId } from './mod-ui'

it('stamps a phone request with its own surface and client id', () => {
  expect(asDeviceModUiRequest({ plugin: 'p', handle: 1, surface: 'desktop', clientId: 'superone-desktop' }, 'dev1'))
    .toEqual({ plugin: 'p', handle: 1, surface: 'mobile', clientId: mobileModClientId('dev1') })
  // A host reply speaks as the phone too.
  expect(asDeviceModUiRequest({ requestId: 'r', clientId: 'superone-desktop', reply: { kind: 'copy', copied: true } }, 'dev1'))
    .toEqual({ requestId: 'r', clientId: mobileModClientId('dev1'), reply: { kind: 'copy', copied: true } })
  // Ops without those fields pass through untouched.
  expect(asDeviceModUiRequest({ plugin: 'p' }, 'dev1')).toEqual({ plugin: 'p' })
})

it('scopes a node caller\'s client id to its pairing and reads only its own back', () => {
  expect(asNodeCallerModUiRequest({ clientId: 'superone-desktop' }, 'c1')).toEqual({ clientId: nodeModClientId('superone-desktop', 'c1') })
  const focus = { type: 'mod_focus', clientId: nodeModClientId('superone-desktop', 'c1'), component: 'Pane', instanceId: 'i', plugin: 'p', key: 'k' } as const
  expect(asNodeReaderModEvent(focus, 'c1')).toEqual({ ...focus, clientId: 'superone-desktop' })
  expect(asNodeReaderModEvent(focus, 'c2')).toBe(focus)
})
