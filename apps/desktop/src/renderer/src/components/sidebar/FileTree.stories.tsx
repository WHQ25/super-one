import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, type RefObject } from 'react'
import type { FileTreeEntry, GitFileStatus } from '@superone/shared/agent-types'
import { FileTree } from './FileTree'
import { useAppStore } from '@/stores/app'
import { useFileTreeStore } from '@/stores/file-tree'
import { useSourceControlStore } from '@/stores/source-control'

const PROJECT = '/storybook/super-one'

interface Mock {
  name: string
  isDirectory?: boolean
  index?: GitFileStatus | null
  worktree?: GitFileStatus | null
  children?: Mock[]
}

function buildEntries(items: Mock[], parentPath = ''): FileTreeEntry[] {
  return items.map((it) => {
    const path = parentPath ? `${parentPath}/${it.name}` : it.name
    const isDir = it.isDirectory ?? false
    return {
      name: it.name,
      path,
      isDirectory: isDir,
      gitIndex: it.index ?? null,
      gitWorktree: it.worktree ?? null,
      ...(isDir && it.children ? { children: buildEntries(it.children, path) } : {}),
    }
  })
}

function flattenForListDir(items: Mock[], parentPath = ''): Map<string, FileTreeEntry[]> {
  const map = new Map<string, FileTreeEntry[]>()
  map.set(parentPath, buildEntries(items, parentPath))
  for (const it of items) {
    if (it.isDirectory && it.children) {
      const sub = flattenForListDir(it.children, parentPath ? `${parentPath}/${it.name}` : it.name)
      for (const [k, v] of sub) map.set(k, v)
    }
  }
  return map
}

const TREE: Mock[] = [
  {
    name: 'src',
    isDirectory: true,
    index: 'M',
    worktree: 'M',
    children: [
      { name: 'unmodified.ts' },
      { name: 'unstaged-mod.ts', worktree: 'M' },
      { name: 'staged-mod.ts', index: 'M' },
      { name: 'partial-mod.ts', index: 'M', worktree: 'M' },
      { name: 'staged-add.ts', index: 'A' },
      { name: 'staged-add-then-edit.ts', index: 'A', worktree: 'M' },
      { name: 'staged-del.ts', index: 'D' },
      { name: 'unstaged-del.ts', worktree: 'D' },
      { name: 'staged-rename.ts', index: 'R' },
      { name: 'untracked.ts', worktree: '?' },
      { name: 'conflict.ts', index: 'U', worktree: 'U' },
    ],
  },
  {
    name: 'tests',
    isDirectory: true,
    index: 'A',
    worktree: null,
    children: [
      { name: 'new-suite.ts', index: 'A' },
      { name: 'another-new.ts', index: 'A' },
    ],
  },
  {
    name: 'docs',
    isDirectory: true,
    worktree: 'M',
    children: [
      { name: 'README.md', worktree: 'M' },
      { name: 'CHANGELOG.md' },
    ],
  },
  {
    name: 'node_modules',
    isDirectory: true,
    index: null,
    worktree: '!',
    children: [{ name: 'package', isDirectory: true, worktree: '!', children: [] }],
  },
  { name: '.env', worktree: '!' },
  { name: 'package.json', worktree: 'M' },
  { name: 'tsconfig.json' },
  { name: 'NEW_FEATURE.md', worktree: '?' },
  { name: 'staged-config.yml', index: 'M' },
  { name: 'rename-target.ts', index: 'R' },
]

interface ListDirMock {
  (folder: string, rel: string): Promise<FileTreeEntry[]>
}

function installListDirMock(items: Mock[]): void {
  const flat = flattenForListDir(items)
  const w = window as unknown as { app: Record<string, unknown> }
  const fn: ListDirMock = async (_folder, rel) => flat.get(rel) ?? []
  w.app = { ...(w.app ?? {}), listDir: fn, startDrag: () => {}, getPathForFile: () => '', trace: () => {} }
}

interface SimulatedDrag {
  /** Folder under the pointer. Omit to park the drag on the project root. */
  over?: string
  /** Expand this dir first, so the row overlay spans a subtree rather than one row. */
  expand?: string
  /** Hold the move modifier (option/alt). */
  alt?: boolean
}

/**
 * Parks the tree in its external-file-drag state. There is no way to set this from
 * props — `externalDragOver` is local state fed by a real `dragenter` — so the story
 * dispatches genuine DragEvents carrying a File, which is what makes
 * `dataTransfer.types` report 'Files' and satisfy the component's drag filter.
 */
function useSimulatedFileDrag(
  hostRef: RefObject<HTMLDivElement | null>,
  drag: SimulatedDrag | undefined,
  visibleCount: number,
) {
  useEffect(() => {
    if (!drag || visibleCount === 0) return
    if (drag.expand && !useFileTreeStore.getState().expandedDirs.has(drag.expand)) {
      // Re-runs on its own once the expanded rows land in _visibleList.
      useFileTreeStore.getState().toggleDir(PROJECT, drag.expand)
      return
    }
    const zone = hostRef.current?.querySelector('[data-testid="file-tree-dropzone"]')
    if (!zone) return

    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File(['x'], 'screenshot.png', { type: 'image/png' }))

    const arm = () => {
      useFileTreeStore.setState({ dragOverPath: drag.over ?? null })
      const rect = zone.getBoundingClientRect()
      zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }))
      zone.dispatchEvent(new DragEvent('dragover', {
        bubbles: true,
        dataTransfer,
        altKey: !!drag.alt,
        // Must sit mid-zone: the tree edge-scrolls within 40px of either end, and a
        // default clientY of 0 would leave the story scrolling upward forever.
        clientY: rect.top + rect.height / 2,
      }))
    }
    arm()

    // The tree retires the overlay on any document mouseup/dragend, so a stray click
    // in the canvas would empty the story. Re-arm instead of suppressing the reset —
    // that reset is the behaviour under test elsewhere.
    const rearm = () => { window.setTimeout(arm, 0) }
    document.addEventListener('mouseup', rearm)
    return () => {
      document.removeEventListener('mouseup', rearm)
      useFileTreeStore.setState({ dragOverPath: null })
    }
  }, [drag, visibleCount, hostRef])
}

function StoryHost({ items, drag }: { items: Mock[]; drag?: SimulatedDrag }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const visibleCount = useFileTreeStore((s) => s._visibleList.length)

  useEffect(() => {
    installListDirMock(items)
    useFileTreeStore.getState().reset()
    useSourceControlStore.setState({ selectedFile: null })
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    void useFileTreeStore.getState().fetchTree(PROJECT)
    return () => {
      useFileTreeStore.getState().reset()
    }
  }, [items])

  useSimulatedFileDrag(hostRef, drag, visibleCount)

  return (
    <div
      ref={hostRef}
      className="flex h-[640px] w-72 flex-col rounded-md border border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <FileTree />
    </div>
  )
}

const meta: Meta<typeof StoryHost> = {
  title: 'Sidebar/FileTree',
  component: StoryHost,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof StoryHost>

export const AllStates: Story = {
  name: 'All git status combinations',
  args: { items: TREE },
}

export const Clean: Story = {
  name: 'Clean working tree',
  args: {
    items: [
      {
        name: 'src',
        isDirectory: true,
        children: [
          { name: 'index.ts' },
          { name: 'app.ts' },
        ],
      },
      { name: 'package.json' },
      { name: 'README.md' },
    ],
  },
}

export const StagedVsUnstaged: Story = {
  name: 'Staged vs unstaged side-by-side',
  args: {
    items: [
      { name: 'unstaged-mod.ts', worktree: 'M' },
      { name: 'staged-mod.ts', index: 'M' },
      { name: 'partial-mod.ts', index: 'M', worktree: 'M' },
      { name: 'untracked.ts', worktree: '?' },
      { name: 'staged-new.ts', index: 'A' },
      { name: 'unstaged-del.ts', worktree: 'D' },
      { name: 'staged-del.ts', index: 'D' },
      { name: 'conflict.ts', index: 'U', worktree: 'U' },
    ],
  },
}

export const DirectoryAggregation: Story = {
  name: 'Directory rolls up worst child status',
  args: {
    items: [
      {
        name: 'mixed',
        isDirectory: true,
        index: 'A',
        worktree: 'D',
        children: [
          { name: 'newly-added.ts', index: 'A' },
          { name: 'deleted-here.ts', worktree: 'D' },
          { name: 'untouched.ts' },
        ],
      },
      {
        name: 'only-staged',
        isDirectory: true,
        index: 'M',
        children: [
          { name: 'a.ts', index: 'M' },
          { name: 'b.ts', index: 'A' },
        ],
      },
      {
        name: 'only-unstaged',
        isDirectory: true,
        worktree: 'M',
        children: [
          { name: 'a.ts', worktree: 'M' },
          { name: 'b.ts', worktree: '?' },
        ],
      },
    ],
  },
}

export const Dark: Story = {
  name: 'Dark theme',
  // Not an `args.dark` prop: `.storybook/preview.tsx`'s ThemeDecorator owns the `dark`
  // class and re-applies it after the story's own effect, so only the global sticks.
  globals: { theme: 'dark' },
  args: { items: TREE },
}

/*
 * External file drag. Three layers can be on screen at once and they must stay
 * legible as one affordance, not stack into a mask: the dashed ring (this tree
 * accepts the drop), the row overlay (which folder it lands in), and the hint pill
 * (what the drop will do).
 */

export const DragOverRoot: Story = {
  name: 'Drag · over project root',
  args: { items: TREE, drag: {} },
}

export const DragOverFolder: Story = {
  name: 'Drag · over an expanded folder',
  args: { items: TREE, drag: { over: 'src', expand: 'src' } },
}

export const DragMoveModifier: Story = {
  name: 'Drag · option held (move)',
  args: { items: TREE, drag: { over: 'src', expand: 'src', alt: true } },
}

/** The pill lived on `--sidebar-accent`, which `.dark` redefines to a near-black
 *  neutral — it painted dark-on-dark. Dark mode is the load-bearing case here. */
export const DragOverFolderDark: Story = {
  name: 'Drag · over a folder (dark)',
  globals: { theme: 'dark' },
  args: { items: TREE, drag: { over: 'src', expand: 'src' } },
}
