---
name: shadcn
description: Add, compose, style, or debug shadcn/ui components; initialize shadcn projects or change registry presets.
user-invocable: false
allowed-tools: Bash(npx shadcn@latest *), Bash(pnpm dlx shadcn@latest *), Bash(bunx --bun shadcn@latest *)
---

# shadcn/ui in SuperOne

Shared primitives live in `packages/ui`; its `components.json` owns the registry
configuration. Use `bunx --bun shadcn@latest` from that directory for CLI work.
Inspect existing components and their call sites before adding another primitive.
Keep project conventions such as shared `IconButton`, semantic colors, and
colocated Storybook coverage.

## Read for the task

| Task | Reference |
|---|---|
| Add/update a component or change presets | [cli.md](cli.md) |
| Forms and validation | [forms.md](rules/forms.md) |
| Compose groups, overlays, cards, or loading states | [composition.md](rules/composition.md) |
| Styling and class overrides | [styling.md](rules/styling.md) |
| Icons | [icons.md](rules/icons.md) |
| Radix `asChild` versus Base `render` | [base-vs-radix.md](rules/base-vs-radix.md) |
| Theme or CSS variable changes | [customization.md](customization.md) |

Read the references relevant to the change. A local styling fix does not need a
registry search or project initialization. When configuration is unknown, use
`bunx --bun shadcn@latest info --json`; reuse that result during the task.
For unfamiliar component APIs, `docs <component>` returns documentation links.

Use built-in variants and existing primitives when they fit. Preserve accessible
labels, overlay titles, keyboard behavior, and required component nesting. Keep
layout styles on wrappers when component variants already own their appearance.

Preview component upgrades with `add <component> --dry-run` and `--diff`; merge
upstream changes without discarding local customizations. Review newly generated
files for composition, imports, and the project's icon library. Finish with the
requested UI and relevant interactions verified, including its stories.
