import { z } from 'zod'
import { conditionSchema, parseCondition } from '../device-agent/conditions'
import type { DeviceAgentSession } from '../device-agent/execute'
import { createDeviceAdapter } from './device-page'
import { FastRun } from './loop'
import { finishRun, jevClient, resumeRun, runInputShape, runOptions } from './run-tool-common'

export const DEVICE_RUN_DESCRIPTION =
  'Experimental (Jev setting): pursue a multi-step touch-device goal with taps, typing and scrolling chosen without a model turn per step. '
  + 'Requires existing device_request_control approval; never requests control inside the loop. Start with goal and optional device, presets and done_when; the loop judges risk and completion itself. '
  + 'Example: done_when={kind:"exists",label:"About"}; use device_wait_for conditions with label or identifier. '
  + 'Risky or uncertain controls pause; resume with runId + answer. Missing accessibility trees pause for inspection. '
  + 'Use device_act for known action sequences, single steps, gestures or pixels.'

export const deviceRunInputShape = {
  ...runInputShape,
  description: z.string().trim().min(1).max(160).describe("Short, human-friendly explanation of the goal for the user watching, in the conversation's language."),
  device: z.string().optional().describe('A device already controlled by this session. Required when starting with more than one held device. A resumed run keeps its original device.'),
  done_when: conditionSchema.optional().describe('Same vocabulary as device_wait_for. label matches the entire accessibility name, which may combine a title and value; prefer an observed identifier. Refs are positional. Example: {kind:"exists",identifier:"details-page"}.'),
}
const schema = z.object(deviceRunInputShape)

export interface DeviceRunTarget {
  deviceId: string
  session: DeviceAgentSession
  assertControl(): void
}

export async function executeDeviceRun(
  sessionId: string,
  raw: Record<string, unknown>,
  resolve: (device?: string) => DeviceRunTarget,
  signal?: AbortSignal,
) {
  const args = schema.parse(raw)
  const existing = resumeRun(sessionId, 'device', args)
  if (existing) return finishRun(sessionId, 'device', existing, await existing.resume(args.answer!, signal))
  if (!args.goal?.trim()) throw new Error('`goal` is required to start device_run; use runId + answer to resume.')
  const doneWhen = args.done_when ? parseCondition(args.done_when) : undefined
  const target = resolve(args.device)
  const adapter = createDeviceAdapter({
    ...target, doneWhen,
    ask: (request, signal) => jevClient().ask(request, signal),
  })
  const run = new FastRun(runOptions(args), adapter)
  return finishRun(sessionId, 'device', run, await run.start(signal))
}
