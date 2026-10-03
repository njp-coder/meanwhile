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

## Develop

```bash
claude plugin validate .
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test
```

## Privacy

See [PRIVACY.md](PRIVACY.md). meanwhile collects nothing for its developer.
