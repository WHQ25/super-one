# 06. Thread Sections 分组

状态：[PLANNED]

## 目标

接入 0.147.0 新增的 `threadSection/list/create/update/delete/move`，为 Codex 会话提供用户可管理的分组/文件夹。

## 产品决策

只有当 SuperOne 侧边栏确定需要“项目内分组”时实施。不要为了暴露协议而新增一套用户不理解的抽象；普通 session list 仍应在没有 section 时正常工作。

## 实现设计

- Section 由 Codex thread metadata 持久化，SuperOne SQLite 只缓存展示排序和本地 collapsed 状态。
- 移动 thread 采用 optimistic UI；收到 server notification 或失败后校正。
- section 删除必须选择“移入未分组”或“连同会话一起删除”，默认前者。
- 旧 runtime 不支持时隐藏拖拽和 section 操作，保留扁平列表。

## UI/UX

- Sidebar 采用紧凑的 section header + session rows；支持折叠、拖拽移动和 context menu。
- 新建 section 使用 inline input，不弹大对话框。
- 空 section 显示轻提示和拖放目标，不展示装饰性卡片。
- 删除 section 明确显示不会删除会话的默认行为。

## 验收

- 创建、重命名、移动、删除和刷新后顺序稳定。
- 并发设备操作不会把会话丢失；冲突时以 App Server 返回状态重放。
- 0.146.1 完全降级为扁平列表。
