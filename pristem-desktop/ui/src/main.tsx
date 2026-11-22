import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './styles.css';
import './polish.css';
import App from './App';
import { applyCapFlags, installInertFallback } from './capabilities';

// Must run before the first render: capability flags gate CSS branches and
// the inert fallback has to be watching before any modal can be mounted.
applyCapFlags();
installInertFallback();

// Monaco cancels in-flight language work when a model is disposed and Chromium
// reports that cancellation as an unhandled rejection. Nothing failed, so keep
// exactly that reason out of the console; every other rejection still surfaces.
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as { message?: unknown } | undefined;
  if (typeof reason?.message === 'string' && /^Canceled/.test(reason.message)) e.preventDefault();
});

const rootEl = document.getElementById('root')!;
createRoot(rootEl).render(<App />);

// The boot shell is static HTML, so it paints before this bundle resolves.
// Hand over as soon as the first app frame is committed, and never let a
// failed render leave an overlay on top of the workbench.
const boot = document.getElementById('boot');
if (boot) {
  let handedOver = false;
  const finish = () => {
    if (handedOver || !boot.isConnected) return;
    handedOver = true;
    boot.classList.add('boot-done');
    window.setTimeout(() => boot.remove(), 260);
  };
  const observer = new MutationObserver(() => {
    if (rootEl.querySelector('.app-shell')) { observer.disconnect(); finish(); }
  });
  observer.observe(rootEl, { childList: true, subtree: true });
  if (rootEl.querySelector('.app-shell')) { observer.disconnect(); finish(); }
  window.setTimeout(() => { observer.disconnect(); finish(); }, 3500);
}
