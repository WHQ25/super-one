/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ILyricsTag } from 'music-metadata'
import { encodeRemoteMediaUrl } from '@/lib/remote-media-url'
import { decodeLyricsBytes, mediaFileName, parseLrc, pickEmbeddedLyrics, readAudioDetails } from './audio-metadata'

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name))

describe('parseLrc', () => {
  it('reads every stamp of a line, drops metadata tags and sorts by time', () => {
    expect(parseLrc('﻿[ar:Someone]\n[00:05.50]second\n[00:01.00][00:09.25]chorus\n[00:03]bare seconds')).toEqual({
      kind: 'synced',
      lines: [
        { time: 1, text: 'chorus' },
        { time: 3, text: 'bare seconds' },
        { time: 5.5, text: 'second' },
        { time: 9.25, text: 'chorus' },
      ],
    })
  })

  it('applies a positive offset as lyrics arriving earlier', () => {
    expect(parseLrc('[offset:+500]\n[00:02.00]line')).toEqual({ kind: 'synced', lines: [{ time: 1.5, text: 'line' }] })
  })

  it('treats text without stamps as plain lyrics', () => {
    expect(parseLrc('[ti:Song]\nfirst verse\n\nsecond verse')).toEqual({ kind: 'plain', text: 'first verse\n\nsecond verse' })
    expect(parseLrc('[ti:Song]\n  ')).toBeNull()
  })
})

describe('pickEmbeddedLyrics', () => {
  const uslt = (text: string) => ({ language: 'eng', descriptor: '', text }) as ILyricsTag

  it('prefers millisecond SYLT over unsynced text', () => {
    const sylt = { contentType: 1, timeStampFormat: 2, syncText: [{ text: 'b', timestamp: 2000 }, { text: 'a', timestamp: 500 }] } as ILyricsTag
    expect(pickEmbeddedLyrics([uslt('a\nb'), sylt])).toEqual({ kind: 'synced', lines: [{ time: 0.5, text: 'a' }, { time: 2, text: 'b' }] })
  })

  it('reads LRC carried inside USLT as synced lyrics', () => {
    expect(pickEmbeddedLyrics([uslt('[00:01.00]hello')])).toEqual({ kind: 'synced', lines: [{ time: 1, text: 'hello' }] })
  })

  it('falls back to plain lyrics', () => {
    expect(pickEmbeddedLyrics([uslt('just words')])).toEqual({ kind: 'plain', text: 'just words' })
    expect(pickEmbeddedLyrics(undefined)).toBeNull()
  })
})

describe('decodeLyricsBytes', () => {
  it('reads UTF-8, and GB18030 when the bytes are not valid UTF-8', () => {
    expect(decodeLyricsBytes(new TextEncoder().encode('[00:01.00]夜色'))).toBe('[00:01.00]夜色')
    // A short run can be valid UTF-8 by coincidence; a real lyric line is not.
    expect(decodeLyricsBytes(new Uint8Array([0x5b, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x2e, 0x35, 0x30, 0x5d, 0xb5, 0xda, 0xd2, 0xbb, 0xd0, 0xd0, 0xa3, 0xba, 0xd2, 0xb9, 0xc9, 0xab, 0xc2, 0xfd, 0xc2, 0xfd, 0xc2, 0xe4, 0xcf, 0xc2]))).toBe('[00:00.50]第一行：夜色慢慢落下')
  })
})

describe('mediaFileName', () => {
  it('names local, remote and web sources, but not inline data', () => {
    expect(mediaFileName('local-file:///Users/me/Music/%E5%A4%9C%E8%89%B2%20(live).mp3')).toBe('夜色 (live).mp3')
    expect(mediaFileName(encodeRemoteMediaUrl('remote:node:/srv/app', 'out/take 2.wav'))).toBe('take 2.wav')
    expect(mediaFileName('https://example.com/a/b/song.flac?x=1')).toBe('song.flac')
    expect(mediaFileName('data:audio/mpeg;base64,AAAA')).toBeNull()
  })
})

describe('readAudioDetails', () => {
  afterEach(() => vi.unstubAllGlobals())

  function serve(files: Record<string, Buffer>) {
    const fetch = vi.fn(async (input: string | URL) => {
      const body = files[new URL(input).pathname]
      if (!body) return new Response(null, { status: 404 })
      return new Response(new Uint8Array(body), {
        headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(body.length) },
      })
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it('reads tags, the front cover and synced lyrics without looking for a sidecar', async () => {
    const fetch = serve({ '/music/song-with-cover.mp3': fixture('song-with-cover.mp3') })
    const details = await readAudioDetails('http://127.0.0.1:9000/music/song-with-cover.mp3', undefined, new AbortController().signal)

    expect(details).toMatchObject({ title: 'Night Drive', artist: 'SuperOne Ensemble', album: 'Fixture Sessions' })
    expect(details.cover?.type).toBe('image/jpeg')
    expect(details.lyrics).toEqual({ kind: 'synced', lines: expect.arrayContaining([{ time: 2, text: 'The city hums a quiet code' }]) })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('takes lyrics from a same-name .lrc beside an untagged file', async () => {
    serve({ '/memo/voice-memo.mp3': fixture('voice-memo.mp3'), '/memo/voice-memo.lrc': fixture('voice-memo.lrc') })
    const details = await readAudioDetails('http://127.0.0.1:9000/memo/voice-memo.mp3', undefined, new AbortController().signal)

    expect(details.title).toBeUndefined()
    expect(details.lyrics).toEqual({ kind: 'synced', lines: expect.arrayContaining([{ time: 0.5, text: '第一行：夜色慢慢落下' }]) })
  })

  it('never probes a web host for a sibling file', async () => {
    const fetch = serve({ '/voice-memo.mp3': fixture('voice-memo.mp3') })
    await readAudioDetails('https://cdn.example.com/voice-memo.mp3', undefined, new AbortController().signal)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
