import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import log from '../logger'
import { createMiniApp, cacheAppEntry, registerDevMiniApp, installDevPointer } from '../miniapp/miniapp-service'
import { packApp } from '../miniapp/miniapp-packager'
import { generateSuperoneDts } from '../miniapp/miniapp-templates'
import { renameSession as dbRenameSession, isSessionUserRenamed } from '../db-sessions'
import { registerMediaTools, generateImageToolHandler, listMediaProvidersHandler, type GenerateImageArgs, type ListMediaProvidersArgs } from './media-tools'
import overviewMd from './guides/overview.md?raw'
import manifestMd from './guides/manifest.md?raw'
import permissionsMd from './guides/permissions.md?raw'
import apiFsMd from './guides/api/fs.md?raw'
import apiGitMd from './guides/api/git.md?raw'
import apiDbMd from './guides/api/db.md?raw'
import apiThemeMd from './guides/api/theme.md?raw'
import apiLocaleMd from './guides/api/locale.md?raw'
import apiAgentMd from './guides/api/agent.md?raw'
import apiSystemMd from './guides/api/system.md?raw'
import apiUiMd from './guides/api/ui.md?raw'
import apiWorkerMd from './guides/api/worker.md?raw'
import packagingMd from './guides/packaging.md?raw'
import iconMd from './guides/icon.md?raw'
import recipesMd from './guides/recipes.md?raw'
import toolsMd from './guides/tools.md?raw'
import {
  BUILT_IN_SUPERONE_TOOL_DEFS,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  MINIAPP_GUIDE_TOPICS,
  READ_MINIAPP_GUIDE_DESCRIPTION,
  MINIAPP_GUIDE_TOPIC_DESCRIPTION,
  SETUP_MINI_APP_DEV_DESCRIPTION,
  REGISTER_DEV_MINIAPP_DESCRIPTION,
  PACK_MINI_APP_DESCRIPTION,
  UPDATE_SUPERONE_TYPES_DESCRIPTION,
  RENAME_SESSION_DESCRIPTION,
  type BuiltInSuperoneToolName,
} from './superone-mcp-builtin-defs'

export {
  BUILT_IN_SUPERONE_TOOL_DEFS,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  type BuiltInSuperoneToolName,
}

const MINIAPP_GUIDES: Record<string, string> = {
  overview: overviewMd,
  manifest: manifestMd,
  permissions: permissionsMd,
  'api-fs': apiFsMd,
  'api-git': apiGitMd,
  'api-db': apiDbMd,
  'api-theme': apiThemeMd,
  'api-locale': apiLocaleMd,
  'api-agent': apiAgentMd,
  'api-system': apiSystemMd,
  'api-ui': apiUiMd,
  'api-worker': apiWorkerMd,
  packaging: packagingMd,
  icon: iconMd,
  recipes: recipesMd,
  tools: toolsMd,
}

export interface SessionTitleSetter {
  setTitle(title: string, source: 'user' | 'agent'): void
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

export interface BuiltInSuperoneToolDeps {
  notifyDevAppReady: (projectDir: string, appId: string) => void
  sessionId: string
  sessionHost: SessionTitleHost | null
}

interface SetupMiniAppDevArgs {
  name: string
  slug: string
  directory: string
  scope?: 'project' | 'user'
  projectDir?: string
  template?: 'vanilla' | 'react'
  fullscreen?: boolean
  description?: string
}

interface RegisterDevMiniAppArgs {
  directory: string
  installScope?: 'user' | 'project' | 'none'
  projectDir?: string
  force?: boolean
  name?: string
}

function readMiniappGuide(args: { topic: string }) {
  const text = MINIAPP_GUIDES[args.topic]
  if (!text) {
    throw new Error(`Unknown mini-app guide topic: ${args.topic}`)
  }
  return {
    content: [{ type: 'text' as const, text }],
  }
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
      fullscreen: args.fullscreen,
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
    case 'miniapp_dev_read_guide':
      return readMiniappGuide(args as { topic: string })
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
    case 'media_list_providers':
      return listMediaProvidersHandler(args as ListMediaProvidersArgs)
    case 'media_generate_image':
      return generateImageToolHandler(args as unknown as GenerateImageArgs, deps)
  }
}

export function registerSuperoneTools(server: McpServer, deps: BuiltInSuperoneToolDeps): void {
  server.tool(
    'miniapp_dev_read_guide',
    READ_MINIAPP_GUIDE_DESCRIPTION,
    {
      topic: z.enum(MINIAPP_GUIDE_TOPICS).describe(MINIAPP_GUIDE_TOPIC_DESCRIPTION),
    },
    readMiniappGuide,
  )

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
      fullscreen: z.boolean().optional().describe('Whether the app can be opened in the canvas full-screen view. Default false (panel only). All apps default to opening as a tab in the activity panel.'),
      description: z.string().optional().describe('Short description of what the app does'),
    },
    ({ name, slug, directory, scope, projectDir, template, fullscreen, description }) =>
      setupMiniAppDev({ name, slug, directory, scope, projectDir, template, fullscreen, description }, deps),
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
