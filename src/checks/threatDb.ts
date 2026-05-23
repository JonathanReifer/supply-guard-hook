import { KNOWN_MALICIOUS } from "../threats/knownMalicious.ts";
import { normalizePipName } from "../parser.ts";
import type { Ecosystem, RiskFactor } from "../types.ts";

/**
 * Checks a package name against the known-malicious threat database.
 * Returns a RiskFactor with score 100 on a hit, null otherwise.
 * This check short-circuits the evaluator when it fires.
 */
export function checkThreatDb(pkg: string, ecosystem: Ecosystem): RiskFactor | null {
  // npm-family ecosystems all use the npm package namespace
  const dbKey = (["npx", "bunx", "bun", "yarn", "pnpm"].includes(ecosystem) ? "npm" : ecosystem) as Ecosystem;
  const entries = KNOWN_MALICIOUS[dbKey] ?? [];

  const normalizedPkg = ecosystem === "pip" ? normalizePipName(pkg) : pkg.toLowerCase();

  for (const entry of entries) {
    const normalizedEntry = ecosystem === "pip" ? normalizePipName(entry.name) : entry.name.toLowerCase();
    if (normalizedEntry === normalizedPkg) {
      return {
        name: "known-malicious",
        score: 100,
        reason: `Known malicious package: ${entry.reason}${entry.cve ? ` (${entry.cve})` : ""}`,
      };
    }
  }

  return null;
}
