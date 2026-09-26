import { render } from 'preact';
import './styles/global.css';
// Import theme store for side-effect (applies saved theme on load)
import './stores/theme';
import { App } from './app';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { SplashScreen } from './components/ui/SplashScreen';
import { dismissPreSplash } from './pwa/preSplash';
import { startServiceWorker } from './pwa/updates';

render(
  <ErrorBoundary>
    <SplashScreen />
    <App />
  </ErrorBoundary>,
  document.getElementById('app')!,
);

dismissPreSplash();
startServiceWorker();
