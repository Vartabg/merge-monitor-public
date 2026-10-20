import { progressLabels } from "./assignmentTypes";
import type { Assignment } from "./assignmentTypes";

export function AssignmentRefreshNotice({ latest, busy, onLoad }: {
  latest: Assignment | undefined;
  busy: boolean;
  onLoad: (item: Assignment) => void;
}) {
  if (!latest) return null;
  return (
    <div className="error-box">
      <p role="status">
        This assignment changed while you were editing. Your draft is still
        here. Copy any text you want to keep before loading the latest details.
      </p>
      <p>Latest saved progress: {progressLabels[latest.status]}.</p>
      <button className="button" disabled={busy} onClick={() => onLoad(latest)}>
        Discard draft and load latest details
      </button>
    </div>
  );
}
