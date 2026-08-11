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
  PROJECT_LIST_DESCRIPTION,
  SESSION_LIST_DESCRIPTION,
  SESSION_SEARCH_DESCRIPTION,
  SESSION_READ_DESCRIPTION,
  SESSION_CLEANUP_DESCRIPTION,
  AUTOMATION_LIST_DESCRIPTION,
  AUTOMATION_APPLY_DESCRIPTION,
  AUTOMATION_DELETE_DESCRIPTION,
  AUTOMATION_SCHEDULE_INPUT_SCHEMA,
  AUTOMATION_AGENT_CONFIG_INPUT_SCHEMA,
  LAUNCH_BRANCH_NAME_DESCRIPTION,
  LAUNCH_PERMISSION_MODE_DESCRIPTION,
  LAUNCH_SUMMARY_DESCRIPTION,
  LAUNCH_TASK_DESCRIPTION,
  SESSION_LIST_AGENTS_DESCRIPTION,
  SESSION_REQUEST_AGENTS_DESCRIPTION,
  LAUNCH_CWD_DESCRIPTION,
  LAUNCH_WORKTREE_DESCRIPTION,
  SESSION_SEND_DESCRIPTION,
  SESSION_START_DESCRIPTION,
  SESSION_RETRIEVE_DESCRIPTION,
  type BuiltInSuperoneToolName,
} from './superone-mcp-builtin-defs'
import { configApplyHandler, configReadHandler, type ConfigApplyArgs } from './config-tools'
import {
  SESSION_LIST_ORDER_ENUM,
  projectListHandler,
  sessionCleanupHandler,
  sessionListHandler,
  sessionReadHandler,
  sessionSearchHandler,
  type ProjectListArgs,
  type SessionCleanupArgs,
  type SessionListArgs,
  type SessionReadArgs,
  type SessionSearchArgs,
} from './session-archive-tools'
import {
  automationApplyHandler,
  automationDeleteHandler,
  automationListHandler,
  type AutomationApplyArgs,
  type AutomationDeleteArgs,
  type AutomationListArgs,
} from './automation-tools'
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
  signal?: AbortSignal
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
    case 'project_list':
      return projectListHandler(args as unknown as ProjectListArgs, deps)
    case 'session_list':
      return sessionListHandler(args as unknown as SessionListArgs, deps)
    case 'session_search':
      return sessionSearchHandler(args as unknown as SessionSearchArgs, deps)
    case 'session_read':
      return sessionReadHandler(args as unknown as SessionReadArgs, deps)
    case 'session_cleanup':
      return sessionCleanupHandler(args as unknown as SessionCleanupArgs, deps)
    case 'automation_list':
      return automationListHandler(args as unknown as AutomationListArgs, deps)
    case 'automation_apply':
      return automationApplyHandler(args as unknown as AutomationApplyArgs, deps)
    case 'automation_delete':
      return automationDeleteHandler(args as unknown as AutomationDeleteArgs, deps)
    case 'session_collab_list_agents':
      return import('../session/session-collaboration').then(({ listSessionAgentProfiles }) => ({
        content: [{ type: 'text' as const, text: JSON.stringify({ agents: listSessionAgentProfiles() }) }],
      }))
    case 'session_collab_request':
      return import('../session/session-collaboration').then(({ requestSessionAgents }) =>
        requestSessionAgents(deps.sessionId, args as unknown as RequestSessionAgentsArgs, collaborationHost(deps), deps.signal))
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
          summary: z.string().trim().min(1).describe(LAUNCH_SUMMARY_DESCRIPTION),
          task: z.string().min(1).max(100_000).describe(LAUNCH_TASK_DESCRIPTION),
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
            cwd: z.string().optional().describe(LAUNCH_CWD_DESCRIPTION),
            worktree: z.object({
              enabled: z.boolean(),
              baseBranch: z.string(),
              mode: z.enum(['branch', 'attach', 'detach']),
              branchName: z.string().optional().describe(LAUNCH_BRANCH_NAME_DESCRIPTION),
              carryLocalChanges: z.boolean().optional(),
            }).optional().describe(LAUNCH_WORKTREE_DESCRIPTION),
            harnessConfig: z.record(z.string(), z.unknown()).optional(),
          }).optional(),
        })).min(1).max(16),
      },
    },
    async (args, extra) => {
      const { requestSessionAgents } = await import('../session/session-collaboration')
      return requestSessionAgents(deps.sessionId, args, collaborationHost(deps), extra.signal)
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
    // Claude in-process MCP cancels tool calls via extra.signal — forward so
    // HostConfirmRegistry dismisses the settings dialog (stdio bridge sets deps.signal).
    (args, extra) => configApplyHandler(args, {
      ...deps,
      signal: extra?.signal ?? deps.signal,
    }),
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

  server.registerTool(
    'project_list',
    {
      description: PROJECT_LIST_DESCRIPTION,
      inputSchema: {
        query: z.string().optional().describe('Case-insensitive substring filter on project name or path.'),
        limit: z.number().int().min(1).max(100).optional().describe('Max rows. Default 50, max 100.'),
        offset: z.number().int().min(0).optional().describe('Pagination offset. Default 0.'),
      },
    },
    (args) => projectListHandler(args, deps),
  )

  server.registerTool(
    'session_list',
    {
      description: SESSION_LIST_DESCRIPTION,
      inputSchema: {
        query: z.string().optional().describe('Case-insensitive title substring filter.'),
        harness: z.enum(['claude', 'codex', 'acp', 'opencode']).optional().describe('Filter by harness.'),
        includeHidden: z.boolean().optional().describe('Include hidden sessions. Default false.'),
        includePinnedOnly: z.boolean().optional().describe('Only pinned sessions. Default false.'),
        parentOnly: z.boolean().optional().describe('Exclude collab child sessions. Default false.'),
        olderThan: z.string().optional().describe('ISO timestamp — only sessions last active before this.'),
        newerThan: z.string().optional().describe('ISO timestamp — only sessions last active after this.'),
        projectId: z
          .string()
          .optional()
          .describe('List sessions in this SuperOne project id only (from project_list). Mutually exclusive with allProjects. Default: current project.'),
        allProjects: z
          .boolean()
          .optional()
          .describe('List sessions across every SuperOne project. Mutually exclusive with projectId. Default false.'),
        order: z
          .enum(SESSION_LIST_ORDER_ENUM)
          .optional()
          .describe(
            'Sort order. Default last_active_desc. last_active_asc = oldest first. created_* by createdAt; message_count_* by message count; size_* ranks by approx stored transcript size and includes sizeBytes (character length of message JSON, not disk page-file bytes).',
          ),
        limit: z.number().int().min(1).max(50).optional().describe('Max rows. Default 20, max 50.'),
        offset: z.number().int().min(0).optional().describe('Pagination offset. Default 0.'),
      },
    },
    (args) => sessionListHandler(args, deps),
  )

  server.registerTool(
    'session_search',
    {
      description: SESSION_SEARCH_DESCRIPTION,
      inputSchema: {
        query: z.string().min(1).describe('Search terms (AND). Matches title and message text.'),
        harness: z.enum(['claude', 'codex', 'acp', 'opencode']).optional(),
        sessionIds: z.array(z.string()).max(32).optional().describe('Optional: restrict search to these session ids.'),
        role: z.enum(['user', 'assistant', 'any']).optional().describe('Message role filter. Default any.'),
        projectId: z
          .string()
          .optional()
          .describe('Search this SuperOne project id only. Mutually exclusive with allProjects. Default: current project.'),
        allProjects: z
          .boolean()
          .optional()
          .describe('Search every SuperOne project. Mutually exclusive with projectId. Default false.'),
        limit: z.number().int().min(1).max(50).optional().describe('Max hits. Default 20, max 50.'),
      },
    },
    (args) => sessionSearchHandler(args, deps),
  )

  server.registerTool(
    'session_read',
    {
      description: SESSION_READ_DESCRIPTION,
      inputSchema: {
        sessionId: z
          .string()
          .min(1)
          .describe('Target SuperOne session id from session_list or session_search (any project).'),
        view: z.enum(['meta', 'user', 'assistant', 'text', 'tools', 'tool_detail']).optional()
          .describe('meta | user | assistant | text | tools | tool_detail. Default text.'),
        messageId: z.string().optional().describe('Anchor page at this message id.'),
        around: z.number().int().min(0).max(50).optional()
          .describe('With messageId: messages before/after on the global timeline.'),
        cursor: z.number().int().nullable().optional()
          .describe('Exclusive end index for the next older page. Omit for newest page.'),
        limit: z.number().int().min(1).max(50).optional().describe('Max messages this page. Default 20, max 50.'),
        includeThinking: z.boolean().optional().describe('Include thinking blocks. Default false.'),
        toolUseId: z.string().optional().describe('Required for view=tool_detail.'),
      },
    },
    (args) => sessionReadHandler(args, deps),
  )

  server.registerTool(
    'session_cleanup',
    {
      description: SESSION_CLEANUP_DESCRIPTION,
      inputSchema: {
        action: z.enum(['hide', 'unhide', 'delete'])
          .describe('hide/unhide soft-archive (no confirm). delete permanently removes after user approval dialog.'),
        sessionIds: z.array(z.string()).min(1).max(50).describe('Session ids from session_list to act on.'),
        includePinned: z.boolean().optional().describe('Allow pinned sessions. Default false.'),
        maxDelete: z.number().int().min(1).max(50).optional().describe('Hard cap. Default 50.'),
      },
    },
    // Claude in-process MCP cancels tool calls via extra.signal — forward it so
    // HostConfirmRegistry dismisses the delete prompt (stdio bridge already sets deps.signal).
    (args, extra) => sessionCleanupHandler(args, {
      ...deps,
      signal: extra?.signal ?? deps.signal,
    }),
  )

  const scheduleSchema = z.object({
    type: z.enum(['one-time', 'recurring']),
    cron: z.string().optional().describe('Cron expression for recurring (required when type=recurring).'),
    runAt: z.string().optional().describe('ISO timestamp for one-time (required when type=one-time).'),
    preset: z.enum(['hourly', 'daily', 'weekly', 'custom']).optional(),
    timeOfDay: z.string().optional().describe('HH:mm local time hint for daily/weekly presets.'),
    dayOfWeek: z.array(z.number().int().min(0).max(6)).optional().describe('0=Sun … 6=Sat for weekly preset.'),
    minuteOfHour: z.number().int().min(0).max(59).optional().describe('Minute for hourly preset.'),
    summary: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'Natural-language schedule for the UI in the user\'s language '
        + '(e.g. "Every weekday at 9:00 AM", "每天上午 9 点"). Required.',
      ),
  }).describe(AUTOMATION_SCHEDULE_INPUT_SCHEMA.description as string)

  const agentConfigSchema = z.object({
    type: z.enum(['claude', 'codex', 'acp', 'opencode']),
    agentName: z.string().optional().describe('Claude only: named agent profile.'),
    model: z.string().optional(),
    effort: z.string().optional().describe('Unified effort (Claude / Codex / ACP / OpenCode).'),
    permissionMode: z
      .enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'])
      .optional()
      .describe('Unified permission mode. Prefer bypassPermissions for unattended runs.'),
    sandboxMode: z.enum(['off', 'on', 'auto']).optional().describe('Claude sandbox (ignored by other harnesses).'),
    apiProviderId: z.string().nullable().optional().describe('Optional third-party AI provider credential id.'),
    acpAgentId: z.string().optional().describe('ACP only: agent id (e.g. grok-build).'),
    reasoningEffort: z
      .enum(['minimal', 'low', 'medium', 'high', 'xhigh'])
      .optional()
      .describe('Codex legacy alias for effort.'),
    permissionPreset: z
      .enum(['read-only', 'default', 'full-access'])
      .optional()
      .describe('Codex legacy alias for permissionMode (full-access ≈ bypassPermissions).'),
  }).describe(AUTOMATION_AGENT_CONFIG_INPUT_SCHEMA.description as string)

  server.registerTool(
    'automation_list',
    {
      description: AUTOMATION_LIST_DESCRIPTION,
      inputSchema: {
        id: z.string().optional().describe('When set, return full detail for this automation (must belong to the current project).'),
        enabled: z.boolean().optional().describe('Filter by enabled state. Omit for all.'),
        query: z.string().optional().describe('Case-insensitive name substring filter.'),
        limit: z.number().int().min(1).max(100).optional().describe('Max rows. Default 50, max 100.'),
        offset: z.number().int().min(0).optional().describe('Pagination offset. Default 0.'),
      },
    },
    (args) => automationListHandler(args, deps),
  )

  server.registerTool(
    'automation_apply',
    {
      description: AUTOMATION_APPLY_DESCRIPTION,
      inputSchema: {
        action: z.enum(['create', 'update']).describe('create a new automation, or update an existing one (including toggle enabled).'),
        id: z.string().optional().describe('Required for update. Automation id from automation_list.'),
        name: z.string().optional().describe('Display name. Required for create; optional for update.'),
        prompt: z.string().optional().describe('Prompt sent to the agent when the automation runs. Required for create; optional for update.'),
        enabled: z.boolean().optional().describe('Whether the scheduler will run this automation. Create defaults to true; use false to pause.'),
        schedule: scheduleSchema.optional(),
        agentConfig: agentConfigSchema.optional(),
      },
    },
    (args, extra) => automationApplyHandler(args as AutomationApplyArgs, {
      ...deps,
      signal: extra?.signal ?? deps.signal,
    }),
  )

  server.registerTool(
    'automation_delete',
    {
      description: AUTOMATION_DELETE_DESCRIPTION,
      inputSchema: {
        ids: z.array(z.string()).min(1).max(20).describe('Automation ids from automation_list to delete (current project only).'),
      },
    },
    (args, extra) => automationDeleteHandler(args, {
      ...deps,
      signal: extra?.signal ?? deps.signal,
    }),
  )

  registerMediaTools(server, deps)
}
