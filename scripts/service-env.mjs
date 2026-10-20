const key = "MERGE_MONITOR_STALE_HOURS";
// Returns the stale threshold to write into the LaunchAgent, or "" for the service default (72h).
// Unset keeps the value from the previous install; an empty value clears it.
export function staleHoursSetting(value, previousPlist = "") {
  if (value === undefined)
    return (
      previousPlist.match(
        new RegExp(`<key>${key}</key><string>([^<]*)</string>`),
      )?.[1] || ""
    );
  if (value === "") return "";
  if (!/^\d+(\.\d+)?$/.test(value) || !(Number(value) > 0))
    throw new Error(`${key} must be a positive number of hours.`);
  return value;
}
export const staleHoursEntry = (hours) =>
  hours ? `<key>${key}</key><string>${hours}</string>` : "";
