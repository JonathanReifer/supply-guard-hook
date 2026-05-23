/**
 * Hook integration tests.
 *
 * IMPORTANT: These tests spawn the hook *process* (bun SupplyGuard.hook.ts) and
 * feed it a JSON payload via stdin. The hook only evaluates the command string and
 * writes a decision to stdout — it never executes pip, npm, or any shell command.
 * No packages are installed during these tests.
 */
import { describe, it, expect } from "bun:test";
import { spawn } from "child_process";
import { resolve } from "path";

const HOOK_PATH = resolve(import.meta.dir, "../src/hooks/SupplyGuard.hook.ts");

interface HookResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runHook(input: object, timeoutMs = 5000): Promise<HookResult> {
  return new Promise((res, rej) => {
    const proc = spawn("bun", [HOOK_PATH], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      rej(new Error("Hook timed out"));
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      res({ stdout, stderr, exitCode: code ?? 0 });
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

describe("Hook protocol — non-install commands", () => {
  it("allows non-Bash tools immediately", async () => {
    const r = await runHook({ tool_name: "Read", tool_input: { file_path: "/etc/hosts" } });
    const out = JSON.parse(r.stdout);
    expect(out.continue).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it("allows Bash commands that are not package installs", async () => {
    const r = await runHook({ tool_name: "Bash", tool_input: { command: "ls -la" } });
    const out = JSON.parse(r.stdout);
    expect(out.continue).toBe(true);
    expect(r.exitCode).toBe(0);
  });
});

describe("Hook protocol — known malicious package", () => {
  it("blocks coloama (known malicious)", async () => {
    const r = await runHook({
      tool_name: "Bash",
      tool_input: { command: "pip install coloama" },
    });
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("coloama");
    expect(r.exitCode).toBe(2);
  });

  it("blocks npm malicious package", async () => {
    const r = await runHook({
      tool_name: "Bash",
      tool_input: { command: "npm install event-source-pollyfill" },
    });
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBe("block");
    expect(r.exitCode).toBe(2);
  });
});

describe("Hook protocol — fail open", () => {
  it("allows on malformed JSON input", async () => {
    const proc = spawn("bun", [HOOK_PATH], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });

    proc.stdin.write("NOT VALID JSON{{{{");
    proc.stdin.end();

    const exitCode = await new Promise<number>((res) => proc.on("close", (c) => res(c ?? 0)));
    const out = JSON.parse(stdout);
    expect(out.continue).toBe(true);
    expect(exitCode).toBe(0);
  });

  it("allows when stdin is empty", async () => {
    const proc = spawn("bun", [HOOK_PATH], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stdin.end();
    const exitCode = await new Promise<number>((res) => proc.on("close", (c) => res(c ?? 0)));
    const out = JSON.parse(stdout);
    expect(out.continue).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Hook protocol — typosquat (approve path)", () => {
  it("asks for approval on typosquatted package", async () => {
    const r = await runHook({
      tool_name: "Bash",
      tool_input: { command: "pip install requets" }, // typo of requests
    });
    const out = JSON.parse(r.stdout);
    // Should be approve (ask), not block
    expect(out.decision).toBe("ask");
    expect(out.message).toContain("requets");
    expect(r.exitCode).toBe(0);
  });
});
