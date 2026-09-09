/**
 * The *alternatives* beside a prompt suggestion.
 *
 * The first suggestion always goes into the composer as ghost text, accepted with Tab
 * — see `prompt-suggestion.ts`. A harness that offers only one (Claude) stops there.
 * A harness that emits a set (currently xAI/Grok, via the `suggestions` field on
 * `prompt_suggestion`) hands the rest to this row. ChatInput passes the tail only, so
 * no string is ever on both surfaces at once.
 */
export function PromptSuggestionChips({
  suggestions,
  onSelect,
}: {
  suggestions: string[]
  onSelect: (suggestion: string) => void
}) {
  if (suggestions.length === 0) return null

  // `mt-2` rather than relying on a parent gap: this row is the top edge of the
  // composer stack, so nothing above it is spacing against it — the transcript
  // scrolls straight into the chips.
  return (
    <div className="mx-3 mt-2 mb-1 flex flex-wrap gap-1.5">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          className="max-w-full truncate rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => onSelect(suggestion)}
        >
          {suggestion}
        </button>
      ))}
    </div>
  )
}
