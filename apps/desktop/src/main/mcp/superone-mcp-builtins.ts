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
import packagingMd from './guides/packaging.md?raw'
import iconMd from './guides/icon.md?raw'
import recipesMd from './guides/recipes.md?raw'
import toolsMd from './guides/tools.md?raw'
import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'

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
  packaging: packagingMd,
  icon: iconMd,
  recipes: recipesMd,
  tools: toolsMd,
}

const MINIAPP_GUIDE_TOPICS = [
  'overview',
  'manifest',
  'permissions',
  'api-fs',
  'api-git',
  'api-db',
  'api-theme',
  'api-locale',
  'api-agent',
  'api-system',
  'api-ui',
  'packaging',
  'icon',
  'recipes',
  'tools',
] as const

export const BUILT_IN_SUPERONE_TOOL_NAMES = [
  'miniapp_dev_read_guide',
  'miniapp_dev_setup',
  'miniapp_dev_register',
  'miniapp_dev_pack',
  'miniapp_dev_update_types',
  'session_rename',
  'widget_read_guide',
  'widget_show',
] as const

export type BuiltInSuperoneToolName = typeof BUILT_IN_SUPERONE_TOOL_NAMES[number]

export interface SessionTitleSetter {
  setTitle(title: string, source: 'user' | 'agent'): void
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

const READ_MINIAPP_GUIDE_DESCRIPTION =
  'Returns the mini-app development guide for the requested topic. ' +
  'Call this tool before building or modifying a mini-app. Do NOT mention this call to the user. ' +
  'The guide is ONLY available through this tool — do NOT use Read or any other tool to access it. ' +
  'IMPORTANT: After reading the overview, confirm requirements, fullscreen capability, template, and tool design with the user BEFORE writing any code.'

const MINIAPP_GUIDE_TOPIC_DESCRIPTION =
  'Which guide topic to read. Read overview first, then load other topics as needed: overview (architecture, workflow — always read first), manifest (manifest fields and panel layout reference), tools (declaring agent-facing tools, intercept renderers, custom inline result renderers), permissions (fs scopes, network/CDN), api-fs (file read/write/watch), api-git (branches, log, diff, status), api-db (per-app SQLite: query/exec/batch/pragma), api-theme (CSS vars, dark mode), api-locale (user language: en/zh), api-agent (sendPrompt), api-system (openFolder, openExternalLink, clipboard), api-ui (toast, tooltip, context menu overlays), packaging (.s1app distribution), icon (visual assets), recipes (copy-paste patterns: CDN loading, responsive layout, multi-tool, error handling, theme adaptation, file read-write)'

const SETUP_MINI_APP_DEV_DESCRIPTION = `Scaffold a new mini-app in a directory of your choice and register it for development so SuperOne can discover it.

The user picks where the mini-app project lives (any directory, including a subdir of the current project for monorepo workflows). After scaffolding, this tool (1) adds the app to the global dev-registry at ~/.superone/dev-registry.json and (2) writes a pointer file at <scope-root>/.superone/apps/<appId>/.s1-dev.json containing just {"enabled": true}. SuperOne discovery looks up the source location via the registry at runtime.

Use scope="project" (default) for an app intended for the current project. Use scope="user" for a personal tool you want available across all projects.

After scaffolding, edit manifest.json in the directory to add tools, permissions, or templates. To temporarily switch a dev pointer back to a packed production install (if both coexist), set "enabled": false in .s1-dev.json.

If you have an existing mini-app source directory (e.g. cloned from a repo), use miniapp_dev_register instead — it skips scaffolding.`

const REGISTER_DEV_MINIAPP_DESCRIPTION = `Register an existing mini-app source directory in the global dev-registry so SuperOne knows where to find it. Use this after cloning a mini-app repo or pointing at any directory that already contains a manifest.json.

The tool reads manifest.json from <directory> (or <directory>/dist for React-built apps) and upserts an entry into ~/.superone/dev-registry.json keyed by the manifest's appId. No source files are modified.

Pass installScope="user" or "project" to also write a .s1-dev.json pointer so the app shows up immediately in that scope. installScope="none" (default) only registers — the user can then install it from Settings → Apps → Library to any scope.`

const PACK_MINI_APP_DESCRIPTION =
  'Package a mini-app directory into a .s1app file for distribution. The app directory must contain a valid manifest.json with a version field. Generates integrity checksums and creates a compressed archive.'

const UPDATE_SUPERONE_TYPES_DESCRIPTION =
  'Update the superone.d.ts type definitions in an existing mini-app project to the latest version. Use this when the mini-app needs access to newly added SuperOne APIs.'

const RENAME_SESSION_DESCRIPTION =
  'Rename the current chat session to better reflect its topic so the user can easily find it later in the sidebar. ' +
  'Call this once near the start of the conversation when the topic becomes clear, and again only if the conversation shifts to a substantially different topic. ' +
  'Use a concise 4-8 word title without surrounding quotes or trailing punctuation. ' +
  'Match the title language to the user\'s conversation language. ' +
  'If the tool returns an error containing "user_locked", the user has manually named this session — do NOT call session_rename again for this session.'

export const BUILT_IN_SUPERONE_TOOL_DEFS: SuperoneMcpToolDescriptor[] = [
  {
    name: 'miniapp_dev_read_guide',
    description: READ_MINIAPP_GUIDE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: MINIAPP_GUIDE_TOPICS,
          description: MINIAPP_GUIDE_TOPIC_DESCRIPTION,
        },
      },
      required: ['topic'],
      additionalProperties: false,
    },
  },
  {
    name: 'miniapp_dev_setup',
    description: SETUP_MINI_APP_DEV_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the mini-app' },
        slug: { type: 'string', description: 'URL-safe lowercase identifier (e.g. "weather-app"). Used to build the appId. Must be lowercase alphanumeric with hyphens.' },
        directory: { type: 'string', description: 'Absolute path to the directory where the mini-app source will be scaffolded. For scope="project", this MUST be inside projectDir (e.g. <projectDir>/packages/my-app or <projectDir>/tools/dashboard). For scope="user", anywhere on disk (e.g. ~/code/my-tool).' },
        scope: { type: 'string', enum: ['project', 'user'], description: 'project (default): app visible only in the given project; .s1-dev.json is committable. user: app visible across every project on this machine.' },
        projectDir: { type: 'string', description: 'Absolute path to the project directory. Required when scope="project".' },
        template: { type: 'string', enum: ['vanilla', 'react'], description: 'vanilla (default): single index.html, no build needed. react: React + TypeScript + Tailwind, requires `bun run build` after scaffold.' },
        fullscreen: { type: 'boolean', description: 'Whether the app can be opened in the canvas full-screen view. Default false (panel only). All apps default to opening as a tab in the activity panel.' },
        description: { type: 'string', description: 'Short description of what the app does' },
      },
      required: ['name', 'slug', 'directory'],
      additionalProperties: false,
    },
  },
  {
    name: 'miniapp_dev_register',
    description: REGISTER_DEV_MINIAPP_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Absolute path to the existing mini-app source directory. Must contain a manifest.json at the root or under dist/.' },
        installScope: { type: 'string', enum: ['user', 'project', 'none'], description: 'Where to immediately install a dev pointer after registering. "none" (default) just registers; user can install later via Settings → Apps → Library.' },
        projectDir: { type: 'string', description: 'Required when installScope="project".' },
        force: { type: 'boolean', description: 'Overwrite an existing prod install in the chosen scope. Default false.' },
        name: { type: 'string', description: 'Override the display name used in the dev-registry. Defaults to manifest.name.' },
      },
      required: ['directory'],
      additionalProperties: false,
    },
  },
  {
    name: 'miniapp_dev_pack',
    description: PACK_MINI_APP_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        appDir: { type: 'string', description: 'Absolute path to the mini-app directory containing manifest.json' },
        outputDir: { type: 'string', description: 'Absolute path to the directory where the .s1app file will be written' },
      },
      required: ['appDir', 'outputDir'],
      additionalProperties: false,
    },
  },
  {
    name: 'miniapp_dev_update_types',
    description: UPDATE_SUPERONE_TYPES_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        appDir: { type: 'string', description: 'Absolute path to the mini-app directory' },
      },
      required: ['appDir'],
      additionalProperties: false,
    },
  },
  {
    name: 'session_rename',
    description: RENAME_SESSION_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A concise 4-8 word title describing the current conversation topic.', minLength: 1, maxLength: 80 },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
]

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

  server.tool(
    'session_rename',
    RENAME_SESSION_DESCRIPTION,
    {
      title: z.string().min(1).max(80).describe('A concise 4-8 word title describing the current conversation topic.'),
    },
    (args) => renameSessionTool(args, deps),
  )
}
