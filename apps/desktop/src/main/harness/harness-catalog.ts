import { app } from 'electron'
import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { CLAUDE_CLI_DEFAULT_MODEL_ID, CLAUDE_METADATA_PROBE_PROMPT, mapClaudeModelCatalog, providerSettingsEnv } from '@superone/claude'
import { readTerminalSlashCommandsFromInitMessage, sdkSlashCommands } from '@superone/shared/slash-commands'
import type { ClaudeResources, CodexResources, HarnessId, ModelOption } from '@superone/shared/agent-types'
import log from '../logger'
import { discoverUserSkills, discoverUserCommands, discoverUserAgents, discoverCodexUserPrompts } from '../agent/discover-resources'
import { claudeAccountStore } from '../agent/claude-account-store'
import { claudeAccountConfig } from '../agent/claude-account-service'
import { resolveProbeCwd } from '../agent/probe-cwd'
import { getCodexProviderOverrideFor } from '../codex/app-server-connection'
import type { CodexExperimentService } from '../codex/codex-experiment-service'
import { getCachedHarnessResources, setCachedHarnessResources, updateCachedHarnessResources } from '../database'
import { getBinding } from '../providers/credential-store'
import { resolveChatService } from '../providers/resolver'
import { cachedHarnessModels } from '../session/agent-profiles'
import { ensureShellPath } from '../shell-path'
import { buildSafeEnv } from '../spawn-env'
import { connectWithHarnessResourceCache, getFreshHarnessResources, harnessRuntimeCacheKey } from './resource-cache'
import { tryResolveHarnessRuntime } from './resolve-runtime'

/**
 * This desktop's Claude and Codex catalogs, as its window loads them and as
 * every remote client (phone or controller desktop) reads them from here.
 */
export interface HarnessCatalog {
  /** Claude models, account, slash commands and user resources; `apiProviderId` picks the account. */
  connectClaude(force?: boolean, apiProviderId?: string | null): Promise<ClaudeResources>
  /** Codex models and user prompts for the default provider. */
  connectCodex(): Promise<CodexResources>
  /** Codex models for one project and API provider, with mapped OpenAI-chat models. */
  listCodexModels(projectPath: string, apiProviderId?: string | null, force?: boolean): Promise<ModelOption[]>
  /** One harness's models for an API provider, as the window's composer offers them. */
  listModels(harnessId: string, apiProviderId: string | null): Promise<ModelOption[]>
}

/** Harnesses whose models come from their cache row; ACP lists agents, not models. */
const CACHED_MODEL_HARNESSES = new Set<string>(['opencode', 'cursor', 'dsh'] satisfies Exclude<HarnessId, 'acp'>[])

export function createHarnessCatalog(codex: CodexExperimentService): HarnessCatalog {
  /** Codex catalog cache key: the runtime binary plus the provider/auth it serves. */
  const codexCacheKey = (projectPath: string): string | undefined => {
    const binary = tryResolveHarnessRuntime('codex')
    const runtime = binary && harnessRuntimeCacheKey(binary)
    return runtime ? `${runtime}::${codex.modelCatalogSignature(projectPath)}` : undefined
  }

  const catalog: HarnessCatalog = {
    async connectClaude(force, apiProviderId) {
      const skills = discoverUserSkills()
      const userCommands = discoverUserCommands()
      const agents = discoverUserAgents()
      const claudeBinary = tryResolveHarnessRuntime('claude')
      const providerId = apiProviderId ?? (getBinding('chat:claude')?.credentialId ? null : claudeAccountStore().defaultProviderId())
      const accountEnv = claudeAccountConfig(providerId)?.extraEnv
      const cacheKey = claudeBinary ? `${harnessRuntimeCacheKey(claudeBinary)}:${providerId ?? 'default'}` : undefined
      // A row probed before the CLI `default` model was dropped from the catalog is re-probed.
      const cacheHit = getFreshHarnessResources('claude', {
        force,
        cacheKey,
        isUsable: (cached) => !cached.models.some((m) => m.id === CLAUDE_CLI_DEFAULT_MODEL_ID),
      })
      if (cacheHit) {
        log.info('[CONNECT_CLAUDE] cache fresh (ageMs=%d), skipping CLI query', cacheHit.ageMs)
        const resources: ClaudeResources = { ...cacheHit.resources, skills, commands: userCommands, agents }
        // Payload-only: rewriting the whole row here would restart the TTL on every hit.
        updateCachedHarnessResources('claude', resources)
        return resources
      }

      // Harness gate — same resolver the spawn path uses, so "no runtime" means the
      // same thing everywhere: never enabled, still installing after an upgrade, or
      // explicitly disabled. Probing without a binary makes the SDK throw
      // *synchronously* out of query() — which is constructed outside the try
      // below, so it escapes as a raw IPC rejection. The renderer used to answer
      // that by retrying forever. An empty catalog is the honest answer:
      // disk-discovered skills / commands / agents are still valid, there is just
      // no model list without a runtime.
      if (!claudeBinary) {
        log.info('[CONNECT_CLAUDE] no runtime available — skipping CLI probe (harness not installed or disabled)')
        // Deliberately not cached: the harness may be installed or re-enabled at any moment.
        return { models: [], account: {}, slashCommands: [], skills, commands: userCommands, agents, outputStyles: [] }
      }

      await ensureShellPath()
      const probeCwd = resolveProbeCwd()
      log.info('[CONNECT_CLAUDE] cwd:', probeCwd)
      log.info('[CONNECT_CLAUDE] platform=%s arch=%s', process.platform, process.arch)
      const q = query({
        prompt: CLAUDE_METADATA_PROBE_PROMPT,
        options: { cwd: probeCwd, pathToClaudeCodeExecutable: claudeBinary, maxTurns: 0, permissionMode: 'default', persistSession: false,
          ...(accountEnv ? { env: buildSafeEnv(accountEnv), settings: { env: providerSettingsEnv(accountEnv) } } : {}),
        },
      })
      try {
        log.info('[CONNECT_CLAUDE] Fetching models, account, commands...')
        let terminalSlashCommands: string[] | undefined
        const drainResult = (async (): Promise<SDKResultMessage | null> => {
          for await (const msg of q) {
            const tagged = readTerminalSlashCommandsFromInitMessage(msg)
            if (tagged) terminalSlashCommands = tagged
            if (msg.type === 'result') return msg
          }
          return null
        })()
        const [modelInfos, accountInfo, commands, initResult, resultMessage] = await Promise.all([
          q.supportedModels(),
          q.accountInfo(),
          q.supportedCommands(),
          q.initializationResult(),
          drainResult,
        ])
        log.info('[CONNECT_CLAUDE] Fetch complete, closing query...')
        q.close()

        if (resultMessage) {
          log.info(
            '[CONNECT_CLAUDE] handshake result subtype=%s costUSD=%d usage=%s modelUsage=%s',
            resultMessage.subtype,
            resultMessage.total_cost_usd,
            JSON.stringify(resultMessage.usage),
            JSON.stringify(resultMessage.modelUsage),
          )
        } else {
          log.warn('[CONNECT_CLAUDE] handshake result message never arrived')
        }
        log.info('[CONNECT_CLAUDE] Models:', JSON.stringify(modelInfos, null, 2))
        log.info('[CONNECT_CLAUDE] Account:', JSON.stringify(accountInfo, null, 2))
        log.info('[CONNECT_CLAUDE] Commands:', JSON.stringify(commands, null, 2))
        log.info('[CONNECT_CLAUDE] OutputStyle=%s AvailableStyles=%j', initResult.output_style, initResult.available_output_styles)
        log.info('[CONNECT_CLAUDE] User Skills:', JSON.stringify(skills, null, 2))
        log.info('[CONNECT_CLAUDE] User Commands:', JSON.stringify(userCommands, null, 2))

        const models = mapClaudeModelCatalog(modelInfos)
        const account = {
          email: accountInfo.email,
          organization: accountInfo.organization,
          subscriptionType: accountInfo.subscriptionType,
          apiKeySource: accountInfo.apiKeySource,
          apiProvider: accountInfo.apiProvider,
        }
        const slashCommands = sdkSlashCommands(commands, terminalSlashCommands)

        const outputStyles = initResult.available_output_styles ?? []

        const resources: ClaudeResources = {
          models,
          account,
          slashCommands,
          skills,
          commands: userCommands,
          agents,
          outputStyles,
        }
        setCachedHarnessResources('claude', resources, cacheKey ?? null)

        return resources
      } catch (error) {
        log.error('[CONNECT_CLAUDE] failed: %s', error instanceof Error ? error.message : String(error))
        const debugLogPath = String(log.transports.file.getFile().path)
        throw new Error(`CONNECT_CLAUDE failed. Debug log: ${debugLogPath}`)
      } finally {
        try {
          q.close()
        } catch {}
      }
    },

    async connectCodex() {
      const projectPath = app.getPath('userData')
      // Prompts are user files: always rescanned, never served from the cache.
      const prompts = discoverCodexUserPrompts()
      const resources = await connectWithHarnessResourceCache('codex', {
        cacheKey: codexCacheKey(projectPath),
        isUsable: (r) => (r.models?.length ?? 0) > 0,
        probe: async () => {
          log.info('[CONNECT_CODEX] Fetching codex resources...')
          const models = await codex.listModels(projectPath)
          log.info('[CONNECT_CODEX] Fetch complete: %d models, %d prompts', models.length, prompts.length)
          return { models, prompts }
        },
        onCacheHit: (hit) => {
          log.info('[CONNECT_CODEX] cache fresh (ageMs=%d), skipping model probe', hit.ageMs)
          updateCachedHarnessResources('codex', { ...hit.resources, prompts })
        },
        onProbeError: (error) => {
          log.error('[CONNECT_CODEX] failed: %s', error instanceof Error ? error.message : String(error))
        },
      })
      return { ...resources, prompts }
    },

    async listCodexModels(projectPath, apiProviderId, force) {
      let models = await codex.listModels(projectPath, apiProviderId ?? null, force ?? false)
      const resolved = resolveChatService('codex', apiProviderId ?? null)
      log.debug('[CODEX_LIST_MODELS] raw=%d protocol=%s models=%d hasMapping=%s apiProvider=%s',
        models.length, resolved?.protocol ?? 'null', resolved?.models?.length ?? 0, String(Boolean(resolved?.modelMapping)), apiProviderId ?? 'null')
      if (resolved && resolved.protocol === 'openai-chat' && !getCodexProviderOverrideFor(apiProviderId ?? null)) {
        const catalogById = new Map<string, string>()
        for (const m of (resolved.models ?? [])) if (m.name) catalogById.set(m.id, m.name)
        const mapped = new Map<string, ModelOption>()
        for (const m of (resolved.models ?? [])) mapped.set(m.id, { id: m.id, name: m.name ?? m.id, description: '', isDefault: false })
        for (const slot of Object.values(resolved.modelMapping ?? {})) {
          if (!slot.id) continue
          const strippedId = slot.id.replace(/\[1m\]/i, '')
          if (!mapped.has(strippedId)) {
            const name = slot.name?.replace(/\[1m\]/i, '').trim() || catalogById.get(strippedId) || strippedId
            mapped.set(strippedId, { id: strippedId, name, description: '', isDefault: true })
          }
        }
        models = [...mapped.values()]
        log.debug('[CODEX_LIST_MODELS] overrode with %d models (enabled=%d mapped=%d)',
          models.length, resolved.models?.length ?? 0, Object.keys(resolved.modelMapping ?? {}).length)
      }
      if (apiProviderId == null) {
        const current = getCachedHarnessResources('codex')
        setCachedHarnessResources('codex', { models, prompts: current?.prompts ?? [] }, codexCacheKey(projectPath) ?? null)
      }
      log.info('[CODEX_LIST_MODELS] response project=%s apiProvider=%s models=%s', projectPath, apiProviderId ?? 'default', JSON.stringify(models))
      return models
    },

    async listModels(harnessId, apiProviderId) {
      if (harnessId === 'claude') return (await catalog.connectClaude(false, apiProviderId)).models
      if (harnessId === 'codex') return catalog.listCodexModels(app.getPath('userData'), apiProviderId)
      return CACHED_MODEL_HARNESSES.has(harnessId) ? cachedHarnessModels(harnessId as Exclude<HarnessId, 'acp'>) : []
    },
  }
  return catalog
}
