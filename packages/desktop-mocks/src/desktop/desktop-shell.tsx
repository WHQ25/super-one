"use client"

import type { ReactNode } from "react"
import {
  ArrowDownUp,
  Blocks,
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  EyeOff,
  Folder,
  FolderClosed,
  FolderOpen,
  FolderX,
  Gauge,
  LayoutGrid,
  Loader2,
  Maximize,
  MessageSquare,
  Moon,
  Palette,
  PanelLeftDashed,
  PanelLeftOpen,
  PanelRightOpen,
  PencilLine,
  Pin,
  Plus,
  Settings,
  Smartphone,
  SquarePen,
  SquareTerminal,
  Store,
  Sun,
  Trash2,
} from "lucide-react"
import { Button } from "@superone/ui/components/ui/button"
import { ScrollArea } from "@superone/ui/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@superone/ui/components/ui/tabs"
import type { SessionIconProps } from "@superone/ui/components/harness/ClaudeSessionIcon"
import { cn } from "@superone/ui/lib/utils"
import { HarnessSessionIcon, type Harness } from "./icons"
import { useMockT } from "./i18n"
import { TerminalPanelMock } from "./terminal-panel-mock"

export type SidebarTab = "sessions" | "files"
export type SessionStatus =
  | "idle"
  | "running"
  | "background"
  | "unseen"
  | "automation"
  | "remote"

export type SessionProvider = Harness

export interface MockSession {
  id: string
  title: string
  status?: SessionStatus
  active?: boolean
  pendingReason?: string
  pinned?: boolean
  provider?: SessionProvider
  isWorktree?: boolean
}

export type AutomationStatus = "idle" | "running" | "error" | "disabled"

export interface MockAutomation {
  id: string
  name: string
  status?: AutomationStatus
}

export interface MockWorker {
  id: string
  name: string
  uptime?: string
}

export interface MockProject {
  name: string
  active?: boolean
  expanded?: boolean
  missing?: boolean
  sessions?: MockSession[]
  automations?: MockAutomation[]
  automationsExpanded?: boolean
  workers?: MockWorker[]
  hasMore?: boolean
}

export interface MockPinnedSession {
  id: string
  title: string
  folderName: string
  provider?: SessionProvider
  status?: SessionStatus
  isWorktree?: boolean
  active?: boolean
}

export interface MockApp {
  id: string
  name: string
  description?: string
  isDev?: boolean
}

export interface MockDraft {
  id: string
  title: string
  scheduled?: boolean
  pendingSync?: boolean
}

export interface DesktopShellProps {
  projects?: MockProject[]
  pinnedSessions?: MockPinnedSession[]
  drafts?: MockDraft[]
  apps?: MockApp[]
  appsExpanded?: boolean
  headerTitle?: string
  sidebarTab?: SidebarTab
  fileTree?: ReactNode
  showTrafficLights?: boolean
  showActivityPanelToggle?: boolean
  showTerminalToggle?: boolean
  terminalOpen?: boolean
  terminal?: ReactNode
  terminalHeight?: number
  remoteOnline?: boolean
  hostLabel?: string
  showHostSwitcher?: boolean
  height?: number | string
  children: ReactNode
  className?: string
}

const DEFAULT_PINNED: MockPinnedSession[] = [
  { id: "p1", title: "Relay protocol redesign", folderName: "super-one", provider: "claude", status: "running" },
  { id: "p2", title: "Hermès theme tokens", folderName: "marketing-site", provider: "opencode", status: "unseen" },
]

const DEFAULT_DRAFTS: MockDraft[] = [
  { id: "d1", title: "Follow up on the release checklist" },
  { id: "d2", title: "Run the desktop smoke tests", scheduled: true },
]

const DEFAULT_APPS: MockApp[] = [
  { id: "design-canvas", name: "Design Canvas", description: "Sketch UI with the agent" },
  { id: "db-explorer", name: "DB Explorer", description: "Browse the session SQLite DB" },
  { id: "relay-inspector", name: "Relay Inspector", description: "Live mobile↔desktop frames", isDev: true },
  { id: "todo-board", name: "Todo Board", description: "Kanban over agent todos" },
]

const APP_TILE_TINTS = [
  "oklch(0.72 0.16 42)",
  "oklch(0.70 0.13 165)",
  "oklch(0.68 0.15 265)",
  "oklch(0.74 0.14 95)",
  "oklch(0.66 0.16 320)",
]

function tileTint(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return APP_TILE_TINTS[h % APP_TILE_TINTS.length]
}

const DEFAULT_PROJECTS: MockProject[] = [
  {
    name: "super-one",
    active: true,
    expanded: true,
    automations: [
      { id: "a1", name: "Nightly typecheck", status: "idle" },
      { id: "a2", name: "Sync bun.lock", status: "running" },
      { id: "a3", name: "Stale PR sweep", status: "error" },
    ],
    automationsExpanded: true,
    sessions: [
      { id: "s1", title: "Refactor sidebar layout", active: true, status: "running", provider: "claude" },
      { id: "s2", title: "Fix relay reconnect bug", status: "unseen", pendingReason: "Allow Bash?", provider: "codex" },
      { id: "s3", title: "Polish miniapp permissions", status: "background", provider: "cursor" },
      { id: "s4", title: "Worktree merge experiment", status: "idle", isWorktree: true, provider: "opencode" },
      { id: "s5", title: "Mobile pairing QR flow", status: "remote", provider: "dsh" },
      { id: "s6", title: "Weekly changelog draft", status: "automation", provider: "acp" },
    ],
    hasMore: true,
  },
  {
    name: "marketing-site",
    expanded: true,
    workers: [
      { id: "w1", name: "design-canvas", uptime: "12m 4s" },
      { id: "w2", name: "asset-optimizer", uptime: "3m 41s" },
    ],
    sessions: [
      { id: "ms1", title: "Landing hero copy", status: "idle", provider: "claude" },
      { id: "ms2", title: "OG image generator", status: "background", provider: "dsh" },
    ],
  },
  {
    name: "experiments",
  },
  {
    name: "archived-prototype",
    missing: true,
  },
]

export function DesktopShell({
  projects = DEFAULT_PROJECTS,
  pinnedSessions = DEFAULT_PINNED,
  drafts = DEFAULT_DRAFTS,
  apps = DEFAULT_APPS,
  appsExpanded = false,
  headerTitle,
  sidebarTab = "sessions",
  fileTree,
  showTrafficLights = true,
  showActivityPanelToggle = false,
  showTerminalToggle = false,
  terminalOpen = false,
  terminal,
  terminalHeight = 240,
  remoteOnline = true,
  hostLabel,
  showHostSwitcher = true,
  height = "100%",
  children,
  className,
}: DesktopShellProps) {
  const t = useMockT()
  const resolvedHeaderTitle = headerTitle ?? t("sidebar.newSession")
  return (
    <div
      className={cn(
        "flex w-full overflow-hidden rounded-xl border border-border bg-sidebar text-foreground shadow-sm",
        className,
      )}
      style={{ height }}
    >
      <DesktopSidebar
        projects={projects}
        pinnedSessions={pinnedSessions}
        drafts={drafts}
        apps={apps}
        appsExpanded={appsExpanded}
        sidebarTab={sidebarTab}
        fileTree={fileTree}
        showTrafficLights={showTrafficLights}
        showActivityPanelToggle={showActivityPanelToggle}
        remoteOnline={remoteOnline}
        hostLabel={hostLabel}
        showHostSwitcher={showHostSwitcher}
      />
      <div className="flex min-w-0 flex-1 flex-col bg-card">
        <DesktopMainHeader
          title={resolvedHeaderTitle}
          showTerminalToggle={showTerminalToggle}
          terminalOpen={terminalOpen}
        />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
          {terminalOpen && (
            <div
              className="relative flex shrink-0 flex-col border-t border-border bg-card"
              style={{ height: terminalHeight }}
            >
              <div className="absolute inset-x-0 -top-1 z-10 h-2">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-linear-to-r from-transparent via-foreground to-transparent opacity-40" />
              </div>
              <div className="min-h-0 flex-1">{terminal ?? <TerminalPanelMock />}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export interface DesktopSidebarProps {
  projects?: MockProject[]
  pinnedSessions?: MockPinnedSession[]
  drafts?: MockDraft[]
  apps?: MockApp[]
  appsExpanded?: boolean
  sidebarTab?: SidebarTab
  fileTree?: ReactNode
  showTrafficLights?: boolean
  showActivityPanelToggle?: boolean
  remoteOnline?: boolean
  hostLabel?: string
  showHostSwitcher?: boolean
  width?: number | string
  layoutToggleSide?: "right" | "left"
}

export function DesktopSidebar({
  projects = DEFAULT_PROJECTS,
  pinnedSessions = DEFAULT_PINNED,
  drafts = DEFAULT_DRAFTS,
  apps = DEFAULT_APPS,
  appsExpanded = false,
  sidebarTab = "sessions",
  fileTree,
  showTrafficLights = true,
  showActivityPanelToggle = false,
  remoteOnline = true,
  hostLabel,
  showHostSwitcher = true,
  width,
  layoutToggleSide = "right",
}: DesktopSidebarProps) {
  return (
    <Sidebar
      projects={projects}
      pinnedSessions={pinnedSessions}
      drafts={drafts}
      apps={apps}
      appsExpanded={appsExpanded}
      sidebarTab={sidebarTab}
      fileTree={fileTree}
      showTrafficLights={showTrafficLights}
      showActivityPanelToggle={showActivityPanelToggle}
      remoteOnline={remoteOnline}
      hostLabel={hostLabel}
      showHostSwitcher={showHostSwitcher}
      width={width}
      layoutToggleSide={layoutToggleSide}
    />
  )
}

export interface DesktopMainHeaderProps {
  title: string
  showTerminalToggle?: boolean
  terminalOpen?: boolean
}

export function DesktopMainHeader({
  title,
  showTerminalToggle = false,
  terminalOpen = false,
}: DesktopMainHeaderProps) {
  return (
    <MainHeader title={title} showTerminalToggle={showTerminalToggle} terminalOpen={terminalOpen} />
  )
}

function MainHeader({
  title,
  showTerminalToggle,
  terminalOpen,
}: {
  title: string
  showTerminalToggle: boolean
  terminalOpen: boolean
}) {
  return (
    <div className="flex h-11 shrink-0 items-center bg-card pl-3 pt-[2px]">
      <span className="max-w-[260px] truncate text-xs text-muted-foreground">{title}</span>
      <div className="flex-1" />
      <div className="mr-3 flex items-center gap-1.5">
        {showTerminalToggle && (
          <button
            type="button"
            aria-label="Toggle terminal"
            className={cn(
              "rounded-md p-1.5 transition-colors hover:bg-muted hover:text-foreground",
              terminalOpen ? "text-foreground" : "text-muted-foreground/60",
            )}
          >
            <SquareTerminal className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-label="Toggle theme"
          className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        >
          <Moon className="size-3.5 dark:hidden" />
          <Sun className="hidden size-3.5 dark:inline-block" />
        </button>
      </div>
    </div>
  )
}

function Sidebar({
  projects,
  pinnedSessions,
  drafts,
  apps,
  appsExpanded,
  sidebarTab,
  fileTree,
  showTrafficLights,
  showActivityPanelToggle,
  remoteOnline,
  hostLabel,
  showHostSwitcher,
  width,
  layoutToggleSide = "right",
}: {
  projects: MockProject[]
  pinnedSessions: MockPinnedSession[]
  drafts: MockDraft[]
  apps: MockApp[]
  appsExpanded: boolean
  sidebarTab: SidebarTab
  fileTree?: ReactNode
  showTrafficLights: boolean
  showActivityPanelToggle: boolean
  remoteOnline: boolean
  hostLabel?: string
  showHostSwitcher: boolean
  width?: number | string
  layoutToggleSide?: "right" | "left"
}) {
  const t = useMockT()
  const showFileTree = sidebarTab === "files" && !!fileTree
  const showPinned = sidebarTab === "sessions" && pinnedSessions.length > 0
  const resolvedWidth = width ?? 320
  return (
    <aside
      className="flex shrink-0 select-none flex-col bg-sidebar text-sidebar-foreground"
      style={{ width: resolvedWidth }}
    >
      <div className={cn("flex h-11 shrink-0 items-center gap-2 pt-[2px]", showTrafficLights ? "pl-[18px]" : "pl-2")}>
        {showTrafficLights && <TrafficLights />}
        <LayoutToggleMock showActivityPanelToggle={showActivityPanelToggle} side={layoutToggleSide} />
      </div>

      <div className="mx-2 mb-1 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="mb-1 w-full justify-center gap-1.5 border-sidebar-border bg-sidebar text-sidebar-foreground hover:border-sidebar-foreground/25 hover:bg-sidebar hover:text-sidebar-foreground"
        >
          <SquarePen className="size-3.5" />
          {t("sidebar.newSession")}
        </Button>
      </div>

      <Tabs value={sidebarTab} className="mx-1.5 mb-1 shrink-0">
        <TabsList>
          <TabsTrigger value="sessions" className="py-2">
            <MessageSquare className="size-3.5" />
            {t("sidebar.tabs.sessions")}
          </TabsTrigger>
          <TabsTrigger value="files" className="py-2">
            <FolderClosed className="size-3.5" />
            {t("sidebar.tabs.files")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AppsDrawer apps={apps} expanded={appsExpanded} />

      {showPinned && (
        <div className="flex flex-col px-1.5 pb-1">
          <span className="px-1.5 py-1.5 text-xs font-medium text-sidebar-foreground/70">{t("sidebar.pinned")}</span>
          {pinnedSessions.map((s) => {
            const pinHarnessStatus: SessionIconProps["status"] =
              s.status === "running" ? "running"
                : s.status === "background" ? "background"
                : s.status === "unseen" ? "unseen"
                : s.status === "automation" ? "automation"
                : "default"
            return (
              <div
                key={s.id}
                className="group/pin flex cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2.5 py-1.5 transition-colors hover:bg-sidebar-hover"
              >
                {s.provider && (
                  <span className="shrink-0">
                    <HarnessSessionIcon harness={s.provider} status={pinHarnessStatus} active={s.active} size={22} renderLevel="compact" />
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="min-w-0 truncate text-[13px]">{s.title}</span>
                  <span className="min-w-0 truncate text-[11px] text-sidebar-foreground/50">{s.folderName}</span>
                </div>
                <button className="box-content w-0 shrink-0 overflow-hidden rounded p-0.5 text-sidebar-foreground/70 opacity-0 transition-all hover:text-sidebar-foreground group-hover/pin:w-3 group-hover/pin:opacity-100">
                  <Pin className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {showFileTree ? (
          <div className="min-h-0 flex-1">{fileTree}</div>
        ) : (
          <>
            <div className="flex items-center justify-between pl-3 pr-3 pt-1.5 pb-0.5">
              {showHostSwitcher ? (
                <button className="flex min-w-0 max-w-[70%] items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground">
                  <span className="truncate">{hostLabel ?? t("sidebar.thisMac")}</span>
                  <ChevronDown className="size-3.5 shrink-0 opacity-70" />
                </button>
              ) : (
                <span className="px-1 py-0.5 text-sm font-medium text-sidebar-foreground/40">{t("sidebar.projects")}</span>
              )}
              <div className="flex items-center gap-0.5">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="shrink-0 cursor-pointer text-sidebar-foreground/70 hover:text-sidebar-foreground"
                >
                  <Plus className="size-3.5" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="shrink-0 cursor-pointer text-sidebar-foreground/70 hover:text-sidebar-foreground"
                >
                  <ArrowDownUp className="size-3" />
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              {projects.length === 0 && drafts.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-4 text-xs text-sidebar-foreground/70">
                  {t("sidebar.empty")}
                </div>
              ) : (
                <ScrollArea className="h-full">
                  <div className="flex w-0 min-w-full flex-col px-1.5 pb-1.5">
                    <DraftRows drafts={drafts} />
                    {projects.map((project) => (
                      <ProjectRow key={project.name} project={project} />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </>
        )}
      </div>

      <SidebarFooter remoteOnline={remoteOnline} />
    </aside>
  )
}

function DraftRows({ drafts }: { drafts: MockDraft[] }) {
  return drafts.map((draft) => (
    <div
      key={draft.id}
      className="group/draft flex h-9 cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2.5 transition-colors hover:bg-sidebar-hover"
    >
      {draft.scheduled ? (
        <Clock className="size-3.5 shrink-0 text-warning" aria-label="Scheduled send" />
      ) : (
        <PencilLine className="size-3.5 shrink-0 text-sidebar-foreground/45" />
      )}
      <span className="min-w-0 flex-1 truncate text-md text-sidebar-foreground">{draft.title}</span>
      {draft.pendingSync && <Clock className="size-3 shrink-0 text-warning" aria-label="Pending sync" />}
      <button className="rounded p-1 text-sidebar-foreground/45 opacity-0 transition-opacity hover:text-sidebar-foreground group-hover/draft:opacity-100">
        <Trash2 className="size-3" />
      </button>
    </div>
  ))
}

function ProjectRow({ project }: { project: MockProject }) {
  const t = useMockT()
  const isExpanded = project.expanded ?? false
  const isMissing = project.missing ?? false
  const automations = project.automations ?? []
  const workers = project.workers ?? []
  const sessions = project.sessions ?? []
  const automationsExpanded = project.automationsExpanded ?? false
  return (
    <div>
      <div
        className={cn(
          "group flex h-9 items-center overflow-hidden rounded-md px-2.5 transition-colors",
          isMissing ? "cursor-default opacity-60" : "cursor-pointer hover:bg-sidebar-hover",
        )}
      >
        <ChevronRight
          className={cn(
            "hidden size-4 shrink-0 text-sidebar-foreground/70 transition-transform duration-200 group-hover:block",
            isExpanded && "rotate-90",
            isMissing && "!hidden",
          )}
        />
        {isMissing ? (
          <FolderX className="size-4.5 shrink-0 text-destructive" />
        ) : isExpanded ? (
          <FolderOpen className="size-4.5 shrink-0 text-sidebar-foreground/70 group-hover:hidden" />
        ) : (
          <Folder className="size-4.5 shrink-0 text-sidebar-foreground/70 group-hover:hidden" />
        )}
        <span
          className={cn(
            "ml-2 min-w-0 truncate text-md",
            isMissing && "text-muted-foreground line-through",
          )}
        >
          {project.name}
        </span>
        {!isMissing && (
          <div className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <button
              className="rounded p-0.5 text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground"
              aria-label={t("tooltips.newAutomation")}
            >
              <CalendarClock className="size-4" />
            </button>
            <button
              className="rounded p-0.5 text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground"
              aria-label={t("tooltips.newSession")}
            >
              <SquarePen className="size-4" />
            </button>
          </div>
        )}
      </div>

      {isExpanded && automations.length > 0 && (
        <AutomationGroup automations={automations} expanded={automationsExpanded} />
      )}

      {isExpanded && workers.length > 0 && <WorkerGroup workers={workers} />}

      {isExpanded && sessions.length > 0 && (
        <div className="overflow-hidden">
          <div className="flex flex-col py-0.5 pl-2.5">
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
            {project.hasMore && (
              <button className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-sidebar-foreground/50 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground/70">
                <ChevronDown className="size-3.5 shrink-0" />
                <span>{t("sidebar.contextMenu.showMore")}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {isExpanded && sessions.length === 0 && !isMissing && (
        <div className="pl-2.5">
          <div className="px-2.5 py-1.5 text-[11px] text-sidebar-foreground/70">
            {t("sidebar.contextMenu.noSessions")}
          </div>
        </div>
      )}
    </div>
  )
}

function AutomationGroup({
  automations,
  expanded,
}: {
  automations: MockAutomation[]
  expanded: boolean
}) {
  const t = useMockT()
  return (
    <div className="overflow-hidden pl-2.5">
      <button className="group/auto flex h-7 w-full items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-sidebar-foreground/50 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground/70">
        <ChevronRight
          className={cn(
            "hidden size-3.5 shrink-0 transition-transform duration-200 group-hover/auto:block",
            expanded && "rotate-90",
          )}
        />
        <CalendarClock className="size-3.5 shrink-0 group-hover/auto:hidden" />
        <span>{t("sidebar.contextMenu.automations")}</span>
        <span className="ml-auto text-[10px] text-sidebar-foreground/30">{automations.length}</span>
      </button>
      {expanded && (
        <div className="flex flex-col py-0.5 pl-2">
          {automations.map((automation) => (
            <button
              key={automation.id}
              className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-sidebar-hover"
            >
              <span className="flex items-center gap-1.5 truncate">
                <CalendarClock className="size-3 shrink-0 text-sidebar-foreground/50" />
                <span className="truncate">{automation.name}</span>
              </span>
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  automation.status === "error"
                    ? "bg-red-500"
                    : automation.status === "running"
                      ? "bg-yellow-500"
                      : automation.status === "disabled"
                        ? "bg-muted-foreground/30"
                        : "bg-green-500",
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function WorkerGroup({ workers }: { workers: MockWorker[] }) {
  const t = useMockT()
  return (
    <div className="overflow-hidden pl-2.5">
      <button className="group/worker flex h-7 w-full items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-sidebar-foreground/50 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground/70">
        <ChevronRight className="hidden size-3.5 shrink-0 rotate-90 transition-transform duration-200 group-hover/worker:block" />
        <LayoutGrid className="size-3.5 shrink-0 group-hover/worker:hidden" />
        <span>{t("sidebar.contextMenu.miniApps")}</span>
        <span className="ml-auto text-[10px] text-sidebar-foreground/30">{workers.length}</span>
      </button>
      <div className="flex flex-col py-0.5 pl-2">
        {workers.map((worker) => (
          <button
            key={worker.id}
            className="group/wrow flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-sidebar-hover"
          >
            <span className="flex min-w-0 items-center gap-2">
              <LayoutGrid className="size-4 shrink-0 text-sidebar-foreground/50" />
              <span className="truncate">{worker.name}</span>
            </span>
            <span className="min-w-0 shrink truncate text-[10px] text-sidebar-foreground/40">
              {worker.uptime ?? "0s"}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SessionRow({ session }: { session: MockSession }) {
  return (
    <div>
      <div
        className={cn(
          "group/session flex cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2.5 py-1.5 transition-colors",
          session.active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-hover",
        )}
      >
        <div className="relative flex size-3 shrink-0 items-center justify-center">
          <span className="absolute inset-0 flex items-center justify-center rounded text-sidebar-foreground/70 opacity-0 transition-opacity hover:text-sidebar-foreground group-hover/session:opacity-100">
            <EyeOff className="size-3" />
          </span>
          <span className="pointer-events-none transition-opacity group-hover/session:opacity-0">
            <SessionStatusIcon status={session.status} provider={session.provider} active={session.active} />
          </span>
        </div>
        <span className="min-w-0 truncate text-[13px]">{session.title}</span>
        <div className="ml-auto flex shrink-0 items-center">
          <button className="box-content w-0 shrink-0 overflow-hidden rounded p-0.5 text-sidebar-foreground/70 opacity-0 transition-all hover:text-sidebar-foreground group-hover/session:w-3 group-hover/session:opacity-100">
            <Pin className="size-3" />
          </button>
        </div>
      </div>
      {session.pendingReason && (
        <div className="ml-2.5 mr-1 mt-0.5 flex cursor-pointer items-center gap-1 rounded-md bg-green-500/15 px-2 py-1">
          <Bot className="size-3 shrink-0 text-green-600 dark:text-green-400" />
          <span className="min-w-0 truncate text-[11px] text-green-600 dark:text-green-400">
            {session.pendingReason}
          </span>
        </div>
      )}
    </div>
  )
}

function SessionStatusIcon({ status, provider, active }: { status?: SessionStatus; provider?: SessionProvider; active?: boolean }) {
  if (status === "remote") return <Smartphone className="size-3 text-sidebar-foreground/70" />
  const harnessStatus: SessionIconProps["status"] =
    status === "running" ? "running"
      : status === "background" ? "background"
      : status === "unseen" ? "unseen"
      : status === "automation" ? "automation"
      : "default"
  if (provider && harnessStatus !== "default") {
    return <HarnessSessionIcon harness={provider} status={harnessStatus} active={active} renderLevel="compact" />
  }
  if (status === "running") return <Loader2 className="size-3 animate-spin text-sidebar-foreground/70" />
  return <MessageSquare className="size-3 text-sidebar-foreground/70" />
}

function SidebarFooter({ remoteOnline }: { remoteOnline: boolean }) {
  const t = useMockT()
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <button
        className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground"
        aria-label={t("sidebar.settings")}
      >
        <Settings className="size-3.5" />
      </button>
      <button
        className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground dark:hidden"
        aria-label="Brand color"
      >
        <Palette className="size-3.5" />
      </button>
      <button
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground"
        aria-label="Remote"
      >
        <Smartphone className="size-3.5" />
        <span
          className={cn(
            "absolute top-1 right-1 size-1.5 rounded-full",
            remoteOnline ? "bg-success" : "bg-error",
          )}
        />
      </button>
      <button
        className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground"
        aria-label="Usage"
      >
        <Gauge className="size-3.5" />
      </button>
    </div>
  )
}

function MockAppIcon({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center text-[10px] font-semibold uppercase text-white/95",
        className,
      )}
      style={{ background: tileTint(id) }}
    >
      {name.slice(0, 1)}
    </div>
  )
}

function AppsDrawer({ apps, expanded }: { apps: MockApp[]; expanded: boolean }) {
  const total = apps.length
  const stacked = apps.slice(0, 10)
  const collapsedAsApps = !expanded && total > 0
  return (
    <div className="mx-2 mt-1 mb-1 shrink-0">
      <div className="overflow-hidden rounded-lg border border-sidebar-border">
        <button className="flex min-h-[30px] w-full cursor-pointer items-center justify-between px-2.5 py-1 transition-colors hover:bg-sidebar-hover">
          <div className="flex items-center gap-2">
            {collapsedAsApps ? (
              <>
                <div className="flex items-center">
                  {stacked.map((app, i) => (
                    <div
                      key={app.id}
                      className={cn("shrink-0 rounded-[6px] ring-1 ring-sidebar", i > 0 && "-ml-[6px]")}
                      style={{ zIndex: i }}
                    >
                      <MockAppIcon id={app.id} name={app.name} className="size-[22px] rounded-[5px]" />
                    </div>
                  ))}
                </div>
                <span className="text-xs text-sidebar-foreground/50">
                  {total} App{total > 1 ? "s" : ""}
                </span>
              </>
            ) : (
              <>
                <Blocks className="size-3.5 text-sidebar-foreground/50" />
                <span className="text-xs text-sidebar-foreground/50">Apps</span>
              </>
            )}
          </div>
          {expanded ? (
            <ChevronDown className="size-3.5 text-sidebar-foreground/50" />
          ) : (
            <ChevronRight className="size-3.5 text-sidebar-foreground/50" />
          )}
        </button>

        {expanded && (
          <div className="overflow-hidden">
            <div className="px-1 py-1">
              {apps.map((app, i) => (
                <div
                  key={app.id}
                  className="group/sapp flex cursor-grab items-center gap-2.5 overflow-hidden rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-hover active:cursor-grabbing"
                >
                  <MockAppIcon id={app.id} name={app.name} className="size-6 shrink-0 rounded-[6px]" />
                  <div className="flex w-0 flex-1 flex-col overflow-hidden">
                    <span className="flex items-center gap-1.5 text-[13px]">
                      <span className="truncate">{app.name}</span>
                      {app.isDev && (
                        <span className="inline-flex h-4 shrink-0 items-center rounded bg-orange-500/15 px-1 text-[10px] leading-none text-orange-500">
                          Dev
                        </span>
                      )}
                      {i <= 9 && (
                        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-sidebar-accent text-[10px] leading-none text-sidebar-foreground/60">
                          {i < 9 ? i + 1 : 0}
                        </span>
                      )}
                    </span>
                    {app.description && (
                      <span className="truncate text-[11px] text-sidebar-foreground/50">{app.description}</span>
                    )}
                  </div>
                  <button className="ml-1 shrink-0 rounded p-1 text-sidebar-foreground/40 opacity-0 transition-opacity hover:bg-sidebar-accent-foreground/10 hover:text-sidebar-foreground group-hover/sapp:opacity-100">
                    <Maximize className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1 px-1 pb-1">
              <button className="mt-0.5 flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/40 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground/70">
                <Store className="size-3" />
                Marketplace
              </button>
              <button className="mt-0.5 flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/40 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground/70">
                <Plus className="size-3" />
                Build Your Own
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LayoutToggleMock({
  showActivityPanelToggle,
  side = "right",
}: {
  showActivityPanelToggle: boolean
  side?: "right" | "left"
}) {
  const t = useMockT()
  return (
    <div className="mr-2 flex items-center gap-0.5">
      <button
        type="button"
        aria-label={t("tooltips.toggleSidebar")}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <PanelLeftDashed className="size-3.5" />
      </button>
      {showActivityPanelToggle && (
        <button
          type="button"
          aria-label="Toggle activity panel side"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {side === "right" ? <PanelRightOpen className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
        </button>
      )}
    </div>
  )
}


function TrafficLights() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="size-3 rounded-full bg-[#ff5f57] ring-1 ring-inset ring-black/10" />
      <span className="size-3 rounded-full bg-[#febc2e] ring-1 ring-inset ring-black/10" />
      <span className="size-3 rounded-full bg-[#28c840] ring-1 ring-inset ring-black/10" />
    </div>
  )
}
