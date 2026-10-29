// Brightdesk in the browser: routes on the path, talks to /api.
const app = document.getElementById('app');
const ACCENTS = { blue: '#2563eb', green: '#059669', purple: '#7c3aed', orange: '#ea580c' };
const CATEGORIES = ['Billing', 'Technical', 'Account', 'Other'];
const PRIORITIES = ['Low', 'Normal', 'High'];
let me = null;
let settings = { team: 'Brightdesk', accent: 'blue' };

const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

function navigate(path, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  render();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a) { e.preventDefault(); navigate(a.getAttribute('href')); }
});
addEventListener('popstate', render);

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3600);
}

function ago(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const badge = (text) => `<span class="badge badge-${h(text.toLowerCase().replace(/\s+/g, '-'))}">${h(text)}</span>`;
const logo = () => `<span class="logo" aria-hidden="true">${h(settings.team.trim()[0] || 'B').toUpperCase()}</span>`;

function applyAccent() {
  document.documentElement.style.setProperty('--accent', ACCENTS[settings.accent] || ACCENTS.blue);
  document.title = settings.team;
}

async function render() {
  const path = location.pathname;
  settings = await api('/api/settings').catch(() => settings);
  applyAccent();
  if (path === '/login') return loginPage();
  me = await api('/api/me').catch(() => null);
  if (!me) return navigate('/login', { replace: true });
  const routes = [
    [/^\/$/, dashboardPage, 'Dashboard', '/'],
    [/^\/requests$/, requestsPage, 'Requests', '/requests'],
    [/^\/requests\/new$/, newRequestPage, 'New request', '/requests'],
    [/^\/requests\/(\d+)$/, requestPage, 'Request', '/requests'],
    [/^\/import$/, importPage, 'Import requests', '/import'],
    [/^\/settings$/, settingsPage, 'Settings', '/settings'],
  ];
  const [re, page, title, nav] = routes.find(([r]) => r.test(path)) ?? routes[0];
  shell(title, nav);
  await page(document.getElementById('content'), ...(path.match(re)?.slice(1) ?? []));
}

function shell(title, active) {
  const link = (href, text) => `<a data-link href="${href}"${href === active ? ' aria-current="page"' : ''}>${text}</a>`;
  app.innerHTML = `
    <div class="shell">
      <aside class="side">
        <div class="brand">${logo()}<span>${h(settings.team)}</span></div>
        <nav aria-label="Main">
          ${link('/', 'Dashboard')}${link('/requests', 'Requests')}${link('/import', 'Import')}${link('/settings', 'Settings')}
        </nav>
        <p class="side-foot">Signed in as<br><strong>${h(me.name)}</strong></p>
      </aside>
      <div class="main">
        <header class="top">
          <h1>${h(title)}</h1>
          <div class="top-actions" id="top-actions"></div>
          <button class="ghost" id="logout">Sign out</button>
        </header>
        <section id="content" class="content"></section>
      </div>
    </div>`;
  document.getElementById('logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); navigate('/login'); };
}

function newButton() {
  document.getElementById('top-actions').innerHTML = '<a data-link class="button primary" href="/requests/new">New request</a>';
}

// ---------------------------------------------------------------- pages

function loginPage() {
  app.innerHTML = `
    <main class="auth">
      <form class="card auth-card" id="login" novalidate>
        <div class="brand">${logo()}<span>${h(settings.team)}</span></div>
        <h1>Sign in</h1>
        <p class="muted">Welcome back. Sign in to see your team’s requests.</p>
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="username">
        <label for="password">Password</label>
        <input id="password" type="password" autocomplete="current-password">
        <p class="error" id="login-error" role="alert"></p>
        <button class="primary" type="submit">Sign in</button>
      </form>
    </main>`;
  document.getElementById('login').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: { email: e.target.email.value, password: e.target.password.value } });
      navigate('/');
    } catch (err) {
      document.getElementById('login-error').textContent = err.message;
    }
  };
}

async function dashboardPage(el) {
  newButton();
  const rows = await api('/api/requests');
  const open = rows.filter((r) => r.status === 'Open');
  const tile = (label, n, note) => `<div class="card tile"><p class="tile-label">${label}</p><p class="tile-n">${n}</p><p class="muted">${note}</p></div>`;
  el.innerHTML = `
    <div class="tiles">
      ${tile('Open requests', open.length, 'Waiting for your team')}
      ${tile('High priority', open.filter((r) => r.priority === 'High').length, 'Open and marked High')}
      ${tile('Resolved', rows.length - open.length, 'All time')}
    </div>
    <div class="card">
      <div class="card-head"><h2>Recent requests</h2><a data-link href="/requests">See all</a></div>
      <ul class="recent">
        ${rows.slice(0, 5).map((r) => `<li><a data-link href="/requests/${r.id}">${h(r.title)}</a>${badge(r.priority)}${badge(r.status)}<span class="muted">${ago(r.created)}</span></li>`).join('')}
      </ul>
    </div>`;
}

async function requestsPage(el) {
  newButton();
  const rows = await api('/api/requests');
  let filter = 'All';
  const draw = () => {
    const shown = rows.filter((r) => filter === 'All' || r.status === filter);
    el.innerHTML = `
      <div class="tabs" role="tablist" aria-label="Status">
        ${['All', 'Open', 'Resolved'].map((t) => `<button role="tab" aria-selected="${t === filter}">${t}</button>`).join('')}
      </div>
      <div class="card flush">
        <table>
          <thead><tr><th>#</th><th>Title</th><th>Category</th><th>Priority</th><th>Status</th><th>Raised</th></tr></thead>
          <tbody>
            ${shown.map((r) => `<tr><td class="muted">${r.id}</td><td><a data-link href="/requests/${r.id}">${h(r.title)}</a></td><td>${h(r.category)}</td><td>${badge(r.priority)}</td><td>${badge(r.status)}</td><td class="muted">${ago(r.created)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    el.querySelectorAll('[role=tab]').forEach((b) => { b.onclick = () => { filter = b.textContent; draw(); }; });
  };
  draw();
}

function newRequestPage(el) {
  el.innerHTML = `
    <form class="card form" id="new-request" novalidate>
      <label for="title">Title</label>
      <input id="title" placeholder="A short summary of the problem">
      <label for="category">Category</label>
      <select id="category">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select>
      <fieldset>
        <legend>Priority</legend>
        <div class="choices">
          ${PRIORITIES.map((p) => `<label class="choice"><input type="radio" name="priority" value="${p}"${p === 'Normal' ? ' checked' : ''}> ${p}</label>`).join('')}
        </div>
      </fieldset>
      <label for="description">Description</label>
      <textarea id="description" rows="5" placeholder="What happened, and what did you expect?"></textarea>
      <p class="error" role="alert" id="form-error"></p>
      <div class="actions">
        <a data-link class="button ghost" href="/requests">Cancel</a>
        <button class="primary" type="submit">Create request</button>
      </div>
    </form>`;
  document.getElementById('new-request').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const row = await api('/api/requests', { method: 'POST', body: { title: f.title.value, category: f.category.value, priority: f.priority.value, description: f.description.value } });
      toast(`Request #${row.id} created`);
      navigate(`/requests/${row.id}`);
    } catch (err) {
      document.getElementById('form-error').textContent = err.message;
    }
  };
}

async function requestPage(el, id) {
  const r = await api(`/api/requests/${id}`);
  el.innerHTML = `
    <div class="card detail">
      <p class="muted">Request #${r.id} · raised ${ago(r.created)}</p>
      <h2>${h(r.title)}</h2>
      <p class="meta">${badge(r.category)} ${badge(r.priority)} ${badge(r.status)}</p>
      <p>${h(r.description) || '<span class="muted">No description.</span>'}</p>
      <div class="actions">
        <a data-link class="button ghost" href="/requests">Back to requests</a>
        ${r.status === 'Open' ? '<button class="primary" id="resolve">Mark as resolved</button>' : ''}
      </div>
    </div>`;
  const resolve = document.getElementById('resolve');
  if (resolve) resolve.onclick = async () => { await api(`/api/requests/${id}/resolve`, { method: 'POST' }); toast(`Request #${id} resolved`); render(); };
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head = [], ...body] = rows.filter((r) => r.some((x) => x.trim()));
  const keys = head.map((k) => k.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

function importPage(el) {
  el.innerHTML = `
    <div class="card">
      <h2>Import requests from a spreadsheet</h2>
      <p class="muted">Upload a CSV file with the columns <code>title</code>, <code>category</code>, <code>priority</code> and <code>description</code>.
        Not sure of the layout? <a href="/template.csv" download>Download the template</a>.</p>
      <input type="file" id="csv-file" accept=".csv,text/csv" hidden>
      <button class="primary" id="choose">Choose a CSV file</button>
      <div id="preview"></div>
    </div>`;
  const input = document.getElementById('csv-file');
  document.getElementById('choose').onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    const ready = rows.filter((r) => r.title);
    const preview = document.getElementById('preview');
    preview.innerHTML = `
      <h3>${h(file.name)}: ${ready.length} ready${rows.length > ready.length ? `, ${rows.length - ready.length} with errors` : ''}</h3>
      <table>
        <thead><tr><th>Title</th><th>Category</th><th>Priority</th><th>Check</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${h(r.title) || '<span class="muted">(empty)</span>'}</td><td>${h(r.category)}</td><td>${h(r.priority)}</td><td>${r.title ? badge('Ready') : badge('Missing title')}</td></tr>`).join('')}</tbody>
      </table>
      <div class="actions"><button class="primary" id="do-import"${ready.length ? '' : ' disabled'}>Import ${ready.length} request${ready.length === 1 ? '' : 's'}</button></div>`;
    document.getElementById('do-import').onclick = async () => {
      const { created } = await api('/api/requests/import', { method: 'POST', body: { rows: ready } });
      toast(`${created} requests imported`);
      preview.innerHTML = `<p class="done">${created} requests imported. <a data-link href="/requests">View requests</a></p>`;
    };
  };
}

function settingsPage(el) {
  el.innerHTML = `
    <form class="card form" id="settings" novalidate>
      <label for="team">Team name</label>
      <input id="team" value="${h(settings.team)}">
      <p class="hint">Shown in the sidebar and on the sign-in page.</p>
      <fieldset>
        <legend>Accent colour</legend>
        <div class="choices">
          ${Object.entries(ACCENTS).map(([k, c]) => `<label class="choice swatch"><input type="radio" name="accent" value="${k}"${k === settings.accent ? ' checked' : ''}><span style="background:${c}"></span>${k[0].toUpperCase() + k.slice(1)}</label>`).join('')}
        </div>
      </fieldset>
      <p class="error" role="alert" id="settings-error"></p>
      <div class="actions"><button class="primary" type="submit">Save changes</button></div>
    </form>`;
  document.getElementById('settings').onsubmit = async (e) => {
    e.preventDefault();
    try {
      settings = await api('/api/settings', { method: 'PUT', body: { team: e.target.team.value, accent: e.target.accent.value } });
      toast('Settings saved');
      render();
    } catch (err) {
      document.getElementById('settings-error').textContent = err.message;
    }
  };
}

render();
