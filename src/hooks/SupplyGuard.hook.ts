#!/usr/bin/env bun
/**
 * SupplyGuard — Claude Code PreToolUse hook
 *
 * Intercepts Bash tool calls and evaluates any package install commands
 * (pip, npm, bun add, npx, bunx, yarn, pnpm, cargo, gem) for supply chain risks.
 *
 * Protocol (compatible with Claude Code hook spec):
 *   stdin:  JSON { session_id?, tool_name, tool_input }
 *   stdout: JSON { continue: true } | { decision: "block", reason } | { decision: "ask", message }
 *   exit:   0 for allow/ask, 2 for hard block
 *
 * Always fails open (exit 0, continue: true) on any internal error.
 */

import { parse } from "../parser.ts";
import { evaluateCommand, worstDecision, DEFAULT_POLICY } from "../evaluator.ts";
import { logDecision } from "../audit.ts";
import { emitLog, flushTelemetry } from "../telemetry/otel.ts";
import { deriveProject } from "../project.ts";
import type { ClaudeHookInput, ClaudeHookOutput } from "../types.ts";

const STDIN_TIMEOUT_MS = 500;

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stdin timeout")), STDIN_TIMEOUT_MS);
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => { data += chunk; });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function allow(): never {
  process.stdout.write(JSON.stringify({ continue: true } satisfies ClaudeHookOutput) + "\n");
  process.exit(0);
}

function block(reason: string): never {
  process.stdout.write(JSON.stringify({ decision: "block", reason } satisfies ClaudeHookOutput) + "\n");
  process.exit(2);
}

function ask(message: string): never {
  process.stdout.write(JSON.stringify({ decision: "ask", message } satisfies ClaudeHookOutput) + "\n");
  process.exit(0);
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readStdin();
  } catch {
    allow(); // timeout or stdin error — fail open
  }

  let input: ClaudeHookInput;
  try {
    input = JSON.parse(raw!) as ClaudeHookInput;
  } catch {
    allow(); // malformed JSON — fail open
  }

  // Only intercept Bash / shell tool calls
  const toolName = input!.tool_name ?? "";
  if (!["Bash", "bash", "shell", "run_command", "execute_command"].includes(toolName)) {
    allow();
  }

  const command = (input!.tool_input as { command?: string })?.command ?? "";
  if (!command) allow();

  const parsed = parse(command);
  if (!parsed) allow(); // not a package install command

  let results;
  try {
    results = await evaluateCommand(parsed!, DEFAULT_POLICY);
  } catch (err) {
    // Fail open, but record the degradation so it isn't silent (see aih-security P0.2).
    process.stderr.write(`[supplyguard] evaluator error: ${err}\n`);
    const sid = input!.session_id ?? null;
    const proj = deriveProject(input!.cwd);
    logDecision({
      ecosystem: parsed!.ecosystem,
      package: "(evaluator-error)",
      decision: "allow",
      totalScore: 0,
      factors: [],
      sessionId: sid,
      project: proj,
      command,
      degraded: true,
      degradedReason: String(err),
    });
    await flushTelemetry(
      emitLog({
        session_id: sid ?? undefined,
        project: proj,
        harness: "claude-code",
        scanner_id: "pipeline/degraded",
        event_type: "package_install",
        decision: "allow",
        severity: "warn",
        degraded: true,
      }),
    );
    allow();
  }

  if (!results || results.length === 0) allow();

  const decision = worstDecision(results!);
  const sessionId = input!.session_id ?? null;
  const project = deriveProject(input!.cwd);

  // Log every decision
  for (const result of results!) {
    logDecision({
      ecosystem: result.ecosystem,
      package: result.package,
      decision: result.decision,
      totalScore: result.totalScore,
      factors: result.factors,
      sessionId,
      project,
      command,
      atlasTechnique: "AML.T0010",
      owaspCategory: "LLM03",
    });
  }

  await flushTelemetry(
    Promise.all(
      results!.map((result) =>
        emitLog({
          session_id: sessionId ?? undefined,
          project,
          harness: "claude-code",
          scanner_id: `supply-chain/${result.ecosystem}`,
          event_type: "package_install",
          decision: result.decision === "approve" ? "ask" : result.decision,
          severity: result.decision === "block" ? "block" : "warn",
          atlas_technique: "AML.T0010",
          owasp_category: "LLM03",
        })
      )
    ).then(() => undefined)
  );

  if (decision === "allow") {
    allow();
  }

  // Build human-readable summary
  const blockedPkgs = results!.filter((r) => r.decision === "block");
  const riskyPkgs = results!.filter((r) => r.decision === "approve");

  if (decision === "block") {
    const reasons = blockedPkgs.map((r) => r.recommendation).join("\n");
    block(`SupplyGuard blocked package install:\n${reasons}`);
  }

  // approve — ask user
  const summary = riskyPkgs
    .map((r) => `• ${r.package} (risk score ${r.totalScore}/100): ${r.factors.map((f) => f.reason).join("; ")}`)
    .join("\n");
  ask(`SupplyGuard detected risky packages:\n${summary}\n\nAllow this install?`);
}

main().catch((err) => {
  process.stderr.write(`[supplyguard] unexpected error: ${err}\n`);
  process.stdout.write(JSON.stringify({ continue: true }) + "\n");
  process.exit(0);
});
