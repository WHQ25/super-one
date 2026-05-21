import { useCallback, useEffect, useState, useMemo, useRef, type ReactNode } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderOpen,
  FileText,
  Search,
  Download,
  Terminal,
  Bot,
  Puzzle,
  Webhook,
  Server,
  Github,
  Star,
  HardDrive,
  ArrowUpCircle,
  RefreshCw,
  Plus,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  Code,
  BookOpen,
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { streamdownLinkSafety, mathPlugin } from '@/components/chat/chat-shared'
import { createStreamdownCodeComponent } from '@/components/chat/CodeBlock'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { resolveAssetUrls } from '@/lib/path-utils'
import type {
  MarketplacePlugin,
  MarketplaceScope,
  PluginAppSummary,
  PluginAuthPolicy,
  PluginDetail,
  PluginInfo,
  PluginInstallPolicy,
  PluginSkillSummary,
  ResourceScope,
  SkillFileEntry,
} from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'

const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
const streamdownPlugins = { code: codePlugin, math: mathPlugin }
const streamdownComponents = { code: createStreamdownCodeComponent(codePlugin) }

// --- Shared file viewing utilities (same pattern as SkillsPage) ---

interface TokenLine {
  tokens: Array<{ content: string; color?: string; htmlStyle?: Record<string, string> }>
}

function FileContentView({ code, language }: { code: string; language: string }) {
  const [lines, setLines] = useState<TokenLine[] | null>(null)
  const [fg, setFg] = useState<string | undefined>(undefined)
  const prevKey = useRef('')

  useEffect(() => {
    const themes = codePlugin.getThemes()
    const lang = language.trim().toLowerCase() || 'md'
    const key = `${lang}:${themes.join(',')}:${code.length}`
    if (key === prevKey.current) return
    prevKey.current = key

    if (!codePlugin.supportsLanguage(lang as never)) {
      setLines(null)
      return
    }

    const apply = (res: { fg?: string; tokens: Array<Array<{ content: string; color?: string; htmlStyle?: Record<string, string> }>> }) => {
      setFg(res.fg)
      setLines(res.tokens.map((line) => ({ tokens: line.map((t) => ({ content: t.content, color: t.color, htmlStyle: t.htmlStyle })) })))
    }

    const result = codePlugin.highlight({ code, language: lang as never, themes }, (res) => apply(res))
    if (result) apply(result)
  }, [code, language])

  return (
    <pre className="whitespace-pre-wrap break-words overflow-x-hidden px-1 text-xs leading-relaxed" style={{ color: fg }}>
      <code>
        {lines
          ? lines.map((line, i) => (
              <span key={i}>
                {line.tokens.map((t, j) => (
                  <span key={j} style={t.color || t.htmlStyle ? { color: t.color, ...(t.htmlStyle ?? {}) } as React.CSSProperties : undefined}>
                    {t.content}
                  </span>
                ))}
                {i < lines.length - 1 && '\n'}
              </span>
            ))
          : code}
      </code>
    </pre>
  )
}

type FrontmatterValue = string | { [key: string]: FrontmatterValue }

function parseFrontmatter(content: string): { meta: Record<string, FrontmatterValue> | null; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: null, body: content }

  const lines = match[1].split('\n')
  const root: Record<string, FrontmatterValue> = {}
  let currentKey: string | null = null

  for (const line of lines) {
    if (!line.trim()) continue
    const indent = line.search(/\S/)
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')

    if (indent === 0) {
      currentKey = key
      root[key] = value || {}
    } else if (currentKey && indent > 0) {
      const parent = root[currentKey]
      if (typeof parent === 'object') {
        parent[key] = value
      }
    }
  }

  const meta = Object.keys(root).length > 0 ? root : null
  return { meta, body: match[2] }
}

function FrontmatterTable({ meta, nested }: { meta: Record<string, FrontmatterValue>; nested?: boolean }) {
  return (
    <table className={`w-full border-collapse border border-border text-xs ${nested ? '' : 'mb-3 rounded-md'}`}>
      <tbody>
        {Object.entries(meta).map(([key, value]) => (
          <tr key={key} className="border-b border-border last:border-b-0">
            <td className="whitespace-nowrap bg-muted/50 px-3 py-1.5 align-top font-medium text-muted-foreground">{key}</td>
            <td className="px-3 py-1.5 text-foreground">
              {typeof value === 'object' ? <FrontmatterTable meta={value} nested /> : value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MarkdownView({ content }: { content: string }) {
  const { meta, body } = parseFrontmatter(content)
  return (
    <div className="px-1">
      {meta && <FrontmatterTable meta={meta} />}
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
        <Streamdown plugins={streamdownPlugins} components={streamdownComponents} linkSafety={streamdownLinkSafety}>
          {body}
        </Streamdown>
      </div>
    </div>
  )
}

const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  md: 'markdown', mdx: 'markdown',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', ps1: 'powershell', env: 'bash',
  py: 'python',
  yaml: 'yaml', yml: 'yaml', toml: 'toml',
  css: 'css', scss: 'scss', html: 'html', htm: 'html', xml: 'xml',
  sql: 'sql',
  rs: 'rust', go: 'go', rb: 'ruby', lua: 'lua', swift: 'swift',
  kt: 'kotlin', kts: 'kotlin', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  php: 'php', dockerfile: 'dockerfile',
}

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG_MAP[ext] ?? 'text'
}

function isMarkdown(filePath: string): boolean {
  return /\.md$/i.test(filePath)
}

// --- Persistent image cache (disk-backed in main, served as data URLs) ---

const cachedImageMap = new Map<string, string | null>()

function isRemoteUrl(url: string): boolean {
  return /^https?:/i.test(url)
}

function useCachedAssets(urls: string[]): string[] {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const pending = urls.filter((u) => isRemoteUrl(u) && !cachedImageMap.has(u))
    if (pending.length === 0) return
    let cancelled = false
    Promise.all(
      pending.map(async (u) => {
        try {
          cachedImageMap.set(u, await window.app.cacheRemoteImage(u))
        } catch {
          cachedImageMap.set(u, null)
        }
      })
    ).then(() => {
      if (!cancelled) setVersion((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [urls])
  return useMemo(
    () =>
      urls
        .map((u) => {
          if (!isRemoteUrl(u)) return u
          const cached = cachedImageMap.get(u)
          if (cached === undefined) return null
          return cached ?? u
        })
        .filter((u): u is string => u !== null),
    [urls, version]
  )
}

function PluginAvatar({ name, iconPath, logoPath, className }: { name: string; iconPath?: string; logoPath?: string; className?: string }) {
  const [failedSrcs, setFailedSrcs] = useState<string[]>([])
  const rawCandidates = useMemo(() => resolveAssetUrls([logoPath, iconPath]), [iconPath, logoPath])
  const candidates = useCachedAssets(rawCandidates)
  const src = candidates.find((candidate) => !failedSrcs.includes(candidate))

  useEffect(() => {
    setFailedSrcs([])
  }, [candidates])

  if (src) {
    return (
      <div className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white', className)}>
        <img
          src={src}
          alt={name}
          onError={() => setFailedSrcs((current) => current.includes(src) ? current : [...current, src])}
          className="size-full object-cover"
        />
      </div>
    )
  }

  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-full bg-muted font-medium uppercase text-muted-foreground', className)}>
      {name[0]}
    </div>
  )
}

function humanizePolicy(value: PluginInstallPolicy | PluginAuthPolicy | undefined): string | null {
  if (!value) return null
  return value.toLowerCase().split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ')
}

function getPluginTitle(plugin: { name: string; displayName?: string }): string {
  return plugin.displayName || plugin.name
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
      {children}
    </span>
  )
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  )
}

function DetailLink({ label, href }: { label: string; href?: string }) {
  if (!href) return null
  return (
    <button
      onClick={() => window.open(href)}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      {label}
      <ExternalLink className="size-3" />
    </button>
  )
}

function PluginAppsList({ apps }: { apps: PluginAppSummary[] }) {
  const { t } = useTranslation()
  if (apps.length === 0) return null
  return (
    <DetailGroup title={t('resources.plugins.detail.apps')}>
      <div className="flex flex-col gap-2">
        {apps.map((app) => (
          <div key={app.id} className="rounded-md border border-border bg-background p-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{app.name}</span>
              {app.needsAuth && <MetaPill>{t('resources.plugins.detail.needsAuth')}</MetaPill>}
            </div>
            {app.description && <p className="mt-1 text-xs text-muted-foreground">{app.description}</p>}
            {app.installUrl && (
              <div className="mt-2">
                <DetailLink label={t('resources.plugins.detail.install')} href={app.installUrl} />
              </div>
            )}
          </div>
        ))}
      </div>
    </DetailGroup>
  )
}

function PluginSkillsList({ skills }: { skills: PluginSkillSummary[] }) {
  const { t } = useTranslation()
  if (skills.length === 0) return null
  return (
    <DetailGroup title={t('resources.plugins.detail.skills')}>
      <div className="flex flex-col gap-2">
        {skills.map((skill) => (
          <div key={skill.path} className="rounded-md border border-border bg-background p-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{skill.displayName || skill.name}</span>
              {!skill.enabled && <MetaPill>{t('resources.plugins.detail.disabled')}</MetaPill>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{skill.shortDescription || skill.description}</p>
          </div>
        ))}
      </div>
    </DetailGroup>
  )
}

function PluginScreenshots({ screenshots }: { screenshots: string[] }) {
  const { t } = useTranslation()
  const imageUrls = useMemo(() => resolveAssetUrls(screenshots), [screenshots])
  if (imageUrls.length === 0) return null
  return (
    <DetailGroup title={t('resources.plugins.detail.screenshots')}>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {imageUrls.map((src) => (
          <img
            key={src}
            src={src}
            alt="plugin screenshot"
            className="h-24 w-40 shrink-0 rounded-md border border-border bg-white object-cover"
          />
        ))}
      </div>
    </DetailGroup>
  )
}

function PluginDetailsPanel({
  plugin,
  apps,
  skills,
}: {
  plugin: PluginInfo | MarketplacePlugin | PluginDetail
  apps?: PluginAppSummary[]
  skills?: PluginSkillSummary[]
}) {
  const { t } = useTranslation()
  const longDescription = plugin.longDescription && plugin.longDescription !== plugin.description
    ? plugin.longDescription
    : null
  const installPolicy = humanizePolicy(plugin.installPolicy)
  const authPolicy = humanizePolicy(plugin.authPolicy)
  const prompts = plugin.defaultPrompts ?? []
  const capabilities = plugin.capabilities ?? []
  const screenshots = plugin.screenshots ?? []
  // Version is shown inline in the card header; everything else surfaces as inline pills here.
  const metadata = [
    plugin.category,
    plugin.brandColor ? `Brand ${plugin.brandColor}` : null,
    plugin.enabled === false ? t('resources.plugins.detail.disabled') : null,
    installPolicy ? `Install ${installPolicy}` : null,
    authPolicy ? `Auth ${authPolicy}` : null,
  ].filter((value): value is string => !!value)

  const hasLinks = !!(plugin.websiteUrl || plugin.privacyPolicyUrl || plugin.termsOfServiceUrl)
  const hasSkillsList = (skills?.length ?? 0) > 0
  const hasAppsList = (apps?.length ?? 0) > 0
  const hasAnyDetail = !!longDescription
    || metadata.length > 0
    || capabilities.length > 0
    || hasLinks
    || prompts.length > 0
    || screenshots.length > 0
    || hasSkillsList
    || hasAppsList

  if (!hasAnyDetail) return null

  return (
    <div className="space-y-4 border-t border-border p-3">
      {(longDescription || metadata.length > 0) && (
        <DetailGroup title={t('resources.plugins.detail.overview')}>
          {longDescription && (
            <p className="text-sm text-muted-foreground">{longDescription}</p>
          )}
          {metadata.length > 0 && (
            <div className={cn('flex flex-wrap gap-1.5', longDescription && 'mt-2')}>
              {metadata.map((value) => (
                <MetaPill key={value}>{value}</MetaPill>
              ))}
            </div>
          )}
        </DetailGroup>
      )}

      {capabilities.length > 0 && (
        <DetailGroup title={t('resources.plugins.detail.capabilities')}>
          <div className="flex flex-wrap gap-1.5">
            {capabilities.map((capability) => (
              <MetaPill key={capability}>{capability}</MetaPill>
            ))}
          </div>
        </DetailGroup>
      )}

      {(plugin.websiteUrl || plugin.privacyPolicyUrl || plugin.termsOfServiceUrl) && (
        <DetailGroup title={t('resources.plugins.detail.links')}>
          <div className="flex flex-wrap gap-2">
            <DetailLink label={t('resources.plugins.detail.website')} href={plugin.websiteUrl} />
            <DetailLink label={t('resources.plugins.detail.privacy')} href={plugin.privacyPolicyUrl} />
            <DetailLink label={t('resources.plugins.detail.terms')} href={plugin.termsOfServiceUrl} />
          </div>
        </DetailGroup>
      )}

      {prompts.length > 0 && (
        <DetailGroup title={t('resources.plugins.detail.starterPrompts')}>
          <div className="flex flex-wrap gap-2">
            {prompts.map((prompt) => (
              <span key={prompt} className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                {prompt}
              </span>
            ))}
          </div>
        </DetailGroup>
      )}

      <PluginScreenshots screenshots={screenshots} />
      <PluginSkillsList skills={skills ?? []} />
      <PluginAppsList apps={apps ?? []} />
    </div>
  )
}

// --- Resource explorer (categorized list + preview) ---

interface PluginResourceEntry {
  label: string
  path: string
  hint?: string
  /** If set, this resource lives in its own folder (e.g. a skill). Clicking it should open the folder browser. */
  resourceFolderPath?: string
}

interface PluginResourceCategory {
  key: 'commands' | 'agents' | 'skills' | 'hooks' | 'mcp' | 'other'
  icon: typeof Terminal
  entries: PluginResourceEntry[]
}

const CATEGORY_FALLBACK_ICONS: Record<PluginResourceCategory['key'], typeof Terminal> = {
  commands: Terminal,
  agents: Bot,
  skills: Puzzle,
  hooks: Webhook,
  mcp: Server,
  other: Folder,
}

function stripExt(name: string): string {
  return name.replace(/\.(md|json|sh|ts|js|yaml|yml|toml)$/i, '')
}

function findChild(dir: SkillFileEntry | undefined, name: string): SkillFileEntry | undefined {
  return dir?.children?.find((c) => c.name === name)
}

function flattenMarkdownLike(dir: SkillFileEntry | undefined, prefix: string): PluginResourceEntry[] {
  if (!dir?.isDirectory || !dir.children) return []
  const out: PluginResourceEntry[] = []
  const walk = (node: SkillFileEntry, p: string) => {
    if (node.isDirectory) {
      for (const child of node.children ?? []) walk(child, `${p}/${child.name}`)
    } else if (/\.(md|json|sh|ts|js)$/i.test(node.name)) {
      const rel = p
      const label = stripExt(node.name)
      out.push({ label, path: rel })
    }
  }
  for (const child of dir.children) walk(child, `${prefix}/${child.name}`)
  return out
}

function categorizePluginFiles(
  files: SkillFileEntry[],
  mcpServerConfigs?: Record<string, unknown>,
  hookEvents?: Record<string, unknown>,
): PluginResourceCategory[] {
  const top = (name: string) => files.find((f) => f.name === name)

  const commandsDir = top('commands')
  const agentsDir = top('agents')
  const hooksDir = top('hooks')
  const skillsDir = top('skills')

  const commands = flattenMarkdownLike(commandsDir, 'commands')
  const agents = flattenMarkdownLike(agentsDir, 'agents')
  const hooks: PluginResourceEntry[] = []
  if (hookEvents && Object.keys(hookEvents).length > 0) {
    for (const event of Object.keys(hookEvents)) {
      hooks.push({ label: event, path: `hooks:${event}` })
    }
  } else {
    if (hooksDir?.isDirectory) hooks.push(...flattenMarkdownLike(hooksDir, 'hooks'))
    const hooksJson = files.find((f) => !f.isDirectory && f.name === 'hooks.json')
    if (hooksJson) hooks.push({ label: 'hooks.json', path: 'hooks.json' })
  }

  const skills: PluginResourceEntry[] = []
  if (skillsDir?.isDirectory && skillsDir.children) {
    for (const skill of skillsDir.children) {
      if (!skill.isDirectory) continue
      const resourceFolderPath = `skills/${skill.name}`
      // Only treat the skill as a "folder-shaped" resource if it carries siblings
      // besides the entry .md (references/, scripts/, additional notes, etc).
      const isFolderShaped = (skill.children?.length ?? 0) > 1
      const folderProp = isFolderShaped ? { resourceFolderPath } : {}
      const skillMd = findChild(skill, 'SKILL.md')
      if (skillMd) {
        skills.push({ label: skill.name, path: `${resourceFolderPath}/SKILL.md`, ...folderProp })
      } else {
        const firstMd = skill.children?.find((c) => !c.isDirectory && /\.md$/i.test(c.name))
        if (firstMd) {
          skills.push({ label: skill.name, path: `${resourceFolderPath}/${firstMd.name}`, ...folderProp })
        }
      }
    }
  }

  const mcp: PluginResourceEntry[] = []
  if (mcpServerConfigs && Object.keys(mcpServerConfigs).length > 0) {
    for (const serverName of Object.keys(mcpServerConfigs)) {
      mcp.push({ label: serverName, path: `mcp:${serverName}` })
    }
  } else {
    const dotMcp = files.find((f) => !f.isDirectory && f.name === '.mcp.json')
    if (dotMcp) mcp.push({ label: '.mcp.json', path: '.mcp.json' })
  }

  const known = new Set(['commands', 'agents', 'hooks', 'skills', '.mcp.json', 'hooks.json', '.claude-plugin'])
  const other: PluginResourceEntry[] = []
  for (const entry of files) {
    if (entry.isDirectory) {
      if (known.has(entry.name)) continue
      for (const child of entry.children ?? []) {
        if (child.isDirectory) continue
        other.push({ label: child.name, path: `${entry.name}/${child.name}` })
      }
    } else {
      if (known.has(entry.name)) continue
      other.push({ label: entry.name, path: entry.name })
    }
  }

  // `other` is intentionally hidden from the category list — folder view still
  // exposes README/LICENSE/etc when the user drills into a directory.
  void other
  const all: PluginResourceCategory[] = [
    { key: 'commands', icon: Terminal, entries: commands },
    { key: 'agents', icon: Bot, entries: agents },
    { key: 'skills', icon: Puzzle, entries: skills },
    { key: 'hooks', icon: Webhook, entries: hooks },
    { key: 'mcp', icon: Server, entries: mcp },
  ]
  return all.filter((c) => c.entries.length > 0)
}

const HOOK_SCRIPT_RE = /\$\{CLAUDE_PLUGIN_ROOT\}[\\/]([^\s"'`)]+)/g

function extractHookScriptPaths(eventConfig: unknown): string[] {
  const out = new Set<string>()
  const visit = (v: unknown) => {
    if (typeof v === 'string') {
      for (const match of v.matchAll(HOOK_SCRIPT_RE)) {
        const rel = match[1].replace(/[\\/]+$/, '')
        if (rel) out.add(rel)
      }
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item)
      return
    }
    if (v && typeof v === 'object') {
      for (const value of Object.values(v as Record<string, unknown>)) visit(value)
    }
  }
  visit(eventConfig)
  return Array.from(out)
}

function findFolderChildren(files: SkillFileEntry[], folderPath: string): SkillFileEntry[] {
  if (!folderPath) return files
  const parts = folderPath.split('/').filter(Boolean)
  let current: SkillFileEntry[] | undefined = files
  for (const part of parts) {
    const found: SkillFileEntry | undefined = current?.find((e) => e.name === part && e.isDirectory)
    if (!found) return []
    current = found.children
  }
  return current ?? []
}

function PluginFileTreeNode({
  entry,
  depth,
  parentPath,
  selectedPath,
  onSelect,
}: {
  entry: SkillFileEntry
  depth: number
  parentPath: string
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(true)
  const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name

  if (entry.isDirectory) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          style={{ paddingLeft: 6 + depth * 12 }}
        >
          {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
          {open ? <FolderOpen className="size-3.5 shrink-0 text-blue-500" /> : <Folder className="size-3.5 shrink-0 text-blue-500" />}
          <span className="truncate">{entry.name}</span>
        </button>
        {open && entry.children?.map((child) => (
          <PluginFileTreeNode
            key={child.name}
            entry={child}
            depth={depth + 1}
            parentPath={fullPath}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      </div>
    )
  }

  const isSelected = fullPath === selectedPath
  return (
    <button
      onClick={() => onSelect(fullPath)}
      className={cn(
        'flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs transition-colors',
        isSelected
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      )}
      style={{ paddingLeft: 6 + depth * 12 + 18 }}
      title={fullPath}
    >
      <FileText className="size-3.5 shrink-0" />
      <span className="truncate">{entry.name}</span>
    </button>
  )
}

function PluginResourceCategoryGroup({
  category,
  selectedPath,
  onSelect,
}: {
  category: PluginResourceCategory
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const Icon = category.icon
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        <Icon className="size-3 shrink-0" />
        <span className="truncate">{t(`resources.plugins.capability.${category.key === 'other' ? 'other' : category.key === 'mcp' ? 'mcp' : category.key}`)}</span>
        <span className="ml-auto text-muted-foreground">{category.entries.length}</span>
      </button>
      {open && (
        <div className="mt-0.5">
          {category.entries.map((entry) => {
            const isSelected = entry.path === selectedPath
            return (
              <button
                key={entry.path}
                onClick={() => onSelect(entry.path)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors',
                  isSelected
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
                style={{ paddingLeft: 22 }}
                title={entry.path}
              >
                <span className="truncate">{entry.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PluginResourceExplorer({
  files,
  mcpServerConfigs,
  hookEvents,
  selectedPath,
  fileContent,
  onSelect,
  emptyHint,
}: {
  files: SkillFileEntry[]
  mcpServerConfigs?: Record<string, unknown>
  hookEvents?: Record<string, unknown>
  selectedPath: string | null
  fileContent: string | null
  onSelect: (relativePath: string) => void
  emptyHint: string
}) {
  const { t } = useTranslation()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mdRawView, setMdRawView] = useState(false)
  const [view, setView] = useState<'categories' | 'folder'>('categories')
  const [folderInfo, setFolderInfo] = useState<{ rootPath: string; categoryKey: PluginResourceCategory['key'] } | null>(null)
  const categories = useMemo(
    () => categorizePluginFiles(files, mcpServerConfigs, hookEvents),
    [files, mcpServerConfigs, hookEvents],
  )

  const isMcpPath = selectedPath?.startsWith('mcp:') ?? false
  const mcpName = isMcpPath ? selectedPath!.slice('mcp:'.length) : null
  const mcpPreview = useMemo(() => {
    if (!mcpName || !mcpServerConfigs || !(mcpName in mcpServerConfigs)) return null
    return JSON.stringify(mcpServerConfigs[mcpName], null, 2)
  }, [mcpName, mcpServerConfigs])

  const isHooksPath = selectedPath?.startsWith('hooks:') ?? false
  const hookEventName = isHooksPath ? selectedPath!.slice('hooks:'.length) : null
  const hookPreview = useMemo(() => {
    if (!hookEventName || !hookEvents || !(hookEventName in hookEvents)) return null
    return JSON.stringify(hookEvents[hookEventName], null, 2)
  }, [hookEventName, hookEvents])

  const hookScripts = useMemo(() => {
    if (!hookEventName || !hookEvents || !(hookEventName in hookEvents)) return []
    return extractHookScriptPaths(hookEvents[hookEventName])
  }, [hookEventName, hookEvents])

  const isVirtualPath = isMcpPath || isHooksPath
  const virtualLabel = isMcpPath ? `.mcp.json › ${mcpName}` : isHooksPath ? `hooks.json › ${hookEventName}` : null
  const virtualContent = isMcpPath ? mcpPreview : isHooksPath ? hookPreview : null

  const displayLabel = isVirtualPath ? virtualLabel : selectedPath
  const displayContent = isVirtualPath ? virtualContent : fileContent
  const displayIsMarkdown = !isVirtualPath && !!selectedPath && isMarkdown(selectedPath)
  const displayLang = isVirtualPath ? 'json' : selectedPath ? inferLanguage(selectedPath) : 'text'

  const folderEntries = useMemo(
    () => findFolderChildren(files, folderInfo?.rootPath ?? ''),
    [files, folderInfo],
  )
  const folderHeaderLabel = useMemo(() => {
    const rp = folderInfo?.rootPath
    if (!rp) return ''
    const last = rp.split('/').pop()
    return last || rp
  }, [folderInfo])
  const folderHeaderIcon = useMemo(() => {
    if (!folderInfo) return null
    return categories.find((c) => c.key === folderInfo.categoryKey)?.icon
      ?? CATEGORY_FALLBACK_ICONS[folderInfo.categoryKey]
      ?? null
  }, [folderInfo, categories])

  const handleCategorySelect = useCallback((path: string) => {
    onSelect(path)
    if (path.startsWith('mcp:') || path.startsWith('hooks:')) return
    // Only resources that live in their own folder (e.g. skills) drill into the FileTree view.
    // Single-file resources (command/agent/hook) just preview, no navigation.
    for (const cat of categories) {
      const entry = cat.entries.find((e) => e.path === path)
      if (!entry) continue
      if (!entry.resourceFolderPath) return
      setFolderInfo({ rootPath: entry.resourceFolderPath, categoryKey: cat.key })
      setView('folder')
      return
    }
  }, [onSelect, categories])

  const handleBack = useCallback(() => {
    setView('categories')
  }, [])

  if (categories.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
        {emptyHint}
      </div>
    )
  }

  return (
    <div className="flex" style={{ height: 320 }}>
      <div
        className="shrink-0 overflow-hidden border-r border-border transition-[width] duration-300 ease-in-out"
        style={{ width: sidebarOpen ? 200 : 0 }}
      >
        <div className="relative h-full w-[200px] overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {view === 'categories' ? (
              <motion.div
                key="categories"
                initial={{ x: -16, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -16, opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="absolute inset-0 overflow-y-auto p-2"
              >
                {categories.map((category) => (
                  <PluginResourceCategoryGroup
                    key={category.key}
                    category={category}
                    selectedPath={selectedPath}
                    onSelect={handleCategorySelect}
                  />
                ))}
              </motion.div>
            ) : (
              <motion.div
                key="folder"
                initial={{ x: 16, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 16, opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="absolute inset-0 flex flex-col"
              >
                <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-1.5 py-1">
                  <button
                    onClick={handleBack}
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    title={t('common.back')}
                  >
                    <ArrowLeft className="size-3.5" />
                  </button>
                  {folderHeaderIcon && (() => {
                    const Icon = folderHeaderIcon
                    return <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  })()}
                  <span
                    className="flex-1 truncate text-xs font-medium text-foreground"
                    title={folderInfo?.rootPath || ''}
                  >
                    {folderHeaderLabel}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {folderEntries.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                      {t('resources.plugins.detail.emptyFolder')}
                    </div>
                  ) : (
                    folderEntries.map((entry) => (
                      <PluginFileTreeNode
                        key={entry.name}
                        entry={entry}
                        depth={0}
                        parentPath={folderInfo?.rootPath ?? ''}
                        selectedPath={selectedPath}
                        onSelect={onSelect}
                      />
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            {sidebarOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
          </button>
          {displayLabel && (
            <span className="flex-1 truncate text-[11px] text-muted-foreground">{displayLabel}</span>
          )}
          {displayIsMarkdown && (
            <button
              onClick={() => setMdRawView(!mdRawView)}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              title={mdRawView ? t('resources.skills.previewToggle') : t('resources.skills.sourceToggle')}
            >
              {mdRawView ? <BookOpen className="size-3.5" /> : <Code className="size-3.5" />}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-auto p-2">
          {displayContent != null ? (
            displayIsMarkdown && !mdRawView ? (
              <MarkdownView content={displayContent} />
            ) : (
              <FileContentView code={displayContent} language={displayLang} />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {t('resources.plugins.detail.selectResource')}
            </div>
          )}
          {isHooksPath && hookScripts.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('resources.plugins.detail.referencedScripts')}
              </div>
              <div className="flex flex-col gap-0.5">
                {hookScripts.map((scriptPath) => (
                  <button
                    key={scriptPath}
                    onClick={() => onSelect(scriptPath)}
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    title={scriptPath}
                  >
                    <FileText className="size-3.5 shrink-0" />
                    <span className="truncate">{scriptPath}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Content badges ---

const BADGE_CONFIG = [
  { key: 'hasCommands', labelKey: 'resources.plugins.capability.commands', icon: Terminal },
  { key: 'hasAgents', labelKey: 'resources.plugins.capability.agents', icon: Bot },
  { key: 'hasSkills', labelKey: 'resources.plugins.capability.skills', icon: Puzzle },
  { key: 'hasHooks', labelKey: 'resources.plugins.capability.hooks', icon: Webhook },
  { key: 'hasMcpServers', labelKey: 'resources.plugins.capability.mcp', icon: Server },
] as const

function ContentBadges({ plugin }: { plugin: PluginInfo }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-1">
      {BADGE_CONFIG.map(({ key, labelKey, icon: Icon }) =>
        plugin[key] ? (
          <span
            key={key}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            <Icon className="size-2.5" />
            {t(labelKey)}
          </span>
        ) : null
      )}
    </div>
  )
}

// --- Installed plugin card ---

function PluginCard({ plugin }: { plugin: PluginInfo }) {
  const { t } = useTranslation()
  const { pluginDetail, pluginFileContent, pluginFilePath, readPlugin, readPluginFile, clearPluginDetail } = useSettingsStore()
  const isExpanded = pluginDetail?.key === plugin.key

  const handleToggle = () => {
    if (isExpanded) {
      clearPluginDetail()
    } else {
      readPlugin(plugin.key)
    }
  }

  const handleFileSelect = useCallback((relativePath: string) => {
    readPluginFile(plugin.key, relativePath)
  }, [plugin.key, readPluginFile])

  return (
    <div className="rounded-lg border border-border bg-card">
      <div
        role="button"
        onClick={handleToggle}
        className="flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50"
      >
        <PluginAvatar name={plugin.name} iconPath={plugin.iconPath} logoPath={plugin.logoPath} className="size-9 text-sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{getPluginTitle(plugin)}</span>
            {plugin.author && (
              <span className="text-xs text-muted-foreground">by {plugin.author}</span>
            )}
            {plugin.version && (
              <span className="text-xs text-muted-foreground">v{plugin.version}</span>
            )}
            {plugin.hasUpdate && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                <ArrowUpCircle className="size-2.5" />
                Update available
              </span>
            )}
          </div>
          {plugin.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{plugin.description}</p>
          )}
          <div className="mt-1.5">
            <ContentBadges plugin={plugin} />
          </div>
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="shrink-0"
        >
          <ChevronRight className="size-4 text-muted-foreground" />
        </motion.div>
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && pluginDetail && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <PluginDetailsPanel
              plugin={pluginDetail}
              apps={pluginDetail.apps}
              skills={pluginDetail.skills}
            />
            <div className="border-t border-border">
              <PluginResourceExplorer
                files={pluginDetail.files}
                mcpServerConfigs={pluginDetail.mcpServerConfigs}
                hookEvents={pluginDetail.hookEvents}
                selectedPath={pluginFilePath}
                fileContent={pluginFileContent}
                onSelect={handleFileSelect}
                emptyHint={t('resources.plugins.detail.noFiles')}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PluginSection({ title, plugins }: { title: string; plugins: PluginInfo[] }) {
  if (plugins.length === 0) return null
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="flex flex-col gap-2">
        {plugins.map((plugin) => (
          <PluginCard key={`${plugin.scope}:${plugin.key}`} plugin={plugin} />
        ))}
      </div>
    </div>
  )
}

// --- Marketplace plugin card ---

function PluginInstallCard({
  plugin,
  onInstall,
  allowProjectInstall,
  canExplore,
}: {
  plugin: MarketplacePlugin
  onInstall: (key: string, scope: ResourceScope) => void
  allowProjectInstall: boolean
  canExplore: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [scopeChoice, setScopeChoice] = useState(false)
  const installScopes = allowProjectInstall ? (['user', 'project'] as const) : (['user'] as const)
  const {
    marketplacePluginDetail,
    marketplacePluginFileContent,
    marketplacePluginFilePath,
    readMarketplacePlugin,
    readMarketplacePluginFile,
    clearMarketplacePluginDetail,
  } = useSettingsStore()

  const detail = canExplore && marketplacePluginDetail?.key === plugin.key ? marketplacePluginDetail : null

  const handleToggle = () => {
    if (expanded) {
      if (detail) clearMarketplacePluginDetail()
      setExpanded(false)
    } else {
      setExpanded(true)
      if (canExplore) {
        readMarketplacePlugin(plugin.marketplace, plugin.name)
      }
    }
  }

  const handleFileSelect = useCallback((relativePath: string) => {
    readMarketplacePluginFile(plugin.marketplace, plugin.name, relativePath)
  }, [plugin.marketplace, plugin.name, readMarketplacePluginFile])

  const handleInstall = async (scope: ResourceScope) => {
    setScopeChoice(false)
    setInstalling(true)
    try {
      await onInstall(plugin.key, scope)
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div
        role="button"
        onClick={handleToggle}
        className="flex cursor-pointer items-start gap-3 p-3 transition-colors hover:bg-muted/50"
      >
        <PluginAvatar name={plugin.name} iconPath={plugin.iconPath} logoPath={plugin.logoPath} className="size-9 text-sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{getPluginTitle(plugin)}</span>
            {plugin.author && (
              <span className="text-xs text-muted-foreground">by {plugin.author}</span>
            )}
            {plugin.version && (
              <span className="text-xs text-muted-foreground">v{plugin.version}</span>
            )}
          </div>
          {plugin.description && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{plugin.description}</p>
          )}
          {plugin.installCount != null && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {plugin.installCount.toLocaleString()} installs
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(event) => event.stopPropagation()}>
          {plugin.installed ? (
            <span className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              Installed
            </span>
          ) : scopeChoice ? (
            <div className="flex gap-1">
              {installScopes.map((s) => (
                <button
                  key={s}
                  onClick={() => handleInstall(s)}
                  disabled={installing}
                  className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
              <button
                onClick={() => setScopeChoice(false)}
                className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => allowProjectInstall ? setScopeChoice(true) : handleInstall('user')}
              disabled={installing}
            >
              {installing ? (
                'Installing...'
              ) : (
                <>
                  <Download className="size-3.5" />
                  Install
                </>
              )}
            </Button>
          )}
          <motion.div
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="shrink-0"
          >
            <ChevronRight className="size-4 text-muted-foreground" />
          </motion.div>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <PluginDetailsPanel plugin={detail ?? plugin} />
            {canExplore && (
              <div className="border-t border-border">
                {detail ? (
                  <PluginResourceExplorer
                    files={detail.files}
                    mcpServerConfigs={detail.mcpServerConfigs}
                    hookEvents={detail.hookEvents}
                    selectedPath={marketplacePluginFilePath}
                    fileContent={marketplacePluginFileContent}
                    onSelect={handleFileSelect}
                    emptyHint={t('resources.plugins.detail.noFiles')}
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                    {t('common.loading')}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// --- Marketplace list card ---

interface MarketplaceSummary {
  name: string
  pluginCount: number
  installedCount: number
  lastUpdated?: string
  source?: string
  iconPath?: string
  logoPath?: string
  scope?: MarketplaceScope
}

function ScopeBadge({ scope }: { scope?: MarketplaceScope }) {
  const { t } = useTranslation()
  if (!scope) return null
  const styles: Record<MarketplaceScope, string> = {
    official: 'bg-primary/10 text-primary',
    user: 'bg-blue-500/10 text-blue-500',
    project: 'bg-emerald-500/10 text-emerald-500',
    local: 'bg-amber-500/10 text-amber-500',
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', styles[scope])}>
      {t(`resources.plugins.marketplaceScope.${scope}`)}
    </span>
  )
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function MarketplaceListCard({ mp, onClick }: { mp: MarketplaceSummary; onClick: () => void }) {
  return (
    <div
      role="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent/50"
    >
      <PluginAvatar name={mp.name} iconPath={mp.iconPath} logoPath={mp.logoPath} className="size-10 text-base" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{mp.name}</p>
          <ScopeBadge scope={mp.scope} />
        </div>
        {mp.source && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            {isGithubSource(mp.source)
              ? <Github className="size-3 shrink-0" />
              : <HardDrive className="size-3 shrink-0" />}
            <span className="truncate">{mp.source}</span>
            {isGithubSource(mp.source) && <GithubStars source={mp.source} className="shrink-0" />}
          </p>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {mp.pluginCount} plugin{mp.pluginCount !== 1 ? 's' : ''}
          {mp.installedCount > 0 && ` · ${mp.installedCount} installed`}
          {mp.lastUpdated && ` · updated ${formatRelativeTime(mp.lastUpdated)}`}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </div>
  )
}

// --- Source display helper ---

function isGithubSource(source?: string): boolean {
  return !!source && source.includes('/') && !source.startsWith('/')
}

// --- GitHub star count ---

const githubStarsCache = new Map<string, number | null>()

function githubRepoSlug(source: string): string {
  return source.split('/').slice(0, 2).join('/')
}

function formatStarCount(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`
}

function useGithubStars(source: string | undefined): number | null {
  const slug = source && isGithubSource(source) ? githubRepoSlug(source) : null
  const [stars, setStars] = useState<number | null>(() => (slug ? githubStarsCache.get(slug) ?? null : null))
  useEffect(() => {
    if (!slug) return
    if (githubStarsCache.has(slug)) {
      setStars(githubStarsCache.get(slug) ?? null)
      return
    }
    let cancelled = false
    window.app
      .getGithubStars(slug)
      .then((count) => {
        githubStarsCache.set(slug, count)
        if (!cancelled) setStars(count)
      })
      .catch(() => {
        githubStarsCache.set(slug, null)
      })
    return () => {
      cancelled = true
    }
  }, [slug])
  return stars
}

function GithubStars({ source, className }: { source: string; className?: string }) {
  const stars = useGithubStars(source)
  if (stars == null) return null
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-muted-foreground', className)}>
      <Star className="size-3 shrink-0" />
      {formatStarCount(stars)}
    </span>
  )
}

function SourceLink({ source, size = 'sm' }: { source: string; size?: 'sm' | 'md' }) {
  const textClass = size === 'md' ? 'text-sm' : 'text-xs'
  const iconClass = size === 'md' ? 'size-3.5' : 'size-3'
  const linkIconClass = size === 'md' ? 'size-3' : 'size-2.5'

  if (isGithubSource(source)) {
    const url = `https://github.com/${source}`
    return (
      <button
        onClick={(e) => { e.stopPropagation(); window.open(url) }}
        className={cn('inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors', textClass)}
      >
        <Github className={cn(iconClass, 'shrink-0')} />
        <span className="truncate">{source}</span>
        <ExternalLink className={cn(linkIconClass, 'shrink-0')} />
      </button>
    )
  }
  return (
    <span className={cn('inline-flex items-center gap-1 text-muted-foreground truncate', textClass)}>
      <HardDrive className={cn(iconClass, 'shrink-0')} />
      {source}
    </span>
  )
}

// --- Marketplace detail view (plugins of a selected marketplace) ---

function MarketplaceDetailView({
  summary,
  plugins,
  onBack,
  onInstall,
  onUpdateMarketplace,
  onRemoveMarketplace,
  canUpdateMarketplace,
  canRemoveMarketplace,
  allowProjectInstall,
  canExplore,
}: {
  summary: MarketplaceSummary
  plugins: MarketplacePlugin[]
  onBack: () => void
  onInstall: (key: string, scope: ResourceScope) => void
  onUpdateMarketplace: () => Promise<void>
  onRemoveMarketplace?: () => Promise<void>
  canUpdateMarketplace: boolean
  canRemoveMarketplace: boolean
  allowProjectInstall: boolean
  canExplore: boolean
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [updating, setUpdating] = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [removing, setRemoving] = useState(false)

  const handleUpdate = async () => {
    setUpdating(true)
    try {
      await onUpdateMarketplace()
    } finally {
      setUpdating(false)
    }
  }

  const handleRemove = async () => {
    if (!onRemoveMarketplace) return
    setRemoving(true)
    try {
      await onRemoveMarketplace()
      setRemoveConfirmOpen(false)
    } finally {
      setRemoving(false)
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return plugins
    const q = search.toLowerCase()
    return plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.author?.toLowerCase().includes(q)
    )
  }, [plugins, search])

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        Marketplaces
      </button>

      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-lg font-semibold truncate">{summary.name}</h2>
            <ScopeBadge scope={summary.scope} />
          </div>
          <div className="flex items-center gap-2">
            <ProjectSelector />
            {canUpdateMarketplace && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleUpdate}
                disabled={updating}
              >
                <RefreshCw className={cn('size-3.5', updating && 'animate-spin')} />
                {updating ? t('resources.plugins.updating') : t('resources.plugins.update')}
              </Button>
            )}
            {canRemoveMarketplace && summary.scope !== 'official' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRemoveConfirmOpen(true)}
                className="text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" />
                {t('resources.plugins.removeMarketplace')}
              </Button>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          {summary.source && <SourceLink source={summary.source} size="md" />}
          {summary.source && isGithubSource(summary.source) && (
            <GithubStars source={summary.source} className="text-sm" />
          )}
          <span className="text-sm text-muted-foreground">
            {summary.pluginCount} plugin{summary.pluginCount !== 1 ? 's' : ''}
            {summary.installedCount > 0 && ` · ${summary.installedCount} installed`}
          </span>
          {summary.lastUpdated && (
            <span className="text-sm text-muted-foreground">
              updated {formatRelativeTime(summary.lastUpdated)}
            </span>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('resources.plugins.searchPlaceholder')}
          className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-ring"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {search ? t('resources.plugins.searchNoMatch') : t('resources.plugins.marketplaceEmpty')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((plugin) => (
            <PluginInstallCard key={plugin.key} plugin={plugin} onInstall={onInstall} allowProjectInstall={allowProjectInstall} canExplore={canExplore} />
          ))}
        </div>
      )}

      <Dialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('resources.plugins.removeMarketplaceTitle')}</DialogTitle>
            <DialogDescription>
              {t('resources.plugins.removeMarketplaceDesc', {
                name: summary.name,
                scope: summary.scope ? t(`resources.plugins.marketplaceScope.${summary.scope}`) : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveConfirmOpen(false)} disabled={removing}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleRemove} disabled={removing}>
              {removing ? t('resources.plugins.removing') : t('resources.plugins.removeMarketplace')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// --- Add marketplace dialog ---

function AddMarketplaceDialog({
  open,
  onOpenChange,
  onAdd,
  allowProjectScope,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (source: string, scope: ResourceScope) => Promise<void>
  allowProjectScope: boolean
}) {
  const { t } = useTranslation()
  const [source, setSource] = useState('')
  const [scope, setScope] = useState<ResourceScope>('user')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setSource('')
      setScope('user')
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  const handleSubmit = async () => {
    const trimmed = source.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onAdd(trimmed, scope)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('resources.plugins.addMarketplaceTitle')}</DialogTitle>
          <DialogDescription>{t('resources.plugins.addMarketplaceDesc')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('resources.plugins.addMarketplaceSourceLabel')}
            </label>
            <Input
              autoFocus
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={t('resources.plugins.addMarketplaceSourcePlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !submitting) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              disabled={submitting}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('resources.plugins.addMarketplaceSourceHint')}
            </p>
          </div>
          {allowProjectScope && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('resources.plugins.addMarketplaceScopeLabel')}
              </label>
              <div className="flex gap-1 rounded-md bg-muted p-1">
                {(['user', 'project'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    disabled={submitting}
                    className={cn(
                      'flex-1 rounded-sm px-3 py-1 text-xs font-medium transition-colors',
                      scope === s
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t(`resources.plugins.scope.${s}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!source.trim() || submitting}>
            {submitting ? t('resources.plugins.adding') : t('resources.plugins.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- Main page ---

type PluginsTab = 'marketplace' | 'installed'

function PluginsLoadingState() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8">
      <RefreshCw className="size-4 animate-spin text-muted-foreground" />
      <span className="text-sm text-muted-foreground">{t('resources.plugins.loading')}</span>
    </div>
  )
}

export function PluginsPage() {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  const {
    plugins,
    marketplacePlugins,
    pluginsLoading,
    reloadPlugins,
    fetchPlugins,
    fetchMarketplacePlugins,
    installPlugin,
    clearPluginDetail,
    clearMarketplacePluginDetail,
    addMarketplace,
    removeMarketplace,
  } = useSettingsStore()
  const [tab, setTab] = useState<PluginsTab>('marketplace')
  const [selectedMarketplace, setSelectedMarketplace] = useState<string | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const isCodex = settingsProvider === 'codex'
  const canManageMarketplaces = !isCodex

  useEffect(() => {
    clearPluginDetail()
    clearMarketplacePluginDetail()
    setSelectedMarketplace(null)
    reloadPlugins()
  }, [currentFolder, settingsProvider, clearPluginDetail, clearMarketplacePluginDetail, reloadPlugins])

  // Derive marketplace summaries from plugins data
  const marketplaceSummaries = useMemo(() => {
    const map = new Map<string, MarketplaceSummary>()
    for (const p of marketplacePlugins) {
      let mp = map.get(p.marketplace)
      if (!mp) {
        mp = {
          name: p.marketplace,
          pluginCount: 0,
          installedCount: 0,
          lastUpdated: p.marketplaceLastUpdated,
          source: p.marketplaceSource,
          iconPath: p.iconPath,
          logoPath: p.logoPath,
          scope: p.marketplaceScope,
        }
        map.set(p.marketplace, mp)
      }
      mp.pluginCount++
      if (p.installed) mp.installedCount++
      if (!mp.logoPath && p.logoPath) mp.logoPath = p.logoPath
      if (!mp.iconPath && p.iconPath) mp.iconPath = p.iconPath
      if (!mp.lastUpdated && p.marketplaceLastUpdated) mp.lastUpdated = p.marketplaceLastUpdated
      if (!mp.source && p.marketplaceSource) mp.source = p.marketplaceSource
      if (!mp.scope && p.marketplaceScope) mp.scope = p.marketplaceScope
    }
    // Fall back to the repo owner's avatar for GitHub-hosted marketplaces that don't ship a logo.
    for (const mp of map.values()) {
      if (mp.logoPath || mp.iconPath) continue
      if (!mp.source || !isGithubSource(mp.source)) continue
      const owner = mp.source.split('/')[0]
      if (owner) mp.logoPath = `https://github.com/${owner}.png?size=80`
    }
    // Sort by plugin count descending
    return Array.from(map.values()).sort((a, b) => b.pluginCount - a.pluginCount)
  }, [marketplacePlugins])

  const selectedPlugins = useMemo(() => {
    if (!selectedMarketplace) return []
    return marketplacePlugins.filter((p) => p.marketplace === selectedMarketplace)
  }, [marketplacePlugins, selectedMarketplace])

  const userPlugins = plugins.filter((p) => p.scope === 'user')
  const projectPlugins = plugins.filter((p) => p.scope === 'project')
  const updatablePlugins = plugins.filter((p) => p.hasUpdate)
  const [updatingAll, setUpdatingAll] = useState(false)

  const handleInstall = async (key: string, scope: ResourceScope) => {
    await installPlugin(key, scope)
  }

  const handleUpdateAll = async () => {
    setUpdatingAll(true)
    try {
      const pp = useAppStore.getState().currentFolder ?? ''
      await window.app.updatePlugins(pp, updatablePlugins.map((p) => ({ key: p.key, scope: p.scope })))
      await fetchPlugins()
      await fetchMarketplacePlugins()
    } finally {
      setUpdatingAll(false)
    }
  }

  // Marketplace detail → full-page, no tabs
  if (selectedMarketplace) {
    const summary = marketplaceSummaries.find((m) => m.name === selectedMarketplace)
    if (summary) {
      return (
        <div className="mx-auto max-w-4xl">
          <MarketplaceDetailView
            summary={summary}
            plugins={selectedPlugins}
            onBack={() => setSelectedMarketplace(null)}
            onInstall={handleInstall}
            onUpdateMarketplace={async () => {
              await window.app.updateMarketplace(selectedMarketplace!)
              await fetchMarketplacePlugins()
            }}
            onRemoveMarketplace={canManageMarketplaces && summary.scope && summary.scope !== 'official' ? async () => {
              await removeMarketplace(selectedMarketplace!, summary.scope!)
              setSelectedMarketplace(null)
            } : undefined}
            canUpdateMarketplace={!isCodex}
            canRemoveMarketplace={canManageMarketplaces && summary.scope !== 'official'}
            allowProjectInstall={!isCodex}
            canExplore={!isCodex}
          />
        </div>
      )
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('resources.plugins.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {isCodex ? t('resources.plugins.subtitleCodex') : t('resources.plugins.subtitleClaude')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProjectSelector />
          {tab === 'marketplace' && canManageMarketplaces && (
            <Button size="sm" variant="outline" onClick={() => setAddDialogOpen(true)}>
              <Plus className="size-3.5" />
              {t('resources.plugins.addMarketplace')}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
        {([
          { id: 'marketplace' as const, label: t('resources.plugins.tabMarketplace') },
          { id: 'installed' as const, label: t('resources.plugins.tabInstalled', { count: plugins.length }) },
        ]).map((tabEntry) => (
          <button
            key={tabEntry.id}
            onClick={() => setTab(tabEntry.id)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === tabEntry.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tabEntry.label}
          </button>
        ))}
      </div>

      {/* Marketplace tab */}
      {tab === 'marketplace' && (
        <div>
          {pluginsLoading ? (
            <PluginsLoadingState />
          ) : marketplaceSummaries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">{t('resources.plugins.emptyMarketplace')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isCodex ? t('resources.plugins.emptyMarketplaceHintCodex') : t('resources.plugins.emptyMarketplaceHintClaude')}
              </p>
              {canManageMarketplaces && (
                <Button size="sm" variant="outline" className="mt-4" onClick={() => setAddDialogOpen(true)}>
                  <Plus className="size-3.5" />
                  {t('resources.plugins.addMarketplace')}
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {marketplaceSummaries.map((mp) => (
                <MarketplaceListCard
                  key={mp.name}
                  mp={mp}
                  onClick={() => setSelectedMarketplace(mp.name)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <AddMarketplaceDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdd={addMarketplace}
        allowProjectScope={!isCodex}
      />

      {/* Installed tab */}
      {tab === 'installed' && (
        <div>
          {pluginsLoading ? (
            <PluginsLoadingState />
          ) : plugins.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">{t('resources.plugins.emptyInstalled')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isCodex ? t('resources.plugins.emptyInstalledHintCodex') : t('resources.plugins.emptyInstalledHintClaude')}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {!isCodex && updatablePlugins.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t('resources.plugins.updateAvailable', { count: updatablePlugins.length })}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleUpdateAll}
                    disabled={updatingAll}
                    className="text-amber-500 border-amber-500/30 hover:bg-amber-500/10"
                  >
                    <ArrowUpCircle className="size-3.5" />
                    {updatingAll ? t('resources.plugins.updating') : t('resources.plugins.updateAll')}
                  </Button>
                </div>
              )}
              <PluginSection title={t('resources.sectionUser')} plugins={userPlugins} />
              <PluginSection title={t('resources.sectionProject')} plugins={projectPlugins} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
