# CLAUDE.md

See [`AGENTS.md`](./AGENTS.md) for agent instructions — single
source of truth across Claude Code, Cursor, Codex, Copilot, Gemini,
and Jules.

## Claude Code specifics

- Project-level permission allowlist lives in
  [`.claude/settings.json`](./.claude/settings.json). Edit that
  (not the user-level settings) to loosen/tighten the prompts for
  this repo.
- Slash commands for this repo, if any, live under
  `.claude/commands/`. None today.
- When the user asks for a new tool or bug fix, start by reading
  `AGENTS.md` → **Adding a new tool** before writing code. The
  recipe is file-by-file and avoids most of the churn.
