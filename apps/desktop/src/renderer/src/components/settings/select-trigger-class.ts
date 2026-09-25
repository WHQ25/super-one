/**
 * Chrome for a dropdown / popover trigger sitting on a settings card: compact,
 * bordered and on the page background so it reads as a control against the
 * tinted card. Add `max-w-*` and tone classes at the call site as needed.
 */
export const settingsSelectTriggerClassName =
  'flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60'
