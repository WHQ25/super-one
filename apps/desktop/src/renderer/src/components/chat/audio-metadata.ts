import type { ILyricsTag } from 'music-metadata'
import { decodeRemoteMediaUrl } from '@/lib/remote-media-url'

export interface LyricLine {
  /** Seconds from the start of the track. */
  time: number
  text: string
}

export type Lyrics = { kind: 'synced'; lines: LyricLine[] } | { kind: 'plain'; text: string }

export interface AudioDetails {
  title?: string
  artist?: string
  album?: string
  cover?: Blob
  lyrics: Lyrics | null
}

const LRC_TIME = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g
const LRC_TAG = /^\[([a-z#]+):(.*)\]$/i
/** `SYLT` timestamp format 2: absolute milliseconds (ID3v2.4 §4.9). */
const SYLT_MILLISECONDS = 2

/**
 * Parse LRC text — `[mm:ss.xx]line`, several stamps per line, `[offset:±ms]`.
 * Text with no time stamps is plain lyrics with the `[ar:…]`-style tags dropped.
 */
export function parseLrc(source: string): Lyrics | null {
  const lines: LyricLine[] = []
  const plain: string[] = []
  let offsetMs = 0
  for (const raw of source.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim()
    const tag = LRC_TAG.exec(line)
    if (tag) {
      if (tag[1].toLowerCase() === 'offset') offsetMs = Number(tag[2]) || 0
      continue
    }
    const stamps = [...line.matchAll(LRC_TIME)]
    if (stamps.length === 0) {
      plain.push(raw)
      continue
    }
    const text = line.replace(LRC_TIME, '').trim()
    for (const [, min, sec] of stamps) lines.push({ time: Number(min) * 60 + Number(sec.replace(':', '.')), text })
  }
  if (lines.length > 0) {
    // A positive offset means the lyrics come earlier (LRC convention).
    const shift = offsetMs / 1000
    return { kind: 'synced', lines: lines.map((l) => ({ ...l, time: Math.max(0, l.time - shift) })).sort((a, b) => a.time - b.time) }
  }
  const text = plain.join('\n').trim()
  return text ? { kind: 'plain', text } : null
}

/** Embedded lyrics, synchronized ones first. `USLT` often carries LRC text, so it is parsed too. */
export function pickEmbeddedLyrics(tags: readonly ILyricsTag[] | undefined): Lyrics | null {
  if (!tags?.length) return null
  // music-metadata leaves `syncText` off a `USLT` entry despite its type.
  const synced = tags.find((t) => t.timeStampFormat === SYLT_MILLISECONDS && t.syncText?.length)
  if (synced) {
    const lines = synced.syncText
      .filter((l) => l.timestamp !== undefined)
      .map((l) => ({ time: l.timestamp! / 1000, text: l.text.trim() }))
      .sort((a, b) => a.time - b.time)
    if (lines.length > 0) return { kind: 'synced', lines }
  }
  let plain: Lyrics | null = null
  for (const tag of tags) {
    const text = tag.text ?? tag.syncText?.map((l) => l.text).join('\n')
    const parsed = text ? parseLrc(text) : null
    if (parsed?.kind === 'synced') return parsed
    plain ??= parsed
  }
  return plain
}

/** LRC files from Chinese sources are often GB18030 rather than UTF-8. */
export function decodeLyricsBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}

function basename(path: string): string {
  return path.slice(path.replace(/[\\/]+$/, '').search(/[^\\/]*$/))
}

function withExtension(path: string, ext: string): string {
  return path.replace(/\.[^./\\]*$/, '') + ext
}

/** The name a markdown media src points at; null for inline data. */
export function mediaFileName(src: string | undefined): string | null {
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return null
  const remote = decodeRemoteMediaUrl(src)
  if (remote) return basename(remote.relativePath) || null
  try {
    return decodeURIComponent(basename(new URL(src).pathname)) || null
  } catch {
    return basename(src) || null
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Same-name `.lrc` beside the audio. Only on this machine or the session's own
 * project — a sibling URL on an arbitrary web host is not ours to probe.
 */
async function readSidecarLyrics(source: string | undefined, displaySrc: string, signal: AbortSignal): Promise<Lyrics | null> {
  const remote = source ? decodeRemoteMediaUrl(source) : null
  if (remote) {
    const file = await window.app.readProjectFile(remote.projectPath, withExtension(remote.relativePath, '.lrc')).catch(() => null)
    if (!file || file.language === 'binary' || file.language === 'too-large' || file.content.startsWith('data:')) return null
    return parseLrc(file.content)
  }
  let url: URL
  try {
    // An `<audio src>` may be relative to the page, as the browser resolves it.
    url = new URL(displaySrc, document.baseURI)
  } catch {
    return null
  }
  if (url.protocol !== 'local-file:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) return null
  url.pathname = withExtension(url.pathname, '.lrc')
  const response = await fetch(url, { signal }).catch(() => null)
  if (!response?.ok) return null
  return parseLrc(decodeLyricsBytes(new Uint8Array(await response.arrayBuffer())))
}

/**
 * Tags, cover and lyrics of an audio file. Streams only as far as the parser
 * needs — the tags lead an MP3 or FLAC — then drops the connection.
 */
export async function readAudioDetails(displaySrc: string, source: string | undefined, signal: AbortSignal): Promise<AudioDetails> {
  const reading = new AbortController()
  const stop = () => reading.abort()
  signal.addEventListener('abort', stop)
  let details: AudioDetails = { lyrics: null }
  try {
    const response = await fetch(displaySrc, { signal: reading.signal })
    if (response.ok && response.body) {
      const { parseWebStream, selectCover } = await import('music-metadata')
      const size = Number(response.headers.get('Content-Length')) || undefined
      const { common } = await parseWebStream(response.body, { mimeType: response.headers.get('Content-Type') ?? undefined, size }, { skipPostHeaders: true })
      const picture = selectCover(common.picture)
      details = {
        title: common.title || undefined,
        artist: common.artist || undefined,
        album: common.album || undefined,
        cover: picture ? new Blob([picture.data as Uint8Array<ArrayBuffer>], { type: picture.format }) : undefined,
        lyrics: pickEmbeddedLyrics(common.lyrics),
      }
    }
  } catch {
    // Unreadable or unsupported: the player still plays, titled by its file name.
  } finally {
    stop()
    signal.removeEventListener('abort', stop)
  }
  if (details.lyrics?.kind !== 'synced' && !signal.aborted) {
    const sidecar = await readSidecarLyrics(source, displaySrc, signal).catch(() => null)
    if (sidecar && (sidecar.kind === 'synced' || !details.lyrics)) details = { ...details, lyrics: sidecar }
  }
  return details
}
