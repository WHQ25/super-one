"use client"

import { Search } from "lucide-react"

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
}) {
  return (
    <label className="border-border bg-card/40 focus-within:border-foreground/30 focus-within:ring-foreground/10 relative flex w-full items-center rounded-full border px-4 transition-shadow focus-within:ring-4">
      <Search aria-hidden className="text-muted-foreground size-4" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="placeholder:text-muted-foreground/70 ml-2 w-full bg-transparent py-2.5 text-sm outline-none"
      />
    </label>
  )
}
