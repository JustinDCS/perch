import { describe, expect, it } from "vitest";
import { describeFailure } from "./updates";

describe("describeFailure", () => {
  it("says builds without the updater have no update support", () => {
    expect(describeFailure("plugin:updater|check not found").state).toBe("unsupported");
    expect(describeFailure(new Error("updater.check not allowed")).state).toBe("unsupported");
  });

  it("reports real failures with a short message", () => {
    const r = describeFailure(new Error("network down".repeat(40)));
    expect(r.state).toBe("error");
    expect(r.text.length).toBeLessThan(200);
  });
});
