export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    const base = window.location.pathname.startsWith('/mp3fastmp3') ? '/mp3fastmp3' : '/fastmp3fast';
    const reloadKey = `fastmp3fast-sw-reloaded-${base}`;
    let controllerChanged = false;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (controllerChanged) {
        return;
      }
      controllerChanged = true;

      if (sessionStorage.getItem(reloadKey) === '1') {
        return;
      }

      sessionStorage.setItem(reloadKey, '1');
      window.location.reload();
    });

    void navigator.serviceWorker
      .register(`${base}/sw.js`, { scope: `${base}/` })
      .then((registration) => {
        const requestSkipWaiting = () => {
          if (registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        };

        requestSkipWaiting();

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) {
            return;
          }

          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              requestSkipWaiting();
            }
          });
        });

        void registration.update();
      })
      .catch(() => undefined);
  });
}
