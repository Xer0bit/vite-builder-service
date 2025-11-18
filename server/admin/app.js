async function fetchBuilds(){
  const headers = window._adminKey ? { 'x-admin-key': window._adminKey } : {};
  const res = await fetch('/admin/builds', { headers });
  if (!res.ok) {
    document.getElementById('build-list').innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Unauthorized or error loading builds</p></div>';
    return;
  }
  const builds = await res.json();
  const container = document.getElementById('build-list');
  container.innerHTML = '';
  
  if (builds.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>No builds yet</p></div>';
    return;
  }
  
  for (const b of builds) {
    const div = document.createElement('div');
    div.className = 'build';
    const statusClass = `status-${b.status.toLowerCase()}`;
    const created = new Date(b.createdAt).toLocaleString();
    div.innerHTML = `
      <div class="build-info">
        <b>${b.id}</b> - <span class="status-badge ${statusClass}">${b.status}</span><br>
        <span>Created: ${created}</span>
      </div>
      <div class="build-actions">
        <a href="/builds/${b.id}.zip" class="btn btn-outline" style="font-size:0.75rem;">
          <i class="fas fa-download"></i> Download
        </a>
        <button data-id="${b.id}" class="show-logs btn btn-outline" style="font-size:0.75rem;">
          <i class="fas fa-file-alt"></i> Logs
        </button>
      </div>
    `;
    const btn = div.querySelector('.show-logs');
    btn.addEventListener('click', () => showLogsModal(b.id));
    container.appendChild(div);
  }
}

async function fetchCache(){
  const headers = window._adminKey ? { 'x-admin-key': window._adminKey } : {};
  const res = await fetch('/admin/cache', { headers });
  if (!res.ok) {
    document.getElementById('cache-list').innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Unauthorized or error loading cache</p></div>';
    return;
  }
  const body = await res.json();
  const cacheEntries = body.cacheMeta || [];
  const container = document.getElementById('cache-list');
  container.innerHTML = '';
  
  if (cacheEntries.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>No cached entries</p></div>';
  } else {
    for (const c of cacheEntries) {
      const d = document.createElement('div');
      const sizeKB = Math.round((c.size||0)/1024);
      const lastUsedDate = new Date(c.lastUsed).toLocaleString();
      d.innerHTML = `
        <div style="flex:1;">
          <strong>${c.hash.substring(0, 16)}...</strong><br>
          <small style="color:var(--color-text-light);">${sizeKB}KB • Used ${lastUsedDate}</small>
        </div>
      `;
      const btn = document.createElement('button');
      btn.innerHTML = '<i class="fas fa-trash"></i> Remove';
      btn.className = 'btn btn-danger';
      btn.style.fontSize = '0.75rem';
      btn.addEventListener('click', async ()=>{
        await fetch(`/admin/cache/remove/${c.hash}`, { method: 'POST', headers: { 'x-admin-key': window._adminKey }});
        fetchCache();
      });
      d.appendChild(btn);
      container.appendChild(d);
    }
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
  const el = document.getElementById('metrics-content');
  if (!el) return;
  el.textContent = JSON.stringify(m, null, 2);
}

async function fetchConfig() {
  const headers = window._adminKey ? { 'x-admin-key': window._adminKey } : {};
  const r = await fetch('/admin/config', { headers });
  if (!r.ok) return document.getElementById('config-content').textContent = 'Failed to load';
  const c = await r.json();
  document.getElementById('config-content').textContent = JSON.stringify(c, null, 2);
}

function showLogsModal(buildId) {
  const modal = document.getElementById('log-modal');
  const logsEl = document.getElementById('modal-logs');
  logsEl.textContent = 'Loading logs...';
  modal.classList.add('show');
  modal.style.display = 'flex';

  // Fetch logs
  const headers = window._adminKey ? { 'x-admin-key': window._adminKey } : {};
  fetch(`/admin/builds/${buildId}`, { headers })
    .then(r => r.json())
    .then(data => {
      logsEl.textContent = data.logs || '(no logs)';
    })
    .catch(() => {
      logsEl.textContent = 'Failed to load logs';
    });
}

async function triggerTestBuild() {
  const apiKey = prompt('Enter API key for test build:');
  if (!apiKey) return;

  const samplePayload = {
    "files": [
      {
        "path": "package.json",
        "content": "{\"name\":\"test\",\"version\":\"1.0.0\",\"scripts\":{\"build\":\"vite build\"}}"
      },
      {
        "path": "vite.config.js",
        "content": "export default { build: { outDir: 'dist' } }"
      },
      {
        "path": "index.html",
        "content": "<!DOCTYPE html><html><body><h1>Test</h1></body></html>"
      }
    ]
  };

  try {
    const res = await fetch('/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(samplePayload)
    });
    const data = await res.json();
    if (res.ok) {
      alert(`Test build started. Build ID: ${data.id}`);
      fetchBuilds(); // Refresh builds list
    } else {
      alert('Failed to start test build: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

window.onload = function(){
  // prompt for admin key
  const adminKey = prompt('Enter admin key (required to manage cache and view logs):');
  window._adminKey = adminKey;
  fetchBuilds();
  fetchCache();
  fetchMetrics();
  fetchConfig();

  // Modal close
  const modal = document.getElementById('log-modal');
  document.querySelector('.close').addEventListener('click', () => {
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 150);
  });
  
  window.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('show');
      setTimeout(() => modal.style.display = 'none', 150);
    }
  });

  // Test build
  document.getElementById('test-build').addEventListener('click', triggerTestBuild);

  // Refresh buttons
  document.getElementById('refresh-builds').addEventListener('click', fetchBuilds);
  document.getElementById('refresh-cache').addEventListener('click', fetchCache);
  document.getElementById('refresh-metrics').addEventListener('click', fetchMetrics);
  document.getElementById('refresh-config').addEventListener('click', fetchConfig);
  document.getElementById('refresh-keys').addEventListener('click', fetchApiKeys);

  document.getElementById('clear-cache').addEventListener('click', async ()=>{
    if (!confirm('Are you sure you want to clear the entire cache? This will remove all cached dependencies.')) return;
    await fetch('/admin/cache/clear', {method: 'POST', headers: { 'x-admin-key': window._adminKey }});
    fetchCache();
  });

  // auto refresh
  setInterval(()=>{ fetchBuilds(); fetchCache(); }, 10000); // slower
  setInterval(()=>{ fetchMetrics(); }, 10000);

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

  let allKeys = [];
  async function fetchApiKeys(){
    const showRevoked = document.getElementById('show-revoked').checked;
    const url = '/admin/api/keys' + (showRevoked ? '?showRevoked=1' : '');
    const r = await fetch(url, { headers: { 'x-admin-key': window._adminKey }});
    if (!r.ok) {
      document.getElementById('api-keys').innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Unauthorized or error loading keys</p></div>';
      return;
    }
    allKeys = await r.json();
    renderKeys(allKeys);
  }

  function renderKeys(keys) {
    const container = document.getElementById('api-keys');
    container.innerHTML = '';
    
    if (keys.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-key"></i><p>No API keys created yet</p></div>';
      return;
    }
    
    const table = document.createElement('table');
    const head = document.createElement('thead');
    head.innerHTML = `<tr><th>ID</th><th>Created</th><th>Meta</th><th>Status</th><th>Actions</th></tr>`;
    table.appendChild(head);
    const tbody = document.createElement('tbody');
    for (const k of keys) {
      const tr = document.createElement('tr');
      const created = (k.meta && k.meta.createdAt) ? new Date(k.meta.createdAt).toLocaleString() : '-';
      const status = k.revoked ? 'revoked' : 'active';
      const statusBadge = k.revoked ? '<span class="status-badge status-failed">Revoked</span>' : '<span class="status-badge status-completed">Active</span>';
      tr.innerHTML = `<td><code>${k.id}</code></td><td>${created}</td><td><code style="font-size:0.75rem;">${JSON.stringify(k.meta||{})}</code></td><td>${statusBadge}</td><td></td>`;
      const actions = tr.querySelector('td:last-child');
      
      const copyBtn = document.createElement('button');
      copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
      copyBtn.className = 'btn btn-outline';
      copyBtn.style.padding = '0.35rem 0.5rem';
      copyBtn.style.fontSize = '0.75rem';
      copyBtn.title = 'Copy ID';
      copyBtn.addEventListener('click', ()=>{ navigator.clipboard.writeText(k.id); copyBtn.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(() => copyBtn.innerHTML = '<i class="fas fa-copy"></i>', 1500); });
      
      const showBtn = document.createElement('button');
      showBtn.innerHTML = '<i class="fas fa-eye"></i>';
      showBtn.className = 'btn btn-outline';
      showBtn.style.padding = '0.35rem 0.5rem';
      showBtn.style.fontSize = '0.75rem';
      showBtn.title = 'Show Key';
      showBtn.addEventListener('click', async ()=>{
        const r = await fetch(`/admin/api/keys/${k.id}`, { headers: { 'x-admin-key': window._adminKey }});
        if (!r.ok) { alert('Failed to fetch key'); return; }
        const detail = await r.json();
        alert('Key: ' + detail.key + '\nID: ' + detail.id + '\nRevoked: ' + detail.revoked);
      });
      
      const deleteBtn = document.createElement('button');
      deleteBtn.innerHTML = '<i class="fas fa-ban"></i>';
      deleteBtn.className = 'btn btn-danger';
      deleteBtn.style.padding = '0.35rem 0.5rem';
      deleteBtn.style.fontSize = '0.75rem';
      deleteBtn.title = 'Revoke Key';
      deleteBtn.addEventListener('click', async ()=>{
        if (!confirm('Revoke key ' + k.id + '?')) return;
        await fetch(`/admin/api/keys/${k.id}`, { method: 'DELETE', headers: { 'x-admin-key': window._adminKey }});
        fetchApiKeys();
      });
      
      actions.appendChild(copyBtn);
      actions.appendChild(showBtn);
      actions.appendChild(deleteBtn);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  // Search keys
  document.getElementById('search-keys').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = allKeys.filter(k => k.id.toLowerCase().includes(query));
    renderKeys(filtered);
  });

  document.getElementById('show-revoked').addEventListener('change', fetchApiKeys);
  fetchApiKeys();
}
