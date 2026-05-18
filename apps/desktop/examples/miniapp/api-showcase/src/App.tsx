import { useEffect, useState } from 'react'
import { Section } from './components/Section'
import { SECTIONS } from './sections/registry'

export default function App() {
  const [active, setActive] = useState(SECTIONS[0].id)
  const [wide, setWide] = useState(false)

  // Left rail when there's room (canvas / fullscreen), top pill nav otherwise.
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 880)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Highlight the section currently in view (viewport-rooted — the iframe
  // document is the scroll container, not a nested element).
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) setActive(visible.target.id)
      },
      { rootMargin: '-15% 0px -65% 0px', threshold: [0, 0.5, 1] },
    )
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-full flex flex-col bg-bg text-fg">
      <header className="px-6 py-4 border-b border-border">
        <h1 className="text-lg font-bold">SuperOne Mini-App · API Showcase</h1>
        <p className="text-[13px] text-muted-fg mt-0.5 max-w-3xl">
          Every <code className="font-mono">window.superone.*</code> capability —
          live demo + React &amp; vanilla JS samples. The bridge global is
          identical in both; only the component wiring differs.
        </p>
      </header>

      {!wide && (
        <nav className="flex gap-1.5 overflow-x-auto no-scrollbar px-4 py-2 border-b border-border sticky top-0 z-20 bg-bg">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.id}
                onClick={() => jump(s.id)}
                className={
                  'shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors ' +
                  (active === s.id
                    ? 'bg-primary text-primary-fg font-medium'
                    : 'text-muted-fg hover:bg-accent hover:text-accent-fg')
                }
              >
                <Icon size={13} aria-hidden />
                {s.title}
              </button>
            )
          })}
        </nav>
      )}

      <div className="flex-1 flex gap-6 px-6 py-5 items-start">
        {wide && (
          <nav className="w-52 shrink-0 sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-auto no-scrollbar">
            {SECTIONS.map((s) => {
              const Icon = s.icon
              return (
                <button
                  key={s.id}
                  onClick={() => jump(s.id)}
                  className={
                    'w-full text-left flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] mb-0.5 transition-colors ' +
                    (active === s.id
                      ? 'bg-primary text-primary-fg font-medium'
                      : 'text-muted-fg hover:bg-accent hover:text-accent-fg')
                  }
                >
                  <Icon size={15} className="shrink-0" aria-hidden />
                  {s.title}
                </button>
              )
            })}
          </nav>
        )}

        <main className="flex-1 min-w-0 flex flex-col gap-6">
          {SECTIONS.map((def) => (
            <Section key={def.id} def={def} />
          ))}
          <footer className="text-center text-[12px] text-muted-fg py-6">
            React mini-app template · {SECTIONS.length} APIs · 6-entry Vite build
            (panel · worker · confirm · receipt · counter · detail)
          </footer>
        </main>
      </div>
    </div>
  )
}
