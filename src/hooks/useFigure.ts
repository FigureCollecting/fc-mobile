// One figure from the local store (WK-15): every shown copy of every kind, through its card.
import { useCallback } from 'preact/hooks';
import type { UseQueryResult } from '@tanstack/react-query';
import { figureOf, type LocalFigure } from '../local/figures';
import { useSnapshot, type Snapshot } from '../local/useLocal';

export class FigureNotFoundError extends Error {
  constructor(id: string) {
    super(`no copy of figure ${id} in this collection`);
    this.name = 'FigureNotFoundError';
  }
}

export function useFigure(id: string | undefined): UseQueryResult<LocalFigure> {
  const select = useCallback(
    (s: Snapshot): LocalFigure => {
      const figure = figureOf(s, id!);
      if (figure === undefined) throw new FigureNotFoundError(id!);
      return figure;
    },
    [id],
  );
  return useSnapshot(select, id !== undefined);
}
