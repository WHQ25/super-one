# DeepSeek harness backlog

| Capability | Since | Benefit | Cost / risk | Decision |
|---|---|---|---|---|
| File rewind | 0.1.7-rc.1 workspace changes | Restore edits | Snapshots have no host restore API; diffs are not full file backups | open; capability remains off |
| Goal controls | Mounted goal services | Host-managed goals | No host control/UI integration | open; `goal: null` |
| Background workflow row | 0.1.7-rc.1 integration | Show tracked workflows alongside children/jobs | Needs Workflow mapping and stop-row identity | open; work is already counted and stopped |
| Trajectory overview and backward paging | Original integration | Inspect longer sessions and latency | Prepend anchoring and richer projection | open; current view is a bounded tail |
| Additional trajectory event families | Original integration | Inspect hooks, commands and code dispatch | Add records only with real producers | open |
| Utility-process isolation | Original integration | Isolate engine work from desktop main | Cross-process bridge and lifetime cost | open; justify with measured stalls/isolation requirements |
| Third-party plugin dependency resolution | Original plugin host | Install unbundled dependencies | Adds package-manager lifecycle and trust surface | open; installer reports missing dependencies |
| Live API and platform verification | 0.1.7-rc.1 upgrade | Release confidence | Scripted tests do not exercise DeepSeek service or every OS | open; live API turn and Linux/Windows runner/PTC checks in upgrade record |
| Packaged third-party plugin import | Original plugin host | Verify external plugin resolution into app.asar | Packaged runtime boot is not proof of this separate path | open |
| Optional apply_patch tool | 0.2.2-rc.1 | Atomic-looking multi-file create/edit/delete/move interface | Needs deliberate preset exposure and parity in host diff/permission mapping | open; upstream default remains off, existing file tools remain available |
| Node PTC VM Script/state retention | 0.2.2-rc.1 | Top-level await, imports and optional state across calls | Changes run_code semantics and lifetime/memory handling | open; keep upstream per-call default |
| Independent upstream session API feeds | 0.2.2-rc.1 | Snapshot/subscription split for logs, state and projections | Would duplicate the existing in-process event bridge and host trajectory | open; continue using direct Cordis/session seams |
| Upstream external-CLI subagent_oar | 0.2.2-rc.1 | Delegate to local Claude/Codex through dsh | Overlaps host harness ownership, credentials and lifecycle control | rejected for this integration; use SuperOne orchestration |
| Upstream plugin-market and schedule tool rows | 0.2.2-rc.1 presets | Native dsh discovery/scheduling | Require profile, market and scheduling services outside the embedded host | rejected; vendored presets omit the host-owned rows |
| Upstream profile/web/client UI | Original route decision | Upstream UI reuse | Conflicts with host ownership and adds another UI runtime | rejected; use native host UI and reviewed preset declarations |

Background children, immediate child identities and wait/notification controls,
plan approval, queued steering, session projection and per-child model selection
are implemented. They are not deferred features.
