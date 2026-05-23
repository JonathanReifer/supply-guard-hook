import { describe, it, expect } from "bun:test";
import { checkThreatDb } from "../src/checks/threatDb.ts";

describe("checkThreatDb", () => {
  it("returns null for unknown packages", () => {
    expect(checkThreatDb("requests", "pip")).toBeNull();
    expect(checkThreatDb("lodash", "npm")).toBeNull();
  });

  it("blocks known pip malicious package (exact)", () => {
    const r = checkThreatDb("coloama", "pip");
    expect(r).not.toBeNull();
    expect(r!.score).toBe(100);
    expect(r!.name).toBe("known-malicious");
  });

  it("blocks known npm malicious package (exact)", () => {
    const r = checkThreatDb("event-source-pollyfill", "npm");
    expect(r).not.toBeNull();
    expect(r!.score).toBe(100);
  });

  it("normalizes pip package names (hyphen/underscore equivalence)", () => {
    // coloama → coloama; normalization should match
    const r1 = checkThreatDb("coloama", "pip");
    expect(r1).not.toBeNull();
    // python_dateutil2 vs python-dateutil2 (normalized both to python-dateutil2)
    const r2 = checkThreatDb("python_dateutil2", "pip");
    expect(r2).not.toBeNull();
    expect(r2!.score).toBe(100);
  });

  it("maps npm-family ecosystems to npm DB", () => {
    for (const eco of ["bun", "yarn", "pnpm", "npx", "bunx"] as const) {
      const r = checkThreatDb("event-source-pollyfill", eco);
      expect(r).not.toBeNull();
    }
  });

  it("includes CVE in reason if present", () => {
    const r = checkThreatDb("ua-parser-js", "npm");
    expect(r?.reason).toContain("CVE");
  });

  it("returns null for legitimate package with similar name", () => {
    expect(checkThreatDb("colorama", "pip")).toBeNull();
    expect(checkThreatDb("event-source-polyfill", "npm")).toBeNull();
  });
});
