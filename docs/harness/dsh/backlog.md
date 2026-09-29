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
| Upstream profile/web/client UI | Original route decision | Upstream UI reuse | Conflicts with host ownership and adds another UI runtime | rejected; use native host UI and reviewed preset declarations |

Background/continuable children, plan approval, queued steering, session projection
and per-child model selection are implemented. They are not deferred features.
