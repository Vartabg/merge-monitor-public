import { useCallback, useRef, useState } from "react";
import type { Assignment } from "./assignmentTypes";

export function useAssignmentSelection() {
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [busy, setBusy] = useState(false);
  const edited = useRef(false);
  const focused = useRef(false);
  const refresh = useCallback((items: Assignment[]) => {
    setSelected((current) => {
      if (!current || edited.current || focused.current) return current;
      const latest = items.find((item) => item.id === current.id);
      return latest && latest.revision > current.revision ? latest : current;
    });
  }, []);
  const select = useCallback((item: Assignment | null) => {
    edited.current = false;
    focused.current = false;
    setSelected(item);
  }, []);
  const onEdit = useCallback(() => {
    edited.current = true;
  }, []);
  const onFocusChange = useCallback((isFocused: boolean) => {
    focused.current = isFocused;
  }, []);
  return { selected, select, refresh, onEdit, onFocusChange, busy, setBusy };
}
