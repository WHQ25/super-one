import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'

export const MEDIA_GUIDE_TOPICS = [
  'overview',
  'ark-image',
  'ark-video',
  'openai-image',
  'openai-video',
  'google-image',
  'google-video',
  'newapi-video',
] as const

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

// Single source of truth for the browser tool surface: registerBrowserTools()
// registers exactly these, and they are spread into the permission-bypass list
// below. Keeping one list means a new tool cannot silently miss the bypass.
export const BROWSER_TOOL_NAMES = [
  'browser_snapshot',
  'browser_query',
  'browser_inspect',
  'browser_screenshot',
  'browser_click',
  'browser_hover',
  'browser_type',
  'browser_navigate',
  'browser_wait_for',
  'browser_press',
  'browser_scroll',
  'browser_drag',
  'browser_select',
  'browser_open',
  'browser_evaluate',
  'browser_tabs',
  'browser_resize',
  'browser_network_start',
  'browser_network_stop',
  'browser_network_wait',
  'browser_network_body',
  'browser_cookies',
  'browser_upload_file',
  'browser_download',
  'browser_list_downloads',
  'browser_emulate',
  'browser_mock',
] as const

export const BUILT_IN_SUPERONE_TOOL_NAMES = [
  'miniapp_dev_read_guide',
  'miniapp_dev_setup',
  'miniapp_dev_register',
  'miniapp_dev_pack',
  'miniapp_dev_update_types',
  'session_rename',
  'media_read_guide',
  'media_list_providers',
  'media_generate_image',
  'media_generate_video',
  'media_video_status',
  'widget_read_guide',
  'widget_show',
  ...BROWSER_TOOL_NAMES,
] as const

export type BuiltInSuperoneToolName = typeof BUILT_IN_SUPERONE_TOOL_NAMES[number]

export const MOBILE_SHARE_FILE_TOOL_NAME = 'mobile_share_file' as const

export const MOBILE_SHARE_FILE_DESCRIPTION =
  'Share a file from the desktop to the mobile device that is currently viewing this session, so the user can open or save it on their phone. ' +
  'This tool is ONLY available while a mobile device is subscribed to the session — if it is not in your tool list, no phone is connected. ' +
  'The file is delivered end-to-end encrypted and appears as a file card in the mobile chat. ' +
  'The path MUST point to a file inside the current project directory. Use it when the user asks to send, share, or get a file onto their phone.'

export const MOBILE_SHARE_FILE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to the file to send. Absolute, or relative to the project directory. Must resolve inside the project.' },
    caption: { type: 'string', description: 'Optional short note shown next to the file on the phone.' },
  },
  required: ['path'],
  additionalProperties: false,
} as const

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
  'Rename the current chat session to a concise topic label shown in the sidebar.\n\n' +
  'Only the top-level agent talking directly to the user may call this. If you were launched as a Task/subagent worker, do NOT call it — you do not own the user-facing session title.\n\n' +
  'If the tool returns an error containing "user_locked", the user has manually named this session — do not call session_rename again for this session.'

export const READ_MEDIA_GUIDE_DESCRIPTION =
  'Returns reference documentation for media_generate_image / media_generate_video: which settings actually work for which provider, exact parameter mappings, and known silent-failure modes (a setting being ignored instead of erroring). ' +
  'Call `overview` before your first media_generate_image/media_generate_video call in a session, then call the topic for the specific provider you are about to use (check the provider `kind` via media_list_providers) before setting anything beyond `prompt`. ' +
  'Do NOT mention this call to the user. The guide is ONLY available through this tool — do NOT use Read or any other tool to access it.'

export const MEDIA_GUIDE_TOPIC_DESCRIPTION =
  'Which guide topic to read. overview (shared vocabulary, which topic to pick for a given provider+task, always read first), then one <provider>-<task> topic matching the provider `kind` from media_list_providers and whether you are calling media_generate_image or media_generate_video: ark-image, ark-video (Volcengine/BytePlus ModelArk — Seedream / Seedance), openai-image, openai-video (Dall-E/gpt-image / Sora), google-image, google-video (Imagen / Veo), newapi-video (Doubao/Kling via a NewAPI-style relay — a different wire from openai-video even though both serve video).'

export const LIST_MEDIA_PROVIDERS_DESCRIPTION =
  'List the configured and usable media generation providers and their capabilities. Only providers that have an API key configured are returned. ' +
  'Call this before media_generate_image when you are unsure which providers/models are available or which one to use. ' +
  'Pass `category` ("image" or "video") to filter to providers that support that media type. ' +
  'Returns for each provider: `id` (pass to media_generate_image), `provider` (platform name) and `label` (key name) for display, `kind`, `categories`, `sizing` ("size" or "aspectRatio"), an optional `sizeNote` spelling out that provider\'s size constraints (honor it over the generic guidance in media_generate_image), `supportsMask`, `defaultModel`, and available `models` (each with `id` to pass as the model override and a human-readable `label`).'

export const GENERATE_IMAGE_DESCRIPTION =
  'Generate or edit an image from a text prompt using an AI image model. ' +
  'Use this when the user asks to create, draw, render, design, or edit an image / picture / illustration / logo / photo. ' +
  'The generated image is shown to the user automatically. After it returns, do NOT display it again with a Markdown image or link — just briefly describe the result in words. ' +
  'For text-to-image, pass only `prompt`. For image editing / image-to-image (e.g. "change X", "add Y", or iterating on a previous result), also pass the source image file path(s) in `reference_image_paths`. ' +
  'The result JSON returns the saved file path(s) in `savedPaths` for your own reference only. If you need to visually inspect the output to verify or iterate on it, use the Read tool on a saved path. ' +
  '`provider` selects the backend by id (default: the first usable provider). Which settings beyond `prompt` actually work varies by provider — call media_list_providers first to see `sizing`/`sizeNote`, and call media_read_guide for the specifics before setting `aspect_ratio` or `size`. ' +
  'Settings a model does not support are reported in the result `warnings` rather than failing the call.'

export const GENERATE_VIDEO_DESCRIPTION =
  'Start generating a video from a text prompt (and optionally images, video or audio) using an AI video model. ' +
  'Use this when the user asks to create, generate, animate, or render a video / clip / animation. ' +
  'Video generation is ASYNCHRONOUS: this tool returns immediately with a `generationId` while the video renders in the background, which typically takes 1-5 minutes. ' +
  'You MUST then poll `media_video_status` with that id roughly every 30 seconds until it returns `generated` or `error` — the job is not finished until it does. ' +
  'The finished video is shown to the user automatically. After it completes, do NOT embed it again with Markdown — just briefly describe the result in words. ' +
  'For text-to-video pass only `prompt`. For image-to-video pass `first_frame_path` (and optionally `last_frame_path` to control the ending) — but check media_read_guide first, since not every provider actually uses these. ' +
  '`provider` selects the backend by id (default: the first usable provider). Call media_list_providers with category "video" if unsure which providers/models exist, and call media_read_guide before setting anything beyond `prompt`/`first_frame_path` — most of the remaining fields only apply to specific providers and are silently ignored elsewhere. ' +
  'Settings a model does not support are reported as `warnings` rather than failing the call.'

export const VIDEO_STATUS_DESCRIPTION =
  'Check on a video generation started by media_generate_video. ' +
  'Returns `{status:"running"}` while it renders, `{status:"generated", savedPaths:[...]}` when finished, or `{status:"error", message}` if it failed. ' +
  'Poll roughly every 30 seconds while it is running. Do not tell the user the video is ready until this returns `generated`.'

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
  {
    name: 'media_read_guide',
    description: READ_MEDIA_GUIDE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: MEDIA_GUIDE_TOPICS,
          description: MEDIA_GUIDE_TOPIC_DESCRIPTION,
        },
      },
      required: ['topic'],
      additionalProperties: false,
    },
  },
  {
    name: 'media_list_providers',
    description: LIST_MEDIA_PROVIDERS_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by media category, e.g. "image". Omit to list all usable providers.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'media_generate_image',
    description: GENERATE_IMAGE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'A detailed description of the image to generate, or the edit to apply when reference images are provided.' },
        provider: { type: 'string', description: 'Which configured image provider id to use. Call media_list_providers to discover ids. Defaults to the first usable provider.' },
        model: { type: 'string', description: "Model id override. Defaults to the provider's default model." },
        aspect_ratio: { type: 'string', description: 'Aspect ratio like "16:9" or "1:1". Preferred for google models.' },
        size: { type: 'string', description: 'Pixel size like "1024x1024". Preferred for openai / openai-compatible models.' },
        reference_image_paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to input images for editing / image-to-image / iterating on a prior result. Omit for pure text-to-image.' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'media_generate_video',
    description: GENERATE_VIDEO_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'A detailed description of the video to generate, including motion and camera direction.' },
        provider: { type: 'string', description: 'Which configured video provider id to use. Call media_list_providers with category "video" to discover ids. Defaults to the first usable provider.' },
        model: { type: 'string', description: "Model id override. Defaults to the provider's default video model." },
        first_frame_path: { type: 'string', description: 'Absolute path to an image to animate from (image-to-video). This is the starting frame.' },
        last_frame_path: { type: 'string', description: 'Absolute path to an image the video should end on. Requires first_frame_path.' },
        reference_image_paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to reference images for character or scene consistency. Up to 9 images total across all roles on Ark.' },
        reference_video_paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to reference video clips. Volcengine Ark (Seedance) only; ignored by other providers.' },
        reference_audio_paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to reference audio tracks. Volcengine Ark (Seedance) only; ignored by other providers.' },
        aspect_ratio: { type: 'string', description: 'Aspect ratio like "16:9", "9:16" or "1:1".' },
        resolution: { type: 'string', description: 'Pixel resolution like "1920x1080" or "1280x720". Ark maps this onto its 480p/720p/1080p tiers; Sora accepts only 720x1280, 1280x720, 1024x1792, 1792x1024.' },
        duration: { type: 'number', description: 'Clip length in seconds. Ark accepts 2-15; Sora accepts only 4, 8 or 12.' },
        fps: { type: 'number', description: 'Frames per second, e.g. 24. Ignored by providers that derive it from the model.' },
        seed: { type: 'number', description: 'Seed for reproducible generation.' },
        generate_audio: { type: 'boolean', description: 'Whether the model should generate a soundtrack alongside the video, where supported.' },
        watermark: { type: 'boolean', description: 'Whether to stamp the provider watermark. Volcengine Ark only.' },
        camera_fixed: { type: 'boolean', description: 'Lock the camera in place instead of letting the model move it. Volcengine Ark only.' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'media_video_status',
    description: VIDEO_STATUS_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        generation_id: { type: 'string', description: 'The generationId returned by media_generate_video.' },
      },
      required: ['generation_id'],
      additionalProperties: false,
    },
  },
]
