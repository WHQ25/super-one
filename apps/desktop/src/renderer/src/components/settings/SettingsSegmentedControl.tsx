import type { ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'

/**
 * Option switcher for settings headers and toolbars (ranges, filters, scopes).
 * Built on the app-wide `Tabs` so every switcher shares its sliding pill; it
 * renders no tab panels — the caller swaps content from `value`.
 */
export function SettingsSegmentedControl<T extends string>({ value, options, onChange, label, disabled, className }: {
  value: T
  options: ReadonlyArray<{ value: T; label: ReactNode; disabled?: boolean }>
  onChange: (value: T) => void
  /** Accessible name for the group. */
  label: string
  /** Disables every option, e.g. while a save is in flight. */
  disabled?: boolean
  className?: string
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as T)} className={className}>
      <TabsList aria-label={label} className="w-fit max-w-full overflow-x-auto">
        {options.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            disabled={disabled || option.disabled}
            className="flex-none px-2.5 py-1"
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
