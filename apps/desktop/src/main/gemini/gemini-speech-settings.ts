import { GEMINI_DEFAULT_VOICE, isGeminiLiveVoice } from '@superone/shared/gemini-realtime'
import { decryptSecret, encryptSecret } from '../crypto/secret-store'
import { getDb, maskApiKey } from '../database'

const KEY = 'gemini.speechKey'
const VOICE = 'gemini.voice'

function readMeta(key: string): string {
  const row = getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value?: string } | undefined
  return row?.value ?? ''
}

function writeMeta(key: string, value: string): void {
  const db = getDb()
  if (!value) db.prepare('DELETE FROM app_meta WHERE key = ?').run(key)
  else db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function getGeminiSpeechKey(): string {
  const stored = readMeta(KEY)
  return stored ? decryptSecret(stored) : ''
}

export function getGeminiVoice(): string {
  const stored = readMeta(VOICE)
  return isGeminiLiveVoice(stored) ? stored : GEMINI_DEFAULT_VOICE
}

export function setGeminiVoice(voice: string): string {
  if (!isGeminiLiveVoice(voice)) throw new Error('Gemini voice is not a prebuilt studio voice.')
  writeMeta(VOICE, voice)
  return voice
}

export function geminiSpeechKeyStatus(): { configured: boolean; masked: string } {
  const key = getGeminiSpeechKey()
  return { configured: key.length > 0, masked: key ? maskApiKey(key) : '' }
}

export function setGeminiSpeechKey(apiKey: string): { configured: boolean; masked: string } {
  const trimmed = apiKey.trim()
  writeMeta(KEY, trimmed ? encryptSecret(trimmed) : '')
  return geminiSpeechKeyStatus()
}
