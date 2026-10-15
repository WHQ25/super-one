import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 640 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof ToolBlock> = {
  title: 'Tool UI/General/GenericToolHeader',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

export const ReadStreaming: Story = {
  args: {
    toolName: 'Read',
    input: JSON.stringify({ file_path: '/Users/me/projects/super-one/src/main/index.ts', offset: 1, limit: 100 }),
    status: 'streaming',
    elapsedSeconds: 2,
  },
}

export const ReadComplete: Story = {
  args: {
    toolName: 'Read',
    input: JSON.stringify({ file_path: '/Users/me/projects/super-one/src/main/index.ts' }),
    status: 'complete',
  },
}

export const ReadDenied: Story = {
  args: {
    toolName: 'Read',
    input: JSON.stringify({ file_path: '/Users/me/secrets/.env' }),
    status: 'complete',
    result: '[denied] User denied permission',
  },
}

export const GrepComplete: Story = {
  args: {
    toolName: 'Grep',
    input: JSON.stringify({ pattern: 'function\\s+ToolBlock', path: 'src/renderer/src/components/chat' }),
    status: 'complete',
    result: '3 matches across 2 files\nsrc/renderer/src/components/chat/ToolBlock.tsx:231\nsrc/renderer/src/components/chat/ToolBlock.tsx:1035',
  },
}

export const GrepStreaming: Story = {
  args: {
    toolName: 'Grep',
    input: JSON.stringify({ pattern: 'TODO', glob: '**/*.ts' }),
    status: 'streaming',
    elapsedSeconds: 1,
  },
}

export const GlobComplete: Story = {
  args: {
    toolName: 'Glob',
    input: JSON.stringify({ pattern: '**/*.test.ts', path: 'src' }),
    status: 'complete',
    result: 'Found 42 files',
  },
}

export const WebSearchComplete: Story = {
  args: {
    toolName: 'WebSearch',
    input: JSON.stringify({ query: 'electron-vite vs electron-forge comparison' }),
    status: 'complete',
    result: 'Found 8 results from web search',
  },
}

export const WebFetchComplete: Story = {
  args: {
    toolName: 'WebFetch',
    input: JSON.stringify({ url: 'https://docs.claude.com/en/api/agent-sdk' }),
    status: 'complete',
    result: 'Fetched 12kb of HTML content',
  },
}

export const WebFetchError: Story = {
  args: {
    toolName: 'WebFetch',
    input: JSON.stringify({ url: 'https://does-not-exist.example.com' }),
    status: 'complete',
    result: 'getaddrinfo ENOTFOUND does-not-exist.example.com',
    isError: true,
  },
}

export const ToolSearchComplete: Story = {
  args: {
    toolName: 'ToolSearch',
    input: JSON.stringify({ query: 'notebook jupyter' }),
    status: 'complete',
    result: '1 tool matched: NotebookEdit',
  },
}

export const SkillRunning: Story = {
  args: {
    toolName: 'Skill',
    input: JSON.stringify({ skill: 'simplify' }),
    status: 'streaming',
    elapsedSeconds: 3,
  },
}

export const SkillComplete: Story = {
  args: {
    toolName: 'Skill',
    input: JSON.stringify({ skill: 'release' }),
    status: 'complete',
  },
}

export const TaskOutputWaiting: Story = {
  args: {
    toolName: 'TaskOutput',
    input: JSON.stringify({ task_id: 'task-abc-123' }),
    status: 'streaming',
    elapsedSeconds: 5,
  },
}

export const TodoListComplete: Story = {
  args: {
    toolName: 'TodoList',
    input: JSON.stringify({ total: 8, completed: 5 }),
    status: 'complete',
  },
}

// The Artifact family publishes a page to claude.ai (`Artifact`) and acts on it
// (`ArtifactComments`, `ArtifactData`). The action lives in the input, so these
// stories keep the sub-actions distinguishable. Publish, read, comments and data
// fixtures are captured from a live SDK 0.3.300 session.
const ARTIFACT_URL = 'https://claude.ai/artifact/9aVirDdp2zQm7kXPpRjpfk'
const ARTIFACT_FILE = '/private/tmp/claude-501/scratchpad/artifact-test.html'

export const ArtifactPublish: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({ action: 'publish', file_path: ARTIFACT_FILE, icon: 'flask', description: 'Test page for verifying Artifact tool actions.', label: 'Initial publish' }),
    status: 'complete',
    result: `Published ${ARTIFACT_FILE} at ${ARTIFACT_URL} (Version 1, version id 1792092641-f221) Icon: "flask".\n\nLive subscription: arming in the background — not connected yet, so this is not a watch until \`status\` shows it connected.`,
    // The page's <title>, which only the structured result carries.
    resultTitle: 'Artifact Tool Check',
  },
}

// A publish stored before the host carried the title: the link falls back to its URL.
export const ArtifactPublishUntitledLegacy: Story = {
  args: { ...ArtifactPublish.args, resultTitle: undefined },
}

// The header link is the chat markdown link: hovering it previews the page.
export const ArtifactLinkPreview: Story = {
  ...ArtifactPublish,
  beforeEach: () => {
    mockIpc('app', 'resolveLinkPreview', async () => ({ title: 'Artifact Tool Check', description: 'Test page for verifying Artifact tool actions.', siteName: 'Claude' }))
    mockIpc('app', 'resolveFavicon', async () => null)
  },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: 'Artifact Tool Check' })
    const rect = link.getClientRects()[0]!
    await userEvent.pointer({ target: link, coords: { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 } })
    await waitFor(() => expect(screen.getByText('Test page for verifying Artifact tool actions.')).toBeVisible(), { timeout: 2000 })
  },
}

export const ArtifactPublishTitled: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({ file_path: '/Users/me/projects/super-one/out/q3-report.html', title: 'Q3 Report', url: ARTIFACT_URL }),
    status: 'complete',
    result: `Published /Users/me/projects/super-one/out/q3-report.html at ${ARTIFACT_URL} (Version 3, version id 1792092675-ea36)\n\nStored — contract 0.2.80 · capabilities db; user · readable by only you.`,
  },
}

export const ArtifactPublishStreaming: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({ file_path: '/Users/me/projects/super-one/out/q3-report.html' }),
    status: 'streaming',
    elapsedSeconds: 2,
  },
}

export const ArtifactPublishError: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({ action: 'publish', file_path: ARTIFACT_FILE, edits: [{ old_str: '<li>Edit path: pending</li>', new_str: '<li>Edit path: verified by update</li>' }] }),
    status: 'complete',
    isError: true,
    result: `Refusing to apply edits to ${ARTIFACT_FILE}: a hook is configured for file edits in this session, so a publish can't apply edits here. Edit the file, then publish it without edits. Nothing was published.`,
  },
}

export const ArtifactRead: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({ action: 'read', url: ARTIFACT_URL }),
    status: 'complete',
    result: '[Artifact 45765a9d-1f86-4eaf-ab66-6e94ceb47253 (version 1792092641-f221) — owned by you, private; raw HTML follows]\n<!doctype html><html><head><title>Artifact Tool Check</title></head><body>…</body></html>',
  },
}

export const ArtifactCommentsRead: Story = {
  args: {
    toolName: 'ArtifactComments',
    input: JSON.stringify({ action: 'read', url: ARTIFACT_URL }),
    status: 'complete',
    result: 'No comment threads on this artifact yet. Viewers add them from the artifact page (comment mode).',
  },
}

export const ArtifactDataSet: Story = {
  args: {
    toolName: 'ArtifactData',
    input: JSON.stringify({ action: 'set', url: ARTIFACT_URL, collection: 'checks', doc_id: 'probe-1', data: { note: 'test write from Artifact tool check', ok: true } }),
    status: 'complete',
    result: 'Database set committed: "checks"/"probe-1". Who can read it follows the page\'s access rules (by default, everyone who can open the artifact). The document is now at version 1. 1 of 25000 documents used in this artifact\'s database.',
  },
}

export const ArtifactDataError: Story = {
  args: {
    toolName: 'ArtifactData',
    input: JSON.stringify({ action: 'list', url: ARTIFACT_URL, collection: 'checks' }),
    status: 'complete',
    isError: true,
    result: 'db read failed (invalid_argument): this artifact\'s current published version does not declare the database capability — republish it with the db capability declared, then retry',
  },
}

export const ArtifactUploadAsset: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({
      action: 'upload_asset',
      url: 'https://claude.ai/public/artifacts/8f2a1c',
      file_path: '/Users/me/projects/super-one/assets/cover.png',
    }),
    status: 'complete',
    result: JSON.stringify({
      asset_upload: {
        id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        url: 'https://claude.ai/api/artifacts/8f2a1c/assets/a1b2c3d4',
        size_bytes: 421_888,
        content_type: 'image/png',
        file_name: 'cover.png',
      },
    }),
  },
}

export const ArtifactListAssets: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({ action: 'list_assets', url: 'https://claude.ai/public/artifacts/8f2a1c' }),
    status: 'complete',
    result: JSON.stringify({
      asset_list: {
        url: 'https://claude.ai/public/artifacts/8f2a1c',
        assets: [
          { id: 'a1b2c3d4', url: 'https://claude.ai/api/artifacts/8f2a1c/assets/a1b2c3d4', content_type: 'image/png', size_bytes: 421_888, created_at: '2026-08-21T06:12:00Z' },
        ],
        usage: { files: 1, bytes: 421_888, max_files: 100, max_bytes: 52_428_800 },
      },
    }),
  },
}

export const ArtifactReadAsset: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({
      action: 'read_asset',
      url: 'https://claude.ai/public/artifacts/8f2a1c',
      asset_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    }),
    status: 'complete',
    result: JSON.stringify({
      asset_read: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', path: './a1b2c3d4e5f60718293a4b5c6d7e8f90.png', size_bytes: 421_888, content_type: 'image/png', sha256: 'e3b0c442' },
    }),
  },
}

export const ArtifactDeleteAsset: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({
      action: 'delete_asset',
      url: 'https://claude.ai/public/artifacts/8f2a1c',
      asset_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    }),
    status: 'complete',
    result: JSON.stringify({ asset_delete: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', deleted: true } }),
  },
}

// No single artifact to point at, so no header link; expanded, each row is the
// artifact's titled link and its last update. Captured from a live session.
export const ArtifactList: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({ action: 'list', limit: 5 }),
    status: 'complete',
    result: [
      '5 published artifacts (most recently opened or updated first):',
      `- (mine) Artifact Tool Check — ${ARTIFACT_URL} — updated 2026-10-15`,
      '- (mine) Untitled — https://claude.ai/artifact/CadSBmDUtsRUF4gWcynXQV — updated 2026-10-06',
      '- (mine) SuperOne 浅色模式重设计 — https://claude.ai/artifact/BoutUGmzBpPhx6QMbSs4zo — updated 2026-08-20',
      '- (mine) Computer Use 集成计划 — https://claude.ai/artifact/HEfkPwCaojYpRaPwBaDwaX — updated 2026-07-27',
      '- (mine) Computer Use, Measured — https://claude.ai/artifact/Wey3drMSNsuxwesy7bbogs — updated 2026-07-27',
    ].join('\n'),
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(canvasElement.querySelector('.tool-node-header')!)
    await waitFor(() => expect(within(canvasElement).getByRole('link', { name: /SuperOne 浅色模式重设计/ })).toBeVisible())
  },
}

// Shared rows carry their qualifiers; a listing that hit its limit keeps its note.
export const ArtifactListShared: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({ action: 'list', scope: 'all', limit: 2 }),
    status: 'complete',
    result: [
      '2 published or shared artifacts (your own first, most recently opened or updated first; then those shared with you, roughly most recent first):',
      `- (mine) Artifact Tool Check — ${ARTIFACT_URL} — updated 2026-10-15`,
      '- (shared) Q3 Planning Deck with a deliberately long title that has to truncate — https://claude.ai/artifact/Q3PlanningDeck — updated 2026-09-30',
      '(More may exist: a higher `limit` (up to 100) may list more.)',
    ].join('\n'),
  },
  play: ArtifactList.play,
}

export const ArtifactPublishDenied: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({ file_path: '/Users/me/secrets/internal.html' }),
    status: 'complete',
    result: '[denied] User denied permission',
  },
}
