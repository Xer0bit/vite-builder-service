async function fetchBuilds(){
  const headers = window._adminKey ? { 'x-admin-key': window._adminKey } : {};
  const res = await fetch('/admin/builds', { headers });
  const builds = await res.json();
  const container = document.getElementById('build-list');
  container.innerHTML = '';
  for (const b of builds) {
    const div = document.createElement('div');
    div.className = 'build';
    div.innerHTML = `<b>${b.id}</b> - ${b.status} - ${b.createdAt}<br>`+
      `<a href="/builds/${b.id}.zip">Download</a> `+
      `<button data-id="${b.id}" class="show-logs">Logs</button>`;
    const btn = div.querySelector('.show-logs');
    btn.addEventListener('click', async ()=>{
      const headers = window._adminKey ? { 'x-admin-key': window._adminKey } : {};
      // if admin key present, use SSE streaming
      if (window._adminKey) {
        showLogsFor(b.id, div);
      } else {
        const r = await fetch(`/admin/builds/${b.id}`, { headers });
        const meta = await r.json();
        const p = document.createElement('pre');
        p.textContent = meta.logs || '(no logs)';
        div.appendChild(p);
      }
    });
    container.appendChild(div);
  }
}
async function fetchCache(){
  const headers = window._adminKey ? { 'x-admin-key': window._adminKey } : {};
  const res = await fetch('/admin/cache', { headers });
  const body = await res.json();
  const cacheEntries = body.cacheMeta || [];
  const container = document.getElementById('cache-list');
  container.innerHTML = '';
  for (const c of cacheEntries) {
    const d = document.createElement('div');
    d.textContent = `${c.hash} - size ${Math.round((c.size||0)/1024)}KB - lastUsed ${c.lastUsed}`;
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.addEventListener('click', async ()=>{
      await fetch(`/admin/cache/remove/${c.hash}`, { method: 'POST', headers: { 'x-admin-key': window._adminKey }});
      fetchCache();
    });
    d.appendChild(btn);
    container.appendChild(d);
  }
  try {
    const settings = body.settings || {};
    document.getElementById('cache-max-entries').value = settings.maxEntries || '';
    document.getElementById('cache-max-bytes').value = settings.maxBytes || '';
  } catch (e) {}
}
async function fetchMetrics() {
  const headers = window._adminKey ? { 'x-admin-key': window._adminKey } : {};
  const res = await fetch('/admin/metrics', { headers });
  if (!res.ok) return;
  const m = await res.json();
  const el = document.getElementById('metrics');
  if (!el) return;
  el.textContent = JSON.stringify(m, null, 2);
}

window.onload = function(){
  fetchBuilds();
  fetchCache();
  document.getElementById('clear-cache').addEventListener('click', async ()=>{
    await fetch('/admin/cache/clear', {method: 'POST', headers: { 'x-admin-key': window._adminKey }});
    fetchCache();
  });
    // prompt for admin key
    const adminKey = prompt('Enter admin key (required to manage cache and view logs):');
    window._adminKey = adminKey;
    async function showLogsFor(buildId, container) {
      // stream logs via SSE
      const url = `/admin/builds/${buildId}/stream?adminKey=${encodeURIComponent(adminKey)}`;
      const sse = new EventSource(url);
      const pre = document.createElement('pre');
      container.appendChild(pre);
      sse.onmessage = e => { pre.textContent = JSON.parse(e.data).logs; };
    }
    // enhance show log actions to use adminKey
    // auto refresh
    setInterval(()=>{ fetchBuilds(); fetchCache(); }, 5000);
    setInterval(()=>{ fetchMetrics(); }, 5000);

    // cache settings
    document.getElementById('save-cache-settings').addEventListener('click', async ()=>{
      const maxEntries = parseInt(document.getElementById('cache-max-entries').value || '5', 10);
      const maxBytes = parseInt(document.getElementById('cache-max-bytes').value || (2 * 1024 * 1024 * 1024), 10);
      await fetch('/admin/cache/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': window._adminKey }, body: JSON.stringify({ maxEntries, maxBytes }) });
      fetchCache();
    });

    // API Keys
    document.getElementById('create-key').addEventListener('click', async ()=>{
      const r = await fetch('/admin/api/keys', { method: 'POST', headers: { 'x-admin-key': window._adminKey } });
      const data = await r.json();
      alert(`Created key id: ${data.id}\nkey: ${data.key}`);
      fetchApiKeys();
    });
    async function fetchApiKeys(){
      const r = await fetch('/admin/api/keys', { headers: { 'x-admin-key': window._adminKey }});
      const keys = await r.json();
      const container = document.getElementById('api-keys');
      container.innerHTML = '';
      for (const k of keys) {
        const d = document.createElement('div');
        d.textContent = `${k.id} ${JSON.stringify(k.meta)}`;
        const btn = document.createElement('button');
        btn.textContent = 'Delete';
        btn.addEventListener('click', async ()=>{
          await fetch(`/admin/api/keys/${k.id}`, { method: 'DELETE', headers: { 'x-admin-key': window._adminKey }});
          fetchApiKeys();
        });
        d.appendChild(btn);
        container.appendChild(d);
      }
    }
        const settings = body.settings || {};
}
