# Mini-App Logo Specification

Mini-apps can declare a `logo` field in `manifest.json` to display a custom icon in the app drawer and canvas.

## `logo` — App Icon

Displayed at original colors in the app drawer, sidebar tabs, and canvas headers.

### Requirements

- **Format**: PNG recommended (transparent background). SVG, JPEG, WebP also supported
- **Size**: 256×256px recommended (minimum 128×128)
- **Aspect ratio**: Square (1:1)
- **Background**: Transparent
- **Convention**: Name the file `logo.png` in the app root

### Manifest Example

```json
{
  "name": "DB Browser",
  "logo": "logo.png",
  "type": "panel"
}
```

If no `logo` is provided, a default icon is displayed.

## File Structure

```
my-app/
├── manifest.json
├── index.html
└── logo.png        ← 256×256, full-color, transparent
```
