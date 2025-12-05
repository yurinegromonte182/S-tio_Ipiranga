const CACHE_NAME = 'sitio-ipiranga-v8.0';
const CACHE_TIMEOUT = 3000;

// URLs para cachear (apenas arquivos estáticos)
const urlsToCache = [
  '/S-tio_Ipiranga/',
  '/S-tio_Ipiranga/index.html',
  '/S-tio_Ipiranga/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js'
];

// Instalação
self.addEventListener('install', event => {
  console.log('[SW] Instalando v8.0...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Cache aberto, adicionando recursos...');
        return cache.addAll(urlsToCache).catch(err => {
          console.warn('[SW] Alguns recursos não puderam ser cacheados:', err);
        });
      })
      .then(() => {
        console.log('[SW] Instalado com sucesso');
        return self.skipWaiting();
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
  
  // Ignorar requisições que não são GET
  if (request.method !== 'GET') {
    event.respondWith(fetch(request));
    return;
  }

  // 🎯 SUPABASE: Network first com fallback para cache
  if (url.origin.includes('supabase.co')) {
    event.respondWith(
      networkFirstWithTimeout(request)
        .catch(() => cacheFallbackForSupabase(request))
    );
    return;
  }

  // 📱 ARQUIVOS LOCAIS e CDNs: Cache first
  event.respondWith(
    cacheFirstWithNetworkFallback(request)
  );
});

// Estratégia: Network First com Timeout para Supabase
async function networkFirstWithTimeout(request) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CACHE_TIMEOUT);
    
    const response = await fetch(request, { 
      signal: controller.signal 
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      // Atualizar cache em background para próximas requisições
      cacheResponse(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.warn('[SW] Network error:', error);
    throw error;
  }
}

// Fallback para Supabase offline
async function cacheFallbackForSupabase(request) {
  const url = new URL(request.url);
  
  console.log('[SW] Supabase offline, usando cache');
  
  // Verificar se temos uma resposta em cache
  const cached = await caches.match(request);
  if (cached) {
    console.log('[SW] Retornando resposta cacheada');
    return cached;
  }
  
  // Se for uma requisição GET para frutiferas
  if (request.method === 'GET' && url.pathname.includes('/frutiferas')) {
    return new Response(
      JSON.stringify({ 
        error: 'offline', 
        message: 'Banco de dados offline. Use dados locais.',
        offline: true
      }),
      {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'X-Service-Worker': 'offline-fallback'
        }
      }
    );
  }
  
  // Resposta genérica para outras requisições Supabase
  return new Response(
    JSON.stringify({ 
      error: 'offline', 
      message: 'Supabase offline. Sem dados disponíveis no cache.',
      offline: true 
    }),
    {
      status: 503,
      headers: { 
        'Content-Type': 'application/json',
        'X-Service-Worker': 'offline-fallback'
      }
    }
  );
}

// Estratégia: Cache First com Network Fallback
async function cacheFirstWithNetworkFallback(request) {
  const url = new URL(request.url);
  
  // Verificar cache primeiro
  const cached = await caches.match(request);
  if (cached) {
    // Verificar se a resposta em cache ainda é válida
    const cacheAge = getCacheAge(cached);
    if (cacheAge < 3600000) { // 1 hora
      console.log('[SW] Cache válido, retornando:', request.url);
      return cached;
    }
    
    // Cache muito antigo, tentar atualizar em background
    updateCacheInBackground(request);
  }
  
  // Tentar rede com timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CACHE_TIMEOUT);
    
    const response = await fetch(request, { 
      signal: controller.signal 
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      // Cachear a resposta para uso futuro
      cacheResponse(request, response.clone());
      return response;
    }
    
    throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.warn('[SW] Fetch failed:', request.url, error);
    
    // Se tivermos cache, usar mesmo que antigo
    if (cached) {
      console.log('[SW] Usando cache antigo como fallback');
      return cached;
    }
    
    // Fallback para navegação offline
    if (request.mode === 'navigate') {
      return getOfflinePage();
    }
    
    // Fallback para recursos de mídia
    if (request.destination === 'image') {
      return new Response(
        `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
          <rect width="100" height="100" fill="#f3f4f6"/>
          <text x="50" y="50" text-anchor="middle" dy=".3em" fill="#6b7280" font-size="10">🌿</text>
        </svg>`,
        {
          headers: { 
            'Content-Type': 'image/svg+xml',
            'X-Service-Worker': 'image-fallback'
          }
        }
      );
    }
    
    // Fallback genérico
    return new Response('', { 
      status: 408,
      statusText: 'Network Timeout' 
    });
  }
}

// Função auxiliar para cachear resposta
async function cacheResponse(request, response) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response);
    console.log('[SW] Cache atualizado:', request.url);
  } catch (error) {
    console.warn('[SW] Erro ao cachear:', error);
  }
}

// Função para atualizar cache em background
async function updateCacheInBackground(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cacheResponse(request, response);
      console.log('[SW] Cache atualizado em background:', request.url);
    }
  } catch (error) {
    // Ignorar erros em background updates
  }
}

// Função para obter idade do cache
function getCacheAge(cachedResponse) {
  const dateHeader = cachedResponse.headers.get('date');
  if (dateHeader) {
    const cacheDate = new Date(dateHeader).getTime();
    return Date.now() - cacheDate;
  }
  return Infinity;
}

// Página offline
function getOfflinePage() {
  return new Response(
    `<!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Sítio Ipiranga - Offline</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          margin: 0;
          padding: 2rem;
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          text-align: center;
        }
        .container {
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          padding: 2rem;
          border-radius: 16px;
          max-width: 400px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        h1 {
          font-size: 3rem;
          margin: 0 0 1rem 0;
        }
        p {
          margin: 0.5rem 0;
          line-height: 1.5;
          opacity: 0.9;
        }
        .button {
          display: inline-block;
          background: white;
          color: #10b981;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 8px;
          font-weight: 600;
          text-decoration: none;
          margin-top: 1.5rem;
          cursor: pointer;
          transition: transform 0.2s;
        }
        .button:active {
          transform: scale(0.95);
        }
        small {
          font-size: 0.85rem;
          opacity: 0.8;
          display: block;
          margin-top: 1rem;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📡</h1>
        <h2>Você está offline</h2>
        <p>Não foi possível conectar ao servidor.</p>
        <p>Verifique sua conexão com a internet.</p>
        <small>Dados locais estão disponíveis quando você voltar ao app.</small>
        <button class="button" onclick="location.reload()">🔄 Tentar Novamente</button>
      </div>
      <script>
        document.querySelector('.button').addEventListener('click', function() {
          location.reload();
        });
      </script>
    </body>
    </html>`,
    {
      headers: { 
        'Content-Type': 'text/html; charset=utf-8',
        'X-Service-Worker': 'offline-page'
      }
    }
  );
}

// Mensagens do cliente
self.addEventListener('message', event => {
  switch (event.data) {
    case 'skipWaiting':
      self.skipWaiting();
      console.log('[SW] skipWaiting chamado');
      break;
      
    case 'clearCache':
      clearAllCaches();
      break;
      
    case 'updateCache':
      updateStaticCache();
      break;
  }
  
  if (event.data && event.data.type === 'sync') {
    handleSyncMessage(event);
  }
});

// Função para limpar todos os caches
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(name => caches.delete(name)));
  console.log('[SW] Todos os caches limpos');
}

// Função para atualizar cache estático
async function updateStaticCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(urlsToCache);
    console.log('[SW] Cache estático atualizado');
  } catch (error) {
    console.error('[SW] Erro ao atualizar cache:', error);
  }
}

// Manipular mensagens de sincronização
async function handleSyncMessage(event) {
  if (event.data.type === 'sync' && event.data.data === 'frutiferas') {
    console.log('[SW] Recebida mensagem de sync de frutíferas');
    
    // Enviar resposta imediata
    event.ports[0]?.postMessage({ status: 'received' });
    
    // Tentar sincronizar em background
    try {
      await syncFrutiferas();
      event.ports[0]?.postMessage({ status: 'success' });
    } catch (error) {
      event.ports[0]?.postMessage({ status: 'error', error: error.message });
    }
  }
}

// Função para sincronizar frutíferas
async function syncFrutiferas() {
  // Esta função seria implementada para sincronizar
  // dados locais com o Supabase
  console.log('[SW] Função syncFrutiferas chamada');
  return Promise.resolve();
}

// Background sync (se suportado)
self.addEventListener('sync', event => {
  console.log('[SW] Sync event:', event.tag);
  
  if (event.tag === 'sync-frutiferas') {
    event.waitUntil(
      syncFrutiferas().catch(console.error)
    );
  }
});

// Periodic sync (se suportado)
self.addEventListener('periodicsync', event => {
  console.log('[SW] Periodic sync:', event.tag);
  
  if (event.tag === 'update-frutiferas') {
    event.waitUntil(
      atualizarFrutiferasPeriodicamente().catch(console.error)
    );
  }
});

// Função para atualização periódica
async function atualizarFrutiferasPeriodicamente() {
  console.log('[SW] Atualização periódica iniciada');
  // Implementar lógica de atualização periódica
  return Promise.resolve();
}
