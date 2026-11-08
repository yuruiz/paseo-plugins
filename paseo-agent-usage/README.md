# paseo-agent-usage

Paseo plugin: token usage statistics for coding agents, computed from their local session logs, with optional SSH collection from remote machines.

- Sidebar footer shows only three spaced groups on one line, such as `1.2M 24h`, `8.4M 7d`, and `32M 30d`, with prominent values and muted time labels across Paseo hosts; the row highlights on hover or press, and clicking opens the dashboard
- The dashboard header shows a dismissible open-source co-creation banner with direct GitHub issue and pull-request links; dismissing it hides the banner permanently, while Settings keeps both links
- Dashboard with six preset pages: Overview, Composition, Efficiency, Rhythm, Sessions, Compare
- Every chart is a card: move up/down, switch full/half width, hide or remove; the layout is saved per page
- Card titles carry a circled question mark: hover or tap it for the chart description; the custom-range calendar stays collapsed behind "Edit dates"
- Custom pages: create a blank page or duplicate the current one, rename, reorder, hide or delete; a searchable chart catalog and page manager are built in (custom pages live in the aggregate view; the agent view reuses the preset pages)
- Overview: usage pulse, token-type stack / requests / cost / forecast trend, period comparison, outlier days, agent share, host comparison
- Composition: token mix, model/project ranking with concentration, agent × model and project × agent heatmaps, share map
- Efficiency: cache hit and cache read/write, tokens per request, input/output structure, model efficiency map, cost trend/efficiency, cumulative usage
- Rhythm: year calendar, weekday × hour punchcard, 24-hour profile, weekday profile, activity streak, hour × agent heatmap
- Sessions: duration/token scatter, distribution histograms, top sessions, swimlane, request-size histogram, recent pace, paginated session list and request log
- Compare: agent radar, monthly budget burn with month-end projection, data coverage and host sync state
- Cost cards only count agents that report cost (Claude/Codex may report zero); the optional monthly budget is set in Settings → General
- Kept from the previous version: device selector (all Paseo hosts / each Paseo host / selected host + SSH / local / each SSH remote), agent selector (overview + Claude Code / Codex / OpenCode / Pi), ranges (last 24 hours / today / 7 days / 30 days / 12 weeks / 12 months / custom), and an independent trend granularity (hour / day / week / month)
- Sessions are grouped by session ID; one agent shows the latest 200 sessions, the request log keeps about 400 calls per agent and reports up to 120; both paginate 20 rows
- SSH: collect usage from other machines using the system ssh command; hosts are managed in the usage screen or Paseo Settings
- Settings: English / Chinese UI, auto-refresh interval, local device label, default range and granularity, optional monthly budget in USD
- Update check: a banner appears when the registry listing has a newer version (reads only public registry data; no user data is sent)

## Multiple Paseo hosts

Install this version on each host and connect those hosts in the same Paseo client. Loaded installations participate automatically, without additional SSH addresses or credentials. The dashboard defaults to **All Paseo hosts**; choose an individual Paseo host or **Selected host + SSH** for the existing view. The footer always shows all Paseo hosts, independently of the dashboard device filter.

- Each host contributes only its local usage, excluding its SSH projections to prevent recursive or duplicate aggregation. Alternate installations or connections sharing one data directory count once. Independent machines with copies of the same logs still count separately; do not copy the data directory's `source-id` to another machine.
- 24h covers the current hourly bucket and the preceding 23; 7d and 30d cover 7 / 30 calendar days including today in the client's time zone. Totals add input, output, cache reads and cache writes; reasoning is not counted again. Host hours travel as UTC before conversion to client time. Existing local-hour caches cannot recover ambiguity from repeated daylight-saving hours.
- Snapshots refresh about every 30 seconds, or every 2.5 seconds during scanning. Refresh requests a scan on every host. Failed or offline sources retain their last successful snapshot within the current connection lifecycle, with a partial-data warning and available-host count. Sources without a snapshot are excluded. Offline snapshots are not guaranteed after app restart, plugin removal or connection replacement. Disconnected hosts whose upgraded plugin has not loaded are outside the aggregate.
- Aggregation runs in client memory, without writing one host's data to another or adding an external service. Snapshots use each installation's existing authenticated Paseo connection and contain hourly usage, model/project labels, session IDs, timestamps and numeric statistics. They omit session titles, prompts, code, raw logs and credentials. Charts and percentiles are recomputed after merging.

## Development

- `npm run check` (typecheck + layout/report/preferences/fleet assertions + React multi-host runtime tests)
- `npm run build:collector` regenerates `server/remote/collector.bundle.js` and `server/remote/collector.script.ts` from the sources in `server/`.

## Structure

- `index.client.tsx` / `index.server.ts`: plugin entries
- `client/`: sidebar row, dashboard shell and pages, ledger charts, settings
- `server/scan/`: local log adapters (Claude Code, Codex, OpenCode, Pi)
- `server/remote/`: SSH collection and the bundled remote collector
- `shared/report.ts`: shared usage aggregation, period/calendar/session/matrix derivations
- `server/service.ts`: scanning service, cache and RPC handlers

---

## 中文

Paseo 插件：基于各编码 Agent 本地会话日志统计 token 用量，支持通过 SSH 采集远端机器数据。

- 侧边栏底部仅用一行显示 三组留有间距的数据，例如 `1.2M 24h`、`8.4M 7d`、`32M 30d`，数字突出、时间标签弱化，汇总所有 Paseo 主机，悬停或按下时高亮，点击打开看板
- 看板顶部展示可关闭的开源共创横幅，可直接前往 GitHub 提 Issue 或提 PR；关闭后永久隐藏，配置页仍保留反馈入口
- 看板包含 6 个预设页：总览、构成、效率、节奏、会话、对比
- 每张图表都是卡片：可上移/下移、切换整行/半宽、隐藏或移除；布局按页面保存
- 卡片标题右侧有圆圈问号：悬浮或点按查看图表说明；自定义范围的日期选择器默认收起，点“编辑日期”展开
- 自定义页面：新建空白页或复制当前页，支持改名、排序、隐藏、删除；内置页面管理与可搜索的图表目录（自定义页只在聚合视图生效，Agent 视图复用预设页）
- 总览：用量脉搏、Token 类型堆叠 / 请求 / 成本 / 预测趋势、周期对比、异常日、Agent 份额、主机对比
- 构成：Token 构成、模型/项目排行与集中度、Agent × 模型、项目 × Agent、矩形占比
- 效率：缓存命中率、缓存读写、请求均量、输入输出结构、模型效率象限、成本趋势/效率、累计曲线
- 节奏：年历热力图、星期 × 小时打卡、24 小时画像、星期画像、活跃度与连续天数、时段 × Agent
- 会话：会话散点、时长/Token 分布、Top 会话、会话泳道、请求大小、近期速率、分页会话明细与请求日志
- 对比：Agent 雷达、月度预算燃烧率与月末预测、数据覆盖与主机同步状态
- 成本卡只统计有上报的 Agent（Claude/Codex 可能为 0）；可选月度预算在「配置 → 通用」中设置
- 保留原有能力：设备选择器（所有 Paseo 主机 / 单台 Paseo 主机 / 当前主机 + SSH / 本机 / 各 SSH 远端）、Agent 选择器（总览 + Claude Code / Codex / OpenCode / Pi）、时间范围（近 24 小时 / 今日 / 近 7 天 / 近 30 天 / 近 12 周 / 近 12 月 / 自定义）、独立的趋势粒度（小时 / 日 / 周 / 月）
- 会话按会话 ID 聚合；单个 Agent 展示最近 200 个会话，请求日志底层每个 Agent 保留约 400 条、报告最多展示 120 条；两者每页 20 条
- SSH：用系统 ssh 命令从其他机器采集用量；主机在用量页或 Paseo 设置中管理
- 设置：中英文界面、自动刷新间隔、本机标签、默认时间范围与粒度、可选月度预算（USD）
- 更新检查：registry 上有新版本时显示横幅（仅读取公开 registry 数据，不发送用户数据）

## 多个 Paseo 主机

在每台主机安装此版本，并在同一 Paseo 客户端连接这些主机。插件会自动汇总已加载的安装实例，无需填写 SSH 地址或新增凭据。用量页默认选择「所有 Paseo 主机」，可切换单台 Paseo 主机，或「当前主机 + SSH」查看原有统计。footer 始终显示所有 Paseo 主机的总量，不跟随看板的设备筛选。

- 每台主机只提供本机用量，不包含它通过 SSH 采集的数据，避免递归或重复汇总。同一数据目录的多个安装实例或连接只计一次；如果两台独立机器复制了同一批日志，其用量仍分别计算。不要把数据目录中的 `source-id` 复制给另一台机器。
- 24h 为当前小时及之前 23 个小时桶；7d 和 30d 分别为客户端时区内包含今天的 7 / 30 个自然日。Token 总量为输入、输出、缓存读取、缓存写入之和，reasoning 不重复计入。跨时区数据先转换为 UTC 再按客户端时区汇总；旧扫描缓存按当地小时存储，夏令时重复小时的原始歧义无法恢复。
- 快照约每 30 秒读取一次，扫描时约每 2.5 秒读取一次；「刷新」会请求各主机重新扫描。掉线或请求失败时保留当前连接生命周期内最后成功读取的快照，并标明「部分数据」及可用主机数；从未读到数据的主机不计入。应用重启、移除插件或切换连接后，离线快照不保证保留。未连接或未加载此版本插件的主机不在汇总范围内。
- 汇总发生在客户端内存，不把某台主机的数据写入另一台主机，也不增加外部服务。快照沿各安装实例已有的 Paseo 认证连接传输，包含小时用量、模型/项目标签、会话 ID、时间与数值统计，不包含会话标题、prompt、代码、原始日志或凭据。图表及百分位值在合并后重新计算。

## 开发

- `npm run check`（typecheck + 布局/报告/偏好/多主机断言 + React 多主机运行时测试）
- `npm run build:collector`：由 `server/` 源码重新生成 `server/remote/collector.bundle.js` 与 `server/remote/collector.script.ts`

## 目录结构

- `index.client.tsx` / `index.server.ts`：插件入口
- `client/`：侧边栏行、仪表盘壳与页面、账本式图表、设置
- `server/scan/`：本机日志适配器（Claude Code、Codex、OpenCode、Pi）
- `server/remote/`：SSH 采集与打包好的远端 collector
- `shared/report.ts`：客户端与服务端共用的用量聚合、周期/日历/会话/矩阵派生
- `server/service.ts`：扫描服务、缓存与 RPC 处理器
