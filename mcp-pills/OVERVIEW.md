# MCP Pills

MCP Pills 在 agent 的输入框上方添加 MCP pill，展示与该 agent 相关的 MCP 配置。点击服务后可连接并浏览 Tools、Resources、Resource templates 和 Prompts，搜索名称、说明和参数，展开完整 JSON Schema。也可以在独立标签页中浏览。

支持 Codex 用户及项目的 `config.toml`、Claude Code 用户及当前项目配置，以及 Paseo 保存的 agent MCP 配置。显示配置来源、传输类型、禁用状态和工具过滤规则。需要 Paseo 0.13.0 或更新版本。

连接由 daemon 发起。支持 stdio、HTTP 和 SSE；stdio 会执行配置中的启动命令，读取接口后关闭进程。浏览器只查询接口定义，不调用工具，不读取资源正文，也不执行提示词。认证使用配置中的请求头或 daemon 环境变量，不复用 provider 的 OAuth 登录。

配置中的服务不等于当前 agent 实际加载的服务。运行时注入、provider 插件、云端连接器、托管策略、项目批准状态和命令行覆盖可能不在结果中。连接成功也不代表 agent 已获准使用这些接口。

启动参数、环境变量值和认证请求头只在 daemon 上使用，不发送到客户端。stdio 的临时目录与常见依赖缓存放在 `~/code/.cache/mcp-pills`；`~/code` 必须已存在。可通过 daemon 环境变量 `PASEO_MCP_PILLS_DATA_DIR` 指定另一个已存在的存储目录。
