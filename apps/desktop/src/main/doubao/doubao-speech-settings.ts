import { DOUBAO_DEFAULT_SPEAKER, DOUBAO_O2_SPEAKERS, isDoubaoO2Speaker } from '@superone/shared/doubao-realtime'
import { parseDesktopVoicePreference, type DesktopVoicePreference, type DoubaoVoiceSettings } from '@superone/shared/doubao-call'
import { getDb, maskApiKey } from '../database'
import { decryptSecret, encryptSecret } from '../crypto/secret-store'

const KEY = 'doubao.speechKey'
const FRONTEND = 'doubao.voiceFrontend'
const SPEAKER = 'doubao.speaker'

function readMeta(key: string): string {
  const row = getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value?: string } | undefined
  return row?.value ?? ''
}

function writeMeta(key: string, value: string): void {
  const db = getDb()
  if (!value) db.prepare('DELETE FROM app_meta WHERE key = ?').run(key)
  else db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function getDoubaoSpeechKey(): string {
  const stored = readMeta(KEY)
  return stored ? decryptSecret(stored) : ''
}

export function getDoubaoSpeaker(): string {
  const stored = readMeta(SPEAKER)
  return isDoubaoO2Speaker(stored) ? stored : DOUBAO_DEFAULT_SPEAKER
}

export function getDoubaoVoiceSettings(): DoubaoVoiceSettings {
  const key = getDoubaoSpeechKey()
  return {
    preference: parseDesktopVoicePreference(readMeta(FRONTEND)),
    speaker: getDoubaoSpeaker(),
    key: { configured: key.length > 0, masked: key ? maskApiKey(key) : '' },
  }
}

export function setDoubaoVoiceSettings(patch: {
  preference?: DesktopVoicePreference
  speaker?: string
  apiKey?: string
}): DoubaoVoiceSettings {
  if (patch.preference) writeMeta(FRONTEND, parseDesktopVoicePreference(patch.preference))
  if (patch.speaker !== undefined) {
    if (!isDoubaoO2Speaker(patch.speaker)) throw new Error('Doubao speaker is not a Seeduplex voice.')
    writeMeta(SPEAKER, patch.speaker)
  }
  if (patch.apiKey !== undefined) {
    const trimmed = patch.apiKey.trim()
    writeMeta(KEY, trimmed ? encryptSecret(trimmed) : '')
  }
  return getDoubaoVoiceSettings()
}

export const DOUBAO_SPEAKER_IDS = DOUBAO_O2_SPEAKERS
