import { NativeModules, PermissionsAndroid, Platform } from 'react-native'
import { MicrophoneDeniedError, type VoiceMedia, type VoiceMediaPort } from './voice-service'
import { bindAutomaticVoiceAudioRoute } from './automatic-voice-audio-route'
import { monitorVoiceAudioLevels } from './voice-audio-levels'
import { playNativeVoiceReadyCue } from './native-voice-ready-cue'

// WebRTC 124 references an unexported event-target-shim declaration subpath.
// Declare only the native events this adapter uses, matching its runtime API.
type NativePeer = import('react-native-webrtc').RTCPeerConnection & {
  addEventListener(type: 'track', listener: (event: { track: import('react-native-webrtc').MediaStreamTrack }) => void): void
  addEventListener(type: 'connectionstatechange' | 'icegatheringstatechange', listener: () => void): void
  removeEventListener(type: 'icegatheringstatechange', listener: () => void): void
}

function releaseCapture(stream: import('react-native-webrtc').MediaStream): void {
  for (const track of stream.getTracks()) { try { track.stop() } catch { /* continue releasing other tracks */ } }
  try { stream.release() } catch { /* native teardown may already have released it */ }
}

export const nativeVoiceAvailable = (): boolean => !!NativeModules.WebRTCModule && !!NativeModules.InCallManager

/** No WebView media or global polyfills. Native modules load only on explicit start. */
export const nativeVoiceMedia: VoiceMediaPort = {
  available: nativeVoiceAvailable,
  async open(signal, onState, onLevels) {
    const { RTCPeerConnection, mediaDevices, permissions } = require('react-native-webrtc') as typeof import('react-native-webrtc')
    const { default: InCallManager } = require('react-native-incall-manager') as typeof import('react-native-incall-manager')
    const assertCurrent = () => { if (signal.aborted) throw new Error('Voice start cancelled.') }
    assertCurrent()
    if (!(await permissions.request({ name: 'microphone' }))) throw new MicrophoneDeniedError('Microphone access denied. Enable it in Settings.')
    assertCurrent()
    if (Platform.OS === 'android' && Number(Platform.Version) >= 31) {
      // Optional for a paired Bluetooth route; denial still permits phone audio.
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT)
      assertCurrent()
    }
    const stream = await mediaDevices.getUserMedia({ audio: true, video: false })
    if (signal.aborted) { releaseCapture(stream); throw new Error('Voice start cancelled.') }
    let closed = false
    let stopLevels: (() => void) | undefined
    let stopCue: (() => void) | undefined
    let readyCuePlayed = false
    let inputMuted = false
    let cueGuarded = false
    const applyMicrophone = () => { if (!closed) for (const track of stream.getAudioTracks()) track.enabled = !inputMuted && !cueGuarded }
    let outputMuted = false
    let remoteReady = false
    const remoteTracks = new Set<import('react-native-webrtc').MediaStreamTrack>()
    let peer: NativePeer
    try { peer = new RTCPeerConnection() as NativePeer } catch (error) {
      releaseCapture(stream); throw error
    }
    const audioRoute = bindAutomaticVoiceAudioRoute(InCallManager)
    const close = () => {
      if (closed) return
      closed = true
      signal.removeEventListener('abort', close)
      stopLevels?.(); stopLevels = undefined
      try { stopCue?.() } catch { /* continue native media teardown */ }
      stopCue = undefined
      try { audioRoute.close() } catch { /* capture and native audio focus still must be released */ }
      try { peer.close() } catch { /* capture and audio focus still must be released */ }
      releaseCapture(stream)
      remoteTracks.clear()
      try { InCallManager.stop() } catch { /* audio route may already be stopped */ }
    }
    signal.addEventListener('abort', close, { once: true })
    try {
      InCallManager.start({ media: 'audio', auto: true, ringback: '' })
      // Foreground policy must still receive the user's lock/background action.
      InCallManager.setKeepScreenOn(false)
      audioRoute.start()
      const report = () => {
        if (closed) return
        if (peer.connectionState === 'connected' && remoteReady) onState('ready')
        else if (peer.connectionState === 'failed') onState('failed')
        else if (peer.connectionState === 'disconnected') onState('disconnected')
      }
      peer.addEventListener('connectionstatechange', report)
      peer.addEventListener('track', event => {
        if (closed || event.track.kind !== 'audio') return
        remoteTracks.add(event.track)
        event.track._setVolume(outputMuted ? 0 : 1)
        remoteReady = event.track.readyState === 'live'
        report()
      })
      peer.createDataChannel('oai-events')
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream)
      if (onLevels) stopLevels = monitorVoiceAudioLevels(peer, onLevels)
      const media: VoiceMedia = {
        async offer() {
          assertCurrent()
          await peer.setLocalDescription(await peer.createOffer({ offerToReceiveAudio: true }))
          if (peer.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
            const cleanup = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', gathered); signal.removeEventListener('abort', cancelled) }
            const gathered = () => { if (peer.iceGatheringState === 'complete') { cleanup(); resolve() } }
            const cancelled = () => { cleanup(); reject(new Error('Voice start cancelled.')) }
            const timer = setTimeout(() => { cleanup(); reject(new Error('Voice ICE gathering timed out.')) }, 10_000)
            peer.addEventListener('icegatheringstatechange', gathered)
            signal.addEventListener('abort', cancelled, { once: true })
            if (signal.aborted) cancelled(); else gathered()
          })
          assertCurrent()
          const sdp = peer.localDescription?.sdp
          if (!sdp) throw new Error('Could not create voice offer.')
          return sdp
        },
        async answer(sdp) { assertCurrent(); await peer.setRemoteDescription({ type: 'answer', sdp }); assertCurrent(); report() },
        inputMuted(muted) { inputMuted = muted; applyMicrophone() },
        outputMuted(muted) { outputMuted = muted; for (const track of remoteTracks) track._setVolume(muted ? 0 : 1) },
        readyCue() {
          if (closed || readyCuePlayed || outputMuted) return
          readyCuePlayed = true
          stopCue = playNativeVoiceReadyCue(InCallManager, guarded => { cueGuarded = guarded; applyMicrophone() })
          audioRoute.refresh()
        },
        close,
      }
      return media
    } catch (error) { close(); throw error }
  },
}
