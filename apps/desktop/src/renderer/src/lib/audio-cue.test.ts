import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playVoiceReadyCue, resetAudioCueContextForTests } from './audio-cue'

class FakeParam {
  value = 0
  setValueAtTime = vi.fn()
  linearRampToValueAtTime = vi.fn()
  exponentialRampToValueAtTime = vi.fn()
}

class FakeNode {
  connect = vi.fn()
}

class FakeOscillator extends FakeNode {
  type = ''
  frequency = new FakeParam()
  start = vi.fn()
  stop = vi.fn()
}

class FakeGain extends FakeNode {
  gain = new FakeParam()
}

class FakePanner extends FakeNode {
  pan = new FakeParam()
}

class FakeFilter extends FakeNode {
  type = ''
  Q = new FakeParam()
  frequency = new FakeParam()
}

class FakeConvolver extends FakeNode {
  buffer: AudioBuffer | null = null
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state: AudioContextState = 'running'
  currentTime = 10
  sampleRate = 48_000
  destination = new FakeNode()
  oscillators: FakeOscillator[] = []
  gains: FakeGain[] = []
  panners: FakePanner[] = []
  filters: FakeFilter[] = []
  convolvers: FakeConvolver[] = []
  createdBuffers = 0
  resume = vi.fn(async () => { this.state = 'running' })

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  createOscillator(): FakeOscillator {
    const node = new FakeOscillator()
    this.oscillators.push(node)
    return node
  }

  createGain(): FakeGain {
    const node = new FakeGain()
    this.gains.push(node)
    return node
  }

  createStereoPanner(): FakePanner {
    const node = new FakePanner()
    this.panners.push(node)
    return node
  }

  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter()
    this.filters.push(node)
    return node
  }

  createConvolver(): FakeConvolver {
    const node = new FakeConvolver()
    this.convolvers.push(node)
    return node
  }

  createDynamicsCompressor(): FakeNode {
    return new FakeNode()
  }

  createBuffer(channels: number, length: number): AudioBuffer {
    this.createdBuffers += 1
    const data = Array.from({ length: channels }, () => new Float32Array(length))
    return {
      numberOfChannels: channels,
      length,
      getChannelData: (channel: number) => data[channel]!,
    } as unknown as AudioBuffer
  }
}

const VOICE_COUNT = 5
const FORMANT_COUNT = 3
const CHORD_HZ = [146.83, 220, 293.66, 369.99, 440]

function play(): FakeAudioContext {
  playVoiceReadyCue()
  return FakeAudioContext.instances[0]!
}

function sawtooths(context: FakeAudioContext): FakeOscillator[] {
  return context.oscillators.filter((oscillator) => oscillator.type === 'sawtooth')
}

describe('playVoiceReadyCue', () => {
  beforeEach(() => {
    FakeAudioContext.instances = []
    resetAudioCueContextForTests()
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('voices the chord on sawtooths, each with its own vibrato', () => {
    const context = play()

    const carriers = sawtooths(context)
    expect(carriers.map((oscillator) => oscillator.frequency.value)).toEqual(CHORD_HZ)
    const vibratos = context.oscillators.filter((oscillator) => oscillator.type === 'sine')
    expect(vibratos).toHaveLength(VOICE_COUNT)
    // Detuned rates keep the parts from locking into one audible pulse.
    const rates = new Set(vibratos.map((oscillator) => oscillator.frequency.value))
    expect(rates.size).toBe(VOICE_COUNT)
  })

  it('enters the parts in sequence, low to high, inside 200ms', () => {
    const context = play()

    const starts = sawtooths(context).map((oscillator) => oscillator.start.mock.calls[0]![0] as number)
    expect(starts[0]).toBe(10)
    for (const [index, startAt] of starts.slice(1).entries()) {
      expect(startAt).toBeGreaterThan(starts[index]!)
    }
    expect(starts.at(-1)! - starts[0]!).toBeCloseTo(0.18, 5)
  })

  it('holds the formants at absolute frequencies for every pitch', () => {
    const context = play()

    expect(context.filters).toHaveLength(VOICE_COUNT * FORMANT_COUNT)
    expect(context.filters.every((filter) => filter.type === 'bandpass')).toBe(true)
    // The whole illusion: one resonance set shared by five different pitches.
    const perVoice = context.filters.map((filter) => filter.frequency.setValueAtTime.mock.calls[0]![0] as number)
    for (let voice = 1; voice < VOICE_COUNT; voice += 1) {
      const offset = voice * FORMANT_COUNT
      expect(perVoice.slice(offset, offset + FORMANT_COUNT)).toEqual(perVoice.slice(0, FORMANT_COUNT))
    }
    expect(perVoice.slice(0, FORMANT_COUNT)).toEqual([325, 700, 2530])
  })

  it('morphs the vowel from "oo" toward "ah" partway through the voice', () => {
    const context = play()

    const targets = context.filters.slice(0, FORMANT_COUNT).map((filter) => filter.frequency.linearRampToValueAtTime.mock.calls[0] as [number, number])
    expect(targets.map(([hz]) => hz)).toEqual([700, 1220, 2600])
    // 2.2s duration, 55% morph.
    for (const [, at] of targets) expect(at).toBeCloseTo(10 + 1.21, 5)
  })

  it('swells each part in rather than striking it', () => {
    const context = play()

    // Amplitude gains are the only ones that ramp; formant levels and vibrato
    // depth are set as plain values.
    const envelopes = context.gains.filter((gain) => gain.gain.linearRampToValueAtTime.mock.calls.length > 0)
    expect(envelopes).toHaveLength(VOICE_COUNT)

    const lowest = envelopes[0]!
    expect(lowest.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 10)
    expect(lowest.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.075, 10.18)
    expect(lowest.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 12.2)
  })

  it('routes the cue through a rendered reverb impulse', () => {
    const context = play()

    expect(context.convolvers).toHaveLength(1)
    expect(context.convolvers[0]!.buffer).not.toBeNull()
    expect(context.createdBuffers).toBe(1)
  })

  it('reuses one context and impulse across cues, resuming when suspended', () => {
    const context = play()
    context.state = 'suspended'
    playVoiceReadyCue()

    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(context.createdBuffers).toBe(1)
    expect(context.panners).toHaveLength(VOICE_COUNT * 2)
  })
})
