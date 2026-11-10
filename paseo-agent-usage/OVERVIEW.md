# Agent Usage

在 Paseo 中查看各编码 Agent 的本地用量统计。本版本在 `yuruiz/paseo-plugins` 仓库的 `paseo-agent-usage/` 目录维护。

数据源（在 daemon 所在机器本地读取；远端机器数据经 SSH 采集，见下文）：

- Claude Code：`~/.claude/projects`（含 subagents）
- Codex：`~/.codex/sessions` 与 `~/.codex/archived_sessions`
- OpenCode：`~/.local/share/opencode/opencode.db`（通过 node:sqlite 只读；reasoning token 计入输出，与计费口径一致）
- Pi：`~/.pi/agent/sessions`（含 forks 与子会话目录；跨文件按消息去重，fork 复制段不重复计）

界面：侧边栏底部仅用一行显示 三组留有间距的数据，例如 `1.2M 24h`、`8.4M 7d`、`32M 30d`，数字突出、时间标签弱化，手机与桌面统一使用 K/M/B/T 缩写，汇总所有 Paseo 主机，不显示标题、图标或状态行；悬停或按下时高亮，点击打开全屏看板。看板包含 6 个预设页（总览、构成、效率、节奏、会话、对比），也支持自定义页面（空白新建或复制当前页，改名、排序、隐藏、删除；自定义页只在聚合视图生效，Agent 视图复用预设页）。每张图表都是卡片，可上移/下移、整行/半宽、隐藏或移除，布局按页面保存在本机偏好里。

- 看板顶部展示可关闭的「开源共创」横幅，可直接前往 GitHub 提 Issue 或提 PR；关闭状态会持久化并永久隐藏该横幅，配置页仍保留按问题、功能需求和 Agent 接入分类的 Issue 模板入口
- 顶部用紧凑工具栏提供设备选择（所有 Paseo 主机 / 单台 Paseo 主机 / 当前主机 + SSH / 本机 / 各 SSH 远端）、Agent 选择（总览 + Claude Code / Codex / OpenCode / Pi）、时间范围与粒度；页面内的页签和卡片负责分析内容
- 总览：用量脉搏、趋势（全部/非缓存 Token 堆叠、请求、成本、7 日预测）、周期对比、异常日、Agent 份额、主机对比
- 构成：Token 构成、模型/项目排行与集中度、Agent × 模型、项目 × Agent、矩形占比
- 效率：缓存命中率、缓存读写、请求均量、输入输出结构、模型效率象限、成本趋势/效率、累计曲线
- 节奏：年历热力图、星期 × 小时打卡、24 小时画像、星期画像、活跃度与连续天数、时段 × Agent
- 会话：会话散点、时长/Token 分布、Top 会话、会话泳道、请求大小、近期速率、分页会话明细与请求日志
- 对比：Agent 雷达、月度预算燃烧率与月末预测、数据覆盖与主机同步状态
- 图表交互：点按图表查看当期明细；卡片标题旁的圆圈问号可悬浮/点按查看说明；列表默认 Top 5/6，可展开；成本卡只统计有上报的 Agent；自定义范围的日期选择器默认收起，点“编辑日期”展开
- 会话明细按会话 ID 聚合，单个 Agent 展示最近 200 个；请求日志底层每个 Agent 保留约 400 条、报告最多展示 120 条；两者每页 20 条

刷新机制：首次扫描全量历史日志（本机约 30 秒，其间页面显示扫描进度），之后按文件增量刷新（约 1~2 秒）；Agent 回合结束后会自动触发防抖增量刷新。插件升级后（v0.3.0 起统计数据按小时与会话缓存）会有一次全量重扫。会话索引最多保留 8000 个最近会话（超出按会话末次活动时间淘汰）。

配置（用量页右上角「配置」或 Paseo 设置 → 插件）：

- **通用**：界面语言（跟随系统 / 中文 / English，自动检测系统语言）与**定时刷新**（关闭 / 5 分钟 / 15 分钟 / **30 分钟（默认）** / 1 小时 / 6 小时 / 24 小时；定时自动扫描本地日志并同步远端主机）；还可自定义**本机标签**（设备选择器与请求日志里默认「本机」的显示名称，留空恢复默认，仅保存于本机偏好文件），以及**默认时间范围与趋势粒度**（打开用量页时的初始范围/粒度，如「当日 + 小时」「近 7 天 + 月」等，未设置时为近 7 天 + 日）；还可设置**月度预算（USD，可选）**，用于预算卡的燃烧率与月末预测
- **Agent 开关**：关闭的 Agent 不展示、不拉取
- **远端主机（SSH）**：增删改与测试连接

## 多个 Paseo 主机

在每台主机安装此版本，并在同一 Paseo 客户端连接这些主机。插件会自动汇总已加载的安装实例，无需填写 SSH 地址或新增凭据。用量页默认选择「所有 Paseo 主机」，可切换单台 Paseo 主机，或「当前主机 + SSH」查看原有统计。footer 始终显示所有 Paseo 主机的总量，不跟随看板的设备筛选。

- 每台主机只提供本机用量，不包含它通过 SSH 采集的数据，避免递归或重复汇总。同一数据目录的多个安装实例或连接只计一次；如果两台独立机器复制了同一批日志，其用量仍分别计算。不要把数据目录中的 `source-id` 复制给另一台机器。
- 24h 为当前小时及之前 23 个小时桶；7d 和 30d 分别为客户端时区内包含今天的 7 / 30 个自然日。Token 总量为输入、输出、缓存读取、缓存写入之和，reasoning 不重复计入。跨时区数据先转换为 UTC 再按客户端时区汇总；旧扫描缓存按当地小时存储，夏令时重复小时的原始歧义无法恢复。
- 快照约每 30 秒读取一次，扫描时约每 2.5 秒读取一次；「刷新」会请求各主机重新扫描。掉线或请求失败时保留当前连接生命周期内最后成功读取的快照，并标明「部分数据」及可用主机数；从未读到数据的主机不计入。应用重启、移除插件或切换连接后，离线快照不保证保留。未连接或未加载此版本插件的主机不在汇总范围内。
- 汇总发生在客户端内存，不把某台主机的数据写入另一台主机，也不增加外部服务。快照沿各安装实例已有的 Paseo 认证连接传输，包含小时用量、模型/项目标签、会话 ID、时间与数值统计，不包含会话标题、prompt、代码、原始日志或凭据。图表及百分位值在合并后重新计算。

## 远端统计（SSH）

可以把其他机器上的用量一起统计进来。两种配置方式：

1. **可视化配置（推荐）**：用量页右上角「配置」入口，或 **Paseo 设置 → 插件 → Agent Usage**，在其中增删改 SSH 主机、测试连接；保存后新主机/变更主机会自动拉取
2. 手动编辑插件数据目录的 `hosts.json`（`~/.paseo/plugin-data/agent-usage-plugin/hosts.json`）：

```json
[
  { "name": "dev1", "target": "dev1" },
  { "name": "srv2", "target": "user@example.com", "passwordCommand": "security find-generic-password -s agent-usage-ssh-srv2 -w" }
]
```

- `target`：`~/.ssh/config` 别名或 `user@host`；认证默认走 SSH 密钥，也支持账号密码：`password` 字段（明文，注意文件权限）或更安全的 `passwordCommand`（从钥匙串/密码管理器取密码）
- 可选字段：`port`、`identityFile`、`nodePath`（远端 node 路径）、`cacheDir`（远端增量缓存目录）、`timeoutMs`、`enabled`
- 远端要求：无需安装任何额外软件，插件自动探测 JS 运行时（PATH / nvm / volta / fnm / asdf / homebrew 等常见位置，并尝试加载 `~/.nvm/nvm.sh`）；探测不到时才需要填 `nodePath`。SQLite 源需 Node ≥ 22.5，否则自动跳过；首次拉取为全量，之后增量
- 安全：插件不读取/解密任何远端凭据；远端只读日志，仅写一个小增量缓存（`~/.cache/agent-usage-plugin`）
- 界面：顶部「设备」选择器可切换聚合 / 单机视图（选择器下方会显示各机器的同步状态）；单 Agent 请求日志带设备来源标签

## 数据与权限

- 读取：本机（及各远端主机）的本地会话日志
- 写入：daemon 所在机器的插件数据目录（扫描状态、主机配置与稳定来源 ID）；远端仅写增量缓存
- 网络：跨主机快照使用已有的 Paseo 认证连接（见上文）；额外的 HTTP 访问为版本更新检查（每小时最多一次，仅读取合集仓库 main 分支的提交信息和该提交中本插件的 package.json，来自 raw.githubusercontent.com、api.github.com，不发送任何数据）；SSH 采集通过系统 ssh 命令连接你配置的主机
- 不读取、不保存、不发送任何登录凭据；不发送 prompts、代码或日志内容到任何服务
- 支持 macOS 与 Linux；需要 Paseo 0.13.0-beta.1 或更高版本

---

# Agent Usage (English)

View local usage statistics for coding agents inside Paseo. This version is maintained in `paseo-agent-usage/` in the `yuruiz/paseo-plugins` collection.

Data sources (read locally on the daemon host; remote machines are collected over SSH, see below):

- Claude Code: `~/.claude/projects` (including subagents)
- Codex: `~/.codex/sessions` and `~/.codex/archived_sessions`
- OpenCode: `~/.local/share/opencode/opencode.db` (read-only via node:sqlite; reasoning tokens count as output, matching the billing basis)
- Pi: `~/.pi/agent/sessions` (including forks and sub-session directories; messages are deduplicated across files, so copied fork segments are not counted twice)

Interface: the footer shows only three spaced groups on one line, such as `1.2M 24h`, `8.4M 7d`, and `32M 30d`, with prominent values and muted time labels (K/M/B/T abbreviations are consistent on desktop and mobile) across Paseo hosts, without a title, icon or status row; the row highlights on hover or press, and clicking it opens a full-screen dashboard. The dashboard has six preset pages (Overview, Composition, Efficiency, Rhythm, Sessions, Compare) and supports custom pages (create blank or duplicate the current page, rename, reorder, hide, delete; custom pages live in the aggregate view, while the agent view reuses the preset pages). Every chart is a card that can move up/down, switch full/half width, hide or be removed; layouts are saved per page in local preferences.

- The dashboard header shows a dismissible open-source co-creation banner with direct GitHub issue and pull-request links; dismissal is persisted and hides the banner permanently, while Settings keeps the issue-template entries for bugs, feature requests, and new agents
- Device selector (all Paseo hosts / each Paseo host / selected host + SSH / local / each SSH remote), agent selector (overview + Claude Code / Codex / OpenCode / Pi), range and granularity stay in a compact toolbar; page tabs and cards hold the analysis
- Overview: usage pulse, token-type stack / requests / cost / 7-day forecast trend, period comparison, outlier days, agent share, host comparison
- Composition: token mix, model/project ranking with concentration, agent × model and project × agent heatmaps, share map
- Efficiency: cache hit and cache read/write, tokens per request, input/output structure, model efficiency map, cost trend/efficiency, cumulative usage
- Rhythm: year calendar, weekday × hour punchcard, 24-hour profile, weekday profile, activity streak, hour × agent heatmap
- Sessions: duration/token scatter, distribution histograms, top sessions, swimlane, request-size histogram, recent pace, paginated session list and request log
- Compare: agent radar, monthly budget burn with month-end projection, data coverage and host sync state
- Chart interaction: tap a chart for that period's detail; the circled question mark next to each card title shows its description on hover or tap; lists show top 5/6 with expand; cost cards only count agents that report cost; the custom-range calendar is collapsed behind "Edit dates"
- Sessions are grouped by session ID; one agent shows the latest 200 sessions, the request log keeps about 400 calls per agent and reports up to 120; both paginate 20 rows

Refresh: the first scan reads the full history (about 30 seconds locally, with progress shown on the page), after which files refresh incrementally (about 1-2 seconds); a debounced incremental refresh triggers automatically when an agent turn ends. After a plugin upgrade (from v0.3.0, statistics are cached per hour and per session) one full rescan runs. The session index keeps at most the 8,000 most recent sessions (older ones are evicted by last activity time).

Settings (the "Settings" entry at the top right of the usage page, or Paseo Settings → Plugins):

- **General**: interface language (follow system / Chinese / English, auto-detected) and **auto refresh** (off / 5 min / 15 min / **30 min (default)** / 1 hour / 6 hours / 24 hours; periodically scans local logs and syncs remote hosts); you can also set a custom **local device label** (the display name used instead of the default "本机 / Local" in the device selector and request log; leave empty to restore the default, stored only in the local preference file), and a **default range and trend granularity** (the initial range/granularity when the usage page opens, such as "today + hour" or "last 7 days + month"; unset means last 7 days + day); an optional **monthly budget (USD)** drives the budget card burn rate and month-end projection
- **Agent toggles**: disabled agents are neither shown nor fetched
- **Remote hosts (SSH)**: add, edit, delete, and test connections

## Multiple Paseo hosts

Install this version on each host and connect those hosts in the same Paseo client. Loaded installations participate automatically, without additional SSH addresses or credentials. The dashboard defaults to **All Paseo hosts**; choose an individual Paseo host or **Selected host + SSH** for the existing view. The footer always shows all Paseo hosts, independently of the dashboard device filter.

- Each host contributes only its local usage, excluding its SSH projections to prevent recursive or duplicate aggregation. Alternate installations or connections sharing one data directory count once. Independent machines with copies of the same logs still count separately; do not copy the data directory's `source-id` to another machine.
- 24h covers the current hourly bucket and the preceding 23; 7d and 30d cover 7 / 30 calendar days including today in the client's time zone. Totals add input, output, cache reads and cache writes; reasoning is not counted again. Host hours travel as UTC before conversion to client time. Existing local-hour caches cannot recover ambiguity from repeated daylight-saving hours.
- Snapshots refresh about every 30 seconds, or every 2.5 seconds during scanning. Refresh requests a scan on every host. Failed or offline sources retain their last successful snapshot within the current connection lifecycle, with a partial-data warning and available-host count. Sources without a snapshot are excluded. Offline snapshots are not guaranteed after app restart, plugin removal or connection replacement. Disconnected hosts whose upgraded plugin has not loaded are outside the aggregate.
- Aggregation runs in client memory, without writing one host's data to another or adding an external service. Snapshots use each installation's existing authenticated Paseo connection and contain hourly usage, model/project labels, session IDs, timestamps and numeric statistics. They omit session titles, prompts, code, raw logs and credentials. Charts and percentiles are recomputed after merging.

## Remote statistics (SSH)

Usage from other machines can be counted in as well. Two ways to configure it:

1. **Visual configuration (recommended)**: the "Settings" entry at the top right of the usage page, or **Paseo Settings → Plugins → Agent Usage**, to add, edit, delete SSH hosts and test connections; new or changed hosts are fetched automatically after saving
2. Edit `hosts.json` in the plugin data directory manually (`~/.paseo/plugin-data/agent-usage-plugin/hosts.json`):

```json
[
  { "name": "dev1", "target": "dev1" },
  { "name": "srv2", "target": "user@example.com", "passwordCommand": "security find-generic-password -s agent-usage-ssh-srv2 -w" }
]
```

- `target`: an alias from `~/.ssh/config` or `user@host`; authentication uses SSH keys by default, and account passwords are also supported via the `password` field (plaintext, mind file permissions) or the safer `passwordCommand` (fetches the password from the keychain or a password manager)
- Optional fields: `port`, `identityFile`, `nodePath` (remote node path), `cacheDir` (remote incremental cache directory), `timeoutMs`, `enabled`
- Remote requirements: no extra software to install; the plugin auto-detects a JS runtime (common locations under PATH / nvm / volta / fnm / asdf / homebrew, and tries to load `~/.nvm/nvm.sh`); fill `nodePath` only when detection fails. The SQLite source needs Node >= 22.5, otherwise it is skipped; the first fetch is full, later ones incremental
- Security: the plugin never reads or decrypts any remote credentials; remote logs are read-only and only a small incremental cache is written (`~/.cache/agent-usage-plugin`)
- Interface: the "Device" selector at the top switches between aggregate and single-machine views (sync status per machine appears below the selector); request log rows for a single agent carry a device source label

## Data and permissions

- Reads: local session logs on this machine (and on each remote host)
- Writes: the plugin data directory on the daemon host (scan state, host configuration and stable source identity); on remotes only the incremental cache
- Network: cross-host snapshots use the existing authenticated Paseo connections described above; additional HTTP access is the update check (at most once an hour, reading only the collection main revision and this plugin's package.json at that revision from raw.githubusercontent.com and api.github.com, sending no data); SSH collection connects to your configured hosts through the system ssh command
- No login credentials are read, stored, or sent; no prompts, code, or log content is sent to any service
- Supports macOS and Linux; requires Paseo 0.13.0-beta.1 or later
