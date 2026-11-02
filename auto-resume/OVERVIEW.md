# Auto Resume

When Claude Code or Codex stops because its subscription quota is exhausted, Auto Resume adds a recovery card to the conversation. Click **Resume after reset** to continue the same conversation after the provider's reported reset time.

The **Auto-resume** composer pill enables automatic recovery for the current conversation. It is off by default. Turning it on schedules recovery when quota runs out; turning it off cancels a pending recovery. You can configure the timezone, buffer after reset, and maximum consecutive attempts. If the reset time cannot be determined, choose a time manually or select **Try in one hour**.

Requires Paseo 0.14.x for both the daemon and client, and a Paseo CLI executable available to the daemon. Supports Claude Code and Codex. It detects quota errors rather than polling remaining account balances, and does not approve tool permissions automatically.

Recovery jobs are stored locally and rebuilt after a plugin reload or daemon restart. Your computer and daemon must be running; overdue jobs are checked when they resume. Starting a new turn manually, canceling, or archiving invalidates a pending recovery. If a send acknowledgement is lost, the plugin asks you to check the conversation instead of sending again blindly.

The plugin reads turn errors, conversation state, and relevant history. It stores settings, bounded error excerpts, timestamps, and a transcript hash used to detect changes. Data defaults to `plugin-data/auto-resume` under the daemon home. Recovery sends a fixed continuation prompt to the original conversation without replaying attachments or tool actions. It does not read provider credentials. Background waiting continues when the client page is closed.
