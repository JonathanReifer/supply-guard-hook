import { checkThreatDb } from "./checks/threatDb.ts";
import { checkTyposquatting } from "./checks/typosquatting.ts";
import { checkMetadata } from "./checks/metadata.ts";
import type { Decision, Ecosystem, ParsedInstall, Policy, RiskFactor, RiskResult } from "./types.ts";

export const DEFAULT_POLICY: Policy = {
  blockThreshold: 80,
  approveThreshold: 40,
  metadataTimeoutMs: 3000,
  flagCustomRegistry: true,
  flagGitInstalls: true,
  flagExecCommands: true,
};

function scoreToDecision(score: number, policy: Policy): Decision {
  if (score >= policy.blockThreshold) return "block";
  if (score >= policy.approveThreshold) return "approve";
  return "allow";
}

function buildRecommendation(pkg: string, decision: Decision, factors: RiskFactor[]): string {
  if (decision === "allow") return `\`${pkg}\` appears safe to install.`;
  const topReasons = factors
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((f) => f.reason)
    .join("; ");
  if (decision === "block") return `BLOCKED: \`${pkg}\` — ${topReasons}`;
  return `REVIEW REQUIRED: \`${pkg}\` — ${topReasons}`;
}

/**
 * Evaluates a single package against all checks and returns a risk result.
 */
export async function evaluatePackage(
  pkg: string,
  cmd: ParsedInstall,
  policy: Policy = DEFAULT_POLICY,
): Promise<RiskResult> {
  const { ecosystem, gitUrls, isExec, customRegistry } = cmd;
  const factors: RiskFactor[] = [];

  // 1. Threat DB (sync, short-circuit on hit)
  const threatFactor = checkThreatDb(pkg, ecosystem);
  if (threatFactor) {
    factors.push(threatFactor);
    const score = Math.min(100, threatFactor.score);
    return {
      package: pkg,
      ecosystem,
      totalScore: score,
      decision: scoreToDecision(score, policy),
      factors,
      recommendation: buildRecommendation(pkg, scoreToDecision(score, policy), factors),
    };
  }

  // 2. Typosquatting (sync)
  const typoFactor = checkTyposquatting(pkg, ecosystem);
  if (typoFactor) factors.push(typoFactor);

  // 3. Metadata checks (async — network calls, fail-open)
  const metaFactors = await checkMetadata(
    pkg,
    ecosystem,
    gitUrls,
    isExec && policy.flagExecCommands,
    policy.flagCustomRegistry ? customRegistry : null,
  );
  factors.push(...metaFactors);

  const totalScore = Math.min(100, factors.reduce((sum, f) => sum + f.score, 0));
  const decision = scoreToDecision(totalScore, policy);

  return {
    package: pkg,
    ecosystem,
    totalScore,
    decision,
    factors,
    recommendation: buildRecommendation(pkg, decision, factors),
  };
}

/**
 * Evaluates all packages in a parsed install command.
 * Packages are evaluated in parallel. Returns results for each package,
 * sorted by risk score descending.
 */
export async function evaluateCommand(
  cmd: ParsedInstall,
  policy: Policy = DEFAULT_POLICY,
): Promise<RiskResult[]> {
  const allPackages = [...cmd.packages];

  // Also evaluate git URL installs (as a single entry)
  if (policy.flagGitInstalls && cmd.gitUrls.length > 0) {
    for (const url of cmd.gitUrls) {
      allPackages.push(url);
    }
  }

  if (allPackages.length === 0) return [];

  const results = await Promise.all(
    allPackages.map((pkg) => evaluatePackage(pkg, cmd, policy)),
  );

  return results.sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Returns the most severe decision across all results.
 */
export function worstDecision(results: RiskResult[]): Decision {
  if (results.some((r) => r.decision === "block")) return "block";
  if (results.some((r) => r.decision === "approve")) return "approve";
  return "allow";
}
