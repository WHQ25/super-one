import { net } from 'electron'
import { readCodexLogin } from '@superone/runtime/usage'
import type { CodexVoicePreview, CodexVoicePreviews } from '@superone/shared/codex-voice-previews'
import { codexAccountStore } from './codex-account-store'

const VOICES_URL = 'https://chatgpt.com/backend-api/settings/voices'

// The official client translates account voice IDs into App Server voice IDs.
const ACCOUNT_VOICE_ALIASES: Record<string, string> = { fathom: 'arbor', glimmer: 'sol', orbit: 'spruce' }

function previewCatalog(body: unknown): CodexVoicePreviews {
  const voices = (body as { voices?: unknown } | null)?.voices
  if (!Array.isArray(voices)) throw new Error('Invalid voice preview catalog.')
  const entries: Array<[string, CodexVoicePreview]> = []
  for (const entry of voices) {
    if (!entry || typeof entry.voice !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(entry.voice)) continue
    const metadata: CodexVoicePreview = {}
    if (typeof entry.accent === 'string' && entry.accent.trim()) metadata.accent = entry.accent.trim().slice(0, 100)
    try {
      const url = typeof entry.preview_url === 'string' ? new URL(entry.preview_url) : null
      if (url?.protocol === 'https:' && url.hostname === 'persistent.oaistatic.com'
        && !url.username && !url.password && !url.port) metadata.previewUrl = url.href
    } catch { /* Ignore missing or invalid samples without hiding selectable voices. */ }
    entries.push([Object.hasOwn(ACCOUNT_VOICE_ALIASES, entry.voice) ? ACCOUNT_VOICE_ALIASES[entry.voice] : entry.voice, metadata])
  }
  return Object.fromEntries(entries)
}

/** Global voice preferences use this desktop's default Codex account. Tokens stay in main. */
export async function listCodexVoicePreviews(language: string): Promise<CodexVoicePreviews> {
  const store = codexAccountStore()
  const account = store.list().find((entry) => entry.isDefault)
  if (account && !account.signedIn) throw new Error('Sign in to Codex to preview voices.')
  const home = account ? store.home(account.id) : store.cliHome
  const login = readCodexLogin(home)
  if (!login) throw new Error('Sign in to Codex to preview voices.')
  const url = new URL(VOICES_URL)
  url.searchParams.set('voice_mode', 'wingman')
  url.searchParams.set('spoken_language', language === 'zh' ? 'zh' : 'en')
  try {
    // Chromium's network stack is required here: plain fetch can receive a Cloudflare challenge.
    const response = await net.fetch(url.href, {
      headers: {
        Authorization: `Bearer ${login.accessToken}`,
        Accept: 'application/json',
        ...(login.accountId ? { 'ChatGPT-Account-Id': login.accountId } : {}),
      },
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error('Voice previews unavailable.')
    const result = previewCatalog(await response.json())
    const current = store.list().find((entry) => entry.isDefault)
    if (current?.id !== account?.id || (current && !current.signedIn)
      || readCodexLogin(home)?.accessToken !== login.accessToken) {
      throw new Error('Codex account changed.')
    }
    return result
  } catch {
    // Neither HTTP bodies nor transport errors may carry credentials into renderer errors/logs.
    throw new Error('Unable to load voice previews. Check your Codex login and try again.')
  }
}
