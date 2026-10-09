import { categories } from "./format";
import type { Category } from "./types";

type Props = {
  counts: Record<Category, number>;
  filter: Category | "all";
  loaded: boolean;
  onFilter: (category: Category | "all") => void;
};
export function StageFilters({ counts, filter, loaded, onFilter }: Props) {
  return (
    <div className="metrics" aria-label="Filter tasks by stage">
      {categories.map((category) => (
        <button
          key={category.id}
          className={`metric ${category.id} ${filter === category.id ? "selected" : ""}`}
          aria-pressed={filter === category.id}
          onClick={() => onFilter(filter === category.id ? "all" : category.id)}
        >
          <span className="metric-top">{category.label}</span>
          <strong>{loaded ? counts[category.id] : "—"}</strong>
          <span className="metric-help">{category.help}</span>
        </button>
      ))}
    </div>
  );
}
