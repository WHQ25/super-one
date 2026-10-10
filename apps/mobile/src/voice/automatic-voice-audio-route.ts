import { DeviceEventEmitter, Platform } from 'react-native'

type InCallManager = typeof import('react-native-incall-manager').default

/** One proximity state owns phone audio and accidental-touch protection. */
export function bindAutomaticVoiceAudioRoute(manager: InCallManager) {
  let started = false
  let closed = false
  let near = false
  let external = false
  let hasEarpiece = true
  let devicesKnown = false
  let wiredRevision = 0
  let applied: boolean | null | undefined
  let screenOff = false
  // 4.3.0 accepts null to restore native headset/Bluetooth selection; its .d.ts
  // incorrectly narrows this documented runtime argument to boolean.
  const forceSpeaker = manager.setForceSpeakerphoneOn as (enabled: boolean | null) => void
  const apply = () => {
    if (!started || closed || !devicesKnown) return
    const receiver = !external && near && hasEarpiece
    // Native Android checks the old audio route before emitting Proximity, so
    // speaker -> receiver can miss screen blanking. Use the same resolved state
    // here. iOS already blanks/restores via UIDevice proximity monitoring.
    if (Platform.OS === 'android' && screenOff !== receiver) {
      screenOff = receiver
      if (screenOff) manager.turnScreenOff(); else manager.turnScreenOn()
    }
    const speaker = external ? null : !receiver
    if (applied === speaker) return
    applied = speaker
    forceSpeaker.call(manager, speaker)
  }
  const subscriptions = [DeviceEventEmitter.addListener('Proximity', (event: { isNear?: boolean }) => {
    if (typeof event?.isNear !== 'boolean') return
    near = event.isNear
    apply()
  })]
  if (Platform.OS === 'android') {
    // The initial native device list also detects already connected Bluetooth
    // headsets. Wait for it before forcing the loudspeaker.
    subscriptions.push(DeviceEventEmitter.addListener('onAudioDeviceChanged', (event: { availableAudioDeviceList?: string }) => {
      let devices: unknown
      try { devices = JSON.parse(event?.availableAudioDeviceList ?? '') } catch { return }
      if (!Array.isArray(devices) || !devices.every(device => typeof device === 'string')) return
      devicesKnown = true
      external = devices.includes('WIRED_HEADSET') || devices.includes('BLUETOOTH')
      if (!external) hasEarpiece = devices.includes('EARPIECE')
      apply()
    }))
  } else {
    subscriptions.push(DeviceEventEmitter.addListener('WiredHeadset', (event: { isPlugged?: boolean }) => {
      if (typeof event?.isPlugged !== 'boolean') return
      wiredRevision++
      devicesKnown = true
      external = event.isPlugged
      apply()
    }))
  }
  return {
    refresh() { applied = undefined; apply() },
    start() {
      started = true
      if (Platform.OS !== 'android') {
        const revision = wiredRevision
        void manager.getIsWiredHeadsetPluggedIn().then(state => {
          if (closed || revision !== wiredRevision) return
          devicesKnown = true
          external = state.isWiredHeadsetPluggedIn
          apply()
        }).catch(() => { devicesKnown = true; apply() })
      }
      apply()
    },
    close() {
      if (closed) return
      closed = true
      for (const subscription of subscriptions) subscription.remove()
      if (screenOff) { screenOff = false; manager.turnScreenOn() }
    },
  }
}
