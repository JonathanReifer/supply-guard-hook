import type { Ecosystem, RiskFactor } from "../types.ts";

const METADATA_TIMEOUT_MS = 3000;
const NEW_PACKAGE_DAYS = 7;
const RECENT_PACKAGE_DAYS = 30;
const LOW_DOWNLOADS_THRESHOLD = 1000;
const VERY_LOW_DOWNLOADS_THRESHOLD = 100;
const LOW_STARS_THRESHOLD = 10;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  return (Date.now() - then) / (1000 * 60 * 60 * 24);
}

async function checkPyPI(pkg: string): Promise<RiskFactor[]> {
  const factors: RiskFactor[] = [];
  let resp: Response;

  try {
    resp = await fetchWithTimeout(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, METADATA_TIMEOUT_MS);
  } catch {
    return []; // network error / timeout — fail open
  }

  if (!resp.ok) return []; // package may not exist on PyPI

  const data = await resp.json() as {
    info: Record<string, unknown>;
    releases: Record<string, Array<{ upload_time: string }>>;
  };

  // Find earliest release date across all versions
  let earliest: string | null = null;
  for (const versionFiles of Object.values(data.releases)) {
    for (const file of versionFiles) {
      if (!earliest || file.upload_time < earliest) {
        earliest = file.upload_time;
      }
    }
  }

  if (earliest) {
    const age = daysSince(earliest);
    if (age < NEW_PACKAGE_DAYS) {
      factors.push({ name: "package-age", score: 50, reason: `Package is very new (${Math.floor(age)} days old)` });
    } else if (age < RECENT_PACKAGE_DAYS) {
      factors.push({ name: "package-age", score: 20, reason: `Package is recent (${Math.floor(age)} days old)` });
    }
  }

  // Download stats via pypistats.org
  try {
    const statsResp = await fetchWithTimeout(
      `https://pypistats.org/api/packages/${encodeURIComponent(pkg)}/recent?period=week`,
      METADATA_TIMEOUT_MS,
    );
    if (statsResp.ok) {
      const stats = await statsResp.json() as { data: { last_week: number } };
      const weekly = stats.data?.last_week ?? null;
      if (weekly !== null && weekly < VERY_LOW_DOWNLOADS_THRESHOLD) {
        factors.push({ name: "low-downloads", score: 40, reason: `Very low weekly downloads: ${weekly}` });
      } else if (weekly !== null && weekly < LOW_DOWNLOADS_THRESHOLD) {
        factors.push({ name: "low-downloads", score: 25, reason: `Low weekly downloads: ${weekly}` });
      }
    }
  } catch {
    // downloads check optional — fail open
  }

  return factors;
}

async function checkNPM(pkg: string): Promise<RiskFactor[]> {
  const factors: RiskFactor[] = [];
  let resp: Response;

  try {
    resp = await fetchWithTimeout(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, METADATA_TIMEOUT_MS);
  } catch {
    return [];
  }

  if (!resp.ok) return [];

  const data = await resp.json() as { time?: Record<string, string> };

  const created = data.time?.created;
  if (created) {
    const age = daysSince(created);
    if (age < NEW_PACKAGE_DAYS) {
      factors.push({ name: "package-age", score: 50, reason: `Package is very new (${Math.floor(age)} days old)` });
    } else if (age < RECENT_PACKAGE_DAYS) {
      factors.push({ name: "package-age", score: 20, reason: `Package is recent (${Math.floor(age)} days old)` });
    }
  }

  // Weekly download count
  try {
    const dlResp = await fetchWithTimeout(
      `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkg)}`,
      METADATA_TIMEOUT_MS,
    );
    if (dlResp.ok) {
      const dl = await dlResp.json() as { downloads?: number };
      const weekly = dl.downloads ?? null;
      if (weekly !== null && weekly < VERY_LOW_DOWNLOADS_THRESHOLD) {
        factors.push({ name: "low-downloads", score: 40, reason: `Very low weekly downloads: ${weekly}` });
      } else if (weekly !== null && weekly < LOW_DOWNLOADS_THRESHOLD) {
        factors.push({ name: "low-downloads", score: 25, reason: `Low weekly downloads: ${weekly}` });
      }
    }
  } catch {
    // optional
  }

  return factors;
}

async function checkGitHubUrl(gitUrl: string): Promise<RiskFactor | null> {
  // Extract owner/repo from git+https://github.com/owner/repo[.git][@ref]
  const match = gitUrl.match(/github\.com[:/]([^/]+)\/([^/.@#]+)/);
  if (!match) return null;

  const [, owner, repo] = match;
  try {
    const resp = await fetchWithTimeout(
      `https://api.github.com/repos/${owner}/${repo}`,
      METADATA_TIMEOUT_MS,
    );
    if (!resp.ok) return null;
    const data = await resp.json() as { stargazers_count?: number };
    const stars = data.stargazers_count ?? 0;
    if (stars < LOW_STARS_THRESHOLD) {
      return {
        name: "low-github-stars",
        score: 30,
        reason: `GitHub repo has very few stars (${stars}) — low community vetting`,
      };
    }
  } catch {
    // optional
  }
  return null;
}

/**
 * Async metadata check: queries PyPI/npm registries for package age and popularity.
 * Fails open on any network error or timeout.
 */
export async function checkMetadata(
  pkg: string,
  ecosystem: Ecosystem,
  gitUrls: string[] = [],
  isExec = false,
  customRegistry: string | null = null,
): Promise<RiskFactor[]> {
  const factors: RiskFactor[] = [];

  // Custom registry is always suspicious (supply-chain bypass risk)
  if (customRegistry) {
    factors.push({
      name: "custom-registry",
      score: 60,
      reason: `Custom registry/index specified: ${customRegistry} — bypasses official vetting`,
    });
  }

  // npx/bunx execute packages directly — extra risk
  if (isExec) {
    factors.push({
      name: "exec-package",
      score: 20,
      reason: "Package is executed directly (npx/bunx) — not just installed",
    });
  }

  // Check GitHub URL installs
  for (const url of gitUrls) {
    const factor = await checkGitHubUrl(url);
    if (factor) factors.push(factor);
  }

  // Fetch registry metadata
  if (ecosystem === "pip") {
    factors.push(...await checkPyPI(pkg));
  } else if (["npm", "bun", "npx", "bunx", "yarn", "pnpm"].includes(ecosystem)) {
    factors.push(...await checkNPM(pkg));
  }
  // cargo/gem: no metadata check implemented yet (fail open)

  return factors;
}
