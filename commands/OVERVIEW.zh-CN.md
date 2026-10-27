Commands 汇总当前 agent 的项目命令、全局命令和会话命令。点击输入框上方的 Commands 按钮，会在当前聊天中打开浮层；窄屏使用底部弹层。你可以搜索命令、预览 Markdown、填写参数并发送给同一个 agent。发送成功后浮层自动关闭。右上角 Open tab 和 Command Center 可打开带来源筛选的完整面板。

插件扫描共享的 `.agents/commands`，以及 Claude、Codex、OpenCode、Pi 和 Copilot 对应的命令或提示词目录。项目扫描从工作目录向上到 Git 根目录，全局目录位于 daemon 主机上。其他 provider 展示会话返回的命令。同名文件保留各自的来源路径。

会话已识别的命令按原生斜杠命令发送；其他文件作为提示词模板发送，并替换参数。命令及参数或展开后的 Markdown 会交给所选 agent 的 provider，遵循该 agent 的数据处理规则。原生命令可能使 provider 调用工具。模板模式不会执行 provider 的 frontmatter 设置、shell 替换或文件指令。已安装 Claude 插件提供的命令通过会话显示，不提供文件预览。插件自身不修改命令文件，也不直接执行 shell 命令。

要求 daemon 和客户端均为 Paseo 0.13.0 或更新版本，且主机已启用插件。通过 Git 安装时，主机需要 Node.js 22 或更新版本及 npm，用于安装锁定版本的 YAML 解析依赖。仅在 agent 不忙碌时发送；发送失败时保留错误提示和参数。按钮面向已创建的 agent，新建空白草稿需要在首条消息创建 agent 后才会显示。
