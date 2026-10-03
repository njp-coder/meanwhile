# meanwhile

**Learn one new thing a day while Claude thinks.**

A Claude Code mod. Each morning it reads the Hacker News front page and the fastest-rising new GitHub repos, and Haiku picks one concept worth learning, preferring one that fits the stack in your current repo. A small quiet card above your prompt asks one question at a time and gives you about 40 seconds of Claude working to think before the answer appears.

```
╭ meanwhile · Speculative decoding ─────────────── 2/4 ╮
│ Why can an LLM API get faster without getting dumber? │
│ → A small model guesses ahead; the big one just checks.│
╰───────────────────────────────────────────────────────╯
```

When you've seen every answer, the card becomes your moment:

```
✓ You learned Speculative decoding today
🔥 4-day streak · /wrapped to share your day
```

## While you work

- **Above the prompt:** today's lesson card. Click **Show answer** when you're ready, **Skip** a question you don't care about, then **Next**. If you leave it alone, the answer appears after 40 seconds of Claude working.
- **After a turn that changed things:** one dim line such as `6 edits · 4 files · 2 commands · 1m12s`. It's drawn like a system notice and never sent to Claude.

## When you ask

- `/meanwhile` shows the whole lesson as plain text. Press `n` for a different topic or `c` to copy it as a post.
- `/wrapped` opens your day as a share card: what you shipped (edits and files), Claude's working time, what you learned, your streak and a three-week strip. Press `c` to copy a post that leads with what you shipped and teaches your readers today's fact, then screenshot the card.

It makes one Haiku call per day, on your own plan, and the lesson is cached. Showing it costs no tokens. If the news can't be reached, it falls back to a built-in evergreen lesson marked "offline pick".

## Install

Needs Claude Code 2.1.287 or later (`claude update`), with mods switched on for your account. Mods are still rolling out, so if nothing shows up, your account may not have them yet.

In a terminal:

```bash
claude plugin marketplace add njp-coder/meanwhile
claude plugin install meanwhile@meanwhile
```

Or inside Claude Code, type `/plugin`, add the marketplace `njp-coder/meanwhile`, and install **meanwhile**.

Then quit and reopen Claude Code (in the desktop app: ⌘Q) and start a new session. The first question card appears within about 20 seconds.

**Commands:** `/meanwhile` shows the whole lesson (`n` new topic, `c` copy as a post). `/wrapped` opens your day as a share card.

**Cost:** one small Haiku call a day on your own plan, to write the day's questions. Everything else costs no tokens.

**What it reaches:** the Hacker News and GitHub public APIs once a day, and your current folder's `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` to pick a topic that fits your stack. The daily Haiku call sees only today's headlines and your dependency names, never your code.

## What it does on your machine

meanwhile runs no commands and no tools of its own, and it never changes, blocks or rewrites anything Claude does.

**Network: two fixed hosts, once a day**
- `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30`: the public Hacker News front page.
- `https://api.github.com/search/repositories?q=created:>DATE&sort=stars&order=desc&per_page=12`: the most-starred public repos created in the last 7 days. `DATE` is today minus 7 days; that date is the only part of the address that changes.
- It sends nothing to either host beyond those public requests.

**What it sends, and where**
- One `$.model.complete` call a day to Claude Haiku, through your own Claude Code session and plan. It contains the headlines from the two hosts above and the dependency names it read locally (below). Never your source code, prompts or conversation.
- Nothing is sent anywhere else. There is no server of its own.

**What it reads locally**
- In your current folder: `package.json` (dependency names), and whether `pyproject.toml`, `Cargo.toml` or `go.mod` exists. Used only to prefer a topic that fits your stack.

**What each hook does with what it sees**
- `session.start`: registers `/meanwhile` and `/wrapped` and loads today's lesson.
- `turn.start` / `turn.complete`: notes that Claude is working (so the card only moves on then) and adds the turn's duration to today's count. It does not read or keep the conversation text.
- `tool.call`: lets every call through unchanged, then counts it. For Edit, Write, MultiEdit and NotebookEdit it notes the file path; for Bash it counts one command. It never reads command text or file contents.
- `command.run` for `/meanwhile` and `/wrapped`: answers only those two commands, by opening their panes. Other commands are not touched.
- `ui.render`: draws the card above the prompt and the two panes.

**What it stores:** today's lesson and daily counts, in Claude Code's own plugin store on your machine. See [PRIVACY.md](PRIVACY.md).

## Develop

```bash
claude plugin validate .
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test
```

## Privacy

See [PRIVACY.md](PRIVACY.md). meanwhile collects nothing for its developer.
