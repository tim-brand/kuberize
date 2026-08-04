import { describe, expect, it } from "bun:test";
import { parseLsRemoteOutput } from "./remote-head.js";

describe("parseLsRemoteOutput", () => {
  it("extracts the sha from a ls-remote line", () => {
    expect(
      parseLsRemoteOutput("61a6f2fe1c96eab30726b5c6f298c73ce8ba55d1\trefs/heads/master\n")
    ).toBe("61a6f2fe1c96eab30726b5c6f298c73ce8ba55d1");
  });

  it("takes the first line when multiple refs match", () => {
    expect(
      parseLsRemoteOutput("aaa111\trefs/heads/main\nbbb222\trefs/heads/main-old\n")
    ).toBe("aaa111");
  });

  it("returns undefined for empty output (branch does not exist)", () => {
    expect(parseLsRemoteOutput("")).toBeUndefined();
    expect(parseLsRemoteOutput("\n")).toBeUndefined();
  });
});
