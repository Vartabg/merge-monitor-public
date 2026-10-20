import { useCallback, useRef, useState } from "react";
import type { Assignment } from "./assignmentTypes";

export function useAssignmentSelection() {
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [busy, setBusy] = useState(false);
  const edited = useRef(false);
  const refresh = useCallback((items: Assignment[]) => {
    setSelected((current) => {
      if (!current || edited.current) return current;
      const latest = items.find((item) => item.id === current.id);
      return latest && latest.revision > current.revision ? latest : current;
    });
  }, []);
  function select(item: Assignment | null) {
    edited.current = false;
    setSelected(item);
  }
  function onEdit() {
    edited.current = true;
  }
  return { selected, select, refresh, onEdit, busy, setBusy };
}
