Review working changes and inclusive commit ranges inside Paseo, inspect branch relationships, and attach line comments and code context to workspace composers.

Git Diff occupies the central editor. Git Review lives in the right Explorer, with the graph above the changed-file list. The panels share the review range, file selection, preview tabs and viewed marks. It defaults to the current branch and reviews every commit after its fork together with working changes. Collapse the graph or resize the divider. Files reuse one preview tab until pinned or double-clicked.

Switch to All branches to inspect forks and merges. Select commits or Working Changes to update the files and diff. Adjust the range with Shift-click, keyboard selection, dragging or the two purple boundary handles. History scrolls when a handle reaches the edge. Include Working Changes to review uncommitted edits together with commits.

Current-branch scope follows the first-parent chain and marks its fork from a selectable base branch, defaulting to the repository default branch. Shared history at and before the fork cannot enter the review range. A branch with no exclusive commits permits only Working Changes. The base branch itself has no inferred fork restriction.

Use the plus button beside a diff line number to add or edit a comment on either side. Comments capture the target line and nearby code, are isolated by workspace and comparison, and persist through Paseo. Saving adds a comment attachment to every conversation in the workspace, including new conversations. No recipient selection or automatic send is needed. Editing, deleting and removing attachments synchronize across those composers.

Filter files, inspect unified or split diffs, ignore whitespace, wrap lines, navigate hunks and browse initialized submodules. Expand omitted code upward or downward in steps of 20 lines or reveal the whole gap. Ctrl/Cmd+F searches both sides, including collapsed context; Enter / Shift+Enter navigates matches and Escape closes search.

Requires Paseo daemon and client >=0.16.0 and Git on the host. Git reads run on the selected daemon. The plugin does not fetch, check out branches, stage files or edit the working tree. Comment attachments are sent with the user’s own message. Ranges must follow one first-parent chain and contain at most 10000 commits. Files over 1 MiB and patches over 2 MiB are not expanded; binary files show status. Select an initialized submodule to review its internal history.
