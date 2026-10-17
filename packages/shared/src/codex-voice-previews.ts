/** Public voice metadata only. OAuth credentials never cross the desktop bridge. */
export interface CodexVoicePreview {
  /** Primary language/accent label supplied by ChatGPT; not a list of supported languages. */
  accent?: string
  previewUrl?: string
}

export type CodexVoicePreviews = Record<string, CodexVoicePreview>
