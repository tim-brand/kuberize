import { describe, expect, test } from "bun:test";
import { normalizeRepoUrl } from "./utils.js";

describe("normalizeRepoUrl", () => {
  test("strips protocol, .git suffix and trailing slashes", () => {
    expect(normalizeRepoUrl("https://github.com/tim-brand/archon-demo.git")).toBe(
      "github.com/tim-brand/archon-demo"
    );
    expect(normalizeRepoUrl("https://github.com/tim-brand/archon-demo/")).toBe(
      "github.com/tim-brand/archon-demo"
    );
    expect(normalizeRepoUrl("http://github.com/tim-brand/archon-demo")).toBe(
      "github.com/tim-brand/archon-demo"
    );
  });

  test("lowercases the url", () => {
    expect(normalizeRepoUrl("https://GitHub.com/Tim-Brand/Archon-Demo")).toBe(
      "github.com/tim-brand/archon-demo"
    );
  });

  test("normalizes ssh urls to host/path form", () => {
    expect(normalizeRepoUrl("git@github.com:tim-brand/archon-demo.git")).toBe(
      "github.com/tim-brand/archon-demo"
    );
    expect(normalizeRepoUrl("ssh://git@github.com/tim-brand/archon-demo.git")).toBe(
      "github.com/tim-brand/archon-demo"
    );
  });

  test("equal urls in different forms normalize identically", () => {
    const forms = [
      "https://github.com/tim-brand/archon-demo",
      "https://github.com/tim-brand/archon-demo.git",
      "git@github.com:tim-brand/archon-demo.git",
    ];
    const normalized = new Set(forms.map(normalizeRepoUrl));
    expect(normalized.size).toBe(1);
  });
});
