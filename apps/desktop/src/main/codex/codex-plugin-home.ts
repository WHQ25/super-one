import { net } from 'electron'
import { readCodexLogin } from '@superone/runtime/usage'
import {
  CodexPluginDirectoryError,
  codexPluginPageToken,
  codexPluginDetailId,
  parseCodexPluginCategory,
  parseCodexPluginDetail,
  parseCodexPluginHome,
  type CodexPluginCategoryPage,
  type CodexPluginDetail,
  type CodexPluginShelfSection,
} from '@superone/shared/codex-plugin-shelf'
import { codexAccountStore } from './codex-account-store'

const SERVICE_ORIGIN = 'https://chatgpt.com/backend-api'
const HOME_URL = `${SERVICE_ORIGIN}/ps/plugins/home`
const KNOWN_ERRORS = new Set<string>(Object.values(CodexPluginDirectoryError))
const CATEGORY_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/

/**
 * Curated plugin shelves from the ChatGPT plugin service.
 * Read-only: Codex owns the login, and the token never leaves this process.
 */
export async function fetchCodexPluginHome(): Promise<CodexPluginShelfSection[]> {
  return fetchCodexPluginDocument(HOME_URL, parseCodexPluginHome)
}

/** One page of a curated category. `pageToken` is omitted for the first page. */
export async function fetchCodexPluginCategory(slug: string, pageToken?: string | null): Promise<CodexPluginCategoryPage> {
  return fetchCodexPluginDocument(categoryUrl(slug, pageToken ?? null), parseCodexPluginCategory)
}

/** One hosted plugin document. Does not read the local install or the full catalog. */
export async function fetchCodexPluginDetail(pluginId: string): Promise<CodexPluginDetail> {
  const id = codexPluginDetailId(pluginId)
  if (!id) throw new Error(CodexPluginDirectoryError.unavailable)
  const detail = await fetchCodexPluginDocument(`${SERVICE_ORIGIN}/ps/plugins/${id}`, parseCodexPluginDetail)
  if (detail.id !== id) throw new Error(CodexPluginDirectoryError.unavailable)
  return detail
}

function categoryUrl(slug: string, pageToken: string | null): string {
  if (!CATEGORY_SLUG.test(slug)) throw new Error(CodexPluginDirectoryError.unavailable)
  const token = pageToken ? codexPluginPageToken(pageToken) : null
  if (pageToken && !token) throw new Error(CodexPluginDirectoryError.unavailable)
  const url = new URL(`${SERVICE_ORIGIN}/ps/plugin-categories/${slug}/plugins`)
  url.searchParams.set('scope', 'GLOBAL')
  url.searchParams.set('limit', '50')
  if (token) url.searchParams.set('pageToken', token)
  return url.href
}

async function fetchCodexPluginDocument<T>(url: string, parse: (body: unknown) => T | null): Promise<T> {
  const store = codexAccountStore()
  const account = store.list().find((entry) => entry.isDefault)
  if (account && !account.signedIn) throw new Error(CodexPluginDirectoryError.signedOut)
  const home = account ? store.home(account.id) : store.cliHome
  const login = readCodexLogin(home)
  if (!login) throw new Error(CodexPluginDirectoryError.signedOut)
  try {
    // Chromium's network stack: plain fetch can receive a Cloudflare challenge.
    const response = await net.fetch(url, {
      headers: {
        Authorization: `Bearer ${login.accessToken}`,
        Accept: 'application/json',
        'OAI-Product-Sku': 'codex',
        ...(login.accountId ? { 'ChatGPT-Account-Id': login.accountId } : {}),
      },
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 401 || response.status === 403) throw new Error(CodexPluginDirectoryError.expired)
    if (!response.ok) throw new Error(CodexPluginDirectoryError.unavailable)
    const parsed = parse(await response.json())
    if (!parsed) throw new Error(CodexPluginDirectoryError.unavailable)
    const current = store.list().find((entry) => entry.isDefault)
    if (current?.id !== account?.id || (current && !current.signedIn)
      || readCodexLogin(home)?.accessToken !== login.accessToken) {
      throw new Error(CodexPluginDirectoryError.unavailable)
    }
    return parsed
  } catch (err) {
    if (err instanceof Error && KNOWN_ERRORS.has(err.message)) throw err
    throw new Error(CodexPluginDirectoryError.unavailable)
  }
}
