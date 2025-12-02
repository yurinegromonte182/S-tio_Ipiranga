const CACHE_NAME = 'sitio-ipiranga-v7.2';
const CACHE_TIMEOUT = 3000;

// URLs para cachear (apenas arquivos estáticos)
const urlsToCache = [
  '/S-tio_Ipiranga/',
  '/S-tio_Ipiranga/index.html',
  '/S-tio_Ipiranga/manifest.json'
];

// Instalação
self.addEventListener('install', event => {
  console.log('[SW] Instalando v7.2...');
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
    // Verificar se é para a tabela frutiferas
    if (url.pathname.includes('/frutiferas')) {
      console.log('[SW] Requisição Supabase para frutiferas:', request.method, url.pathname);
    }
    
    event.respondWith(
      fetch(request)
        .catch(error => {
          console.warn('[SW] Supabase offline:', error);
          
          // Se for GET para frutiferas e estiver offline, tentar retornar do cache
          if (request.method === 'GET' && url.pathname.includes('/frutiferas')) {
            return caches.match('/S-tio_Ipiranga/frutiferas-fallback.json')
              .then(cached => {
                if (cached) {
                  console.log('[SW] Retornando frutíferas do cache offline');
                  return cached;
                }
                
                // Retornar resposta de fallback
                return new Response(
                  JSON.stringify({ 
                    error: 'offline', 
                    message: 'Banco de dados offline. Dados locais serão usados.',
                    frutiferas: []
                  }),
                  {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                  }
                );
              });
          }
          
          // Para outras requisições Supabase
          return new Response(
            JSON.stringify({ 
              error: 'offline', 
              message: 'Supabase offline',
              cached: true 
            }),
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
                    <p><small>As frutíferas salvas anteriormente ainda estão disponíveis.</small></p>
                    <button onclick="location.reload()">🔄 Tentar Novamente</button>
                  </div>
                </body>
                </html>`,
                {
                  headers: { 'Content-Type': 'text/html' }
                }
              );
            }
            
            // Para arquivos JSON de frutíferas
            if (request.url.includes('frutiferas') && request.url.endsWith('.json')) {
              return caches.match('/S-tio_Ipiranga/frutiferas-fallback.json')
                .then(cached => {
                  if (cached) {
                    console.log('[SW] Retornando frutíferas do fallback');
                    return cached;
                  }
                  
                  // Fallback padrão
                  return new Response(
                    JSON.stringify({ 
                      frutiferas: [],
                      offline: true,
                      timestamp: new Date().toISOString()
                    }),
                    {
                      status: 200,
                      headers: { 'Content-Type': 'application/json' }
                    }
                  );
                });
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
  
  if (event.data.action === 'syncFrutiferas') {
    // Sincronização de frutíferas em background
    console.log('[SW] Sincronizando frutíferas...');
    
    // Aqui você pode adicionar lógica para sincronizar
    // frutíferas locais com Supabase quando online
    
    event.ports[0].postMessage({ 
      status: 'syncing',
      message: 'Sincronizando frutíferas...' 
    });
  }
});

// Background sync para frutíferas
self.addEventListener('sync', event => {
  if (event.tag === 'sync-frutiferas') {
    console.log('[SW] Background sync para frutíferas');
    
    event.waitUntil(
      syncFrutiferasComSupabase()
        .then(() => {
          console.log('[SW] Frutíferas sincronizadas com sucesso');
          self.registration.showNotification('Sítio Ipiranga', {
            body: 'Frutíferas sincronizadas com o servidor!',
            icon: '/S-tio_Ipiranga/icon.png',
            tag: 'sync-complete'
          });
        })
        .catch(error => {
          console.error('[SW] Erro na sincronização:', error);
        })
    );
  }
});

// Função para sincronizar frutíferas
async function syncFrutiferasComSupabase() {
  // Esta função pode ser implementada para sincronizar
  // frutíferas locais com Supabase
  
  // Exemplo:
  // 1. Buscar frutíferas locais do IndexedDB
  // 2. Enviar para Supabase
  // 3. Marcar como sincronizadas
  
  return Promise.resolve();
}

// Period sync para atualizações regulares
self.addEventListener('periodicsync', event => {
  if (event.tag === 'update-frutiferas') {
    console.log('[SW] Atualização periódica de frutíferas');
    
    event.waitUntil(
      atualizarFrutiferasDoSupabase()
        .then(result => {
          console.log('[SW] Frutíferas atualizadas:', result);
        })
        .catch(error => {
          console.error('[SW] Erro na atualização periódica:', error);
        })
    );
  }
});

// Função para atualizar frutíferas do Supabase
async function atualizarFrutiferasDoSupabase() {
  // Esta função pode ser implementada para buscar
  // atualizações de frutíferas do Supabase
  
  try {
    const response = await fetch('https://erbefbnjxgpetbetlzya.supabase.co/rest/v1/frutiferas?select=*&order=updated_at.desc&limit=50', {
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyYmVmYm5qeGdwZXRiZXRsenlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEwMzI4ODcsImV4cCI6MjA3NjYwODg4N30.d09pjgddZpNY3Z4cVZ3V4h77aAf_GVGF0sOBTZkZf2A'
      }
    });
    
    if (response.ok) {
      const frutiferas = await response.json();
      
      // Enviar mensagem para clientes com as novas frutíferas
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'frutiferas-updated',
          data: frutiferas,
          timestamp: new Date().toISOString()
        });
      });
      
      return { success: true, count: frutiferas.length };
    }
    
    return { success: false, error: 'Erro na resposta' };
  } catch (error) {
    console.error('[SW] Erro ao atualizar frutíferas:', error);
    return { success: false, error: error.message };
  }
}
