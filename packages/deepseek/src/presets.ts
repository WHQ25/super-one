/**
 * The agent-preset roster: dsh's own "mode" vocabulary.
 *
 * A preset is a directory holding one `agent.cordis.yml` — an agent-plane
 * composition that decides which tools the model gets and what its prompt says.
 * The roster mounts each one ONCE per process under a standing scope, and a
 * session joins by having its agent scope parented to that mount.
 *
 * This module owns only the seam: the slice of the service this integration
 * drives, and the projection the renderer consumes. Composition itself is the
 * YAML's business.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentPreset, AgentPresets } from '@deepseek-ai/dsh-agent-presets'
// Side-effect type import: merges `sessionPersistence` onto `Context` so the
// read below is typed by upstream rather than by a local structural shape.
import type {} from '@deepseek-ai/dsh-session-persistence'
// The root re-exports the session reader, and with it the module augmentation
// that merges `agent-preset/selected` into `SessionEventMap`; the package
// publishes no `./session` subpath.
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'

/** The header shape the session reader requires, taken from its own signature. */
type PresetSessionHeader = Parameters<typeof resolveSessionPreset>[0]['header']
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { DeepseekPresetInfo } from '@superone/shared/agent-types'

export { resolveSessionPreset }

/**
 * The roster methods this integration calls.
 *
 * Narrower than the service on purpose: `copy`/`remove` (authoring) and the
 * standing-key reader are real capabilities we have not surfaced, and naming
 * them here would suggest otherwise.
 */
export type DeepseekPresetRoster = Pick<
  AgentPresets,
  'defaultId' | 'list' | 'resolve' | 'mount' | 'recompose' | 'composedPreset'
>

/** Read the roster off a context, or `undefined` when none is mounted. */
export function presetRoster(ctx: Context): DeepseekPresetRoster | undefined {
  return ctx.get('agentPresets')
}

/**
 * Project one roster row onto the wire model.
 *
 * A preset with no metadata falls back to its id — presentation is not
 * capability, and a preset whose `preset.yml` is missing or malformed still
 * composes a session.
 * @param preset - the roster row.
 * @returns the projection the picker renders.
 */
function projectPreset(preset: AgentPreset): DeepseekPresetInfo {
  return {
    id: preset.id,
    name: preset.name ?? preset.id,
    description: preset.description ?? null,
    trust: preset.trust,
    order: preset.order ?? null,
    broken: preset.broken ?? null,
  }
}

/**
 * Every preset the configured roots currently supply, in display order.
 *
 * Discovery is unmemoized in dsh, so this re-reads the roots on every call: a
 * preset authored while the app runs is visible immediately, and a deleted one
 * disappears from the next read.
 * @param ctx - a context that can resolve the roster.
 * @returns the presets, ordered by declared `order` then id; empty without a roster.
 */
export async function listDeepseekPresets(ctx: Context): Promise<DeepseekPresetInfo[]> {
  const roster = presetRoster(ctx)
  if (!roster) return []
  const rows = await roster.list()
  return rows.map(projectPreset).sort((a, b) => {
    // A preset that declares no order sorts after every one that does, so a
    // locally authored preset never inserts itself into the shipped sequence.
    if (a.order !== b.order) return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
    return a.id.localeCompare(b.id)
  })
}

/**
 * The preset one stored session actually runs.
 *
 * The creation header names what it STARTED with; a blank session that switched
 * logged an `agent-preset/selected` event, and the newest selection wins. A
 * resume that read the header alone would rebuild the session under a
 * composition its history was not produced under — replaying tool calls the new
 * catalog cannot make.
 * @param ctx - a context that can resolve session persistence.
 * @param sessionId - the session to look up.
 * @returns the preset id, or `undefined` when there is nothing stored to read.
 */
export async function storedSessionPreset(
  ctx: Context,
  sessionId: string,
): Promise<string | undefined> {
  const persistence = ctx.get('sessionPersistence')
  if (!persistence) return undefined
  const stored = await persistence.load(SessionId(sessionId))
  // `load` types its metadata as the generic durable record; the preset reader
  // wants the narrower header it documents. Asserting only here keeps the shape
  // requirement attached to `resolveSessionPreset`'s own signature — it is
  // derived from it via `Parameters<>` — rather than restating the service.
  return resolveSessionPreset({ header: stored.meta as PresetSessionHeader, events: stored.events })
}

/**
 * Whether a session has produced nothing yet, and may therefore still switch.
 *
 * dsh restricts `recompose()` to a blank agent and leaves the check to the
 * caller: swapping a composition that already ran would strand logged tool
 * calls the new catalog cannot make. A turn having opened at all is the
 * boundary — not whether it finished.
 * @param events - the session's event log.
 * @returns whether no turn has opened.
 */
export function sessionIsBlank(events: readonly SessionEvent[]): boolean {
  return !events.some((event) => event.type === 'turn/start')
}
