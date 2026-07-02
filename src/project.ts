// Lightweight "project" concept — derived from the hook's cwd. Defined locally
// on purpose: no imports from aih-privacy-middleware, matching this repo's
// existing zero-cross-repo-imports convention (see SupplyChainModule.ts).
//
// Precedence: AIH_PROJECT env var > .aih-project marker file in cwd > basename(cwd).
// Unlike aih-privacy-middleware, this hook has no downstream stateless-HTTP
// consumer that needs a session_id -> project mapping file — supply-guard-proxy
// tags its own telemetry "unknown" (see docs/telemetry-schema.md).

import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";

export function deriveProject(cwd: string | undefined): string | undefined {
  if (process.env.AIH_PROJECT) return process.env.AIH_PROJECT;
  if (!cwd) return undefined;

  const markerPath = join(cwd, ".aih-project");
  try {
    if (existsSync(markerPath)) {
      const marker = readFileSync(markerPath, "utf8").trim();
      if (marker) return marker;
    }
  } catch {
    // fall through to basename
  }

  return basename(cwd) || undefined;
}
