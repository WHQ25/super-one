# Widgets (`widget_show`)

An agent draws HTML or SVG in the transcript with `widget_show`: explicit
`widget_code`, a saved template (`template` plus `data`), or a native block
(`@native/*`, see [inline-files-previewer.md](inline-files-previewer.md)).
Desktop and phone draw code widgets in a sandboxed iframe from one shared
srcdoc builder ([chat-core.md](../architecture/chat-core.md)).

## 1. What the model reads back

A successful `widget_code` call on a harness with `supportsShortWidgetResult`
(`packages/shared/src/harness/harness-capabilities.ts`: Claude and Codex) returns
only an acknowledgement:

```
Rendered widget "media_composer_redesign".
```

followed by the CDN allowlist warning when the code loads blocked URLs. One
generator writes both (`widgetShowShortContent`,
`packages/shared/src/generative-ui/widget-data.ts`). The title is JSON-quoted and
capped at 120 characters; the warning keeps the violation count, at most five
URLs of at most 160 characters and the number left out, so the reply stays far
below any harness's MCP result limit whatever the widget holds.

Every other call returns the render payload
`{ title, widget_code, width, height, isSVG, layout?, templateId?, reusable? }`:
template calls (their code is not in the input), `@native/*`, errors, and
harnesses without the capability (ACP, OpenCode, Cursor, DeepSeek), whose
reported input is not guaranteed complete. A harness opts in once its transcript
is shown to carry the complete call input.

SuperOne stores exactly what the model read; no mapper rewrites the result.

## 2. Who shortens

The runtime that owns the harness decides, at call time:

- **Desktop, local session**: `executeWidgetShowTool` shortens when the call is
  an explicit local call (`currentCallOwner() === null`) and the session's
  harness has the capability (`apps/desktop/src/main/generative-ui/widget-short-result.ts`). The stdio
  bridge has no session and never shortens.
- **Remote node session**: the desktop answers the Host Action in full; the
  node's `registerHostActionTools` shortens a successful `widget_code` reply for
  a capable harness, rebuilding the acknowledgement from the call's arguments
  (`apps/cli/src/session/host-action-mcp-core.ts`). An unknown harness keeps the
  full reply, and so does an older node: nothing is negotiated.

## 3. Drawing a widget

Desktop (`ToolBlockPresenter.tsx`) and phone (`PortableToolRow.tsx`) resolve a
`widget_show` call with `resolveWidgetCall(input, result, settled)`:

1. A result that carries a payload is drawn as it is: older transcripts,
   templates, harnesses that keep the full result.
2. Otherwise a complete input with a string `widget_code` and no `template` is
   built into the payload by the same `buildWidgetData` the host uses, so it
   renders byte for byte like the host's payload. A result is not required: an
   interrupted call is sealed as complete without one, and its widget was
   already on screen once the input was complete.
3. Otherwise, while the call runs, the desktop previews the partial input and the
   phone shows its generating row.

Errors and denials keep the ordinary tool row, and so does a call interrupted
while its input streamed. Codex items reach the same branch with their
`arguments` (a string is kept as it is) and their `result.isError`, through
`codexMcpItemInput` and `codexMcpItemIsError`.

A subagent's compact card on the desktop stays a summary; its full view draws the
widget.

The phone keeps a `widget_show` call's whole input (`shouldKeepRemoteToolInput`),
so with the short result the code reaches the phone once per call. A phone build
older than render-from-input cannot draw these widgets; a chat-view release that
changes what a widget is drawn from ships to phones before the hosts depend on it.

## 4. Templates

"Save as template" stores the widget's own source. `stripInjectedWidgetData`
removes the leading data preludes `injectWidgetData` wrote, accepting a prelude
only when `injectWidgetData` rebuilds it byte for byte from its parsed record;
any other script stays. `saveTemplate` and the template reader both apply it, so
a template saved with a prelude renders with its current data.

## 5. Alternatives not taken

| Alternative | Why not |
|---|---|
| Host-private payload in the result `_meta` | Claude drops a subagent's whole `tool_use_result` when `_meta` exceeds 8 KiB, and Codex keeps `meta` only while the serialized result stays under 1 MiB. |
| Mappers rewrite the stored result into the payload | SuperOne's transcript would no longer match what the model read. |
| Desktop rebuilds the payload for the phone at send time | Every send path would need it, the live path would need an input lookup, and a chat-view update replaces it. |
