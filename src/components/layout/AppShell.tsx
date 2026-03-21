import { lazy, Suspense } from 'preact/compat';
import { Route, Switch } from 'wouter';
import { BottomNav } from './BottomNav';
import { Collection } from '../../pages/Collection';
import { Discover } from '../../pages/Discover';
import { Prices } from '../../pages/Prices';
import { Profile } from '../../pages/Profile';

const FigureDetail = lazy(() => import('../../pages/FigureDetail').then((m) => ({ default: m.FigureDetail })));

function PageFallback() {
  return (
    <div class="page-fallback">
      <div class="page-fallback__spinner" />
      <style>{`
        .page-fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          padding: var(--space-12);
        }
        .page-fallback__spinner {
          width: 32px;
          height: 32px;
          border: 3px solid var(--surface-tertiary);
          border-top-color: var(--brand-500);
          border-radius: 50%;
          animation: pf-spin 0.7s linear infinite;
        }
        @keyframes pf-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export function AppShell() {
  return (
    <div class="app-shell">
      <main class="app-content">
        <Switch>
          <Route path="/" component={Collection} />
          <Route path="/discover" component={Discover} />
          <Route path="/prices" component={Prices} />
          <Route path="/profile" component={Profile} />
          <Route path="/figure/:id">
            <Suspense fallback={<PageFallback />}>
              <FigureDetail />
            </Suspense>
          </Route>
        </Switch>
      </main>
      <BottomNav />

      <style>{`
        .app-shell {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          overflow: hidden;
        }

        .app-content {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          padding-bottom: calc(var(--bottom-nav-height) + var(--safe-area-bottom));
        }
      `}</style>
    </div>
  );
}
