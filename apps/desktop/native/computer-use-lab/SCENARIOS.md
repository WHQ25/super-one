# CU Lab — Scenario Acceptance Matrix

**App:** SuperOne CU Lab (`com.superone.computer-use.lab`)  
**Build:** `bash apps/desktop/native/computer-use-lab/scripts/build.sh`  
**Grant:** Computer Use allowlist must include `com.superone.computer-use.lab`.

Global chrome (every scenario):

| Control | accessibilityIdentifier |
|---|---|
| Scenario list | `cu.lab.scenarioList` |
| Stage host | `cu.lab.stage` |
| Status line | `cu.lab.status` |
| Reset | `cu.lab.reset` |
| Sidebar row | `cu.lab.scenario.S0N` |

Select a scenario: semantic **press** the sidebar row label, or click list coordinates.

---

## S01 Launch / Focus

| | |
|---|---|
| Tools | `computer_apps` |
| Stage ids | `cu.lab.s01.title`, `cu.lab.s01.ping` |

**Steps**

1. `computer_apps` `action=launch` `app=com.superone.computer-use.lab` → target.bundleId matches.
2. `computer_apps` `action=list` `query=CU Lab` → running=true, granted as configured.
3. `computer_apps` `action=focus` → no error; snapshot still Lab.
4. Optional: press `cu.lab.s01.ping` → status contains `Ping #`.

**Pass:** launch/list/focus succeed without granting a second app.

---

## S02 Snapshot / Query

| | |
|---|---|
| Tools | `computer_snapshot`, `computer_query`, `computer_zoom` |
| Stage ids | `cu.lab.s02.needle`, `cu.lab.s02.swatch`, `cu.lab.s02.leaf.*` |

**Steps**

1. Select S02. `computer_snapshot` `mode=semantic` → outline has Needle; no requirement for image.
2. `computer_snapshot` `mode=fused` → image.path present + Needle in outline.
3. `computer_query` `op=search` `text=Needle` → match ref.
4. `computer_query` `op=expand` on a branch ref.
5. Optional: `computer_zoom` on swatch bounds.

**Pass:** search finds Needle; fused returns pixels.

---

## S03 Press / Navigate

| | |
|---|---|
| Tools | `computer_act` |
| Delivery | **semantic** |
| Stage ids | `cu.lab.s03.toggle`, `cu.lab.s03.history`, `cu.lab.s03.page` |

**Steps**

1. Reset. Snapshot fused.
2. `press` / semantic `click` ref for **Toggle** → status `Toggle: on`.
3. `press` **历史** (`cu.lab.s03.history`) → page becomes `Page: 观看历史`, detail shows `清空历史`.
4. Assert **outcome=worked** (outline rewrite even though button title stays 历史).
5. `press` **首页** → back to Home.

**Pass:** history navigation worked + outcome not stuck on unknown when diff is large.

---

## S04 Text Input

| | |
|---|---|
| Tools | `computer_act` |
| Delivery | semantic setText; app-directed typeText |
| Stage ids | `cu.lab.s04.field`, `cu.lab.s04.mirror`, `cu.lab.s04.clear` |

**Steps**

1. Reset. Snapshot.
2. `setText` ref=field text=`苹果公司` delivery=semantic → mirror contains 苹果.
3. `setText` clear or press Clear.
4. Focus field + `typeText` `hello` delivery=app-directed → mirror updates.
5. Seed CJK button optional.

**Pass:** CJK setText readback works; typeText append/replace path works.

---

## S05 Scroll / Drag

| | |
|---|---|
| Tools | `computer_act` |
| Delivery | **app-directed** (physical last resort) |
| Stage ids | `cu.lab.s05.scroll`, `cu.lab.s05.knob`, `cu.lab.s05.scrollInfo`, `cu.lab.s05.dragInfo` |

**Steps**

1. Snapshot. Scroll on scroll area `dy` positive → `scroll offset` changes.
2. Drag knob path ≥2 points → `drag: (x, y)` updates.

**Pass:** status/readouts change after scroll and drag.

---

## S06 Wait For

| | |
|---|---|
| Tools | `computer_act`, `computer_wait_for` |
| Delivery | semantic |
| Stage ids | `cu.lab.s06.start`, `cu.lab.s06.status` |

**Steps**

1. Reset → status **Loading**.
2. `press` Start.
3. `computer_wait_for` condition textContains/textEquals **Ready** on status ref, timeoutMs=3000.
4. Result status `verified` (or preexisting if already Ready).

**Pass:** wait_for becomes Ready without manual sleep loops.

---

## S07 Modal / Sheet / Menu

| | |
|---|---|
| Tools | `computer_snapshot`, `computer_act`, roots |
| Stage ids | `cu.lab.s07.openSheet`, `cu.lab.s07.closeSheet`, `cu.lab.s07.openMenu`, `cu.lab.s07.openPopover` |

**Steps**

1. Open Sheet → snapshot/query finds **Sheet Content** / Close Sheet; press Close.
2. Open Popover → **Popover Content**; Close Popover.
3. Open Menu → Menu Action → parent label **Menu Action Complete**.

**Pass:** transient UI operable; close restores parent.

---

## S08 Dual Window

| | |
|---|---|
| Tools | `computer_apps` includeRoots, `computer_snapshot` |
| Stage ids | `cu.lab.s08.openTwin`, `cu.lab.s08.primary`, `cu.lab.s08.twin` |

**Steps**

1. Open Twin Window (both may show product name SuperOne CU Lab).
2. `computer_apps` `includeRoots=true` → ≥2 roots for this pid/bundle.
3. Snapshot each root: one has token=ALPHA, one token=BETA.
4. Close Twin.

**Pass:** agent can target BETA without confusing windows.

---

## S09 Ambiguous Controls

| | |
|---|---|
| Tools | `computer_query`, `computer_act` |
| Delivery | semantic |
| Stage ids | `cu.lab.s09.save.a/b/c`, `cu.lab.s09.result` |

**Steps**

1. Query/search Save → multiple matches.
2. Inspect identifiers; press save.b only.
3. Result **last: B**.

**Pass:** correct button; no silent wrong target when fingerprint ambiguous (recovery policy).

---

## S10 Stale Ref Recovery

| | |
|---|---|
| Tools | `computer_snapshot`, `computer_act` |
| Delivery | semantic |
| Stage ids | `cu.lab.s10.target`, `cu.lab.s10.mutate` |

**Steps**

1. Snapshot; note Target ref `@eN`.
2. Press **Insert Decoy Nodes** several times (or act on mutate).
3. Act press **original** `@eN` for Target (stale index).
4. Prefer recovered press → status `Target hit`.

**Pass:** recovery rebinds Target (or clean AX_STALE_REF with no wrong side effect).

---

## S11 Coordinate Click

| | |
|---|---|
| Tools | `computer_snapshot`, `computer_act` |
| Delivery | **app-directed** |
| Stage ids | `cu.lab.s11.zone.a/b/c`, `cu.lab.s11.result` |

**Steps**

1. Fused snapshot; compute center of Zone B from bounds.
2. `click` x,y delivery=app-directed.
3. Result **last zone: B**.

**Pass:** coordinate path hits the correct zone.

---

## S12 Canvas / No AX

| | |
|---|---|
| Tools | `computer_snapshot`, `computer_act` |
| Delivery | **app-directed** / physical |
| Stage ids | `cu.lab.s12.canvas`, `cu.lab.s12.readout` |

**Steps**

1. Fused snapshot: canvas is a single image-like node (no HIT child in AX).
2. Click red circle center via coordinates (approx canvas mid).
3. Readout `hits≥1`.

**Pass:** visual/coordinate path works where semantic child press cannot.

---

## S13 Physical / Zero AX

| | |
|---|---|
| Tools | `computer_snapshot`, `computer_act` |
| Delivery | **physical** (primary), app-directed secondary |
| Stage | Fully painted playfield — **no AX content nodes** |

Stage paints (pixel-only HUD, no AX labels/buttons/fields):

| Region | Test |
|---|---|
| Red / green / blue **A B C** | `click` x,y |
| **SCROLL PANE** | `scroll` x,y on pane + dy (older rows) |
| **DRAG KNOB** (orange) | `drag` path ≥2 points |
| Type strip | click strip → `typeText` (physical/app-directed) |

**Steps**

1. Select **S13 Physical / Zero AX**.
2. `computer_snapshot` `mode=fused` — content should be picture-only / no A/B/C AX refs.
3. Prefer `delivery=physical`:
   - `click` center of **B** → status / HUD `click=B`
   - `scroll` with **x,y inside SCROLL PANE**, `dy` large → HUD `scroll=N` changes
   - `drag` orange knob → HUD `drag=(x,y)`
   - click type strip then `typeText` → HUD `type="…"`
4. Optional: same steps with `app-directed` to compare (may fail on some hosts; physical is the contract).
5. **semantic press/setText must fail or find no refs** for these targets.

**Pass:** all four physical interactions change the painted HUD; semantic cannot drive them via AX.

---

## Suggested full regression order

```text
S01 → S02 → S03 → S04 → S06 → S05 → S11 → S12 → S13 → S07 → S08 → S09 → S10
```

Core semantic path first; coordinate / no-AX / physical last; multi-root and recovery after.

## Reset

Press **Reset Scenario** (`cu.lab.reset`) between cases when state is dirty.
