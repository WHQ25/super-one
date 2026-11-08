import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteSpeechCache, hasSpeechCache, readSpeechCache, writeSpeechCache } from './cache'
import { pcmToWav } from './speech-wav'

describe('speech cache', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('round-trips the clips for one message and misses another', async () => {
    root = await mkdtemp(join(tmpdir(), 'speech-cache-'))
    const bytes = pcmToWav(Uint8Array.from([1, 0, 2, 0]), 24000)
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe('RIFF')
    await writeSpeechCache('message/1', [{ mediaType: 'audio/wav', bytes }], root)
    await expect(hasSpeechCache('message/1', root)).resolves.toBe(true)
    await expect(hasSpeechCache('other', root)).resolves.toBe(false)
    const clips = await readSpeechCache('message/1', root)
    expect(clips).toEqual([{ mediaType: 'audio/wav', bytes }])
  })

  it('deletes one message and leaves the other', async () => {
    root = await mkdtemp(join(tmpdir(), 'speech-cache-'))
    const bytes = Uint8Array.from([1, 2])
    await writeSpeechCache('keep', [{ mediaType: 'audio/wav', bytes }], root)
    await writeSpeechCache('drop', [{ mediaType: 'audio/wav', bytes }], root)
    await deleteSpeechCache(['drop', 'missing'], root)
    await expect(hasSpeechCache('drop', root)).resolves.toBe(false)
    await expect(hasSpeechCache('keep', root)).resolves.toBe(true)
  })
})