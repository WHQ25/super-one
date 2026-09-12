# 移动语音 Relay 成本与服务选择

核实日期：2026-09-12。范围：手机与桌面之间的媒体传输；Codex/OpenAI 连接、会话和任务仍由桌面管理。本报告是源码推导与公开定价估算，未读取账户账单、未核对线上部署版本，也未进行语音压测。

## 结论

本报告比较桌面代理的中继成本。后续新增“手机媒体直连 OpenAI、桌面继续管理 Codex”的方案对比，见[集成研究第 9 节](mobile-codex-realtime.md#9-手机直连与桌面代理的综合选择)；该直连路径不产生自营音频中继费。

CF 可以保留，但不能把音频原样塞进当前聊天事件通道。主要成本问题是逐消息持久化；专用音频 Durable Object 去掉这些操作之后，三个档位的费用都较低。长期的一对一语音更值得优先验证 WebRTC 直连 + Cloudflare TURN 兜底，现有 Relay 保留配对、鉴权和通话控制。

同一 Wi-Fi 下，手机与桌面直连成功时，媒体不经过 CF，媒体中继费为零。桌面到 OpenAI 仍然走公网。局域网直连需要实际选中本地路径，访客网络隔离等情况可能使其失败。

## 统一口径

- 三个规模为所有用户合计的每月 100、1,000、10,000 个公网通话小时；一部手机与一台桌面通话一小时算一个通话小时，不是两小时。月时长不能直接代表峰值并发。
- DO 主模型：20 ms/帧、每个方向持续 50 帧/秒、双向均不停止发送。输入走当前 command，输出走当前 event；正常 ACK，无重连或缓存溢出。
- 用 24 kHz、16-bit、单声道 PCM 估算流量。这是规划假设，不能据此断言 Codex 实际音频格式或输出节拍。静音抑制、交替说话及实际分块会改变用量。
- 按 Workers Paid、套餐额度全部可用于该业务、一个活跃通话对应一个房间 DO 估算。所有金额为美元；CF 表计入账户每月 $5 基础费。已经付费的账户不应再次为语音支付这笔基础费，已有业务会占用共享额度。
- DO duration 保守按通话全时长计入，即每小时 3,600 × 0.128 = 460.8 GB-s。实际 Hibernation 生效时可能显著更低；不是对实际活跃时间的预测。
- 不含模型/账号费用、桌面设备、税费、原有聊天/文件业务和运维人力。CF 数字忽略少量建连、清理、控制消息与读取；临近计费边界时这些也会影响取整。

## CF Durable Objects：当前实现与优化后

[Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)列明 Paid 最低 $5/月，Workers 流量和带宽不另收费，WebSocket 升级计请求，后续帧不逐帧计 Worker 请求。

[DO 定价](https://developers.cloudflare.com/durable-objects/platform/pricing/)的相关费率如下。仓库 [wrangler.toml](../../apps/relay/wrangler.toml) 使用 SQLite-backed DO，应采用 SQLite 费率。

| 计量项 | Paid 月额度 | 超额费率 |
| --- | ---: | ---: |
| DO 请求 | 100 万 | $0.15 / 100 万 |
| 活跃 duration | 400,000 GB-s | $12.50 / 100 万 GB-s |
| SQLite 写入行 | 5,000 万 | $1 / 100 万行 |

入站 WebSocket 消息按 20:1 折算请求，出站消息不收消息请求费。每次 `setAlarm()` 算一行写入，SQLite 后端的 `put()` 同样计行。预算遵循文档对超额计量单位向上取整的说明；满足休眠条件的空闲期间不计 duration。

### 为什么现有事件通道贵

[RelaySession](../../apps/relay/src/relay-session.ts) 的 `webSocketMessage()` 对每条字符串消息调用 `touchIdleTimer()`，最终调用 `storage.setAlarm()`；下行 `event` 的 `enqueue()` 还写入 seq。[SeqAckTracker](../../packages/relay-client/src/ack.ts) 正常连续接收时每 10 个事件发送 ACK。

20 ms 主模型每小时的操作为：

| 项目 | 数量 |
| --- | ---: |
| 手机输入帧 | 180,000 |
| 桌面输出帧 | 180,000 |
| 手机 ACK | 18,000 |
| setAlarm 写入 | 378,000 |
| seq 写入 | 180,000 |
| 总写入行 | **558,000** |
| 折算 DO 请求 | 18,900 |

这不是把音频保存进数据库，而是每一帧带来元数据写入。只删除 event 缓存而保留逐帧 alarm，仍会留下约 360,000 行/小时的写入。

优化模型使用独立音频通道，无逐帧 seq 持久化、ACK 或重放；清理状态按每分钟一次写入预留，即 60 行/小时。对应 18,000 个计费请求/小时。只缩小音频字节、而不减少帧数或写入操作，不能解决当前主要费用。

### 月度成本

下面小数是公式计算值，便于复核，不表示实际账单可精确预测到美分。duration 按上述保守口径计算。

| 月公网通话小时 | 当前事件路径，20 ms | 专用音频 DO，20 ms | 当前事件路径，40 ms | 专用音频 DO，40 ms |
| ---: | ---: | ---: | ---: | ---: |
| 100 | $11.15 | $5.15 | $5.00 | $5.00 |
| 1,000 | $528.20 | $20.05 | $247.85 | $18.70 |
| 10,000 | $5,625.70 | $94.35 | $2,821.60 | $80.85 |

以 1,000 小时、20 ms 为例：当前路径为 $5 基础费 + $508 写入 + $2.70 请求 + $12.50 duration；优化后为 $5 + $0 + $2.55 + $12.50。省下来的主要是逐帧写入。

按线性超额单价摊算、暂不计额度和取整，当前路径约 $0.567/小时，专用通道约 $0.00852/小时。这两个值适合判断规模增长的方向，不能直接乘小时数替代月账单。

若优化后实际计费活跃时间只有通话的 10%，20 ms 三档会降为约 $5.15、$7.55、$44.35/月；这是敏感性分析，实际比例需要测量。原有共享房间的活跃时间也可能已被聊天占用，实际增量应从账户基线计算。

复算公式，H 为公网通话小时，F 为每方向每秒音频帧数，A 为计费活跃时长比例：

```text
currentIncomingMessages = H × 3600 × (2F + F/10)
currentWrites = H × 3600 × (3F + F/10)
optimizedIncomingMessages = H × 3600 × 2F
optimizedWrites = H × 60
requests = incomingMessages / 20
durationGBs = H × 3600 × 0.128 × A

overage(x, quota, unit, rate) = ceil(max(0, x - quota) / unit) × rate
monthlyUSD = 5
  + overage(requests, 1_000_000, 1_000_000, 0.15)
  + overage(durationGBs, 400_000, 1_000_000, 12.50)
  + overage(writes, 50_000_000, 1_000_000, 1.00)
```

## 其他服务

### Cloudflare Realtime TURN：优先验证的长期媒体方案

手机和桌面建立 WebRTC 连接，优先局域网或公网 P2P，必要时 TURN 中继。桌面仍持有 OpenAI 连接，并在本机完成 WebRTC 媒体与 Codex 音频协议的桥接。手机的原生 Opus 编解码、回声消除和播放缓冲属于音频输入输出。

[Realtime 定价](https://developers.cloudflare.com/realtime/sfu/pricing/)：SFU 与 TURN 合计每月前 1,000 GB 免费，之后 $0.05/GB，两者共用一个额度。[TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/)明确计量 CF 到 TURN 客户端的出站字节，包含 TURN 开销；到 peer 的那条路径不另算。计量不能把所有入口出口重复相加。

流量模型：每个方向 Opus 32 kbps，则双向纯音频为 0.0288 GB/小时。为封包、加密和控制预留开销，用 **0.05–0.08 GB/小时**做工程预算区间，尚待实测。为了统一对比，按所有公网通话都需要中继、两个方向均计入客户端出站估算。

| 月公网通话小时 | 预计中继计量流量 | TURN 媒体费用，额度未占用 |
| ---: | ---: | ---: |
| 100 | 5–8 GB | $0 |
| 1,000 | 50–80 GB | $0 |
| 10,000 | 500–800 GB | $0 |

免费额度已用完时，对应媒体费为 $0.25–0.40、$2.50–4.00、$25–40/月。信令仍有少量现有 Relay 用量，不能把整套系统称为完全免费。P2P 成功会进一步减少 TURN 流量。

这个差异包含了采用 Opus 的收益，不能全部归因于换供应商。如果仍以未压缩 PCM 通过 WebRTC data channel 发送，每小时仅 payload 就约 0.3456 GB；10,000 小时为 3,456 GB，扣除 1,000 GB 后为 $122.80，尚未计开销。

TURN 不是现有 PCM WebSocket 的直接替换地址，两个端点都需要 WebRTC，桌面需要媒体轨道与 Codex 分块之间的桥接。CF 官方说明其 TURN 不运行在中国大陆网络，国内客户端会连接境外节点；国内公网体验必须用实际运营商网络验证。同一 Wi-Fi 的本地媒体路径不受该中继路径影响。[TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/)

### LiveKit Cloud：提供完整媒体平台，当前场景未必值得

这里只使用媒体传输，不把 Agent、模型或推理迁入 LiveKit。手机与桌面作为两个 WebRTC 参与者连接，每通话小时对应 120 个参与者分钟。

[官方定价](https://livekit.com/pricing)：Ship 为 $50/月，含 150,000 参与者分钟及 250 GB 下行，超出分别 $0.0005/分钟和 $0.12/GB；Scale 为 $500/月，含 150 万分钟和 3 TB。按前面的 Opus 预算，三档选择合适套餐后约为 **$50、$50、$500/月**；10,000 小时继续使用 Ship 则约 $605–641，比 Scale 更贵。

适合需要房间、多人音视频和平台能力的产品。单纯手机与自己桌面一对一，多出平台依赖和参与者时长费。[计量文档](https://docs.livekit.io/deploy/admin/billing/)还规定单项流量按 0.01 GB 取整，短会话很多时需用真实会话分布复算。

### 自建 coturn：机器费低，但需要自己运维

[coturn](https://github.com/coturn/coturn) 是可自建 TURN 服务。[DigitalOcean 基础 Droplet](https://www.digitalocean.com/pricing/droplets)的一个样例是 $6/月、1 vCPU、1 GiB 内存、1,000 GiB 月传输额度。

按上述 Opus 预算，三个档位从流量额度看都可放进这台机器的额度，基础租金均为 $6/月。但这不是容量保证：要另外验证峰值连接数、pps、CPU、地域路径，并承担鉴权、限额、监控、升级和故障恢复。至少双节点会把基础租金翻倍。选择其他区域或厂商时需重新核实流量口径及网络表现。

## 建议

1. 同一 Wi-Fi 下优先手机与桌面直接传媒体，保留桌面托管全部 Codex 职责。
2. 先验证桌面 Codex 音频收发与桥接；公网媒体同时评估 WebRTC + CF TURN。对这一对一拓扑，无需先引入 SFU。
3. 若首版时间优先，可用专用无逐帧持久化的 DO WebSocket 打通；这已经足够便宜。普通 event 路径不应承担音频。
4. 选型依据应包含真机的录音到播放 p50/p95 延迟、插话停止时间、丢包下卡顿、手机耗电及真实计量。缺乏实测时，不根据价格承诺公网通话质量。

相关：[Codex 移动语音集成研究](mobile-codex-realtime.md)。
