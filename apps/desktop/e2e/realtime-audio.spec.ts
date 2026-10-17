import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import type { BufferedVoicePlayback } from '../src/renderer/src/lib/realtime-audio'

test('keeps remote WebRTC output continuous through UI blocking and retains suspended speech', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'superone-voice-audio-'))
  let app: ElectronApplication | undefined
  try {
    await build({
      configFile: false,
      base: './',
      publicDir: false,
      logLevel: 'silent',
      build: {
        outDir: temporary,
        emptyOutDir: false,
        lib: {
          entry: resolve('src/renderer/src/lib/realtime-audio.ts'),
          name: 'voiceAudio',
          formats: ['iife'],
          fileName: () => 'voice.js',
        },
      },
    })
    await writeFile(join(temporary, 'continuity-meter.js'), `
      class ContinuityMeter extends AudioWorkletProcessor {
        constructor() {
          super(); this.remaining=0;
          this.port.onmessage=({data})=>{
            if(data.type==='record') {
              this.remaining=Math.round(sampleRate*data.ms/1000);
              this.silent=0; this.run=0; this.longest=0;
            }
          }
        }
        process(inputs) {
          const input=inputs[0]?.[0];if(!this.remaining)return true;
          const count=Math.min(this.remaining,input?.length??128);let energy=0;
          for(let i=0;i<count;i++)energy+=(input?.[i]??0)**2;
          if(Math.sqrt(energy/count)<0.01){this.silent+=count;this.run+=count;this.longest=Math.max(this.longest,this.run)}else this.run=0;
          this.remaining-=count;
          if(!this.remaining)this.port.postMessage({silentMs:this.silent/sampleRate*1000,longestSilentMs:this.longest/sampleRate*1000});
          return true;
        }
      }
      registerProcessor('continuity-meter',ContinuityMeter);
    `)
    await writeFile(join(temporary, 'index.html'), '<script src="./voice.js"></script>')
    await writeFile(join(temporary, 'main.cjs'), `
      const { app, BrowserWindow } = require('electron')
      const path = require('node:path')
      app.setPath('userData', path.join(__dirname, 'profile'))
      app.whenReady().then(() => {
        const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
        window.loadFile(path.join(__dirname, 'index.html'))
      })
    `)
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ args: [join(temporary, 'main.cjs')], env })
    const page = await app.firstWindow()
    await page.waitForFunction(() => 'voiceAudio' in window)
    const result = await page.evaluate(async () => {
      const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
      const source = new AudioContext({ sampleRate: 48_000 })
      const oscillator = source.createOscillator()
      const gain = source.createGain()
      gain.gain.value = 0.2
      const stream = source.createMediaStreamDestination()
      oscillator.connect(gain).connect(stream)
      oscillator.start()
      await source.resume()
      const sender = new RTCPeerConnection()
      const receiver = new RTCPeerConnection()
      const errors: string[] = []
      let playback: BufferedVoicePlayback | undefined
      try {
        const received = new Promise<MediaStream>(resolve => {
          receiver.ontrack = event => resolve(new MediaStream([event.track]))
        })
        sender.onicecandidate = event => { if (event.candidate) void receiver.addIceCandidate(event.candidate).catch(error => errors.push(String(error))) }
        receiver.onicecandidate = event => { if (event.candidate) void sender.addIceCandidate(event.candidate).catch(error => errors.push(String(error))) }
        sender.addTrack(stream.stream.getAudioTracks()[0]!, stream.stream)
        await sender.setLocalDescription(await sender.createOffer())
        await receiver.setRemoteDescription(sender.localDescription!)
        await receiver.setLocalDescription(await receiver.createAnswer())
        await sender.setRemoteDescription(receiver.localDescription!)
        const remote = await received
        const { BufferedVoicePlayback: Playback } = (window as unknown as { voiceAudio: { BufferedVoicePlayback: typeof BufferedVoicePlayback } }).voiceAudio
        playback = new Playback(() => playback?.pause(), error => errors.push(error.message))
        await playback.connect(remote)
        // Inspect actual native output; mocked frames cannot reproduce Chromium's
        // remote-track playout dependency.
        const output = playback as unknown as { context: AudioContext; node: AudioWorkletNode; bufferedFrames: number }
        const analyser = output.context.createAnalyser()
        analyser.fftSize = 2048
        output.node.connect(analyser)
        const samples = new Float32Array(analyser.fftSize)
        const peak = () => {
          analyser.getFloatTimeDomainData(samples)
          return samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)
        }
        let initialPeak = 0
        for (let attempt = 0; attempt < 30 && initialPeak < 0.05; attempt++) {
          await wait(100)
          initialPeak = peak()
        }
        await output.context.audioWorklet.addModule('./continuity-meter.js')
        const meter = new AudioWorkletNode(output.context, 'continuity-meter')
        output.node.connect(meter).connect(output.context.destination)
        const continuity: Array<{ blockedMs: number; silentMs: number; longestSilentMs: number }> = []
        for (const blockedMs of [100, 500, 1500]) {
          await wait(300)
          const measured = new Promise<{ silentMs: number; longestSilentMs: number }>(resolve => {
            meter.port.onmessage = ({ data }) => resolve(data)
          })
          meter.port.postMessage({ type: 'record', ms: blockedMs })
          // The meter runs in the audio thread: a UI timer cannot observe the gap.
          const until = performance.now() + blockedMs
          while (performance.now() < until) { /* emulate synchronous layout/render work */ }
          continuity.push({ blockedMs, ...await measured })
        }
        meter.disconnect()
        const report = await receiver.getStats()
        const inbound = [...report.values()].find(stats => stats.type === 'inbound-rtp') as RTCInboundRtpStreamStats | undefined
        playback.pause()
        await output.context.suspend()
        const beforePause = output.bufferedFrames
        await wait(500)
        const bufferedDuringPause = output.bufferedFrames - beforePause
        // Stop speaking before resuming: audible output must be the unread reply.
        oscillator.stop()
        await wait(250)
        await playback.resume()
        let resumedPeak = 0
        for (let attempt = 0; attempt < 10 && resumedPeak < 0.05; attempt++) {
          await wait(20)
          resumedPeak = peak()
        }
        analyser.disconnect()
        return { initialPeak, resumedPeak, bufferedDuringPause, continuity, packets: inbound?.packetsReceived ?? 0, errors }
      } finally {
        playback?.close()
        sender.close()
        receiver.close()
        await source.close()
      }
    })
    console.log(JSON.stringify(result))
    expect(result.errors).toEqual([])
    for (const sample of result.continuity) {
      expect(sample.longestSilentMs, `output must stay audible during ${sample.blockedMs}ms UI blocking`).toBeLessThan(50)
    }
    expect(result.packets).toBeGreaterThan(0)
    expect(result.initialPeak, 'received RTP packets must produce audible PCM from call start').toBeGreaterThan(0.05)
    expect(result.bufferedDuringPause).toBeGreaterThan(10_000)
    expect(result.resumedPeak, 'unheard speech must survive output suspension').toBeGreaterThan(0.05)
  } finally {
    await app?.close()
    await rm(temporary, { recursive: true, force: true })
  }
})
