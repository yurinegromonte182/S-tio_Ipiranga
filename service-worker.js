const CACHE_NAME = 'sitio-ipiranga-v7.1';
const CACHE_TIMEOUT = 3000;

// URLs para cachear (apenas arquivos estáticos)
const urlsToCache = [
  '/S-tio_Ipiranga/',
  '/S-tio_Ipiranga/index.html',
  '/S-tio_Ipiranga/manifest.json'
];

// Instalação
self.addEventListener('install', event => {
  console.log('[SW] Instalando v7.1...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Cache aberto');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('[SW] Instalado com sucesso');
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('[SW] Erro na instalação:', err);
      })
  );
});

// Ativação
self.addEventListener('activate', event => {
  console.log('[SW] Ativando...');
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Deletando cache antigo:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Ativado');
        return self.clients.claim();
      })
  );
});

// Fetch - estratégia diferente para Supabase vs arquivos locais
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 🎯 SUPABASE: Sempre buscar da rede (dados dinâmicos)
  if (url.origin.includes('supabase.co')) {
    event.respondWith(
      fetch(request)
        .catch(error => {
          console.warn('[SW] Supabase offline:', error);
          // Retornar resposta vazia se Supabase estiver offline
          return new Response(
            JSON.stringify({ error: 'offline', cached: true }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        })
    );
    return;
  }

  // 📱 ARQUIVOS LOCAIS: Cache first, network fallback
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request)
        .then(cached => {
          if (cached) {
            return cached;
          }
          
          // Buscar da rede com timeout
          return Promise.race([
            fetch(request),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), CACHE_TIMEOUT)
            )
          ])
          .then(response => {
            // Cachear se for uma resposta válida
            if (response && response.status === 200) {
              const responseToCache = response.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(request, responseToCache);
              });
            }
            return response;
          })
          .catch(error => {
            console.warn('[SW] Fetch falhou:', request.url, error);
            
            // Retornar página offline para navegação
            if (request.mode === 'navigate') {
              return new Response(
                `<!DOCTYPE html>
                <html lang="pt-BR">
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>Offline - Sítio Ipiranga</title>
                  <style>
                    body {
                      font-family: system-ui, -apple-system, sans-serif;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      min-height: 100vh;
                      margin: 0;
                      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                      color: white;
                      text-align: center;
                      padding: 2rem;
                    }
                    .offline {
                      background: rgba(255,255,255,0.1);
                      backdrop-filter: blur(10px);
                      padding: 2rem;
                      border-radius: 16px;
                      max-width: 400px;
                    }
                    h1 { font-size: 3rem; margin: 0 0 1rem 0; }
                    p { margin: 1rem 0; opacity: 0.9; }
                    button {
                      background: white;
                      color: #10b981;
                      border: none;
                      padding: 1rem 2rem;
                      border-radius: 8px;
                      cursor: pointer;
                      font-size: 1rem;
                      font-weight: 600;
                      margin-top: 1rem;
                    }
                    button:active {
                      transform: scale(0.95);
                    }
                  </style>
                </head>
                <body>
                  <div class="offline">
                    <h1>📡</h1>
                    <h2>Você está offline</h2>
                    <p>Verifique sua conexão com a internet e tente novamente.</p>
                    <p><small>Os dados salvos anteriormente ainda estão disponíveis.</small></p>
                    <button onclick="location.reload()">🔄 Tentar Novamente</button>
                  </div>
                </body>
                </html>`,
                {
                  headers: { 'Content-Type': 'text/html' }
                }
              );
            }
            
            return new Response('', { status: 408 });
          });
        })
    );
    return;
  }

  // 🌐 OUTROS RECURSOS: Network only
  event.respondWith(fetch(request));
});

// Mensagens do cliente
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  
  if (event.data === 'clearCache') {
    event.waitUntil(
      caches.keys().then(keys => {
        return Promise.all(
          keys.map(key => caches.delete(key))
        );
      })
    );
  }
});
