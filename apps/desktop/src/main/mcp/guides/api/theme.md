# Theme API

The host app injects design tokens as CSS custom properties on `:root`. They update automatically on light/dark toggle.

## CSS Variables

Use standard `var()` references:

```css
body { background: var(--background); color: var(--foreground); }
.card { background: var(--card); border: 1px solid var(--border); }
button { background: var(--primary); color: var(--primary-foreground); border-radius: var(--radius); }
```

**Core:** `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--ring`, `--radius`.

**Sidebar:** `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring`.

## Programmatic Access

```js
const vars = superone.theme.getVars()
// → { background: 'oklch(...)', primary: 'oklch(...)', radius: '0.625rem', ... }

const unsub = superone.theme.onChange((vars) => {
  // Called when theme changes (e.g., light ↔ dark toggle)
})
```

## Dark Mode

The host syncs the `dark` class on `<html>` and provides helpers:

```js
const isDark = superone.isDarkMode()         // → boolean
const unsub = superone.onDarkModeChange((isDark) => {
  // isDark: boolean
})
```

## Tips

- For tool result renderers that render inline in chat (`tools[].renderer.result`), use `background: transparent` on `<body>` to blend with the surrounding message
- Standard apps opened in the activity panel or canvas can use `var(--background)` for a solid background matching the host

## Example: Updating a Chart on Theme Change

```js
superone.onDarkModeChange(function(isDark) {
  chart.options.scales.x.ticks.color = isDark ? '#fafaf9' : '#1c1917'
  chart.update()
})
```
