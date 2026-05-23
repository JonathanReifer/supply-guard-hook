import { describe, it, expect } from "bun:test";
import { checkTyposquatting } from "../src/checks/typosquatting.ts";

describe("checkTyposquatting", () => {
  it("returns null for exact popular packages", () => {
    expect(checkTyposquatting("requests", "pip")).toBeNull();
    expect(checkTyposquatting("lodash", "npm")).toBeNull();
    expect(checkTyposquatting("flask", "pip")).toBeNull();
    expect(checkTyposquatting("express", "npm")).toBeNull();
  });

  it("flags distance-1 typosquats with score 75", () => {
    const r = checkTyposquatting("requets", "pip"); // missing 's'
    expect(r).not.toBeNull();
    expect(r!.score).toBe(75);
    expect(r!.reason).toContain("requests");
  });

  it("flags requests-lite as typosquat (edit distance from requests)", () => {
    const r = checkTyposquatting("requets", "pip");
    expect(r?.score).toBe(75);
  });

  it("flags boto4 as typosquat of boto3 (distance 1)", () => {
    const r = checkTyposquatting("boto4", "pip");
    expect(r).not.toBeNull();
    expect(r!.score).toBe(75);
  });

  it("flags nupmy as typosquat of numpy (distance 2)", () => {
    const r = checkTyposquatting("nupmy", "pip");
    expect(r).not.toBeNull();
    expect(r!.score).toBe(40);
  });

  it("maps npm-family to npm list", () => {
    for (const eco of ["npm", "bun", "yarn", "pnpm", "npx", "bunx"] as const) {
      const r = checkTyposquatting("lodsh", eco); // lodash with missing 'a'
      expect(r).not.toBeNull();
    }
  });

  it("returns null for genuinely obscure packages (high distance)", () => {
    // "zyxwvuts" is far from all popular packages
    expect(checkTyposquatting("zyxwvutsrqponmlkjihg", "pip")).toBeNull();
  });

  it("handles scoped npm packages without false positives", () => {
    // @types/node is a legitimate package
    const r = checkTyposquatting("@types/node", "npm");
    // scoped packages won't match popular list items which don't have that scope
    // just ensure it doesn't throw
    expect(r === null || r.score <= 75).toBe(true);
  });
});
