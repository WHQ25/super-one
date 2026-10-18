# Settings tools

Use `config_read` to discover domains and exact field keys. Use `config_apply`
with either `changes` or one `resource` operation. Every write waits for the
user's editable confirmation; cancellation, rejection and turn interruption
apply nothing. App preferences and global resources affect the controlling
desktop. Writes require a local session that can present the confirmation;
callers without one receive an error with no changes.

## App preferences

| Domain | Fields |
|---|---|
| `general` | `powerMode`, `notificationsEnabled`, `notificationPermission`, `notificationQuestion`, `notificationPlan`, `notificationConfirm`, `notificationCompleted`, `notificationStalled`, `experimentalClaudeOpenAiChatEnabled`, plus the existing general settings |
| `appearance` | `themeMode`: `system`, `light`, `dark`, plus fonts and palettes |
| `agent-claude` | `claudeDrawModInterfaces`, `claudeModDevFolders`, plus model/effort/permission defaults |
| `agent-codex` | `codexRealtimeVoice` (empty restores the harness default), plus model/effort/permission/Fast defaults |
| `agent-dsh` | `dshSubagentModelSelection`, plus permission defaults |

JSON fields accept native arrays/objects. The confirmation shows editable JSON,
which is validated again before saving. `claudeModDevFolders` is an array of
absolute directory paths; `[]` clears it. `dshSubagentModelSelection` replaces
the preference with `{ enabled: boolean, allowedModels: [{ provider, model }] }`.

`powerMode` accepts `system`, `prevent-idle-sleep`, or `lid-closed-on-ac`.
The closed-lid option can require separate OS administrator approval.

## Resource preferences

Read the domain, then its `recordId`, before updating it. Supported operations
and field names come from the domain's read result.

| Domain | Record | Update |
|---|---|---|
| `default-provider` | `chat:claude`, `chat:codex`, `media:image`, `media:video` | `credentialId`; null or empty clears the binding. The record lists compatible `availableCredentials`. |
| `project-claude` | Current session's project path, returned by the domain read | `outputStyle`; empty restores the project default. Other project settings are preserved. |
| `jev` | `jev` | `apiKey`; empty clears it. Reads and results are masked; storage is encrypted. Configure the key before enabling `jevFastLoopEnabled` in `general`. |
| `app-icon` | `app-icon` (development builds only) | `filePath`: absolute local PNG/JPEG path, at most 10 MB. null or empty restores the built-in icon. Use an image prepared with the desired padding and shape. |

For example, after reading the `default-provider` domain and its `media:image`
record:

```json
{
  "resource": {
    "resource": "default-provider",
    "operation": "update",
    "recordId": "media:image",
    "values": { "credentialId": "<compatible credential id>" }
  }
}
```

Default bindings do not replace explicit per-session provider overrides.
