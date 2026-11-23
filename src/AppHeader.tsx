import { useEffect } from "react";

export type AppView = "board" | "checks" | "team";

const PAGE_TITLES: Record<AppView, string> = {
  board: "Team board | Merge Monitor",
  checks: "Project checks | Merge Monitor",
  team: "Assignments | Merge Monitor",
};

export function AppHeader({
  view,
  kicker,
  title,
  purpose,
}: {
  view: AppView;
  kicker?: string;
  title: string;
  purpose: string;
}) {
  useEffect(() => {
    document.title = PAGE_TITLES[view];
  }, [view]);
  return (
    <header className="simple-header">
      <nav className="board-nav" aria-label="Primary">
        <span className="app-name">Merge Monitor</span>
        <a href="/" aria-current={view === "board" ? "page" : undefined}>
          Team board
        </a>
        <a
          href="?view=checks"
          aria-current={view === "checks" ? "page" : undefined}
        >
          Project checks
        </a>
        <a
          href="?view=team"
          aria-current={view === "team" ? "page" : undefined}
        >
          Assignments
        </a>
      </nav>
      {kicker && <p className="board-kicker">{kicker}</p>}
      <h1>{title}</h1>
      <p className="app-purpose">{purpose}</p>
    </header>
  );
}
