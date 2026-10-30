export type StepStatus = 'pending' | 'active' | 'done' | 'stuck'

export type Step = { title: string; status: StepStatus; note?: string }

// A question Claude is working around. `isHeld` marks one that is hard to
// undo or outward-facing: no default runs, Claude waits for the answer.
export type Decision = {
  id: string
  question: string
  options: string[]
  fallback: string
  isHeld: boolean
  askedAt: number
  answer?: string
  answeredAt?: number
}

export type Deliverable = { path: string; note: string; at: number }

export type Board = {
  task: string
  startedAt: number
  updatedAt: number
  steps: Step[]
  decisions: Decision[]
  deliverables: Deliverable[]
  isFinished: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'decision-queue': { board: Shaped<Board | null> }
  }
}
