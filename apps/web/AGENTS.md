<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Brand hue is scoped — never apply it globally

The website chrome (header, nav, marketing copy, generic CTAs) **must stay at the default cool-neutral palette** (`--brand-hue: 240` from `theme.css`). Brand-hue customization only exists inside `<BrandedSurface>` (`components/branded-surface.tsx`), which sets `--brand-hue` on its own wrapper so all hue-derived tokens (`bg-primary`, `bg-card`, `bg-background`, `text-foreground`, …) recompute *only inside that subtree*.

**Why scoping needs more than just `--brand-hue`:** custom-property values are *eagerly* substituted at the declaring scope. `--primary: oklch(... var(--brand-hue))` declared on `:root` is computed there using `:root`'s `--brand-hue` (240); descendants inherit the resolved string `oklch(... 240)`, NOT the unresolved tokens. So setting `--brand-hue` on a descendant has no effect on `--primary` unless `--primary` is also re-declared at that descendant.

That's exactly what the `.brand-scope` CSS class in `app/globals.css` does — it mirrors the hue-derived token declarations from `theme.css` so they re-resolve at the wrapper element using its own `--brand-hue`. `<BrandedSurface>` applies this class + writes `--brand-hue` inline. Verified with Playwright (`oklch(0.65 0.2 240)` outside, `oklch(0.65 0.2 <user_hue>)` inside).

**Rules:**

- Any "simulated app UI" / desktop-app preview / branded showcase **must** be wrapped in `<BrandedSurface>`. Don't render demo UI as a bare child of the page — wrap it.
- Do **not** write `--brand-hue` to `document.documentElement` or to the `<html>`/`<body>` element. The provider (`components/providers/brand-hue-provider.tsx`) intentionally only owns React state + localStorage; it does not touch the DOM root.
- If you add a new hue-derived token to `theme.css`, you MUST also add the same declaration to `.brand-scope` in `app/globals.css`, otherwise the new token won't respond to user hue inside the surface. There is no automated test for this — keep them in sync by hand.
- Do **not** add a global inline `<script>` or `next/script` to pre-set hue on `<html>` (we removed `BrandHueScript` for this reason). A small flash inside the surface on first render is acceptable since surfaces are typically below the fold; chrome must never flash.
- The `<BrandHuePicker>` lives in the global header but its effect is scoped — that is by design. Don't move the picker inside the surface "to make the relationship clearer"; the global picker controlling local surfaces is the intended UX (mirrors the desktop app pattern).
- If you need a "non-branded" companion section next to a `<BrandedSurface>`, just put it as a sibling — siblings outside the surface stay on default hue automatically.

**File map:**

- `components/branded-surface.tsx` — the scope component (use this everywhere)
- `components/providers/brand-hue-provider.tsx` — React state + localStorage (no DOM writes)
- `components/site/brand-hue-picker.tsx` — header popover (light-mode only, like desktop)
- `theme.css` token chain (in `@superone/ui`): every OKLch token reads `var(--brand-hue, 240)` so overriding on any ancestor cascades naturally

# i18n: setRequestLocale or page goes dynamic

Every page under `app/[locale]/` that renders translated content must call `setRequestLocale(locale)` (after `await params`) to keep static rendering. Forgetting it silently demotes the page from `●` (SSG) to `ƒ` (Dynamic) — visible in `bun run build` output. The pattern: outer `async` page reads params + calls `setRequestLocale`, then renders an inner sync component that uses `useTranslations(...)`.

Locale routing config lives in `i18n/routing.ts` (`localePrefix: "as-needed"` → default `en` has no prefix). Middleware is in `proxy.ts` (Next 16 renamed `middleware.ts` → `proxy.ts`).
