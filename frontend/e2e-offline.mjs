import { chromium } from 'playwright';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4174';
const APP_PREFIX = process.env.E2E_APP_PREFIX ?? '/fastmp3fast';
const TEST_URL = process.env.E2E_TEST_URL ?? `https://samplelib.com/lib/preview/mp4/sample-10s.mp4?e2e=${Date.now()}`;
const E2E_LOGIN = process.env.E2E_LOGIN ?? 'admin';
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'Fastmp3fast123!';

async function pendingCount(page) {
  return page.evaluate(async () => {
    return await new Promise((resolve, reject) => {
      const req = indexedDB.open('fastmp3fast-db');
      req.onerror = () => reject(req.error?.message ?? 'indexeddb open error');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('pendingOperations', 'readonly');
        const store = tx.objectStore('pendingOperations');
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          const rows = Array.isArray(getAll.result) ? getAll.result : [];
          resolve(rows.filter((x) => x.status === 'pending' || x.status === 'error').length);
        };
        getAll.onerror = () => reject(getAll.error?.message ?? 'getAll pendingOperations error');
      };
    });
  });
}

async function downloadByUrl(page, url) {
  return page.evaluate(async (targetUrl) => {
    return await new Promise((resolve, reject) => {
      const req = indexedDB.open('fastmp3fast-db');
      req.onerror = () => reject(req.error?.message ?? 'indexeddb open error');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('downloads', 'readonly');
        const store = tx.objectStore('downloads');
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          const rows = Array.isArray(getAll.result) ? getAll.result : [];
          const found = rows
            .filter((x) => x.sourceUrl === targetUrl)
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
          resolve(found);
        };
        getAll.onerror = () => reject(getAll.error?.message ?? 'getAll downloads error');
      };
    });
  }, url);
}

async function clickNavLink(page, label) {
  const fallbackRoutes = {
    'Nueva descarga': '/downloads/new',
    Sincronizacion: '/sync',
    Biblioteca: '/library',
  };
  const direct = page.getByRole('link', { name: label });
  if ((await direct.count()) > 0 && (await direct.first().isVisible().catch(() => false))) {
    await direct.first().click();
    return;
  }

  const openMenuBtn = page.getByRole('button', { name: /Abrir menu|Cerrar menu/i });
  if ((await openMenuBtn.count()) > 0) {
    await openMenuBtn.first().click();
  }

  const insideMenu = page.getByRole('link', { name: label });
  if ((await insideMenu.count()) > 0 && (await insideMenu.first().isVisible().catch(() => false))) {
    await insideMenu.first().click();
    return;
  }

  const fallback = fallbackRoutes[label];
  if (fallback) {
    await page.goto(`${BASE_URL}${APP_PREFIX}${fallback}`, { waitUntil: 'domcontentloaded' });
    return;
  }

  throw new Error(`Navigation link not found: ${label}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(`${BASE_URL}${APP_PREFIX}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Ignore when storage is unavailable for the current origin.
    }
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('fastmp3fast-db');
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(true);
      req.onblocked = () => resolve(true);
    });
  });

  await page.goto(`${BASE_URL}${APP_PREFIX}/`, { waitUntil: 'domcontentloaded' });
  const loginInput = page.locator('input[placeholder="antonio"], input[placeholder="admin"], input[type="text"]').first();
  if ((await loginInput.count()) > 0) {
    await loginInput.fill(E2E_LOGIN);
    await page.locator('input[type="password"]').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Entrar a FASTMP3FAST' }).click();
    await page.waitForURL('**/dashboard', { timeout: 20000 });
  } else {
    await page.goto(`${BASE_URL}${APP_PREFIX}/dashboard`, { waitUntil: 'domcontentloaded' });
  }

  await clickNavLink(page, 'Nueva descarga');
  await page.waitForURL('**/downloads/new', { timeout: 10000 });
  await page.locator('input[placeholder="https://youtube.com/..."]').waitFor({ timeout: 15000 });

  await context.setOffline(true);
  await page.getByText('Modo offline activo').waitFor({ timeout: 10000 });
  await page.locator('input[placeholder="https://youtube.com/..."]').fill(TEST_URL);
  await page
    .locator('button:has-text("Descargar ahora"), button:has-text("Guardar en cola local"), button:has-text("Guardar solicitud")')
    .first()
    .click();
  await page.waitForTimeout(1200);

  const pendingOffline = await pendingCount(page);
  const offlineRecord = await downloadByUrl(page, TEST_URL);
  const offlineStored = Boolean(offlineRecord);

  if (!offlineStored) {
    throw new Error(`Offline enqueue failed: no local download record for ${TEST_URL}`);
  }

  await context.setOffline(false);
  await page.waitForTimeout(800);
  await clickNavLink(page, 'Sincronizacion');
  await page.waitForURL('**/sync', { timeout: 10000 });
  await page.getByRole('button', { name: /Sincronizar ahora|Forzar sync/i }).first().click({ force: true });

  const started = Date.now();
  let pendingAfterSync = await pendingCount(page);
  while (pendingAfterSync > 0 && Date.now() - started < 45000) {
    await page.waitForTimeout(1500);
    pendingAfterSync = await pendingCount(page);
  }

  // Allow one full sync engine cycle (20s) to hydrate local rows from backend.
  await page.waitForTimeout(22000);

  await clickNavLink(page, 'Biblioteca');
  await page.waitForURL('**/library', { timeout: 10000 });
  await page.waitForTimeout(3000);
  const syncedRecord = await downloadByUrl(page, TEST_URL);
  const syncedFromBackend = Boolean(syncedRecord && syncedRecord.syncStatus !== 'local_only');

  if (!syncedFromBackend) {
    throw new Error(
      `Sync failed: record is still local_only or missing (pendingOffline=${pendingOffline}, pendingAfterSync=${pendingAfterSync})`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        pendingOffline,
        pendingAfterSync,
        offlineStored,
        syncedFromBackend,
        offlineRecord: offlineRecord
          ? {
              status: offlineRecord.status,
              syncStatus: offlineRecord.syncStatus,
              localId: offlineRecord.localId,
            }
          : null,
        syncedRecord: syncedRecord
          ? {
              status: syncedRecord.status,
              syncStatus: syncedRecord.syncStatus,
              localId: syncedRecord.localId,
              title: syncedRecord.title,
            }
          : null,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error('E2E_ERROR', error);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
