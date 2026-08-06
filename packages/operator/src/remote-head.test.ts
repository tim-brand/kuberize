import { describe, expect, it } from "bun:test";
import { parseLsRemoteOutput } from "./remote-head.js";

describe("parseLsRemoteOutput", () => {
  it("extracts the sha from a ls-remote line", () => {
    expect(
      parseLsRemoteOutput("61a6f2fe1c96eab30726b5c6f298c73ce8ba55d1\trefs/heads/master\n", "master")
    ).toBe("61a6f2fe1c96eab30726b5c6f298c73ce8ba55d1");
  });

  it("picks the exact ref when a tail-matching branch also appears", () => {
    expect(
      parseLsRemoteOutput(
        "aaa111\trefs/heads/foo/refs/heads/main\nbbb222\trefs/heads/main\n",
        "main"
      )
    ).toBe("bbb222");
  });

  it("returns undefined for empty output (branch does not exist)", () => {
    expect(parseLsRemoteOutput("", "main")).toBeUndefined();
    expect(parseLsRemoteOutput("\n", "main")).toBeUndefined();
  });
});
