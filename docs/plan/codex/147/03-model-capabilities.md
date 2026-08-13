# 03. Provider/Model 动态能力

状态：[PLANNED]

## 目标

使用 `modelProvider/capabilities/read` 配合 `model/list`，让模型选择器根据实际 provider/model 返回 reasoning effort、图像输入、personality 和其他能力，而不是依赖静态表。

## 集成步骤

1. App Server 初始化后按 provider + auth scope 缓存模型目录。
2. `model/list` 负责可选模型、默认模型、升级建议和 input modalities。
3. 对当前选中的 model/provider 请求 `modelProvider/capabilities/read`，解析有效 effort、sandbox、网络和输入限制。
4. 缓存键包含环境、provider、runtime version 和账号类型；auth 切换时失效。
5. 旧版本/请求失败时回退现有静态能力，并标记为“能力信息可能过期”。

## UI/UX

- Composer 的模型下拉菜单展示模型、默认标记、输入能力图标和推荐 reasoning effort。
- 不支持图片时，图片按钮禁用并给出原因；不要等发送后报错。
- effort 选择项根据模型动态裁剪；保存旧 preference 时自动降级到 default。
- Settings → Models 提供“刷新模型目录”和上次更新时间。
- provider 切换后显示轻量 loading，避免旧模型能力闪现。

## 验收

- 不同 provider/model 返回不同 effort 和 modality 时 UI 正确变化。
- 缓存命中不重复请求；账号/provider 变化不使用旧缓存。
- 0.146.1 或不支持该方法时仍可发送消息。
