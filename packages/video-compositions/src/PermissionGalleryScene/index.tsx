import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  BrandScope,
  ChatMock,
  HARNESS_CLAUDE_HUE,
  PermissionPromptMock,
  type Harness,
  type MockMessage,
  type PermissionAction,
  type PermissionPromptMockProps,
} from "@superone/desktop-mocks"

export const PERMISSION_GALLERY_FPS = 30
export const PERMISSION_GALLERY_WIDTH = 1280
export const PERMISSION_GALLERY_HEIGHT = 800
export const PERMISSION_GALLERY_DURATION_IN_FRAMES = 22 * PERMISSION_GALLERY_FPS

export type PermissionGallerySceneProps = {
  harness: Harness
  brandHue: number
  darkMode: boolean
}

export const permissionGallerySceneDefaultProps: PermissionGallerySceneProps = {
  harness: "claude",
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

interface Stage {
  title: string
  conversation: MockMessage[]
  promptProps: PermissionPromptMockProps
}

const STAGES: Stage[] = [
  {
    title: "Default · Bash",
    conversation: [
      { id: "u", role: "user", text: "Run the test suite once." },
      {
        id: "a",
        role: "assistant",
        blocks: [{ type: "markdown", text: "About to run `bun run test` — please confirm." }],
      },
    ],
    promptProps: {
      spec: { variant: "bash", command: "bun run test" },
      description: "run full test suite",
      focusedAction: "allow",
    },
  },
  {
    title: "Default · Edit (inline diff)",
    conversation: [
      { id: "u", role: "user", text: "Patch the permission lifecycle bug." },
      {
        id: "a",
        role: "assistant",
        blocks: [
          {
            type: "markdown",
            text:
              "Found the issue — `pendingPermissions.filter` drops the entry before the SDK acks. Switching to map keeps it until acknowledged.",
          },
        ],
      },
    ],
    promptProps: {
      spec: {
        variant: "edit",
        filePath: "apps/desktop/src/main/session/session.ts",
        startLine: 312,
        oldText: "this.pendingPermissions = this.pendingPermissions.filter((p) => p.id !== id)",
        newText:
          "this.pendingPermissions = this.pendingPermissions.map((p) => (\n  p.id === id ? { ...p, status: 'denying' } : p\n))",
      },
      focusedAction: "allow",
    },
  },
  {
    title: "Default · Bash with suggestions",
    conversation: [
      { id: "u", role: "user", text: "Reinstall dependencies." },
      {
        id: "a",
        role: "assistant",
        blocks: [
          {
            type: "markdown",
            text:
              "Running `bun install` — you can also approve `bun *` for the whole project if you do this often.",
          },
        ],
      },
    ],
    promptProps: {
      spec: { variant: "bash", command: "bun install" },
      suggestions: [
        { label: "Allow Bash(bun install) for this session", selected: true },
        { label: "Allow Bash(bun *) for this project" },
        { label: "Switch to acceptEdits" },
      ],
      focusedAction: "allow",
    },
  },
  {
    title: "Codex decision · Write",
    conversation: [
      { id: "u", role: "user", text: "Draft the R2 migration script." },
      {
        id: "a",
        role: "assistant",
        blocks: [
          { type: "markdown", text: "Codex is asking permission to create the script:" },
        ],
      },
    ],
    promptProps: {
      mode: "codex_decision",
      spec: {
        variant: "write",
        filePath: "scripts/migrate-r2.ts",
        content: "import { S3Client } from '@aws-sdk/client-s3'\n…",
      },
      focusedAction: "always_allow",
    },
  },
  {
    title: "Sandbox network",
    conversation: [
      { id: "u", role: "user", text: "Generate embeddings for the new docs." },
      {
        id: "a",
        role: "assistant",
        blocks: [
          {
            type: "markdown",
            text:
              "Codex is sandboxed and needs outbound access to fetch embeddings from the API.",
          },
        ],
      },
    ],
    promptProps: {
      mode: "sandbox_network",
      sandboxNetwork: { host: "api.openai.com" },
      decisionReason: "Codex CLI wants outbound network access from a sandboxed turn.",
      focusedAction: "allow",
    },
  },
  {
    title: "MCP Elicitation",
    conversation: [
      { id: "u", role: "user", text: "Pull customer cus_LpA42q from Stripe." },
      {
        id: "a",
        role: "assistant",
        blocks: [
          {
            type: "markdown",
            text: "Stripe MCP wants confirmation before reading customer data:",
          },
        ],
      },
    ],
    promptProps: {
      mode: "elicitation",
      elicitation: {
        serverName: "stripe",
        message: "Allow Stripe MCP to fetch customer details?",
        subtitle: "The tool will read customer_id you provide and call /v1/customers.",
        riskLevel: "medium",
        fields: [
          {
            name: "customer_id",
            label: "Customer ID",
            type: "string",
            value: "cus_LpA42q",
          },
          { name: "include_invoices", label: "Include invoices", type: "boolean", value: true },
        ],
      },
      focusedAction: "allow",
    },
  },
]

export const PermissionGalleryScene = ({
  harness,
  brandHue,
  darkMode,
}: PermissionGallerySceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const stageDuration = 3.5
  const idx = Math.min(STAGES.length - 1, Math.floor(t / stageDuration))
  const stage = STAGES[idx]

  const localT = t - idx * stageDuration
  const stageOpacity = interpolate(
    localT,
    [0, 0.35, stageDuration - 0.35, stageDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )

  let focusedAction = stage.promptProps.focusedAction
  if (localT > 1.5 && localT < 2.5 && stage.promptProps.mode !== "elicitation") {
    focusedAction = (stage.promptProps.mode === "codex_decision" ? "decline" : "deny") as PermissionAction
  }

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
          <ChatMock
            title={stage.title}
            harness={harness}
            messages={stage.conversation}
            showTrafficLights
            placeholder="Permission prompts steal focus until resolved"
            permissionPrompt={
              <div style={{ opacity: stageOpacity }}>
                <PermissionPromptMock {...stage.promptProps} focusedAction={focusedAction} />
              </div>
            }
          />
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
