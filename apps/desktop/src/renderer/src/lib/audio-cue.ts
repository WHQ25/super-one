/**
 * Short synthesized UI cues.
 *
 * Synthesis keeps cues out of the asset/asar pipeline and lets the timbre be tuned
 * in code. One lazily created AudioContext — and the reverb impulse built inside it
 * — is shared by every cue: browsers cap how many contexts a document may hold, and
 * rendering the impulse is the only expensive part of a cue.
 */

interface Voice {
  /** Pitch in Hz. */
  frequency: number
  /** Seconds after the cue starts. */
  startAt: number
  /** Seconds the voice rings for. */
  duration: number
  /** Peak linear gain. */
  gain: number
  /** -1 hard left … 1 hard right. */
  pan: number
  /** Seconds to swell from silence to peak. */
  attack: number
  /** Vibrato rate in Hz. Detuned per voice so the parts never lock together. */
  vibratoHz: number
}

interface Formant {
  /** Band centre at onset — the "oo" vowel. */
  from: number
  /** Band centre after the morph — the "ah" vowel. */
  to: number
  /** Relative level of this band. */
  gain: number
}

/**
 * Vocal tract resonances, in absolute Hz.
 *
 * These deliberately do NOT scale with the voice's pitch: in a real singer the
 * larynx sets pitch while the (fixed) vocal tract sets the formants, so every part
 * of a chord shares one resonance set. Scaling them per pitch is what turns a choir
 * into chipmunks.
 */
const FORMANTS: Formant[] = [
  { from: 325, to: 700, gain: 1 },
  { from: 700, to: 1220, gain: 0.5 },
  { from: 2530, to: 2600, gain: 0.18 },
]

/** D major, voiced low-to-high and entering in sequence, as a choir would. */
const VOICE_READY_CUE: Voice[] = [
  { frequency: 146.83, startAt: 0, duration: 2.2, gain: 0.075, pan: 0, attack: 0.18, vibratoHz: 4.3 },
  { frequency: 220, startAt: 0.04, duration: 2.2, gain: 0.055, pan: -0.3, attack: 0.2, vibratoHz: 4.9 },
  { frequency: 293.66, startAt: 0.08, duration: 2.2, gain: 0.05, pan: 0.28, attack: 0.22, vibratoHz: 5.4 },
  { frequency: 369.99, startAt: 0.13, duration: 2.2, gain: 0.038, pan: -0.18, attack: 0.24, vibratoHz: 4.6 },
  { frequency: 440, startAt: 0.18, duration: 2.2, gain: 0.032, pan: 0.34, attack: 0.26, vibratoHz: 5.1 },
]

/** Seconds after a part peaks before it has decayed out of a VAD's way. */
const MIC_GUARD_TAIL_SECONDS = 0.5

/**
 * How long a live microphone should stay closed while the ready cue plays.
 *
 * The cue is a sawtooth shaped by vocal-tract formants, so its spectrum is by
 * construction the one voice-activity detection is trained to fire on — echo
 * cancellation is not a safe enough bet on its own. Derived from the cue so that
 * retuning the parts cannot silently leave the guard too short.
 */
export const VOICE_READY_CUE_MIC_GUARD_MS = Math.round(
  (Math.max(...VOICE_READY_CUE.map((voice) => voice.startAt + voice.attack)) + MIC_GUARD_TAIL_SECONDS) * 1000,
)

/** Fraction of a voice's duration spent morphing "oo" into "ah". */
const VOWEL_MORPH_FRACTION = 0.55
/** Narrow enough to read as a resonance rather than a tone control. */
const FORMANT_Q = 7
/** Vibrato depth as a fraction of the pitch — roughly 8 cents. */
const VIBRATO_DEPTH_RATIO = 0.005
/** exponentialRampToValueAtTime cannot ramp to 0, so silence is approximated. */
const SILENCE = 0.0001
const REVERB_SECONDS = 2.6
/** Higher exponents make the tail die away faster; ~2.1 reads as a large hall. */
const REVERB_DECAY = 2.1
const REVERB_WET = 0.42
const REVERB_DRY = 0.85
const MASTER_GAIN = 0.62

interface CueBus {
  context: AudioContext
  /** Voices connect here; the bus below splits dry/wet and glues the result. */
  input: GainNode
}

let sharedBus: CueBus | null = null

/** Exponentially decaying stereo noise — the cheapest convincing room impulse. */
function renderImpulseResponse(context: AudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * REVERB_SECONDS)
  const impulse = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const samples = impulse.getChannelData(channel)
    for (let index = 0; index < length; index += 1) {
      samples[index] = (Math.random() * 2 - 1) * (1 - index / length) ** REVERB_DECAY
    }
  }
  return impulse
}

function acquireBus(): CueBus {
  if (!sharedBus) {
    const context = new AudioContext()
    const input = context.createGain()
    input.gain.value = 1

    const reverb = context.createConvolver()
    reverb.buffer = renderImpulseResponse(context)
    const wet = context.createGain()
    wet.gain.value = REVERB_WET
    const dry = context.createGain()
    dry.gain.value = REVERB_DRY

    // Staggered voices can stack into a peak no single gain predicts; the
    // compressor absorbs that instead of letting the cue clip.
    const glue = context.createDynamicsCompressor()
    const master = context.createGain()
    master.gain.value = MASTER_GAIN

    input.connect(dry)
    input.connect(reverb)
    reverb.connect(wet)
    dry.connect(glue)
    wet.connect(glue)
    glue.connect(master)
    master.connect(context.destination)

    sharedBus = { context, input }
  }
  // A context created outside a user gesture starts suspended; resuming is a
  // no-op once it is already running.
  if (sharedBus.context.state === 'suspended') void sharedBus.context.resume()
  return sharedBus
}

function scheduleVoice(bus: CueBus, voice: Voice, origin: number): void {
  const { context } = bus
  const startAt = origin + voice.startAt
  const endAt = startAt + voice.duration

  const panner = context.createStereoPanner()
  panner.pan.value = voice.pan
  panner.connect(bus.input)

  const amplitude = context.createGain()
  // Linear swell rather than the near-instant attack a struck sound wants: the
  // cue should sound breathed in, not hit.
  amplitude.gain.setValueAtTime(SILENCE, startAt)
  amplitude.gain.linearRampToValueAtTime(voice.gain, startAt + voice.attack)
  amplitude.gain.exponentialRampToValueAtTime(SILENCE, endAt)
  amplitude.connect(panner)

  // A sawtooth carries every harmonic, so the formant filters have material to
  // resonate; a sine would leave them nothing to shape.
  const source = context.createOscillator()
  source.type = 'sawtooth'
  source.frequency.value = voice.frequency

  const vibrato = context.createOscillator()
  vibrato.type = 'sine'
  vibrato.frequency.value = voice.vibratoHz
  const vibratoDepth = context.createGain()
  vibratoDepth.gain.value = voice.frequency * VIBRATO_DEPTH_RATIO
  vibrato.connect(vibratoDepth)
  vibratoDepth.connect(source.frequency)

  for (const formant of FORMANTS) {
    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.Q.value = FORMANT_Q
    band.frequency.setValueAtTime(formant.from, startAt)
    band.frequency.linearRampToValueAtTime(formant.to, startAt + voice.duration * VOWEL_MORPH_FRACTION)
    const level = context.createGain()
    level.gain.value = formant.gain
    source.connect(band)
    band.connect(level)
    level.connect(amplitude)
  }

  source.start(startAt)
  source.stop(endAt + 0.05)
  vibrato.start(startAt)
  vibrato.stop(endAt + 0.05)
}

function playCue(voices: Voice[]): void {
  const bus = acquireBus()
  const origin = bus.context.currentTime
  for (const voice of voices) scheduleVoice(bus, voice, origin)
}

/** Signals that a realtime voice call is connected and ready for speech. */
export function playVoiceReadyCue(): void {
  playCue(VOICE_READY_CUE)
}

/** Test seam: drops the shared bus so the next cue builds a fresh one. */
export function resetAudioCueContextForTests(): void {
  sharedBus = null
}
