import type { HarnessId } from "@superone/shared/agent-types"

export type ShowcaseSandboxMode = "off" | "on" | "auto"

export const SHOWCASE_SANDBOX_LABEL: Record<
  ShowcaseSandboxMode,
  "Off" | "On" | "Auto"
> = {
  off: "Off",
  on: "On",
  auto: "Auto",
}

export interface HarnessShowcaseMeta {
  id: HarnessId
  label: string
  shortLabel: string
  model: string
  permission: string
  sandbox: ShowcaseSandboxMode
  sandboxInteractive: boolean
  placeholder: string
}

/**
 * One fixture catalog for Storybook, the marketing site, and video scenes.
 *
 * Keep product names and current showcase models here instead of scattering them
 * through JSX. Runtime catalogs remain authoritative inside the desktop app; these
 * values are deliberately stable display fixtures for store-free mocks.
 */
export const HARNESS_SHOWCASE: readonly HarnessShowcaseMeta[] = [
  {
    id: "claude",
    label: "Claude Code",
    shortLabel: "Claude",
    model: "Opus 4.8",
    permission: "Normal",
    sandbox: "on",
    sandboxInteractive: true,
    placeholder: "Ask Claude to build, review, or explain…",
  },
  {
    id: "codex",
    label: "Codex",
    shortLabel: "Codex",
    model: "GPT5.6 Sol",
    permission: "Auto",
    sandbox: "on",
    sandboxInteractive: false,
    placeholder: "Ask Codex to work in this project…",
  },
  {
    id: "cursor",
    label: "Cursor Agent",
    shortLabel: "Cursor",
    model: "Auto",
    permission: "Agent",
    sandbox: "on",
    sandboxInteractive: true,
    placeholder: "Ask Cursor Agent to work in this project…",
  },
  {
    id: "opencode",
    label: "OpenCode",
    shortLabel: "OpenCode",
    model: "Auto",
    permission: "Allow edits",
    sandbox: "off",
    sandboxInteractive: false,
    placeholder: "Ask OpenCode to work in this project…",
  },
  {
    id: "dsh",
    label: "DeepSeek Agent",
    shortLabel: "DeepSeek",
    model: "DeepSeek Agent",
    permission: "Standard",
    sandbox: "on",
    sandboxInteractive: false,
    placeholder: "Ask DeepSeek Agent to work in this project…",
  },
  {
    id: "acp",
    label: "Grok via ACP",
    shortLabel: "Grok",
    model: "Grok Code",
    permission: "Confirm edits",
    sandbox: "on",
    sandboxInteractive: false,
    placeholder: "Ask Grok to work in this project…",
  },
] as const

export const HARNESS_SHOWCASE_IDS = HARNESS_SHOWCASE.map(({ id }) => id)

const HARNESS_SHOWCASE_BY_ID = Object.fromEntries(
  HARNESS_SHOWCASE.map((meta) => [meta.id, meta]),
) as Record<HarnessId, HarnessShowcaseMeta>

export function harnessShowcaseMeta(id: HarnessId): HarnessShowcaseMeta {
  return HARNESS_SHOWCASE_BY_ID[id]
}
