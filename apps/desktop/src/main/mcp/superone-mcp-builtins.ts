import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import { createMiniApp, cacheAppEntry } from '../miniapp/miniapp-service'
import { packApp } from '../miniapp/miniapp-packager'
import { generateSuperoneDts } from '../miniapp/miniapp-templates'
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
  'read_miniapp_guide',
  'setup_mini_app_dev',
  'pack_mini_app',
  'update_superone_types',
] as const

export type BuiltInSuperoneToolName = typeof BUILT_IN_SUPERONE_TOOL_NAMES[number]

interface BuiltInSuperoneToolDeps {
  notifyDevAppReady: (projectDir: string, appId: string) => void
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

const READ_MINIAPP_GUIDE_DESCRIPTION =
  'Returns the mini-app development guide for the requested topic. ' +
  'Call this tool before building or modifying a mini-app. Do NOT mention this call to the user. ' +
  'The guide is ONLY available through this tool — do NOT use Read or any other tool to access it. ' +
  'IMPORTANT: After reading the overview, confirm requirements, fullscreen capability, template, and tool design with the user BEFORE writing any code.'

const MINIAPP_GUIDE_TOPIC_DESCRIPTION =
  'Which guide topic to read. Read overview first, then load other topics as needed: overview (architecture, workflow — always read first), manifest (manifest fields and panel layout reference), tools (declaring agent-facing tools, intercept renderers, custom inline result renderers), permissions (fs scopes, network/CDN), api-fs (file read/write/watch), api-git (branches, log, diff, status), api-db (per-app SQLite: query/exec/batch/pragma), api-theme (CSS vars, dark mode), api-locale (user language: en/zh), api-agent (sendPrompt), api-system (openFolder, openExternalLink, clipboard), api-ui (toast, tooltip, context menu overlays), packaging (.s1app distribution), icon (visual assets), recipes (copy-paste patterns: CDN loading, responsive layout, multi-tool, error handling, theme adaptation, file read-write)'

const SETUP_MINI_APP_DEV_DESCRIPTION = `Scaffold a new mini-app in a directory of your choice and register it as a development app so SuperOne can discover it.

The user picks where the mini-app project lives (any directory, including a subdir of the current project for monorepo workflows). After scaffolding, this tool writes a tiny pointer file at <scope-root>/.superone/apps/<appId>/.s1-dev.json that points back at the dist (or root for vanilla). SuperOne reads that pointer during discovery.

Use scope="project" (default) for an app intended for the current project. Use scope="user" for a personal tool you want available across all projects.

After scaffolding, edit manifest.json in the directory to add tools, permissions, or templates. To switch a registered dev app to its production version (after installing a packed .s1app), set "enabled": false in .s1-dev.json.`

const PACK_MINI_APP_DESCRIPTION =
  'Package a mini-app directory into a .s1app file for distribution. The app directory must contain a valid manifest.json with a version field. Generates integrity checksums and creates a compressed archive.'

const UPDATE_SUPERONE_TYPES_DESCRIPTION =
  'Update the superone.d.ts type definitions in an existing mini-app project to the latest version. Use this when the mini-app needs access to newly added SuperOne APIs.'

export const BUILT_IN_SUPERONE_TOOL_DEFS: SuperoneMcpToolDescriptor[] = [
  {
    name: 'read_miniapp_guide',
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
    name: 'setup_mini_app_dev',
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
    name: 'pack_mini_app',
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
    name: 'update_superone_types',
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

async function packMiniApp(args: { appDir: string; outputDir: string }) {
  const result = await packApp(args.appDir, args.outputDir)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ status: 'packed', outputPath: result.outputPath, appId: result.manifest.appId, version: result.manifest.version, fileCount: result.fileCount }) }],
  }
}

async function updateSuperoneTypes(args: { appDir: string }) {
  const srcPath = join(args.appDir, 'src', 'superone.d.ts')
  const rootPath = join(args.appDir, 'superone.d.ts')
  const targetPath = existsSync(srcPath) ? srcPath : existsSync(rootPath) ? rootPath : null

  if (!targetPath) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ status: 'error', message: 'No existing superone.d.ts found. This tool is for updating existing type definitions. For new mini-apps, use setup_mini_app_dev with template "react".' }) }],
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
    case 'read_miniapp_guide':
      return readMiniappGuide(args as { topic: string })
    case 'setup_mini_app_dev':
      return setupMiniAppDev(args as unknown as SetupMiniAppDevArgs, deps)
    case 'pack_mini_app':
      return packMiniApp(args as { appDir: string; outputDir: string })
    case 'update_superone_types':
      return updateSuperoneTypes(args as { appDir: string })
  }
}

export function registerSuperoneTools(server: McpServer, deps: BuiltInSuperoneToolDeps): void {
  server.tool(
    'read_miniapp_guide',
    READ_MINIAPP_GUIDE_DESCRIPTION,
    {
      topic: z.enum(MINIAPP_GUIDE_TOPICS).describe(MINIAPP_GUIDE_TOPIC_DESCRIPTION),
    },
    readMiniappGuide,
  )

  server.tool(
    'setup_mini_app_dev',
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
    'pack_mini_app',
    PACK_MINI_APP_DESCRIPTION,
    {
      appDir: z.string().describe('Absolute path to the mini-app directory containing manifest.json'),
      outputDir: z.string().describe('Absolute path to the directory where the .s1app file will be written'),
    },
    packMiniApp,
  )

  server.tool(
    'update_superone_types',
    UPDATE_SUPERONE_TYPES_DESCRIPTION,
    {
      appDir: z.string().describe('Absolute path to the mini-app directory'),
    },
    updateSuperoneTypes,
  )
}
