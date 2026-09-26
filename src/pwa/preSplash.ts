// The static splash in index.html covers the page until the app has mounted;
// this was an inline script, which a strict CSP forbids.
export function dismissPreSplash(doc: Document = document): void {
  setTimeout(() => {
    const el = doc.getElementById('pre-splash');
    if (el === null) return;
    el.classList.add('pre-splash--hidden');
    setTimeout(() => el.remove(), 500);
  }, 200);
}
