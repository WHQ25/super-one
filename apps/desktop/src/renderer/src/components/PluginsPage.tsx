import { useEffect, useState, useMemo, useRef, type ReactNode } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderOpen,
  Search,
  Download,
  Terminal,
  Bot,
  Puzzle,
  Webhook,
  Server,
  Github,
  HardDrive,
  ArrowUpCircle,
  RefreshCw,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { streamdownLinkSafety, mathPlugin } from '@/components/chat/chat-shared'
import { createStreamdownCodeComponent } from '@/components/chat/CodeBlock'
import { Button } from '@superone/ui/components/ui/button'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { resolveAssetUrls } from '@/lib/path-utils'
import type {
  MarketplacePlugin,
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
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', json: 'json',
  md: 'markdown', sh: 'bash', bash: 'bash', zsh: 'bash', py: 'python',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', css: 'css', html: 'html',
  xml: 'xml', sql: 'sql', rs: 'rust', go: 'go', rb: 'ruby',
}

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG_MAP[ext] ?? 'text'
}

function isMarkdown(filePath: string): boolean {
  return /\.md$/i.test(filePath)
}

function buildPath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name
}

function PluginAvatar({ name, iconPath, logoPath, className }: { name: string; iconPath?: string; logoPath?: string; className?: string }) {
  const [failedSrcs, setFailedSrcs] = useState<string[]>([])
  const candidates = useMemo(() => resolveAssetUrls([logoPath, iconPath]), [iconPath, logoPath])
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
  mcpServers,
}: {
  plugin: PluginInfo | MarketplacePlugin | PluginDetail
  apps?: PluginAppSummary[]
  skills?: PluginSkillSummary[]
  mcpServers?: string[]
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
  const metadata = [
    'version' in plugin && plugin.version ? `Version ${plugin.version}` : null,
    plugin.category,
    plugin.brandColor ? `Brand ${plugin.brandColor}` : null,
    plugin.enabled === false ? t('resources.plugins.detail.disabled') : null,
    installPolicy ? `Install ${installPolicy}` : null,
    authPolicy ? `Auth ${authPolicy}` : null,
  ].filter((value): value is string => !!value)

  return (
    <div className="space-y-4 p-3">
      {longDescription && (
        <DetailGroup title={t('resources.plugins.detail.overview')}>
          <p className="text-sm text-muted-foreground">{longDescription}</p>
        </DetailGroup>
      )}

      {metadata.length > 0 && (
        <DetailGroup title={t('resources.plugins.detail.metadata')}>
          <div className="flex flex-wrap gap-1.5">
            {metadata.map((value) => (
              <MetaPill key={value}>{value}</MetaPill>
            ))}
          </div>
        </DetailGroup>
      )}

      {(capabilities.length > 0 || mcpServers?.length) && (
        <div className="grid gap-3 md:grid-cols-2">
          {capabilities.length > 0 && (
            <DetailGroup title={t('resources.plugins.detail.capabilities')}>
              <div className="flex flex-wrap gap-1.5">
                {capabilities.map((capability) => (
                  <MetaPill key={capability}>{capability}</MetaPill>
                ))}
              </div>
            </DetailGroup>
          )}
          {(mcpServers?.length ?? 0) > 0 && (
            <DetailGroup title={t('resources.plugins.detail.mcpServers')}>
              <div className="flex flex-wrap gap-1.5">
                {mcpServers?.map((server) => (
                  <MetaPill key={server}>{server}</MetaPill>
                ))}
              </div>
            </DetailGroup>
          )}
        </div>
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

// --- File tree ---

function FileTreeNode({
  entry,
  depth,
  pathPrefix,
  itemKey,
  selectedPath,
  onSelect,
}: {
  entry: SkillFileEntry
  depth: number
  pathPrefix: string
  itemKey: string
  selectedPath: string | null
  onSelect: (key: string, relativePath: string) => void
}) {
  const [open, setOpen] = useState(true)
  const fullPath = buildPath(pathPrefix, entry.name)
  const isSelected = !entry.isDirectory && fullPath === selectedPath

  if (entry.isDirectory) {
    return (
      <div style={{ paddingLeft: depth * 12 }}>
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        >
          {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
          {open ? <FolderOpen className="size-3.5 shrink-0 text-blue-500" /> : <Folder className="size-3.5 shrink-0 text-blue-500" />}
          <span className="truncate">{entry.name}</span>
        </button>
        {open && entry.children && (
          <div>
            {entry.children.map((child) => (
              <FileTreeNode
                key={child.name}
                entry={child}
                depth={depth + 1}
                pathPrefix={fullPath}
                itemKey={itemKey}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <button
        onClick={() => onSelect(itemKey, fullPath)}
        className={`flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs transition-colors ${
          isSelected
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
        }`}
        style={{ paddingLeft: `${12 + 6}px` }}
      >
        <FileIcon name={entry.name} />
        <span className="truncate">{entry.name}</span>
      </button>
    </div>
  )
}

function FileTree({
  entries,
  itemKey,
  selectedPath,
  onSelect,
}: {
  entries: SkillFileEntry[]
  itemKey: string
  selectedPath: string | null
  onSelect: (key: string, relativePath: string) => void
}) {
  return (
    <div>
      {entries.map((entry) => (
        <FileTreeNode
          key={entry.name}
          entry={entry}
          depth={0}
          pathPrefix=""
          itemKey={itemKey}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
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
  const { pluginDetail, readPlugin, clearPluginDetail } = useSettingsStore()
  const isExpanded = pluginDetail?.key === plugin.key

  const handleToggle = () => {
    if (isExpanded) {
      clearPluginDetail()
    } else {
      readPlugin(plugin.key)
    }
  }

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
        {isExpanded ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
      </div>

      {isExpanded && pluginDetail && (
        <div className="border-t border-border">
          <PluginDetailsPanel
            plugin={pluginDetail}
            apps={pluginDetail.apps}
            skills={pluginDetail.skills}
            mcpServers={pluginDetail.mcpServers}
          />
        </div>
      )}
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
}: {
  plugin: MarketplacePlugin
  onInstall: (key: string, scope: ResourceScope) => void
  allowProjectInstall: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [scopeChoice, setScopeChoice] = useState(false)
  const installScopes = allowProjectInstall ? (['user', 'project'] as const) : (['user'] as const)

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
        onClick={() => setExpanded((current) => !current)}
        className="flex cursor-pointer items-start gap-3 p-3 transition-colors hover:bg-muted/50"
      >
        <PluginAvatar name={plugin.name} iconPath={plugin.iconPath} logoPath={plugin.logoPath} className="size-9 text-sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{getPluginTitle(plugin)}</span>
            {plugin.author && (
              <span className="text-xs text-muted-foreground">by {plugin.author}</span>
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
          {expanded ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border">
          <PluginDetailsPanel plugin={plugin} />
        </div>
      )}
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
        <p className="text-sm font-medium truncate">{mp.name}</p>
        {mp.source && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground truncate">
            {isGithubSource(mp.source)
              ? <><Github className="size-3 shrink-0" />{mp.source}</>
              : <><HardDrive className="size-3 shrink-0" />{mp.source}</>
            }
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
  canUpdateMarketplace,
  allowProjectInstall,
}: {
  summary: MarketplaceSummary
  plugins: MarketplacePlugin[]
  onBack: () => void
  onInstall: (key: string, scope: ResourceScope) => void
  onUpdateMarketplace: () => Promise<void>
  canUpdateMarketplace: boolean
  allowProjectInstall: boolean
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [updating, setUpdating] = useState(false)

  const handleUpdate = async () => {
    setUpdating(true)
    try {
      await onUpdateMarketplace()
    } finally {
      setUpdating(false)
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
          <h2 className="text-lg font-semibold">{summary.name}</h2>
          <div className="flex items-center gap-2">
            <ProjectSelector mode="switch" />
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
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          {summary.source && <SourceLink source={summary.source} size="md" />}
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
            <PluginInstallCard key={plugin.key} plugin={plugin} onInstall={onInstall} allowProjectInstall={allowProjectInstall} />
          ))}
        </div>
      )}
    </div>
  )
}

// --- Main page ---

type PluginsTab = 'marketplace' | 'installed'

export function PluginsPage() {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  const {
    plugins,
    marketplacePlugins,
    fetchPlugins,
    fetchMarketplacePlugins,
    installPlugin,
    clearPluginDetail,
  } = useSettingsStore()
  const [tab, setTab] = useState<PluginsTab>('marketplace')
  const [selectedMarketplace, setSelectedMarketplace] = useState<string | null>(null)
  const isCodex = settingsProvider === 'codex'

  useEffect(() => {
    clearPluginDetail()
    setSelectedMarketplace(null)
    fetchPlugins()
    fetchMarketplacePlugins()
  }, [currentFolder, settingsProvider, clearPluginDetail, fetchPlugins, fetchMarketplacePlugins])

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
        }
        map.set(p.marketplace, mp)
      }
      mp.pluginCount++
      if (p.installed) mp.installedCount++
      if (!mp.logoPath && p.logoPath) mp.logoPath = p.logoPath
      if (!mp.iconPath && p.iconPath) mp.iconPath = p.iconPath
      if (!mp.lastUpdated && p.marketplaceLastUpdated) mp.lastUpdated = p.marketplaceLastUpdated
      if (!mp.source && p.marketplaceSource) mp.source = p.marketplaceSource
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
        <div className="mx-auto max-w-2xl">
          <MarketplaceDetailView
            summary={summary}
            plugins={selectedPlugins}
            onBack={() => setSelectedMarketplace(null)}
            onInstall={handleInstall}
            onUpdateMarketplace={async () => {
              await window.app.updateMarketplace(selectedMarketplace!)
              await fetchMarketplacePlugins()
            }}
            canUpdateMarketplace={!isCodex}
            allowProjectInstall={!isCodex}
          />
        </div>
      )
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('resources.plugins.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {isCodex ? t('resources.plugins.subtitleCodex') : t('resources.plugins.subtitleClaude')}
          </p>
        </div>
        <ProjectSelector mode="switch" />
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
        marketplaceSummaries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">{t('resources.plugins.emptyMarketplace')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isCodex ? t('resources.plugins.emptyMarketplaceHintCodex') : t('resources.plugins.emptyMarketplaceHintClaude')}
              </p>
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
        )
      )}

      {/* Installed tab */}
      {tab === 'installed' && (
        <div>
          {plugins.length === 0 ? (
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
