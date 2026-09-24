## Layout

The same widget renders in a ~680–820px desktop transcript and a ~360px phone. Pick how it meets the narrow one with `widget_show`'s `layout` parameter, passed before `widget_code`:

- **`fixed`** — for UI mockups: an app screen, window, settings page, or dashboard whose arrangement is what the user is reviewing. The widget is laid out at 680px and scaled down as a whole on narrower screens, so it keeps its desktop proportions and the user pinches to read details. Design for exactly 680px; add no breakpoints.
- **`fluid`** (default) — for everything else: tables, forms, cards, explainers, charts. The widget reflows to the available width, so it must still work at 360px: prefer `flex-wrap` and `grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))` over fixed-width side columns.

When unsure, a widget that imitates a real product surface is `fixed`; a widget that presents information is `fluid`.
