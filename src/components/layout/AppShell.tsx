import { lazy, Suspense } from 'preact/compat';
import { Route, Switch, useLocation } from 'wouter';
import { BottomNav } from './BottomNav';
import { OfflineBanner } from '../ui/OfflineBanner';
import { AnimatedRoutes } from '../ui/AnimatedRoutes';
import { Collection } from '../../pages/Collection';
import { Discover } from '../../pages/Discover';
import { Prices } from '../../pages/Prices';
import { Profile } from '../../pages/Profile';
import { Settings } from '../../pages/Settings';
import { Sync } from '../../pages/Sync';
import { Login } from '../../pages/Login';
import { Register } from '../../pages/Register';
import { Analytics } from '../../pages/Analytics';
import { Import } from '../../pages/Import';
import { Export } from '../../pages/Export';
import { Notifications } from '../../pages/Notifications';
import { ReleaseCalendar } from '../../pages/ReleaseCalendar';

const FigureDetail = lazy(() => import('../../pages/FigureDetail').then((m) => ({ default: m.FigureDetail })));
const PriceDetail = lazy(() => import('../../pages/PriceDetail').then((m) => ({ default: m.PriceDetail })));

const AUTH_ROUTES = ['/login', '/register'];

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

  return (
    <div class="app-shell">
      <OfflineBanner />
      <main class={`app-content ${isAuthRoute ? 'app-content--auth' : ''}`}>
        <AnimatedRoutes>
          <Switch>
            <Route path="/login" component={Login} />
            <Route path="/register" component={Register} />
            <Route path="/" component={Collection} />
            <Route path="/discover" component={Discover} />
            <Route path="/prices" component={Prices} />
            <Route path="/profile" component={Profile} />
            <Route path="/settings" component={Settings} />
            <Route path="/sync" component={Sync} />
            <Route path="/analytics" component={Analytics} />
            <Route path="/import" component={Import} />
            <Route path="/export" component={Export} />
            <Route path="/notifications" component={Notifications} />
            <Route path="/calendar" component={ReleaseCalendar} />
            <Route path="/profile/security">
              {() => <Profile />}
            </Route>
            <Route path="/prices/:figureId">
              <Suspense fallback={<PageFallback />}>
                <PriceDetail />
              </Suspense>
            </Route>
            <Route path="/figure/:id">
              <Suspense fallback={<PageFallback />}>
                <FigureDetail />
              </Suspense>
            </Route>
          </Switch>
        </AnimatedRoutes>
      </main>
      {!isAuthRoute && <BottomNav />}

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
