/**
 * A remote Bash shell can have `{}` input while its header survives in
 * `toolSummary`. Both hosts must resolve that shell the same way until opening
 * the row supplies the full command and description.
 */
export function bashToolDisplay(params: Record<string, unknown>, toolSummary?: string) {
  const command = typeof params.command === 'string' ? params.command : ''
  const description = typeof params.description === 'string' && params.description.trim()
    ? params.description
    : (toolSummary && toolSummary !== command ? toolSummary : undefined)
  return {
    command,
    description,
    timeoutMs: typeof params.timeout === 'number' ? params.timeout : undefined,
    runInBackground: params.run_in_background === true || params.background === true,
  }
}
