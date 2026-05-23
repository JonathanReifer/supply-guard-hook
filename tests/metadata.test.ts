import { describe, it, expect, beforeEach, mock } from "bun:test";
import { checkMetadata } from "../src/checks/metadata.ts";

// Mock fetch for all tests in this file
const originalFetch = globalThis.fetch;

function mockFetch(responses: Record<string, object | number>): void {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    for (const [pattern, response] of Object.entries(responses)) {
      if (urlStr.includes(pattern)) {
        if (typeof response === "number") {
          return new Response(null, { status: response });
        }
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

const ONE_DAY_AGO = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
const FORTY_DAYS_AGO = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

describe("checkMetadata — custom registry", () => {
  it("adds +60 score for custom registry", async () => {
    const factors = await checkMetadata("mylib", "pip", [], false, "https://evil.registry.io/simple/");
    const customFactor = factors.find((f) => f.name === "custom-registry");
    expect(customFactor).not.toBeUndefined();
    expect(customFactor!.score).toBe(60);
  });

  it("adds no factor when registry is null", async () => {
    const factors = await checkMetadata("mylib", "pip", [], false, null);
    expect(factors.find((f) => f.name === "custom-registry")).toBeUndefined();
  });
});

describe("checkMetadata — exec bonus", () => {
  it("adds +20 for exec mode", async () => {
    const factors = await checkMetadata("some-pkg", "npx", [], true, null);
    const execFactor = factors.find((f) => f.name === "exec-package");
    expect(execFactor).not.toBeUndefined();
    expect(execFactor!.score).toBe(20);
  });

  it("no exec factor when isExec is false", async () => {
    const factors = await checkMetadata("some-pkg", "npm", [], false, null);
    expect(factors.find((f) => f.name === "exec-package")).toBeUndefined();
  });
});

describe("checkMetadata — PyPI age check", () => {
  beforeEach(() => {
    mockFetch({
      "pypi.org/pypi/newpkg": {
        info: {},
        releases: {
          "0.1.0": [{ upload_time: ONE_DAY_AGO }],
        },
      },
      "pypi.org/pypi/oldpkg": {
        info: {},
        releases: {
          "1.0.0": [{ upload_time: FORTY_DAYS_AGO }],
        },
      },
      "pypistats.org": { data: { last_week: 50000 } },
    });
  });

  it("flags very new packages (+50)", async () => {
    const factors = await checkMetadata("newpkg", "pip");
    const ageFactor = factors.find((f) => f.name === "package-age");
    expect(ageFactor).not.toBeUndefined();
    expect(ageFactor!.score).toBe(50);
  });

  it("no age factor for old packages", async () => {
    const factors = await checkMetadata("oldpkg", "pip");
    expect(factors.find((f) => f.name === "package-age")).toBeUndefined();
  });
});

describe("checkMetadata — fail open", () => {
  it("returns no factors on network error", async () => {
    globalThis.fetch = (async () => { throw new Error("network error"); }) as unknown as typeof fetch;
    const factors = await checkMetadata("anypkg", "pip");
    // Should fail open — no factors, no throw
    expect(factors).toEqual([]);
    restoreFetch();
  });

  it("returns no factors for 404", async () => {
    mockFetch({ "pypi.org": 404 });
    const factors = await checkMetadata("unknownpkg", "pip");
    expect(factors.find((f) => f.name === "package-age")).toBeUndefined();
    restoreFetch();
  });
});

describe("checkMetadata — cargo/gem (not implemented)", () => {
  it("returns empty for unsupported ecosystems (fail open)", async () => {
    const factors = await checkMetadata("serde", "cargo");
    // No registry check implemented, fails open
    expect(Array.isArray(factors)).toBe(true);
  });
});
