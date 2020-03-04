const urls = [
  '/',
  '/manifest.webmanifest',
  '/icon64.png',
  '/icon96.png',
  '/icon48.png',
  '/icon100.png',
  '/icon128.png',
];

self.addEventListener('fetch', function (event) {
  //console.log('SERVICEWORKER: Request: ' + evt.request.url);
  event.respondWith(
    caches.match(event.request).then(function (request) {
      if (request) {
        //console.log('SERVICEWORKER: From cache: ' + evt.request.url);
        return request;
      } else {
        //const newUrl = evt.request.url + '?version=' + cacheName;
        //console.log('SERVICEWORKER: From fetch: ' + newUrl);
        //return fetch(new Request(newUrl), event.request);
        return fetch(request);
      }
    })
  );
});

self.addEventListener('install', function (event) {
  console.log('SERVICEWORKER: Installing version: ' + cacheName);
  event.waitUntil(
    caches.open(cacheName).then(function (cache) {
      return cache.addAll(urls)
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