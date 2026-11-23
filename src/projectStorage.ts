const PROJECT_KEY = "merge-monitor.project";
const LEGACY_BOARD_KEY = "merge-monitor.board-project";

export function loadSavedProject(): string {
  try {
    const primary = localStorage.getItem(PROJECT_KEY);
    if (primary) return primary;
    const legacy = localStorage.getItem(LEGACY_BOARD_KEY) || "";
    if (legacy) localStorage.setItem(PROJECT_KEY, legacy);
    return legacy;
  } catch {
    return "";
  }
}

export function saveProject(id: string): void {
  try {
    localStorage.setItem(PROJECT_KEY, id);
  } catch {
    /* Preferences are optional; the current project remains selected. */
  }
}
