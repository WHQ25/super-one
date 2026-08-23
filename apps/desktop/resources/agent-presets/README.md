# Vendored dsh agent presets

Copies of the four presets `@deepseek-ai/dsh` ships in its own
`config/agent-presets/`, pinned to the same `0.1.1-rc.2` line as the rest of the
family. They are verbatim **except for one deviation**, marked with a
`SuperOne deviation` banner at the top of each file it touches: `standard`,
`code`, and `cordis` pin their two delegation rows to the foreground, because
SuperOne renders none of the Task controls a background child would need.

They are vendored rather than read out of `node_modules` for two reasons. The
`@deepseek-ai/dsh` package that carries them pulls 61 dependencies, including the
whole `dsh-client-ui-*` browser surface SuperOne replaces. And a preset **is** a
composition — its rows run with shell-level trust and its YAML may carry `!!js`
expressions — so the exact text that composes an agent belongs somewhere a
reviewer reads, not somewhere a transitive install decides.

Re-copy all four directories whenever the pinned dsh version moves:

    cp -R <deepseek-harness>/apps/cli/config/agent-presets/{standard,code,minimal,cordis} \
          apps/desktop/resources/agent-presets/

then re-apply the deviation banner and its `enableRunInBackground: false` edit —
`packages/deepseek/src/subagent.test.ts` fails loudly if it is forgotten.

Shipped to the packaged app through `extraResources` in `electron-builder.yml`;
`dsh-agent-presets` scans this directory as the `system`-trust root, and appends
`<dshHome>/.agent-presets` as the writable one.
