# Git Diff Review

Paseo 的 Git diff / review 插件。基于 [MinLeeV5/paseo-git-diff-with-submodule](https://github.com/MinLeeV5/paseo-git-diff-with-submodule) v0.3.0（`7cb64760ce6871dde6e71732717f55958aa2f831`）导入并扩展，保留原有文件 diff、提交图、多层子模块与预览能力，加入分支比较和连续提交区间 Review。交互参考 [GitLens](https://www.gitkraken.com/gitlens) 的 Compare / Review 流程。

## 使用

打开工作区 Command Center（⌘K / Ctrl+K），选择 **Git Diff · 分支与提交 Review**。面板默认进入原插件的「更改」视图，保留原文件树 / 列表、多文件标签、可拖动侧栏、左右 diff 和工具栏。点击侧栏「全部 / 已暂存 / 未暂存」右侧的「比较」按钮选择范围；结果直接显示在同一编辑器。左上角菜单仍只有「更改 / 提交图」。

- **分支对比**：当前本地 HEAD 对比基准分支。默认优先使用有效的 `origin/HEAD`，其次本地 main、master，再其次 origin/main、origin/master；可手动选择其他本地或远端跟踪分支。
- **分支引入的改动**：比较共同祖先与当前 HEAD，适用于合并前 Review。主干分叉后新增的独立改动不会被误显示成删除。
- **直接比较**：比较基准分支端点与 HEAD 的完整树差异。
- **连续提交**：在比较范围弹窗选择「连续提交」，在原样式的提交行上点击两个端点；也可分别通过起始 / 结束选择器选择。点击「比较」后应用。每页 100 条，可继续加载。区间按第一父提交链定义，最多 10000 个提交；merge 包含相对第一父提交引入的净改动。差异等价于 `oldest^ → newest`，起点为根提交时使用空树。
- **文件 Review**：复用原列表 / 目录树与多文件标签，筛选文件，查看统一 / 左右 diff、切换换行和忽略空白、跳转差异块，并标记已阅。已阅状态按仓库和比较 SHA 隔离，在当前面板内保留，关闭面板时清除，未写入 Git 仓库。
- **子模块**：通过仓库选择器，使用各子模块自己的分支、提交历史和比较结果。原有工作区视图仍递归展示已初始化子模块，即使设置了 `ignore=all`。

比较只读取已提交对象，不包含暂存区和工作区改动；未提交内容在「更改」视图查看。远端引用是本地已有的跟踪引用，不自动 fetch、checkout、修改 index 或更新子模块。手动刷新重新捕获 HEAD 与基准；已打开的 diff 固定使用该次比较的 SHA，避免文件列表与补丁来自不同版本。

浅克隆缺少父提交、没有共同祖先、多个 merge base、无效或不连续区间会显示明确错误。子模块未初始化时不能查看内部历史。历史比较不使用工作区文件预览或 Finder 定位，以免把本地文件误当成历史版本；未提交视图的原有预览与定位保持可用。父仓比较显示 gitlink 变化；查看子模块内部文件需切换到对应子模块选择范围。单文件上限 1 MiB，补丁上限 2 MiB，二进制文件仅显示状态。此版本提供人工 Review 与已阅标记，不会启动 AI review agent。

## 本地开发与安装

要求 Paseo daemon 和客户端 >=0.12.0，主机已安装 Git，开发使用 Node.js >=22。

```sh
# 在仓库根目录，确认 ~/code 指向已挂载 SSD 后执行
mkdir -p .cache/git-diff-work/tmp .cache/git-diff-work/npm
export TMPDIR="$PWD/.cache/git-diff-work/tmp"
export XDG_CACHE_HOME="$PWD/.cache/git-diff-work"
export npm_config_cache="$PWD/.cache/git-diff-work/npm"
npm --prefix git-diff ci --ignore-scripts --no-audit --no-fund
npm --prefix git-diff run check
paseo plugin install "$PWD/git-diff"
# 修改后
paseo plugin reload git-diff
```

此本地扩展使用独立运行 ID `git-diff`；原安装 `git-diff-with-submodule` 可保留以便回退。上游原始版本与导入信息见 [UPSTREAM.md](UPSTREAM.md)，第三方图标与 Mermaid 声明见 [docs/third-party-notices.md](docs/third-party-notices.md)。
