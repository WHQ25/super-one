import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppSettings, AppSettingsPatch } from '@superone/shared/agent-types'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import log from '../logger'
import { createMiniApp, cacheAppEntry, registerDevMiniApp, installDevPointer } from '../miniapp/miniapp-service'
import { packApp } from '../miniapp/miniapp-packager'
import { generateSuperoneDts } from '../miniapp/miniapp-templates'
import { renameSession as dbRenameSession, isSessionUserRenamed } from '../db-sessions'
import {
  registerMediaTools,
  generateImageToolHandler,
  generateVideoToolHandler,
  listMediaProvidersHandler,
  videoStatusToolHandler,
  type GenerateImageArgs,
  type GenerateVideoArgs,
  type ListMediaProvidersArgs,
  type VideoStatusArgs,
} from './media-tools'
import { manualReadHandler, registerManualTools } from './manual-tools'
import {
  BUILT_IN_SUPERONE_TOOL_DEFS,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  CONFIG_SETTINGS_DOMAINS,
  CONFIG_READ_DESCRIPTION,
  CONFIG_APPLY_DESCRIPTION,
  SETUP_MINI_APP_DEV_DESCRIPTION,
  REGISTER_DEV_MINIAPP_DESCRIPTION,
  PACK_MINI_APP_DESCRIPTION,
  UPDATE_SUPERONE_TYPES_DESCRIPTION,
  RENAME_SESSION_DESCRIPTION,
  LAUNCH_BRANCH_NAME_DESCRIPTION,
  LAUNCH_PERMISSION_MODE_DESCRIPTION,
  SESSION_LIST_AGENTS_DESCRIPTION,
  SESSION_REQUEST_AGENTS_DESCRIPTION,
  SESSION_SEND_DESCRIPTION,
  SESSION_START_DESCRIPTION,
  SESSION_RETRIEVE_DESCRIPTION,
  type BuiltInSuperoneToolName,
} from './superone-mcp-builtin-defs'
import { configApplyHandler, configReadHandler, type ConfigApplyArgs } from './config-tools'
import { readAppSettings } from '../app-settings-service'
import type { SessionManager } from '../session/types'
import type {
  RequestSessionAgentsArgs,
  SessionSendArgs,
  SessionRetrieveArgs,
} from '../session/session-collaboration'

export {
  BUILT_IN_SUPERONE_TOOL_DEFS,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  type BuiltInSuperoneToolName,
}

export interface SessionTitleSetter {
  setTitle(title: string, source: 'user' | 'agent'): void
  /** Project directory this session is scoped to (present on the real Session object). */
  readonly projectPath?: string
  /** Host-emitted AgentEvents (e.g. browser download task lifecycle). */
  emitHostEvent?(event: import('@superone/shared/agent-types').AgentEvent): void
  /**
   * Wake the agent with a non-human task notification. Claude uses SDK
   * origin `{ kind: 'task-notification' }`; other harnesses fall back to a
   * synthetic send.
   */
  injectTaskNotification?(content: string): Promise<void>
}

export interface SessionTitleHost {
  getSession(sessionId: string): SessionTitleSetter | null
}

function collaborationHost(deps: BuiltInSuperoneToolDeps): SessionManager {
  const host = deps.sessionHost as SessionManager | null
  if (!host?.createSession || !host?.disposeSession) throw new Error('Session collaboration host is unavailable')
  return host
}

export interface BuiltInSuperoneToolDeps {
  notifyDevAppReady: (projectDir: string, appId: string) => void
  sessionId: string
  sessionHost: SessionTitleHost | null
  /** Persist an app-settings patch through the shared side-effect + broadcast path. */
  applyAppSettings: (patch: AppSettingsPatch) => Promise<AppSettings> | AppSettings
}

interface SetupMiniAppDevArgs {
  name: string
  slug: string
  directory: string
  scope?: 'project' | 'user'
  projectDir?: string
  template?: 'vanilla' | 'react'
  description?: string
}

interface RegisterDevMiniAppArgs {
  directory: string
  installScope?: 'user' | 'project' | 'none'
  projectDir?: string
  force?: boolean
  name?: string
}

async function setupMiniAppDev(args: SetupMiniAppDevArgs, deps: BuiltInSuperoneToolDeps) {
  try {
    const result = await createMiniApp({
      name: args.name,
      slug: args.slug,
      directory: args.directory,
      scope: args.scope,
      projectDir: args.projectDir,
      template: args.template,
      description: args.description,
    })
    cacheAppEntry(result.entry)
    if (args.projectDir) deps.notifyDevAppReady(args.projectDir, result.entry.id)
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'created',
          appId: result.entry.id,
          name: args.name,
          appPath: result.appPath,
          installDir: result.entry.installDir,
          template: args.template ?? 'vanilla',
          scope: args.scope ?? 'project',
          buildRequired: result.buildRequired,
        }),
      }],
    }
  } catch (err) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ status: 'error', message: err instanceof Error ? err.message : String(err) }) }],
    }
  }
}

async function registerDevMiniAppImpl(args: RegisterDevMiniAppArgs, deps: BuiltInSuperoneToolDeps) {
  try {
    const entry = await registerDevMiniApp({ directory: args.directory, name: args.name })
    let installation: { scope: 'user' | 'project'; installDir: string } | undefined
    if (args.installScope && args.installScope !== 'none') {
      const scope = args.installScope
      if (scope === 'project' && !args.projectDir) {
        throw new Error('installScope="project" requires projectDir')
      }
      const installDir = await installDevPointer({
        appId: entry.appId,
        scope,
        projectDir: args.projectDir,
        force: args.force,
      })
      installation = { scope, installDir }
      if (scope === 'project' && args.projectDir) {
        deps.notifyDevAppReady(args.projectDir, entry.appId)
      }
    }
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'registered',
          appId: entry.appId,
          name: entry.name,
          sourceDir: entry.sourceDir,
          distDir: entry.distDir,
          installation,
        }),
      }],
    }
  } catch (err) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ status: 'error', message: err instanceof Error ? err.message : String(err) }) }],
    }
  }
}

async function packMiniApp(args: { appDir: string; outputDir: string }) {
  const result = await packApp(args.appDir, args.outputDir)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ status: 'packed', outputPath: result.outputPath, appId: result.manifest.appId, version: result.manifest.version, fileCount: result.fileCount }) }],
  }
}

function renameSessionTool(args: { title: string }, deps: BuiltInSuperoneToolDeps) {
  const sessionId = deps.sessionId
  if (isSessionUserRenamed(sessionId)) {
    return {
      content: [{ type: 'text' as const, text: 'Error: user_locked. The user has manually set this session title. Do not call session_rename again for this session.' }],
      isError: true,
    }
  }
  const trimmed = args.title.trim().replace(/^["']+|["']+$/g, '').trim()
  if (!trimmed) {
    return {
      content: [{ type: 'text' as const, text: 'Error: empty title.' }],
      isError: true,
    }
  }
  const session = deps.sessionHost?.getSession(sessionId) ?? null
  if (session) {
    session.setTitle(trimmed, 'agent')
  } else {
    try {
      dbRenameSession(sessionId, trimmed, 'agent')
    } catch (err) {
      log.warn('[session_rename] dbRenameSession error: %s', err instanceof Error ? err.message : String(err))
    }
  }
  return {
    content: [{ type: 'text' as const, text: `Session renamed to "${trimmed}".` }],
  }
}

async function updateSuperoneTypes(args: { appDir: string }) {
  const srcPath = join(args.appDir, 'src', 'superone.d.ts')
  const rootPath = join(args.appDir, 'superone.d.ts')
  const targetPath = existsSync(srcPath) ? srcPath : existsSync(rootPath) ? rootPath : null

  if (!targetPath) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ status: 'error', message: 'No existing superone.d.ts found. This tool is for updating existing type definitions. For new mini-apps, use miniapp_dev_setup with template "react".' }) }],
    }
  }

  await writeFile(targetPath, generateSuperoneDts(), 'utf-8')
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ status: 'updated', path: targetPath }) }],
  }
}

export async function executeBuiltInSuperoneTool(
  toolName: BuiltInSuperoneToolName,
  args: Record<string, unknown>,
  deps: BuiltInSuperoneToolDeps,
) {
  switch (toolName) {
    case 'read_manual':
      return manualReadHandler(args as { domain?: string; topic?: string; modules?: string[] })
    case 'miniapp_dev_setup':
      return setupMiniAppDev(args as unknown as SetupMiniAppDevArgs, deps)
    case 'miniapp_dev_register':
      return registerDevMiniAppImpl(args as unknown as RegisterDevMiniAppArgs, deps)
    case 'miniapp_dev_pack':
      return packMiniApp(args as { appDir: string; outputDir: string })
    case 'miniapp_dev_update_types':
      return updateSuperoneTypes(args as { appDir: string })
    case 'session_rename':
      return renameSessionTool(args as { title: string }, deps)
    case 'session_collab_list_agents':
      return import('../session/session-collaboration').then(({ listSessionAgentProfiles }) => ({
        content: [{ type: 'text' as const, text: JSON.stringify({ agents: listSessionAgentProfiles() }) }],
      }))
    case 'session_collab_request':
      return import('../session/session-collaboration').then(({ requestSessionAgents }) =>
        requestSessionAgents(deps.sessionId, args as unknown as RequestSessionAgentsArgs, collaborationHost(deps)))
    case 'session_collab_start':
      return import('../session/session-collaboration').then(({ startSessionAgent }) =>
        startSessionAgent(deps.sessionId, String(args.credential ?? ''), collaborationHost(deps)))
    case 'session_collab_send':
      return import('../session/session-collaboration').then(({ sendSessionMessage }) =>
        sendSessionMessage(deps.sessionId, args as unknown as SessionSendArgs, collaborationHost(deps)))
    case 'session_collab_retrieve':
      return import('../session/session-collaboration').then(({ retrieveSessionMessages }) =>
        retrieveSessionMessages(deps.sessionId, args as unknown as SessionRetrieveArgs))
    case 'config_read':
      return configReadHandler(args as { domain?: string; recordId?: string }, deps)
    case 'config_apply':
      return configApplyHandler(args as ConfigApplyArgs, deps)
    case 'media_list_providers':
      return listMediaProvidersHandler(args as ListMediaProvidersArgs)
    case 'media_generate_image':
      return generateImageToolHandler(args as unknown as GenerateImageArgs, deps)
    case 'media_generate_video':
      return generateVideoToolHandler(args as unknown as GenerateVideoArgs, deps)
    case 'media_video_status':
      return videoStatusToolHandler(args as unknown as VideoStatusArgs)
  }
}

export function registerSuperoneTools(server: McpServer, deps: BuiltInSuperoneToolDeps): void {
  if (readAppSettings().experimentalAgentCollaborationEnabled) {
    server.registerTool(
      'session_collab_list_agents',
      { description: SESSION_LIST_AGENTS_DESCRIPTION, inputSchema: {} },
      async () => {
        const { listSessionAgentProfiles } = await import('../session/session-collaboration')
        return { content: [{ type: 'text' as const, text: JSON.stringify({ agents: listSessionAgentProfiles() }) }] }
      },
    )
    server.registerTool(
      'session_collab_request',
      {
        description: SESSION_REQUEST_AGENTS_DESCRIPTION,
        inputSchema: {
          launches: z.array(z.object({
            launchId: z.string().optional(),
            agentId: z.string(),
            task: z.string().min(1).max(100_000),
            name: z.string().trim().min(1).max(64),
            role: z.string().trim().min(1).max(64),
            config: z.object({
              model: z.string().optional(),
              effort: z.string().optional(),
              apiProviderId: z.string().nullable().optional(),
              permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'])
                .optional()
                .describe(LAUNCH_PERMISSION_MODE_DESCRIPTION),
              sandboxMode: z.enum(['off', 'on', 'auto']).optional(),
              cwd: z.string().optional(),
              worktree: z.object({
                enabled: z.boolean(),
                baseBranch: z.string(),
                mode: z.enum(['branch', 'attach', 'detach']),
                branchName: z.string().optional().describe(LAUNCH_BRANCH_NAME_DESCRIPTION),
                carryLocalChanges: z.boolean().optional(),
              }).optional(),
              harnessConfig: z.record(z.string(), z.unknown()).optional(),
            }).optional(),
          })).min(1).max(16),
        },
      },
      async (args) => {
        const { requestSessionAgents } = await import('../session/session-collaboration')
        return requestSessionAgents(deps.sessionId, args, collaborationHost(deps))
      },
    )
    server.registerTool(
      'session_collab_start',
      { description: SESSION_START_DESCRIPTION, inputSchema: { credential: z.string().min(1) } },
      async ({ credential }) => {
        const { startSessionAgent } = await import('../session/session-collaboration')
        return startSessionAgent(deps.sessionId, credential, collaborationHost(deps))
      },
    )
    server.registerTool(
      'session_collab_send',
      {
        description: SESSION_SEND_DESCRIPTION,
        inputSchema: {
          credential: z.string().min(1),
          content: z.string().min(1).max(100_000).describe(
            'Mailbox message body in Markdown. Prefer structured Markdown (headings, lists, code fences) for agent-to-agent handoffs; the SuperOne UI renders it as a Markdown preview.',
          ),
          clientMessageId: z.string().optional(),
        },
      },
      async (args) => {
        const { sendSessionMessage } = await import('../session/session-collaboration')
        return sendSessionMessage(deps.sessionId, args, collaborationHost(deps))
      },
    )
    server.registerTool(
      'session_collab_retrieve',
      {
        description: SESSION_RETRIEVE_DESCRIPTION,
        inputSchema: { credentials: z.array(z.string().min(1)).min(1).max(32) },
      },
      async (args) => {
        const { retrieveSessionMessages } = await import('../session/session-collaboration')
        return retrieveSessionMessages(deps.sessionId, args)
      },
    )
  }

  registerManualTools(server)

  server.tool(
    'miniapp_dev_setup',
    SETUP_MINI_APP_DEV_DESCRIPTION,
    {
      name: z.string().describe('Display name for the mini-app'),
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).describe('URL-safe lowercase identifier (e.g. "weather-app"). Used to build the appId. Must be lowercase alphanumeric with hyphens.'),
      directory: z.string().describe('Absolute path to the directory where the mini-app source will be scaffolded. For scope="project", this MUST be inside projectDir (e.g. <projectDir>/packages/my-app or <projectDir>/tools/dashboard). For scope="user", anywhere on disk (e.g. ~/code/my-tool).'),
      scope: z.enum(['project', 'user']).optional().describe('project (default): app visible only in the given project; .s1-dev.json is committable. user: app visible across every project on this machine.'),
      projectDir: z.string().optional().describe('Absolute path to the project directory. Required when scope="project".'),
      template: z.enum(['vanilla', 'react']).optional().describe('vanilla (default): single index.html, no build needed. react: React + TypeScript + Tailwind, requires `bun run build` after scaffold.'),
      description: z.string().optional().describe('Short description of what the app does'),
    },
    ({ name, slug, directory, scope, projectDir, template, description }) =>
      setupMiniAppDev({ name, slug, directory, scope, projectDir, template, description }, deps),
  )

  server.tool(
    'miniapp_dev_register',
    REGISTER_DEV_MINIAPP_DESCRIPTION,
    {
      directory: z.string().describe('Absolute path to the existing mini-app source directory. Must contain manifest.json at the root or under dist/.'),
      installScope: z.enum(['user', 'project', 'none']).optional().describe('Where to immediately install a dev pointer after registering. "none" (default) only registers.'),
      projectDir: z.string().optional().describe('Required when installScope="project".'),
      force: z.boolean().optional().describe('Overwrite an existing prod install at the chosen scope. Default false.'),
      name: z.string().optional().describe('Override the display name. Defaults to manifest.name.'),
    },
    (args) => registerDevMiniAppImpl(args as RegisterDevMiniAppArgs, deps),
  )

  server.tool(
    'miniapp_dev_pack',
    PACK_MINI_APP_DESCRIPTION,
    {
      appDir: z.string().describe('Absolute path to the mini-app directory containing manifest.json'),
      outputDir: z.string().describe('Absolute path to the directory where the .s1app file will be written'),
    },
    packMiniApp,
  )

  server.tool(
    'miniapp_dev_update_types',
    UPDATE_SUPERONE_TYPES_DESCRIPTION,
    {
      appDir: z.string().describe('Absolute path to the mini-app directory'),
    },
    updateSuperoneTypes,
  )

  server.registerTool(
    'config_read',
    {
      description: CONFIG_READ_DESCRIPTION,
      inputSchema: {
        domain: z.enum(CONFIG_SETTINGS_DOMAINS).optional().describe('Which settings domain to read. Omit to list all domains.'),
        recordId: z.string().optional().describe('Resource domains only: read one record\'s full current values instead of the record list.'),
      },
    },
    (args) => configReadHandler(args, deps),
  )

  server.registerTool(
    'config_apply',
    {
      description: CONFIG_APPLY_DESCRIPTION,
      inputSchema: {
        changes: z.array(z.object({
          key: z.string().describe('The settings field key, exactly as returned by config_read.'),
          value: z.union([z.string(), z.number(), z.boolean(), z.null()]).describe('The new value. Use null or "" to reset a clearable field to its default.'),
        })).optional().describe('Scalar settings changes to propose. Mutually exclusive with `resource`.'),
        resource: z.object({
          resource: z.string().describe('The resource domain, e.g. "credential" — as returned by config_read.'),
          operation: z.enum(['create', 'update', 'delete']).describe('Which operation to perform.'),
          recordId: z.string().optional().describe('The record\'s `id` (from config_read). Required for update/delete.'),
          values: z.record(z.string(), z.unknown()).optional().describe('Field values keyed by field key. Required for create (all required fields) and update (only the fields being changed).'),
        }).optional().describe('A resource create/update/delete to propose. Mutually exclusive with `changes`.'),
      },
    },
    (args) => configApplyHandler(args, deps),
  )

  server.registerTool(
    'session_rename',
    {
      description: RENAME_SESSION_DESCRIPTION,
      inputSchema: {
        title: z.string().min(1).max(80).describe('A concise 4-8 word title describing the current conversation topic.'),
      },
      _meta: { 'anthropic/alwaysLoad': true },
    },
    (args) => renameSessionTool(args, deps),
  )

  registerMediaTools(server, deps)
}
