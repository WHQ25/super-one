# SuperOne project automations (`automation_*`)

An automation is a saved prompt the scheduler hands to a fresh agent session on a
cron or one-time trigger. It belongs to one project.

| Tool | Use |
|---|---|
| `automation_list` | Read existing automations. Call it first — `update` and `delete` need an `id` from here. |
| `automation_apply` | Create or update one. Always opens a confirmation dialog; nothing is applied without the user's approval. |
| `automation_delete` | Remove one by `id`. |

## Create vs update

`action: "create"` requires `name`, `prompt` and `schedule`. `agentConfig` is optional.

`action: "update"` requires `id` plus any subset of `name` / `prompt` / `enabled` /
`schedule` / `agentConfig`. Pausing an automation is `enabled: false`, not a delete.

## `schedule`

Machine fields drive the scheduler; the preset fields are UI hints that make the
editor render the same choice the user would have picked by hand.

| Field | When | Meaning |
|---|---|---|
| `type` | always | `"one-time"` or `"recurring"` |
| `runAt` | `type: "one-time"` | ISO timestamp |
| `cron` | `type: "recurring"` | Cron expression, e.g. `"0 9 * * *"` |
| `preset` | optional | `hourly` / `daily` / `weekly` / `custom` — how the editor renders it |
| `timeOfDay` | `daily` / `weekly` presets | `HH:mm`, local time |
| `dayOfWeek` | `weekly` preset | Array of `0`=Sunday … `6`=Saturday |
| `minuteOfHour` | `hourly` preset | `0`–`59` |
| `summary` | always | Natural language, in the user's language |

`summary` is not decoration: it is the only description of the schedule the user
sees in the list and in the confirmation dialog. A cron expression there reads as
an unreviewed change. Write it the way the user would say it — `"Every weekday at
9:00 AM"`, `"每天上午 9 点"`, `"Once on 3 May at 14:00"`.

## `agentConfig`

Which harness runs the automation. Only `type` is required
(`claude` | `codex` | `acp` | `opencode`). Creating without `agentConfig` gives
Claude with `bypassPermissions` and the sandbox off.

Prefer the unified fields — they mean the same thing across harnesses:

| Field | Notes |
|---|---|
| `model` | Harness model id |
| `effort` | Claude levels, Codex reasoning, ACP mode ids |
| `permissionMode` | Prefer `bypassPermissions`: nobody is watching an automation run, so a mode that stops for approval simply never finishes |
| `sandboxMode` | `off` / `on` / `auto` — Claude only, ignored elsewhere |
| `apiProviderId` | Third-party provider credential id (claude / codex) |
| `acpAgentId` | ACP only, e.g. `grok-build` |
| `agentName` | Claude only: a named agent profile |

Two legacy Codex aliases still parse, but write the unified field instead:
`reasoningEffort` → `effort`, and `permissionPreset` → `permissionMode`
(`full-access` ≈ `bypassPermissions`).

## Approval

`automation_apply` never writes on its own. The confirmation dialog is where the
user reviews the prompt, the schedule and the harness, and it is also where they
downgrade permission or sandbox settings. Requesting an autonomous configuration
is therefore safe by construction — propose what the task actually needs.
