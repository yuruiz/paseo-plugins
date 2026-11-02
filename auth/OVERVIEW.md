# Auth

Reconnect Claude Code and Codex without opening a terminal.

When a conversation fails because it needs a new login, Auth adds a card with **重新登录**. Open the official authorization page, complete login in your browser, and watch the card update automatically. Codex shows a device code; Claude offers an authorization-code input when required.

After login, reload the current session and choose whether to continue its task. You stay in control of restarting sessions and sending another message.

You can also type `/auth`, open the Command Center login action, or use **账号登录** in the sidebar. Each login belongs to the selected Paseo host. Shared credential scopes share progress across clients.

Requires Paseo 0.14.x, a macOS/Linux host, and supported official CLIs. Mobile and web clients can use the plugin. Codex requires device-code login to be enabled. API keys, cloud-provider credentials, and MCP server authentication are outside this plugin's login flow.
