import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'

export const MINIAPP_GUIDE_TOPICS = [
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
  'api-worker',
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

export const READ_MINIAPP_GUIDE_DESCRIPTION =
  'Returns the mini-app development guide for the requested topic. ' +
  'Call this tool before building or modifying a mini-app. Do NOT mention this call to the user. ' +
  'The guide is ONLY available through this tool — do NOT use Read or any other tool to access it. ' +
  'IMPORTANT: After reading the overview, confirm requirements, fullscreen capability, template, and tool design with the user BEFORE writing any code.'

export const MINIAPP_GUIDE_TOPIC_DESCRIPTION =
  'Which guide topic to read. Read overview first, then load other topics as needed: overview (architecture, workflow — always read first), manifest (manifest fields and panel layout reference), tools (declaring agent-facing tools, intercept renderers, custom inline result renderers), permissions (fs scopes, network/CDN), api-fs (file read/write/watch), api-git (branches, log, diff, status), api-db (per-app SQLite: query/exec/batch/pragma), api-theme (CSS vars, dark mode), api-locale (user language: en/zh), api-agent (sendPrompt), api-system (openFolder, openExternalLink, clipboard), api-ui (toast, tooltip, context menu overlays), api-worker (background worker that outlives the panel: worker.start/stop/postMessage + self.keepAlive/setStatus), packaging (.s1app distribution), icon (visual assets), recipes (copy-paste patterns: CDN loading, responsive layout, multi-tool, error handling, theme adaptation, file read-write)'

export const SETUP_MINI_APP_DEV_DESCRIPTION = `Scaffold a new mini-app in a directory of your choice and register it for development so SuperOne can discover it.

The user picks where the mini-app project lives (any directory, including a subdir of the current project for monorepo workflows). After scaffolding, this tool (1) adds the app to the global dev-registry at ~/.superone/dev-registry.json and (2) writes a pointer file at <scope-root>/.superone/apps/<appId>/.s1-dev.json containing just {"enabled": true}. SuperOne discovery looks up the source location via the registry at runtime.

Use scope="project" (default) for an app intended for the current project. Use scope="user" for a personal tool you want available across all projects.

After scaffolding, edit manifest.json in the directory to add tools, permissions, or templates. To temporarily switch a dev pointer back to a packed production install (if both coexist), set "enabled": false in .s1-dev.json.

If you have an existing mini-app source directory (e.g. cloned from a repo), use miniapp_dev_register instead — it skips scaffolding.`

export const REGISTER_DEV_MINIAPP_DESCRIPTION = `Register an existing mini-app source directory in the global dev-registry so SuperOne knows where to find it. Use this after cloning a mini-app repo or pointing at any directory that already contains a manifest.json.

The tool reads manifest.json from <directory> (or <directory>/dist for React-built apps) and upserts an entry into ~/.superone/dev-registry.json keyed by the manifest's appId. No source files are modified.

Pass installScope="user" or "project" to also write a .s1-dev.json pointer so the app shows up immediately in that scope. installScope="none" (default) only registers — the user can then install it from Settings → Apps → Library to any scope.`

export const PACK_MINI_APP_DESCRIPTION =
  'Package a mini-app directory into a .s1app file for distribution. The app directory must contain a valid manifest.json with a version field. Generates integrity checksums and creates a compressed archive.'

export const UPDATE_SUPERONE_TYPES_DESCRIPTION =
  'Update the superone.d.ts type definitions in an existing mini-app project to the latest version. Use this when the mini-app needs access to newly added SuperOne APIs.'

export const RENAME_SESSION_DESCRIPTION =
  'Rename the current chat session to a concise topic label so the user can find it later in the sidebar.\n\n' +
  'Default title behavior: until you call this tool, the session title falls back to the first ~100 characters of the user\'s first message. ' +
  'That fallback is often noisy (greetings, pasted code, long requests) — your job is to replace it with a clean 4-8 word topic summary.\n\n' +
  'When to call:\n' +
  '- As soon as the conversation topic is clear (typically after the user\'s first substantive request).\n' +
  '- When the user approves a plan — that\'s a strong signal of the session\'s real direction; rename to reflect the approved scope.\n' +
  '- Every ~10 user turns in long conversations: re-check whether the current title still matches what the conversation is actually about, and rename if it has drifted.\n' +
  '- When the conversation shifts to a substantially different topic.\n\n' +
  'Title rules:\n' +
  '- 4-8 words, no surrounding quotes, no trailing punctuation.\n' +
  '- Match the user\'s conversation language.\n' +
  '- Prefer "verb + object" over abstract nouns (e.g. "Fix mobile session sync bug" beats "Mobile sync issue").\n\n' +
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
