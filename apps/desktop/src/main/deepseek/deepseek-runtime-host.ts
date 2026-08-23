import {
  DeepseekRuntime,
  type ApprovalDecision,
  type DeepseekAdapterOptions,
  type DeepseekApprovalRequest,
} from '@superone/deepseek'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'
import log from '../logger'
import { readAppSettings } from '../app-settings-service'
import { DEEPSEEK_CREDENTIAL_REF, resolveDeepseekApiKey } from './deepseek-credentials'
import { stopTrackingDshMcpConfig } from './deepseek-mcp-sync'

/** The preset a session composes with when the user has not picked one. */
export const DEFAULT_DSH_AGENT_PRESET = 'standard'

/**
 * Where third-party dsh plugins the user installed live.
 *
 * Under `userData` rather than beside the app: the app directory is read-only
 * once packaged (and is replaced wholesale by an update), while this must
 * survive upgrades and be writable without elevation.
 */
export function dshPluginRoot(): string {
  return join(app.getPath('userData'), 'dsh-plugins')
}

/**
 * Credential reference the embedded adapter asks for. It is a *name*, never a
 * value: the credential seam resolves it out of SuperOne's store per request.
 */
export { DEEPSEEK_CREDENTIAL_REF } from './deepseek-credentials'

/** Route defaults shared by the backend and the connect probe. */
export const DEEPSEEK_DEFAULT_PROVIDER = 'deepseek-official'
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-pro'
/**
 * The routes SuperOne offers, and what they accept.
 *
 * `inputModalities` is the one field with teeth: `llm-deepseek` reads it both
 * when serializing a request and when SuperOne decides whether a composer
 * attachment may be admitted at all (`DeepseekRuntime.imageBlocksFor`). The two
 * text-only entries stay text-only because DeepSeek's chat-completions
 * reference still describes their user content as text; upstream treats an
 * uncatalogued endpoint the same way, so the omission is the accurate answer
 * rather than a TODO.
 *
 * The vision route is upstream's own catalog entry, mirrored here because
 * SuperOne passes an explicit `models` list and therefore never inherits the
 * adapter's defaults. Its per-request pixel and byte budgets are deliberately
 * left off: omitted, `llm-deepseek` fills in exactly the values its own default
 * entry carries, so restating them here would only be a second copy to drift.
 *
 * `-exp` is the provider's own suffix, not ours. It is an experimental route
 * DeepSeek may withdraw, which is why it is offered beside the stable pair
 * instead of replacing either.
 *
 * No entry declares `contextWindow`, on purpose. Nothing in the DeepSeek API
 * reports capacity, so whatever is written here IS the number — and it is not
 * only a progress ring: `compaction-basic` computes its trigger from it
 * (`contextWindow * 0.8`), so a value below the truth compacts a healthy
 * conversation away early. Omitted, the adapter's own `defaultContextWindow`
 * answers, which is the figure DeepSeek's harness team publishes for these
 * exact model ids and which then tracks upstream on every bump instead of
 * ageing here. It also keeps a catalogued route and an unlisted pass-through
 * id — which always reads that same default — from disagreeing.
 */
export const DEEPSEEK_MODEL_CATALOG = [
  { id: DEEPSEEK_DEFAULT_MODEL, name: 'DeepSeek V4 Pro' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  {
    id: 'deepseek-v4-flash-vision-exp',
    name: 'DeepSeek V4 Flash Vision (Exp)',
    inputModalities: ['text', 'image'],
  },
] as const satisfies DeepseekAdapterOptions['models']

/**
 * One embedded dsh Cordis tree per app lifetime, shared by every DeepSeek
 * session (design D2). Approval questions are routed to whichever backend owns
 * the asking agent; the runtime itself stays UI-agnostic.
 */

export type ApprovalRouter = (request: DeepseekApprovalRequest) => Promise<ApprovalDecision> | null

const approvalRouters = new Map<string, ApprovalRouter>()
let runtimePromise: Promise<DeepseekRuntime> | null = null

/** Register the answerer for one session's approval questions. */
export function registerApprovalRouter(sessionId: string, router: ApprovalRouter): () => void {
  approvalRouters.set(sessionId, router)
  return () => approvalRouters.delete(sessionId)
}

/**
 * The running tree, or `null` when none was ever booted.
 *
 * Callers that react to *ambient* events (a config file changed) use this
 * instead of `getDeepseekRuntime()`, so a background signal never boots a tree
 * the user has not asked for.
 */
export async function peekDeepseekRuntime(): Promise<DeepseekRuntime | null> {
  return runtimePromise ? await runtimePromise.catch(() => null) : null
}

/**
 * Push the plugin registry's current state into the running tree, if there is
 * one.
 *
 * Every plugin mutation ends here, which is what makes an install or a toggle
 * take effect without a restart. Deliberately built on `peek`: managing plugins
 * must not boot dsh as a side effect of opening a settings page.
 */
export async function reconcileDshPlugins(): Promise<void> {
  const runtime = await peekDeepseekRuntime()
  await runtime?.syncPlugins()
}

/**
 * The shipped agent-preset root — the `system`-trust half of the roster.
 *
 * Not optional in production: since the model-facing tool rows live in the
 * preset compositions, a tree booted without this root reaches the model with
 * no dsh tools at all. `dsh-agent-presets` appends `<dshHome>/.agent-presets`
 * as the writable root on top of it.
 */
export function shippedPresetRoot(): string {
  return is.dev
    ? join(app.getAppPath(), 'resources', 'agent-presets')
    : join(process.resourcesPath, 'agent-presets')
}

export function getDeepseekRuntime(): Promise<DeepseekRuntime> {
  if (!runtimePromise) {
    runtimePromise = DeepseekRuntime.create({
      // Harness identity stays on; SuperOne additions ride the persona field
      // (docs/draft/deepseek-harness-integration.md §12.1).
      persona: '',
      persistenceRoot: join(app.getPath('userData'), 'deepseek-sessions'),
      // Passed explicitly because `dsh-attachment-local` otherwise follows
      // `DSH_HOME` and then `~/.dsh`, and SuperOne runs with no dsh home (D3).
      // The store keeps content-addressed image bytes: what `read_image` puts
      // away, what the trajectory inspector reads back, and what a multimodal
      // model route would be sent. It sits under `userData` for the same reason
      // the session logs do — the app directory is read-only once packaged.
      attachmentHome: join(app.getPath('userData'), 'deepseek-attachments'),
      presetRoots: [shippedPresetRoot()],
      defaultPreset: DEFAULT_DSH_AGENT_PRESET,
      pluginRoot: dshPluginRoot(),
      onPluginMount: (report) => {
        // A plugin that did not load is reported, never fatal — the runtime is
        // already up by the time this runs. Logging each one by name is what
        // makes a silently missing tool diagnosable.
        for (const outcome of report.outcomes) {
          if (outcome.status === 'mounted') {
            log.info(`[deepseek] plugin mounted: ${outcome.row.id} (${outcome.row.name}@${outcome.row.version})`)
          } else {
            log.error(`[deepseek] plugin ${outcome.status}: ${outcome.row.id} — ${outcome.reason ?? 'no reason given'}`)
          }
        }
        if (report.registryProblem !== undefined) {
          log.error(`[deepseek] plugin registry unusable, no plugins loaded: ${report.registryProblem}`)
        }
      },
      // Resolved per request, so re-binding a key in SuperOne settings reaches
      // the next turn without a restart — and no secret enters process.env.
      credentialLookup: (ref) => (ref === DEEPSEEK_CREDENTIAL_REF ? resolveDeepseekApiKey() : undefined),
      deepseekAdapter: {
        apiKeyEnv: DEEPSEEK_CREDENTIAL_REF,
        models: DEEPSEEK_MODEL_CATALOG,
      },
      onApproval: async (request) => {
        const decision = approvalRouters.get(request.sessionId)?.(request)
        // No owner (session closed mid-question) fails closed.
        return decision ? await decision : 'rejected'
      },
    }).catch((error: unknown) => {
      runtimePromise = null
      log.error('[deepseek] runtime boot failed', error)
      throw error
    })
  }
  return runtimePromise
}

export async function disposeDeepseekRuntime(): Promise<void> {
  stopTrackingDshMcpConfig()
  const pending = runtimePromise
  if (!pending) return
  runtimePromise = null
  approvalRouters.clear()
  const runtime = await pending.catch(() => null)
  await runtime?.dispose()
}
