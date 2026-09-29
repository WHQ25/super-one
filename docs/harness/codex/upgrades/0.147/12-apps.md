# 12. Apps/Connectors 产品化

状态：[PLANNED]

## 目标

接入 `app/list`、`app/read`、`app/installed` 与 `app/list/updated`，让 Codex 可用的 Connector/App 能力与 SuperOne Mini-app 和外部连接器 UI 清晰区分。

## 实现设计

- App Server 返回的是 connector/runtime 状态；Mini-app 的安装包、窗口生命周期仍归 `useMiniAppStore` 和 Mini-app service。
- Main 根据 app id 建立安全映射，renderer 只收到展示元数据和 callable/enabled 状态。
- 列表使用 cursor 分页；详情页才请求 display-only tool summaries。
- 收到 `app/list/updated` 后失效对应环境缓存，不中断运行中的 turn。

## UI/UX

- Apps 页面按 Available、Installed、Enabled、Unavailable 分组。
- 每行显示名称、来源、enabled/callable 状态和不可用原因。
- 工具摘要放在详情抽屉；“Connect/Enable”是明确动作按钮，不把不可调用项做成假链接。
- app 状态变化用非阻塞 toast 和状态点提示，用户可手动刷新。

## 安全与测试

- connector auth 状态由 Main/环境返回，不能由 renderer 本地值推断。
- 未授权 app 不得出现在动态工具注册表。
- 分页、更新通知、详情失败和远程环境隔离都有测试。
