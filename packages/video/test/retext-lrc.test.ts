// A lyric line's words fixed by hand keep the line's timing (Shape → a line's card → Text).
import { describe, expect, it } from "vitest";

import { parseLrc, retextLrcLine } from "../src/lrc";

const LRC = "[00:01.00]<00:01.00>Hello <00:01.50>world <00:02.00>\n[00:03.00]* <00:03.00>My <00:03.40>path <00:03.80>leeds <00:04.20>me <00:04.80>\n[00:05.00]\n";

describe("retextLrcLine", () => {
  it("respelled words keep their own times; the hook marker, start and end stay", () => {
    const line = parseLrc(retextLrcLine(LRC, 2, "My path leads me"))[1];
    expect(line).toMatchObject({ text: "My path leads me", start_ms: 3000, end_ms: 5000, isHook: true, sung_end_ms: 4800 });
    expect(line.words!.map((w) => w.start_ms)).toEqual([3000, 3400, 3800, 4200]);
  });
  it("more or fewer words share the line's sung span evenly", () => {
    const line = parseLrc(retextLrcLine(LRC, 2, "My path always leads me"))[1];
    expect(line.words!.map((w) => w.start_ms)).toEqual([3000, 3360, 3720, 4080, 4440]);
    expect(line.sung_end_ms).toBe(4800);
    expect(parseLrc(retextLrcLine(LRC, 2, "Onward"))[1].words).toEqual([{ text: "Onward", start_ms: 3000 }]);
  });
  it("the other lines and a plain LRC without word tags", () => {
    const out = retextLrcLine(LRC, 2, "My path leads me");
    expect(out.split("\n")[0]).toBe(LRC.split("\n")[0]);
    expect(retextLrcLine("[00:01.00]Hi there\n[00:02.00]\n", 1, "Hi you")).toBe("[00:01.00]Hi you\n[00:02.00]\n");
    expect(() => retextLrcLine(LRC, 3, "x")).toThrow(/no line 3/);
  });
});
