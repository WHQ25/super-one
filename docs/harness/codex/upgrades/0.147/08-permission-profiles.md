# 08. Permission Profiles 与能力约束

状态：[PARTIAL]

## 目标

使用 `permissionProfile/list` 和 `configRequirements/read`，把 Codex 实际允许的 sandbox、approval、网络能力反馈到 SuperOne 的权限 UI，而不是只显示本地偏好。

## 当前能力

仓库已有 permission preset、approval request 和 sandbox mode，但仍需要把“管理员/requirements 限制”和“当前用户选择”区分展示。

## 实现设计

- 初始化后读取 effective permission profiles 和 config requirements，按环境缓存。
- 用户 preference 只是请求值；最终值由 profile/managed policy 计算。
- profile 不可用时禁用对应选项，并保留原因 code/description。
- server request 的 suggestions 继续复用现有 permission prompt，不因 profile UI 重构而丢失旧客户端兼容。

## UI/UX

- Composer/Settings 显示 `Permission` segmented control：Sandboxed、Workspace write、Full access（若被 policy 禁止则 disabled）。
- 每个选项旁显示 network、filesystem、approval 简短摘要；详情放在 tooltip/popover。
- 被管理员限制时显示“由环境策略锁定”，而不是“保存失败”。
- 一次性 Allow 与 Always allow 视觉上分开，避免误触长期授权。

## 验收

- policy 禁止的 profile 无法通过 UI 或 IPC 绕过。
- profile 列表失败时仍可使用安全默认值。
- 本地、远程、旧 runtime 的 capability 差异都能解释给用户。
