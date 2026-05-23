import type { Ecosystem, ParsedInstall } from "./types.ts";

const PIP_SUBCOMMANDS = new Set(["install", "download", "wheel"]);
const NPM_SUBCOMMANDS = new Set(["install", "i", "add", "ci", "update", "up", "upgrade"]);
const CARGO_SUBCOMMANDS = new Set(["add", "install"]);
const GEM_SUBCOMMANDS = new Set(["install", "i"]);

const CUSTOM_REGISTRY_FLAGS = new Set([
  "--index-url", "-i", "--extra-index-url", "--find-links", "-f",
  "--registry", "--scope",
]);

/**
 * Strips shell env-var prefixes like `VAR=val OTHER=val command args`
 * to prevent bypass via environment variable injection.
 */
function stripEnvPrefixes(command: string): string {
  return command.replace(/^(\s*[A-Z_][A-Z0-9_]*=[^\s]*\s+)+/, "").trim();
}

/**
 * Normalizes a pip package name: lowercase, replace - and _ with canonical form.
 * PEP 503: treat hyphens and underscores as equivalent.
 */
export function normalizePipName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/**
 * Extracts the bare package name from a versioned spec.
 * "requests==2.28.0" → "requests"
 * "some-lib@^1.0"    → "some-lib"
 * "git+https://..."  → null (handled separately)
 */
function extractName(spec: string, ecosystem: Ecosystem): string | null {
  if (spec.startsWith("git+") || spec.includes("://")) return null;
  if (spec.startsWith("./") || spec.startsWith("/") || spec.startsWith("..")) return null;

  if (ecosystem === "pip") {
    return spec.split(/[=!<>\[@]/)[0].trim() || null;
  }
  // npm/bun/yarn/pnpm: "pkg@^1.0" → "pkg", "@scope/pkg@1.0" → "@scope/pkg"
  if (spec.startsWith("@")) {
    const withoutScope = spec.slice(1);
    const slashIdx = withoutScope.indexOf("/");
    if (slashIdx === -1) return spec;
    const afterScope = withoutScope.slice(slashIdx + 1);
    const atIdx = afterScope.indexOf("@");
    const pkgPart = atIdx === -1 ? afterScope : afterScope.slice(0, atIdx);
    return `@${withoutScope.slice(0, slashIdx)}/${pkgPart}`;
  }
  return spec.split("@")[0] || null;
}

function parseArgs(
  args: string[],
  ecosystem: Ecosystem,
): Pick<ParsedInstall, "packages" | "rawSpecs" | "flags" | "customRegistry" | "gitUrls"> {
  const packages: string[] = [];
  const rawSpecs: string[] = [];
  const flags: string[] = [];
  const gitUrls: string[] = [];
  let customRegistry: string | null = null;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith("-")) {
      // Check for custom registry flags (--flag=value or --flag value)
      const eqIdx = arg.indexOf("=");
      const flagName = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;

      if (CUSTOM_REGISTRY_FLAGS.has(flagName)) {
        const value = eqIdx !== -1 ? arg.slice(eqIdx + 1) : args[++i] ?? "";
        customRegistry = value || "<custom>";
      } else {
        flags.push(arg);
      }
      i++;
      continue;
    }

    // Git URL
    if (arg.startsWith("git+") || arg.startsWith("hg+") || arg.startsWith("svn+")) {
      gitUrls.push(arg);
      i++;
      continue;
    }

    // Local path — not a remote package
    if (arg.startsWith("./") || arg.startsWith("../") || arg.startsWith("/")) {
      i++;
      continue;
    }

    // GitHub shorthand: github.com/user/repo or user/repo (cargo)
    if (
      arg.startsWith("github.com/") ||
      (ecosystem === "cargo" && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(arg))
    ) {
      gitUrls.push(`git+https://${arg.startsWith("github.com") ? arg : `github.com/${arg}`}`);
      i++;
      continue;
    }

    rawSpecs.push(arg);
    const name = extractName(arg, ecosystem);
    if (name) packages.push(name);
    i++;
  }

  return { packages, rawSpecs, flags, customRegistry, gitUrls };
}

/**
 * Parse a shell command string and detect package install intent.
 * Returns null if the command is not a package install.
 */
export function parse(command: string): ParsedInstall | null {
  const normalized = stripEnvPrefixes(command.trim());

  // Tokenize (naive split — handles quoted strings as single tokens)
  const tokens = tokenize(normalized);
  if (tokens.length === 0) return null;

  // Strip leading sudo / env wrappers
  let idx = 0;
  while (idx < tokens.length && (tokens[idx] === "sudo" || tokens[idx] === "env")) {
    idx++;
  }

  const cmd = tokens[idx];
  const rest = tokens.slice(idx + 1);

  // pip / pip3 / python -m pip
  if (cmd === "pip" || cmd === "pip3" || isPythonMPip(tokens, idx)) {
    const sub = cmd.startsWith("pip") ? rest[0] : tokens[idx + 3]; // python -m pip <sub>
    const actualRest = cmd.startsWith("pip") ? rest.slice(1) : tokens.slice(idx + 4);
    if (!sub || !PIP_SUBCOMMANDS.has(sub)) return null;

    // Handle -r requirements.txt (we can't read the file at hook time, flag the command)
    const rFlag = actualRest.findIndex((a) => a === "-r" || a === "--requirement");
    if (rFlag !== -1) {
      const reqFile = actualRest[rFlag + 1] ?? "requirements.txt";
      return {
        ecosystem: "pip",
        packages: [`<requirements:${reqFile}>`],
        rawSpecs: [`-r ${reqFile}`],
        flags: ["-r"],
        customRegistry: null,
        gitUrls: [],
        isExec: false,
      };
    }

    const parsed = parseArgs(actualRest, "pip");
    if (parsed.packages.length === 0 && parsed.gitUrls.length === 0) return null;
    return { ecosystem: "pip", ...parsed, isExec: false };
  }

  // npm install/add/ci
  if (cmd === "npm") {
    const sub = rest[0];
    if (!sub || !NPM_SUBCOMMANDS.has(sub)) return null;
    // `npm ci` installs from lockfile — no new packages
    if (sub === "ci") return null;
    const parsed = parseArgs(rest.slice(1), "npm");
    if (parsed.packages.length === 0 && parsed.gitUrls.length === 0) return null;
    return { ecosystem: "npm", ...parsed, isExec: false };
  }

  // bun add
  if (cmd === "bun") {
    const sub = rest[0];
    if (sub === "add") {
      const parsed = parseArgs(rest.slice(1), "bun");
      if (parsed.packages.length === 0 && parsed.gitUrls.length === 0) return null;
      return { ecosystem: "bun", ...parsed, isExec: false };
    }
    // bun install (from lockfile) — not a new install, skip
    if (sub === "install" || sub === "i") return null;
    // bunx <package>
    if (sub === "x" || sub === "bunx") {
      return parseExec("bunx", rest.slice(1));
    }
    return null;
  }

  // bunx as a direct command
  if (cmd === "bunx") {
    return parseExec("bunx", rest);
  }

  // npx
  if (cmd === "npx") {
    return parseExec("npx", rest);
  }

  // yarn add
  if (cmd === "yarn") {
    const sub = rest[0];
    if (sub !== "add") return null;
    const parsed = parseArgs(rest.slice(1), "yarn");
    if (parsed.packages.length === 0 && parsed.gitUrls.length === 0) return null;
    return { ecosystem: "yarn", ...parsed, isExec: false };
  }

  // pnpm add
  if (cmd === "pnpm") {
    const sub = rest[0];
    if (sub !== "add" && sub !== "install" && sub !== "i") return null;
    if (sub === "install" || sub === "i") return null; // lockfile install
    const parsed = parseArgs(rest.slice(1), "pnpm");
    if (parsed.packages.length === 0 && parsed.gitUrls.length === 0) return null;
    return { ecosystem: "pnpm", ...parsed, isExec: false };
  }

  // cargo add / cargo install
  if (cmd === "cargo") {
    const sub = rest[0];
    if (!sub || !CARGO_SUBCOMMANDS.has(sub)) return null;
    const parsed = parseArgs(rest.slice(1), "cargo");
    if (parsed.packages.length === 0 && parsed.gitUrls.length === 0) return null;
    return { ecosystem: "cargo", ...parsed, isExec: false };
  }

  // gem install
  if (cmd === "gem") {
    const sub = rest[0];
    if (!sub || !GEM_SUBCOMMANDS.has(sub)) return null;
    const parsed = parseArgs(rest.slice(1), "gem");
    if (parsed.packages.length === 0 && parsed.gitUrls.length === 0) return null;
    return { ecosystem: "gem", ...parsed, isExec: false };
  }

  return null;
}

function parseExec(
  ecosystem: "npx" | "bunx",
  args: string[],
): ParsedInstall | null {
  // Strip flags before the package name
  const pkgArgs = args.filter((a) => !a.startsWith("-"));
  if (pkgArgs.length === 0) return null;

  const pkgSpec = pkgArgs[0];
  const name = extractName(pkgSpec, "npm");
  if (!name) return null;

  return {
    ecosystem,
    packages: [name],
    rawSpecs: [pkgSpec],
    flags: args.filter((a) => a.startsWith("-")),
    customRegistry: null,
    gitUrls: [],
    isExec: true,
  };
}

function isPythonMPip(tokens: string[], idx: number): boolean {
  return (
    (tokens[idx] === "python" || tokens[idx] === "python3") &&
    tokens[idx + 1] === "-m" &&
    tokens[idx + 2] === "pip"
  );
}

/**
 * Naive tokenizer that handles single/double quoted strings.
 */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === " " && !inSingle && !inDouble) {
      if (current) { tokens.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}
