import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { CodeTabs } from './CodeTabs'

export type SectionDef = {
  id: string
  icon: LucideIcon
  title: string
  blurb: string
  api: string
  Demo: () => ReactNode
  react: string
  vanilla: string
}

export function Section({ def }: { def: SectionDef }) {
  const { id, icon: Icon, title, blurb, api, Demo, react, vanilla } = def
  return (
    <section
      id={id}
      className="scroll-mt-16 bg-card text-card-fg border border-border rounded-[var(--radius-card)] overflow-hidden"
    >
      <header className="px-5 py-4 border-b border-border">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Icon size={18} className="text-primary shrink-0" aria-hidden />
          {title}
          <code className="ml-1 text-[11px] font-mono text-muted-fg bg-accent px-1.5 py-0.5 rounded">
            {api}
          </code>
        </h2>
        <p className="text-[13px] text-muted-fg mt-1">{blurb}</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-5">
        <div className="flex flex-col gap-2 min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-fg">
            Live demo
          </div>
          <div className="border border-border rounded-[var(--radius-card)] p-4 bg-bg flex-1 min-h-[120px] min-w-0">
            <Demo />
          </div>
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-fg">
            Sample code
          </div>
          <CodeTabs react={react} vanilla={vanilla} />
        </div>
      </div>
    </section>
  )
}
