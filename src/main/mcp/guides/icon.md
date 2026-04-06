# Mini-App Icon Specification

Mini-apps support two visual assets in `manifest.json`:

| Field | Purpose | Format | Used In |
|-------|---------|--------|---------|
| `icon` | Monochrome system icon | SVG file or `lucide:<name>` | Sidebar tabs, section headers, compact lists |
| `logo` | Full-color brand image | PNG, SVG, or any image | App launcher cards, Canvas tab headers |

## `icon` — System Icon

Rendered alongside native Lucide icons in the sidebar and tab switcher. SuperOne replaces `fill` and `stroke` with `currentColor` so the icon matches the current theme automatically.

### SVG File Requirements

- **ViewBox**: `viewBox="0 0 24 24"` (24×24 grid, matching Lucide)
- **Style**: Stroke-based with `fill="none"` (matches Lucide icon style)
- **Stroke width**: `stroke-width="2"` for consistency with system icons
- **Line caps**: `stroke-linecap="round" stroke-linejoin="round"`
- **Single color**: All visible paths use `stroke="currentColor"` — no multi-color
- **No embedded raster images, no external references**
- **Convention**: Name the file `icon.svg` in the app root

### SVG Template

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <!-- paths here -->
</svg>
```

### Lucide Icon Alternative

Reference any [Lucide icon](https://lucide.dev/icons/) by kebab-case name:

```json
{ "icon": "lucide:globe" }
```

Examples: `lucide:database`, `lucide:file-text`, `lucide:arrow-right`

### Color Replacement Rules

SuperOne applies these replacements to all SVG icon files at render time:

- `fill="<value>"` → `fill="currentColor"` (except `fill="none"` which is preserved)
- `stroke="<value>"` → `stroke="currentColor"` (except `stroke="none"` which is preserved)

The icon inherits the surrounding text color in both light and dark themes.

## `logo` — Brand Image

Displayed at original colors without modification. Used where visual identity matters.

### Requirements

- **Format**: PNG recommended (transparent background). SVG, JPEG, WebP also supported
- **Size**: 256×256px recommended (minimum 128×128)
- **Aspect ratio**: Square (1:1)
- **Background**: Transparent
- **Convention**: Name the file `logo.png` in the app root

## Manifest Example

Full:

```json
{
  "name": "DB Browser",
  "icon": "icon.svg",
  "logo": "logo.png",
  "type": "panel"
}
```

Minimal (Lucide icon, no logo):

```json
{
  "name": "Quick Timer",
  "icon": "lucide:timer",
  "type": "sidebar"
}
```

## File Structure

```
my-app/
├── manifest.json
├── index.html
├── icon.svg        ← 24×24, stroke-based, monochrome
└── logo.png        ← 256×256, full-color, transparent
```
