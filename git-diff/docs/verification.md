# 验证记录

验证日期：2026-11-06。本轮新增 Git 提交图与历史差异并发布 v0.3.0，以下同时保留既有界面、设置与 v0.2.0 发布验证记录。

## v0.3.0 发布验证

版本号、锁文件、设置页版本元数据与安装命令统一为 v0.3.0。`npm run check` 的版本一致性、TypeScript、Biome 和 78 项测试通过；SDK 0.12.0 / 0.13.0 / 0.14.0 / 0.15.0 兼容检查通过。

分发包包含全部新增历史读取、提交图、详情、视图切换模块，以及双语介绍和实际界面截图 `assets/git-history.png`；测试仓库与本机验收产物不打包。发布继续使用 Git 标签与 GitHub Release，并按 Paseo Plugins 的 Git 更新流程提交新版本审核。

## Git 提交图与历史差异

在独立临时仓库中创建 110 次提交、本地与远端分支、annotated tags、合并提交、未合并分支和配置 `ignore = all` 的子模块，使用正式服务与 React Native Web 界面验证。

- `npm run check`：严格类型、Biome、11 个测试文件共 78 项回归通过。新增 9 项真实 Git 历史测试和 4 项图模型测试，覆盖拓扑、合并 / 初始提交、分页与引用变化、分支筛选、特殊重命名路径、删除、二进制、大文件、空仓库、detached HEAD、linked worktree、子模块与浅克隆边界。
- 历史 diff 只读取提交对象：工作目录另外修改后仍显示提交中的内容；合并与第一父提交比较，初始提交与空树比较。浅克隆从原始 commit header 读取真实父提交，缺少父对象时说明无法比较，不将整个目录误作初始新增。
- 1280×820 深浅主题以及 390×600 / 390×700 窄屏检查通过。彩色分支与合并连线、HEAD、引用徽标、作者 / 日期 / SHA、独立详情页和历史 diff 可用；窄屏限制引用徽标宽度，SHA 列保持可见，无页面横向溢出。
- 浏览器确认提交选择、父提交信息、文件 diff、详情展开 / 收起、SHA 复制、搜索定位、方向键、100→110 条分页、主仓 / 子模块切换。搜索不移除图节点；初次 100 条历史仅挂载少量可见行。无头 macOS Chrome 的原生 select 选项没有可点击布局框，分支与仓库下拉通过 DOM change 事件验证。
- 切换“更改 / 提交图”保留文件标签和历史选择。实际滚动提交图后切换两次，滚动节点与 scrollTop 均保留；隐藏面板不参与键盘与辅助技术导航。后台首次打开且自动刷新暂停时仍读取首次仓库快照，之后不轮询。
- 切换入口整合到左侧标题栏图标下拉，不额外占用一行。鼠标、方向键、Home / End、Enter / Space、Esc / Tab 和点击外部关闭均验证；当前视图带勾选，切换后焦点移到可见视图入口，侧栏隐藏与窄屏 diff 页面仍能切换。关闭菜单不触发后台清空搜索，筛选值、标签、历史选择和 560px 滚动位置均保留。
- 文件筛选、提交搜索、自定义字体输入和原生 select 统一为 1px 主题聚焦边框，移除输入元素默认粗外框。1280×820 与 390×844 深浅主题实测，输入框高度保持 32px，聚焦时无布局跳动或页面横向溢出；截图与结果位于 `artifacts/git-view-dropdown-*.png`、`artifacts/git-input-focus-*.png` 和 `artifacts/view-refinement-verification.json`。
- 文件筛选与提交搜索框内 Enter / Shift+Enter 分别循环选择下一个 / 上一个匹配，保持输入焦点，窄屏保留列表或提交图。1280px 与 390px 浏览器实测单次跳转、双向首尾循环、无匹配结果及中文输入法组合输入（`isComposing` / keyCode 229）；不重复跳转或因提交事件失焦，也不打开提交详情。结果为 `artifacts/search-keyboard-verification.json`。
- 桌面提交详情顶部增加可拖动分隔线，连续向上拖动 180px 后详情同步增高 180px。验证双向拖动、上下限、方向键每次 10px、Home / 双击复原、End 最大高度，以及展开收起、关闭重开、切换视图和刷新后的比例恢复；历史 diff 中同样可调整。常规窗口保留至少 160px 详情与 128px 提交图，较矮窗口自动缩小边界。深浅主题、1280×360 矮窗口与 390px 独立详情页通过，无页面溢出；既有侧栏与左右 diff 拖动也通过回归。截图为 `artifacts/git-history-resize-*.png`，结果为 `artifacts/history-resize-verification.json`。
- 主动令历史 diff RPC 返回一次 HTTP 503，显示读取错误；点击重试后成功显示实际 Git 内容。
- SDK 0.12.0 / 0.13.0 / 0.14.0 / 0.15.0 兼容检查通过。已重载本机目录插件并确认 `running`；`verify:installed` 通过真实宿主 RPC 读取主仓首批 100 条历史、子模块 2 条历史、两仓提交详情及历史 diff。报告为本地 `artifacts/runtime.json`。
- `npm pack --dry-run --ignore-scripts`：新增运行模块均包含，测试与验收产物不打包，分发包约 2.2 MB。未新增运行依赖。

截图已逐一打开检查：`artifacts/git-history-branches-dark.png`、`artifacts/git-history-branches-light.png`、`artifacts/git-history-search.png`、`artifacts/git-history-diff-expanded.png`、`artifacts/git-history-compact-graph.png`、`artifacts/git-history-compact-details.png`、`artifacts/git-history-compact-diff.png`。历史只读取本地对象，手动刷新，不执行 fetch。原生 iOS / Android 仍未进行实机验证。

## v0.2.0 发布验证

设置底栏显示由 `package.json` 生成的版本元数据 `v0.2.0`，切换四个分类后始终可见。真实浏览器的 1440×900 桌面与 360×600 紧凑视口均已检查，保存状态、版本号和恢复默认入口位于固定底栏，无横向溢出。截图：`artifacts/release-0.2.0-settings-desktop.png`、`artifacts/release-0.2.0-settings-compact.png`；发布截图同步到 `assets/settings.png`。

Paseo 构建器不允许运行模块导入根目录 `package.json`，因此版本生成到 `shared/version.ts`。`npm version` 自动同步，`npm run check` 检查生成值与包版本一致；安装无需运行生成脚本。本机插件重载通过，实际宿主构建成功，状态为 `running`。

版本更新后重新通过 TypeScript 严格类型检查、Biome、65 项回归，以及 SDK 0.12.0 / 0.13.0 / 0.14.0 / 0.15.0 类型检查。安装示例固定到 `v0.2.0`；分发包包含版本元数据及新增运行模块。

## 代码与 Git 正确性

`npm run check` 包含 TypeScript 严格类型检查、Biome 和 11 个测试文件、78 项回归。

保留递归子模块、`ignore = all`、独立 HEAD、标准 ignore、未初始化子模块、暂存与工作目录、空仓库、重命名、特殊文件名、二进制、大文件、持续编辑、linked worktree、权限、符号链接、删除重建、冲突、空白、上下文及左右行号覆盖。

第二轮新增验证：标签追加/复用/跨仓库区分/相邻关闭；语言 token 与文本保真；旧新两侧独立多行注释、Python 多行字符串；异常长行的词法与 Markdown 降级；Markdown 结构与 HTML/URL 转义；预览资源策略；暂存区与工作目录全文分离、暂存图片字节；二进制/过大/删除状态；越界路径、未知文件与工作目录符号链接拒绝；删除文件定位最近父目录。

## 浏览器交互与视觉

使用 Tabbit 驱动正式 React Native Web 面板。普通场景使用独立临时 Git 仓库，故障/并发/大列表使用受控 RPC。未修改业务项目。

- 暗色 1440×900 多文件/语法着色：`artifacts/scm-editor-desktop.png`。
- Markdown 全文预览与代码块：`artifacts/scm-editor-markdown.png`。
- 360×800 独立统一差异页：`artifacts/scm-editor-compact.png`。
- 浅色主题与持久设置：`artifacts/scm-editor-settings.png`。
- 截图均实际打开检查，无页面横向溢出。长代码行在代码区独立滚动，设置内容独立滚动且页脚固定可用。
- 17 文件标签追加与重复复用，关闭当前标签选中邻项：通过。
- 普通滚轮使标签 scrollLeft 从 910 变为 540，保留触控板和原生横向滚动：通过。
- 全部标签关闭后不自行重开文件；侧栏方向键打开对应文件；筛选 worker.rs 后 Enter 打开匹配文件：通过。
- 隐藏侧栏后 `/` 重新显示并聚焦筛选：通过 DOM KeyboardEvent 验证；浏览器外壳会在页面收到 keydown 前拦截物理 `/`。
- 鼠标拖动 240→300px、左右键每次 10px、双击/Home 恢复默认、重载恢复拖动宽度：通过。
- 字号、换行、刷新间隔重载恢复：通过。模拟另一写入版本，设置字段合并与版本冲突重试：通过。
- 模拟设置写入 HTTP 500，保留本地改动、重试恢复、立即重载后仍保留恢复值：通过。普通设置已改为立即提交，拖动在松手时提交。
- 实际悬停 title、标签 aria-selected、开关 aria-checked、侧栏 separator 数值：通过。已处理 RN Web 会过滤 title/wheel/旧可访问属性的运行时差异。
- Markdown 标题、任务、表格、代码块、工作目录新增段落：通过；切至暂存视图后该新增段落消失，显示真实暂存内容。
- HTML 静态页面：通过；iframe sandbox 为空，内容受资源策略限制。PNG 等图片内容及暂存区字节由回归验证。
- 右键 README 显示 Finder 菜单，点击后真实 RPC 返回 `revealed: true, directory: false`：通过。未通过 shell 拼接路径。
- 深浅主题代码分别出现关键字、字符串、注释、函数、类型等颜色：通过；浅色样本 7 种颜色。

上一轮已验证列表/目录树、折叠、空白/上下文/换行/原始补丁、错误保留旧列表、补丁缓存与版本失效、乱序响应隔离、后台/暂停停止轮询、失败退避与强制手动刷新。Esc/Cmd+F 和 `/` 的保留键逻辑通过 DOM KeyboardEvent 验证；浏览器外壳会截获它们，未将原生键盘派发作为通过证据。本轮方向键、Enter 与侧栏键盘通过真实键盘操作。

导航时浏览器 Locale Switcher 扩展仍可能报告读取 `global` 的异常；上一轮已通过 CDP 定位为扩展隔离世界，并非插件主页面错误。HTTP 500 是本轮主动注入的保存失败场景。

以上覆盖桌面/Web。未在 iOS/Android 实机验证；HTML 和格式化 Markdown 预览未提供原生渲染，原生回退文本。

## 图标、字体与交互精修验收

- 73 个离线资源：40 个 vscode-icons 文件/目录图标与 33 个 Codicons 操作图标；Web SVG、原生 PNG。附完整来源与许可。
- 默认 Paseo 等宽字体栈 / 13px / 500；VS Code 字体、600 字重、14px 改动刷新后实际计算样式仍为 Menlo/Monaco/Consolas、600、14px。自定义字体输入与回退说明通过。
- 主仓标题在列表滚动 1000px 后仍位于 y=108.5；长子仓滚至内部时同样吸顶于 y=108.5。保留虚拟化与折叠。
- 侧栏真实鼠标拖动 240→300px，Home 复位；中线真实拖动 50%→60%，支持左右键每次 2%、Home 和双击复位。比例在保存后重载恢复。
- 19 个标签保持追加；普通滚轮横向滚动，固定按钮 x=1371 不受标签滚动影响，隐藏/恢复侧栏后位置仍固定。
- 左右两侧独立横向滚动，左侧滚动时右侧仍为 0；长行文本容器宽 3491px，右侧可滚至 2800px 以上。处理 RN Web 单行 Text 默认 max-width，避免长行先被省略而无法读到尾部。
- Mermaid 真实离线流程图与时序图通过；两次打开图表文件只请求引擎一次。错误图表展开源码并提示，后续有效图表仍绘制。主动模拟引擎请求 HTTP 500，点击重试后两图成功绘制。HTML iframe sandbox 仍为空，示例脚本未执行。
- 1440×900 深浅主题、360×800 紧凑页均无面板横向溢出；窄屏自动统一对比，固定返回按钮可回列表。
- 5000 文件、10000 行的受控浏览器输入：仅挂载 47 个文件按钮、4021 个代码文本字符、235 个带方向属性的代码节点。该样本下中线键盘调整正常。
- 修正 Web 拖动的指针捕获与保存队列：松手/键盘提交在已有写入完成后继续保存，待提交设置不再提前显示“自动保存”。

本轮截图已实际打开检查：`artifacts/scm-refinement-desktop.png`、`artifacts/scm-refinement-mermaid.png`、`artifacts/scm-refinement-settings.png`、`artifacts/scm-refinement-compact.png`。机器摘要：`artifacts/scm-refinement.json`。

## 设置分类验收

设计方法与控件取舍见 [设置面板设计](settings-design.md)。在正式 React Native Web 面板、临时 Git 仓库与开发设置存储中验证：

- 四个分类点击与左右键、Home/End 导航通过；选中状态、唯一 Tab 焦点入口、tabpanel 对应关系正确。仅挂载当前分类内容，切换分类不写入设置。
- 字体、字号、字重、Tab 宽度、上下文、刷新间隔下拉通过；自定义字体即时显示输入和预览，实际计算样式为 14px / 600 / Menlo。原生 select 键盘输入 `j` 后 Enter 可选择 JetBrains Mono。
- 关闭自动刷新后间隔禁用且保留 10 秒，重新开启恢复可用。
- 跨分类改动重载恢复；主动注入写入 HTTP 500，错误与重试在切换分类后仍可见，重试后 15px 字号重载保留。恢复默认统一还原各分类配置。
- 1440×900 深浅主题、360×800 与 360×600 检查通过，无抽屉横向溢出。600px 高度内容可滚动到 Tab 宽度，底部恢复按钮始终位于 y=565.5；切回分类从顶部开始。
- 继续通过严格类型、Biome、42 项回归和四个 SDK 版本检查。设置 schema 和主机存储协议未改变；原生选择浮层仅完成类型检查。

截图均已实际打开检查：`artifacts/settings-tabs-code.png`、`artifacts/settings-tabs-behavior.png`、`artifacts/settings-tabs-light.png`、`artifacts/settings-tabs-compact.png`、`artifacts/settings-tabs-short.png`。浏览器结果摘要：`artifacts/settings-tabs.json`。

## 性能

`npm run benchmark` 使用临时仓库，完成后删除。macOS arm64 / Node 22.23.4 单次运行：

| 项目                  |                结果 |
| --------------------- | ------------------: |
| 1000 文件首次 / 复扫  | 332.07ms / 186.59ms |
| 快照缓存              |              0.02ms |
| 补丁首次 / 缓存       |    10.08ms / 0.03ms |
| 10000 文件树 / 筛选   |     4.83ms / 0.85ms |
| 5000 行语法状态预处理 |             27.15ms |
| 40 行着色             |              0.37ms |

浏览器受控输入 5000 文件和 5001 补丁行，只渲染 47 个文件按钮、9619 个文本字符与 2130 个 token span，使用 6 种代码颜色。跳到第 10000 行差异块成功。真实 Git 扫描压力由 1000 文件临时仓库验证。这些数字不构成所有仓库的延迟/FPS 承诺，也未与同环境 VS Code 排名。

完整结果见本地 `artifacts/performance.json`、`artifacts/editor-upgrade.json`；旧轮记录保留于 `artifacts/ui-redesign.json`。

## 安装与真实仓库

新版执行 `paseo plugin reload git-diff-with-submodule` 后为 running。

`verify:installed` 使用 0.12.0 DaemonClient 调用已安装插件的真实 RPC。设置整理后于 23:05（北京时间）重新加载并验证，主仓 123 文件、Client 子仓 47、Web 0，三仓均 ready。有变更仓库均可读取差异与全文；host settings 为 ready，既有偏好保留，Finder 能力为 darwin/可用。Mermaid 12.3.0 离线引擎通过真实 RPC 传输 2123624 字节 base64 压缩数据，解压为 5537838 字节。报告：本地 `artifacts/runtime.json`。业务项目由其他任务持续编辑，文件数量会变化，本任务没有修改业务仓库。

首轮 `acceptance` 在 18:01:19 逐仓对照原生 Git 文件列表、读取全部 57 个变更补丁，通过。覆盖主仓及两个子仓，报告保留于本地 `artifacts/acceptance.json`。

## SDK 与打包

`check:compatibility` 对 SDK 0.12.0、0.13.0、0.14.0、0.15.0 进行类型检查；开发依赖仍为 0.12.0，manifest 保留 `>=0.12.0`。本机运行使用 daemon 0.15.0，未逐个启动旧原生客户端。

`npm pack --dry-run --ignore-scripts` 验证运行文件及新增模块会打包，测试仓库、验收截图和机器报告不包含；`assets/` 中的发布截图包含在内。运行时使用宿主模块、Node 内置模块和已生成的离线资源；无需安装外部运行时依赖。Mermaid 引擎保留在服务端，只有含图表的预览才请求，不进入客户端启动脚本。v0.2.0 分发包约 2.2MB。

与 VS Code 的剩余差距及预览边界见 [差距分析](vscode-gap-analysis.md)。

## 文件菜单、Markdown 导航与标签缓存

2026-11-05 使用 Tabbit、独立临时 Git 仓库、指定业务文档的副本验收，未修改业务项目。

- 侧栏复制相对路径后实际粘贴为 `docs/real-device-validation.md`；非当前标签复制绝对路径实际粘贴成功且不切换当前文件。相对路径包含子模块相对工作区的前缀。
- Tab 右键的关闭、关闭其他、关闭右侧、关闭左侧、关闭全部均通过；对非当前标签执行操作后保留适当的活动标签。全部关闭释放所有缓存页面，保持空状态。菜单 Home/End 焦点、Escape、禁用边缘操作与 360px 窄屏边界通过。
- `real-device-validation.md` 中链接包裹行内代码的 `remote-device-lab` 正常显示，无内部占位符。原始文档排版与 Mermaid 绘制通过。
- 未修改 Markdown、代码只读着色、编码空格文件名、跨子模块、工作区根路径、文件复用、页内与跨文件标题锚点、网页新窗口及目录 Finder 打开通过。缺失文件有明确提示。HTML sandbox 为空，示例脚本未执行。
- 默认最近 5 页 LRU 淘汰通过，10 个短文件可同时缓存，live DOM 728 节点；缩小为 2 个立即释放旧页，重新访问已淘汰页面发生读取，设置重载后仍为 2。恢复默认 5。
- Markdown 切换保留相同文档节点、700px 滚动位置，内容请求增量为 0。差异切换保留相同列表节点和 1400px 位置，请求增量为 0。缓存 DOM 顺序固定，隐藏保留几何尺寸，避免 iframe 移动重载或隐藏后滚动归零。
- 隐藏页面在工作区刷新后不重新读取；再次激活有版本变化的文件时获取最新内容。关闭页面释放缓存；隐藏页面不可聚焦、点击或被辅助技术读取。
- 10 个各 5000 行文件依次访问 2.63s；在数量设置为 10 时，估算内容预算提前淘汰至最近 5 页，切换仍无内容请求。缓存按 24 MiB 估算预算处理差异派生状态与图表成本，当前页始终保留；这个预算并非浏览器实际堆内存上限。本机单次压力样本不能代替其他设备的延迟/FPS 验证。
- 360×600 下预览返回列表再打开保留 400px 滚动位置，无页面横向溢出；菜单位于视口内，设置内容独立滚动。差异布局只剩左右 / 统一两项；旧 `patch` 偏好在 schema 读取时迁移为 `unified`，其他配置保留。
- 75 个离线图标（40 文件 / 35 操作）；未新增运行依赖。严格类型、Biome、65 项回归通过；SDK 0.12 / 0.13 / 0.14 / 0.15 分别检查。

截图均已实际打开检查：`artifacts/preview-links-markdown.png`、`artifacts/preview-links-menu.png`、`artifacts/preview-links-settings.png`。Markdown 链接导航仅面向桌面 / Web，原生移动端仍回退文本；远程与相对图片资源解析仍未提供。

10:33（北京时间）已重载本机插件，状态为 running。真实 RPC 再次读取指定文档，并将其中首个文件链接解析到 `.harness/skills/remote-device-lab/SKILL.md`；当前主仓 132 个变更、Client 子仓 72 个、Web 0，三仓均 ready。主机设置为 ready，已有偏好保留，新增缓存数量为默认 5。完整报告见 `artifacts/runtime.json`，打包核对见 `artifacts/preview-links-pack.json`。补充浅色设置截图 `artifacts/preview-links-light.png` 已实际打开检查。
