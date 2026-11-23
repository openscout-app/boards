# Scout boards

Scout's work board inside an agent's thread. The lifecycle's stations are the
columns and the work items are the cards. You can move a card, review a move,
or continue work without leaving the agent.

The board is the one the Scout app draws, built from the same components.
Sessions and the full work item stay in Scout: they open in the Scout web app
on your host.

This repository holds built output only. Scout's source lives elsewhere.

## Install

| Host | How |
| --- | --- |
| Claude Code | `claude plugin marketplace add openscout-app/claude-scout`, then `claude plugin install scout-boards@openscout` |
| Codex | `codex plugin marketplace add openscout-app/claude-scout`, then `codex plugin add scout-boards@openscout` |
| T3 Code | Runs Claude Code: install it there |
| Capy | Add the plugin from `https://github.com/openscout-app/boards/tree/main/plugin` |

Then ask the agent for the work board.

## What it needs

- Scout on the same host, with its web app running. The plugin reads the board
  from the web app with the operator credential that the `scout` CLI uses. It
  doesn't create one.
- Node 20 or later.

| Variable | Use |
| --- | --- |
| `SCOUT_WEB_URL` | The Scout web app, when it isn't on the configured local port |
| `OPENSCOUT_WEB_AUTH_TOKEN` | The operator credential, when it isn't in Scout's support directory |

## Tools

| Tool | Called by | Does |
| --- | --- | --- |
| `work_board` | The model | Shows the board, and returns its columns and cards as text |
| `api_read` | The view | Reads the board, the move ledger, agents and the operator name, and checks a move without making it |
| `api_write` | The view | Moves a card, reviews a move, or continues work. Hosts ask the person first |

The view's tools accept a fixed list of Scout paths and nothing else. Every
move goes through the Scout runtime, which checks it against the lifecycle's
rules and records it.
