# Claude Code Integration Guide

## Wiring the hook

Add to `~/.claude/settings.json` under `hooks.PreToolUse`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bun /home/compadmin/Projects/supply-guard-hook/src/hooks/SupplyGuard.hook.ts"
          }
        ]
      }
    ]
  }
}
```

Use the absolute path to the hook file. The hook reads from stdin and writes to stdout following the Claude Code hook protocol.

## What happens

- **ALLOW**: Hook exits 0 with `{"continue":true}` — command runs normally, no interruption
- **APPROVE**: Hook exits 0 with `{"decision":"ask","message":"..."}` — Claude Code shows the risk summary and asks you whether to proceed
- **BLOCK**: Hook exits 2 with `{"decision":"block","reason":"..."}` — Claude Code rejects the command and shows the reason

## Testing the integration

In a Claude Code session, ask Claude to run:

```
pip install coloama
```

You should see Claude Code report the block:

```
SupplyGuard blocked package install:
BLOCKED: `coloama` — Known malicious package: Typosquat of colorama — credential harvester (2022)
```

Then try a legitimate package:

```
pip install requests
```

This should proceed without interruption.

## Checking logs after a session

```bash
bun /home/compadmin/Projects/supply-guard-hook/src/cli/review.ts logs --tail 20
bun /home/compadmin/Projects/supply-guard-hook/src/cli/review.ts stats
```

Logs are stored at `~/.supplyguard/logs/YYYY/MM/supplyguard-YYYYMMDD.jsonl`.

## Performance note

The hook adds latency only for package install commands. For all other Bash commands it exits immediately (`~1ms`). For package installs, the metadata checks (PyPI/npm API) add up to 3 seconds (configurable). The threat DB and typosquatting checks are synchronous and complete in `<5ms`.
