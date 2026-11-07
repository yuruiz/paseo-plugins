# Local validation

Version 0.4.1 validated on 2026-11-07 with Paseo daemon 0.15.2 on macOS.

- Version synchronization, TypeScript, Biome and 89 tests passed (13 files).
- Git integration coverage includes divergent branches, merge-base versus tip comparison, remote default detection and master fallback, inclusive ranges including root commits, first-parent merge semantics, immutable snapshots, literal/renamed/deleted paths, binary and large files, whitespace, invalid inputs, detached HEAD, ignored submodules and shallow history.
- Three adapter tests prevent working files and live gitlink warnings from entering historical file lists, prevent fallback to working data while loading or failing, and isolate viewed marks by repository and commit pair.
- The original Changes view is again the default. The view switcher matches upstream. Comparison results reuse the original file tree, tabs, tab cache, toolbar, diff renderer, sidebar resizer and keyboard navigation. The standalone comparison screen has been removed.
- Browser verification used an isolated Git fixture with dirty working files and real RPC handlers. Checked 1440×1000 dark and 390×844 light layouts, the original default view, tree/list switching, multiple tabs, pinned branch diffs, direct tips, viewed-state isolation, two-click inclusive ranges, reversed-range errors, returning to working content and mobile back navigation/range selection. No browser page errors.
- In particular, switching ranges cannot retain a stale historical patch in a hidden tab. Historical diffs do not show the current working file through the original preview control; historical preview and Finder actions are unavailable, while working mode retains its original actions.
- Installed runtime `git-diff` is checked through `npm run verify:review -- <fixture-directory>` for the live client contribution, branch and range RPCs, text diff and rejected range/path inputs.

Screenshots and temporary browser checks live in the repository's ignored
`.cache/git-diff-work/` directory on the SSD. The restored UI report is
`restored-ui-validation.json`; screenshots use the `restored-` prefix.
UI verification used the browser preview with real backend handlers. The native
Paseo app itself was not automated, and a native iOS/Android device was not available.

Viewed marks last within the panel and are cleared on close. Remote tracking refs
are not fetched automatically.
