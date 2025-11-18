// Fetch and render builds
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
        ${b.status === 'completed' ? `<a href="/api/builds/${b.id}/download?adminKey=${encodeURIComponent(window._adminKey || '')}" class="btn btn-outline" style="font-size:0.75rem;">
          <i class="fas fa-download"></i> Download
        </a>` : ''}
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

// Fetch and render cache entries
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

// Fetch and render API documentation
async function fetchApiDocs() {
  try {
    const res = await fetch('/api/docs');
    const docs = await res.json();
    renderApiDocs(docs);
  } catch (e) {
    document.getElementById('docs-container').innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Failed to load documentation</p></div>';
  }
}

function renderApiDocs(docs) {
  const container = document.getElementById('docs-container');
  container.innerHTML = '';

  // Overview section
  const overviewDiv = document.createElement('div');
  overviewDiv.className = 'doc-section';
  overviewDiv.innerHTML = `
    <h3><i class="fas fa-info-circle"></i> Overview</h3>
    <p>${docs.description}</p>
    <p><strong>Base URL:</strong> <code>${docs.baseUrl}</code></p>
    <p><strong>Authentication:</strong> Include <code>${docs.authentication.header}</code> header with your API key</p>
  `;
  container.appendChild(overviewDiv);

  // Endpoints
  for (const endpoint of docs.endpoints) {
    const methodClass = `doc-method-${endpoint.method.toLowerCase()}`;
    const endpointDiv = document.createElement('div');
    endpointDiv.className = 'doc-endpoint';

    const header = document.createElement('div');
    header.className = 'doc-endpoint-header';
    header.innerHTML = `
      <div>
        <span class="doc-method ${methodClass}">${endpoint.method}</span>
        <span class="doc-path">${endpoint.path}</span>
      </div>
      <i class="fas fa-chevron-down"></i>
    `;
    
    const body = document.createElement('div');
    body.className = 'doc-endpoint-body';

    let content = `<h4>${endpoint.name}</h4><p>${endpoint.description}</p>`;

    if (endpoint.queryParams) {
      content += '<strong>Query Parameters:</strong><ul>';
      for (const [key, desc] of Object.entries(endpoint.queryParams)) {
        content += `<li><code>${key}</code> - ${desc}</li>`;
      }
      content += '</ul>';
    }

    if (endpoint.requestBody) {
      content += '<strong>Request Body:</strong>';
      content += `<div class="doc-code">${JSON.stringify(endpoint.requestBody.example, null, 2)}</div>`;
    }

    if (endpoint.response) {
      content += '<strong>Response (Status ' + endpoint.response.status + '):</strong>';
      content += `<div class="doc-code">${JSON.stringify(endpoint.response.body, null, 2)}</div>`;
    }

    content += `<strong>cURL Example:</strong><div class="curl-example">curl -X ${endpoint.method} "${docs.baseUrl}${endpoint.path}" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY"${endpoint.requestBody ? ' \\' : ''}
${endpoint.requestBody ? '  -d \'...\'' : ''}</div>`;

    body.innerHTML = content;
    
    header.addEventListener('click', () => {
      body.classList.toggle('show');
      header.querySelector('i').style.transform = body.classList.contains('show') ? 'rotate(180deg)' : 'rotate(0)';
    });
    
    endpointDiv.appendChild(header);
    endpointDiv.appendChild(body);
    container.appendChild(endpointDiv);
  }
}

function showLogsModal(buildId) {
  const modal = document.getElementById('log-modal');
  const logsEl = document.getElementById('modal-logs');
  logsEl.textContent = 'Loading logs...';
  modal.classList.add('show');
  modal.style.display = 'flex';

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
    files: [
      { path: 'package.json', content: '{"name":"test","version":"1.0.0","scripts":{"build":"vite build"}}' },
      { path: 'vite.config.js', content: 'export default { build: { outDir: "dist" } }' },
      { path: 'index.html', content: '<!DOCTYPE html><html><body><h1>Test</h1></body></html>' }
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
      alert(`Test build started.\nBuild ID: ${data.id}\nStatus URL: ${data.statusUrl}`);
      fetchBuilds();
    } else {
      alert('Failed to start test build: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function testApiEndpoint() {
  const endpoint = document.getElementById('test-endpoint').value;
  const param = document.getElementById('test-param').value;
  const bodyText = document.getElementById('test-body').value;
  const responseEl = document.getElementById('test-response');

  if (!endpoint) {
    responseEl.textContent = 'Please select an endpoint';
    return;
  }

  let url, method = 'GET', headers = { 'x-api-key': window._adminKey || '' };
  let body = null;

  try {
    if (endpoint === 'post-build') {
      url = '/build';
      method = 'POST';
      headers['Content-Type'] = 'application/json';
      body = bodyText ? JSON.parse(bodyText) : { files: [] };
    } else if (endpoint === 'get-status') {
      url = `/api/builds/${param}/status`;
    } else if (endpoint === 'get-logs') {
      url = `/api/builds/${param}/logs`;
    } else if (endpoint === 'get-builds') {
      url = `/api/builds?limit=5`;
    }

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url, options);
    const data = await res.json();
    responseEl.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    responseEl.textContent = 'Error: ' + e.message;
  }
}

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

window.onload = function(){
  const adminKey = prompt('Enter admin key (required to manage cache and view logs):');
  window._adminKey = adminKey;
  fetchBuilds();
  fetchCache();
  fetchMetrics();
  fetchConfig();
  fetchApiDocs();

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

  document.getElementById('test-build').addEventListener('click', triggerTestBuild);
  document.getElementById('refresh-builds').addEventListener('click', fetchBuilds);
  document.getElementById('refresh-cache').addEventListener('click', fetchCache);
  document.getElementById('refresh-metrics').addEventListener('click', fetchMetrics);
  document.getElementById('refresh-config').addEventListener('click', fetchConfig);
  document.getElementById('refresh-docs').addEventListener('click', fetchApiDocs);
  document.getElementById('refresh-keys').addEventListener('click', fetchApiKeys);
  document.getElementById('test-send').addEventListener('click', testApiEndpoint);

  document.getElementById('clear-cache').addEventListener('click', async ()=>{
    if (!confirm('Clear entire cache?')) return;
    await fetch('/admin/cache/clear', {method: 'POST', headers: { 'x-admin-key': window._adminKey }});
    fetchCache();
  });

  setInterval(()=>{ fetchBuilds(); fetchCache(); }, 10000);
  setInterval(()=>{ fetchMetrics(); }, 10000);

  document.getElementById('save-cache-settings').addEventListener('click', async ()=>{
    const maxEntries = parseInt(document.getElementById('cache-max-entries').value || '5', 10);
    const maxBytes = parseInt(document.getElementById('cache-max-bytes').value || (2 * 1024 * 1024 * 1024), 10);
    await fetch('/admin/cache/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': window._adminKey }, body: JSON.stringify({ maxEntries, maxBytes }) });
    fetchCache();
  });

  document.getElementById('create-key').addEventListener('click', async ()=>{
    const r = await fetch('/admin/api/keys', { method: 'POST', headers: { 'x-admin-key': window._adminKey } });
    const data = await r.json();
    alert(`Created key\nID: ${data.id}\nKey: ${data.key}\n\nSave this key securely!`);
    fetchApiKeys();
  });

  document.getElementById('search-keys').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = allKeys.filter(k => k.id.toLowerCase().includes(query));
    renderKeys(filtered);
  });

  document.getElementById('show-revoked').addEventListener('change', fetchApiKeys);
  fetchApiKeys();
}
