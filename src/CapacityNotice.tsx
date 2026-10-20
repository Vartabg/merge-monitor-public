export function CapacityNotice({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  if (used < limit * 0.8) return null;
  return (
    <p role="status" className="team-note">
      {label}: {used} of {limit} saved.{" "}
      {used >= limit ? "This storage is full." : "This storage is nearly full."}{" "}
      Finished work still counts. Export a backup and review capacity before
      adding more work; saved history is never silently removed.
    </p>
  );
}
