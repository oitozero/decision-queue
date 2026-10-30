import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Decision, Step, StepStatus } from '../types'

const PANE = 'decision-queue'
const TOOL = 'mcp__decision-queue__update'
// Change the tag when Board's fields change: it declines what an earlier
// version stored, which outlives a reload.
const board = atom({ plugin: 'decision-queue', key: 'board' } as const, null, {
  shape: 'board-1',
})

type UpdateInput = {
  task?: string
  steps?: string[]
  step?: { title: string; status: StepStatus; note?: string }
  ask?: {
    id: string
    question: string
    options: string[]
    default: string
    held?: boolean
  }
  resolve?: string
  deliverable?: { path: string; note: string }
  finish?: boolean
}

const SCHEMA = {
  type: 'object',
  properties: {
    task: {
      type: 'string',
      description: 'Starts a new board for this task, replacing any old one.',
    },
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Replaces the plan; the first step becomes active.',
    },
    step: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        status: { enum: ['pending', 'active', 'done', 'stuck'] },
        note: { type: 'string', description: 'Why it is stuck, or a short result.' },
      },
      required: ['title', 'status'],
    },
    ask: {
      type: 'object',
      description:
        'Queues a decision for the person. Keep working on `default` unless `held`.',
      properties: {
        id: { type: 'string' },
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
        default: { type: 'string' },
        held: {
          type: 'boolean',
          description:
            'Hard to undo or outward-facing (push, merge, deploy, delete, send, spend): wait for the answer.',
        },
      },
      required: ['id', 'question', 'options', 'default'],
    },
    resolve: {
      type: 'string',
      description: 'Id of a decision that no longer needs an answer.',
    },
    deliverable: {
      type: 'object',
      properties: { path: { type: 'string' }, note: { type: 'string' } },
      required: ['path', 'note'],
    },
    finish: { type: 'boolean', description: 'Marks the task finished.' },
  },
}

const DESCRIPTION = `The person's live progress pane for long tasks (more than 5 steps or over 30 minutes). Call it with \`task\` and \`steps\` before starting, after every step, when a deliverable lands, and with \`ask\` whenever you need a decision: keep working on the default and mention it in one line in chat. Use \`held: true\` for anything hard to undo or outward-facing and do not act on it until answered. The engine stamps every time; never write times yourself. Answers arrive as user messages starting "Decision Queue:".`

function clockTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function applyUpdate(old: Board | null, input: UpdateInput, now: number): Board {
  let next: Board =
    input.task !== undefined || old === null
      ? {
          task: input.task ?? 'Untitled task',
          startedAt: now,
          updatedAt: now,
          steps: [],
          decisions: [],
          deliverables: [],
          isFinished: false,
        }
      : { ...old, updatedAt: now }

  if (input.steps !== undefined) {
    next.steps = input.steps.map(
      (title, i): Step => ({ title, status: i === 0 ? 'active' : 'pending' }),
    )
  }

  if (input.step !== undefined) {
    const { title, status, note } = input.step
    const isKnown = next.steps.some(s => s.title === title)
    const changed: Step = { title, status, ...(note ? { note } : {}) }
    next.steps = isKnown
      ? next.steps.map(s => (s.title === title ? changed : s))
      : [...next.steps, changed]
    // A finished step hands over to the next pending one.
    if (status === 'done' && !next.steps.some(s => s.status === 'active')) {
      const i = next.steps.findIndex(s => s.status === 'pending')
      if (i >= 0) {
        next.steps = next.steps.map((s, j) => (j === i ? { ...s, status: 'active' } : s))
      }
    }
  }

  if (input.ask !== undefined) {
    const { id, question, options, held } = input.ask
    const asked: Decision = {
      id,
      question,
      options: options.includes(input.ask.default) ? options : [input.ask.default, ...options],
      fallback: input.ask.default,
      isHeld: held === true,
      askedAt: now,
    }
    next.decisions = [...next.decisions.filter(d => d.id !== id), asked]
  }

  if (input.resolve !== undefined) {
    next.decisions = next.decisions.filter(d => d.id !== input.resolve)
  }

  if (input.deliverable !== undefined) {
    next.deliverables = [...next.deliverables, { ...input.deliverable, at: now }]
  }

  if (input.finish === true) {
    next = { ...next, isFinished: true }
  }

  return next
}

function waiting(b: Board | null): Decision[] {
  return b === null ? [] : b.decisions.filter(d => d.answer === undefined)
}

async function showStatus($: EngineInterface): Promise<void> {
  const open = waiting(await read($, board))
  const held = open.filter(d => d.isHeld).length

  $.ui.status(
    open.length === 0
      ? undefined
      : held > 0
        ? `${held} held, ${open.length - held} on defaults`
        : `${open.length} decision${open.length === 1 ? '' : 's'} on defaults`,
  )
}

// Module variables start over on a reload; a turn in flight then reads as
// idle and an answer is queued as a prompt instead of folded in.
let isTurnRunning = false

async function answer($: EngineInterface, id: string, choice: string): Promise<void> {
  const now = await $.clock.now()
  const b = await read($, board)
  const decision = b?.decisions.find(d => d.id === id)
  if (decision === undefined || decision.answer !== undefined) return

  await update($, board, old =>
    old === null
      ? old
      : {
          ...old,
          updatedAt: now,
          decisions: old.decisions.map(d =>
            d.id === id ? { ...d, answer: choice, answeredAt: now } : d,
          ),
        },
  )
  await showStatus($)

  const text =
    `Decision Queue: for "${decision.question}" (id ${id}) the person chose "${choice}".` +
    (decision.isHeld
      ? ' This was held; act on it now.'
      : choice === decision.fallback
        ? ' That confirms the default you are using.'
        : ` Switch from your default "${decision.fallback}" to this.`)

  // Mid-turn, the row reaches the model at its next step; idle, it starts a turn.
  if (isTurnRunning) {
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
  } else {
    void $.prompt.submit({ text })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'update',
      description: DESCRIPTION,
      inputSchema: SCHEMA,
      isDeferred: false,
    })
    await $.command.register({
      name: 'queue',
      description: 'Open the Decision Queue pane',
    })
    await showStatus($)

    return next(e)
  })

  on('command.run', { command: 'queue' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Decision Queue' })

    return { text: 'Decision Queue opened.' }
  })

  on('turn.start', ($, e, next) => {
    isTurnRunning = true

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    isTurnRunning = false

    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    // The tool's arguments arrive beside tool.call's own keys.
    const input = e as unknown as UpdateInput
    const now = await $.clock.now()
    const wasEmpty = (await read($, board)) === null
    const b = await update($, board, old => applyUpdate(old, input, now))

    if (wasEmpty || input.task !== undefined) {
      void $.ui.open({ id: PANE, title: 'Decision Queue' })
    }
    if (input.ask !== undefined) {
      $.ui.toast(input.ask.held ? `Held for you: ${input.ask.question}` : `Decision queued: ${input.ask.question}`)
    }
    await showStatus($)

    const active = b?.steps.find(s => s.status === 'active')
    return {
      result: `Board updated at ${clockTime(now)}. ${waiting(b).length} open decisions${active ? `; active step: ${active.title}` : ''}.`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const b = await read($, board)

    if (b === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No task on the board yet.</Text>
        </Box>
      )
    }

    const open = waiting(b)
    const held = open.filter(d => d.isHeld)
    const onDefault = open.filter(d => !d.isHeld)
    const answered = b.decisions.filter(d => d.answer !== undefined)
    const done = b.steps.filter(s => s.status === 'done').length
    const mark: Record<StepStatus, string> = {
      done: '✓',
      active: '▸',
      pending: '·',
      stuck: '!',
    }

    // The top decision answers to the number keys while the pane has focus;
    // giving them to every card would clash, and the later card would win.
    const top = held[0] ?? onDefault[0]

    const decisionRow = (d: Decision) => (
      <Box
        flexDirection="column"
        gap="xs"
        marginBottom="sm"
        paddingX="sm"
        paddingY="xs"
        borderStyle="round"
        borderColor={d.isHeld ? 'warning' : undefined}
        borderDimColor={!d.isHeld}
      >
        <Text bold>
          {d.isHeld ? 'HELD · ' : ''}
          {d.question} <Text dimColor>{clockTime(d.askedAt)}</Text>
        </Text>
        {!d.isHeld && <Text dimColor>Running on: {d.fallback}</Text>}
        <Box flexDirection="row" flexWrap="wrap" columnGap="sm" rowGap="xs" marginTop="xs">
          {d.options.map((option, i) => (
            <Button
              key={`${d.id}:${option}`}
              label={option === d.fallback && !d.isHeld ? `${option} (default)` : option}
              variant={option === d.fallback ? 'primary' : 'secondary'}
              hotkey={d === top && i < 9 ? String(i + 1) : undefined}
              onPress={() => answer($, d.id, option)}
            />
          ))}
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text bold>{b.task}</Text>
        <Text dimColor>
          {b.isFinished ? 'Finished' : `${done}/${b.steps.length} steps`} · started{' '}
          {clockTime(b.startedAt)} · updated {clockTime(b.updatedAt)}
        </Text>

        {held.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Waiting on you</Text>
            {held.map(decisionRow)}
          </Box>
        )}

        {onDefault.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Running on a default</Text>
            {onDefault.map(decisionRow)}
          </Box>
        )}

        {b.steps.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Steps</Text>
            {b.steps.map(s => (
              <Text dimColor={s.status === 'done' || s.status === 'pending'}>
                {mark[s.status]} {s.title}
                {s.note ? ` — ${s.note}` : ''}
              </Text>
            ))}
          </Box>
        )}

        {b.deliverables.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Deliverables</Text>
            {b.deliverables.map(d => (
              <Text>
                {d.path} <Text dimColor>— {d.note} · {clockTime(d.at)}</Text>
              </Text>
            ))}
          </Box>
        )}

        {answered.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Answered</Text>
            {answered.map(d => (
              <Text dimColor>
                {d.question} → {d.answer} · {clockTime(d.answeredAt ?? d.askedAt)}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
