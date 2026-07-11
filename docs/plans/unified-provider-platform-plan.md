# Unified AI Provider Platform — Architecture & Implementation Plan

Redesign of the API provider system on `feat/unified-provider`. The current system only serves agent chat (Claude SDK + Codex app-server); this redesign turns it into a general AI vendor management layer covering chat, image, video, TTS, and ASR.

**No data migration** — wholesale replacement in alpha (existing `api_providers` rows and media-gen JSON stores are dropped).

## 1. Problems with the current model

1. **Platform is inferred, not stored** — `resolveProviderKey()` guesses the brand from URL/name substrings; `provider-brands.ts` regex-extracts region/tier from preset display names.
2. **Plans are frozen snapshots** — preset `agent_configs` are copied into the row at creation; preset updates never reach existing keys.
3. **Credential and capability config are coupled** — `capabilities` JSON hangs off the key row, with a legacy `agent_configs` fallback (`effectiveCapabilities` dual-track); `is_active_claude/codex` columns mix "who uses this key" into the key itself.
4. **Task baked into protocol names** — `openai-image` / `google-image` are vendor×task mashups; they break on multi-task protocols (OpenAI Responses serves chat *and* image; Gemini `generateContent` serves chat, image, and TTS).
5. **media-gen has a parallel provider system** (JSON file storage under `media-gen/`) that duplicates key management.

## 2. Domain model

Three kinds of data, split by who owns their lifecycle:

- **Server-side facts** (Platform / Plan / Endpoint) — ship in code, update with the app version. Never seeded into the DB.
- **User secrets** (Credential) — stored in SQLite, encrypted via `safeStorage`.
- **App wiring** (ConsumerBinding) — stored in SQLite, selectable per consumer, overridable per session.

```
Platform { id, brand, name, catalogProviderId? }
└─ Plan { id, name, auth, apiKeyUrl?, endpoints[] }
   └─ ServiceEndpoint { baseUrl, protocols[], models?, defaults? }

Credential { id, platformId, planId, name, secret | secretEnv, overrides?, notes, sortOrder }
ConsumerBinding { consumer, credentialId, endpointId?, config? }
```

### 2.1 Protocol / task orthogonality

`protocol` names the wire API only. `task` is the consumer-facing capability. Their relationship is a static table that acts as both validator and default:

```ts
type CapabilityTask = 'chat' | 'image' | 'video' | 'tts' | 'asr'

type WireProtocol =
  | 'anthropic-messages'   // chat
  | 'openai-chat'          // chat  (/chat/completions)
  | 'openai-responses'     // chat, image  (image via built-in image_generation tool)
  | 'openai-images'        // image (/images/generations|edits)
  | 'openai-audio'         // tts, asr (/audio/speech, /audio/transcriptions)
  | 'google-generative'    // chat, image, tts (generateContent)

const PROTOCOL_TASKS: Record<WireProtocol, CapabilityTask[]> = { ... }
```

Rules:

- An endpoint is **one addressable service** (`baseUrl` + auth) that speaks **a set of protocols** (`protocols[]`). `baseUrl` belongs to the endpoint, shared by every protocol on it — never duplicated per protocol. Each protocol determines its own wire format + sub-path (`/chat/completions`, `/images/generations`, `/audio/speech`, …). This models an OpenAI-compatible base that serves chat+image+audio at once, or a relay that speaks `anthropic-messages` **and** `openai-chat` under a single URL.
- The endpoint's raw task surface = `⋃ PROTOCOL_TASKS[p] for p in protocols`. It carries **no** `tasks` narrowing field — actual capability is opt-in via **enabled models**: `endpoint.models[].tasks` (each model tagged with what it serves) is the only narrowing knob. A provider serves image/tts/asr only once a model tagged with that task is enabled (matches the existing media opt-in doctrine in `selectEndpoint`).
- Resolution returns a **(endpoint, protocol)** pair: pick the endpoint whose `protocols[]` serves the consumer's task (and, for chat harnesses, includes a `HARNESS_CHAT_PROTOCOLS` member), then resolve the single protocol for that task. `ResolvedService.protocol` stays **singular** — one API call speaks one wire format. Harness gates: `claude → ['anthropic-messages']`, `codex → ['openai-responses']` **only** — codex speaks the Responses wire exclusively; it cannot use `openai-chat`, so a chat-completions endpoint must never resolve for `chat:codex`.
- The old `openai-image` vs `openai-compatible-image` split (ai-sdk `createOpenAI` vs `createOpenAICompatible`) is **not** a protocol distinction — the adapter picks strict-vs-compatible by platform id (`openai` official → strict).
- `openai-chat` currently has **no** chat consumer (claude=anthropic-only, codex=responses-only) — it stays in the union as a **placeholder** for a future generic openai-chat harness. Consequence, accepted for now: `synthesizePlatformFromCatalog` emits an `openai-chat` endpoint, so a models.dev-derived provider's chat endpoint is **not bindable** to any harness until it also speaks Responses/Anthropic. Do not add a fake consumer to paper over this.
- Known debt (out of scope here): `openai-audio` still bundles two genuinely different wire shapes — `/audio/speech` (text→audio, tts) and `/audio/transcriptions` (audio→text, asr). Whichever protocol resolves for a task, the audio adapter must still branch tts-vs-asr internally. Splitting it into `openai-speech` / `openai-transcription` is deferred until tts/asr get a runtime implementation.

### 2.2 Platform

```ts
interface Platform {
  id: string                  // 'zhipu-cn' | 'zhipu-global' | 'volcengine' | 'custom:<uuid>'
  brand: string               // 'zhipu' — icon + display grouping only
  name: string                // 'GLM (CN)'
  catalogProviderId?: string  // link into @opencode-ai/models
  plans: Plan[]
}
```

- **CN/Global are separate platforms** sharing a `brand`. No `region` field — the split *is* the platform identity (different consoles, different keys, different base URLs).
- `brand` drives icon lookup (replaces `PRESET_PROVIDER_KEY` + `resolveProviderKey` heuristics) and UI grouping.

### 2.3 Plan

```ts
interface Plan {
  id: string                  // 'coding' | 'api' | 'token-plan'
  name: string
  description?: string
  auth: 'api-key' | 'oauth' | 'aws' | 'gcp'
  apiKeyUrl?: string          // one key per plan → the "get a key" jump lives here
  endpoints: ServiceEndpoint[]
}
```

- `apiKeyUrl` sits on Plan because credentials are issued per plan; one key serves all endpoints of the plan. A platform whose chat key and image key come from different consoles is, by definition, two plans.
- Official subscription providers become platforms with an `auth: 'oauth'` plan (`claude-official`, `openai-official`); Bedrock/Vertex use `aws`/`gcp`. Their Credential rows exist (so bindings have a target) but hold no secret.

### 2.4 ServiceEndpoint

```ts
interface ServiceEndpoint {
  id: string                  // unique within the plan
  baseUrl: string             // the addressable service; shared by every protocol below
  protocols: WireProtocol[]   // wire formats this base speaks; each maps to a sub-path + task set
  models?: EndpointModel[]        // curated list; default = platform catalog models. models[].tasks = narrowing knob
  defaults?: EndpointDefaults     // shipped recommended config (chat-harness mapping/env)
}

interface EndpointModel { id: string; name?: string; tasks?: CapabilityTask[] }

interface EndpointDefaults {
  modelMapping?: ProviderModelEnv   // claude-harness slot mapping (opus/sonnet/haiku/default)
  extraEnv?: Record<string, string> // harness env recommendations (API_TIMEOUT_MS, …)
}
```

### 2.5 Credential

```ts
interface Credential {
  id: string
  platformId: string
  planId: string
  name: string                     // key label, unique within platform
  secret: string                   // enc:v1: via crypto/secret-store; '' for oauth/aws/gcp
  secretEnv?: string               // read key from env var instead
  overrides?: Record<string /* endpointId */, EndpointOverride>
  notes: string
  sortOrder: number
}

interface EndpointOverride {
  baseUrl?: string                  // replace
  models?: EndpointModel[]          // replace (also the entry point for user-added models)
  extraEnv?: Record<string, string> // key-level merge, user wins
  modelMapping?: ProviderModelEnv   // slot-level merge
}
```

The plan reference + overrides delta replaces config snapshots: shipped plan updates flow through automatically, user-touched fields stay put.

### 2.6 ConsumerBinding

```ts
type ConsumerId = 'chat:claude' | 'chat:codex' | 'media:image' | 'media:video' | 'tts' | 'asr'

interface ConsumerBinding {
  consumer: ConsumerId
  credentialId: string
  endpointId?: string              // only when the plan has >1 endpoint for the task
  config?: { forcedEffort?: EffortLevel | 'auto'; modelMapping?: ProviderModelEnv }
}
```

Replaces `is_active_claude` / `is_active_codex` columns and media-gen's default-provider setting. New consumers are enum additions, not schema changes. Binding validation: `chat:claude` requires an endpoint whose protocol serves chat via `anthropic-messages` (or oauth official); `chat:codex` requires `openai-responses`/`openai-chat`.

### 2.7 Resolution

Single entry point for every consumer:

```ts
resolveService(consumer: ConsumerId, override?: { credentialId?: string }): ResolvedService

interface ResolvedService {
  platformId: string
  brand: string
  credentialId: string
  task: CapabilityTask
  protocol: WireProtocol
  baseUrl: string
  apiKey: string                   // decrypted; '' for oauth/aws/gcp
  auth: Plan['auth']
  models: EndpointModel[]
  modelMapping?: ProviderModelEnv
  extraEnv?: Record<string, string>
}
```

Pipeline: binding (or session override) → credential → registry platform/plan → endpoint matching the consumer's task → merge `endpoint.defaults ← credential.overrides ← binding.config`.

Merge rules (implemented once, unit-tested):

| Field | Rule |
|---|---|
| `baseUrl`, `models` | whole-value replace |
| `extraEnv` | key-level merge, user wins |
| `modelMapping` | slot-level merge (opus/sonnet/haiku independently) |

Adapter selection is a static matrix keyed by `(protocol, task)`:

```ts
'anthropic-messages:chat' → claude harness env expansion
'openai-responses:chat'   → codex model_providers config
'openai-images:image'     → createOpenAI().image() / createOpenAICompatible().imageModel()
'openai-responses:image'  → responses image_generation tool
'google-generative:image' → createGoogleGenerativeAI().image()
'openai-audio:tts'        → /audio/speech        (future)
'google-generative:tts'   → Gemini TTS models    (future)
```

## 3. Storage

### 3.1 Code registry (`packages/shared/src/platform-registry/`)

```
platform-registry/
  types.ts        — Platform/Plan/ServiceEndpoint/Credential/Binding/ResolvedService types
  protocols.ts    — WireProtocol, PROTOCOL_TASKS, validation helpers
  builtin.ts      — built-in Platform definitions (replaces provider-presets.ts)
  merge.ts        — pure merge rules (defaults ← overrides ← binding config)
  index.ts        — registry assembly: builtin + custom + catalog-derived
```

- Replaces `provider-presets.ts`, `preset-match.ts`, `PRESET_PROVIDER_KEY`, and the heuristics in `provider-utils.ts`.
- Catalog-derived platforms: a provider present in `@opencode-ai/models` but not built-in can be instantiated on demand (synthesized single `api` plan with one `openai-chat` endpoint from the catalog's `api`/`env` fields).
- Registry validation (test-enforced): endpoint `tasks ⊆ PROTOCOL_TASKS[protocol]`; plan/endpoint ids unique; every `chat` endpoint reachable by at least one harness consumer.

### 3.2 SQLite (new tables, no migration)

```sql
CREATE TABLE credentials (
  id TEXT PRIMARY KEY, platform_id TEXT NOT NULL, plan_id TEXT NOT NULL,
  name TEXT NOT NULL, secret TEXT NOT NULL DEFAULT '', secret_env TEXT NOT NULL DEFAULT '',
  overrides_json TEXT NOT NULL DEFAULT '{}', notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT
);
CREATE TABLE custom_platforms (
  id TEXT PRIMARY KEY,             -- 'custom:<uuid>'
  definition_json TEXT NOT NULL,   -- full Platform shape, document-style
  created_at TEXT, updated_at TEXT
);
CREATE TABLE consumer_bindings (
  consumer TEXT PRIMARY KEY, credential_id TEXT NOT NULL,
  endpoint_id TEXT, config_json TEXT NOT NULL DEFAULT '{}'
);
```

- `api_providers` table and all its columns die; media-gen JSON stores (`keys.ts`, `custom-providers.ts`, `presets.ts`, `migration.ts`) die.
- Secrets: `crypto/secret-store.ts` (`enc:v1:` safeStorage) on write; masked (`sk-…last4`) over IPC; decrypt only inside main-process resolver.
- `sessions.provider_id` → repurposed as `credential_id` reference. **Dynamic-follow semantics**: null = follow the global binding; only an explicit in-chat `/provider` switch writes it. Deleted credential → fall back to global binding.

## 4. Consumer integration

| Consumer | File | Change |
|---|---|---|
| Claude harness env | `main/agent/provider-env.ts` | `buildProviderEnv` consumes `ResolvedService` (extraEnv + modelMapping expansion + `ANTHROPIC_BASE_URL`/`API_KEY`) instead of `ApiProvider` row parsing |
| Codex | `main/codex/app-server-connection.ts` | `model_providers` config built from `ResolvedService` (`openai-responses` endpoint) |
| Session / manager | `main/session/session.ts`, `session-manager.ts` | resolve via `resolveService('chat:<harness>', { credentialId: session.credential_id })` |
| Image gen | `main/media-gen/providers.ts` | `resolveMediaProvider` → thin wrapper over `resolveService('media:image')`; adapter matrix picks the ai-sdk constructor |
| media-gen settings | `main/media-gen/settings-service.ts` | reads credentials/bindings instead of JSON files |
| Usage tracking | `main/agent/provider-usage-service.ts` | keyed by `credentialId` |
| Mobile | `buildRemoteActiveProvider` (provider-utils) | derives from `ResolvedService`; `presetKey` field → `brand` |

## 5. UI (renderer)

- **ProvidersPage**: platform list grouped by `brand` (pure lookup — `provider-brands.ts` heuristics deleted). Platform detail = plan cards; each plan lists its credentials + "add key" (jump via `plan.apiKeyUrl`).
- **Binding selectors**: "use for Claude / Codex / Image generation" pickers replace the per-row active toggles. One selector per consumer, listing credentials whose plan has a matching endpoint.
- **Custom platform form**: one dialog collects name / baseUrl / protocol / capability checkboxes / key; submit synthesizes `custom_platforms` row (single plan) + first credential. "Add another key" later only creates a credential. Deleting the last credential of a custom platform prompts to also delete the platform (cascade with confirmation).
- **ProviderSlashPopup**: lists credentials valid for the current chat consumer; writes session-level override.
- **ModelCatalogPicker / PlatformModelsPanel**: models resolved from registry (endpoint models ∪ catalog via `catalogProviderId`); user-added models go through `credential.overrides[endpointId].models`.
- **ProviderLabel**: brand from `ResolvedService.brand` / credential's platform — no URL sniffing.

IPC surface (replaces `providers:*` channels):

```
platforms:list            → registry snapshot (builtin + custom + catalog-derived), models included
platforms:create-custom / update-custom / delete-custom
credentials:list / create / update / delete   (secrets masked)
bindings:get / set                            (validated against PROTOCOL_TASKS)
providers:test-connection (credentialId, endpointId)
```

## 6. Deleted code

- `resolveProviderKey` URL/name heuristics, `PRESET_PROVIDER_KEY`
- `agent_configs` column + `agentConfigsToCapabilities` + `effectiveCapabilities` dual-track
- `provider-brands.ts` `regionOf` / `platformName` regex extraction
- `is_active_claude` / `is_active_codex` / `supported_agents` / `capabilities` columns; `api_providers` table
- `provider-presets.ts` / `preset-match.ts` (→ registry `builtin.ts`)
- `media-gen/{keys,custom-providers,presets,migration}.ts` JSON stores
- `CapabilityProtocol` mashup values (`openai-image`, `openai-compatible-image`, `google-image`) and `MEDIA_KIND_TO_CAPABILITY_PROTOCOL` / `IMAGE_PROTOCOL_TO_MEDIA_KIND` maps

## 7. Implementation phases

Each phase leaves the build green (`bun run typecheck` + `bun run test`).

### Phase 1 — Shared foundation (`packages/shared`)
- `platform-registry/` types, `PROTOCOL_TASKS`, merge rules, builtin platform definitions (port all current presets: zhipu-cn/global, kimi, minimax, volcengine, bailian, deepseek, doubao, xiaomi, longcat, kwai-kat, modelscope, siliconflow, nvidia, openrouter, anthropic, openai, bedrock, vertex, official oauth platforms)
- Registry validation tests + merge-rule unit tests
- Catalog-derived platform synthesis (pure function over `ModelCatalog`)

### Phase 2 — Main process core
- DB: create `credentials` / `custom_platforms` / `consumer_bindings`; drop `api_providers` writes; credential CRUD with secret-store encryption + masking
- `main/providers/resolver.ts`: `resolveService()` + adapter matrix scaffolding
- Rewire chat consumers: `provider-env.ts`, codex `app-server-connection.ts`, `session.ts` / `session-manager.ts` (session dynamic-follow), `provider-usage-service.ts`, `buildRemoteActiveProvider`
- New IPC handlers + preload surface
- Integration tests: claude env build from credential+overrides; codex config build; binding switch; session override fallback

### Phase 3 — media-gen absorption
- `resolveMediaProvider` / `resolveDefaultModel` / `resolveDefaultProviderId` → resolver-backed
- Delete media-gen JSON stores; `settings-service.ts` reads bindings
- Image adapter matrix entries (`openai-images`, `openai-responses`, `google-generative`)

### Phase 4 — Renderer
- Stores (`app.ts` / `settings.ts`): platforms/credentials/bindings state
- ProvidersPage restructure (brand-grouped platforms → plan cards → keys), binding selectors, custom platform dialog, cascade-delete confirm
- ProviderSlashPopup, ProviderLabel, ModelCatalogPicker/PlatformModelsPanel on registry data
- i18n (en/zh) for new strings

### Phase 5 — Cleanup & polish
- Delete all §6 legacy code, prune `agent-types.ts` provider section, remove dead i18n keys
- Full `bun run typecheck` + `bun run test`; manual pass over chat (both harnesses), image gen, mobile remote provider display

## 8. Decided semantics (defaults baked into this plan)

| Question | Decision |
|---|---|
| Session vs global binding | Dynamic follow: session stores credentialId only on explicit switch; null follows global |
| CN/Global | Separate platforms sharing `brand` |
| `apiKeyUrl` placement | Plan (keys are issued per plan) |
| Custom platform deletion | Cascade prompt when deleting its last credential |
| User-added models on builtin platforms | Via `credential.overrides[endpointId].models` (replace list) |
| openai vs openai-compatible ai-sdk client | Adapter decides by platform id, not protocol |
| Plan template updates | Flow through automatically (reference + delta, no snapshots) |
