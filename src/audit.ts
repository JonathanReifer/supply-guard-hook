import { mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { Decision, Ecosystem, RiskFactor } from "./types.ts";

const LOG_BASE = join(homedir(), ".supplyguard", "logs");

interface AuditEvent {
  timestamp: string;
  ecosystem: Ecosystem;
  package: string;
  decision: Decision;
  totalScore: number;
  factors: RiskFactor[];
  sessionId: string | null;
  project?: string;
  command: string;
  atlasTechnique?: string;
  owaspCategory?: string;
}

function logPath(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return join(LOG_BASE, String(yyyy), mm, `supplyguard-${yyyy}${mm}${dd}.jsonl`);
}

/**
 * Appends an audit event to the daily JSONL log file.
 * Creates the directory structure if it doesn't exist.
 * Fails silently — audit logging must never crash the hook.
 */
export function logDecision(event: Omit<AuditEvent, "timestamp">): void {
  try {
    const path = logPath();
    mkdirSync(dirname(path), { recursive: true });
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event });
    appendFileSync(path, line + "\n", "utf-8");
  } catch {
    // intentionally silent
  }
}

/**
 * Returns the path to the most recent log file that exists.
 */
export function latestLogPath(): string {
  return logPath();
}

export function logBasePath(): string {
  return LOG_BASE;
}
