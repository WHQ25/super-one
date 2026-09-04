import type { QuestionAnnotations, UserQuestion } from '@superone/shared/agent-types'

export function questionKey(question: UserQuestion): string {
  return question.question
}

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
  return questions.every((question) => Boolean(answers[questionKey(question)]?.trim()))
}

export function initialQuestionAnswers(questions: UserQuestion[]): Record<string, string> {
  return Object.fromEntries(questions.flatMap((question) => {
    const firstOption = question.options[0]
    const hasPreview = question.options.some((option) => Boolean(option.preview))
    return hasPreview && firstOption ? [[questionKey(question), firstOption.label]] : []
  }))
}

export function questionNoteKey(question: UserQuestion, optionLabel: string): string {
  return `${questionKey(question)}\0${optionLabel}`
}

export function buildQuestionAnnotations(
  questions: UserQuestion[],
  answers: Record<string, string>,
  notes: Record<string, string>,
): QuestionAnnotations | undefined {
  const annotations: QuestionAnnotations = {}
  for (const question of questions) {
    const selected = selectedQuestionOptions(answers[questionKey(question)])
    const option = [...selected].reverse().find((label) => (
      question.options.some((candidate) => candidate.label === label)
    ))
    if (!option) continue
    const note = notes[questionNoteKey(question, option)]?.trim()
    if (note) annotations[questionKey(question)] = { notes: note }
  }
  return Object.keys(annotations).length ? annotations : undefined
}
