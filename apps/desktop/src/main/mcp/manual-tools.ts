import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { AVAILABLE_MODULES, getGuidelines } from '../generative-ui/guidelines'
import overviewMd from './guides/overview.md?raw'
import manifestMd from './guides/manifest.md?raw'
import permissionsMd from './guides/permissions.md?raw'
import apiFsMd from './guides/api/fs.md?raw'
import apiGitMd from './guides/api/git.md?raw'
import apiDbMd from './guides/api/db.md?raw'
import apiKvMd from './guides/api/kv.md?raw'
import apiPeerMd from './guides/api/peer.md?raw'
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
import mediaOverviewMd from './guides/media/overview.md?raw'
import mediaArkImageMd from './guides/media/ark-image.md?raw'
import mediaArkVideoMd from './guides/media/ark-video.md?raw'
import mediaOpenaiImageMd from './guides/media/openai-image.md?raw'
import mediaOpenaiVideoMd from './guides/media/openai-video.md?raw'
import mediaGoogleImageMd from './guides/media/google-image.md?raw'
import mediaGoogleVideoMd from './guides/media/google-video.md?raw'
import mediaNewapiVideoMd from './guides/media/newapi-video.md?raw'
import productOverviewMd from './guides/product/overview.md?raw'
import productContributeMd from './guides/product/contribute.md?raw'
import productDebugMd from './guides/product/debug.md?raw'
import productCollaborationMd from './guides/product/collaboration.md?raw'
import productSessionsMd from './guides/product/sessions.md?raw'
import {
  MANUAL_DOMAINS,
  MANUAL_READ_DESCRIPTION,
  MEDIA_GUIDE_TOPICS,
  MEDIA_GUIDE_TOPIC_DESCRIPTION,
  MINIAPP_GUIDE_TOPICS,
  MINIAPP_GUIDE_TOPIC_DESCRIPTION,
  PRODUCT_GUIDE_TOPICS,
  READ_MANUAL_INPUT_SCHEMA,
  type ManualDomain,
} from './superone-mcp-builtin-defs'
import { jsonSchemaToZodShape } from './json-schema-zod'

type MiniappGuideTopic = (typeof MINIAPP_GUIDE_TOPICS)[number]
type MediaGuideTopic = (typeof MEDIA_GUIDE_TOPICS)[number]
type ProductGuideTopic = (typeof PRODUCT_GUIDE_TOPICS)[number]

const MINIAPP_GUIDES = {
  overview: overviewMd,
  manifest: manifestMd,
  permissions: permissionsMd,
  'api-fs': apiFsMd,
  'api-git': apiGitMd,
  'api-db': apiDbMd,
  'api-kv': apiKvMd,
  'api-peer': apiPeerMd,
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
} satisfies Record<MiniappGuideTopic, string>

const MEDIA_GUIDES = {
  overview: mediaOverviewMd,
  'ark-image': mediaArkImageMd,
  'ark-video': mediaArkVideoMd,
  'openai-image': mediaOpenaiImageMd,
  'openai-video': mediaOpenaiVideoMd,
  'google-image': mediaGoogleImageMd,
  'google-video': mediaGoogleVideoMd,
  'newapi-video': mediaNewapiVideoMd,
} satisfies Record<MediaGuideTopic, string>

const PRODUCT_GUIDES = {
  overview: productOverviewMd,
  contribute: productContributeMd,
  debug: productDebugMd,
  collaboration: productCollaborationMd,
  sessions: productSessionsMd,
} satisfies Record<ProductGuideTopic, string>

const MINIAPP_TOPIC_SUMMARIES: Record<MiniappGuideTopic, string> = {
  overview: 'architecture, workflow, template and scope decisions',
  manifest: 'manifest fields, entries, and panel layout',
  permissions: 'filesystem, network, storage, media, and worker permissions',
  'api-fs': 'sandboxed file operations and watchers',
  'api-git': 'repository status, history, diffs, and read operations',
  'api-db': 'SQLite queries, migrations, batches, and performance',
  'api-kv': 'simple project- or user-scoped key-value storage',
  'api-peer': 'ephemeral events between live instances of one mini-app',
  'api-theme': 'theme tokens and dark-mode updates',
  'api-locale': 'current language and change events',
  'api-agent': 'sending prompts and contextual suggestions',
  'api-system': 'folders, external links, and clipboard access',
  'api-ui': 'toast, tooltip, context menu, popover, and drag APIs',
  'api-worker': 'background worker lifecycle, messaging, and keep-alive',
  packaging: '.s1app validation and distribution',
  icon: 'mini-app logo requirements',
  recipes: 'cross-API implementation patterns',
  tools: 'agent-facing tools, renderers, and standalone tools',
}

const MEDIA_TOPIC_SUMMARIES: Record<MediaGuideTopic, string> = {
  overview: 'provider routing, shared fields, and warning behavior',
  'ark-image': 'Seedream image options through the Ark adapter',
  'ark-video': 'Seedance video options through the Ark adapter',
  'openai-image': 'DALL-E and GPT Image options',
  'openai-video': 'Sora video options',
  'google-image': 'Imagen and Gemini image options',
  'google-video': 'Veo video options',
  'newapi-video': 'Doubao and Kling through a NewAPI-style relay',
}

const DOMAIN_SUMMARIES: Record<ManualDomain, string> = {
  product: 'Product support and contributing: overview, issues/PRs, logs, collaboration launch rules, and session archive tools.',
  miniapp: 'Mini-app development: scaffold, APIs, packaging, tools.',
  media: 'Image/video generation: provider-specific parameters and silent-failure modes.',
  widget: 'Inline chat widget design guidelines, plus the `native` module for handing generated media to SuperOne\'s own gallery instead of authoring one. Saved templates use widget_list_templates.',
}

export interface ManualReadArgs {
  domain?: string
  topic?: string
  modules?: string[]
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

function errorResult(text: string) {
  return { ...textResult(text), isError: true as const }
}

function formatCatalog(): string {
  const lines = [
    '# SuperOne manual',
    '',
    'Call `read_manual` again with a `domain` (and `topic` / `modules` as needed).',
    '',
  ]
  for (const domain of MANUAL_DOMAINS) {
    lines.push(`## ${domain}`)
    lines.push(DOMAIN_SUMMARIES[domain])
    if (domain === 'product') {
      lines.push(`Topics: ${PRODUCT_GUIDE_TOPICS.join(', ')}`)
      lines.push('Issues / PRs: `topic: "contribute"`. Logs: `topic: "debug"`. Collab/worktree: `topic: "collaboration"`.')
    } else if (domain === 'miniapp') {
      lines.push(`Topics: ${MINIAPP_GUIDE_TOPICS.join(', ')}`)
      lines.push('Start with `domain: "miniapp", topic: "overview"`.')
    } else if (domain === 'media') {
      lines.push(`Topics: ${MEDIA_GUIDE_TOPICS.join(', ')}`)
      lines.push('Start with `domain: "media", topic: "overview"`, then the provider topic matching media_list_providers `kind`.')
    } else {
      lines.push(`Modules (pass as topic or modules[]): ${AVAILABLE_MODULES.join(', ')}`)
      lines.push('Example: `domain: "widget", modules: ["diagram", "chart"]`.')
    }
    lines.push('')
  }
  lines.push('For live app settings (keys/current values), use `config_read` — not this tool.')
  return lines.join('\n')
}

function formatDomainIndex(domain: ManualDomain): string {
  if (domain === 'product') {
    return [
      '# Product manual topics',
      '- overview — product identity, links, when to use contribute vs debug vs collaboration',
      '- contribute — GitHub issues and PRs (bugs, features, improvements); issue first, optional red–green PR',
      '- debug — log paths, userData, monorepo map, this machine’s runtime paths',
      '- collaboration — session_collab_* launches: same-repo worktrees, cross-project cwd, implementers, and reviewers',
      '- sessions — session_list / session_search / session_read / session_cleanup: archive cite, handoff, cleanup',
      '',
      'Call `read_manual({ domain: "product", topic: "contribute" })` for issues / PRs.',
      'Call `read_manual({ domain: "product", topic: "debug" })` for logs and local diagnosis.',
      'Call `read_manual({ domain: "product", topic: "collaboration" })` before setting config.cwd or config.worktree in session_collab_request.',
      'Call `read_manual({ domain: "product", topic: "sessions" })` before browsing or cleaning other sessions.',
    ].join('\n')
  }
  if (domain === 'miniapp') {
    return [
      '# Mini-app manual topics',
      MINIAPP_GUIDE_TOPIC_DESCRIPTION,
      '',
      ...MINIAPP_GUIDE_TOPICS.map((topic) => `- ${topic} - ${MINIAPP_TOPIC_SUMMARIES[topic]}`),
      '',
      'Call `read_manual({ domain: "miniapp", topic: "<name>" })`.',
    ].join('\n')
  }
  if (domain === 'media') {
    return [
      '# Media manual topics',
      MEDIA_GUIDE_TOPIC_DESCRIPTION,
      '',
      ...MEDIA_GUIDE_TOPICS.map((topic) => `- ${topic} - ${MEDIA_TOPIC_SUMMARIES[topic]}`),
      '',
      'Call `read_manual({ domain: "media", topic: "<name>" })`.',
    ].join('\n')
  }
  return [
    '# Widget manual modules',
    'Pick modules that fit the visual you are about to build with widget_show:',
    ...AVAILABLE_MODULES.map((m) => `- ${m}`),
    '',
    'Call `read_manual({ domain: "widget", modules: ["diagram"] })` (or pass a single module as `topic`).',
  ].join('\n')
}

/** Append resolved paths for the running process (best-effort; tests may omit electron). */
function runtimePathsSection(): string {
  const lines = ['## Runtime paths (this machine)', '']
  try {
    // Lazy import so unit tests that never touch Electron still load this module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    if (app?.isReady?.() || app?.getPath) {
      try {
        lines.push(`- **userData**: \`${app.getPath('userData')}\``)
        lines.push(`- **logs (Electron app path)**: \`${app.getPath('logs')}\``)
      } catch {
        lines.push('- userData / logs: app path not available yet')
      }
    }
  } catch {
    lines.push('- Electron app paths unavailable in this context')
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const log = require('../logger').default as { transports?: { file?: { getFile?: () => { path: string } } } }
    const logPath = log?.transports?.file?.getFile?.()?.path
    if (logPath) lines.push(`- **main log file (resolved)**: \`${logPath}\``)
  } catch {
    /* ignore */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    const version = app?.getVersion?.()
    if (version) lines.push(`- **SuperOne version**: \`${version}\``)
  } catch {
    /* ignore */
  }
  lines.push(`- **platform**: \`${process.platform}\` / \`${process.arch}\``)
  lines.push('')
  lines.push('Prefer the resolved main log path above when reading logs on this device.')
  return lines.join('\n')
}

function readWidgetManual(modules: string[]): string {
  return getGuidelines(modules)
}

/** @deprecated Prefer manualReadHandler — kept for media-tools tests during migration. */
export function readMediaGuideHandler(args: { topic: string }) {
  if (!(MEDIA_GUIDE_TOPICS as readonly string[]).includes(args.topic)) {
    throw new Error(`Unknown media guide topic: ${args.topic}`)
  }
  return textResult(MEDIA_GUIDES[args.topic as MediaGuideTopic])
}

export async function manualReadHandler(args: ManualReadArgs) {
  const domain = args.domain as ManualDomain | undefined

  if (!domain) {
    if (args.topic !== undefined || args.modules !== undefined) {
      return errorResult('Pass `domain` before `topic` or `modules`. Omit every argument to list the catalog.')
    }
    return textResult(formatCatalog())
  }

  if (!(MANUAL_DOMAINS as readonly string[]).includes(domain)) {
    return errorResult(
      `Unknown domain "${args.domain}". Valid domains: ${MANUAL_DOMAINS.join(', ')}. `
      + 'Omit domain to list the full catalog.',
    )
  }

  if (domain === 'widget') {
    if (args.topic !== undefined && args.modules !== undefined) {
      return errorResult('For the widget domain, pass either `topic` or `modules`, not both.')
    }
    if (args.modules !== undefined && args.modules.length === 0) {
      return errorResult(`Widget modules cannot be empty. Valid modules: ${AVAILABLE_MODULES.join(', ')}.`)
    }
    const modules = args.modules?.length
      ? args.modules
      : args.topic
        ? [args.topic]
        : []
    if (modules.length === 0) {
      return textResult(formatDomainIndex('widget'))
    }
    const unknown = modules.filter((m) => !(AVAILABLE_MODULES as readonly string[]).includes(m))
    if (unknown.length > 0) {
      return errorResult(
        `Unknown widget module(s): ${unknown.join(', ')}. Valid modules: ${AVAILABLE_MODULES.join(', ')}.`,
      )
    }
    return textResult(readWidgetManual(modules))
  }

  if (args.modules !== undefined) {
    return errorResult('`modules` is only valid for the widget domain.')
  }

  if (!args.topic) {
    return textResult(formatDomainIndex(domain))
  }

  if (domain === 'product') {
    if (!(PRODUCT_GUIDE_TOPICS as readonly string[]).includes(args.topic)) {
      return errorResult(
        `Unknown product topic "${args.topic}". Valid topics: ${PRODUCT_GUIDE_TOPICS.join(', ')}.`,
      )
    }
    const text = PRODUCT_GUIDES[args.topic as ProductGuideTopic]
    if (args.topic === 'debug') {
      return textResult(`${text}\n\n${runtimePathsSection()}`)
    }
    return textResult(text)
  }

  if (domain === 'miniapp') {
    if (!(MINIAPP_GUIDE_TOPICS as readonly string[]).includes(args.topic)) {
      return errorResult(
        `Unknown miniapp topic "${args.topic}". Valid topics: ${MINIAPP_GUIDE_TOPICS.join(', ')}.`,
      )
    }
    return textResult(MINIAPP_GUIDES[args.topic as MiniappGuideTopic])
  }

  if (!(MEDIA_GUIDE_TOPICS as readonly string[]).includes(args.topic)) {
    return errorResult(
      `Unknown media topic "${args.topic}". Valid topics: ${MEDIA_GUIDE_TOPICS.join(', ')}.`,
    )
  }
  return textResult(MEDIA_GUIDES[args.topic as MediaGuideTopic])
}

export function registerManualTools(server: McpServer): void {
  server.registerTool(
    'read_manual',
    {
      description: MANUAL_READ_DESCRIPTION,
      inputSchema: jsonSchemaToZodShape(READ_MANUAL_INPUT_SCHEMA),
      // Always expose to Claude Tool Search — support docs must not require a search hop.
      _meta: { 'anthropic/alwaysLoad': true },
    },
    (args) => manualReadHandler(args),
  )
}
