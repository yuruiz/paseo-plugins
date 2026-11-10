Compare the current branch with a base branch, review the combined diff of an inclusive commit range, and browse working changes and submodule history inside Paseo.

The original Changes view remains the default, with its file tree, tabs, resizable sidebar, diff toolbar and settings. Use the Compare button beside the working-change tabs to choose a range and view its results in the same editor. Base branch detection uses origin/HEAD, then falls back to main or master. Choose another local or remote tracking branch when needed. Branch review compares the merge base with HEAD; direct comparison shows the difference between both branch tips. Select two commits to review an inclusive range on the first-parent chain. Merge commits include the net changes they introduce.

Filter changed files, inspect unified or split diffs, navigate hunks, ignore whitespace and mark files as reviewed. Review marks are scoped to repository and comparison SHAs and last within the current panel and are cleared when it closes. Compact layouts open a separate diff page. The view menu also offers working changes and the original commit graph, previews and initialized submodules.

Requires Paseo daemon and client >=0.12.0 and Git on the daemon host. Git objects are read locally and returned through plugin RPC; code is not sent to external services. No fetch, checkout, staging or working tree changes are performed. Remote branches refer to locally available tracking refs. Review is manual; this plugin does not start an AI review agent.

Expand omitted unchanged code in steps of 20 lines or reveal an entire gap, including the file prefix, gaps between hunks and the file tail. Expansion works in unified and split views for working changes, branch comparisons and commit history.

Commit ranges must follow one first-parent chain and contain at most 10000 commits. Missing shallow history produces an error. Files over 1 MiB and patches over 2 MiB are not expanded; binary files show their status. Parent repositories show submodule pointer changes; select an initialized submodule to compare its internal files.

Use the diff editor search button or press Ctrl/Cmd+F while the editor is focused to search both sides of the current file, including collapsed context. Search is case-insensitive and literal. Enter / Shift+Enter navigates matches; Escape closes search.
