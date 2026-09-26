import { lazy, Suspense } from 'preact/compat';
import { useMemo } from 'preact/hooks';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { TabBar } from './TabBar';
import { GatedScreen } from './GatedScreen';
import { OfflineBanner } from '../ui/OfflineBanner';
import { InstallBanner } from '../../pwa/InstallBanner';
import { getPendingOpsCount } from '../../storage/pendingOps';
import { AnimatedRoutes } from '../ui/AnimatedRoutes';
import { createScrollChromeHandler } from '../../stores/chrome';
import { LEGACY_SCREENS_ENABLED, OIDC_AUTH_ENABLED } from '../../config/features';
import { Collection } from '../../pages/Collection';
import { Discover } from '../../pages/Discover';
import { Stats } from '../../pages/Stats';
import { Profile } from '../../pages/Profile';
import { Settings } from '../../pages/Settings';
import { Login } from '../../pages/Login';
import { Register } from '../../pages/Register';
import { TwoFactor } from '../../pages/TwoFactor';
import { Import } from '../../pages/Import';
import { Style } from '../../styles/Style';

const FigureDetail = lazy(() => import('../../pages/FigureDetail').then((m) => ({ default: m.FigureDetail })));
// No backend anywhere (src/config/features.ts) — lazy so a default build,
// where LEGACY_SCREENS_ENABLED is off, never pulls these into the main chunk.
const Sync = lazy(() => import('../../pages/Sync').then((m) => ({ default: m.Sync })));
const Export = lazy(() => import('../../pages/Export').then((m) => ({ default: m.Export })));
const Notifications = lazy(() =>
  import('../../pages/Notifications').then((m) => ({ default: m.Notifications })),
);
// Only the OIDC build registers /callback; a legacy build must never open the v2 store.
const OidcCallbackRoute = lazy(() => import('../auth/OidcCallbackRoute'));

const AUTH_ROUTES = ['/login', '/register', '/2fa', '/callback'];

function PageFallback() {
  return (
    <div class="page-fallback">
      <div class="page-fallback__spinner" />
      <Style css={`
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
      `} />
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
      {/* In the layout, above the screen, so it never covers a control. The
          running outbox is the legacy one until WK-15 switches the app over. */}
      <InstallBanner unsyncedCount={getPendingOpsCount} />
      <main
        class={`app-content ${isAuthRoute ? 'app-content--auth' : ''}`}
        onScroll={onScroll}
      >
        <AnimatedRoutes>
          <Switch>
            <Route path="/login" component={Login} />
            <Route path="/register" component={Register} />
            <Route path="/2fa" component={TwoFactor} />
            {OIDC_AUTH_ENABLED && (
              <Route path="/callback">
                <Suspense fallback={<PageFallback />}><OidcCallbackRoute /></Suspense>
              </Route>
            )}
            <Route path="/" component={Collection} />
            <Route path="/discover" component={Discover} />
            <Route path="/stats" component={Stats} />
            <Route path="/profile" component={Profile} />
            <Route path="/settings" component={Settings} />
            <Route path="/import" component={Import} />
            {/* No backend anywhere (src/config/features.ts): off by default,
                deep links land back on the collection instead of a dead screen. */}
            {LEGACY_SCREENS_ENABLED ? (
              <>
                <Route path="/sync">
                  <Suspense fallback={<PageFallback />}><Sync /></Suspense>
                </Route>
                <Route path="/export">
                  <Suspense fallback={<PageFallback />}><Export /></Suspense>
                </Route>
                <Route path="/notifications">
                  <Suspense fallback={<PageFallback />}><Notifications /></Suspense>
                </Route>
                <Route path="/prices">{() => <GatedScreen feature="Price Tracker" />}</Route>
                <Route path="/prices/:figureId">{() => <GatedScreen feature="Price Tracker" />}</Route>
                <Route path="/analytics">{() => <GatedScreen feature="Analytics" />}</Route>
                <Route path="/calendar">{() => <GatedScreen feature="Release Calendar" />}</Route>
                <Route path="/collection-dna">{() => <GatedScreen feature="Collection DNA" />}</Route>
              </>
            ) : (
              <>
                <Route path="/sync"><Redirect to="/" /></Route>
                <Route path="/export"><Redirect to="/" /></Route>
                <Route path="/notifications"><Redirect to="/" /></Route>
                <Route path="/prices"><Redirect to="/" /></Route>
                <Route path="/prices/:figureId"><Redirect to="/" /></Route>
                <Route path="/analytics"><Redirect to="/" /></Route>
                <Route path="/calendar"><Redirect to="/" /></Route>
                <Route path="/collection-dna"><Redirect to="/" /></Route>
              </>
            )}
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

      <Style css={`
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
      `} />
    </div>
  );
}
