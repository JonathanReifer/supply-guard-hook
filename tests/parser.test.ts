import { describe, it, expect } from "bun:test";
import { parse } from "../src/parser.ts";

describe("parse — pip", () => {
  it("recognizes pip install", () => {
    const r = parse("pip install requests");
    expect(r).not.toBeNull();
    expect(r!.ecosystem).toBe("pip");
    expect(r!.packages).toEqual(["requests"]);
  });

  it("handles pip3 alias", () => {
    const r = parse("pip3 install flask");
    expect(r?.ecosystem).toBe("pip");
    expect(r?.packages).toContain("flask");
  });

  it("handles python -m pip install", () => {
    const r = parse("python -m pip install django");
    expect(r?.ecosystem).toBe("pip");
    expect(r?.packages).toContain("django");
  });

  it("parses multiple packages", () => {
    const r = parse("pip install requests flask sqlalchemy");
    expect(r?.packages).toHaveLength(3);
  });

  it("strips version specifier", () => {
    const r = parse("pip install requests==2.28.0");
    expect(r?.packages).toEqual(["requests"]);
    expect(r?.rawSpecs).toEqual(["requests==2.28.0"]);
  });

  it("detects custom --index-url", () => {
    const r = parse("pip install mylib --index-url https://custom.registry.io/simple/");
    expect(r?.customRegistry).toBe("https://custom.registry.io/simple/");
  });

  it("detects git+https URL", () => {
    const r = parse("pip install git+https://github.com/user/repo.git");
    expect(r?.gitUrls).toHaveLength(1);
    expect(r?.gitUrls[0]).toContain("github.com");
  });

  it("handles -r requirements.txt", () => {
    const r = parse("pip install -r requirements.txt");
    expect(r).not.toBeNull();
    expect(r?.packages[0]).toContain("requirements");
  });

  it("strips env var prefixes", () => {
    const r = parse("PIP_INDEX=evil.com pip install requests");
    expect(r?.ecosystem).toBe("pip");
    expect(r?.packages).toContain("requests");
  });

  it("handles sudo pip install", () => {
    const r = parse("sudo pip install flask");
    expect(r?.ecosystem).toBe("pip");
    expect(r?.packages).toContain("flask");
  });

  it("ignores pip subcommands that are not installs", () => {
    expect(parse("pip list")).toBeNull();
    expect(parse("pip freeze")).toBeNull();
    expect(parse("pip uninstall requests")).toBeNull();
  });
});

describe("parse — npm", () => {
  it("recognizes npm install", () => {
    const r = parse("npm install lodash");
    expect(r?.ecosystem).toBe("npm");
    expect(r?.packages).toContain("lodash");
  });

  it("handles npm i shorthand", () => {
    const r = parse("npm i lodash");
    expect(r?.ecosystem).toBe("npm");
  });

  it("handles npm add", () => {
    const r = parse("npm add chalk");
    expect(r?.packages).toContain("chalk");
  });

  it("ignores npm ci (lockfile install)", () => {
    expect(parse("npm ci")).toBeNull();
  });

  it("handles scoped packages", () => {
    const r = parse("npm install @types/node");
    expect(r?.packages).toContain("@types/node");
  });

  it("strips version from scoped package", () => {
    const r = parse("npm install @types/react@18.0.0");
    expect(r?.packages).toContain("@types/react");
  });
});

describe("parse — bun", () => {
  it("recognizes bun add", () => {
    const r = parse("bun add zod");
    expect(r?.ecosystem).toBe("bun");
    expect(r?.packages).toContain("zod");
  });

  it("ignores bun install (lockfile)", () => {
    expect(parse("bun install")).toBeNull();
  });

  it("handles bun x as bunx", () => {
    const r = parse("bun x create-next-app .");
    expect(r?.ecosystem).toBe("bunx");
    expect(r?.isExec).toBe(true);
  });
});

describe("parse — npx / bunx", () => {
  it("recognizes npx", () => {
    const r = parse("npx create-react-app .");
    expect(r?.ecosystem).toBe("npx");
    expect(r?.isExec).toBe(true);
    expect(r?.packages).toContain("create-react-app");
  });

  it("recognizes bunx", () => {
    const r = parse("bunx some-cli-tool");
    expect(r?.ecosystem).toBe("bunx");
    expect(r?.isExec).toBe(true);
  });

  it("strips version from npx package", () => {
    const r = parse("npx some-tool@latest");
    expect(r?.packages).toContain("some-tool");
  });
});

describe("parse — other ecosystems", () => {
  it("recognizes yarn add", () => {
    const r = parse("yarn add lodash");
    expect(r?.ecosystem).toBe("yarn");
  });

  it("recognizes pnpm add", () => {
    const r = parse("pnpm add chalk");
    expect(r?.ecosystem).toBe("pnpm");
  });

  it("recognizes cargo add", () => {
    const r = parse("cargo add serde");
    expect(r?.ecosystem).toBe("cargo");
  });

  it("recognizes cargo install", () => {
    const r = parse("cargo install ripgrep");
    expect(r?.ecosystem).toBe("cargo");
  });
});

describe("parse — non-install commands", () => {
  it("returns null for non-install commands", () => {
    expect(parse("ls -la")).toBeNull();
    expect(parse("git commit -m 'fix'")).toBeNull();
    expect(parse("echo hello")).toBeNull();
    expect(parse("rm -rf /")).toBeNull();
    expect(parse("node index.js")).toBeNull();
    expect(parse("")).toBeNull();
  });

  it("ignores local path installs (returns null — nothing to scan)", () => {
    // Local paths have no remote package to evaluate, so parse returns null
    expect(parse("pip install ./mypackage")).toBeNull();
  });
});
