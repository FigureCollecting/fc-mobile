import { useState, useCallback } from 'preact/hooks';

export function useMultiSelect() {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const enterSelectMode = useCallback((id: string) => {
    setIsSelecting(true);
    setSelected(new Set([id]));
  }, []);

  const exitSelectMode = useCallback(() => {
    setIsSelecting(false);
    setSelected(new Set());
  }, []);

  return { isSelecting, selected, toggle, selectAll, clearSelection, enterSelectMode, exitSelectMode };
}
