import { useEffect, useCallback, useState, useMemo, useRef } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Code,
  BookOpen,
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
import { FileIcon } from '@/components/ui/FileIcon'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { streamdownLinkSafety } from '@/components/chat/chat-shared'
import { createStreamdownCodeComponent } from '@/components/chat/CodeBlock'
import { Button } from '@/components/ui/button'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import type { MarketplacePlugin, PluginInfo, ResourceScope, SkillFileEntry } from '../../../shared/agent-types'
import { cn } from '@/lib/utils'

const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
const streamdownPlugins = { code: codePlugin }
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
  { key: 'hasCommands', label: 'Commands', icon: Terminal },
  { key: 'hasAgents', label: 'Agents', icon: Bot },
  { key: 'hasSkills', label: 'Skills', icon: Puzzle },
  { key: 'hasHooks', label: 'Hooks', icon: Webhook },
  { key: 'hasMcpServers', label: 'MCP', icon: Server },
] as const

function ContentBadges({ plugin }: { plugin: PluginInfo }) {
  return (
    <div className="flex flex-wrap gap-1">
      {BADGE_CONFIG.map(({ key, label, icon: Icon }) =>
        plugin[key] ? (
          <span
            key={key}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            <Icon className="size-2.5" />
            {label}
          </span>
        ) : null
      )}
    </div>
  )
}

// --- Installed plugin card ---

function PluginCard({ plugin }: { plugin: PluginInfo }) {
  const { pluginDetail, pluginFileContent, pluginFilePath, readPlugin, readPluginFile, clearPluginDetail } = useSettingsStore()
  const isExpanded = pluginDetail?.key === plugin.key
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mdRawView, setMdRawView] = useState(false)

  const handleToggle = () => {
    if (isExpanded) {
      clearPluginDetail()
    } else {
      readPlugin(plugin.key)
    }
  }

  const handleFileSelect = useCallback(
    (_key: string, relativePath: string) => {
      readPluginFile(plugin.key, relativePath)
    },
    [readPluginFile, plugin.key]
  )

  return (
    <div className="rounded-lg border border-border bg-card">
      <div
        role="button"
        onClick={handleToggle}
        className="flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium uppercase text-muted-foreground text-sm">
          {plugin.name[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{plugin.name}</span>
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
        <div className="flex border-t border-border" style={{ height: 320 }}>
          {sidebarOpen && (
            <div className="w-[200px] shrink-0 overflow-y-auto border-r border-border p-2">
              <FileTree
                entries={pluginDetail.files}
                itemKey={plugin.key}
                selectedPath={pluginFilePath}
                onSelect={handleFileSelect}
              />
            </div>
          )}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-1.5 shrink-0 border-b border-border px-2 py-1">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                {sidebarOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
              </button>
              {pluginFilePath && (
                <span className="flex-1 text-[11px] text-muted-foreground truncate">{pluginFilePath}</span>
              )}
              {pluginFilePath && isMarkdown(pluginFilePath) && (
                <button
                  onClick={() => setMdRawView(!mdRawView)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                  title={mdRawView ? 'Preview' : 'Source'}
                >
                  {mdRawView ? <BookOpen className="size-3.5" /> : <Code className="size-3.5" />}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-auto p-2">
              {pluginFileContent != null && pluginFilePath ? (
                isMarkdown(pluginFilePath) && !mdRawView ? (
                  <MarkdownView content={pluginFileContent} />
                ) : (
                  <FileContentView
                    code={pluginFileContent}
                    language={inferLanguage(pluginFilePath)}
                  />
                )
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  Select a file to preview
                </div>
              )}
            </div>
          </div>
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

function PluginInstallCard({ plugin, onInstall }: { plugin: MarketplacePlugin; onInstall: (key: string, scope: ResourceScope) => void }) {
  const [installing, setInstalling] = useState(false)
  const [scopeChoice, setScopeChoice] = useState(false)

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
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium uppercase text-muted-foreground text-sm">
        {plugin.name[0]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{plugin.name}</span>
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
      <div className="shrink-0">
        {plugin.installed ? (
          <span className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            Installed
          </span>
        ) : scopeChoice ? (
          <div className="flex gap-1">
            {(['user', 'project'] as const).map((s) => (
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
            onClick={() => setScopeChoice(true)}
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
      </div>
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
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted font-medium uppercase text-muted-foreground">
        {mp.name[0]}
      </div>
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
}: {
  summary: MarketplaceSummary
  plugins: MarketplacePlugin[]
  onBack: () => void
  onInstall: (key: string, scope: ResourceScope) => void
  onUpdateMarketplace: () => Promise<void>
}) {
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
            <Button
              size="sm"
              variant="outline"
              onClick={handleUpdate}
              disabled={updating}
            >
              <RefreshCw className={cn('size-3.5', updating && 'animate-spin')} />
              {updating ? 'Updating...' : 'Update'}
            </Button>
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
          placeholder="Search plugins..."
          className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-ring"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {search ? 'No plugins match your search' : 'No plugins in this marketplace'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((plugin) => (
            <PluginInstallCard key={plugin.key} plugin={plugin} onInstall={onInstall} />
          ))}
        </div>
      )}
    </div>
  )
}

// --- Main page ---

type PluginsTab = 'marketplace' | 'installed'

export function PluginsPage() {
  const currentFolder = useAppStore((s) => s.currentFolder)
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

  useEffect(() => {
    clearPluginDetail()
    setSelectedMarketplace(null)
    fetchPlugins()
    fetchMarketplacePlugins()
  }, [currentFolder, clearPluginDetail, fetchPlugins, fetchMarketplacePlugins])

  // Derive marketplace summaries from plugins data
  const marketplaceSummaries = useMemo(() => {
    const map = new Map<string, MarketplaceSummary>()
    for (const p of marketplacePlugins) {
      let mp = map.get(p.marketplace)
      if (!mp) {
        mp = { name: p.marketplace, pluginCount: 0, installedCount: 0, lastUpdated: p.marketplaceLastUpdated, source: p.marketplaceSource }
        map.set(p.marketplace, mp)
      }
      mp.pluginCount++
      if (p.installed) mp.installedCount++
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
          />
        </div>
      )
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Plugins</h2>
          <p className="text-sm text-muted-foreground">Browse and manage Claude Code plugins</p>
        </div>
        <ProjectSelector mode="switch" />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
        {([
          { id: 'marketplace' as const, label: 'Marketplaces' },
          { id: 'installed' as const, label: `Installed (${plugins.length})` },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Marketplace tab */}
      {tab === 'marketplace' && (
        marketplaceSummaries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">No marketplaces found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Install a marketplace with: claude plugin marketplace add
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
              <p className="text-sm text-muted-foreground">No plugins installed</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Browse the Marketplace to install plugins
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {updatablePlugins.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {updatablePlugins.length} update{updatablePlugins.length !== 1 ? 's' : ''} available
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleUpdateAll}
                    disabled={updatingAll}
                    className="text-amber-500 border-amber-500/30 hover:bg-amber-500/10"
                  >
                    <ArrowUpCircle className="size-3.5" />
                    {updatingAll ? 'Updating...' : 'Update All'}
                  </Button>
                </div>
              )}
              <PluginSection title="User" plugins={userPlugins} />
              <PluginSection title="Project" plugins={projectPlugins} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
