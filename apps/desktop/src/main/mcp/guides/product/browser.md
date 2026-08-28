# The embedded browser (`browser_*`)

Nine tools drive one browser that lives inside SuperOne. Every tool takes an
optional `tab`; omit it and the session's current tab is used.

```
browser_tabs      open / navigate / list / back / forward / reload
browser_snapshot  read the page (meta, elements, tree, text, console, screenshot)
browser_query     search or inspect when you already know the target
browser_act       click, hover, type, press, scroll, drag, select, upload
browser_wait_for  block until the page reaches a state
browser_network   recording, downloads, cookies, mocks, device emulation
browser_perf      CPU profile of an interaction or of steady state
browser_evaluate  run JavaScript, for what the tools above cannot express
browser_action    save and replay a named multi-step flow
```

## `browser_act` batching

One action per call is the default, and it is what the user sees as one step.
Batch 2–20 actions only for a sequence you would not stop in the middle of —
filling a form and submitting it. Anything where you would want to look at the
page first belongs in a separate call.

The batch is fail-fast: it stops at the first error and reports how far it got.

`engine` selects how input is delivered: `cdp` drives the DevTools protocol,
`synthetic` synthesizes events in the page, `auto` (the default) picks. Only
override it when `auto` has already failed on that page.

`expect` holds the call open until a page condition is met, which is cheaper and
less racy than a follow-up `browser_wait_for`. `recording: true` saves a video of
just this transaction.

## `browser_network`

Recording is on-demand and ordered — there is no always-on buffer to query:

```
action=start                  begin recording
… browser_act / browser_tabs  cause the traffic
action=wait | action=stop     returns a lean manifest of requests
action=body({requestId})      pull one full response body
```

`action=download` fetches a URL through the session; `action=downloads` lists
captures the page itself triggered.

`action=cookies`, `mock` and `emulate` need the CDP experimental settings turned
on — check with `config_read`. One exception: `emulate` with only
`preset` / `width` / `height` / `reset` resizes the viewport without CDP.

## `browser_perf`

Two modes, and the mode is chosen by whether you pass `action`:

| | `action` passed | `action` omitted |
|---|---|---|
| Window | opens and closes around that one interaction | fixed `sampleMs` of steady state |
| Baseline | ~1s of ambient load sampled first and subtracted | none |
| `target: 'app'` | not available | the only supported mode |

Passing `action` is almost always what you want: your own thinking time never
lands inside the window, and the baseline subtraction keeps the numbers honest on
a page that never goes idle.

The reply carries a `hint` when the result needs reading with care — a window cut
short at `maxWaitMs` (durations become lower bounds) or a bottleneck that is
layout, paint, style or GC rather than script (tuning JS will not help).

## `browser_action` — saved flows

A saved action is a named, parameterized sequence stored under a `domain`
(normally a hostname). `action=list` browses them, `action=do` runs one with
`input`, `action=save` creates or replaces one.

`save` takes `domain`, `name` (`^[a-z][a-z0-9_-]{0,63}$`), `description`,
`parameters` and `steps`.

### `parameters`

An array (max 50) of `{ name, description?, type?, required?, default? }`.
`name` matches `^[A-Za-z_][A-Za-z0-9_-]{0,63}$`, `type` is one of
`string` / `number` / `boolean` / `object` / `array`, and `required` defaults to
`true`.

### `steps`

1–50 steps, executed in order. Every step is an object with a `kind`:

| `kind` | Fields | Meaning |
|---|---|---|
| `tool` | `tool`, `args`, `saveAs?` | Call one browser primitive (`browser_click`, `browser_type`, `browser_navigate`, `browser_snapshot`, …) |
| `action` | `domain`, `name`, `input`, `saveAs?` | Run another saved action |
| `set` | `name`, `value` | Assign an expression to `vars.<name>` |
| `if` | `condition`, `then[]`, `else?[]` | Branch |
| `forEach` | `items`, `steps[]` | Loop over a list; body sees `item` and `index` |
| `repeat` | `times`, `steps[]` | Loop a fixed number of times |

`saveAs` stores that step's result in `vars` under the given name. Child steps of
a control-flow step count toward the 50-step limit; nesting is capped at depth 8
and a loop at 50 iterations.

### Values and expressions

Anywhere a *value* is expected (`condition`, `items`, `times`, `set.value`):

- a JSON scalar — used as-is
- `{ kind: "literal", value: <any JSON> }` — an escape hatch for a literal object
- `{ kind: "ref", path: "input.query" }` — a lookup
- `{ kind: "op", op: "eq", args: [...] }` — an operation

Operators: `eq` `ne` `gt` `gte` `lt` `lte` (2 args), `and` `or` (2+),
`not` `exists` (1), `contains` (2), `add` `subtract` `multiply` `divide` (2).

A `path` must start with `input`, `vars`, `result`, `item` or `index`, followed by
dotted segments. `result` is the previous step's result; `item` and `index` only
exist inside a `forEach`.

Inside `args` and `input`, strings also support `${…}` templates over the same
roots — `"https://example.com/?q=${input.query}"`. A string that is *exactly* one
template (`"${input.count}"`) resolves to the raw value rather than to its text,
so numbers and objects survive.

### Example

```json
{
  "domain": "github.com",
  "name": "search-issues",
  "description": "Search issues in the current repository",
  "parameters": [{ "name": "query", "type": "string" }],
  "steps": [
    { "kind": "tool", "tool": "browser_type",
      "args": { "selector": "input[name=q]", "text": "${input.query}", "clear": true } },
    { "kind": "tool", "tool": "browser_press", "args": { "key": "Enter" } },
    { "kind": "tool", "tool": "browser_wait_for", "args": { "selector": ".issue-list" } },
    { "kind": "tool", "tool": "browser_snapshot", "args": {}, "saveAs": "page" }
  ]
}
```

`browser_action` does not record your earlier calls — a flow is written, not
captured. For a one-off click or type, use `browser_act`.
