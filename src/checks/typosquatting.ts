import { POPULAR_PIP, POPULAR_NPM } from "../threats/popularPackages.ts";
import { normalizePipName } from "../parser.ts";
import type { Ecosystem, RiskFactor } from "../types.ts";

/** Levenshtein edit distance (iterative, O(n*m)). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

/**
 * Normalizes a package name for comparison:
 * - lowercase
 * - hyphens and underscores treated as equivalent (PEP 503 for pip; common for npm)
 */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/**
 * Checks whether a package name is a potential typosquat of a popular package.
 * Returns a RiskFactor if suspicious, null if the package looks legitimate.
 */
export function checkTyposquatting(pkg: string, ecosystem: Ecosystem): RiskFactor | null {
  const popularList = ["npx", "bunx", "bun", "yarn", "pnpm", "npm"].includes(ecosystem)
    ? POPULAR_NPM
    : POPULAR_PIP;

  const normalizedPkg = normalize(pkg);

  // Fast path: exact match against popular list → legitimate, no typosquat
  for (const popular of popularList) {
    if (normalize(popular) === normalizedPkg) return null;
  }

  let closestDistance = Infinity;
  let closestMatch = "";

  for (const popular of popularList) {
    const dist = editDistance(normalizedPkg, normalize(popular));
    if (dist < closestDistance) {
      closestDistance = dist;
      closestMatch = popular;
    }
    // Short-circuit: can't get better than distance 1
    if (closestDistance === 1) break;
  }

  if (closestDistance === 1) {
    return {
      name: "typosquatting",
      score: 75,
      reason: `Possible typosquat of \`${closestMatch}\` (edit distance 1)`,
    };
  }

  if (closestDistance === 2) {
    return {
      name: "typosquatting",
      score: 40,
      reason: `Similar to popular package \`${closestMatch}\` (edit distance 2)`,
    };
  }

  return null;
}
