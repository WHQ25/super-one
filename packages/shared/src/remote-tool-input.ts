const REMOTE_TOOL_INPUT_SUFFIXES = ['__widget_show', '__mobile_share_file'] as const

/** Tool inputs required by the mobile host after privacy-oriented remote stripping. */
export function shouldKeepRemoteToolInput(toolName: string): boolean {
  return REMOTE_TOOL_INPUT_SUFFIXES.some((suffix) => toolName.endsWith(suffix))
}
