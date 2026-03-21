import { Route, Switch } from 'wouter';
import { BottomNav } from './BottomNav';
import { Collection } from '../../pages/Collection';
import { Discover } from '../../pages/Discover';
import { Prices } from '../../pages/Prices';
import { Profile } from '../../pages/Profile';

export function AppShell() {
  return (
    <div class="app-shell">
      <main class="app-content">
        <Switch>
          <Route path="/" component={Collection} />
          <Route path="/discover" component={Discover} />
          <Route path="/prices" component={Prices} />
          <Route path="/profile" component={Profile} />
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
