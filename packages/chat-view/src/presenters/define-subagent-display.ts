export interface DefineSubagentInfo {
  name: string
  description: string
  descriptionPreview: string
  systemPrompt: string
  enableWriteTools: boolean
  enableMcpTools: boolean
  enableSubagentTools: boolean
  confirmedDefined: boolean
  errorMessage?: string
  extraText?: string
  hasPlaceholderResult: boolean
  raw: string
}

const STEP_TIMESTAMP_HEADER_RE = /^(?:Created At:\s*[^\r\n]+\r?\n(?:Completed At:\s*[^\r\n]+\r?\n)?|Completed At:\s*[^\r\n]+\r?\n)/
const STEP_ERROR_PREFIX_RE = /^Encountered error in step execution:\s*/i
const DEFINED_SUCCESS_RE = /^Subagent\s+"([^"]+)"\s+defined successfully\.?(?:\s+It can now be invoked via invoke_subagent\.?)?$/i

function unwrapStr(val: unknown): string {
  if (typeof val !== 'string') return ''
  const trimmed = val.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === 'string') return parsed.trim()
    } catch {
      void 0
    }
  }
  return trimmed
}

function readBool(val: unknown): boolean {
  if (typeof val === 'boolean') return val
  if (val === 'true') return true
  return false
}

export function parseDefineSubagent(
  params: Record<string, unknown>,
  result?: string | null,
  isError?: boolean,
): DefineSubagentInfo {
  const paramName = unwrapStr(params.name ?? params.Name)
  const description = unwrapStr(params.description ?? params.Description)
  const descriptionPreview = (description.split(/\r?\n/, 1)[0] ?? '').trim()
  const systemPrompt = unwrapStr(params.systemPrompt ?? params.SystemPrompt ?? params.system_prompt)
  const enableWriteTools = readBool(params.enableWriteTools ?? params.EnableWriteTools ?? params.enable_write_tools)
  const enableMcpTools = readBool(
    params.enableMcpTools ?? params.EnableMCPTools ?? params.EnableMcpTools ?? params.enable_mcp_tools,
  )
  const enableSubagentTools = readBool(
    params.enableSubagentTools ?? params.EnableSubagentTools ?? params.enable_subagent_tools,
  )

  const strippedResult = typeof result === 'string'
    ? result.replace(STEP_TIMESTAMP_HEADER_RE, '').trim()
    : ''
  const hasPlaceholderResult = strippedResult === 'done' || strippedResult === 'failed'
  const text = hasPlaceholderResult ? '' : strippedResult

  const successMatch = !isError && text ? DEFINED_SUCCESS_RE.exec(text) : null
  const name = paramName || (successMatch?.[1]?.trim() ?? '')
  const confirmedDefined = Boolean(successMatch)

  const cleanedError = isError && text ? text.replace(STEP_ERROR_PREFIX_RE, '').trim() : undefined
  const isStructured = confirmedDefined || Boolean(cleanedError)
  const extraText = !isStructured && text ? text : undefined

  return {
    name,
    description,
    descriptionPreview,
    systemPrompt,
    enableWriteTools,
    enableMcpTools,
    enableSubagentTools,
    confirmedDefined,
    ...(cleanedError ? { errorMessage: cleanedError } : {}),
    ...(extraText ? { extraText } : {}),
    hasPlaceholderResult,
    raw: text,
  }
}

export function defineSubagentSummaryText(params: Record<string, unknown>): string {
  const info = parseDefineSubagent(params)
  return [info.name, info.descriptionPreview].filter(Boolean).join(' · ')
}
