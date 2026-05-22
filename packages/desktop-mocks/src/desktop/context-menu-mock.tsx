"use client"

import { type ReactNode } from "react"
import {
  ArrowUpToLine,
  AtSign,
  ChevronRight,
  Copy,
  EyeOff,
  FolderOpen,
  GitFork,
  History,
  Link,
  MessageSquarePlus,
  Pencil,
  PictureInPicture2,
  Pin,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react"
import { cn } from "@superone/ui/lib/utils"
import { useMockT } from "./i18n"

export type ContextMenuItemVariant = "default" | "destructive"

export interface ContextMenuItemMock {
  kind: "item"
  icon?: ReactNode
  label: string
  labelKey?: string
  hint?: string
  variant?: ContextMenuItemVariant
  disabled?: boolean
  focused?: boolean
  hasSubmenu?: boolean
}

export interface ContextMenuLabelMock {
  kind: "label"
  text: string
}

export interface ContextMenuSeparatorMock {
  kind: "separator"
}

export type ContextMenuEntry =
  | ContextMenuItemMock
  | ContextMenuLabelMock
  | ContextMenuSeparatorMock

export interface ContextMenuMockProps {
  items: ContextMenuEntry[]
  width?: number
  className?: string
}

export function ContextMenuMock({ items, width = 192, className }: ContextMenuMockProps) {
  return (
    <div
      style={{ width }}
      className={cn(
        "rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        className,
      )}
    >
      {items.map((entry, idx) => {
        if (entry.kind === "separator") return <ContextMenuSeparatorRow key={idx} />
        if (entry.kind === "label") return <ContextMenuLabelRow key={idx}>{entry.text}</ContextMenuLabelRow>
        return <ContextMenuItemRow key={idx} entry={entry} />
      })}
    </div>
  )
}

function ContextMenuSeparatorRow() {
  return <div className="-mx-1 my-1 h-px bg-border" />
}

function ContextMenuLabelRow({ children }: { children: ReactNode }) {
  return <div className="px-2 py-1.5 text-xs text-muted-foreground">{children}</div>
}

function ContextMenuItemRow({ entry }: { entry: ContextMenuItemMock }) {
  const t = useMockT()
  const destructive = entry.variant === "destructive"
  const label = entry.labelKey ? t(entry.labelKey) : entry.label
  return (
    <div
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden",
        entry.focused && !destructive && "bg-accent text-accent-foreground",
        entry.focused && destructive && "bg-destructive/10 text-destructive dark:bg-destructive/20",
        destructive && "text-destructive",
        entry.disabled && "pointer-events-none opacity-50",
      )}
    >
      {entry.icon != null && (
        <span
          className={cn(
            "flex size-3.5 shrink-0 items-center justify-center",
            destructive ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {entry.icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {entry.hint && (
        <span className="ml-auto shrink-0 text-[10px] tracking-wider text-muted-foreground">
          {entry.hint}
        </span>
      )}
      {entry.hasSubmenu && (
        <ChevronRight className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
      )}
    </div>
  )
}

const SIZE = "size-3.5"

export const FILE_ROW_CONTEXT_MENU: ContextMenuEntry[] = [
  { kind: "item", icon: <Pencil className={SIZE} />, label: "Rename", labelKey: "sidebar.contextMenu.rename" },
  { kind: "item", icon: <AtSign className={SIZE} />, label: "Add to Chat", labelKey: "sidebar.contextMenu.addToChat", focused: true },
  { kind: "item", icon: <Copy className={SIZE} />, label: "Copy Path", labelKey: "sidebar.contextMenu.copyPath" },
  { kind: "item", icon: <Copy className={SIZE} />, label: "Copy Relative Path", labelKey: "sidebar.contextMenu.copyRelativePath" },
  { kind: "item", icon: <FolderOpen className={SIZE} />, label: "Open Folder", labelKey: "sidebar.contextMenu.openFolder" },
  { kind: "separator" },
  { kind: "item", icon: <Trash2 className={SIZE} />, label: "Delete", labelKey: "sidebar.contextMenu.delete", variant: "destructive" },
]

export const FOLDER_ROW_CONTEXT_MENU: ContextMenuEntry[] = [
  { kind: "item", icon: <Pencil className={SIZE} />, label: "Rename", labelKey: "sidebar.contextMenu.rename" },
  { kind: "item", icon: <AtSign className={SIZE} />, label: "Add to Chat", labelKey: "sidebar.contextMenu.addToChat" },
  { kind: "item", icon: <Copy className={SIZE} />, label: "Copy Path", labelKey: "sidebar.contextMenu.copyPath" },
  { kind: "item", icon: <Copy className={SIZE} />, label: "Copy Relative Path", labelKey: "sidebar.contextMenu.copyRelativePath" },
  { kind: "item", icon: <FolderOpen className={SIZE} />, label: "Reveal in Finder", focused: true },
  { kind: "separator" },
  { kind: "item", icon: <Trash2 className={SIZE} />, label: "Delete", labelKey: "sidebar.contextMenu.delete", variant: "destructive" },
]

export const PROJECT_ROW_CONTEXT_MENU: ContextMenuEntry[] = [
  { kind: "item", icon: <History className={SIZE} />, label: "Session History", labelKey: "sidebar.contextMenu.sessionHistory" },
  { kind: "separator" },
  {
    kind: "item",
    icon: <Trash2 className={SIZE} />,
    label: "Remove Project",
    labelKey: "sidebar.contextMenu.removeProject",
    variant: "destructive",
  },
]

export const SESSION_ROW_CONTEXT_MENU: ContextMenuEntry[] = [
  { kind: "item", icon: <Pencil className={SIZE} />, label: "Rename", labelKey: "sidebar.contextMenu.rename" },
  { kind: "item", icon: <Pin className={SIZE} />, label: "Pin", labelKey: "sidebar.contextMenu.pin" },
  { kind: "item", icon: <EyeOff className={SIZE} />, label: "Hide", labelKey: "sidebar.contextMenu.hide" },
  { kind: "separator" },
  {
    kind: "item",
    icon: <PictureInPicture2 className={SIZE} />,
    label: "Open in Mini Window",
    labelKey: "sidebar.contextMenu.openInMiniWindow",
    focused: true,
  },
  { kind: "separator" },
  { kind: "item", icon: <Copy className={SIZE} />, label: "Copy Session ID", labelKey: "sidebar.contextMenu.copySessionId" },
  { kind: "item", icon: <Copy className={SIZE} />, label: "Copy Working Directory", labelKey: "sidebar.contextMenu.copyWorkingDirectory" },
  { kind: "item", icon: <FolderOpen className={SIZE} />, label: "Open Folder", labelKey: "sidebar.contextMenu.openFolder" },
  { kind: "separator" },
  { kind: "item", icon: <GitFork className={SIZE} />, label: "Fork to New Worktree", labelKey: "sidebar.contextMenu.forkToWorktree" },
  { kind: "item", icon: <GitFork className={SIZE} />, label: "Fork to Local", labelKey: "sidebar.contextMenu.forkToLocal" },
  { kind: "separator" },
  { kind: "item", icon: <Trash2 className={SIZE} />, label: "Delete", labelKey: "sidebar.contextMenu.delete", variant: "destructive" },
]

export const AUTOMATION_ROW_CONTEXT_MENU: ContextMenuEntry[] = [
  { kind: "item", icon: <Play className={SIZE} />, label: "Run Now", labelKey: "sidebar.contextMenu.runNow", focused: true },
  { kind: "item", icon: <Pencil className={SIZE} />, label: "Edit", labelKey: "sidebar.contextMenu.edit" },
  { kind: "separator" },
  { kind: "item", icon: <Trash2 className={SIZE} />, label: "Delete", labelKey: "sidebar.contextMenu.delete", variant: "destructive" },
]

export const TEXT_SELECTION_CONTEXT_MENU: ContextMenuEntry[] = [
  { kind: "item", icon: <Copy className={SIZE} />, label: "Copy", labelKey: "chat.selectionMenu.copy" },
  {
    kind: "item",
    icon: <MessageSquarePlus className={SIZE} />,
    label: "Add to Chat",
    labelKey: "chat.selectionMenu.addToChat",
    focused: true,
  },
]

export const FILE_QUOTE_CONTEXT_MENU: ContextMenuEntry[] = [
  { kind: "label", text: "src/main/agent/session.ts · L42-L88" },
  { kind: "item", icon: <Copy className={SIZE} />, label: "Copy", labelKey: "chat.selectionMenu.copy" },
  {
    kind: "item",
    icon: <MessageSquarePlus className={SIZE} />,
    label: "Add Quoted Lines to Chat",
    focused: true,
  },
]

export const IMAGE_CONTEXT_MENU: ContextMenuEntry[] = [
  { kind: "item", icon: <ArrowUpToLine className={SIZE} />, label: "Send to Chat", focused: true },
  { kind: "item", icon: <Sparkles className={SIZE} />, label: "Edit with Codex" },
  { kind: "separator" },
  { kind: "item", icon: <Copy className={SIZE} />, label: "Copy Image" },
  { kind: "item", icon: <Link className={SIZE} />, label: "Copy Image URL" },
  { kind: "separator" },
  { kind: "item", icon: <RefreshCw className={SIZE} />, label: "Regenerate" },
]
