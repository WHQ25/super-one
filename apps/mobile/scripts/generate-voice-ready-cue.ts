import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { VOICE_READY_CUE_DURATION_MS } from '@superone/shared/voice-ready-cue'
import { bundleViewerScript } from './viewer-page'

// Render the real desktop synthesis offline; no recording, service or live playback.
const root = resolve(import.meta.dirname, '../../..')
const source = await bundleViewerScript('../desktop/src/renderer/src/lib/audio-cue.ts', [], 'voice cue')
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.route('**/*', route => route.abort())
  const pcm = await page.evaluate(async ({ source, duration }) => {
    const rate = 44100
    // Pad silence so native ringback is stopped before it can loop.
    const context = new OfflineAudioContext(2, Math.ceil(rate * (duration / 1000 + 0.5)), rate)
    context.resume = async () => {}
    Object.assign(window, { AudioContext: function () { return context } })
    let seed = 0x51ce
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000 }
    const cue = await import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })))
    cue.playVoiceReadyCue()
    const audio = await context.startRendering()
    const wave = new ArrayBuffer(44 + audio.length * 4)
    const view = new DataView(wave)
    const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
    text(0, 'RIFF'); view.setUint32(4, wave.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true)
    view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true)
    text(36, 'data'); view.setUint32(40, wave.byteLength - 44, true)
    const channels = [audio.getChannelData(0), audio.getChannelData(1)]
    for (let i = 0; i < audio.length; i++) for (let c = 0; c < 2; c++) {
      view.setInt16(44 + (i * 2 + c) * 2, Math.round(Math.max(-1, Math.min(1, channels[c]![i]!)) * 32767), true)
    }
    const bytes = new Uint8Array(wave)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(binary)
  }, { source, duration: VOICE_READY_CUE_DURATION_MS })
  const wav = '/private/tmp/superone-voice-ready.wav'
  await writeFile(wav, Buffer.from(pcm, 'base64'))
  const directory = resolve(root, 'apps/mobile/assets/audio')
  await mkdir(directory, { recursive: true })
  const target = resolve(directory, 'incallmanager_ringback.mp3')
  await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '128k', target])
  console.log(`Rendered desktop voice cue: ${target}`)
} finally { await browser.close() }
