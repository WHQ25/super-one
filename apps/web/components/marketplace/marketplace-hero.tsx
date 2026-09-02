export function MarketplaceHero({
  badge,
  title,
  tagline,
  totalLabel,
  children,
}: {
  badge: string
  title: string
  tagline: string
  totalLabel?: string
  children?: React.ReactNode
}) {
  return (
    <header className="mx-auto flex w-full max-w-5xl flex-col items-center px-4 pb-10 pt-16 text-center sm:px-6 sm:pt-20">
      <span className="border-border bg-card/60 text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
        <span className="bg-primary h-1.5 w-1.5 rounded-full" />
        {badge}
      </span>
      <h1 className="font-serif-display mt-6 text-4xl tracking-tight sm:text-5xl">
        {title}
      </h1>
      <p className="text-muted-foreground mt-4 max-w-xl text-pretty">
        {tagline}
      </p>
      {totalLabel ? (
        <p className="text-muted-foreground/70 mt-2 text-xs">{totalLabel}</p>
      ) : null}
      {children ? <div className="mt-8 w-full max-w-xl">{children}</div> : null}
    </header>
  )
}
