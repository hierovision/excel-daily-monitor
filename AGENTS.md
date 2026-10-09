# Excel Daily Monitor — Session Rules

This workspace consumes the [ai-framework](https://github.com/hierovision/ai-framework)
library, installed globally (`~/.config/opencode/{skills,agents,reference}`,
via `ai-framework/install.sh`). Framework text wins on updates; this file
carries only project deltas.

## Dispatch supervision (standing rule — fail fast)

Any dispatch wave (parallel Task subagents) runs under the ai-framework
session-tree guard: `python3 ~/repos/ai-framework/scripts/session_guard.py
--root <session-id> --watch 15` (`--wrap -- <cmd>` owns the root so an abort
is mechanical). Known failure patterns — empty results, permission
auto-rejects, identical-retry loops, majority-failed waves, budget overrun —
abort the session in minutes instead of letting a broken wave burn for an
hour. Contract: `reference/subagent-supervision.md` §5 (global link); cite
it, do not copy it here (framework text wins, deltas only).
