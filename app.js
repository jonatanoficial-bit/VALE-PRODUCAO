const $ = (sel, el = document) => el.querySelector(sel);

const UI = {
  loginView: $("#view-login"),
  appView: $("#view-app"),
  page: $("#page"),
  pageTitle: $("#pageTitle"),
  roleBadge: $("#roleBadge"),
  logoutBtn: $("#logoutBtn"),
  userPill: $("#userPill"),
  userPillText: $("#userPillText"),
  sidebar: $("#sidebar"),
  mobileMenuBtn: $("#mobileMenuBtn"),
  installBtn: $("#installBtn"),
  toast: $("#toast"),
  adminNav: $("#adminNav")
};

const AUTH_KEY = "vp.auth.session.v3";
const ADMIN_STORE_KEY = "vp.portal.admin.data.v3";      // só admin
const CHECKLIST_KEY_PREFIX = "vp.portal.checklist.v1."; // por usuário
const METRIC_KEY_STORAGE = "vp.analytics.selectedMetric.v3";

const ROUTES = {
  dashboard: { title: "Dashboard", render: renderDashboard },
  contrato: { title: "Contrato (PDF)", render: renderContrato },
  lancadas: { title: "Músicas lançadas", render: renderLancadas },
  construcao: { title: "Em construção", render: renderConstrucao },
  infos: { title: "Infos úteis", render: renderInfos },
  eventos: { title: "Eventos", render: renderEventos },
  links: { title: "Links", render: renderLinks },
  analytics: { title: "Analytics", render: renderAnalytics },
  admin: { title: "Admin", render: renderAdmin, adminOnly: true }
};

const toast = (msg) => {
  UI.toast.textContent = msg;
  UI.toast.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => UI.toast.classList.add("hidden"), 2400);
};

const safeJSON = {
  parse(str) { try { return JSON.parse(str); } catch { return null; } },
  stringify(obj) { try { return JSON.stringify(obj, null, 2); } catch { return ""; } }
};

function esc(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function formatDateBR(isoOrDate) {
  if (!isoOrDate) return "—";
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  return d.toLocaleDateString("pt-BR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function pageHeader(title, subtitle) {
  return `
    <div class="panel">
      <h2 class="section-title">${esc(title)}</h2>
      ${subtitle ? `<p class="section-subtitle">${esc(subtitle)}</p>` : ``}
    </div>
  `;
}

function emptyState(msg) {
  return `
    <div class="panel">
      <p class="section-subtitle">${esc(msg)}</p>
    </div>
  `;
}

/* ---------------- AUTH ---------------- */
const Auth = {
  get() {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? safeJSON.parse(raw) : null;
  },
  set(session) {
    localStorage.setItem(AUTH_KEY, safeJSON.stringify(session));
  },
  clear() {
    localStorage.removeItem(AUTH_KEY);
  }
};

/* ---------------- CHECKLIST POR USUÁRIO (não quebra updates) ---------------- */
const ChecklistStore = {
  _key(sess) {
    return CHECKLIST_KEY_PREFIX + (sess.username || "anon");
  },
  load(sess) {
    const raw = localStorage.getItem(this._key(sess));
    const obj = raw ? safeJSON.parse(raw) : null;
    return obj && typeof obj === "object" ? obj : {};
  },
  save(sess, obj) {
    localStorage.setItem(this._key(sess), safeJSON.stringify(obj));
  },
  getDone(sess, projectId, checkId) {
    const map = this.load(sess);
    return !!(map?.[projectId]?.[checkId]);
  },
  setDone(sess, projectId, checkId, done) {
    const map = this.load(sess);
    map[projectId] = map[projectId] || {};
    map[projectId][checkId] = !!done;
    this.save(sess, map);
  },
  setAll(sess, projectId, checks, done) {
    const map = this.load(sess);
    map[projectId] = map[projectId] || {};
    for (const c of checks) map[projectId][c.id] = !!done;
    this.save(sess, map);
  }
};

/* ---------------- DATASTORE ----------------
   - Base (oficial) sempre vem de /data/app-data.json (network-first)
   - Admin pode ter "draft local" (admin store) para editar sem backend
   - Artistas SEMPRE usam base oficial (para receber updates do Git)
*/
const DataStore = {
  base: null,
  data: null,

  async loadBaseFromServer() {
    // Cache-busting para evitar arquivo “antigo”
    const v = Date.now();
    const url = `./data/app-data.json?v=${v}`;
    const base = await fetch(url, { cache: "no-store" }).then(r => r.json());
    return base;
  },

  async init(sess) {
    this.base = await this.loadBaseFromServer().catch(() => null);
    if (!this._isValid(this.base)) {
      this.base = this._emptyBase();
    }

    if (sess?.role === "admin") {
      const raw = localStorage.getItem(ADMIN_STORE_KEY);
      const draft = raw ? safeJSON.parse(raw) : null;
      this.data = this._isValid(draft) ? draft : structuredClone(this.base);
      // se draft inválido, começa do base
      this._saveAdminDraft();
    } else {
      // artista sempre usa base do servidor
      this.data = structuredClone(this.base);
    }
    return this.data;
  },

  refreshFromServerForArtists(sess) {
    if (sess?.role !== "admin") {
      return this.init(sess);
    }
    return Promise.resolve(this.data);
  },

  _saveAdminDraft() {
    localStorage.setItem(ADMIN_STORE_KEY, safeJSON.stringify(this.data));
  },

  adminSave() {
    if (!this._isValid(this.data)) {
      toast("Dados inválidos. Voltando ao padrão do servidor.");
      this.data = structuredClone(this.base || this._emptyBase());
    }
    this.data.meta.lastUpdatedISO = new Date().toISOString();
    this._saveAdminDraft();
  },

  adminResetToServer() {
    this.data = structuredClone(this.base || this._emptyBase());
    this.adminSave();
  },

  adminGeneratePublishJSON() {
    // Gera JSON limpo para colar em data/app-data.json
    const out = structuredClone(this.data);
    out.meta.lastUpdatedISO = new Date().toISOString();
    return safeJSON.stringify(out);
  },

  adminImportDraft(jsonText) {
    const obj = safeJSON.parse(jsonText);
    if (!this._isValid(obj)) return { ok: false, error: "JSON inválido ou estrutura incorreta." };
    this.data = obj;
    this.adminSave();
    return { ok: true };
  },

  findUser(username, password) {
    const users = this.base?.users || this.data?.users || [];
    return users.find(u => u.username === username && u.password === password) || null;
  },

  getArtistById(artistId) {
    return (this.data?.artists || []).find(a => a.id === artistId) || null;
  },

  _isValid(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (!obj.meta || !Array.isArray(obj.users) || !Array.isArray(obj.artists)) return false;
    if (!Array.isArray(obj.projects) || !Array.isArray(obj.releasedTracks)) return false;
    if (!Array.isArray(obj.links) || !Array.isArray(obj.events) || !Array.isArray(obj.usefulInfo)) return false;
    if (!obj.analytics || !Array.isArray(obj.analytics.series)) return false;
    return true;
  },

  _emptyBase() {
    return {
      meta: { portalName: "Vale Produção — Portal", lastUpdatedISO: new Date().toISOString(), spotifyProfile: "https://open.spotify.com/" },
      users: [],
      artists: [],
      releasedTracks: [],
      projects: [],
      usefulInfo: [],
      events: [],
      links: [],
      analytics: { notes: "", series: [] }
    };
  }
};

/* ---------------- ROUTER / UI ---------------- */
function currentRoute() {
  const hash = location.hash || "#/dashboard";
  const parts = hash.replace("#/", "").split("/");
  return parts[0] || "dashboard";
}

function setActiveNav(routeKey) {
  document.querySelectorAll(".nav-item").forEach(a => {
    a.classList.toggle("active", a.dataset.route === routeKey);
  });
}

function openSidebar(open) {
  if (open) UI.sidebar.classList.add("open");
  else UI.sidebar.classList.remove("open");
}

function requireAuth() {
  const sess = Auth.get();
  if (!sess) {
    UI.loginView.classList.remove("hidden");
    UI.appView.classList.add("hidden");
    UI.logoutBtn.classList.add("hidden");
    UI.userPill.classList.add("hidden");
    UI.adminNav.classList.add("hidden");
    return null;
  }

  UI.loginView.classList.add("hidden");
  UI.appView.classList.remove("hidden");
  UI.logoutBtn.classList.remove("hidden");
  UI.userPill.classList.remove("hidden");

  UI.userPillText.textContent = sess.display;
  UI.roleBadge.textContent = sess.role === "admin" ? "Admin" : "Artista";
  UI.adminNav.classList.toggle("hidden", sess.role !== "admin");

  return sess;
}

function guardRoute(sess, routeKey) {
  const r = ROUTES[routeKey];
  if (!r) return { ok: false, route: "dashboard", reason: "Rota inexistente" };
  if (r.adminOnly && sess.role !== "admin") return { ok: false, route: "dashboard", reason: "Acesso negado" };
  return { ok: true, route: routeKey };
}

/* ---------------- FILTROS POR ARTISTA ---------------- */
function filterByArtist(sess, arr) {
  if (sess.role === "admin") return arr;
  return arr.filter(x => x.artistId === sess.artistId);
}

function filterAnalytics(sess, series) {
  if (sess.role === "admin") return series;
  return series.filter(s =>
    (s.scope === "global") ||
    (s.scope === "artist" && s.artistId === sess.artistId)
  );
}

/* ---------------- PAGES ---------------- */
function renderDashboard(sess) {
  const d = DataStore.data;

  const released = filterByArtist(sess, d.releasedTracks);
  const projects = filterByArtist(sess, d.projects);

  const artistName = sess.role === "admin"
    ? "Equipe Vale Produção"
    : (DataStore.getArtistById(sess.artistId)?.name || sess.display);

  const lastUpdate = d.meta.lastUpdatedISO ? new Date(d.meta.lastUpdatedISO).toLocaleString("pt-BR") : "—";

  return `
    <div class="panel">
      <h2 class="section-title">Bem-vindo(a), ${esc(artistName)}</h2>
      <p class="section-subtitle">
        Atualizações chegam via GitHub/Vercel (sem nuvem paga).
      </p>
      <div class="row" style="margin-top:12px;">
        <span class="pill gold">Fonte oficial: app-data.json</span>
        <span class="pill">PWA Instalável</span>
        <span class="pill">Offline (shell)</span>
      </div>
      <hr class="sep" />
      <p class="section-subtitle">Última atualização do portal: <b>${esc(lastUpdate)}</b></p>
    </div>

    <div class="panel">
      <div class="kpis">
        <div class="kpi">
          <div class="k">Músicas lançadas</div>
          <div class="v">${released.length}</div>
        </div>
        <div class="kpi">
          <div class="k">Projetos em construção</div>
          <div class="v">${projects.length}</div>
        </div>
        <div class="kpi">
          <div class="k">Acesso</div>
          <div class="v" style="font-size:14px;color:rgba(255,255,255,.84);font-weight:760;margin-top:10px;">
            ${esc(sess.role === "admin" ? "Admin total" : "Área do artista")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderContrato(sess) {
  let pdf = "./assets/contratos/contrato-padrao.pdf";
  if (sess.role !== "admin") {
    const artist = DataStore.getArtistById(sess.artistId);
    pdf = artist?.contractPdfPath || pdf;
  }

  return `
    ${pageHeader("Contrato assinado (PDF)", sess.role === "admin" ? "Admin: contratos em assets/contratos/" : "Seu contrato está disponível para download.")}
    <div class="panel">
      <div class="row">
        <a class="btn btn-gold" href="${esc(pdf)}" download>Download do PDF</a>
        <a class="btn" href="${esc(pdf)}" target="_blank" rel="noreferrer">Abrir em nova aba</a>
      </div>
      <hr class="sep" />
      <p class="section-subtitle">
        Arquivo: <b>${esc(pdf)}</b>
      </p>
    </div>
  `;
}

function renderLancadas(sess) {
  const list = filterByArtist(sess, DataStore.data.releasedTracks);
  if (!list.length) return emptyState("Ainda não há músicas lançadas cadastradas para este perfil.");

  const rows = list.map(t => `
    <tr>
      <td><b>${esc(t.title)}</b><div class="item-meta">${esc(t.artist || "—")}</div></td>
      <td>${esc(formatDateBR(t.releaseDate))}</td>
      <td>
        ${t.spotifyUrl ? `<a class="link" href="${esc(t.spotifyUrl)}" target="_blank" rel="noreferrer">Spotify</a>` : "—"}
        ${t.youtubeUrl ? ` • <a class="link" href="${esc(t.youtubeUrl)}" target="_blank" rel="noreferrer">YouTube</a>` : ""}
      </td>
    </tr>
  `).join("");

  return `
    ${pageHeader("Músicas lançadas", "Histórico do que já foi lançado, com links.")}
    <div class="panel">
      <table class="table">
        <thead>
          <tr><th>Título</th><th>Data</th><th>Links</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderConstrucao(sess) {
  const projects = filterByArtist(sess, DataStore.data.projects);
  if (!projects.length) return emptyState("Ainda não há projetos em construção cadastrados para este perfil.");

  const cards = projects.map(p => {
    const total = p.checklist?.length || 0;
    const doneCount = (p.checklist || []).filter(c => ChecklistStore.getDone(sess, p.id, c.id)).length;

    const checks = (p.checklist || []).map(c => {
      const done = ChecklistStore.getDone(sess, p.id, c.id);
      return `
        <label class="check ${done ? "done" : ""}">
          <input type="checkbox" data-proj="${esc(p.id)}" data-check="${esc(c.id)}" ${done ? "checked" : ""} />
          <span class="txt">${esc(c.label)}</span>
        </label>
      `;
    }).join("");

    return `
      <div class="panel">
        <div class="item-top">
          <div>
            <div class="item-title">${esc(p.title)}</div>
            <div class="item-meta">
              Status: <b>${esc(p.status || "—")}</b> • Meta: <b>${esc(formatDateBR(p.targetRelease))}</b>
            </div>
          </div>
          <span class="pill gold">${doneCount}/${total} concluído</span>
        </div>

        ${p.notes ? `<p class="section-subtitle" style="margin-top:10px;">${esc(p.notes)}</p>` : ""}

        <div class="checklist">${checks}</div>

        <hr class="sep" />
        <div class="row">
          <button class="btn btn-ghost" type="button" data-action="markAllDone" data-proj="${esc(p.id)}">Marcar tudo concluído</button>
          <button class="btn btn-ghost" type="button" data-action="markAllOpen" data-proj="${esc(p.id)}">Desmarcar tudo</button>
        </div>
        <p class="section-subtitle" style="margin-top:10px;">
          Checklist é individual por login (não interfere nas atualizações do portal).
        </p>
      </div>
    `;
  }).join("");

  return `
    ${pageHeader("Projetos em construção", "Checklist do processo de produção até o lançamento final.")}
    ${cards}
  `;
}

function renderInfos() {
  const d = DataStore.data;
  if (!d.usefulInfo.length) return emptyState("Nenhuma informação útil cadastrada.");

  return `
    ${pageHeader("Informações úteis", "Orientações para fortalecer lançamentos e a carreira.")}
    ${d.usefulInfo.map(i => `
      <div class="panel">
        <div class="item-title">${esc(i.title)}</div>
        <p class="section-subtitle" style="margin-top:8px;">${esc(i.content)}</p>
      </div>
    `).join("")}
  `;
}

function renderEventos() {
  const d = DataStore.data;
  if (!d.events.length) return emptyState("Nenhum evento cadastrado.");

  const list = d.events.slice().sort((a,b)=>new Date(a.date)-new Date(b.date)).map(e => `
    <div class="panel">
      <div class="item-top">
        <div>
          <div class="item-title">${esc(e.title)}</div>
          <div class="item-meta">${esc(formatDateBR(e.date))} • ${esc(e.location || "—")}</div>
        </div>
        <span class="pill gold">Evento</span>
      </div>
      ${e.details ? `<p class="section-subtitle" style="margin-top:10px;">${esc(e.details)}</p>` : ""}
    </div>
  `).join("");

  return `${pageHeader("Eventos", "Agenda e compromissos importantes.")}${list}`;
}

function renderLinks() {
  const d = DataStore.data;
  const list = (d.links || []).map(l => `
    <div class="item">
      <div class="item-top">
        <div>
          <div class="item-title">${esc(l.label)}</div>
          <div class="item-meta">${esc(l.url)}</div>
        </div>
        <a class="pill gold" href="${esc(l.url)}" target="_blank" rel="noreferrer">Abrir</a>
      </div>
    </div>
  `).join("");

  return `
    ${pageHeader("Links", "Acesso rápido para plataformas e redes.")}
    <div class="panel">
      <div class="row">
        <a class="btn btn-gold" href="${esc(d.meta.spotifyProfile || "https://open.spotify.com/")}" target="_blank" rel="noreferrer">Abrir Spotify</a>
        <a class="btn btn-ghost" href="#/analytics">Ver Analytics</a>
      </div>
      <hr class="sep" />
      <div class="list">${list || `<div class="item-meta">Sem links cadastrados.</div>`}</div>
    </div>
  `;
}

/* ---------- Analytics ---------- */
function getMetricKeys(sess) {
  const series = filterAnalytics(sess, DataStore.data.analytics?.series || []);
  const keys = new Set(series.map(s => `${s.platform}::${s.metric}`));
  return [...keys].sort((a,b)=>a.localeCompare(b));
}
function getSelectedMetricKey(sess) {
  const keys = getMetricKeys(sess);
  const saved = localStorage.getItem(METRIC_KEY_STORAGE);
  if (saved && keys.includes(saved)) return saved;
  return keys[0] || "";
}
function setSelectedMetricKey(key) {
  localStorage.setItem(METRIC_KEY_STORAGE, key);
}
function openMetricPicker(sess) {
  const keys = getMetricKeys(sess);
  if (!keys.length) { toast("Sem dados para selecionar."); return; }
  const label = (k) => k.replace("::"," • ");
  const choice = prompt(
    "Selecione a métrica (digite o número):\n" +
    keys.map((k,i)=>`${i+1}) ${label(k)}`).join("\n") +
    `\n\nAtual: ${label(getSelectedMetricKey(sess))}`
  );
  if (!choice) return;
  const idx = Number(choice) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx >= keys.length) { toast("Seleção inválida."); return; }
  setSelectedMetricKey(keys[idx]);
  toast("Métrica selecionada.");
  navigate("analytics", sess, { silentToast: true });
}

function drawChart(canvas, metricKey, sess) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(0,0,w,h);

  const seriesAll = filterAnalytics(sess, DataStore.data.analytics?.series || []);
  const series = seriesAll
    .filter(s => `${s.platform}::${s.metric}` === metricKey)
    .map(s => ({...s, t: new Date(s.date).getTime()}))
    .filter(s => !Number.isNaN(s.t))
    .sort((a,b)=>a.t-b.t);

  const padL = 70, padR = 24, padT = 24, padB = 52;
  const X0 = padL, Y0 = padT, X1 = w - padR, Y1 = h - padB;

  ctx.fillStyle = "rgba(242,223,154,0.92)";
  ctx.font = "700 22px ui-sans-serif,system-ui";
  const title = metricKey ? metricKey.replace("::"," • ") : "Sem dados";
  ctx.fillText(title, X0, 26);

  if (!series.length) {
    ctx.fillStyle = "rgba(255,255,255,0.70)";
    ctx.font = "500 16px ui-sans-serif,system-ui";
    ctx.fillText("Sem registros para esta métrica.", X0, 64);
    return;
  }

  const vals = series.map(s => Number(s.value)).filter(v => !Number.isNaN(v));
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const span = (maxV - minV) || 1;

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i=0;i<=4;i++){
    const y = Y0 + (Y1-Y0) * (i/4);
    ctx.beginPath(); ctx.moveTo(X0, y); ctx.lineTo(X1, y); ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.70)";
  ctx.font = "600 12px ui-sans-serif,system-ui";
  ctx.fillText(String(maxV), 16, Y0 + 8);
  ctx.fillText(String(minV), 16, Y1);

  const xs = series.map((s,i) => X0 + (X1-X0) * (i/(series.length-1 || 1)));
  const ys = series.map((s) => {
    const v = Number(s.value);
    const t = (v - minV) / span;
    return Y1 - (Y1-Y0) * t;
  });

  ctx.strokeStyle = "rgba(215,179,90,0.92)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i=1;i<xs.length;i++) ctx.lineTo(xs[i], ys[i]);
  ctx.stroke();

  ctx.fillStyle = "rgba(242,223,154,0.95)";
  for (let i=0;i<xs.length;i++){
    ctx.beginPath();
    ctx.arc(xs[i], ys[i], 4.2, 0, Math.PI*2);
    ctx.fill();
  }

  const first = series[0], last = series[series.length-1];
  ctx.fillStyle = "rgba(255,255,255,0.70)";
  ctx.font = "600 12px ui-sans-serif,system-ui";
  ctx.fillText(formatDateBR(first.date), X0, h - 18);
  const lastLabel = formatDateBR(last.date);
  const measure = ctx.measureText(lastLabel).width;
  ctx.fillText(lastLabel, X1 - measure, h - 18);
}

function renderAnalytics(sess) {
  const series = filterAnalytics(sess, DataStore.data.analytics?.series || []);
  const notes = DataStore.data.analytics?.notes || "";

  const latestBy = {};
  for (const s of series) {
    const key = `${s.platform}::${s.metric}`;
    const t = new Date(s.date).getTime();
    if (!latestBy[key] || t > latestBy[key].t) latestBy[key] = { ...s, t };
  }
  const latest = Object.values(latestBy);

  const rows = series.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).map(s => `
    <tr>
      <td><b>${esc(s.platform)}</b><div class="item-meta">${esc(s.metric)}</div></td>
      <td>${esc(s.value)}</td>
      <td>${esc(formatDateBR(s.date))}</td>
    </tr>
  `).join("");

  const kpis = latest.slice(0, 6).map(x => `
    <div class="kpi">
      <div class="k">${esc(x.platform)} • ${esc(x.metric)}</div>
      <div class="v">${esc(x.value)}</div>
    </div>
  `).join("");

  return `
    ${pageHeader("Analytics", "Atualiza via GitHub (dados oficiais no app-data.json).")}
    <div class="panel">
      <div class="grid">
        <div class="col-8">
          <div class="canvas-wrap">
            <canvas id="chartCanvas" width="1200" height="320"></canvas>
          </div>
          <p class="section-subtitle" style="margin-top:10px;">Use “Selecionar métrica” para alternar o gráfico.</p>
        </div>
        <div class="col-4">
          <div class="kpis" style="grid-template-columns: 1fr;">
            ${kpis || `<div class="kpi"><div class="k">Sem dados</div><div class="v">—</div></div>`}
          </div>
          <hr class="sep" />
          <div class="row">
            ${sess.role === "admin" ? `<a class="btn btn-gold" href="#/admin">Editar (Admin)</a>` : ``}
            <button class="btn btn-ghost" type="button" id="chartSelectBtn">Selecionar métrica</button>
          </div>
          ${notes ? `<p class="section-subtitle" style="margin-top:10px;">${esc(notes)}</p>` : ""}
        </div>
      </div>
    </div>

    <div class="panel">
      <h3 class="section-title" style="font-size:16px;">Histórico</h3>
      <p class="section-subtitle">Últimos registros.</p>
      <hr class="sep" />
      ${series.length ? `
        <table class="table">
          <thead><tr><th>Plataforma / Métrica</th><th>Valor</th><th>Data</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      ` : `<div class="item-meta">Sem registros.</div>`}
    </div>
  `;
}

function renderAdmin(sess) {
  const d = DataStore.data;
  const artistOptions = (d.artists || [])
    .map(a => `<option value="${esc(a.id)}">${esc(a.name)} (${esc(a.id)})</option>`)
    .join("");

  return `
    ${pageHeader("Admin", "Edite aqui e depois publique no GitHub (sem nuvem paga).")}

    <div class="panel">
      <h3 class="section-title" style="font-size:16px;">Inserir Analytics</h3>
      <p class="section-subtitle">Escolha escopo: Global ou por artista.</p>
      <hr class="sep" />

      <div class="grid">
        <div class="col-6">
          <div class="form-row">
            <label class="label" for="aScope">Escopo</label>
            <select class="input" id="aScope">
              <option value="artist">Artista</option>
              <option value="global">Global</option>
            </select>
          </div>
        </div>

        <div class="col-6">
          <div class="form-row">
            <label class="label" for="aArtist">Artista (se escopo=Artista)</label>
            <select class="input" id="aArtist">${artistOptions}</select>
          </div>
        </div>

        <div class="col-6">
          <div class="form-row">
            <label class="label" for="aPlatform">Plataforma</label>
            <input class="input" id="aPlatform" placeholder="Spotify / Instagram / YouTube..." />
          </div>
        </div>

        <div class="col-6">
          <div class="form-row">
            <label class="label" for="aMetric">Métrica</label>
            <input class="input" id="aMetric" placeholder="Ouvintes mensais / Seguidores / Views..." />
          </div>
        </div>

        <div class="col-6">
          <div class="form-row">
            <label class="label" for="aValue">Valor</label>
            <input class="input" id="aValue" type="number" placeholder="ex: 1200" />
          </div>
        </div>

        <div class="col-6">
          <div class="form-row">
            <label class="label" for="aDate">Data</label>
            <input class="input" id="aDate" type="date" />
          </div>
        </div>

        <div class="col-12">
          <button class="btn btn-gold" id="addAnalyticsBtn" type="button">Adicionar registro</button>
          <button class="btn btn-ghost" id="clearAnalyticsBtn" type="button">Limpar analytics (cuidado)</button>
        </div>
      </div>

      <hr class="sep" />
      <h3 class="section-title" style="font-size:16px;">Notas do Analytics</h3>
      <textarea class="input" id="aNotes" placeholder="Observações internas...">${esc(d.analytics?.notes || "")}</textarea>
      <div class="row" style="margin-top:10px;">
        <button class="btn btn-ghost" id="saveNotesBtn" type="button">Salvar notas</button>
      </div>
    </div>

    <div class="panel">
      <h3 class="section-title" style="font-size:16px;">Publicar no GitHub (Atualização para todos)</h3>
      <p class="section-subtitle">
        Clique em “Gerar JSON”, copie e cole no arquivo <b>data/app-data.json</b> do GitHub e faça commit.
        Assim, a atualização chega para todos.
      </p>
      <hr class="sep" />
      <div class="row">
        <button class="btn btn-gold" id="genPublishBtn" type="button">Gerar JSON para GitHub</button>
        <button class="btn btn-ghost" id="resetFromServerBtn" type="button">Descartar rascunho (voltar ao servidor)</button>
      </div>
      <hr class="sep" />
      <label class="label" for="publishBox">JSON para colar no GitHub</label>
      <textarea class="input" id="publishBox" placeholder="Clique em Gerar JSON..."></textarea>
    </div>

    <div class="panel">
      <h3 class="section-title" style="font-size:16px;">Importar rascunho (Admin)</h3>
      <p class="section-subtitle">Se você tiver um JSON salvo, pode importar aqui (só para o admin).</p>
      <hr class="sep" />
      <label class="label" for="importBox">Importar JSON</label>
      <textarea class="input" id="importBox" placeholder="Cole JSON..."></textarea>
      <div class="row" style="margin-top:10px;">
        <button class="btn btn-gold" id="importBtn" type="button">Importar</button>
      </div>
    </div>
  `;
}

/* ---------------- Events wiring ---------------- */
function bindPageEvents(sess, routeKey) {
  // checklist
  UI.page.querySelectorAll('input[type="checkbox"][data-proj][data-check]').forEach(cb => {
    cb.addEventListener("change", () => {
      const projId = cb.getAttribute("data-proj");
      const checkId = cb.getAttribute("data-check");
      ChecklistStore.setDone(sess, projId, checkId, cb.checked);
      navigate(routeKey, sess, { silentToast: true });
    });
  });

  UI.page.querySelectorAll('[data-action="markAllDone"][data-proj]').forEach(btn => {
    btn.addEventListener("click", () => {
      const projId = btn.getAttribute("data-proj");
      const proj = DataStore.data.projects.find(p => p.id === projId);
      if (!proj) return;
      ChecklistStore.setAll(sess, projId, proj.checklist || [], true);
      toast("Checklist: tudo concluído.");
      navigate(routeKey, sess, { silentToast: true });
    });
  });

  UI.page.querySelectorAll('[data-action="markAllOpen"][data-proj]').forEach(btn => {
    btn.addEventListener("click", () => {
      const projId = btn.getAttribute("data-proj");
      const proj = DataStore.data.projects.find(p => p.id === projId);
      if (!proj) return;
      ChecklistStore.setAll(sess, projId, proj.checklist || [], false);
      toast("Checklist: tudo desmarcado.");
      navigate(routeKey, sess, { silentToast: true });
    });
  });

  // analytics metric picker
  const chartSelectBtn = $("#chartSelectBtn", UI.page);
  if (chartSelectBtn) chartSelectBtn.addEventListener("click", () => openMetricPicker(sess));

  if (routeKey === "analytics") {
    setTimeout(() => {
      const c = $("#chartCanvas", UI.page);
      if (c) drawChart(c, getSelectedMetricKey(sess), sess);
    }, 0);
  }

  // admin actions
  if (routeKey === "admin") {
    $("#addAnalyticsBtn", UI.page)?.addEventListener("click", () => {
      const scope = ($("#aScope", UI.page).value || "artist").trim();
      const artistId = ($("#aArtist", UI.page).value || "").trim();
      const platform = ($("#aPlatform", UI.page).value || "").trim();
      const metric = ($("#aMetric", UI.page).value || "").trim();
      const valueRaw = ($("#aValue", UI.page).value || "").trim();
      const date = ($("#aDate", UI.page).value || "").trim();
      const value = Number(valueRaw);

      if (!platform || !metric || !date || Number.isNaN(value)) { toast("Preencha plataforma, métrica, valor e data."); return; }
      if (scope === "artist" && !artistId) { toast("Selecione o artista."); return; }

      const entry = { scope, platform, metric, value, date };
      if (scope === "artist") entry.artistId = artistId;

      DataStore.data.analytics.series.push(entry);
      DataStore.adminSave();
      toast("Registro adicionado (rascunho do admin).");
      location.hash = "#/analytics";
    });

    $("#clearAnalyticsBtn", UI.page)?.addEventListener("click", () => {
      const ok = confirm("Tem certeza? Isso apaga todos os registros de analytics (rascunho do admin).");
      if (!ok) return;
      DataStore.data.analytics.series = [];
      DataStore.adminSave();
      toast("Analytics limpo.");
      location.hash = "#/analytics";
    });

    $("#saveNotesBtn", UI.page)?.addEventListener("click", () => {
      const notes = ($("#aNotes", UI.page).value || "").trim();
      DataStore.data.analytics.notes = notes;
      DataStore.adminSave();
      toast("Notas salvas.");
    });

    $("#genPublishBtn", UI.page)?.addEventListener("click", () => {
      const out = DataStore.adminGeneratePublishJSON();
      $("#publishBox", UI.page).value = out;
      toast("JSON gerado. Copie e cole no GitHub.");
    });

    $("#resetFromServerBtn", UI.page)?.addEventListener("click", async () => {
      const ok = confirm("Descartar rascunho local e voltar ao que está publicado no servidor?");
      if (!ok) return;
      await DataStore.init(sess); // recarrega base e reseta draft
      DataStore.adminResetToServer();
      toast("Rascunho descartado.");
      navigate("admin", sess, { silentToast: true });
    });

    $("#importBtn", UI.page)?.addEventListener("click", () => {
      const txt = ($("#importBox", UI.page).value || "").trim();
      if (!txt) { toast("Cole o JSON."); return; }
      const res = DataStore.adminImportDraft(txt);
      if (!res.ok) { toast(res.error || "Falha ao importar."); return; }
      toast("Importado no rascunho do admin.");
      navigate("admin", sess, { silentToast: true });
    });
  }
}

/* ---------------- Router ---------------- */
function navigate(routeKey, sess, opts = {}) {
  const r = ROUTES[routeKey] || ROUTES.dashboard;
  UI.pageTitle.textContent = r.title;
  setActiveNav(routeKey);
  UI.page.innerHTML = r.render(sess);
  bindPageEvents(sess, routeKey);
}

async function onRouteChange() {
  const sess = requireAuth();
  if (!sess) return;

  // Artistas sempre tentam atualizar dados do servidor ao navegar
  await DataStore.refreshFromServerForArtists(sess);

  const routeKey = currentRoute();
  const guarded = guardRoute(sess, routeKey);
  if (!guarded.ok) {
    toast(guarded.reason || "Acesso restrito.");
    location.hash = `#/${guarded.route}`;
    return;
  }

  openSidebar(false);
  navigate(routeKey, sess);
}

/* ---------------- PWA Install ---------------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  UI.installBtn.classList.remove("hidden");
});
UI.installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  UI.installBtn.classList.add("hidden");
  if (outcome === "accepted") toast("App instalado.");
});

/* ---------------- Boot ---------------- */
async function boot() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./service-worker.js"); } catch {}
  }

  // Precisa do base para autenticar (users vêm do JSON)
  await DataStore.init(null);

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = ($("#loginUser").value || "").trim();
    const password = ($("#loginPass").value || "").trim();

    // Recarrega base antes de logar (pega usuários atualizados do Git)
    await DataStore.init(null);

    const user = DataStore.findUser(username, password);
    if (!user) { toast("Usuário ou senha inválidos."); return; }

    const session = {
      username: user.username,
      role: user.role,
      display: user.display || user.username,
      artistId: user.artistId || null,
      ts: Date.now()
    };

    Auth.set(session);

    // Inicializa dados conforme role
    await DataStore.init(session);

    toast("Bem-vindo(a).");
    location.hash = "#/dashboard";
    onRouteChange();
  });

  UI.logoutBtn.addEventListener("click", () => {
    Auth.clear();
    toast("Sessão encerrada.");
    location.hash = "#/dashboard";
    onRouteChange();
  });

  UI.mobileMenuBtn.addEventListener("click", () => {
    const isOpen = UI.sidebar.classList.contains("open");
    openSidebar(!isOpen);
  });

  document.addEventListener("click", (e) => {
    if (window.matchMedia("(max-width: 980px)").matches) {
      const clickedInsideSidebar = UI.sidebar.contains(e.target);
      const clickedMenuBtn = UI.mobileMenuBtn.contains(e.target);
      if (!clickedInsideSidebar && !clickedMenuBtn) openSidebar(false);
    }
  });

  window.addEventListener("hashchange", onRouteChange);

  if (!location.hash) location.hash = "#/dashboard";
  onRouteChange();
}

boot();