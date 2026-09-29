# 07. `thread/inject_items` 上下文注入

状态：[PLANNED]

## 目标

在不创建新的用户 turn 的情况下，向已加载线程注入受控的 Responses API items，用于环境切换、远程节点摘要、工具结果桥接和迁移上下文。

## 约束

这是高影响实验能力。注入内容会进入模型可见历史，但不一定表现为普通用户消息；不能拿它替代正常发送，也不能让 renderer 直接拼任意 raw item。

## 实现设计

- 只允许 Main 内部调用，定义白名单 item 类型和最大字节数。
- 每次注入写入 SuperOne trace：来源、threadId、item 类型、hash、时间，不记录 secret payload。
- 注入与 turn/steer 互斥，若 turn in progress 则排队或拒绝，禁止竞态插入。
- resume 后由 thread/read 校验注入是否已经持久化，避免重复注入。

## UI/UX

- 普通用户不直接看到“inject”按钮；在断线恢复或环境切换时显示简短的“上下文已同步”。
- 调试模式可展开来源和 hash，但默认不显示内部 item JSON。
- 注入失败显示“上下文同步失败，不影响当前会话”，提供 Retry。

## 验收

- 注入不生成伪造的 user message 或额外计费 turn。
- 重连、resume、重复事件不会重复注入。
- 超限、非法 item、活动 turn、旧 runtime 都有明确降级。
