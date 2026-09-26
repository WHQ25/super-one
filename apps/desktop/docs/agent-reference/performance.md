## Startup performance

Packaged cold start (launch → composer ready, P50, M1 Max) went from 5103ms to
1280ms in September 2026. New work must not add cost to the startup path unless
the first window needs it.

### Rules for new code

- **Load heavy or optional code where it is used.** In the renderer, a component
  that pulls a large library (three, mermaid, pdf.js, editors, charts) is reached
  only through `React.lazy` or `import()`. A single static import chain from
  `App.tsx` puts the library in the entry chunk and defeats every lazy boundary
  elsewhere, so trace the whole chain up to a lazy boundary, not just the file you
  touched. In main, optional SDKs and services load on first use: `@cursor/sdk`
  only through `loadCursorSdk()` / `isCursorSdkError()`, shiki when the first phone
  connects. `import type` is free; a value import is not.
- **When deferring initialization, await readiness at every consumer.** Code that
  used to be warm at startup can now be called before it is ready (e.g. the phone
  highlighter must be awaited at each phone content entry point, or the first
  snapshot goes out unhighlighted).
- **Keep `createWindow` unblocked.** No synchronous subprocesses, probes, cleanup
  (`ps`, orphan reapers) or warmups before it. Run them asynchronously or after the
  window exists, and give any awaited pre-window step a timeout.
- **Gate PATH-dependent spawns.** The login-shell PATH is read asynchronously.
  New code that spawns a bare command or passes `process.env` to a long-lived child
  must `await ensureShellPath()` or wrap the call in `withShellPath()` from
  `src/main/shell-path.ts`. A spawn that skips it runs on launchd's minimal PATH
  for its whole life, and a "not found" result may be persisted.
- **Do not add libraries to `manualChunks`.** Rollup can place shared helpers such
  as `__vitePreload` in a manual chunk, which makes the entry statically import the
  whole library. Only `react-vendor` belongs there.
- **Load renderer pages through `loadRendererPage()`.** It serves
  `superone-renderer://app/`, which has V8 code cache; `file://` does not.

### Verifying

- **Lazy boundary**: `bun run build`, then find the chunk containing a library
  signature (e.g. `grep -l WebGLRenderer out/renderer/assets/*.js`) and confirm it
  is neither `index-*.js` nor listed as a `modulepreload` in `out/renderer/index.html`.
  Judge chunks by content, not name: Rollup names a shared chunk after one of its
  modules, so `mermaid-*.js` can hold app code and no mermaid.
- **Wall clock**: the packaged build is the baseline of record. Run outside the
  sandbox:

  ```bash
  SUPERONE_VARIANT=dev bun run build:mac-dev
  bun run bench:startup --app "dist/dev/mac-arm64/SuperOne Dev.app/Contents/MacOS/SuperOne Dev"
  ```

  Compare P50/P75 over 10 runs before and after each change. Pass
  `PATH=/usr/bin:/bin:/usr/sbin:/sbin` to simulate a Finder launch. Set
  `SUPERONE_VARIANT` explicitly; shells inside SuperOne Alpha inherit `alpha`.
- **Profiling main**: `--cpu-prof` writes nothing under Electron. Launch with
  `--inspect-brk=PORT`, send CDP `Profiler.start`, then
  `Runtime.runIfWaitingForDebugger`. The inspector inflates compile time, so
  confirm wins with the bench.
- **Profiling the renderer**: a page reload reuses code compiled in the process
  and hides cold-start parsing. Capture a real launch with
  `--trace-startup --trace-startup-format=json`.
- **Interpreting results**: V8 parses chunks in parallel, so without code cache
  wall clock follows the largest chunk; with code cache it follows total bytes. A
  byte reduction may show no gain until the other condition changes. Measure both
  states before concluding a change does nothing.

### Judgment

Reject a deferral that causes a visible regression or saves time that already
overlaps other startup work. For example, `applyAppIcon` (~80ms) stays: it runs
in parallel with renderer loading, and removing it puts macOS 26's gray squircle
on the Dock icon.
