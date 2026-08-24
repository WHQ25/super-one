import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
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

// Artifact publishes a page to claude.ai and, since SDK 0.3.238, manages that
// artifact's asset store. The action lives in the input, so every sub-action
// shares one header — these stories are what keeps them distinguishable, and
// they carry real result shapes so the openable link chip renders.
export const ArtifactPublish: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({ file_path: '/Users/me/projects/super-one/out/q3-report.html', title: 'Q3 Report' }),
    status: 'complete',
    result: JSON.stringify({
      url: 'https://claude.ai/public/artifacts/8f2a1c',
      path: '/Users/me/projects/super-one/out/q3-report.html',
      title: 'Q3 Report',
      version: '3',
    }),
  },
}

export const ArtifactPublishUntitled: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({ file_path: '/Users/me/projects/super-one/out/notes.md' }),
    status: 'complete',
    result: JSON.stringify({ url: 'https://claude.ai/public/artifacts/2b7e90', path: '/Users/me/projects/super-one/out/notes.md' }),
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

// No single artifact to point at — deliberately renders without a link chip.
export const ArtifactList: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({ action: 'list', scope: 'all', limit: 20 }),
    status: 'complete',
    result: JSON.stringify({
      artifacts: [
        { title: 'Q3 Report', url: 'https://claude.ai/public/artifacts/8f2a1c', rel: 'mine' },
        { title: 'Onboarding Deck', url: 'https://claude.ai/public/artifacts/2b7e90', rel: 'shared' },
      ],
      scope: 'all',
    }),
  },
}

export const ArtifactPublishDenied: Story = {
  args: {
    toolName: 'Artifact',
    input: JSON.stringify({ file_path: '/Users/me/secrets/internal.html' }),
    status: 'complete',
    result: '[denied] User denied permission',
  },
}
