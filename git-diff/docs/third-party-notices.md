# 第三方资源

图标与 Mermaid 引擎随插件离线分发，不向 CDN 请求资源。原始矢量图形未重绘；Web 使用 SVG，原生客户端使用由 SVG 导出的 64px PNG，单色操作图标随主题着色。

| 资源             | 固定版本 / 来源                                                                      | 使用与许可证                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| vscode-icons     | [v13.0.0](https://github.com/vscode-icons/vscode-icons/tree/v13.0.0)，提交 `866d4f4` | 40 个文件/目录图标；[MIT](licenses/vscode-icons-MIT.txt)，Copyright © 2016 Roberto Huertas。品牌标识的商标权归各权利人。 |
| VS Code Codicons | [@vscode/codicons 0.0.46-24](https://github.com/microsoft/vscode-codicons)           | 35 个操作图标，Microsoft Corporation；[CC BY 4.0](licenses/codicons-CC-BY-4.0.txt)。调整显示尺寸、颜色，并生成 PNG。     |
| Mermaid          | [12.3.0](https://github.com/mermaid-js/mermaid)                                      | Markdown 图表渲染；[MIT](licenses/mermaid-MIT.txt)。官方完整浏览器分发包保留内嵌的依赖许可声明，以 gzip 压缩后传输。     |

文件图标风格参考用户指定的 [vscode-icons 扩展](https://marketplace.cursorapi.com/items/?itemName=vscode-icons-team.vscode-icons)。

插件目录图标 `assets/icon.png` 使用同版本 Codicons 的 `git-compare.svg`，按 CC BY 4.0 分发；调整尺寸与颜色并导出为透明 PNG。截图为本插件在临时示例仓库中的实际界面。

使用 Node 22.12+ 运行 `npm run build:assets` 从 `scripts/vendor/vscode-icons` 中的原始 SVG 和锁定的 npm 开发依赖重新生成 `client/generated/icons.ts`、`server/generated/mermaid.ts`。插件安装时直接使用生成结果，不需要 sharp、Mermaid npm 包或网络下载。
