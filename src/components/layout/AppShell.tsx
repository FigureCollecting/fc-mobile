import { lazy, Suspense } from 'preact/compat';
import { useMemo } from 'preact/hooks';
import { Route, Switch, useLocation } from 'wouter';
import { TabBar } from './TabBar';
import { GatedScreen } from './GatedScreen';
import { OfflineBanner } from '../ui/OfflineBanner';
import { AnimatedRoutes } from '../ui/AnimatedRoutes';
import { createScrollChromeHandler } from '../../stores/chrome';
import { Collection } from '../../pages/Collection';
import { Discover } from '../../pages/Discover';
import { Stats } from '../../pages/Stats';
import { Profile } from '../../pages/Profile';
import { Settings } from '../../pages/Settings';
import { Sync } from '../../pages/Sync';
import { Login } from '../../pages/Login';
import { Register } from '../../pages/Register';
import { TwoFactor } from '../../pages/TwoFactor';
import { Import } from '../../pages/Import';
import { Export } from '../../pages/Export';
import { Notifications } from '../../pages/Notifications';

const FigureDetail = lazy(() => import('../../pages/FigureDetail').then((m) => ({ default: m.FigureDetail })));

const AUTH_ROUTES = ['/login', '/register', '/2fa'];

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
  const [location] = useLocation();
  const isAuthRoute = AUTH_ROUTES.includes(location);
  const onScroll = useMemo(() => {
    const handler = createScrollChromeHandler();
    return (e: Event) => handler((e.currentTarget as HTMLElement).scrollTop);
  }, []);

  return (
    <div class="app-shell">
      <OfflineBanner />
      <main
        class={`app-content ${isAuthRoute ? 'app-content--auth' : ''}`}
        onScroll={onScroll}
      >
        <AnimatedRoutes>
          <Switch>
            <Route path="/login" component={Login} />
            <Route path="/register" component={Register} />
            <Route path="/2fa" component={TwoFactor} />
            <Route path="/" component={Collection} />
            <Route path="/discover" component={Discover} />
            <Route path="/stats" component={Stats} />
            <Route path="/profile" component={Profile} />
            <Route path="/settings" component={Settings} />
            <Route path="/sync" component={Sync} />
            <Route path="/import" component={Import} />
            <Route path="/export" component={Export} />
            <Route path="/notifications" component={Notifications} />
            {/* Gated until each feature gets its mobile condensation pass */}
            <Route path="/prices">{() => <GatedScreen feature="Price Tracker" />}</Route>
            <Route path="/prices/:figureId">{() => <GatedScreen feature="Price Tracker" />}</Route>
            <Route path="/analytics">{() => <GatedScreen feature="Analytics" />}</Route>
            <Route path="/calendar">{() => <GatedScreen feature="Release Calendar" />}</Route>
            <Route path="/collection-dna">{() => <GatedScreen feature="Collection DNA" />}</Route>
            <Route path="/profile/security">
              {() => <Profile />}
            </Route>
            <Route path="/figure/:id">
              <Suspense fallback={<PageFallback />}>
                <FigureDetail />
              </Suspense>
            </Route>
          </Switch>
        </AnimatedRoutes>
      </main>
      {!isAuthRoute && <TabBar />}

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

        .app-content--auth {
          padding-bottom: 0;
        }
      `}</style>
    </div>
  );
}
