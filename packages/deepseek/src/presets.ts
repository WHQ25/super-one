/**
 * The agent-preset roster: dsh's own "mode" vocabulary.
 *
 * A preset is a declaration row — one `@deepseek-ai/dsh-agent-preset` entry
 * whose `plugins` list is an agent-plane composition deciding which tools the
 * model gets and what its prompt says. The registry mounts each declaration
 * ONCE per process under a standing scope, and a session joins by having its
 * agent scope parented to that mount.
 *
 * This module owns only the seam: reading the vendored declarations, the slice
 * of the registry this integration drives, and the projection the renderer
 * consumes. Composition itself is the YAML's business.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { Context } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  agentPresetProjectionDefinition,
  entryListProblem,
  type AgentPreset,
  type AgentPresetRegistry,
  type PresetDefinition,
} from '@deepseek-ai/dsh-agent-preset-registry'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DeepseekPresetInfo } from '@superone/shared/agent-types'
import type { StoredSession } from './stored-session'

/** The plugin every preset declaration row names. */
export const AGENT_PRESET_PLUGIN = '@deepseek-ai/dsh-agent-preset'

/** A vendored declaration file's suffix: a Cordis patch list, as upstream ships it. */
const PRESET_FILE_SUFFIX = '.patch.yml'

/** One preset declaration row, ready for `loader.create()`. */
export interface PresetDeclaration extends Omit<EntryOptions, 'config'> {
  config: PresetDefinition
}

/**
 * Read every preset declaration the vendored patch files insert.
 *
 * The files are upstream's `packages/bundle/web-app/presets/*.patch.yml`,
 * copied verbatim apart from the documented deviation, so they are applied with
 * `cordis-plugin-include`'s own patch semantics and parsed in its `!!js`
 * dialect — never re-interpreted locally. A file that fails to parse or
 * validate throws with its name: a shipped preset that silently disappeared
 * would take its tools with it and look like a model problem.
 * @param root - the directory holding the vendored files.
 * @returns the declaration rows, in file-name order.
 */
export async function readPresetDeclarations(root: string): Promise<PresetDeclaration[]> {
  const files = (await readdir(root)).filter((name) => name.endsWith(PRESET_FILE_SUFFIX)).sort()
  const declarations: PresetDeclaration[] = []
  for (const file of files) {
    const patches = yaml.load(await readFile(join(root, file), 'utf8'), { schema: entryListSchema })
    const rows = applyEntryPatches([], patches as PatchOptions[], (message: string) => {
      throw new Error(`deepseek preset ${file}: ${message}`)
    })
    for (const row of rows) {
      if (row.name !== AGENT_PRESET_PLUGIN) continue
      const config = row.config as PresetDefinition
      const problem = entryListProblem(config.plugins, `${file} ${config.id}`)
      if (problem !== undefined) throw new Error(`deepseek preset ${file}: ${problem}`)
      declarations.push({ ...row, config })
    }
  }
  return declarations
}

/**
 * The registry methods this integration calls.
 *
 * Narrower than the service on purpose: authoring reads (`readDocument`) and
 * cold-scope leases are real capabilities we have not surfaced, and naming
 * them here would suggest otherwise.
 */
export type DeepseekPresetRoster = Pick<
  AgentPresetRegistry,
  'defaultId' | 'list' | 'resolve' | 'mount' | 'select' | 'composedPreset' | 'serviceFor'
>

/** Read the roster off a context, or `undefined` when none is mounted. */
export function presetRoster(ctx: Context): DeepseekPresetRoster | undefined {
  return ctx.get('agentPresets')
}

/**
 * Project one roster row onto the wire model.
 *
 * A preset with no display metadata falls back to its id — presentation is not
 * capability, and the shipped declarations carry none (the renderer translates
 * shipped ids itself).
 * @param preset - the roster row.
 * @returns the projection the picker renders.
 */
function projectPreset(preset: AgentPreset): DeepseekPresetInfo {
  return {
    id: preset.id,
    name: preset.name ?? preset.id,
    description: preset.description ?? null,
    order: preset.order ?? null,
    broken: preset.broken ?? null,
  }
}

/**
 * Every declared preset, in display order.
 * @param ctx - a context that can resolve the roster.
 * @returns the presets, ordered by declared `order` then id; empty without a roster.
 */
export async function listDeepseekPresets(ctx: Context): Promise<DeepseekPresetInfo[]> {
  const roster = presetRoster(ctx)
  if (!roster) return []
  const rows = await roster.list()
  return rows.map(projectPreset).sort((a, b) => {
    // A preset that declares no order sorts after every one that does, so a
    // plugin-declared preset never inserts itself into the shipped sequence.
    if (a.order !== b.order) return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
    return a.id.localeCompare(b.id)
  })
}

/**
 * The preset one stored session actually runs.
 *
 * Folded with the registry's own `agentPreset` projection unit: the header
 * names what the session STARTED with, a blank session that switched logged an
 * `agent-preset/selected` event, and the newest selection wins. A resume that
 * read the header alone would rebuild the session under a composition its
 * history was not produced under — replaying tool calls the new catalog cannot
 * make.
 * @param stored - the stored session, read once by the caller.
 * @returns the preset id, or `undefined` when the session names none.
 */
export function storedSessionPreset(stored: StoredSession): string | undefined {
  const { init, apply } = agentPresetProjectionDefinition
  const preset = stored.events.reduce(apply, init(stored.header))
  return preset ?? undefined
}

/**
 * Whether a session has produced nothing yet, and may therefore still switch.
 *
 * dsh restricts a preset switch to a blank agent: swapping a composition that
 * already ran would strand logged tool calls the new catalog cannot make. A
 * turn having opened at all is the boundary — not whether it finished.
 * @param events - the session's event log.
 * @returns whether no turn has opened.
 */
export function sessionIsBlank(events: readonly SessionEvent[]): boolean {
  return !events.some((event) => event.type === 'turn/start')
}
