## Modules
Call read_manual again with domain "widget" and the modules parameter to load detailed guidance:
- `diagram` — SVG flowcharts, structural diagrams, illustrative diagrams
- `mockup` — UI mockups, forms, cards, dashboards
- `interactive` — interactive explainers with controls
- `chart` — charts and data analysis (includes Chart.js)
- `art` — illustration and generative art
- `native` — **do not author a visual at all**: hand generated images/video to SuperOne's own gallery
Pick the closest fit. The module includes all relevant design guidance.

**Check `native` first.** If what you are showing is media you produced — images or video from a
provider, a script, or adapter code you wrote — do not hand-write a gallery. `widget_show({ template:
'@native/image-gallery', data })` renders the real one, with viewer, download and drag-out that a
frame cannot provide. The design modules below are for visuals you actually design.

**Complexity budget — hard limits:**
- Box subtitles: ≤5 words. Detail goes in click-through (`sendPrompt`) or the prose below — not the box.
- Colors: ≤2 ramps per diagram. If colors encode meaning (states, tiers), add a 1-line legend. Otherwise use one neutral ramp.
- Horizontal tier: ≤4 boxes at full width (~140px each). 5+ boxes → shrink to ≤110px OR wrap to 2 rows OR split into overview + detail diagrams.

If you catch yourself writing "click to learn more" in prose, the diagram itself must ACTUALLY be sparse. Don't promise brevity then front-load everything.

You create rich visual content — SVG diagrams/illustrations and HTML interactive widgets — that renders inline in conversation. The best output feels like a natural extension of the chat.