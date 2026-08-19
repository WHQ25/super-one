/**
 * Request-header projection: turning dsh's `EpochHeader` snapshots into the
 * inspector's "what the model was actually configured with" panel, plus the
 * diff against the snapshot it superseded.
 *
 * dsh only logs a header when it *changes* (`headerEquals` gates the write), so
 * consecutive snapshots always differ in at least one field — a diff is never
 * empty except for the `initial` snapshot, which has no predecessor.
 */

import { structuredPatch } from 'diff'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
import { boundPayload } from './payload'
import type {
  TrajectoryCallConfig,
  TrajectoryDiffHunk,
  TrajectoryFieldChange,
  TrajectoryHeader,
  TrajectoryHeaderDiff,
  TrajectorySchema,
} from '@superone/shared/trajectory-types'

/** Unified-diff context lines kept around each system-prompt change. */
const SYSTEM_DIFF_CONTEXT = 3

/** The call-config fields compared field-wise, in display order. */
const CONFIG_FIELDS = ['provider', 'model', 'reasoningEffort', 'temperature', 'maxTokens', 'stop'] as const

/**
 * Project one logged header snapshot onto the wire model.
 * @param header - the dsh header, already canonical when it came off the log.
 * @param index - ordinal in the projection's header list.
 * @param seq - the source event's sequence number.
 * @param time - the source event's Unix epoch ms.
 * @param reason - why dsh appended this snapshot.
 * @returns the projected header.
 */
export function projectHeader(
  header: EpochHeader,
  index: number,
  seq: number,
  time: number,
  reason: 'initial' | 'resume' | 'change',
): TrajectoryHeader {
  const defaults = header.adapterDefaults
  return {
    index,
    seq,
    time,
    reason,
    config: { ...header.config } as TrajectoryCallConfig,
    adapterDefaults: defaults?.reasoningEffort === true || defaults?.maxTokens === true ? { ...defaults } : null,
    system: header.system === undefined ? null : boundPayload(header.system),
    tools: (header.tools ?? []).map((tool): TrajectorySchema => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  }
}

/**
 * Render one config value for a before/after cell.
 * @param value - the raw config field value.
 * @returns a display string, or `null` when the field was absent.
 */
function displayConfigValue(value: unknown): string | null {
  if (value === undefined) return null
  return Array.isArray(value) ? value.join(', ') : String(value)
}

/**
 * Compare two call configs field-wise.
 * @param before - the superseded config.
 * @param after - the config now in force.
 * @returns one entry per field that differs, in declaration order.
 */
function diffConfig(before: TrajectoryCallConfig, after: TrajectoryCallConfig): TrajectoryFieldChange[] {
  const changes: TrajectoryFieldChange[] = []
  for (const field of CONFIG_FIELDS) {
    const from = displayConfigValue(before[field])
    const to = displayConfigValue(after[field])
    if (from !== to) changes.push({ field, before: from, after: to })
  }
  return changes
}

/**
 * Diff two system prompts into context-collapsed unified hunks.
 *
 * A system prompt runs tens of kilobytes while a real change touches a few
 * lines, so shipping the whole before/after pair would dominate the transport
 * for no reading benefit. Hunks carry only the changed regions plus context.
 * @param before - the superseded prompt text, or `null` when there was none.
 * @param after - the prompt now in force, or `null` when it was removed.
 * @returns the hunks, empty when the two texts are identical.
 */
function diffSystem(before: string | null, after: string | null): TrajectoryDiffHunk[] {
  if (before === after) return []
  const patch = structuredPatch('system', 'system', before ?? '', after ?? '', undefined, undefined, {
    context: SYSTEM_DIFF_CONTEXT,
  })
  return patch.hunks.map((hunk) => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines,
  }))
}

/**
 * Compare two tool catalogs by name, then by content for the shared names.
 *
 * Comparison is canonical-JSON, matching how dsh itself decides whether a
 * schema changed — so this reports a change exactly when dsh logged one.
 * @param before - the superseded catalog.
 * @param after - the catalog now in force.
 * @returns added, removed, and content-changed tool names.
 */
function diffTools(before: TrajectorySchema[], after: TrajectorySchema[]): Pick<
  TrajectoryHeaderDiff,
  'toolsAdded' | 'toolsRemoved' | 'toolsChanged'
> {
  const beforeByName = new Map(before.map((tool) => [tool.name, tool]))
  const afterByName = new Map(after.map((tool) => [tool.name, tool]))
  const toolsAdded: string[] = []
  const toolsChanged: string[] = []
  for (const [name, tool] of afterByName) {
    const prior = beforeByName.get(name)
    if (prior === undefined) {
      toolsAdded.push(name)
      continue
    }
    if (JSON.stringify(prior) !== JSON.stringify(tool)) toolsChanged.push(name)
  }
  const toolsRemoved = [...beforeByName.keys()].filter((name) => !afterByName.has(name))
  return { toolsAdded, toolsRemoved, toolsChanged }
}

/**
 * Diff a header snapshot against the one it superseded.
 *
 * Takes the raw dsh headers rather than their projections: the projected
 * `system` payload is bounded for transport, and diffing a truncated prompt
 * would report changes that are artifacts of the bound.
 * @param before - the superseded dsh header, or `null` for the first snapshot.
 * @param after - the dsh header now in force.
 * @returns the change set, or `null` when there is no predecessor to compare.
 */
export function diffHeaders(before: EpochHeader | null, after: EpochHeader): TrajectoryHeaderDiff | null {
  if (before === null) return null
  const beforeSystem = before.system ?? null
  const afterSystem = after.system ?? null
  return {
    config: diffConfig(before.config, after.config),
    systemChanged: beforeSystem !== afterSystem,
    systemHunks: diffSystem(beforeSystem, afterSystem),
    ...diffTools(before.tools ?? [], after.tools ?? []),
  }
}
