# SuperOne CU Lab

Deterministic **AppKit** target for exercising SuperOne Computer Use tools
(`computer_apps` / `computer_snapshot` / `computer_query` / `computer_act` /
`computer_wait_for` / `computer_zoom`).

| | |
|---|---|
| App name | **SuperOne CU Lab** |
| Bundle id | `com.superone.computer-use.lab` |
| Path | `apps/desktop/native/computer-use-lab/` |

Unlike TextEdit / iQIYI, every control has a stable `accessibilityIdentifier`
(`cu.lab.*`), scenarios are resettable, and edge cases (ambiguous Save buttons,
stale DFS refs, no-AX canvas) are intentional.

## Build & run

```bash
bash apps/desktop/native/computer-use-lab/scripts/build.sh
open "apps/desktop/native/computer-use-lab/dist/SuperOne CU Lab.app"
```

Optional:

```bash
SUPERONE_CU_LAB_CODESIGN_IDENTITY="Developer ID Application: …" \
  bash apps/desktop/native/computer-use-lab/scripts/build.sh
```

Ad-hoc sign (`-`) is the default. TCC grants may reset after every ad-hoc rebuild.

## Agent smoke (after grant)

```text
1. computer_apps action=launch app=com.superone.computer-use.lab
2. computer_snapshot mode=fused
3. computer_query search text=S03  (or click sidebar scenario via semantic press)
4. Run the steps in SCENARIOS.md for each S01–S13
   (S13 = zero-AX playfield for physical click/scroll/drag/type)
```


## Layout

```
Sources/
  main.swift
  MainWindowController.swift
  Scenario.swift
  Controls.swift
  Scenarios/S01…S12*.swift
scripts/build.sh
Info.plist
SCENARIOS.md          ← acceptance matrix for agents
```

## Related

- Helper: `apps/desktop/native/computer-use-helper/`
- Older one-off fixtures: `docs/temp/research/computer-use-comparison/verify/`
