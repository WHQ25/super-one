import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z, toJSONSchema, type ZodTypeAny } from 'zod'
import { DEVICE_AGENT_TOOL_NAMES } from '@superone/shared/superone-host-owned-tools'
import type { SuperoneMcpToolDescriptor } from '../mcp/superone-mcp-types'

export { DEVICE_AGENT_TOOL_NAMES }

export type DeviceAgentToolName = (typeof DEVICE_AGENT_TOOL_NAMES)[number]

export function isDeviceAgentToolName(name: string): name is DeviceAgentToolName {
  return (DEVICE_AGENT_TOOL_NAMES as readonly string[]).includes(name)
}

/**
 * Only where a touch device can exist.
 *
 * Resolved from the platform rather than from whether a device is currently booted:
 * Codex snapshots `tools/list` once per session and ignores `list_changed`, so a
 * surface that appears when a simulator boots would be missing for the rest of a
 * session that started without one.
 */
export function isDeviceAgentEnabled(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin'
}

const targetFields = {
  ref: z.string().optional().describe('Element ref from the snapshot, e.g. "@e12". Preferred over coordinates.'),
  x: z.number().min(0).max(1).optional().describe('Horizontal position as a fraction of the screen (0-1). Only when no ref fits.'),
  y: z.number().min(0).max(1).optional().describe('Vertical position as a fraction of the screen (0-1).'),
}

const actionSchema = z.object({
  type: z.enum([
    'tap', 'doubleTap', 'longPress', 'swipe', 'pinch',
    'press', 'type', 'key', 'rotate', 'keyboard',
  ]),
  ...targetFields,
  direction: z.enum(['up', 'down', 'left', 'right']).optional()
    .describe('swipe: which way the finger travels. Content moves the opposite way, so "up" scrolls down a list.'),
  distance: z.number().min(0.05).max(1).optional()
    .describe('swipe: travel as a fraction of the screen. Default 0.6.'),
  toX: z.number().min(0).max(1).optional().describe('swipe: explicit destination instead of direction.'),
  toY: z.number().min(0).max(1).optional(),
  scale: z.number().min(0.1).max(5).optional()
    .describe('pinch: final separation factor. Below 1 pinches in (zoom out), above 1 spreads.'),
  durationMs: z.number().int().min(16).max(10_000).optional()
    .describe('How long the gesture takes. Short swipes flick and coast; long ones drag and stop.'),
  text: z.string().optional()
    .describe('type: text to enter. Anything the simulated keyboard cannot spell (Chinese, emoji) is pasted automatically.'),
  button: z.enum(['home', 'lock', 'side', 'volume-up', 'volume-down']).optional(),
  orientation: z.enum(['portrait', 'landscape-left', 'portrait-upside-down', 'landscape-right']).optional(),
  connected: z.boolean().optional()
    .describe('keyboard: attach or detach the hardware keyboard. Detach it to make the on-screen keyboard appear.'),
})

/**
 * A condition always names an element, and the text kinds always carry text.
 *
 * JSON Schema cannot say "at least one of these three" in a form every harness
 * enforces, so the requirement is stated in the descriptions for the model and
 * checked by `parseCondition` for the wire. The refinements below only cover the
 * in-process SDK path, where args are parsed against this schema before they reach
 * the tool — they are the fast, specific failure, not the guarantee.
 */
const conditionSchema = z.object({
  kind: z.enum(['exists', 'notExists', 'textEquals', 'textContains']),
  ref: z.string().optional().describe('Only valid within the snapshot it came from; prefer label or identifier when waiting.'),
  label: z.string().optional().describe('Visible name of the element.'),
  identifier: z.string().optional().describe('Developer-assigned id. Survives copy changes and translation — the most durable target.'),
  text: z.string().min(1).optional()
    .describe('The string textEquals/textContains compares against. Required by those two kinds, and NOT a way to name an element — use label for that.'),
})
  .refine(
    (value) => Boolean(value.ref ?? value.label ?? value.identifier),
    { message: 'A condition must name the element with ref, label or identifier.' },
  )
  .refine(
    (value) => !(value.kind === 'textEquals' || value.kind === 'textContains') || Boolean(value.text),
    { message: 'textEquals and textContains need text.' },
  )

const descriptionField = {
  description: z.string().trim().min(1).max(160).describe(
    'A short human-friendly explanation of what this step accomplishes, phrased for the user watching '
    + "(e.g. 'Open the profile tab', 'Check the order total'). Shown in the UI in place of refs and coordinates. "
    + "Write it in the conversation's language.",
  ),
}

const toolDefs: Array<{ name: DeviceAgentToolName; description: string; shape: Record<string, ZodTypeAny> }> = [
  {
    name: 'device_list',
    description:
      'Browse the devices this machine can offer, one tier at a time — a dev machine holds '
      + 'over a hundred simulators, so this never dumps them all. No arguments: what is running '
      + '(attaching is instant; a cold boot costs ~20s), what this project used before, and which '
      + 'kinds exist. kind: that kind\'s models. model: that model\'s devices, one per runtime, '
      + 'with the ids. Prefer a running or recent device; ids only matter when you need a specific '
      + 'runtime, since device_request_control also takes a model name and picks its newest. '
      + 'Free and side-effect-free — it grants nothing and boots nothing.',
    shape: {
      kind: z.string().optional()
        .describe('Narrow to one family: "iphone", "ipad", "watch", "tv", "vision". Returns its models.'),
      model: z.string().optional()
        .describe('A model name from the kind tier ("iPhone 17 Pro Max"). Returns one entry per runtime, with ids.'),
    },
  },
  {
    name: 'device_request_control',
    description:
      'Ask the user to let this session control one specific device, and wait for their answer. '
      + 'Every other device_* tool needs that grant and fails with NO_DEVICE until this succeeds — call it first, '
      + 'not after a failure. Pick the device from device_list yourself; the user only approves or declines, '
      + 'and a decline carries their feedback (often naming a different device — read it before retrying). '
      + 'Returns the device once it is bound and ready, booting it if it was not running. '
      + 'Calling it again for a device this session already controls returns it without prompting. '
      + 'Installing and launching a build is not part of this — use `xcrun simctl install/launch <udid>` afterwards.',
    shape: {
      ...descriptionField,
      device: z.string()
        .describe('The id from device_list. A device name ("iPhone 17 Pro Max") is matched loosely against the '
          + 'catalog as a fallback, but the id is what makes the approved device the one you meant.'),
    },
  },
  {
    name: 'device_snapshot',
    description:
      'Capture the screen and return a stateId later calls must quote. '
      + 'mode=semantic (default) returns the accessibility tree with @eN refs, labels, identifiers and bounds — '
      + 'prefer it: refs survive animation and rotation, coordinates do not. '
      + 'mode=visual saves a PNG and returns image.path (not pixels); Read it to look. fused returns both. '
      + 'Waits for animation to stop; settled=false means geometry is approximate. '
      + 'A region with no accessibility tree — a WebView, a canvas — has its text read from pixels and merged in, '
      + 'marked (ocr): tap those, never press. The reply says source=ocr or hybrid. '
      + 'Re-snapshot after anything that changes the screen — refs are positional and device_act rejects a stale stateId.',
    shape: {
      ...descriptionField,
      mode: z.enum(['semantic', 'visual', 'fused']).optional().describe('Default semantic'),
      maxNodes: z.number().int().min(1).max(2000).optional()
        .describe('Ceiling on tree size. Default 500; truncated=true means the screen has more.'),
    },
  },
  {
    name: 'device_query',
    description:
      'Search or inspect an existing snapshot without re-capturing the device. '
      + 'Use this instead of taking another snapshot when you only need to find an element or read its details — '
      + 'it costs no device round trip and cannot race an animation. '
      + 'op=search matches text against labels, values and identifiers. op=inspect returns one element and its children.',
    shape: {
      ...descriptionField,
      stateId: z.string().describe('From a prior device_snapshot.'),
      op: z.enum(['search', 'inspect']),
      text: z.string().optional().describe('For search.'),
      ref: z.string().optional().describe('For inspect, e.g. "@e12".'),
    },
  },
  {
    name: 'device_act',
    description:
      'Run 1-10 touch actions against a snapshot, then re-observe to judge if they worked. '
      + 'Actions: tap, doubleTap, longPress, swipe(direction|toX/toY), pinch(scale), press(ref), type, key, rotate, keyboard. '
      + 'Prefer press for a ref-backed control; it goes through accessibility, immune to animation, rotation and scale '
      + '(not on a source=ocr snapshot — tap there). Aim touch actions at refs too; raw x/y is a last resort. '
      + 'The whole batch, stale stateId included, is validated up front. '
      + 'rotate ends the snapshot it is in: put it last, then re-snapshot — a later ref or coordinate is refused. '
      + 'Returns worked|didnt|unknown; unknown means input landed but nothing visibly changed. Pass expect to define success.',
    shape: {
      ...descriptionField,
      stateId: z.string(),
      actions: z.array(actionSchema).min(1).max(10),
      expect: conditionSchema.optional().describe('Postcondition checked after the actions run.'),
    },
  },
  {
    name: 'device_wait_for',
    description:
      'Wait until the screen satisfies a condition. Use this instead of snapshotting in a loop. '
      + 'Distinguishes preexisting (already true when asked) from verified (became true while waiting), '
      + 'so you can tell a real transition from a check that was never going to fail. '
      + 'Returns a fresh settled stateId and matching tree when successful. '
      + 'Target the element by label or identifier, not by ref: refs belong to one snapshot, and what you are waiting for usually does not exist yet. '
      + 'Every condition must name an element that way — text only says what to compare, it never selects.',
    shape: {
      ...descriptionField,
      condition: conditionSchema,
      timeoutMs: z.number().int().min(100).max(60_000).optional().describe('Default 5000'),
    },
  },
]

function zodShapeToJsonSchema(shape: Record<string, ZodTypeAny>): Record<string, unknown> {
  const schema = toJSONSchema(z.object(shape)) as Record<string, unknown>
  const { $schema: _schema, ...rest } = schema
  return rest
}

/** Stable descriptors for the stdio surface (Codex / ACP / OpenCode). */
export function getDeviceAgentToolDescriptors(): SuperoneMcpToolDescriptor[] {
  return toolDefs.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: zodShapeToJsonSchema(def.shape),
  }))
}

/**
 * Register on an in-process McpServer (the Claude / OpenCode SDK path).
 *
 * Both surfaces read the same `toolDefs`, so the descriptions and schemas cannot
 * drift apart — the failure this repo keeps hitting is a tool that works in one
 * harness and is silently missing in another.
 */
export function registerDeviceAgentTools(
  server: McpServer,
  sessionId: string,
  execute: (
    sessionId: string,
    name: DeviceAgentToolName,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{
    content: Array<{ type: 'text'; text: string }>
    isError?: boolean
  }>,
): void {
  if (!isDeviceAgentEnabled()) return
  for (const def of toolDefs) {
    const schema = z.object(def.shape)
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.shape },
      async (args: Record<string, unknown>, extra) => {
        const parsed = schema.parse(args ?? {}) as Record<string, unknown>
        return execute(sessionId, def.name, parsed, extra.signal)
      },
    )
  }
}
