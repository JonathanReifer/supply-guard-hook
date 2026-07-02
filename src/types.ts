export type Ecosystem = "pip" | "npm" | "bun" | "npx" | "bunx" | "yarn" | "pnpm" | "cargo" | "gem";

export interface ParsedInstall {
  ecosystem: Ecosystem;
  packages: string[];       // raw names without version specifier
  rawSpecs: string[];       // "requests==2.28.0", "some-lib@^1.0"
  flags: string[];
  customRegistry: string | null;  // non-standard --index-url / --registry value
  gitUrls: string[];        // git+https:// or github.com/... sources
  isExec: boolean;          // true for npx/bunx (execute, not just install)
}

export type Decision = "allow" | "block" | "approve";

export interface RiskFactor {
  name: string;
  score: number;   // 0–100 contribution
  reason: string;
}

export interface RiskResult {
  package: string;
  ecosystem: Ecosystem;
  totalScore: number;
  decision: Decision;
  factors: RiskFactor[];
  recommendation: string;
}

export interface Policy {
  blockThreshold: number;   // default 80
  approveThreshold: number; // default 40
  metadataTimeoutMs: number;
  flagCustomRegistry: boolean;
  flagGitInstalls: boolean;
  flagExecCommands: boolean;
}

export interface ThreatEntry {
  name: string;
  reason: string;
  cve?: string;
}

export interface ThreatDB {
  version: string;
  packages: Partial<Record<Ecosystem, ThreatEntry[]>>;
}

export interface ClaudeHookInput {
  session_id?: string;
  cwd?: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface ClaudeHookOutput {
  continue?: boolean;
  decision?: "block" | "ask";
  reason?: string;
  message?: string;
}
