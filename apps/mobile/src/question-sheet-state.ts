import type { UserQuestion } from '@superone/shared/agent-types'

export function selectedQuestionOptions(value: string | undefined): string[] {
  return value ? value.split(', ').filter(Boolean) : []
}

export function toggleQuestionOption(
  question: UserQuestion,
  current: string | undefined,
  label: string,
): string {
  if (!question.multiSelect) return label
  const selected = selectedQuestionOptions(current)
  return selected.includes(label)
    ? selected.filter((item) => item !== label).join(', ')
    : [...selected, label].join(', ')
}

export function questionAnswersAreComplete(
  questions: UserQuestion[],
  answers: Record<string, string>,
): boolean {
  return questions.every((question) => Boolean(answers[question.header]?.trim()))
}
