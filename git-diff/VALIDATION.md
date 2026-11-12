# Local validation

Validated on 2026-11-11. TypeScript, Biome and 108 tests passed across 17 files. The installed `git-diff` runtime was hot-reloaded from this checkout and reported `running`.

Browser checks used the real Git service with an isolated fixture and the current repository. Checked 1600×1000 and 390×844 layouts, with no page errors:

- The Explorer panel stacks graph/history above the file list; the workspace panel renders the central diff. Range, file selection, tabs, viewed marks and appearance settings share state. Closing a tab does not reopen it from the other panel.
- Default current-branch review includes every exclusive commit and working changes. A 201-commit fixture verified automatic paging at offsets 0, 100 and 200, full range endpoints and exclusion of base files. Manual range selection survives refresh.
- History controls occupy one 34px toolbar. Repository, scope and baseline live in options; search opens on demand or Cmd/Ctrl+F and closes with Escape. Browser checks cover scope switching, default full review, collapse/restoration and narrow layouts.
- Removed the graph footer hint row. File filtering is hidden until its toolbar button, Cmd/Ctrl+F or `/`; Escape and the close button clear and hide it. Browser checks cover focus restoration, file restoration and independent graph/diff search.
- The graph/file divider follows upward and downward mouse motion, including after viewport height clamping.
- All-branch lanes, current-branch filtering, first-parent fork markers, disabled shared history, range handles, click/Shift/drag selection, keyboard adjustment, graph collapse/restoration and edge auto-scroll.
- Upward/downward context expansion from both ends of a gap, correct remaining counts and merging without duplicate lines in unified and split models.
- Browser mouse selection stays on its starting diff side, including reverse drags and dragging across columns. Copy excludes the opposite side, line numbers and change signs. The floating selection action opens and saves a review comment.
- Gutter comment controls avoid the split resizer hit area. Browser checks click the left, center and right of the plus on both sides and context lines, verify Enter activation and single-line four-digit numbers.
- Line comments on either side persist with code snapshots. Paseo 0.16 composer integration adds them to every conversation in the same workspace, preserves existing prompts, updates edits without duplicates, synchronizes deletion and attachment removal, and includes newly created conversations. Other workspaces are excluded. The old recipient picker and direct-send workflow have been removed.

Composer browser tests use the public API with a local fixture and never send agent messages. Unit validation checks the generated item against `PluginAttachmentItemSchema`, including old/new side identity, line numbers, hunk header and surrounding lines. Live message submission and native iOS/Android were not exercised.

Git integration coverage includes branch comparisons, inclusive first-parent ranges, merges, pagination, empty and shallow histories, submodules, working/untracked files, cache invalidation, renames, literal paths, binary files, size limits and whitespace handling.

Screenshots and local browser scripts are in the ignored `.cache/gitlens-reference/` directory. Validation temporary files use `.cache/git-diff-interaction/temp/` on the data disk.
