import { parse as parseCommand } from "../parser.js";
import { evaluateCommand, worstDecision, DEFAULT_POLICY } from "../evaluator.js";
import type { RiskResult } from "../types.js";

// --- Local HookModule interface shape (duck-typed against llm-privacy-middleware).
// Defined locally on purpose: NO imports from the middleware. TypeScript structural
// typing makes this class assignable to the middleware's HookModule interface.

type HookEvent = "UserPromptSubmit" | "PreToolUse" | "Stop";
type ScanDecision = "allow" | "ask" | "block";
type FindingSeverity = "block" | "warn" | "info";

interface ScanFinding {
  scannerId: string;
  description: string;
  severity: FindingSeverity;
  atlasTechnique?: string;
  owaspCategory?: string;
  detail?: Record<string, unknown>;
}

interface ModuleScanResult {
  decision: ScanDecision;
  findings: ScanFinding[];
  durationMs: number;
  degraded?: boolean;
  degradedReason?: string;
}

interface HookInput {
  session_id: string;
  hook_event_name: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  stop_hook_active?: boolean;
}

/**
 * Detects whether a risk factor signals that the metadata check degraded
 * (network/timeout). `RiskResult.factors` is `RiskFactor[]` (objects), not
 * `string[]`, so we inspect the structured `name` and `reason` fields rather
 * than calling `.includes()` on the factor directly.
 */
function isMetadataTimeoutFactor(result: RiskResult): boolean {
  return result.factors.some((f) => {
    const haystack = `${f.name} ${f.reason}`.toLowerCase();
    return haystack.includes("metadata") && haystack.includes("timeout");
  });
}

export class SupplyChainHookModule {
  readonly id = "supply-chain";
  readonly events: HookEvent[] = ["PreToolUse"];

  private policy = DEFAULT_POLICY;

  async scan(input: HookInput, event: HookEvent): Promise<ModuleScanResult> {
    const start = performance.now();

    // Only fire on PreToolUse.
    if (event !== "PreToolUse") {
      return { decision: "allow", findings: [], durationMs: performance.now() - start };
    }

    // Only fire on Bash tool calls.
    if (input.tool_name !== "Bash") {
      return { decision: "allow", findings: [], durationMs: performance.now() - start };
    }

    const command =
      typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
    const parsed = parseCommand(command);

    // Not a package-install command — nothing for this module to evaluate.
    if (!parsed) {
      return { decision: "allow", findings: [], durationMs: performance.now() - start };
    }

    let results: RiskResult[];

    try {
      results = await evaluateCommand(parsed, this.policy);
    } catch (err) {
      // Fail open: a crashing evaluator must never block the user's command,
      // but the degradation is surfaced so the middleware can record it.
      process.stderr.write(`[llm-module] supply-chain error: ${err}\n`);
      return {
        decision: "allow",
        findings: [],
        durationMs: performance.now() - start,
        degraded: true,
        degradedReason: String(err),
      };
    }

    // Metadata checks fail open inside the evaluator (network calls). When that
    // happens the threat-DB and typosquat factors are still applied, so we keep
    // the decision but flag the result as degraded.
    let degraded = false;
    let degradedReason: string | undefined;
    if (results.some(isMetadataTimeoutFactor)) {
      degraded = true;
      degradedReason =
        "metadata check timed out; threat DB and typosquat checks still applied";
    }

    const worst = worstDecision(results);
    const decision: ScanDecision =
      worst === "block" ? "block" : worst === "approve" ? "ask" : "allow";

    const findings: ScanFinding[] = results
      .filter((r) => r.decision !== "allow")
      .map((r) => ({
        scannerId: `supply-chain/${r.package}`,
        description: r.recommendation,
        severity: r.decision === "block" ? ("block" as const) : ("warn" as const),
        atlasTechnique: "AML.T0010",
        owaspCategory: "LLM03",
        detail: {
          package: r.package,
          ecosystem: r.ecosystem,
          totalScore: r.totalScore,
          factors: r.factors,
        },
      }));

    return {
      decision,
      findings,
      durationMs: performance.now() - start,
      ...(degraded ? { degraded: true, degradedReason } : {}),
    };
  }
}

export default SupplyChainHookModule;
