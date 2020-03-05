const urls = [
  '/',
  '/manifest.webmanifest',
  '/icon64.png',
  '/icon96.png',
  '/icon48.png',
  '/icon100.png',
  '/icon128.png',
];

self.addEventListener('fetch', (event) => {
  //console.log('SERVICEWORKER: Request: ' + event.request.url);
  event.respondWith(
    caches.match(event.request).then(async (response) => {
      if (response) {
        console.log('SERVICEWORKER: Respond from cache: ' + event.request.url);
        return response;
      } else {
        console.log('SERVICEWORKER: Respond with fetch: ' + event.request.url);
        return await fetch(event.request);
      }
    })
  );
});

self.addEventListener('install', function (event) {
  console.log('SERVICEWORKER: Installing version: ' + cacheName);
  self.skipWaiting();
  event.waitUntil(
    caches.open(cacheName).then(function (cache) {
      //return cache.addAll(urls)
      return Promise.all(
        Array.from(urls.values()).map(function(url) {
          const actualUrl = url + '?' + cacheName;    // Prevent cache
          const request = new Request(actualUrl, {credentials: 'same-origin'});
          return fetch(request).then(function(response) {
            if (!response.ok) {
                throw new Error('Request for ' + url + ' had status ' + response.status);
            }
            return cache.put(url, response);
          });
        })
      );
    })
  );
});

self.addEventListener('activate', function (event) {
  console.log('SERVICEWORKER: Activating version: ' + cacheName);
  event.waitUntil(
    caches.keys().then(function (keyList) {
      return Promise.all(keyList.map(function (key, i) {
        if (key !== cacheName) {
          return caches.delete(key);
        }
      }));
    })
  );
});

const cacheName = 'v' /* STRING TO BE COMPLETED AT BUILD TIME */