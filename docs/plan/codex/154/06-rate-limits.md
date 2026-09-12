# 06. Rate limits 用量

状态：无参兼容 [VERIFY]；新参数 / Reserve UI 可选且默认不做

## 目标

确认 0.154 上现有无参 `account/rateLimits/read` 仍能驱动 Usage popover。新可选 params 和 Luna Reserve **默认不声明支持**。

## 协议

```ts
type GetAccountRateLimitsParams = {
  supportsLunaReserve?: boolean
  excludeResetCreditDetails?: boolean
}
```

无参调用在 0.154 仍合法。现有 desktop 与 [`packages/codex/src/codex-admin.ts`](../../../../packages/codex/src/codex-admin.ts) 都是无参。

0.154 响应语义：

- `ordinaryUsageAllowed` 可为 **null**。不能从 percent / reset 推断「已恢复」。
- `RateLimitSnapshot.normalModelSlug` 是 quota alias 的正常模型关联，不是当前会话模型。

## 实现设计

1. **VERIFY**：0.154 无参调用跑现有 parser，primary/secondary window、credits 仍显示。chatgpt 账号测试仍绿。
2. **不要**传 `supportsLunaReserve: true`，除非 SuperOne 真的会在普通额度耗尽后走 Reserve。官方写明不要从 experiment arm 推断。未完成 Reserve 支持时继续 **omit**。
3. 后台轮询可选用 `excludeResetCreditDetails: true`；点开 popover 再完整读。0.153 远程节点不认识 params 时退回无参。
4. 若消费新字段：`ordinaryUsageAllowed === null` 当未知，不要显示成允许或拒绝。`normalModelSlug` 若展示，标明是 quota 关联模型。

## 不做

- 不在本轮做买额度 / nudge email 产品化。
- 不把 Luna Reserve 做成设置开关。

## 验收

- 无参 `rateLimits/read` 在 0.154 解析成功，现有测试仍绿。
- 请求里没有 `supportsLunaReserve: true`。
- 若以后接新字段：null ordinary-usage 不误显示成已恢复。
