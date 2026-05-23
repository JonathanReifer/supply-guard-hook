#!/usr/bin/env bun
/**
 * SupplyGuard CLI — review audit logs and test package commands.
 *
 * Usage:
 *   bun src/cli/review.ts logs [--tail N] [--decision block|approve|allow]
 *   bun src/cli/review.ts stats
 *   bun src/cli/review.ts test "<shell command>"
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { parse } from "../parser.ts";
import { evaluateCommand, worstDecision, DEFAULT_POLICY } from "../evaluator.ts";
import { logBasePath } from "../audit.ts";
import type { Decision } from "../types.ts";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function colorDecision(d: Decision): string {
  if (d === "block") return `${RED}${BOLD}BLOCK${RESET}`;
  if (d === "approve") return `${YELLOW}${BOLD}APPROVE${RESET}`;
  return `${GREEN}ALLOW${RESET}`;
}

// ── gather all JSONL log files ─────────────────────────────────────────────

function collectLogFiles(base: string): string[] {
  const files: string[] = [];
  try {
    for (const year of readdirSync(base)) {
      const yearDir = join(base, year);
      if (!statSync(yearDir).isDirectory()) continue;
      for (const month of readdirSync(yearDir)) {
        const monthDir = join(yearDir, month);
        if (!statSync(monthDir).isDirectory()) continue;
        for (const file of readdirSync(monthDir)) {
          if (file.endsWith(".jsonl")) files.push(join(monthDir, file));
        }
      }
    }
  } catch {
    // no logs yet
  }
  return files.sort();
}

interface LogEntry {
  timestamp: string;
  ecosystem: string;
  package: string;
  decision: Decision;
  totalScore: number;
  factors: Array<{ name: string; score: number; reason: string }>;
  sessionId: string | null;
  command: string;
}

function readAllLogs(base: string): LogEntry[] {
  const files = collectLogFiles(base);
  const entries: LogEntry[] = [];
  for (const f of files) {
    const lines = readFileSync(f, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try { entries.push(JSON.parse(line) as LogEntry); } catch { /* skip malformed */ }
    }
  }
  return entries;
}

// ── subcommands ────────────────────────────────────────────────────────────

function cmdLogs(args: string[]): void {
  const tailIdx = args.indexOf("--tail");
  const tail = tailIdx !== -1 ? parseInt(args[tailIdx + 1] ?? "20", 10) : 20;
  const decisionIdx = args.indexOf("--decision");
  const filterDecision = decisionIdx !== -1 ? (args[decisionIdx + 1] as Decision) : null;

  const base = logBasePath();
  let entries = readAllLogs(base);

  if (filterDecision) entries = entries.filter((e) => e.decision === filterDecision);
  const slice = entries.slice(-tail);

  if (slice.length === 0) {
    console.log("No log entries found.");
    return;
  }

  for (const e of slice) {
    const ts = new Date(e.timestamp).toLocaleString();
    const topReason = e.factors[0]?.reason ?? "";
    console.log(
      `${DIM}${ts}${RESET} [${e.ecosystem}] ${BOLD}${e.package}${RESET} → ${colorDecision(e.decision)} ${DIM}(${e.totalScore}/100)${RESET}`,
    );
    if (topReason) console.log(`   ${DIM}${topReason}${RESET}`);
  }
}

function cmdStats(): void {
  const base = logBasePath();
  const entries = readAllLogs(base);

  if (entries.length === 0) {
    console.log("No log entries found.");
    return;
  }

  const counts = { block: 0, approve: 0, allow: 0 };
  const byEcosystem: Record<string, number> = {};
  const topBlocked: Record<string, number> = {};

  for (const e of entries) {
    counts[e.decision]++;
    byEcosystem[e.ecosystem] = (byEcosystem[e.ecosystem] ?? 0) + 1;
    if (e.decision === "block") topBlocked[e.package] = (topBlocked[e.package] ?? 0) + 1;
  }

  console.log(`\n${BOLD}SupplyGuard Stats${RESET} — ${entries.length} total decisions\n`);
  console.log(`  ${colorDecision("block")}   ${counts.block}`);
  console.log(`  ${colorDecision("approve")} ${counts.approve}`);
  console.log(`  ${colorDecision("allow")}   ${counts.allow}`);

  console.log(`\n${BOLD}By ecosystem:${RESET}`);
  for (const [eco, n] of Object.entries(byEcosystem).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${eco.padEnd(8)} ${n}`);
  }

  const topBlockedEntries = Object.entries(topBlocked).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topBlockedEntries.length > 0) {
    console.log(`\n${BOLD}Most blocked packages:${RESET}`);
    for (const [pkg, n] of topBlockedEntries) {
      console.log(`  ${pkg.padEnd(30)} ${n}×`);
    }
  }
  console.log();
}

async function cmdTest(command: string): Promise<void> {
  if (!command) {
    console.error("Usage: review test \"<shell command>\"");
    process.exit(1);
  }

  console.log(`\n${BOLD}Testing:${RESET} ${command}\n`);

  const parsed = parse(command);
  if (!parsed) {
    console.log(`${DIM}Not a recognized package install command.${RESET}`);
    return;
  }

  console.log(`${DIM}Ecosystem: ${parsed.ecosystem} | Packages: ${parsed.packages.join(", ")}${RESET}`);
  if (parsed.isExec) console.log(`${YELLOW}⚡ Exec mode (npx/bunx) — executes package directly${RESET}`);
  if (parsed.customRegistry) console.log(`${YELLOW}⚠ Custom registry: ${parsed.customRegistry}${RESET}`);
  if (parsed.gitUrls.length > 0) console.log(`${YELLOW}⚠ Git URL install: ${parsed.gitUrls.join(", ")}${RESET}`);
  console.log();

  const results = await evaluateCommand(parsed, DEFAULT_POLICY);
  const overall = worstDecision(results);

  for (const r of results) {
    console.log(`Package: ${BOLD}${r.package}${RESET} → ${colorDecision(r.decision)} (${r.totalScore}/100)`);
    for (const f of r.factors) {
      console.log(`  ${DIM}• [${f.name}] +${f.score} — ${f.reason}${RESET}`);
    }
    console.log(`  ${r.recommendation}`);
    console.log();
  }

  console.log(`${BOLD}Overall decision: ${colorDecision(overall)}${RESET}\n`);
}

// ── entrypoint ─────────────────────────────────────────────────────────────

const [, , subcmd, ...rest] = process.argv;

switch (subcmd) {
  case "logs":
    cmdLogs(rest);
    break;
  case "stats":
    cmdStats();
    break;
  case "test":
    await cmdTest(rest.join(" "));
    break;
  default:
    console.log(`SupplyGuard CLI

Usage:
  bun src/cli/review.ts logs [--tail N] [--decision block|approve|allow]
  bun src/cli/review.ts stats
  bun src/cli/review.ts test "<shell command>"

Examples:
  bun src/cli/review.ts test "pip install coloama"
  bun src/cli/review.ts test "npx create-react-app ."
  bun src/cli/review.ts logs --tail 10 --decision block
  bun src/cli/review.ts stats
`);
}
