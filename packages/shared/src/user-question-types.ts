export interface UserQuestionOption {
  label: string
  description: string
  preview?: string
}

export interface UserQuestion {
  /** Optional stable answer key, for requests with repeated question text. */
  id?: string
  question: string
  header: string
  options: UserQuestionOption[]
  multiSelect: boolean
}

export type QuestionPreviewFormat = 'markdown' | 'html'

export interface QuestionAnnotation {
  preview?: string
  notes?: string
}

export type QuestionAnnotations = Record<string, QuestionAnnotation>

export interface AskUserQuestionRequest {
  requestId: string
  questions: UserQuestion[]
  previewFormat?: QuestionPreviewFormat
}
