"use client"

import { type ComponentType, type ReactNode } from "react"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Globe,
  Plus,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react"
import {
  Anthropic,
  Bailian,
  Bedrock,
  Claude,
  DeepSeek,
  Doubao,
  Google,
  Kimi,
  KwaiKAT,
  LongCat,
  Minimax,
  Moonshot,
  ModelScope,
  Nvidia,
  OpenAI,
  OpenRouter,
  SiliconCloud,
  Volcengine,
  XiaomiMiMo,
  Zhipu,
} from "@lobehub/icons"
import { cn } from "@superone/ui/lib/utils"
import { useMockT } from "./i18n"

function PanelShell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex max-h-96 flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-xl",
        className,
      )}
    >
      {children}
    </div>
  )
}

function PanelHeader({
  title,
  meta,
  metaTone = "muted",
  right,
}: {
  title: string
  meta?: string
  metaTone?: "muted" | "live" | "error"
  right?: ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{title}</span>
        {meta && (
          <span
            className={cn(
              "truncate text-[10px]",
              metaTone === "muted" && "text-muted-foreground/70",
              metaTone === "live" && "text-green-600 dark:text-green-400",
              metaTone === "error" && "text-red-600 dark:text-red-400",
            )}
          >
            {meta}
          </span>
        )}
      </div>
      {right && <div className="flex items-center gap-0.5">{right}</div>}
    </div>
  )
}

function PanelFooter({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
      {children}
    </div>
  )
}

function KbdHint({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[9px] font-medium text-foreground">
      {children}
    </kbd>
  )
}

function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>
  const hits = new Set(indices)
  return (
    <>
      {Array.from(text).map((ch, i) =>
        hits.has(i) ? (
          <span key={i} className="text-primary">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  )
}

function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, "")
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || p
}

export interface AddDirEntryMock {
  path: string
  scope: "user" | "project-shared" | "project-local" | "session"
}

export type AddDirSlashVariant = "overview" | "scope" | "path"

export interface AddDirSlashPopupMockProps {
  variant?: AddDirSlashVariant
  entries?: AddDirEntryMock[]
  absolutePath?: string
  scopePartial?: string
  scopeFocus?: "project" | "session"
  pathCandidates?: Array<{ name: string; matchIndices?: number[]; focused?: boolean }>
  className?: string
}

const DEFAULT_ENTRIES: AddDirEntryMock[] = [
  { path: "/Users/hangqi/Developer/Projects/super-one-flutter", scope: "user" },
  { path: "/Users/hangqi/Developer/Projects/super-one-relay", scope: "project-shared" },
  { path: "/Users/hangqi/Notes/superone-design-decisions", scope: "project-local" },
  { path: "/tmp/electron-updater-scratch", scope: "session" },
]

const DEFAULT_PATH_CANDIDATES = [
  { name: "apps", matchIndices: [0], focused: true },
  { name: "packages", matchIndices: [] },
  { name: "scripts", matchIndices: [] },
  { name: "patches", matchIndices: [] },
]

function DirChip({
  path,
  onRemoveMark,
}: {
  path: string
  onRemoveMark?: boolean
}) {
  return (
    <div className="group flex items-center justify-between gap-2 rounded py-0.5 text-xs">
      <div className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5">
        <Folder className="size-3 shrink-0 text-blue-500" />
        <span className="font-medium text-foreground">{basename(path)}</span>
        {onRemoveMark && (
          <span className="rounded p-0.5 text-muted-foreground">
            <X className="size-2.5" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-muted-foreground/70">
        {path}
      </div>
    </div>
  )
}

function DirGroup({
  label,
  empty,
  showAdd,
  children,
}: {
  label: string
  empty?: boolean
  showAdd?: boolean
  children?: ReactNode
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {showAdd && (
          <span className="rounded p-0.5 text-muted-foreground">
            <FolderPlus className="size-3" />
          </span>
        )}
      </div>
      {empty ? (
        <div className="px-1.5 text-[11px] italic text-muted-foreground/60">none</div>
      ) : (
        <div className="space-y-0.5">{children}</div>
      )}
    </div>
  )
}

export function AddDirSlashPopupMock({
  variant = "overview",
  entries = DEFAULT_ENTRIES,
  absolutePath = "/Users/hangqi/Developer/Projects/super-one/",
  scopePartial = "ses",
  scopeFocus = "session",
  pathCandidates = DEFAULT_PATH_CANDIDATES,
  className,
}: AddDirSlashPopupMockProps) {
  const user = entries.filter((e) => e.scope === "user").map((e) => e.path)
  const projectShared = entries.filter((e) => e.scope === "project-shared").map((e) => e.path)
  const projectLocal = entries.filter((e) => e.scope === "project-local").map((e) => e.path)
  const session = entries.filter((e) => e.scope === "session").map((e) => e.path)

  return (
    <PanelShell className={className}>
      <PanelHeader
        title="/add-dir"
        meta={variant === "path" ? absolutePath : undefined}
        metaTone="muted"
      />

      <div className="min-h-0 flex-1 overflow-hidden p-1">
        {variant === "overview" && (
          <div className="space-y-2 px-2 py-1">
            {user.length > 0 && (
              <DirGroup label="USER">
                {user.map((d) => (
                  <DirChip key={`user:${d}`} path={d} />
                ))}
              </DirGroup>
            )}
            <DirGroup
              label="PROJECT"
              empty={projectShared.length === 0 && projectLocal.length === 0}
              showAdd
            >
              {projectShared.map((d) => (
                <DirChip key={`shared:${d}`} path={d} />
              ))}
              {projectLocal.map((d) => (
                <DirChip key={`local:${d}`} path={d} onRemoveMark />
              ))}
            </DirGroup>
            <DirGroup label="SESSION" empty={session.length === 0} showAdd>
              {session.map((d) => (
                <DirChip key={`session:${d}`} path={d} onRemoveMark />
              ))}
            </DirGroup>
          </div>
        )}

        {variant === "scope" && (
          <div className="space-y-0.5 px-1">
            {(["project", "session"] as const).map((scope) => {
              const lower = scopePartial.toLowerCase()
              const matches = scope.startsWith(lower)
              if (!matches) return null
              const indices = lower.split("").map((_, i) => i)
              const isFocused = scope === scopeFocus
              return (
                <div
                  key={scope}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs",
                    isFocused ? "bg-muted text-foreground" : "text-foreground",
                  )}
                >
                  <span className="font-medium">
                    <HighlightedText text={scope} indices={indices} />
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {scope === "project" ? "persisted in this project" : "this session only"}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {variant === "path" && (
          <div className="space-y-0.5 px-1">
            {pathCandidates.map((c) => (
              <div
                key={c.name}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs",
                  c.focused ? "bg-muted text-foreground" : "text-foreground",
                )}
              >
                <Folder className="size-3.5 shrink-0 text-blue-500" />
                <span className="truncate">
                  <HighlightedText text={c.name} indices={c.matchIndices ?? []} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <PanelFooter>
        {variant === "overview" && (
          <>
            continue typing <KbdHint>project</KbdHint> or <KbdHint>session</KbdHint>
          </>
        )}
        {variant === "scope" && (
          <>
            <KbdHint>tab</KbdHint> fill scope <span className="mx-1.5">·</span>
            <KbdHint>↑↓</KbdHint> navigate <span className="mx-1.5">·</span>
            <KbdHint>esc</KbdHint> close
          </>
        )}
        {variant === "path" && (
          <>
            <KbdHint>tab</KbdHint> navigate <span className="mx-1.5">·</span>
            <KbdHint>↵</KbdHint> add <span className="mx-1.5">·</span>
            <KbdHint>↑↓</KbdHint> select <span className="mx-1.5">·</span>
            <KbdHint>esc</KbdHint> close
          </>
        )}
      </PanelFooter>
    </PanelShell>
  )
}

export type McpServerStatusMock =
  | "connected"
  | "pending"
  | "needs-auth"
  | "failed"
  | "disabled"

const STATUS_DOT: Record<McpServerStatusMock, string> = {
  connected: "bg-green-500",
  pending: "bg-yellow-500",
  "needs-auth": "bg-yellow-500",
  failed: "bg-red-500",
  disabled: "bg-muted-foreground/40",
}

export interface McpServerEntryMock {
  name: string
  status: McpServerStatusMock
  statusLabel: string
  scope?: string
  iconUrl?: string
  expanded?: boolean
  tools?: Array<{ name: string; description?: string }>
}

export type McpSlashVariant = "live" | "probe" | "empty" | "loading"

export interface McpSlashPopupMockProps {
  variant?: McpSlashVariant
  servers?: McpServerEntryMock[]
  harness?: "claude" | "codex"
  className?: string
}

const DEFAULT_SERVERS: McpServerEntryMock[] = [
  {
    name: "superone",
    status: "connected",
    statusLabel: "8 tools",
    expanded: true,
    tools: [
      { name: "list_apps", description: "List installed mini-apps and dev apps" },
      { name: "read_manual", description: "Read SuperOne manuals (product support, miniapp, media, widget)" },
      { name: "miniapp_dev_setup", description: "Scaffold and register a new mini-app dev project" },
      { name: "miniapp_dev_pack", description: "Bundle a mini-app folder into a .s1app archive" },
    ],
  },
  { name: "github", status: "connected", statusLabel: "12 tools" },
  { name: "context7", status: "connected", statusLabel: "2 tools" },
  { name: "filesystem", status: "needs-auth", statusLabel: "Authorize in settings" },
  { name: "playwright", status: "pending", statusLabel: "Connecting…" },
  { name: "linear-archive", status: "disabled", statusLabel: "Disabled", scope: "user" },
]

function ServerInitial({ name, iconUrl }: { name: string; iconUrl?: string }) {
  if (iconUrl) {
    return <img src={iconUrl} alt={name} className="size-7 shrink-0 rounded-full bg-muted object-cover" />
  }
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium uppercase text-muted-foreground ring-1 ring-border">
      {name[0]}
    </div>
  )
}

export function McpSlashPopupMock({
  variant = "live",
  servers = DEFAULT_SERVERS,
  harness = "claude",
  className,
}: McpSlashPopupMockProps) {
  const t = useMockT()
  const harnessLabel = harness === "codex" ? "Codex" : "Claude"
  const meta =
    variant === "live"
      ? `${harnessLabel} · live session`
      : variant === "probe"
      ? "Probe (no active session)"
      : variant === "empty"
      ? "No MCP servers configured"
      : "Loading servers…"

  const metaTone: "muted" | "live" | "error" =
    variant === "live" ? "live" : "muted"

  const iconButtons: ReactNode = (
    <>
      <span
        className={cn(
          "rounded p-1 text-muted-foreground",
          variant === "loading" && "text-primary",
        )}
      >
        <RefreshCw className={cn("size-3.5", variant === "loading" && "animate-spin")} />
      </span>
      <span className="rounded p-1 text-muted-foreground">
        <Settings2 className="size-3.5" />
      </span>
      <span className="rounded p-1 text-muted-foreground">
        <X className="size-3.5" />
      </span>
    </>
  )

  return (
    <PanelShell className={className}>
      <PanelHeader title={t("chat.mcpPopup.title")} meta={meta} metaTone={metaTone} right={iconButtons} />

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {variant === "loading" && (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
            <RefreshCw className="size-3.5 animate-spin" />
            <span>Loading…</span>
          </div>
        )}

        {variant === "empty" && (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-muted-foreground">No MCP servers configured.</p>
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              Add servers in Settings → MCP, or install a .mcpb bundle.
            </p>
          </div>
        )}

        {(variant === "live" || variant === "probe") &&
          servers.map((server) => {
            const probe = variant === "probe"
            const isExpanded = server.expanded
            const tools = server.tools ?? []
            return (
              <div key={server.name} className="px-1">
                <div className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left">
                  <ServerInitial name={server.name} iconUrl={server.iconUrl} />
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-sm font-medium">{server.name}</span>
                    {server.scope && server.scope !== "user" && server.scope !== "project" && (
                      <span className="rounded bg-muted px-1 py-px text-[9px] uppercase text-muted-foreground">
                        {server.scope}
                      </span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      probe ? "ring-1 ring-inset ring-border bg-transparent" : STATUS_DOT[server.status],
                    )}
                  />
                  <span className="shrink-0 truncate text-xs text-muted-foreground">
                    {server.statusLabel}
                  </span>
                  {tools.length > 0 ? (
                    isExpanded ? (
                      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    )
                  ) : (
                    <span className="size-3 shrink-0" />
                  )}
                </div>

                {isExpanded && tools.length > 0 && (
                  <div className="ml-9 mb-1 space-y-0.5 border-l border-border pl-2">
                    {tools.map((tool) => (
                      <div key={tool.name} className="rounded px-2 py-1">
                        <p className="font-mono text-[11px] text-foreground">{tool.name}</p>
                        {tool.description && (
                          <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
                            {tool.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </PanelShell>
  )
}

export type ProviderBrandKey =
  | "claude"
  | "anthropic"
  | "chatgpt"
  | "openai"
  | "openrouter"
  | "deepseek"
  | "zhipu"
  | "kimi"
  | "moonshot"
  | "minimax"
  | "volcengine"
  | "bailian"
  | "bedrock"
  | "google"
  | "doubao"
  | "longcat"
  | "modelscope"
  | "siliconcloud"
  | "xiaomimimo"
  | "kwaikat"
  | "nvidia"

interface BrandEntry {
  Mono: ComponentType<{ size?: number }>
  Color?: ComponentType<{ size?: number }>
  Text?: ComponentType<{ size?: number }>
  Combine?: typeof OpenAI.Combine
  extraLabel?: string
}

const BRANDS: Record<ProviderBrandKey, BrandEntry> = {
  anthropic: { Mono: Anthropic, Text: Anthropic.Text },
  claude: { Mono: Claude, Color: Claude.Color, Text: Claude.Text },
  openrouter: { Mono: OpenRouter, Text: OpenRouter.Text },
  zhipu: { Mono: Zhipu, Color: Zhipu.Color, Text: Zhipu.Text },
  kimi: { Mono: Kimi, Color: Kimi.Color, Text: Kimi.Text },
  moonshot: { Mono: Moonshot, Text: Moonshot.Text },
  minimax: { Mono: Minimax, Color: Minimax.Color, Text: Minimax.Text },
  volcengine: { Mono: Volcengine, Color: Volcengine.Color, Text: Volcengine.Text },
  bailian: { Mono: Bailian, Color: Bailian.Color, Text: Bailian.Text },
  bedrock: { Mono: Bedrock, Color: Bedrock.Color, Text: Bedrock.Text },
  google: { Mono: Google, Color: Google.Color, Text: Google.Brand },
  deepseek: { Mono: DeepSeek, Color: DeepSeek.Color, Text: DeepSeek.Text },
  doubao: { Mono: Doubao, Color: Doubao.Color, Text: Doubao.Text },
  kwaikat: { Mono: KwaiKAT, Text: KwaiKAT.Text },
  longcat: { Mono: LongCat, Color: LongCat.Color, Text: LongCat.Text },
  modelscope: { Mono: ModelScope, Color: ModelScope.Color, Text: ModelScope.Text },
  nvidia: { Mono: Nvidia, Color: Nvidia.Color, Text: Nvidia.Text },
  siliconcloud: { Mono: SiliconCloud, Color: SiliconCloud.Color, Text: SiliconCloud.Text },
  xiaomimimo: { Mono: XiaomiMiMo, Text: XiaomiMiMo.Text },
  openai: { Mono: OpenAI, Text: OpenAI.Text },
  chatgpt: { Mono: OpenAI, Combine: OpenAI.Combine, extraLabel: "ChatGPT" },
}

function BrandLabel({ brand, fallback, size = 20 }: { brand?: ProviderBrandKey; fallback?: string; size?: number }) {
  const entry = brand ? BRANDS[brand] : null
  if (!entry) {
    return (
      <span className="flex items-center gap-2 text-sm font-medium">
        <Globe className="size-5 text-muted-foreground" />
        {fallback}
      </span>
    )
  }
  const IconComp = entry.Color ?? entry.Mono
  if (entry.Combine && entry.extraLabel) {
    return (
      <entry.Combine
        size={size}
        extra={entry.extraLabel}
        showText={false}
        style={{ display: "inline-flex", flexDirection: "row", alignItems: "center" }}
      />
    )
  }
  if (entry.Text) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <IconComp size={size} />
        <entry.Text size={size * 0.75} />
      </span>
    )
  }
  return <IconComp size={size} />
}

export interface ProviderItemMock {
  id: string
  brand?: ProviderBrandKey
  label?: string
  current?: boolean
  focused?: boolean
}

export interface ProviderSlashPopupMockProps {
  items?: ProviderItemMock[]
  streaming?: boolean
  className?: string
}

const DEFAULT_PROVIDER_ITEMS: ProviderItemMock[] = [
  { id: "default", brand: "claude", label: "Claude (Default)", current: true },
  { id: "openrouter", brand: "openrouter", label: "OpenRouter" },
  { id: "zhipu", brand: "zhipu", label: "Z.ai GLM" },
  { id: "deepseek", brand: "deepseek", label: "DeepSeek" },
  { id: "kimi", brand: "kimi", label: "Kimi" },
  { id: "volcengine", brand: "volcengine", label: "Volcengine" },
  { id: "custom", label: "Self-hosted gateway" },
]

export function ProviderSlashPopupMock({
  items = DEFAULT_PROVIDER_ITEMS,
  streaming = false,
  className,
}: ProviderSlashPopupMockProps) {
  return (
    <PanelShell className={cn("max-h-72", className)}>
      <PanelHeader
        title="Switch API provider"
        meta={streaming ? "Will switch after streaming finishes" : undefined}
        metaTone={streaming ? "error" : "muted"}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left",
              item.focused && "bg-accent",
            )}
          >
            <BrandLabel brand={item.brand} fallback={item.label ?? item.id} />
            {item.current && <Check className="size-3.5 shrink-0 text-primary" />}
          </div>
        ))}

        <div className="my-1 border-t border-border" />

        <div className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Plus className="size-4" />
            <span>Add provider in Settings</span>
          </div>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        </div>
      </div>
    </PanelShell>
  )
}
