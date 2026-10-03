import { expect, mock, test } from 'claude-code/testing'

const LESSON = {
  topic: 'Speculative decoding',
  cards: [
    { q: 'Why is it faster?', a: 'A small model drafts.' },
    { q: 'Who checks?', a: 'The big model, in one pass.' },
    { q: 'Same output?', a: 'Yes, identical.' },
  ],
  example: 'draft 4 tokens, accept 3',
  tag: 'AI',
  sourceUrl: 'https://example.com/post',
}

const ABOVE = {
  plugin: 'meanwhile',
  component: 'AbovePrompt',
  requestId: 'main',
  viewport: { columns: 140, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100 },
} as const

async function cardText($: any, surface: 'terminal' | 'desktop', text: string | RegExp) {
  const ui = await $.ui.mount({ ...ABOVE, surface })
  const found = await ui.find({ type: 'Text', text })
  await ui.unmount()
  return found
}

const pane = (requestId: string) =>
  ({
    plugin: 'meanwhile',
    component: 'Pane',
    requestId,
    viewport: { columns: 140, rows: 40 },
    props: { title: 'meanwhile', isFocused: true, bodyColumns: 72, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  }) as const


function stubAll(on: any, saved: Map<string, unknown>, calls: { http: number; toasts: string[]; opened?: string[]; status?: string[]; logs?: string[]; copied?: string[] }) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2, 9) })
  on('session.start', () => ({ cwd: '/work' }))
  on('command.run', () => ({}))
  on('store.get', ($: any, e: any) => ({ value: saved.get(e.key) }))
  on('store.set', ($: any, e: any) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => {
    calls.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($: any, e: any) => {
    calls.opened?.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.status', ($: any, e: any) => {
    calls.status?.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($: any, e: any) => {
    calls.logs?.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', ($: any, e: any) => {
    calls.copied?.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))
  on('http.fetch', ($: any, e: any) => {
    calls.http += 1
    const hn = { hits: [{ title: 'Speculative decoding explained', url: 'https://example.com/post', points: 400, objectID: '1' }] }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(e.url.includes('algolia') ? hn : { items: [] }) } }
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '```json\n' + JSON.stringify(LESSON) + '\n```' } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['✻ Sauteing…'] }))
  return clock
}

test('generates a lesson and shows its first question in a card above the prompt', async ($, on) => {
  const saved = new Map<string, unknown>()
  const status: string[] = []
  const calls = { http: 0, toasts: [] as string[], status }
  const clock = stubAll(on, saved, calls)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(100)
  await clock.settle()

  expect(calls.http).toBe(2)
  expect(saved.get('lesson:2026-10-02')).toBeDefined()
  expect(calls.toasts.length).toBe(0)

  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await cardText($, surface, 'Why is it faster?')).toBeDefined()
  }
})

test('lesson pane draws on both surfaces and copies a post', async ($, on) => {
  const saved = new Map<string, unknown>([['lesson:2026-10-02', { ...LESSON, date: '2026-10-02' }]])
  const calls = { http: 0, toasts: [] as string[] }
  const clock = stubAll(on, saved, calls)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.settle()
  // Saved lesson is reused, no network
  expect(calls.http).toBe(0)

  await $.command.run({ command: 'meanwhile', args: '' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('meanwhile-lesson'), surface })
    expect(await ui.find({ type: 'Text', text: 'Speculative decoding' })).toBeDefined()
    await ui.press({ key: 'copy' })
    await ui.unmount()
  }

  expect(calls.toasts.filter((t) => t.startsWith('Copied')).length).toBe(2)
})

test('falls back to an offline lesson when the network is down', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2, 9) })
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('http.fetch', () => ({ deny: 'offline' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(100)
  await clock.settle()

  const l = saved.get('lesson:2026-10-02') as any
  expect(l.offline).toBe(true)
  expect(l.cards.length).toBeGreaterThan(3)
})

test('holds each question for 40s of Claude working before the answer', async ($, on) => {
  const saved = new Map<string, unknown>([['lesson:2026-10-02', { ...LESSON, date: '2026-10-02' }]])
  const calls = { http: 0, toasts: [] as string[] }
  const clock = stubAll(on, saved, calls)
  on('turn.start', () => ({ turnId: 't1' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await clock.settle()
  await clock.advance(120000) // idle: nothing moves
  await clock.settle()
  expect(await cardText($, 'desktop', '→ A small model drafts.')).toBeUndefined()

  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await clock.advance(35000)
  await clock.settle()
  expect(await cardText($, 'desktop', '→ A small model drafts.')).toBeUndefined()
  await clock.advance(5000)
  await clock.settle()
  expect(await cardText($, 'desktop', '→ A small model drafts.')).toBeDefined()
  await clock.advance(20000)
  await clock.settle()
  expect(await cardText($, 'desktop', 'Who checks?')).toBeDefined()
})

test('after every answer, the card becomes the proud moment and /wrapped has a post worth sharing', async ($, on) => {
  const saved = new Map<string, unknown>([['lesson:2026-10-02', { ...LESSON, date: '2026-10-02' }]])
  const calls = { http: 0, toasts: [] as string[] }
  const clock = stubAll(on, saved, calls)
  let copied = ''
  on('turn.start', () => ({ turnId: 't1' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.settle()
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await clock.advance(180000)
  await clock.settle()
  expect(await cardText($, 'terminal', '✓ You learned Speculative decoding today')).toBeDefined()
  expect(await cardText($, 'terminal', /\/wrapped to share your day/)).toBeDefined()

  // Shown once: the next message clears it for the rest of the day, in every session
  await $.turn.start({ turnId: 't2', prompt: 'next' } as any)
  await clock.settle()
  expect(await cardText($, 'terminal', '✓ You learned Speculative decoding today')).toBeUndefined()
  expect((saved.get('day:2026-10-02') as any).celebrated).toBe(true)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.settle()
  expect(await cardText($, 'terminal', /You learned|Why is it faster/)).toBeUndefined()
})

test('regenerates a lesson saved in the old format', async ($, on) => {
  const saved = new Map<string, unknown>([['lesson:2026-10-02', { topic: 'Old', chunks: ['a.', 'b.', 'c.'], date: '2026-10-02' }]])
  const calls = { http: 0, toasts: [] as string[] }
  const clock = stubAll(on, saved, calls)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(100)
  await clock.settle()
  expect((saved.get('lesson:2026-10-02') as any).cards.length).toBe(3)
})

test('/wrapped opens only when asked and copies a post', async ($, on) => {
  const saved = new Map<string, unknown>([['lesson:2026-10-02', { ...LESSON, date: '2026-10-02' }]])
  const opened: string[] = []
  const calls = { http: 0, toasts: [] as string[], opened }
  const clock = stubAll(on, saved, calls)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await clock.advance(60000)
  await clock.settle()
  expect(opened.length).toBe(0)

  await $.command.run({ command: 'wrapped', args: '' })
  expect(opened).toEqual(['meanwhile-wrapped'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('meanwhile-wrapped'), surface })
    expect(await ui.find({ type: 'Text', text: 'TODAY IN CLAUDE CODE' })).toBeDefined()
    await ui.press({ key: 'copy-wrapped' })
    await ui.unmount()
  }
  expect(calls.toasts.filter((t) => t.startsWith('Copied')).length).toBe(2)
})

test('shows a recap after a turn that changed things', async ($, on) => {
  const saved = new Map<string, unknown>([['lesson:2026-10-02', { ...LESSON, date: '2026-10-02' }]])
  const status: string[] = []
  const logs: string[] = []
  const copied: string[] = []
  const calls = { http: 0, toasts: [] as string[], status, logs, copied }
  const clock = stubAll(on, saved, calls)
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', () => ({ text: 'done' }))
  on('classic.PreToolUse', () => ({}))
  for (const tool of ['Edit', 'Bash']) on('tool.call', { tool }, () => ({ result: {} as any, isError: false, text: 'ok' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await clock.settle()

  await $.turn.start({ turnId: 't1', prompt: 'hi' } as any)
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.js', old_string: 'a', new_string: 'b' } as any)
  await $.tool.call({ tool: 'Edit', file_path: '/work/b.js', old_string: 'a', new_string: 'b' } as any)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as any)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 72000, isAborted: false, reason: 'end_turn' } as any)
  await clock.settle()

  expect(logs).toEqual(['2 edits · 2 files · 1 command · 1m12s'])

  // The share post leads with what got shipped, then teaches the reader one thing
  await $.command.run({ command: 'wrapped', args: '' })
  const ui = await $.ui.mount({ ...pane('meanwhile-wrapped'), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '2 edits · 2 files' })).toBeDefined()
  await ui.press({ key: 'copy-wrapped' })
  await ui.unmount()
  expect(copied[0].split('\n').slice(0, 5)).toEqual([
    'Shipped 2 edits across 2 files with Claude Code today (1m).',
    '',
    "While it worked, I've been learning Speculative decoding:",
    'Why is it faster?',
    '→ A small model drafts.',
  ])
})

test("a new topic starts fresh even after today's earlier topic was learned", async ($, on) => {
  const saved = new Map<string, unknown>([
    ['lesson:2026-10-02', { ...LESSON, date: '2026-10-02' }],
    ['day:2026-10-02', { turns: 3, tools: 9, workMs: 60000, seen: [0, 1, 2, 3, 4, 5, 6], topic: 'GRPO credit assignment', learned: true, celebrated: true }],
  ])
  const calls = { http: 0, toasts: [] as string[] }
  const clock = stubAll(on, saved, calls)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await clock.settle()
  expect(await cardText($, 'desktop', 'Why is it faster?')).toBeDefined()
})

test('Show answer, Skip and Next move the card on demand', async ($, on) => {
  const saved = new Map<string, unknown>([['lesson:2026-10-02', { ...LESSON, date: '2026-10-02' }]])
  const calls = { http: 0, toasts: [] as string[] }
  const clock = stubAll(on, saved, calls)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...ABOVE, surface })
    expect(await ui.find({ type: 'Text', text: 'Why is it faster?' })).toBeDefined()
    await ui.press({ key: 'mw-show' })
    await ui.unmount()
    expect(await cardText($, surface, '→ A small model drafts.')).toBeDefined()
    const ui2 = await $.ui.mount({ ...ABOVE, surface })
    await ui2.press({ key: 'mw-next' })
    await ui2.unmount()
    expect(await cardText($, surface, 'Who checks?')).toBeDefined()
    const ui3 = await $.ui.mount({ ...ABOVE, surface })
    await ui3.press({ key: 'mw-skip' })
    await ui3.unmount()
    expect(await cardText($, surface, 'Same output?')).toBeDefined()
    // back to the first card for the next surface
    const ui4 = await $.ui.mount({ ...ABOVE, surface })
    await ui4.press({ key: 'mw-skip' })
    await ui4.unmount()
  }
})
