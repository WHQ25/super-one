/**
 * Codex curated plugin shelves.
 *
 * Home is `GET /ps/plugins/home`: ordered sections, nine plugins each. The
 * page shows six. A category is `GET /ps/plugin-categories/{urlSlug}/plugins`,
 * paged by `next_page_token`. A plugin page is `GET /ps/plugins/{pluginId}`.
 * This module shapes those payloads and the small app-server search/personal
 * responses. It does not read the full remote catalog or a local plugin manifest.
 */

export const CODEX_CURATED_REMOTE_MARKETPLACE = 'openai-curated-remote'
/** Plugins kept from each home section. The service returns nine. */
export const CODEX_PLUGIN_HOME_LIMIT = 9
/** Plugins rendered on each home shelf. */
export const CODEX_PLUGIN_SHELF_LIMIT = 6
/** Safety cap for one category response. Observed pages stay under 700. */
export const CODEX_PLUGIN_CATEGORY_PAGE_LIMIT = 1000
export const CODEX_PLUGIN_SEARCH_LIMIT = 24
export const CODEX_PLUGIN_PERSONAL_LIMIT = 200

export const CodexPluginDirectoryError = {
  signedOut: 'codex-plugin-signed-out',
  expired: 'codex-plugin-login-expired',
  unavailable: 'codex-plugin-home-unavailable',
  remoteInstall: 'codex-plugin-remote-install',
} as const

export interface CodexPluginInstallTarget {
  pluginName: string
  remoteMarketplaceName?: string
  marketplacePath?: string
}

export interface CodexPluginShelfCard {
  id: string
  name: string
  description: string
  iconUrl: string | null
  iconUrlDark: string | null
  /** Set when the card can be installed without listing the catalog. */
  install: CodexPluginInstallTarget | null
  installed: boolean
  /** App-server plugin id for uninstall, when known. */
  installedKey: string | null
}

export interface CodexPluginShelfSection {
  id: string
  title: string
  urlSlug: string
  plugins: CodexPluginShelfCard[]
}

export interface CodexInstalledPluginIdentity {
  key: string
  remotePluginId: string | null
  name: string
}

export interface CodexPluginDirectoryResult {
  sections: CodexPluginShelfSection[]
  remote: boolean
}

export interface CodexPluginShelfListResult {
  plugins: CodexPluginShelfCard[]
  remote: boolean
}

export interface CodexPluginCategoryPage {
  plugins: CodexPluginShelfCard[]
  nextPageToken: string | null
  title: string | null
  description: string | null
}

export interface CodexPluginCategoryResult extends CodexPluginCategoryPage {
  remote: boolean
}

export interface CodexPluginDetailSkill {
  name: string
  description: string
  iconUrl: string | null
  iconUrlDark: string | null
}

export interface CodexPluginDetailApp {
  id: string
  name: string
  description: string
  iconUrl: string | null
  iconUrlDark: string | null
}

/** Hosted plugin document. Installed state is stamped later from `plugin/installed`. */
export interface CodexPluginDetail extends CodexPluginShelfCard {
  longDescription: string | null
  developerName: string | null
  category: string | null
  version: string | null
  websiteUrl: string | null
  privacyPolicyUrl: string | null
  termsOfServiceUrl: string | null
  capabilities: string[]
  screenshotUrls: string[]
  apps: CodexPluginDetailApp[]
  skills: CodexPluginDetailSkill[]
  mcpServers: string[]
  prompts: string[]
}

export interface CodexPluginDetailResult {
  plugin: CodexPluginDetail
  remote: boolean
}

const DETAIL_ID = /^[a-z0-9][a-z0-9._-]{0,200}$/i
const DETAIL_LONG_TEXT = 4000
const DETAIL_SKILLS = 40
const DETAIL_APPS = 40
const DETAIL_CAPABILITIES = 24
const DETAIL_SCREENSHOTS = 8
const DETAIL_MCP = 40
const DETAIL_PROMPTS = 8

/** Hosted plugin id safe to place in `/ps/plugins/{id}`. */
export function codexPluginDetailId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (!DETAIL_ID.test(id) || id.includes('..')) return null
  return id
}

export function codexPluginShelf<T>(plugins: readonly T[]): T[] {
  return plugins.slice(0, CODEX_PLUGIN_SHELF_LIMIT)
}

/** `null` when the payload is not a home document. An empty `sections` array is valid. */
export function parseCodexPluginHome(body: unknown): CodexPluginShelfSection[] | null {
  const sections = asRecord(body)?.sections
  if (!Array.isArray(sections)) return null
  const parsed: CodexPluginShelfSection[] = []
  for (const raw of sections) {
    const section = asRecord(raw)
    if (!section) continue
    const id = readString(section.id) ?? readString(section.url_slug) ?? readString(section.urlSlug)
    const title = readString(section.title)
    if (!id || !title || !safeLabel(id)) continue
    const plugins: CodexPluginShelfCard[] = []
    const rawPlugins = Array.isArray(section.plugins) ? section.plugins : []
    for (const rawPlugin of rawPlugins) {
      const card = homeCard(rawPlugin)
      if (!card) continue
      plugins.push(card)
      if (plugins.length === CODEX_PLUGIN_HOME_LIMIT) break
    }
    if (plugins.length === 0) continue
    parsed.push({
      id,
      title,
      urlSlug: readString(section.url_slug) ?? readString(section.urlSlug) ?? id,
      plugins,
    })
  }
  return parsed
}

export function applyCodexInstalledCards<T extends CodexPluginShelfCard>(
  cards: readonly T[],
  installed: readonly CodexInstalledPluginIdentity[],
): T[] {
  const keys = installedKeys(installed)
  return cards.map((card) => stampInstalledCard(card, keys))
}

export function applyCodexInstalledPlugins(
  sections: readonly CodexPluginShelfSection[],
  installed: readonly CodexInstalledPluginIdentity[],
): CodexPluginShelfSection[] {
  const keys = installedKeys(installed)
  return sections.map((section) => ({
    ...section,
    plugins: section.plugins.map((card) => stampInstalledCard(card, keys)),
  }))
}

/** `null` when `plugins` is missing. An empty plugin list is a valid page. */
export function parseCodexPluginCategory(body: unknown): CodexPluginCategoryPage | null {
  const record = asRecord(body)
  if (!record || !Array.isArray(record.plugins)) return null
  const plugins: CodexPluginShelfCard[] = []
  const seen = new Set<string>()
  for (const rawPlugin of record.plugins) {
    const card = homeCard(rawPlugin)
    if (!card || seen.has(card.id)) continue
    seen.add(card.id)
    plugins.push(card)
    if (plugins.length === CODEX_PLUGIN_CATEGORY_PAGE_LIMIT) break
  }
  const category = asRecord(record.category)
  return {
    plugins,
    nextPageToken: codexPluginPageToken(asRecord(record.pagination)?.next_page_token ?? asRecord(record.pagination)?.nextPageToken),
    title: visibleText(category?.title, 200),
    description: visibleText(category?.description, 500),
  }
}

/** `null` when the document is not one hosted plugin. */
export function parseCodexPluginDetail(body: unknown): CodexPluginDetail | null {
  const plugin = detailRecord(body)
  if (!plugin) return null
  const release = asRecord(plugin.release)
  const face = asRecord(release?.interface)
  const id = codexPluginDetailId(plugin.id)
  const name = readString(release?.display_name)
    ?? readString(release?.displayName)
    ?? readString(plugin.display_name)
    ?? readString(plugin.displayName)
    ?? readString(plugin.name)
  if (!id || !name || !safeLabel(name)) return null
  const description = readString(face?.short_description)
    ?? readString(face?.shortDescription)
    ?? readString(plugin.short_description)
    ?? readString(plugin.shortDescription)
    ?? readString(release?.description)
    ?? ''
  const longDescription = readableText(face?.long_description ?? face?.longDescription, DETAIL_LONG_TEXT)
  const policy = readString(plugin.installation_policy) ?? readString(plugin.installationPolicy)
  const status = readString(plugin.status)
  return {
    id,
    name,
    description,
    iconUrl: httpsUrl(face?.logo_url)
      ?? httpsUrl(face?.logoUrl)
      ?? httpsUrl(face?.composer_icon_url)
      ?? httpsUrl(face?.composerIconUrl)
      ?? httpsUrl(plugin.icon_url)
      ?? httpsUrl(plugin.iconUrl),
    iconUrlDark: httpsUrl(face?.logo_url_dark)
      ?? httpsUrl(face?.logoUrlDark)
      ?? httpsUrl(face?.composer_icon_dark_url)
      ?? httpsUrl(face?.composerIconDarkUrl)
      ?? httpsUrl(plugin.icon_url_dark)
      ?? httpsUrl(plugin.iconUrlDark),
    ...curatedInstallState(id, policy, status),
    longDescription: longDescription && longDescription !== description ? longDescription : null,
    developerName: visibleText(face?.developer_name ?? face?.developerName, 200)
      ?? visibleText(plugin.creator_name ?? plugin.creatorName, 200),
    category: categoryLabel(face?.category),
    version: visibleText(release?.version, 40),
    websiteUrl: httpsUrl(face?.website_url) ?? httpsUrl(face?.websiteUrl),
    privacyPolicyUrl: httpsUrl(face?.privacy_policy_url) ?? httpsUrl(face?.privacyPolicyUrl),
    termsOfServiceUrl: httpsUrl(face?.terms_of_service_url) ?? httpsUrl(face?.termsOfServiceUrl),
    capabilities: textList(face?.capabilities, DETAIL_CAPABILITIES, 80),
    screenshotUrls: screenshotList(face?.screenshot_urls ?? face?.screenshotUrls),
    apps: detailApps(release),
    skills: detailSkills(release?.skills),
    mcpServers: mcpNames(release?.mcp_servers ?? release?.mcpServers),
    prompts: detailPrompts(face),
  }
}

/** A page cursor safe to send back as `pageToken`. Anything else is dropped. */
export function codexPluginPageToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const token = value.trim()
  if (!token || token.length > 4096 || /[\u0000-\u001f\u007f\\]/.test(token)) return null
  return token
}

export function codexInstalledIdentities(body: unknown): CodexInstalledPluginIdentity[] {
  const marketplaces = asRecord(body)?.marketplaces
  if (!Array.isArray(marketplaces)) return []
  const identities: CodexInstalledPluginIdentity[] = []
  for (const rawMarketplace of marketplaces) {
    const plugins = asRecord(rawMarketplace)?.plugins
    if (!Array.isArray(plugins)) continue
    for (const rawPlugin of plugins) {
      const plugin = asRecord(rawPlugin)
      const key = plugin ? readString(plugin.id) : null
      if (!plugin || !key || plugin.installed !== true) continue
      identities.push({
        key,
        remotePluginId: readString(plugin.remotePluginId),
        name: readString(plugin.name) ?? key,
      })
    }
  }
  return identities
}

export function codexShelfCardsFromSearch(body: unknown): CodexPluginShelfCard[] {
  const data = asRecord(body)?.data
  if (!Array.isArray(data)) return []
  return data.flatMap((entry) => {
    const row = asRecord(entry)
    const plugin = asRecord(row?.plugin)
    if (!row || !plugin) return []
    const card = summaryCard(plugin, readString(row.marketplaceName) ?? '', readString(row.marketplacePath))
    return card ? [card] : []
  }).slice(0, CODEX_PLUGIN_SEARCH_LIMIT)
}

export function codexShelfCardsFromList(body: unknown): CodexPluginShelfCard[] {
  const marketplaces = asRecord(body)?.marketplaces
  if (!Array.isArray(marketplaces)) return []
  const cards: CodexPluginShelfCard[] = []
  for (const rawMarketplace of marketplaces) {
    const marketplace = asRecord(rawMarketplace)
    if (!marketplace) continue
    const name = readString(marketplace.name) ?? ''
    const marketplacePath = readString(marketplace.path)
    const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : []
    for (const rawPlugin of plugins) {
      const plugin = asRecord(rawPlugin)
      if (!plugin) continue
      const card = summaryCard(plugin, name, marketplacePath)
      if (!card) continue
      cards.push(card)
      if (cards.length === CODEX_PLUGIN_PERSONAL_LIMIT) return cards
    }
  }
  return cards
}

/** Params for `plugin/install` that do not require a catalog lookup. */
export function codexPluginInstallParams(target: CodexPluginInstallTarget): Record<string, string> {
  const pluginName = target.pluginName.trim()
  if (!safeToken(pluginName)) throw new Error('Invalid Codex plugin id.')
  const remote = target.remoteMarketplaceName?.trim() ?? ''
  const marketplacePath = target.marketplacePath?.trim() ?? ''
  if (remote && marketplacePath) throw new Error('Invalid Codex plugin install target.')
  if (remote) {
    if (!safeToken(remote)) throw new Error('Invalid Codex marketplace.')
    return { remoteMarketplaceName: remote, pluginName }
  }
  if (marketplacePath && isSafeMarketplacePath(marketplacePath)) {
    return { marketplacePath, pluginName }
  }
  throw new Error('Invalid Codex plugin install target.')
}

function homeCard(raw: unknown): CodexPluginShelfCard | null {
  const plugin = asRecord(raw)
  if (!plugin) return null
  const id = readString(plugin.id)
  const name = readString(plugin.display_name) ?? readString(plugin.displayName)
  if (!id || !name || !safeLabel(id)) return null
  const policy = readString(plugin.installation_policy) ?? readString(plugin.installationPolicy)
  const status = readString(plugin.status)
  return {
    id,
    name,
    description: readString(plugin.short_description) ?? readString(plugin.shortDescription) ?? '',
    iconUrl: httpsUrl(plugin.icon_url) ?? httpsUrl(plugin.iconUrl),
    iconUrlDark: httpsUrl(plugin.icon_url_dark) ?? httpsUrl(plugin.iconUrlDark),
    ...curatedInstallState(id, policy, status),
  }
}

function curatedInstallState(
  id: string,
  policy: string | null,
  status: string | null,
): Pick<CodexPluginShelfCard, 'install' | 'installed' | 'installedKey'> {
  const unavailable = policy === 'NOT_AVAILABLE' || status === 'DISABLED_BY_ADMIN' || status === 'DISABLED'
  const installedByDefault = policy === 'INSTALLED_BY_DEFAULT'
  const installable = safeToken(id) && !unavailable && !installedByDefault && (policy === 'AVAILABLE' || (policy === null && status === 'ENABLED'))
  return {
    install: installable
      ? { pluginName: id, remoteMarketplaceName: CODEX_CURATED_REMOTE_MARKETPLACE }
      : null,
    installed: installedByDefault,
    installedKey: null,
  }
}

function summaryCard(
  plugin: Record<string, unknown>,
  marketplaceName: string,
  marketplacePath: string | null,
): CodexPluginShelfCard | null {
  const key = readString(plugin.id)
  const name = readString(plugin.name)
  if (!key || !name) return null
  const face = asRecord(plugin.interface)
  const remotePluginId = readString(plugin.remotePluginId)
  const installed = plugin.installed === true
  const policy = readString(plugin.installPolicy)
  const blocked = policy === 'NOT_AVAILABLE'
  let install: CodexPluginInstallTarget | null = null
  if (!installed && !blocked) {
    if (marketplacePath) install = { pluginName: name, marketplacePath }
    else if (remotePluginId && marketplaceName) install = { pluginName: remotePluginId, remoteMarketplaceName: marketplaceName }
  }
  return {
    id: remotePluginId ?? key,
    name: readString(face?.displayName) ?? name,
    description: readString(face?.shortDescription) ?? readString(face?.longDescription) ?? '',
    iconUrl: httpsUrl(face?.logoUrl) ?? httpsUrl(face?.composerIconUrl),
    iconUrlDark: httpsUrl(face?.logoUrlDark),
    install,
    installed,
    installedKey: installed ? key : null,
  }
}

function installedKeys(installed: readonly CodexInstalledPluginIdentity[]): Map<string, string> {
  const keys = new Map<string, string>()
  for (const entry of installed) {
    if (!entry.key) continue
    if (entry.remotePluginId) keys.set(entry.remotePluginId, entry.key)
    keys.set(entry.key, entry.key)
  }
  return keys
}

function stampInstalledCard<T extends CodexPluginShelfCard>(card: T, keys: Map<string, string>): T {
  const installedKey = keys.get(card.id)
  if (!installedKey) return card
  return { ...card, installed: true, installedKey, install: null }
}

function detailRecord(body: unknown): Record<string, unknown> | null {
  const record = asRecord(body)
  if (!record) return null
  if (readString(record.id)) return record
  const nested = asRecord(record.plugin)
  return nested && readString(nested.id) ? nested : null
}

function detailSkills(value: unknown): CodexPluginDetailSkill[] {
  if (!Array.isArray(value)) return []
  const skills: CodexPluginDetailSkill[] = []
  for (const entry of value) {
    const skill = asRecord(entry)
    const face = asRecord(skill?.interface)
    const name = skill
      ? visibleText(skill.name ?? face?.display_name ?? face?.displayName, 120)
      : visibleText(entry, 120)
    if (!name) continue
    const description = skill
      ? readableText(face?.short_description ?? face?.shortDescription ?? skill.description ?? skill.short_description, 500) ?? ''
      : ''
    skills.push({
      name,
      description,
      iconUrl: httpsUrl(face?.icon_small_url)
        ?? httpsUrl(face?.iconSmallUrl)
        ?? httpsUrl(face?.icon_large_url)
        ?? httpsUrl(face?.iconLargeUrl),
      iconUrlDark: httpsUrl(face?.icon_small_url_dark)
        ?? httpsUrl(face?.iconSmallUrlDark)
        ?? httpsUrl(face?.icon_large_url_dark)
        ?? httpsUrl(face?.iconLargeUrlDark),
    })
    if (skills.length === DETAIL_SKILLS) break
  }
  return skills
}

function detailApps(release: Record<string, unknown> | null): CodexPluginDetailApp[] {
  if (!release) return []
  const apps: CodexPluginDetailApp[] = []
  const seen = new Set<string>()
  const sources = [
    ...(Array.isArray(release.app_templates) ? release.app_templates : []),
    ...(Array.isArray(release.appTemplates) ? release.appTemplates : []),
    ...(Array.isArray(release.apps) ? release.apps : []),
  ]
  for (const raw of sources) {
    const app = asRecord(raw)
    if (!app) continue
    const name = visibleText(app.name ?? app.display_name ?? app.displayName, 200)
    if (!name) continue
    const id = visibleText(app.template_id ?? app.templateId ?? app.canonical_connector_id ?? app.canonicalConnectorId ?? app.id, 200) ?? name
    if (seen.has(id)) continue
    seen.add(id)
    apps.push({
      id,
      name,
      description: readableText(app.description ?? app.short_description ?? app.shortDescription, 500) ?? '',
      iconUrl: httpsUrl(app.logo_url) ?? httpsUrl(app.logoUrl) ?? httpsUrl(app.icon_url) ?? httpsUrl(app.iconUrl),
      iconUrlDark: httpsUrl(app.logo_url_dark) ?? httpsUrl(app.logoUrlDark) ?? httpsUrl(app.icon_url_dark) ?? httpsUrl(app.iconUrlDark),
    })
    if (apps.length === DETAIL_APPS) break
  }
  return apps
}

function mcpNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    const name = record ? visibleText(record.key ?? record.name, 120) : visibleText(entry, 120)
    if (!name || names.includes(name)) continue
    names.push(name)
    if (names.length === DETAIL_MCP) break
  }
  return names
}

function detailPrompts(face: Record<string, unknown> | null): string[] {
  if (!face) return []
  const many = face.default_prompts ?? face.defaultPrompts
  const source = Array.isArray(many) ? many : [face.default_prompt ?? face.defaultPrompt]
  const prompts: string[] = []
  for (const entry of source) {
    const text = readableText(entry, 240)
    if (!text || prompts.includes(text)) continue
    prompts.push(text)
    if (prompts.length === DETAIL_PROMPTS) break
  }
  return prompts
}

function screenshotList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const urls: string[] = []
  for (const entry of value) {
    const url = httpsUrl(entry)
    if (!url || urls.includes(url)) continue
    urls.push(url)
    if (urls.length === DETAIL_SCREENSHOTS) break
  }
  return urls
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  const items: string[] = []
  for (const entry of value) {
    const text = visibleText(entry, maxLength)
    if (!text || items.includes(text)) continue
    items.push(text)
    if (items.length === maxItems) break
  }
  return items
}

function categoryLabel(value: unknown): string | null {
  if (typeof value === 'string') return visibleText(value, 120)
  const record = asRecord(value)
  if (!record) return null
  return visibleText(record.title ?? record.name ?? record.display_name ?? record.displayName, 120)
}

/** Prose that may contain newlines. Other control characters are removed. */
function readableText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (!text) return null
  return text.length > max ? text.slice(0, max) : text
}

function visibleText(value: unknown, max: number): string | null {
  const text = readString(value)
  if (!text || /[\u0000-\u001f\\]/.test(text)) return null
  return text.length > max ? text.slice(0, max) : text
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

/** Visible ids. Section ids from the home API can contain spaces. */
function safeLabel(value: string): boolean {
  return value.length > 0 && value.length <= 300 && !/[\u0000-\u001f\\]/.test(value)
}

/** Plugin and marketplace ids that can be sent as an install name. */
function safeToken(value: string): boolean {
  return safeLabel(value) && !/[\s/]/.test(value)
}

function isSafeMarketplacePath(value: string): boolean {
  if (value.includes('\0') || value.split(/[\\/]/).includes('..')) return false
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
}
