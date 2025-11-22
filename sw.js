// Service Worker for CMA-ES WebAssembly Playground
// Provides offline support and caching for better performance

const CACHE_NAME = 'cmaes-wasm-v2';
const STATIC_CACHE_NAME = 'cmaes-static-v2';
const DYNAMIC_CACHE_NAME = 'cmaes-dynamic-v2';
const BASE = self.location.pathname.startsWith('/wasm_cmaes/') ? '/wasm_cmaes' : '';

// Files to cache immediately on install
const STATIC_ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/examples/viz-benchmarks.html`,
  `${BASE}/examples/viz-benchmarks-classic.html`,
  `${BASE}/examples/tailwind.css`,
  `${BASE}/examples/app.js`,
  `${BASE}/favicon.ico`,
  `${BASE}/manifest.json`,
  `${BASE}/icon-192.png`,
  `${BASE}/icon-512.png`,
  // WASM packages
  `${BASE}/pkg/cmaes_wasm.js`,
  `${BASE}/pkg/cmaes_wasm_bg.wasm`,
  `${BASE}/pkg/cmaes_wasm_bg.wasm.d.ts`,
  `${BASE}/pkg/cmaes_wasm.d.ts`
];

// CDN resources to cache (network-first strategy)
const CDN_RESOURCES = [
  'https://cdn.jsdelivr.net/npm/d3@7',
  'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil((async () => {
    try {
      const cache = await caches.open(STATIC_CACHE_NAME);
      console.log('[SW] Caching static assets');
      await cache.addAll(STATIC_ASSETS);
      console.log('[SW] Static assets cached');
      await self.skipWaiting(); // Activate immediately
    } catch (err) {
      console.error('[SW] Failed to cache static assets:', err);
    }
  })());
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil((async () => {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => {
            // Remove old caches
            return name !== STATIC_CACHE_NAME &&
                   name !== DYNAMIC_CACHE_NAME &&
                   name.startsWith('cmaes-');
          })
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );

      console.log('[SW] Service worker activated');
      await self.clients.claim(); // Take control immediately
    } catch (err) {
      console.error('[SW] Activation failed:', err);
    }
  })());
});

// Fetch event - serve from cache when possible
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests that aren't CDN resources
  if (url.origin !== location.origin && !isCDNResource(url.href)) {
    return;
  }

  // Network-first strategy for CDN resources
  if (isCDNResource(url.href)) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // Cache-first strategy for static assets
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  // Network-first for dynamic content
  event.respondWith(networkFirstStrategy(request));
});

// Cache-first strategy: check cache, fallback to network
async function cacheFirstStrategy(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('[SW] Serving from cache:', request.url);
      return cachedResponse;
    }

    console.log('[SW] Fetching from network:', request.url);
    const networkResponse = await fetch(request);

    // Cache successful responses
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.error('[SW] Fetch failed:', error);

    // Return offline page if available
    const offlineResponse = await caches.match(`${BASE}/index.html`);
    if (offlineResponse) {
      return offlineResponse;
    }

    // Fallback response
    return new Response('Offline - please check your connection', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({
        'Content-Type': 'text/plain'
      })
    });
  }
}

// Network-first strategy: try network, fallback to cache
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request);

    // Cache successful responses
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);

    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // If it's a navigation request, return cached index
    if (request.mode === 'navigate') {
      const indexResponse = await caches.match('/wasm_cmaes/index.html');
      if (indexResponse) {
        return indexResponse;
      }
    }

    console.error('[SW] Network-first strategy fell back without cache:', error);
    return new Response('Offline - please check your connection', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({
        'Content-Type': 'text/plain'
      })
    });
  }
}

// Helper: Check if URL is a CDN resource
function isCDNResource(url) {
  return CDN_RESOURCES.some(cdn => url.startsWith(cdn));
}

// Helper: Check if path is a static asset
function isStaticAsset(pathname) {
  const staticExtensions = ['.html', '.js', '.wasm', '.css', '.json', '.ico', '.png', '.jpg', '.svg'];
  return staticExtensions.some(ext => pathname.endsWith(ext));
}

// Message handler for cache management
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil((async () => {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
        if (event.ports[0]) {
          event.ports[0].postMessage({ success: true });
        }
      } catch (err) {
        console.error('[SW] CLEAR_CACHE failed:', err);
        if (event.ports[0]) {
          event.ports[0].postMessage({ success: false, error: String(err) });
        }
      }
    })());
  }

  if (event.data && event.data.type === 'CACHE_STATS') {
    event.waitUntil((async () => {
      try {
        const cacheNames = await caches.keys();
        const stats = await Promise.all(
          cacheNames.map(async (name) => {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            return { name, count: keys.length };
          })
        );
        if (event.ports[0]) {
          event.ports[0].postMessage({ stats });
        }
      } catch (err) {
        console.error('[SW] CACHE_STATS failed:', err);
        if (event.ports[0]) {
          event.ports[0].postMessage({ error: String(err) });
        }
      }
    })());
  }
});

// Background sync for future enhancement
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);

  if (event.tag === 'sync-results') {
    event.waitUntil(syncResults());
  }
});

async function syncResults() {
  // Placeholder for future background sync functionality
  // Could be used to sync optimization results to a server
  console.log('[SW] Syncing results...');
}

// Push notification support (for future enhancement)
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');

  const options = {
    body: event.data ? event.data.text() : 'New update available!',
    icon: '/wasm_cmaes/icon-192.png',
    badge: '/wasm_cmaes/icon-192.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'Open App'
      },
      {
        action: 'close',
        title: 'Dismiss'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('CMA-ES Playground', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);

  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/wasm_cmaes/')
    );
  }
});

console.log('[SW] Service worker loaded');
