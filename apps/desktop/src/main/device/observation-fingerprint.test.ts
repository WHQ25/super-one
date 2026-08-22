import { describe, expect, it } from 'vitest'
import {
  encodeObservationFingerprint,
  observationFingerprintsMatch,
} from './observation-fingerprint'

const TREE_A = 'button|Sign in||10,20,30,40'
const TREE_B = 'button|Sign out||10,20,30,40'
const HASH_A = '7141414d45554555'
const HASH_B = '9115159595959595'

describe('combining the tree digest and the pixel hash into one settle signal', () => {
  it('calls the screen still only when both readings agree it is', () => {
    expect(observationFingerprintsMatch(
      encodeObservationFingerprint(TREE_A, HASH_A),
      encodeObservationFingerprint(TREE_A, HASH_A),
    )).toBe(true)
  })

  it('catches motion the tree cannot see', () => {
    // A crossfade, a video, a progress bar filling: identical geometry and labels,
    // different pixels. The tree alone would call this settled mid-animation.
    expect(observationFingerprintsMatch(
      encodeObservationFingerprint(TREE_A, HASH_A),
      encodeObservationFingerprint(TREE_A, HASH_B),
    )).toBe(false)
  })

  it('catches changes the pixels barely register', () => {
    // A label swap too small to move an 8x8 cell. The hash alone would miss it.
    expect(observationFingerprintsMatch(
      encodeObservationFingerprint(TREE_A, HASH_A),
      encodeObservationFingerprint(TREE_B, HASH_A),
    )).toBe(false)
  })

  it('tolerates the bit of drift a perceptual hash has between identical captures', () => {
    expect(observationFingerprintsMatch(
      encodeObservationFingerprint(TREE_A, HASH_A),
      encodeObservationFingerprint(TREE_A, '7141414d45554551'),
    )).toBe(true)
  })

  it('falls back to the tree alone when the framebuffer cannot be read', () => {
    // Otherwise a device whose pixels are unreadable would never settle at all.
    expect(observationFingerprintsMatch(
      encodeObservationFingerprint(TREE_A, undefined),
      encodeObservationFingerprint(TREE_A, undefined),
    )).toBe(true)
  })

  it('falls back to the pixels alone when the app exposes no tree', () => {
    expect(observationFingerprintsMatch(
      encodeObservationFingerprint(null, HASH_A),
      encodeObservationFingerprint(null, HASH_A),
    )).toBe(true)
    expect(observationFingerprintsMatch(
      encodeObservationFingerprint(null, HASH_A),
      encodeObservationFingerprint(null, HASH_B),
    )).toBe(false)
  })

  it('refuses to settle when one sample had a reading the other did not', () => {
    // Half a signal appearing or vanishing is itself a change of state, and calling
    // it "the same" would settle on the strength of a comparison never made.
    expect(observationFingerprintsMatch(
      encodeObservationFingerprint(TREE_A, HASH_A),
      encodeObservationFingerprint(TREE_A, undefined),
    )).toBe(false)
  })

  it('never settles when neither reading is available', () => {
    expect(observationFingerprintsMatch(
      encodeObservationFingerprint(null, undefined),
      encodeObservationFingerprint(null, undefined),
    )).toBe(false)
  })
})
