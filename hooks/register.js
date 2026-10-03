// meanwhile — learn one new thing a day while Claude thinks.
//
// Each morning the mod reads what's new (Hacker News front page, fresh GitHub
// repos), asks Haiku to pick ONE teachable topic, and splits it into short
// question-and-answer cards. While Claude works, one dim line under the
// spinner asks a question, pauses, then shows the answer. /meanwhile shows the whole lesson, quietly.

const LESSON_PANE = 'meanwhile-lesson'
const WRAPPED_PANE = 'meanwhile-wrapped'

// /wrapped only: it is a share card, so it may use colour. Nothing ambient does.
const ACCENT = '#D97757'
const COOL = '#6A9BCC'
const GOOD = '#7FB069'
const MUTED = '#8A8A8A'
// Each card: the question alone for one step, then question → answer for two
// Each card holds for a minute of Claude working: 40s to think, then the answer
const STEP_MS = 5000
const STEPS_PER_CARD = 12
const ANSWER_FROM = 8


// Module state (rebuilt from $.store on every load)
let lesson = null // today's lesson object
let generating = false
let working = false
let step = 0 // advances only while Claude works
let seen = new Set() // card indices whose answer was shown today
let celebrated = false // the "you learned it" card shows once, then the card is gone for the day
let rotateTimer = null
let pending = { tools: 0 } // counted between flushes
let turnWork = { edits: 0, files: new Set(), commands: 0 } // this turn, for the recap line

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// Used only if the network or the model is unavailable. Evergreen, not "news".
const OFFLINE = [
  {
    topic: 'Speculative decoding',
    cards: [
      { q: 'Why can an LLM API get faster without getting dumber?', a: 'A small model guesses ahead; the big one just checks.' },
      { q: 'What does the small "draft" model do?', a: 'Cheaply guesses the next 4-8 tokens.' },
      { q: 'How does the big model check them?', a: 'Scores all the guesses in ONE parallel pass.' },
      { q: 'Does the output change?', a: 'No. Identical to the big model alone, 2-3x faster.' },
    ],
    example: 'draft: "the cat sat on" -> target accepts 3/4 -> 3 tokens for 1 pass',
    tag: 'AI',
  },
  {
    topic: 'CRDTs',
    cards: [
      { q: 'Two people edit the same doc offline. Who wins?', a: 'Nobody has to: CRDT edits merge in any order.' },
      { q: 'What makes a CRDT merge safely?', a: 'Every edit commutes, so all copies end up identical.' },
      { q: 'Do CRDTs need a server to decide?', a: 'No locks, no referee. The math guarantees agreement.' },
      { q: 'Who uses them?', a: 'Figma, Linear and most local-first apps.' },
    ],
    example: 'G-Counter: each device keeps its own count; total = sum of maxes.',
    tag: 'Systems',
  },
  {
    topic: 'Bloom filters',
    cards: [
      { q: 'Can a set lookup be wrong and still useful?', a: 'Yes: a Bloom filter says "definitely not" or "maybe".' },
      { q: 'How does it store items?', a: 'Hash each item k times, flip those k bits on.' },
      { q: 'When is the answer certain?', a: 'Any of the k bits is 0 means definitely absent.' },
      { q: 'Why do databases use them?', a: 'To skip disk reads for keys that are not there.' },
    ],
    example: '1% false positives costs ~9.6 bits per item, whatever the item size.',
    tag: 'Algorithms',
  },
]

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'meanwhile',
      description: "Open today's lesson (add 'new' for a different topic)",
      immediate: true,
    })
    await $.command.register({
      name: 'wrapped',
      description: 'Your day in Claude Code, as a share card',
      immediate: true,
    })
    await loadToday($)
    // One rotation timer for the whole session; it only advances while Claude works
    rotateTimer = $.clock.every(STEP_MS, () => {
      if (!working || !lesson) return
      step = (step + 1) % (lesson.cards.length * STEPS_PER_CARD)
      if (step % STEPS_PER_CARD >= ANSWER_FROM) seen.add(Math.floor(step / STEPS_PER_CARD))
      showCard($)
    })
    // Generate in the background so the session starts instantly
    if (!lesson) $.clock.after(50, () => ensureLesson($, false))
    showCard($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    working = true
    if (!e.agentId) {
      turnWork = { edits: 0, files: new Set(), commands: 0 }
      // The proud card was on screen until this message; done for today
      if (lesson && !celebrated && seen.size >= lesson.cards.length) {
        celebrated = true
        await markCelebrated($)
        $.ui.invalidate('ui.render')
      }
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    pending.tools += 1
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      if (EDIT_TOOLS.has(e.tool)) {
        turnWork.edits += 1
        if (e.file_path || e.notebook_path) turnWork.files.add(e.file_path || e.notebook_path)
      } else if (e.tool === 'Bash') {
        turnWork.commands += 1
      }
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    // Subagent turns count as tool work, not as your turns
    if (!e.agentId) {
      working = false
      await flushDay($, e)
      recap($, e)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // A small quiet card above the prompt: the question, then its answer
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!lesson || e.props.hasSurvey || e.props.maxRows < 4) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const frame = (children) =>
      Box({ flexDirection: 'column', borderStyle: 'round', borderColor: '#8A8A8A', paddingX: 1, width: Math.min(e.props.bodyColumns || 80, 96), children })

    // Every answer seen today: the proud moment, with the way to share it
    if (seen.size >= lesson.cards.length) {
      if (celebrated) return next(e)
      const streak = streakOf(await lastDays($, 21))
      return frame([
        Text({ children: ['✓ You learned ' + lesson.topic + ' today'] }),
        Text({ dimColor: true, children: [(streak > 1 ? '🔥 ' + streak + '-day streak · ' : '') + '/wrapped to share your day'] }),
      ])
    }

    const { q, a } = currentCard()
    const idx = Math.floor(step / STEPS_PER_CARD) % lesson.cards.length
    const total = lesson.cards.length
    const reveal = () => {
      step = idx * STEPS_PER_CARD + ANSWER_FROM
      seen.add(idx)
      showCard($)
    }
    const goNext = () => {
      step = ((idx + 1) % total) * STEPS_PER_CARD
      showCard($)
    }
    const buttons = a
      ? [Button({ key: 'mw-next', label: idx + 1 < total ? 'Next' : 'Start over', plain: true, dimColor: true, onPress: goNext })]
      : [
          Button({ key: 'mw-show', label: 'Show answer', plain: true, dimColor: true, onPress: reveal }),
          Button({ key: 'mw-skip', label: 'Skip', plain: true, dimColor: true, onPress: goNext }),
        ]
    return frame([
      Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        children: [
          Text({ dimColor: true, children: ['meanwhile · ' + lesson.topic] }),
          Text({ dimColor: true, children: [idx + 1 + '/' + total] }),
        ],
      }),
      Text({ wrap: 'wrap', children: [q] }),
      a ? Text({ dimColor: true, wrap: 'wrap', children: ['→ ' + a] }) : null,
      Box({ flexDirection: 'row', columnGap: 3, children: buttons }),
    ].filter(Boolean))
  })

  on('command.run', { command: 'meanwhile' }, async ($, e) => {
    if ((e.args || '').trim() === 'new') {
      $.clock.after(10, () => ensureLesson($, true))
    } else if (!lesson && !generating) {
      $.clock.after(10, () => ensureLesson($, false))
    }
    await $.ui.open({ id: LESSON_PANE, title: 'meanwhile', focus: true, closeOnEscape: true })
    return {}
  })

  // /meanwhile: the whole lesson as plain reading text, no card
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== LESSON_PANE) return next(e)
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const width = Math.max(30, Math.min(e.props.bodyColumns || 72, 72))

    if (!lesson) {
      return Text({ dimColor: true, children: [generating ? 'Reading today\'s front page…' : 'No lesson yet.'] })
    }

    // Reading it counts as learning it
    lesson.cards.forEach((_, i) => seen.add(i))

    return Box({
      flexDirection: 'column',
      width,
      paddingX: 1,
      rowGap: 1,
      children: [
        Text({ bold: true, children: [lesson.topic] }),
        Box({
          flexDirection: 'column',
          rowGap: 1,
          children: lesson.cards.map((c, i) =>
            Box({
              key: 'c' + i,
              flexDirection: 'column',
              children: [Text({ wrap: 'wrap', children: [c.q] }), Text({ dimColor: true, wrap: 'wrap', children: ['→ ' + c.a] })],
            }),
          ),
        }),
        lesson.example ? Text({ dimColor: true, wrap: 'wrap', children: ['e.g. ' + lesson.example] }) : null,
        lesson.sourceUrl
          ? Link({ href: lesson.sourceUrl, label: shortUrl(lesson.sourceUrl) })
          : Text({ dimColor: true, children: [lesson.offline ? 'offline pick' : ''] }),
        Box({
          flexDirection: 'row',
          columnGap: 3,
          children: [
            Button({
              key: 'new',
              label: 'new topic',
              hotkey: 'n',
              plain: true,
              dimColor: true,
              onPress: () => {
                $.clock.after(10, () => ensureLesson($, true))
              },
            }),
            Button({
              key: 'copy',
              label: 'copy',
              hotkey: 'c',
              plain: true,
              dimColor: true,
              onPress: () => {
                $.ui.copy({ text: lessonPost(lesson) })
                $.ui.toast('Copied')
              },
            }),
          ],
        }),
      ].filter(Boolean),
    })
  })

  on('command.run', { command: 'wrapped' }, async ($) => {
    await flushDay($, null)
    await $.ui.open({ id: WRAPPED_PANE, title: 'wrapped', focus: true, closeOnEscape: true })
    return {}
  })

  // /wrapped — the share card
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== WRAPPED_PANE) return next(e)
    const { Box, Text, Button, Raster } = $.ui.resolve(e)
    const width = Math.max(30, Math.min(e.props.bodyColumns || 60, 60))
    const days = await lastDays($, 21)
    const today = days[days.length - 1]
    const streak = streakOf(days)
    const learned = lesson && seen.size >= lesson.cards.length

    const stat = (label, value, color) =>
      Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        children: [
          Text({ color: MUTED, children: [label] }),
          Text({ color: color || undefined, bold: true, children: [value] }),
        ],
      })

    const heat =
      e.surface === 'terminal'
        ? Raster({ key: 'heat', columns: days.length * 2, rows: 1, cells: heatCells(days) })
        : Text({ children: [days.map((d) => (d.learned ? '■' : d.turns ? '▪' : '·')).join(' ')] })

    return Box({
      flexDirection: 'column',
      width,
      borderStyle: 'round',
      borderColor: ACCENT,
      paddingX: 2,
      paddingY: 1,
      rowGap: 1,
      children: [
        Box({
          flexDirection: 'row',
          justifyContent: 'space-between',
          children: [
            Text({ color: ACCENT, bold: true, children: ['TODAY IN CLAUDE CODE'] }),
            Text({ color: MUTED, children: [prettyDate(today.date)] }),
          ],
        }),
        Box({
          flexDirection: 'column',
          children: [
            stat('shipped', today.edits + (today.edits === 1 ? ' edit' : ' edits') + ' · ' + today.files + (today.files === 1 ? ' file' : ' files')),
            stat('Claude working', fmtDuration(today.workMs)),
            stat('streak', streak + (streak === 1 ? ' day' : ' days') + (streak >= 3 ? ' 🔥' : ''), ACCENT),
          ],
        }),
        Box({
          flexDirection: 'column',
          children: [
            Text({ color: MUTED, children: ['learned while waiting'] }),
            Text({
              bold: true,
              color: learned ? GOOD : undefined,
              wrap: 'wrap',
              children: [lesson ? (learned ? '✓ ' : '… ') + lesson.topic : '—'],
            }),
            lesson ? Text({ color: COOL, italic: true, wrap: 'wrap', children: [lesson.cards[0].q + '  →  ' + lesson.cards[0].a] }) : Text({ children: [''] }),
          ],
        }),
        Box({
          flexDirection: 'column',
          children: [Text({ color: MUTED, children: ['last 3 weeks'] }), heat],
        }),
        Box({
          flexDirection: 'row',
          columnGap: 3,
          children: [
            Button({
              key: 'copy-wrapped',
              label: 'copy for X',
              hotkey: 'c',
              plain: true,
              autoFocus: true,
              onPress: () => {
                $.ui.copy({ text: wrappedPost(today, streak, lesson, learned) })
                $.ui.toast('Copied. Screenshot this card and paste the text on X.')
              },
            }),
            Button({
              key: 'open-lesson',
              label: 'lesson',
              hotkey: 'l',
              plain: true,
              onPress: async () => {
                await $.ui.close({ id: WRAPPED_PANE })
                await $.ui.open({ id: LESSON_PANE, title: 'meanwhile', focus: true, closeOnEscape: true })
              },
            }),
          ],
        }),
      ],
    })
  })
}

// ── Lesson ──────────────────────────────────────────────────────────────────

async function loadToday($) {
  const key = dayKey(await $.clock.now())
  const saved = await $.store.get('lesson:' + key)
  // Lessons saved before cards existed are regenerated
  if (saved && Array.isArray(saved.cards) && saved.cards.length) {
    lesson = saved
    step = 0
  } else {
    lesson = null
  }
  const day = await $.store.get('day:' + key)
  const sameTopic = !!(day && lesson && day.topic === lesson.topic)
  seen = new Set(sameTopic && Array.isArray(day.seen) ? day.seen : [])
  celebrated = sameTopic && !!day.celebrated
}

async function ensureLesson($, force) {
  if (generating) return
  if (lesson && !force) return
  generating = true
  $.ui.invalidate('ui.render')
  const now = await $.clock.now()
  const key = dayKey(now)
  const history = (await $.store.get('topics')) || []
  try {
    const [news, context] = await Promise.all([fetchNews($, now), projectContext($)])
    let picked = null
    if (news.length) picked = await pickLesson($, news, context, history, lesson && force ? lesson.topic : null)
    if (!picked) picked = offlineLesson(now, history)
    picked.date = key
    lesson = picked
    step = 0
    seen = new Set()
    celebrated = false
    showCard($)
    await $.store.set('lesson:' + key, lesson)
    await $.store.set('topics', [lesson.topic, ...history.filter((t) => t !== lesson.topic)].slice(0, 60))
  } catch (err) {
    if (!lesson) {
      lesson = offlineLesson(now, history)
      lesson.date = key
    }
  } finally {
    generating = false
    $.ui.invalidate('ui.render')
  }
}

async function fetchNews($, now) {
  const items = []
  try {
    const r = await $.http.fetch('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30')
    if (r.ok) {
      const data = JSON.parse(r.text)
      for (const h of data.hits || []) {
        if (!h.title) continue
        items.push({ src: 'HN', title: h.title, url: h.url || 'https://news.ycombinator.com/item?id=' + h.objectID, score: h.points || 0 })
      }
    }
  } catch {}
  try {
    const since = new Date(now - 7 * 864e5).toISOString().slice(0, 10)
    const r = await $.http.fetch(
      'https://api.github.com/search/repositories?q=created:%3E' + since + '&sort=stars&order=desc&per_page=12',
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'meanwhile-mod' } },
    )
    if (r.ok) {
      const data = JSON.parse(r.text)
      for (const repo of data.items || []) {
        items.push({
          src: 'GitHub',
          title: repo.full_name + ': ' + (repo.description || '').slice(0, 140),
          url: repo.html_url,
          score: repo.stargazers_count || 0,
        })
      }
    }
  } catch {}
  return items
}

// What the user is building, so a relevant topic can win
async function projectContext($) {
  const out = []
  try {
    if (await $.fs.exists('package.json')) {
      const pkg = JSON.parse(await $.fs.read('package.json'))
      out.push('JS deps: ' + Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).slice(0, 40).join(', '))
    }
  } catch {}
  try {
    if (await $.fs.exists('pyproject.toml')) out.push('Python project (pyproject.toml)')
    if (await $.fs.exists('Cargo.toml')) out.push('Rust project (Cargo.toml)')
    if (await $.fs.exists('go.mod')) out.push('Go project (go.mod)')
  } catch {}
  return out.join('\n')
}

const SYSTEM = `You pick ONE thing a working developer should learn today and teach it as 4 to 6 question-and-answer cards, glanced at under a loading spinner.
Rules:
- Choose from the provided headlines. Prefer a concrete technique or mechanism a headline is about (e.g. "speculative decoding", "WebGPU compute shaders") over company news, drama, funding, politics, or vague paper titles.
- If a headline fits the user's stack, prefer it. Never repeat a topic from the "already learned" list.
- Card 1's question is the hook: a puzzle the reader already half-wonders about, not "What is X?". Later cards each answer one more "how" or "why".
- Every card stands alone: someone who sees only that one card still learns a whole fact.
- q under 60 characters, a under 65 characters. Plain words, concrete nouns and numbers. No jargon the card doesn't explain. No hype.
- Be accurate. If unsure about a fact, leave it out.
Reply with JSON only:
{"topic":"2-5 words","cards":[{"q":"...","a":"..."}],"example":"one concrete line, code or numbers, under 100 chars","tag":"one word","sourceUrl":"the headline url you used"}`

async function pickLesson($, news, context, history, avoid) {
  const headlines = news
    .slice(0, 42)
    .map((n, i) => i + 1 + '. [' + n.src + '] ' + n.title + ' <' + n.url + '>')
    .join('\n')
  const prompt =
    'Headlines today:\n' + headlines +
    '\n\nUser stack:\n' + (context || 'unknown') +
    '\n\nAlready learned (do not repeat): ' + [avoid, ...history].filter(Boolean).slice(0, 30).join('; ')
  const r = await $.model.complete({ model: 'haiku', system: SYSTEM, prompt, maxTokens: 900, timeoutMs: 45000 })
  const text = typeof r === 'string' ? r : r && r.isAnswered ? r.text : ''
  return parseLesson(text)
}

function parseLesson(text) {
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const j = JSON.parse(text.slice(start, end + 1))
    const cards = (Array.isArray(j.cards) ? j.cards : [])
      .map((c) => ({ q: String((c && c.q) || '').trim(), a: String((c && c.a) || '').trim() }))
      .filter((c) => c.q && c.a)
      .slice(0, 6)
    if (!j.topic || cards.length < 3) return null
    return {
      topic: String(j.topic).trim(),
      cards,
      example: String(j.example || '').trim(),
      tag: String(j.tag || '').replace(/[^\w-]/g, ''),
      sourceUrl: /^https?:\/\//.test(j.sourceUrl || '') ? j.sourceUrl : '',
    }
  } catch {
    return null
  }
}

function offlineLesson(now, history) {
  const fresh = OFFLINE.filter((l) => !history.includes(l.topic))
  const pool = fresh.length ? fresh : OFFLINE
  const l = pool[Math.floor(now / 864e5) % pool.length]
  return { ...l, cards: l.cards.map((c) => ({ ...c })), sourceUrl: '', offline: true }
}

// ── Progress ────────────────────────────────────────────────────────────────

// Read-then-write so parallel sessions add up instead of overwriting
async function flushDay($, turn) {
  const key = 'day:' + dayKey(await $.clock.now())
  const day = (await $.store.get(key)) || { turns: 0, tools: 0, workMs: 0, seen: [] }
  day.tools += pending.tools
  pending.tools = 0
  if (turn) {
    day.turns += 1
    day.workMs += Math.max(0, turn.durationMs || 0)
    day.edits = (day.edits || 0) + turnWork.edits
    day.files = [...new Set([...(day.files || []), ...turnWork.files])].slice(0, 1000)
  }
  // Progress belongs to one topic: a new topic starts from zero
  if (lesson && day.topic && day.topic !== lesson.topic) {
    day.seen = []
    day.learned = false
    day.celebrated = false
  }
  const merged = new Set([...(day.seen || []), ...seen])
  day.seen = [...merged]
  if (lesson) {
    day.topic = lesson.topic
    day.learned = day.seen.length >= lesson.cards.length
  }
  await $.store.set(key, day)
}

async function markCelebrated($) {
  const key = 'day:' + dayKey(await $.clock.now())
  const day = (await $.store.get(key)) || {}
  day.seen = [...new Set([...(day.topic === lesson.topic ? day.seen || [] : []), ...seen])]
  day.topic = lesson.topic
  day.learned = true
  day.celebrated = true
  await $.store.set(key, day)
}

async function lastDays($, n) {
  const now = await $.clock.now()
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const date = dayKey(now - i * 864e5)
    const d = (await $.store.get('day:' + date)) || {}
    out.push({ date, turns: d.turns || 0, tools: d.tools || 0, workMs: d.workMs || 0, edits: d.edits || 0, files: (d.files || []).length, learned: !!d.learned })
  }
  // Today's in-memory progress beats the last flush
  const t = out[out.length - 1]
  t.tools += pending.tools
  if (lesson && seen.size >= lesson.cards.length) t.learned = true
  return out
}

// Consecutive days with a lesson finished; today counts once it's done
function streakOf(days) {
  let s = 0
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].learned) s++
    else if (i === days.length - 1) continue
    else break
  }
  return s
}

// ── Ambient lines ───────────────────────────────────────────────────────────

// One quiet line in the transcript after a turn that changed something.
// Drawn like a system notice, never sent to the model.
function recap($, turn) {
  if (turn.isAborted) return
  const w = turnWork
  if (!w.edits && !w.commands) return
  const parts = []
  if (w.edits) parts.push(w.edits + (w.edits === 1 ? ' edit' : ' edits'))
  if (w.files.size) parts.push(w.files.size + (w.files.size === 1 ? ' file' : ' files'))
  if (w.commands) parts.push(w.commands + (w.commands === 1 ? ' command' : ' commands'))
  parts.push(fmtSeconds(turn.durationMs))
  $.ui.log(parts.join(' · '))
}

// Today's card sits just above the prompt. It stays put between turns and
// only moves on while Claude works, so there is time to think.
function showCard($) {
  $.ui.invalidate('ui.render')
}

function currentCard() {
  const card = lesson.cards[Math.floor(step / STEPS_PER_CARD) % lesson.cards.length]
  return { q: card.q, a: step % STEPS_PER_CARD >= ANSWER_FROM ? card.a : null }
}

// ── Formatting ──────────────────────────────────────────────────────────────

function dayKey(ms) {
  const d = new Date(ms)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function prettyDate(key) {
  const [y, m, d] = (key || '').split('-').map(Number)
  if (!y) return ''
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + ' ' + d
}

function fmtDuration(ms) {
  const m = Math.round((ms || 0) / 60000)
  if (m < 60) return m + 'm'
  return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'
}

function fmtSeconds(ms) {
  const s = Math.round((ms || 0) / 1000)
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's'
}

function shortUrl(u) {
  try {
    const x = new URL(u)
    return x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname.slice(0, 32) : '')
  } catch {
    return u
  }
}

function lessonPost(l) {
  return [
    'TIL while Claude was thinking: ' + l.topic,
    '',
    ...l.cards.flatMap((c) => [c.q, '→ ' + c.a, '']),
    'My Claude Code spinner teaches me one thing a day now. (meanwhile mod)',
  ].join('\n')
}

const DEFAULT_COLOR = 0x01000000
function heatCells(days) {
  const numbers = []
  for (const d of days) {
    const color = d.learned ? 0xd97757 : d.turns ? 0x6a9bcc : 0x4a4a4a
    numbers.push('■'.codePointAt(0), color, DEFAULT_COLOR, ' '.codePointAt(0), DEFAULT_COLOR, DEFAULT_COLOR)
  }
  return new Uint8Array(Uint32Array.from(numbers).buffer).toBase64()
}

function wrappedPost(today, streak, l, learned) {
  const card = l && l.cards && l.cards[0]
  return [
    'Shipped ' + today.edits + ' edits across ' + today.files + ' files with Claude Code today (' + fmtDuration(today.workMs) + ').',
    '',
    l ? (learned ? 'While it worked, I learned ' : "While it worked, I've been learning ") + l.topic + ':' : '',
    card ? card.q : '',
    card ? '→ ' + card.a : '',
    '',
    streak ? '🔥 ' + streak + '-day learning streak' : '',
    '(meanwhile, a Claude Code mod)',
  ]
    .filter((x, i, a) => x !== '' || a[i - 1] !== '')
    .join('\n')
}
