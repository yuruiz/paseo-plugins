Skills adds a searchable skill browser to the agent composer and workspace. Select a skill to
read its instructions and run it with optional arguments. The full tab also shows its source
and file path. Skills marked model-only can be read but cannot be invoked manually.

The list and badge count only entries backed by a readable `SKILL.md` with a name and description.
Discovery supports Claude, Codex and Hermes and custom providers that extend them, including
provider-specific configuration directories and installed Claude plugin skills. Bodies are read
when a skill is opened.

Requires Paseo daemon and app 0.13.0 or newer with plugins enabled. The server reads skill files
and Claude's installed-plugin manifest on the daemon machine. Invoking a skill sends a command
to the selected agent.

The full Skills tab can sync selected skill folders through an existing private GitHub repository.
Configure the same repository on another machine to download skills there. A comparison lists
matching, missing, and differing versions, including scripts and resources. Replacing a differing
version requires confirmation; local replacements keep backups. Changes are never synced automatically.
GitHub sync requires GitHub CLI authenticated on each daemon host and repository Contents access.
The plugin stores the repository and branch in host settings and uses GitHub CLI's authentication.

Built-in entries without a discoverable skill file are omitted. Other providers show that skill
discovery is not yet supported. Discovery reflects files on disk; it does not verify whether the
running session has enabled or loaded them.
