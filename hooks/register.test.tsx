import { expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__decision-queue__update'
const PANE = {
  plugin: 'decision-queue',
  component: 'Pane',
  requestId: 'decision-queue',
  props: {
    title: 'Decision Queue',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('steps advance and a decision shows with its default, on every surface', async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.tool.call({ tool: TOOL, task: 'Ship billing page', steps: ['Schema', 'API', 'UI'] })
  await $.tool.call({ tool: TOOL, step: { title: 'Schema', status: 'done' } })
  await $.tool.call({
    tool: TOOL,
    ask: { id: 'currency', question: 'Store cents or decimals?', options: ['cents', 'decimals'], default: 'cents' },
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /1\/3 steps/ }))?.text).toMatch(/1\/3 steps/)
    expect((await ui.find({ type: 'Text', text: /▸ API/ }))?.text).toBe('▸ API')
    expect((await ui.find({ type: 'Text', text: /Running on: cents/ }))?.text).toBe('Running on: cents')
    await ui.unmount()
  }
})

test('pressing an answer records it and starts a turn when idle', async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const submitted: string[] = []
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })

  await $.tool.call({ tool: TOOL, task: 'Deploy', steps: ['Build'] })
  await $.tool.call({
    tool: TOOL,
    ask: { id: 'push', question: 'Push to main?', options: ['yes', 'no'], default: 'no', held: true },
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /HELD/ }))?.text).toMatch(/Push to main\?/)
  await ui.press({ key: 'push:yes' })

  expect(submitted.length).toBe(1)
  expect(submitted[0]).toMatch(/chose "yes".*held; act on it now/)
  expect((await ui.find({ type: 'Text', text: /→ yes/ }))?.text).toMatch(/Push to main\? → yes/)
  await ui.unmount()
})

test('a board an earlier version stored is declined', async ($, on) => {
  on('state.get', () => ({ value: { value: { task: 'old' }, version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No task on the board yet.')
  await ui.unmount()
})
