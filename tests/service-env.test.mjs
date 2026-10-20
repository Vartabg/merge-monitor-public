import { expect, it } from "vitest";
import { staleHoursEntry, staleHoursSetting } from "../scripts/service-env.mjs";
const previous =
  "<dict><key>PORT</key><string>5173</string><key>MERGE_MONITOR_STALE_HOURS</key><string>48</string></dict>";
it("writes a valid stale threshold and keeps it across reinstalls", () => {
  expect(staleHoursSetting("24", previous)).toBe("24");
  expect(staleHoursSetting(undefined, previous)).toBe("48");
  expect(staleHoursSetting(undefined, "")).toBe("");
  expect(staleHoursSetting("", previous)).toBe("");
  expect(staleHoursEntry("48")).toBe(
    "<key>MERGE_MONITOR_STALE_HOURS</key><string>48</string>",
  );
  expect(staleHoursEntry("")).toBe("");
});
it("rejects thresholds the service would refuse to start with", () => {
  for (const bad of ["0", "-5", "abc", "12h", "1e3", " 24"])
    expect(() => staleHoursSetting(bad)).toThrow("positive number");
});
