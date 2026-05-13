import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  AddDirSlashPopupMock,
  McpSlashPopupMock,
  ProviderSlashPopupMock,
  type AddDirEntryMock,
} from "./slash-popups-mock"

const meta: Meta = {
  title: "Desktop Mocks/SlashPopups",
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-3xl">
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj

const RICH_ENTRIES: AddDirEntryMock[] = [
  { path: "/Users/hangqi/Developer/Projects/super-one-flutter", scope: "user" },
  { path: "/Users/hangqi/Developer/Projects/super-one-relay", scope: "project-shared" },
  { path: "/Users/hangqi/Notes/superone-design-decisions", scope: "project-local" },
  { path: "/tmp/electron-updater-scratch", scope: "session" },
]

export const AddDirOverview: Story = {
  render: () => <AddDirSlashPopupMock variant="overview" entries={RICH_ENTRIES} />,
}

export const AddDirOverviewEmpty: Story = {
  render: () => <AddDirSlashPopupMock variant="overview" entries={[]} />,
}

export const AddDirScopeSession: Story = {
  render: () => (
    <AddDirSlashPopupMock variant="scope" scopePartial="ses" scopeFocus="session" />
  ),
}

export const AddDirScopeProject: Story = {
  render: () => (
    <AddDirSlashPopupMock variant="scope" scopePartial="pro" scopeFocus="project" />
  ),
}

export const AddDirPathCompletion: Story = {
  render: () => (
    <AddDirSlashPopupMock
      variant="path"
      absolutePath="/Users/hangqi/Developer/Projects/super-one/"
      pathCandidates={[
        { name: "apps", matchIndices: [0], focused: true },
        { name: "packages", matchIndices: [] },
        { name: "scripts", matchIndices: [] },
        { name: "patches", matchIndices: [] },
      ]}
    />
  ),
}

export const AddDirPathFuzzyMatch: Story = {
  render: () => (
    <AddDirSlashPopupMock
      variant="path"
      absolutePath="/Users/hangqi/Developer/Projects/super-one/apps/"
      pathCandidates={[
        { name: "desktop", matchIndices: [0, 1, 2] },
        { name: "web", matchIndices: [] },
        { name: "relay", matchIndices: [], focused: true },
        { name: "video", matchIndices: [] },
      ]}
    />
  ),
}

export const McpLiveServers: Story = {
  render: () => <McpSlashPopupMock variant="live" />,
}

export const McpLiveCodex: Story = {
  render: () => <McpSlashPopupMock variant="live" harness="codex" />,
}

export const McpProbe: Story = {
  render: () => (
    <McpSlashPopupMock
      variant="probe"
      servers={[
        { name: "superone", status: "connected", statusLabel: "8 tools" },
        { name: "github", status: "connected", statusLabel: "12 tools" },
        { name: "context7", status: "connected", statusLabel: "2 tools" },
      ]}
    />
  ),
}

export const McpEmpty: Story = {
  render: () => <McpSlashPopupMock variant="empty" />,
}

export const McpLoading: Story = {
  render: () => <McpSlashPopupMock variant="loading" />,
}

export const ProviderDefault: Story = {
  render: () => <ProviderSlashPopupMock />,
}

export const ProviderFocusOpenRouter: Story = {
  render: () => (
    <ProviderSlashPopupMock
      items={[
        { id: "default", brand: "claude", label: "Claude (Default)", current: true },
        { id: "openrouter", brand: "openrouter", label: "OpenRouter", focused: true },
        { id: "zhipu", brand: "zhipu", label: "Z.ai GLM" },
        { id: "deepseek", brand: "deepseek", label: "DeepSeek" },
        { id: "volcengine", brand: "volcengine", label: "Volcengine" },
      ]}
    />
  ),
}

export const ProviderCodexHarness: Story = {
  render: () => (
    <ProviderSlashPopupMock
      items={[
        { id: "default", brand: "chatgpt", label: "ChatGPT (Default)", current: true },
        { id: "openai", brand: "openai", label: "OpenAI Direct" },
        { id: "openrouter", brand: "openrouter", label: "OpenRouter" },
        { id: "google", brand: "google", label: "Google Vertex" },
        { id: "bedrock", brand: "bedrock", label: "AWS Bedrock" },
      ]}
    />
  ),
}

export const ProviderStreaming: Story = {
  render: () => (
    <ProviderSlashPopupMock
      streaming
      items={[
        { id: "default", brand: "claude", label: "Claude (Default)", current: true },
        { id: "openrouter", brand: "openrouter", label: "OpenRouter", focused: true },
        { id: "zhipu", brand: "zhipu", label: "Z.ai GLM" },
      ]}
    />
  ),
}

export const ProviderChinaCluster: Story = {
  render: () => (
    <ProviderSlashPopupMock
      items={[
        { id: "default", brand: "claude", label: "Claude (Default)" },
        { id: "zhipu", brand: "zhipu", label: "Z.ai GLM", current: true },
        { id: "kimi", brand: "kimi", label: "Kimi" },
        { id: "minimax", brand: "minimax", label: "Minimax" },
        { id: "doubao", brand: "doubao", label: "Doubao" },
        { id: "bailian", brand: "bailian", label: "Bailian" },
        { id: "volcengine", brand: "volcengine", label: "Volcengine" },
        { id: "siliconcloud", brand: "siliconcloud", label: "SiliconCloud" },
      ]}
    />
  ),
}

export const ProviderUnbranded: Story = {
  render: () => (
    <ProviderSlashPopupMock
      items={[
        { id: "default", brand: "claude", label: "Claude (Default)" },
        { id: "custom-1", label: "company-internal-gateway" },
        { id: "custom-2", label: "staging.api.acme.io", focused: true },
        { id: "custom-3", label: "kong-prod-cluster", current: true },
      ]}
    />
  ),
}

export const McpMixedStatuses: Story = {
  render: () => (
    <McpSlashPopupMock
      variant="live"
      servers={[
        {
          name: "superone",
          status: "connected",
          statusLabel: "8 tools",
          expanded: true,
          tools: [
            { name: "list_apps", description: "List installed mini-apps and dev apps" },
            { name: "pack_mini_app", description: "Bundle a folder into a .s1app archive" },
          ],
        },
        { name: "github-actions", status: "needs-auth", statusLabel: "Authorize in Settings" },
        { name: "playwright", status: "pending", statusLabel: "Connecting…" },
        { name: "scraper-v2", status: "failed", statusLabel: "Spawn failed (code 127)" },
        { name: "linear-archive", status: "disabled", statusLabel: "Disabled", scope: "user" },
      ]}
    />
  ),
}
