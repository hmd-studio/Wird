/* Wird — Service Worker
   Strategy:
     - Navigation (HTML): network-first  -> users always get the newest build
     - Same-origin static assets: cache-first (fast, offline)
     - Google Fonts: stale-while-revalidate into a separate cache
*/

var VERSION   = 'v9';
var CORE      = 'wird-core-' + VERSION;
var RUNTIME   = 'wird-runtime-' + VERSION;
var FONTS     = 'wird-fonts-' + VERSION;
var KEEP      = [CORE, RUNTIME, FONTS];

var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CORE).then(function(cache){
      // addAll fails entirely if one file 404s — add individually instead
      return Promise.all(ASSETS.map(function(url){
        return cache.add(new Request(url, {cache: 'reload'})).catch(function(){});
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(names.map(function(name){
        if(KEEP.indexOf(name) === -1) return caches.delete(name);
      }));
    }).then(function(){
      if(self.registration.navigationPreload){
        return self.registration.navigationPreload.enable().catch(function(){});
      }
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('message', function(event){
  if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isFontRequest(url){
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

self.addEventListener('fetch', function(event){
  var req = event.request;
  if(req.method !== 'GET') return;

  var url;
  try{ url = new URL(req.url); }catch(e){ return; }
  if(url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* 1. Navigations — network first, fall back to cached shell */
  if(req.mode === 'navigate'){
    event.respondWith(
      (async function(){
        try{
          var preload = await event.preloadResponse;
          if(preload){
            var pc = preload.clone();
            caches.open(CORE).then(function(c){ c.put('./index.html', pc); });
            return preload;
          }
          var net = await fetch(req);
          var nc = net.clone();
          caches.open(CORE).then(function(c){ c.put('./index.html', nc); });
          return net;
        }catch(err){
          var cached = await caches.match('./index.html');
          return cached || (await caches.match('./')) || Response.error();
        }
      })()
    );
    return;
  }

  /* 2. Google Fonts — stale-while-revalidate */
  if(isFontRequest(url)){
    event.respondWith(
      caches.open(FONTS).then(function(cache){
        return cache.match(req).then(function(cached){
          var network = fetch(req).then(function(res){
            if(res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          }).catch(function(){ return cached; });
          return cached || network;
        });
      })
    );
    return;
  }

  /* 3. Same-origin assets — cache first, then network */
  if(url.origin === self.location.origin){
    event.respondWith(
      caches.match(req).then(function(cached){
        if(cached) return cached;
        return fetch(req).then(function(res){
          if(res && res.ok && res.type === 'basic'){
            var clone = res.clone();
            caches.open(RUNTIME).then(function(c){ c.put(req, clone); });
          }
          return res;
        }).catch(function(){ return cached || Response.error(); });
      })
    );
    return;
  }

  /* 4. Everything else — network, cache fallback */
  event.respondWith(
    fetch(req).catch(function(){ return caches.match(req); })
  );
});
