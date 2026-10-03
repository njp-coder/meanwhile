# Privacy

meanwhile collects nothing for its developer. There is no analytics, telemetry or server of its own.

**What it reads, once a day**
- The public Hacker News front page (`hn.algolia.com`) and recently created public GitHub repositories (`api.github.com`).
- In the folder you're working in: `package.json`, `pyproject.toml`, `Cargo.toml` or `go.mod`, to prefer a topic that fits your stack.

**What it sends to a model**
- One Haiku call a day, through your own Claude Code session and plan, containing today's headlines and your dependency names. Never your source code, prompts or conversation.

**What it stores, on your machine only**
- Today's lesson, which questions you've seen, and daily counts (turns, tool calls, edits, number of distinct files touched, time Claude worked; file paths are kept only as short hashes), in Claude Code's own plugin store. Delete the plugin's store file to clear it.

**What it shares with third parties:** nothing.

Questions: open an issue at https://github.com/njp-coder/meanwhile/issues
