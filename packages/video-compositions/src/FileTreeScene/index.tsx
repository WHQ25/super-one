import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  BrandScope,
  DesktopShell,
  FilePreviewMock,
  FileTreeMock,
  HARNESS_CLAUDE_HUE,
  SAMPLE_FILE_TREE,
  type FilePreviewSpec,
  type FileTreeNode,
} from "@superone/desktop-mocks"

export const FILE_TREE_FPS = 30
export const FILE_TREE_WIDTH = 1280
export const FILE_TREE_HEIGHT = 800
export const FILE_TREE_DURATION_IN_FRAMES = 14 * FILE_TREE_FPS

export type FileTreeSceneProps = {
  brandHue: number
  darkMode: boolean
}

export const fileTreeSceneDefaultProps: FileTreeSceneProps = {
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

function setExpanded(
  nodes: FileTreeNode[],
  matchPath: string,
  expanded: boolean,
): FileTreeNode[] {
  return nodes.map((n) => {
    if (n.path === matchPath) return { ...n, isExpanded: expanded }
    if (n.children) return { ...n, children: setExpanded(n.children, matchPath, expanded) }
    return n
  })
}

function setSelected(nodes: FileTreeNode[], path: string | null): FileTreeNode[] {
  return nodes.map((n) => {
    const next: FileTreeNode = { ...n, selected: n.path === path }
    if (n.children) next.children = setSelected(n.children, path)
    return next
  })
}

const SELECTION_PREVIEWS: Record<string, FilePreviewSpec> = {
  "apps/desktop/src/renderer/src/App.tsx": {
    kind: "code",
    filePath: "apps/desktop/src/renderer/src/App.tsx",
    language: "tsx",
    startLine: 1,
    code: `import { useEffect } from "react"
import { useAppStore } from "@/stores/app"
import { useHarnessTheme } from "@/hooks/useHarnessTheme"
import { Startup } from "@/pages/Startup"
import { Setup } from "@/pages/Setup"
import { MainView } from "@/pages/MainView"
import { Settings } from "@/pages/Settings"

export function App() {
  const view = useAppStore((s) => s.view)
  useHarnessTheme()

  useEffect(() => {
    document.body.classList.add("hydrated")
  }, [])

  switch (view) {
    case "startup": return <Startup />
    case "setup":   return <Setup />
    case "main":    return <MainView />
    case "settings": return <Settings />
  }
}`,
  },
  "packages/desktop-mocks/src/desktop/file-tree-mock.tsx": {
    kind: "code",
    filePath: "packages/desktop-mocks/src/desktop/file-tree-mock.tsx",
    language: "tsx",
    startLine: 1,
    code: `export function FileTreeMock({ rootName, nodes, selectedPath, className }: FileTreeMockProps) {
  const flat: FlatRow[] = []
  flatten(nodes, 0, flat)
  return (
    <div className={cn("flex h-full flex-col bg-sidebar text-sidebar-foreground", className)}>
      {rootName && (
        <div className="px-3 py-1.5">
          <span className="text-md font-medium text-sidebar-foreground/70">
            {rootName}
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {flat.map(({ node, depth }) => (
          <TreeRow key={node.path} node={node} depth={depth} />
        ))}
      </div>
    </div>
  )
}`,
  },
  "package.json": {
    kind: "code",
    filePath: "package.json",
    language: "json",
    startLine: 1,
    code: `{
  "name": "super-one",
  "version": "0.59.0-alpha",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun --filter=@superone/desktop dev",
    "dev:web": "bun --filter=@superone/web dev",
    "dev:video": "bun --filter=@superone/video dev",
    "storybook": "bun --filter=@superone/desktop storybook"
  }
}`,
  },
}

export const FileTreeScene = ({ brandHue, darkMode }: FileTreeSceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps

  let nodes = SAMPLE_FILE_TREE
  let selectedPath: string | null = null

  if (t >= 1.2) nodes = setExpanded(nodes, "apps/desktop/src/main", true)
  if (t >= 2.4)
    nodes = setExpanded(nodes, "apps/desktop/src/renderer/src/components", true)
  if (t >= 3.6) selectedPath = "apps/desktop/src/renderer/src/App.tsx"
  if (t >= 6) selectedPath = "packages/desktop-mocks/src/desktop/file-tree-mock.tsx"
  if (t >= 8.5) nodes = setExpanded(nodes, "packages/ui", true)
  if (t >= 10) selectedPath = "package.json"

  nodes = setSelected(nodes, selectedPath)
  const previewSpec = selectedPath ? SELECTION_PREVIEWS[selectedPath] : undefined

  const shellOpacity = interpolate(frame, [0, 0.4 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="items-center justify-center bg-muted p-6">
        <div
          style={{ width: 1232, height: 752, opacity: shellOpacity }}
          className="overflow-hidden rounded-2xl shadow-2xl ring-1 ring-border/60"
        >
          <DesktopShell
            headerTitle={selectedPath ? `Files · ${selectedPath.split("/").pop()}` : "Files"}
            sidebarTab="files"
            fileTree={<FileTreeMock rootName="super-one" nodes={nodes} selectedPath={selectedPath ?? undefined} />}
            showTrafficLights
          >
            {previewSpec ? (
              <FilePreviewMock spec={previewSpec} />
            ) : (
              <div className="flex h-full items-center justify-center bg-background/40 p-12 text-sm text-muted-foreground">
                Pick a file from the sidebar to preview.
              </div>
            )}
          </DesktopShell>
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
