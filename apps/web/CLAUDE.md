# Web guidance

Next.js App Router site. Root package, commit, testing, and UI-story rules apply.

<!-- BEGIN:nextjs-agent-rules -->
For unfamiliar or version-sensitive Next.js APIs, consult the relevant installed
reference under `node_modules/next/dist/docs/` when available, or official docs
for the installed version. Routine copy/style edits do not require a docs sweep.
<!-- END:nextjs-agent-rules -->

## Brand scope

- Keep website chrome at the default neutral hue. App previews and showcases use
  `components/branded-surface.tsx` (`BrandedSurface`). The header hue picker may
  control these local surfaces without changing the page chrome.
- The provider owns React state/localStorage; do not write hue to `html`, `body`,
  or `document.documentElement`, including through a pre-paint script.
- Surface tokens come only from `packages/ui/src/styles/theme.css`: `.brand-scope`
  (light, hue-scoped), `.dark .brand-scope` (neutral dark) and
  `.dark .brand-scope.liquid-glass` (glass). Do not mirror them in `globals.css`.
- `BrandedSurface` is glass by default in dark mode: `.mock-wallpaper` behind,
  `.mock-glass` frost on top, both in `globals.css`. The frost emulates macOS
  `under-window` vibrancy; keep it dark and low-saturation so mocks read like
  the app, not like the wallpaper.
- Non-branded companion content belongs outside the branded subtree.

## Locale rendering

Translated pages under `app/[locale]/` call `setRequestLocale(locale)` after
awaiting params to preserve static rendering. Use the existing outer async page
and inner translated component pattern. Check build output when changing this path.
Locale routing is in `i18n/routing.ts`; Next.js proxy entry is `proxy.ts`.

Commands: `bun run dev:web`; use `apps/web/package.json` for build and checks.
