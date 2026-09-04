const REMOTE_TOOL_INPUT_SUFFIXES = [
  '__widget_show',
  '__mobile_share_file',
  '__media_generate_image',
  '__media_generate_video',
] as const

/** Full tool inputs required by a mobile presenter or native host action. */
export function shouldKeepRemoteToolInput(toolName: string): boolean {
  return REMOTE_TOOL_INPUT_SUFFIXES.some((suffix) => toolName.endsWith(suffix))
}

function superoneBareName(toolName: string): string | null {
  const match = toolName.match(/^mcp__superone(?:__|\.)([a-z_]+)$/)
  return match?.[1] ?? null
}

function copyDefined(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    if (source[key] !== undefined) target[key] = source[key]
  }
}

/**
 * Keep only the Browser fields needed to select the shared presenter and show the
 * agent-written description. Typed text, selectors, URLs, and page-tool arguments
 * remain stripped from the remote transcript.
 */
function sanitizeBrowserInput(toolName: string, input: string): string {
  const bare = superoneBareName(toolName)
  if (!bare?.startsWith('browser_')) return ''
  return sanitizePresenterInput(bare, input)
}

function actionTypes(value: unknown, keepKeyboardState = false): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.flatMap((action) => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) return []
    const source = action as Record<string, unknown>
    if (typeof source.type !== 'string') return []
    return [{
      type: source.type,
      ...(keepKeyboardState && source.type === 'keyboard' && typeof source.connected === 'boolean'
        ? { connected: source.connected }
        : {}),
    }]
  })
}

function sanitizePresenterInput(bare: string, input: string): string {
  if (!bare || !input) return ''
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { return '' }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
  const source = parsed as Record<string, unknown>
  const safe: Record<string, unknown> = {}
  copyDefined(source, safe, ['description'])
  switch (bare) {
    case 'browser_snapshot':
      copyDefined(source, safe, ['include'])
      break
    case 'browser_query':
      copyDefined(source, safe, ['op'])
      break
    case 'browser_act':
      if (Array.isArray(source.actions)) safe.actions = actionTypes(source.actions)
      break
    case 'browser_network': {
      copyDefined(source, safe, ['action', 'preset', 'reset', 'width', 'height'])
      const fullEmulationFields = [
        'deviceScaleFactor', 'mobile', 'userAgent', 'colorScheme', 'timezone',
        'locale', 'latitude', 'longitude',
      ]
      for (const key of fullEmulationFields) {
        if (source[key] !== undefined) safe[key] = true
      }
      break
    }
    case 'browser_action':
      copyDefined(source, safe, ['action', 'domain', 'name'])
      break
    case 'browser_tabs':
      copyDefined(source, safe, ['action'])
      break
    case 'browser_tools_call':
      copyDefined(source, safe, ['name'])
      break
  }
  return Object.keys(safe).length > 0 ? JSON.stringify(safe) : ''
}

/** Device/computer rows need only operation kinds; coordinates, text, refs, and app ids stay private. */
function sanitizeInteractiveInput(toolName: string, input: string): string {
  const bare = superoneBareName(toolName)
  if (!bare || (!bare.startsWith('device_') && !bare.startsWith('computer_'))) return ''
  if (!input) return ''
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { return '' }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
  const source = parsed as Record<string, unknown>
  const safe: Record<string, unknown> = {}
  copyDefined(source, safe, ['description'])

  if (bare === 'device_snapshot') copyDefined(source, safe, ['mode'])
  else if (bare === 'device_query') copyDefined(source, safe, ['op'])
  else if (bare === 'device_act' && Array.isArray(source.actions)) {
    safe.actions = actionTypes(source.actions, true)
  } else if (bare === 'computer_apps') copyDefined(source, safe, ['action'])
  else if (bare === 'computer_snapshot') copyDefined(source, safe, ['mode', 'capture'])
  else if (bare === 'computer_query') copyDefined(source, safe, ['op'])
  else if (bare === 'computer_act' && Array.isArray(source.actions)) {
    safe.actions = actionTypes(source.actions)
  }
  return Object.keys(safe).length > 0 ? JSON.stringify(safe) : ''
}

/** Privacy-preserving tool input projected into the remote transcript. */
export function sanitizeRemoteToolInput(toolName: string, input: string): string {
  if (shouldKeepRemoteToolInput(toolName)) return input
  return sanitizeBrowserInput(toolName, input) || sanitizeInteractiveInput(toolName, input)
}
