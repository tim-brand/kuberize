import { describe, expect, it } from "bun:test";
import { pushTouchesConfig } from "./push-relevance.js";

describe("pushTouchesConfig", () => {
  it("returns true when a commit adds .kuberize.yaml", () => {
    expect(pushTouchesConfig({ commits: [{ added: [".kuberize.yaml"] }] })).toBe(true);
  });

  it("returns true when a commit modifies .kuberize.yaml", () => {
    expect(
      pushTouchesConfig({ commits: [{ modified: ["src/index.ts", ".kuberize.yaml"] }] })
    ).toBe(true);
  });

  it("returns true when a commit removes .kuberize.yaml", () => {
    expect(pushTouchesConfig({ commits: [{ removed: [".kuberize.yaml"] }] })).toBe(true);
  });

  it("returns false for a code-only push", () => {
    expect(
      pushTouchesConfig({
        commits: [
          { added: ["src/new.ts"], modified: ["README.md"] },
          { removed: ["old.txt"] },
        ],
      })
    ).toBe(false);
  });

  it("does not match .kuberize.yaml in a subdirectory", () => {
    expect(pushTouchesConfig({ commits: [{ modified: ["docs/.kuberize.yaml"] }] })).toBe(
      false
    );
  });

  it("fails open on a force push", () => {
    expect(pushTouchesConfig({ forced: true, commits: [{ modified: ["a.ts"] }] })).toBe(
      true
    );
  });

  it("fails open on a deleted ref", () => {
    expect(pushTouchesConfig({ deleted: true, commits: [] })).toBe(true);
  });

  it("fails open when commits are missing", () => {
    expect(pushTouchesConfig({})).toBe(true);
  });

  it("fails open when commits are an empty array", () => {
    expect(pushTouchesConfig({ commits: [] })).toBe(true);
  });
});
