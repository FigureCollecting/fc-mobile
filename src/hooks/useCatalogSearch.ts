// The Search screen's catalog section (WK-17 B2): CatalogSearch over the session's coordinator
// client. Online means the browser has a network and the sync engine has not found the server
// unreachable; signed out, offline or unreachable, nothing is sent and the section stays hidden.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { CatalogSearch, type CatalogView } from './catalogSearch';
import { useOnlineStatus } from './useOnlineStatus';
import { localSession } from '../local/session';
import { useAuthPhase } from '../local/useLocal';

export function useCatalogSearch(query: string) {
  const session = localSession.value;
  const phase = useAuthPhase();
  const network = useOnlineStatus().value;
  const reachable = session?.engine.state.value.reachability !== 'unreachable';
  const search = useMemo(
    () => (session === undefined ? undefined : new CatalogSearch({ search: (req, opts) => session.clients.catalog.searchProducts(req, opts) })),
    [session],
  );
  const [view, setView] = useState<CatalogView>({ kind: 'hidden', reason: 'idle' });

  useEffect(() => {
    if (search === undefined) return;
    setView(search.view);
    const off = search.subscribe(setView);
    return () => {
      off();
      search.dispose();
    };
  }, [search]);

  const online = phase === 'signed-in' && network && reachable;
  useEffect(() => {
    search?.set(query, online);
  }, [search, query, online]);

  return { view, more: () => search?.more(), retry: () => search?.retry() };
}
