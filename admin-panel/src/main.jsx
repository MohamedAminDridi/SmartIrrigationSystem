// main.jsx
import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';

// Auto-reload once if the app fails to boot or a lazy chunk fails to load
// (e.g. after a deploy). A short cooldown guard prevents reload loops.
function autoReload(reason) {
  const KEY = 'app_reload_ts';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 10000) return;        // already reloaded recently — don't loop
  sessionStorage.setItem(KEY, String(Date.now()));
  console.warn('Auto-reloading app:', reason);
  window.location.reload();
}
window.addEventListener('vite:preloadError', () => autoReload('chunk preload failed'));
window.addEventListener('error', (e) => {
  if (/Loading (chunk|CSS chunk)|dynamically imported module|Importing a module script failed/i.test(e?.message || '')) autoReload('chunk load error');
});
window.addEventListener('unhandledrejection', (e) => {
  if (/Loading (chunk|CSS chunk)|dynamically imported module|Failed to fetch dynamically/i.test(String(e?.reason?.message || e?.reason || ''))) autoReload('chunk import rejection');
});

// Catches render-time crashes and reloads the app instead of leaving a blank screen.
class RootBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error('App crashed:', err); autoReload('render error'); }
  render() {
    if (this.state.failed) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui', color: '#475569' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 28, height: 28, margin: '0 auto 12px', border: '3px solid #cbd5e1', borderTopColor: '#10b981', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <div>Reloading…</div>
            <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <RootBoundary>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </RootBoundary>
);
