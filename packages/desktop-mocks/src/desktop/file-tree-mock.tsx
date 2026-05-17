"use client"

import { ChevronRight } from "lucide-react"
import { FileIcon, FolderIcon } from "@superone/ui/components/ui/FileIcon"
import { cn } from "@superone/ui/lib/utils"
import { useMockT } from "./i18n"

export type FileTreeGitStatus = "M" | "A" | "D" | "R" | "C" | "U" | "?" | "!"

export interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  isExpanded?: boolean
  selected?: boolean
  gitIndex?: FileTreeGitStatus
  gitWorktree?: FileTreeGitStatus
  children?: FileTreeNode[]
}

export interface FileTreeMockProps {
  rootName?: string
  nodes: FileTreeNode[]
  selectedPath?: string
  className?: string
}

const STATUS_COLOR: Record<FileTreeGitStatus, string> = {
  M: "text-amber-700 dark:text-amber-400",
  A: "text-emerald-700 dark:text-emerald-400",
  D: "text-rose-700 dark:text-rose-400",
  R: "text-cyan-700 dark:text-cyan-400",
  C: "text-cyan-700 dark:text-cyan-400",
  U: "text-orange-700 dark:text-orange-400",
  "?": "text-emerald-700 dark:text-emerald-400",
  "!": "text-sidebar-foreground/30",
}

function getStatusClass(
  index: FileTreeGitStatus | undefined,
  worktree: FileTreeGitStatus | undefined,
): string {
  if (index === "!" || worktree === "!") return STATUS_COLOR["!"]
  const hasIndex = index != null
  const hasWorktree = worktree != null
  if (!hasIndex && !hasWorktree) return "text-sidebar-foreground"
  const display = (hasIndex ? index : worktree) as FileTreeGitStatus
  const base = STATUS_COLOR[display] ?? "text-sidebar-foreground"
  if (hasIndex && hasWorktree) return `${base} italic`
  if (hasIndex) return base
  if (display === "?") return base
  return `${base} opacity-60`
}

interface FlatRow {
  node: FileTreeNode
  depth: number
}

function flatten(nodes: FileTreeNode[], depth: number, out: FlatRow[]): void {
  for (const n of nodes) {
    out.push({ node: n, depth })
    if (n.isDirectory && n.isExpanded && n.children) {
      flatten(n.children, depth + 1, out)
    }
  }
}

export function FileTreeMock({ rootName, nodes, selectedPath, className }: FileTreeMockProps) {
  const t = useMockT()
  const flat: FlatRow[] = []
  flatten(nodes, 0, flat)
  return (
    <div className={cn("flex h-full flex-col bg-sidebar text-sidebar-foreground", className)}>
      {rootName && (
        <div className="px-3 py-1.5">
          <span className="text-md font-medium text-sidebar-foreground/70">{rootName}</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {flat.map(({ node, depth }) => {
          const isSelected = selectedPath
            ? selectedPath === node.path
            : node.selected ?? false
          const colorClass = getStatusClass(node.gitIndex, node.gitWorktree)
          return (
            <div
              key={node.path}
              className={cn(
                "flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[15px] transition-colors hover:bg-sidebar-accent",
                !node.isDirectory && isSelected && "bg-sidebar-accent",
              )}
              style={{ paddingLeft: `${depth * 8 + 8}px` }}
            >
              {node.isDirectory ? (
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-sidebar-foreground/70 transition-transform duration-150",
                    node.isExpanded && "rotate-90",
                  )}
                />
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              {node.isDirectory ? (
                <FolderIcon name={node.name} size={15} />
              ) : (
                <FileIcon name={node.name} size={15} />
              )}
              <span className={cn("min-w-0 truncate", colorClass)}>{node.name}</span>
            </div>
          )
        })}
        {flat.length === 0 && (
          <div className="flex h-full items-center justify-center p-4 text-xs text-sidebar-foreground/50">
            {t("sidebar.noFiles")}
          </div>
        )}
      </div>
    </div>
  )
}

export const SAMPLE_FILE_TREE: FileTreeNode[] = [
  {
    name: "apps",
    path: "apps",
    isDirectory: true,
    isExpanded: true,
    children: [
      {
        name: "desktop",
        path: "apps/desktop",
        isDirectory: true,
        isExpanded: true,
        children: [
          {
            name: "src",
            path: "apps/desktop/src",
            isDirectory: true,
            isExpanded: true,
            children: [
              {
                name: "main",
                path: "apps/desktop/src/main",
                isDirectory: true,
                isExpanded: false,
              },
              {
                name: "renderer",
                path: "apps/desktop/src/renderer",
                isDirectory: true,
                isExpanded: true,
                children: [
                  {
                    name: "src",
                    path: "apps/desktop/src/renderer/src",
                    isDirectory: true,
                    isExpanded: true,
                    children: [
                      {
                        name: "components",
                        path: "apps/desktop/src/renderer/src/components",
                        isDirectory: true,
                        isExpanded: false,
                      },
                      {
                        name: "stores",
                        path: "apps/desktop/src/renderer/src/stores",
                        isDirectory: true,
                        isExpanded: false,
                      },
                      {
                        name: "App.tsx",
                        path: "apps/desktop/src/renderer/src/App.tsx",
                        isDirectory: false,
                        gitWorktree: "M",
                      },
                      {
                        name: "main.tsx",
                        path: "apps/desktop/src/renderer/src/main.tsx",
                        isDirectory: false,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            name: "package.json",
            path: "apps/desktop/package.json",
            isDirectory: false,
          },
        ],
      },
    ],
  },
  {
    name: "packages",
    path: "packages",
    isDirectory: true,
    isExpanded: true,
    children: [
      {
        name: "desktop-mocks",
        path: "packages/desktop-mocks",
        isDirectory: true,
        isExpanded: true,
        children: [
          {
            name: "src",
            path: "packages/desktop-mocks/src",
            isDirectory: true,
            isExpanded: true,
            children: [
              {
                name: "desktop",
                path: "packages/desktop-mocks/src/desktop",
                isDirectory: true,
                isExpanded: true,
                children: [
                  {
                    name: "chat-mock.tsx",
                    path: "packages/desktop-mocks/src/desktop/chat-mock.tsx",
                    isDirectory: false,
                    gitWorktree: "M",
                  },
                  {
                    name: "file-tree-mock.tsx",
                    path: "packages/desktop-mocks/src/desktop/file-tree-mock.tsx",
                    isDirectory: false,
                    gitWorktree: "?",
                    selected: true,
                  },
                  {
                    name: "tool-block-mock.tsx",
                    path: "packages/desktop-mocks/src/desktop/tool-block-mock.tsx",
                    isDirectory: false,
                    gitWorktree: "M",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        name: "ui",
        path: "packages/ui",
        isDirectory: true,
        isExpanded: false,
      },
    ],
  },
  {
    name: "package.json",
    path: "package.json",
    isDirectory: false,
    gitWorktree: "M",
  },
  {
    name: "README.md",
    path: "README.md",
    isDirectory: false,
  },
  {
    name: ".env",
    path: ".env",
    isDirectory: false,
    gitWorktree: "!",
  },
]
