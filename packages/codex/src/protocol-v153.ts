import type { CodexAsyncUserInputQuestion } from '@superone/shared/agent-types'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function readCodexAsyncUserInputQuestions(
  value: unknown,
): CodexAsyncUserInputQuestion[] | undefined {
  if (!Array.isArray(value)) return undefined
  const questions = value.flatMap((entry) => {
    const question = asRecord(entry)
    const title = readString(question?.title)
    if (!title) return []
    const options = Array.isArray(question?.options)
      ? question.options.map(readString).filter((option): option is string => option !== null)
      : null
    return [{ title, options }]
  })
  return questions.length > 0 ? questions : undefined
}
