# Decision Queue

A Claude Code mod for long tasks. It puts a pane beside the chat that shows:

- **Waiting on you**: actions that are hard to undo or outward-facing (push, deploy, delete, send). Claude holds these until you answer.
- **Running on a default**: questions Claude asked without stopping, the default it's using, and a button for each option.
- **Steps**: the plan, with the active and stuck steps marked.
- **Deliverables** and **Answered**, each with a time.

Click an answer and it reaches Claude right away. Mid-turn, Claude reads it before its next step. When idle, it starts a turn. Times come from the engine's clock, never from the model. The status line shows how many decisions are open, and `/queue` reopens the pane.

Claude drives it through one tool, `mcp__decision-queue__update`, which is always in its tool list. Its description tells Claude when to use it: tasks with more than 5 steps or over 30 minutes.

## Install

At the prompt of a terminal session:

```
/plugin install decision-queue --marketplace oitozero/decision-queue
```

From a shell:

```bash
claude plugin install decision-queue --marketplace oitozero/decision-queue
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `oitozero/decision-queue`, then Add plugin.

Answer `y` to add the marketplace, then pick a scope. The mod is active at once.

## Keys

With the pane focused, `1`, `2`, … answer the top open decision (held ones first).

## Develop

```bash
claude plugin validate .
claude plugin test .
```
