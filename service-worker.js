const CACHE_NAME = 'sitio-ipiranga-v7.1';
const CACHE_TIMEOUT = 3000; // 3 segundos máximo para rede

// URLs essenciais para cache
const urlsToCache = [
  '/S-tio_Ipiranga/',
  '/S-tio_Ipiranga/index.html',
  '/S-tio_Ipiranga/manifest.json'
];

// Instalação - cachear apenas o essencial
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
        return self.skipWaiting(); // Ativar imediatamente
      })
      .catch(err => {
        console.error('[SW] Erro na instalação:', err);
      })
  );
});

// Ativação - limpar caches antigos
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
        console.log('[SW] Ativado e controlando páginas');
        return self.clients.claim(); // Controlar todas as páginas imediatamente
      })
  );
});

// Função com timeout para fetch
function fetchWithTimeout(request, timeout = CACHE_TIMEOUT) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Network timeout')), timeout)
    )
  ]);
}

// Estratégia: Network First com fallback para Cache (com timeout)
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requisições para APIs externas (GitHub, etc)
  if (url.origin !== location.origin) {
    event.respondWith(fetch(request));
    return;
  }

  // Para arquivos HTML: Network first, depois cache
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetchWithTimeout(request, 2000) // 2 segundos para HTML
        .then(response => {
          // Clonar e cachear a resposta
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // Se falhar, tenta do cache
          return caches.match(request).then(cached => {
            if (cached) {
              console.log('[SW] Servindo do cache:', request.url);
              return cached;
            }
            // Se não tiver cache, retorna página offline simples
            return new Response(
              `<!DOCTYPE html>
              <html>
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
                    background: #f3f4f6;
                    text-align: center;
                    padding: 2rem;
                  }
                  .offline {
                    background: white;
                    padding: 2rem;
                    border-radius: 12px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                  }
                  h1 { color: #ef4444; margin: 0 0 1rem 0; }
                  button {
                    background: #10b981;
                    color: white;
                    border: none;
                    padding: 0.75rem 1.5rem;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 1rem;
                    margin-top: 1rem;
                  }
                </style>
              </head>
              <body>
                <div class="offline">
                  <h1>📡 Sem Conexão</h1>
                  <p>Você está offline. Verifique sua conexão com a internet.</p>
                  <button onclick="location.reload()">🔄 Tentar Novamente</button>
                </div>
              </body>
              </html>`,
              {
                headers: { 'Content-Type': 'text/html' }
              }
            );
          });
        })
    );
    return;
  }

  // Para outros recursos: Cache first, depois network
  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) {
          // Retorna do cache imediatamente
          return cached;
        }
        
        // Se não tem cache, busca da rede
        return fetchWithTimeout(request, CACHE_TIMEOUT)
          .then(response => {
            // Apenas cachear respostas válidas
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
            // Retorna resposta vazia para evitar erro
            return new Response('', { status: 408 });
          });
      })
  );
});

// Log de mensagens
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
