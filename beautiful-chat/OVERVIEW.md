# Beautiful Chat

Restyles chat tool calls, reasoning, prompts and replies with theme-aware cards. Tool call details
start collapsed, including running and failed calls. Click a card header to show or hide its code,
arguments and output. The header keeps the call's status visible.

Requires Paseo 0.8.0 or later. Presentation settings control fonts, accent colours and enhanced
message rendering. Existing Beautiful Chat presentation preferences are retained.

Syntax highlighting runs on the daemon. Image previews read files on the daemon host, and file
links ask that machine's file manager to reveal the path. Desktop browser effects and chat search
depend on web APIs; native clients use the upstream fallback behavior. Collapsed card contents
are not included in the plugin's rendered-text search until opened.
