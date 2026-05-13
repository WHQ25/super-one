import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  BrandScope,
  DesktopShell,
  HARNESS_CLAUDE_HUE,
  PlanApprovalMock,
} from "@superone/desktop-mocks"

export const PLAN_APPROVAL_FPS = 30
export const PLAN_APPROVAL_WIDTH = 1280
export const PLAN_APPROVAL_HEIGHT = 800
export const PLAN_APPROVAL_DURATION_IN_FRAMES = 10 * PLAN_APPROVAL_FPS

export type PlanApprovalSceneProps = {
  brandHue: number
  darkMode: boolean
}

export const planApprovalSceneDefaultProps: PlanApprovalSceneProps = {
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

const PLAN_CONTENT = `## Refactor sidebar expansion state

The sidebar currently uses a boolean to track whether the active project's rows are expanded, which means every project shares that single piece of state. Switching projects collapses everything else, which is the bug the user is seeing.

### Approach

1. Replace the boolean expansion state in \`AppSidebar.tsx\` with a \`Set<string>\` keyed by \`folderPath\`. \`Set.has\` decides whether a row is open; \`Set.add\` / \`Set.delete\` toggle it.
2. Re-wire the chevron's \`onClick\` to toggle only that path. Keep the row body's \`onClick\` for project selection — chevron uses \`stopPropagation\`.
3. Add a regression test \`AppSidebar.test.tsx\`: \`Cmd+Shift+[\` collapses the active project, and the shortcut bails out when focus is inside an editable element.

### Notes

- No persistence yet — the user asked us to verify the in-memory behavior first.
- This change is scoped to \`AppSidebar.tsx\` plus the new test file.`

export const PlanApprovalScene = ({ brandHue, darkMode }: PlanApprovalSceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps

  const switchAfterApproval = t >= 4.5
  const focusedAction: "approve" | "reject" | "toggle" =
    t < 4.5 ? "approve" : t < 6.5 ? "toggle" : "approve"

  const shellScale = interpolate(frame, [0, 0.6 * fps], [0.96, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const shellOpacity = interpolate(frame, [0, 0.4 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="items-center justify-center bg-muted p-6">
        <div
          style={{
            width: 1232,
            height: 752,
            transform: `scale(${shellScale})`,
            opacity: shellOpacity,
          }}
          className="overflow-hidden rounded-2xl shadow-2xl ring-1 ring-border/60"
        >
          <DesktopShell headerTitle="Plan review — refactor-sidebar.plan.md" showTrafficLights>
            <PlanApprovalMock
              fileName="refactor-sidebar.plan.md"
              planContent={PLAN_CONTENT}
              allowedPrompts={[
                { tool: "Edit", prompt: "AppSidebar.tsx" },
                { tool: "Write", prompt: "AppSidebar.test.tsx" },
              ]}
              switchAfterApproval={switchAfterApproval}
              fastModeTarget="acceptEdits"
              focusedAction={focusedAction}
            />
          </DesktopShell>
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
