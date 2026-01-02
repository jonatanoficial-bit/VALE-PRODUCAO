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

const AUTH_KEY = "vp.auth.session.v5";
const ADMIN_STORE_KEY = "vp.portal.admin.data.v5";
const CHECKLIST_KEY_PREFIX = "vp.portal.checklist.v1.";
const ADMIN_ANALYTICS_DRAFT_KEY = "vp.portal.analytics.draft.v1";

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

/* ---------------- CHECKLIST (por usuário) ---------------- */
const ChecklistStore = {
  _key(sess) { return CHECKLIST_KEY_PREFIX + (sess.username || "anon"); },
  load(sess) {
    const raw = localStorage.getItem(this._key(sess));
    const obj = raw ? safeJSON.parse(raw) : null;
    return obj && typeof obj === "object" ? obj : {};
  },
  save(sess, obj) { localStorage.setItem(this._key(sess), safeJSON.stringify(obj)); },
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

/* ---------------- DATASTORE ---------------- */
const DataStore = {
  base: null,
  data: null,
  analyticsBase: null,
  analyticsData: null,

  async loadJSON(path) {
    const v = Date.now();
    const url = `${path}?v=${v}`;
    return await fetch(url, { cache: "no-store" }).then(r => r.json());
  },

  async init(sess) {
    this.base = await this.loadJSON("./data/app-data.json").catch(() => null);
    if (!this._isValidApp(this.base)) this.base = this._emptyApp();

    this.analyticsBase = await this.loadJSON("./data/analytics.json").catch(() => null);
    if (!this._isValidAnalytics(this.analyticsBase)) this.analyticsBase = this._emptyAnalytics();

    if (sess?.role === "admin") {
      const raw = localStorage.getItem(ADMIN_STORE_KEY);
      const draft = raw ? safeJSON.parse(raw) : null;
      this.data = this._isValidApp(draft) ? structuredClone(draft) : structuredClone(this.base);

      const aRaw = localStorage.getItem(ADMIN_ANALYTICS_DRAFT_KEY);
      const aDraft = aRaw ? safeJSON.parse(aRaw) : null;
      this.analyticsData = this._isValidAnalytics(aDraft) ? structuredClone(aDraft) : structuredClone(this.analyticsBase);

      this._saveAdminDraft();
    } else {
      this.data = structuredClone(this.base);
      this.analyticsData = structuredClone(this.analyticsBase);
    }

    return { app: this.data, analytics: this.analyticsData };
  },

  async refreshForArtists(sess) {
    if (sess?.role === "admin") return { app: this.data, analytics: this.analyticsData };
    return await this.init(sess);
  },

  _saveAdminDraft() {
    localStorage.setItem(ADMIN_STORE_KEY, safeJSON.stringify(this.data));
    localStorage.setItem(ADMIN_ANALYTICS_DRAFT_KEY, safeJSON.stringify(this.analyticsData));
  },

  adminSave() {
    if (!this._isValidApp(this.data)) this.data = structuredClone(this.base || this._emptyApp());
    if (!this._isValidAnalytics(this.analyticsData)) this.analyticsData = structuredClone(this.analyticsBase || this._emptyAnalytics());

    this.data.meta.lastUpdatedISO = new Date().toISOString();
    this._saveAdminDraft();
  },

  adminResetToServer() {
    this.data = structuredClone(this.base || this._emptyApp());
    this.analyticsData = structuredClone(this.analyticsBase || this._emptyAnalytics());
    this.adminSave();
  },

  adminGeneratePublishAppJSON() {
    const out = structuredClone(this.data);
    out.meta.lastUpdatedISO = new Date().toISOString();
    return safeJSON.stringify(out, null, 2);
  },

  adminGeneratePublishAnalyticsJSON() {
    const out = structuredClone(this.analyticsData);
    return safeJSON.stringify(out, null, 2);
  },

  adminImportAnalyticsDraft(jsonText) {
    const obj = safeJSON.parse(jsonText);
    if (!this._isValidAnalytics(obj)) return { ok: false, error: "JSON inválido para analytics.json." };
    this.analyticsData = structuredClone(obj);
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

  getArtistAnalytics(artistId) {
    const a = this.analyticsData?.artists?.[artistId];
    if (!a) return { name: this.getArtistById(artistId)?.name || "Artista", analytics: [] };
    return a;
  },

  _isValidApp(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (!obj.meta || !Array.isArray(obj.users) || !Array.isArray(obj.artists)) return false;
    if (!Array.isArray(obj.projects) || !Array.isArray(obj.releasedTracks)) return false;
    if (!Array.isArray(obj.links) || !Array.isArray(obj.events) || !Array.isArray(obj.usefulInfo)) return false;
    return true;
  },

  _isValidAnalytics(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (!obj.artists || typeof obj.artists !== "object") return false;
    return true;
  },

  _emptyApp() {
    return {
      meta: { portalName: "Vale Produção — Portal", lastUpdatedISO: new Date().toISOString(), spotifyProfile: "https://open.spotify.com/" },
      users: [],
      artists: [],
      releasedTracks: [],
      projects: [],
      usefulInfo: [],
      events: [],
      links: []
    };
  },

  _emptyAnalytics() {
    return { artists: {} };
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
        Portal exclusivo com login individual. Atualizações chegam via GitHub/Vercel.
      </p>
      <div class="row" style="margin-top:12px;">
        <span class="pill gold">PWA Instalável</span>
        <span class="pill">Área exclusiva</span>
        <span class="pill">Analytics</span>
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
          <div class="k">Performance</div>
          <div class="v" style="font-size:14px;color:rgba(255,255,255,.84);font-weight:760;margin-top:10px;">
            <a class="link" href="#/analytics">Ver analytics</a>
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
      <p class="section-subtitle">Arquivo: <b>${esc(pdf)}</b></p>
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
        <thead><tr><th>Título</th><th>Data</th><th>Links</th></tr></thead>
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

/* ---------- Analytics (JSON data/analytics.json) ---------- */
function getArtistBlock(sess) {
  if (sess.role === "admin") return null;
  return DataStore.getArtistAnalytics(sess.artistId);
}

function listPeriods(artistBlock) {
  const arr = Array.isArray(artistBlock?.analytics) ? artistBlock.analytics : [];
  const periods = arr.map(a => a.period).filter(Boolean);
  periods.sort((a,b)=>b.localeCompare(a));
  return periods;
}

function pickLatestPeriod(artistBlock) {
  const periods = listPeriods(artistBlock);
  return periods[0] || "";
}

function findPeriodData(artistBlock, period) {
  const arr = Array.isArray(artistBlock?.analytics) ? artistBlock.analytics : [];
  return arr.find(x => x.period === period) || null;
}

function pctChange(current, prev) {
  const c = Number(current || 0);
  const p = Number(prev || 0);
  if (p === 0 && c === 0) return 0;
  if (p === 0) return 100;
  return ((c - p) / p) * 100;
}

function fmtNum(n) {
  const v = Number(n || 0);
  return v.toLocaleString("pt-BR");
}

function renderAnalytics(sess) {
  if (sess.role === "admin") {
    return `
      ${pageHeader("Analytics", "Admin: edite e gere o JSON para publicar no GitHub (data/analytics.json).")}
      ${renderAdminAnalyticsBlock()}
    `;
  }

  const artistBlock = getArtistBlock(sess);
  const periods = listPeriods(artistBlock);
  if (!periods.length) return emptyState("Ainda não há analytics cadastrados para este artista.");

  const selected = localStorage.getItem("vp.analytics.period.sel") || pickLatestPeriod(artistBlock);
  const current = findPeriodData(artistBlock, selected) || findPeriodData(artistBlock, periods[0]);
  const prevPeriod = periods[1] || null;
  const prev = prevPeriod ? findPeriodData(artistBlock, prevPeriod) : null;

  const streams = current?.music?.streams ?? 0;
  const downloads = current?.music?.downloads ?? 0;

  const prevStreams = prev?.music?.streams ?? 0;
  const prevDownloads = prev?.music?.downloads ?? 0;

  const streamsDelta = prev ? pctChange(streams, prevStreams) : null;
  const downloadsDelta = prev ? pctChange(downloads, prevDownloads) : null;

  const igF = current?.social?.instagram?.followers ?? 0;
  const igE = current?.social?.instagram?.engagement ?? 0;
  const fbF = current?.social?.facebook?.followers ?? 0;
  const fbE = current?.social?.facebook?.engagement ?? 0;
  const ytS = current?.social?.youtube?.subscribers ?? 0;
  const ytV = current?.social?.youtube?.views ?? 0;

  const topCountries = Array.isArray(current?.countries) ? current.countries.slice(0,3) : [];
  while (topCountries.length < 3) topCountries.push({ country: "—", plays: 0 });

  const topTrack = current?.music?.top_track || "—";

  return `
    ${pageHeader("Analytics", "Entenda sua evolução (streams, downloads, países, seguidores e engajamento).")}

    <div class="panel">
      <div class="row">
        <button class="btn btn-ghost" id="periodPickerBtn" type="button">Período: <b>${esc(selected)}</b></button>
        ${prevPeriod ? `<span class="pill">Comparando com: <b>${esc(prevPeriod)}</b></span>` : `<span class="pill">Sem período anterior</span>`}
      </div>

      <hr class="sep" />

      <div class="grid">
        <div class="col-12">
          <div class="kpis">
            <div class="kpi">
              <div class="k">Streams</div>
              <div class="v">${fmtNum(streams)}</div>
              <div class="item-meta" style="margin-top:8px;">
                ${prev ? `Evolução: <b>${streamsDelta >= 0 ? "+" : ""}${streamsDelta.toFixed(1)}%</b>` : `Evolução: <b>—</b>`}
              </div>
            </div>

            <div class="kpi">
              <div class="k">Downloads</div>
              <div class="v">${fmtNum(downloads)}</div>
              <div class="item-meta" style="margin-top:8px;">
                ${prev ? `Evolução: <b>${downloadsDelta >= 0 ? "+" : ""}${downloadsDelta.toFixed(1)}%</b>` : `Evolução: <b>—</b>`}
              </div>
            </div>

            <div class="kpi">
              <div class="k">Música destaque</div>
              <div class="v" style="font-size:16px;line-height:1.2;">${esc(topTrack)}</div>
              <div class="item-meta" style="margin-top:8px;">
                Período: <b>${esc(selected)}</b>
              </div>
            </div>
          </div>
        </div>

        <div class="col-6">
          <div class="panel" style="padding:16px;">
            <div class="item-top">
              <div>
                <div class="section-title" style="font-size:16px;">Top 3 países (plays)</div>
                <div class="section-subtitle">Ranking do período selecionado</div>
              </div>
              <span class="pill gold">${esc(selected)}</span>
            </div>
            <hr class="sep" />
            <div class="list">
              ${topCountries.map((c, idx) => `
                <div class="item">
                  <div class="item-top">
                    <div>
                      <div class="item-title">${idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"} ${esc(c.country)}</div>
                      <div class="item-meta">${fmtNum(c.plays)} plays</div>
                    </div>
                    <span class="pill gold">Top ${idx+1}</span>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        </div>

        <div class="col-6">
          <div class="panel" style="padding:16px;">
            <div class="section-title" style="font-size:16px;">Redes sociais</div>
            <p class="section-subtitle">Seguidores, inscritos, views e engajamento</p>
            <hr class="sep" />

            <div class="list">
              <div class="item">
                <div class="item-top">
                  <div>
                    <div class="item-title">Instagram</div>
                    <div class="item-meta">Seguidores: <b>${fmtNum(igF)}</b> • Engajamento: <b>${Number(igE).toFixed(1)}%</b></div>
                  </div>
                  <span class="pill gold">IG</span>
                </div>
              </div>

              <div class="item">
                <div class="item-top">
                  <div>
                    <div class="item-title">Facebook</div>
                    <div class="item-meta">Seguidores: <b>${fmtNum(fbF)}</b> • Engajamento: <b>${Number(fbE).toFixed(1)}%</b></div>
                  </div>
                  <span class="pill gold">FB</span>
                </div>
              </div>

              <div class="item">
                <div class="item-top">
                  <div>
                    <div class="item-title">YouTube</div>
                    <div class="item-meta">Inscritos: <b>${fmtNum(ytS)}</b> • Views: <b>${fmtNum(ytV)}</b></div>
                  </div>
                  <span class="pill gold">YT</span>
                </div>
              </div>
            </div>

            <p class="section-subtitle" style="margin-top:12px;">
              Dica: streams mostram alcance; engajamento mostra conexão real.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAdminAnalyticsBlock() {
  const analytics = DataStore.analyticsData || { artists: {} };
  const artists = DataStore.data?.artists || [];
  const options = artists.map(a => `<option value="${esc(a.id)}">${esc(a.name)} (${esc(a.id)})</option>`).join("");

  return `
    <div class="panel">
      <h3 class="section-title" style="font-size:16px;">Editar Analytics (rascunho do Admin)</h3>
      <p class="section-subtitle">Preencha e clique em “Salvar no rascunho”. Depois gere o JSON e cole no GitHub em <b>data/analytics.json</b>.</p>
      <hr class="sep" />

      <div class="grid">
        <div class="col-6">
          <div class="form-row">
            <label class="label" for="adArtistId">Artista</label>
            <select class="input" id="adArtistId">${options}</select>
          </div>
        </div>

        <div class="col-6">
          <div class="form-row">
            <label class="label" for="adPeriod">Período (AAAA-MM)</label>
            <input class="input" id="adPeriod" placeholder="2026-01" />
          </div>
        </div>

        <div class="col-6">
          <div class="form-row">
            <label class="label" for="adStreams">Streams</label>
            <input class="input" id="adStreams" type="number" step="1" />
          </div>
        </div>

        <div class="col-6">
          <div class="form-row">
            <label class="label" for="adDownloads">Downloads</label>
            <input class="input" id="adDownloads" type="number" step="1" />
          </div>
        </div>

        <div class="col-12">
          <div class="form-row">
            <label class="label" for="adTopTrack">Música destaque</label>
            <input class="input" id="adTopTrack" placeholder="Nome da música" />
          </div>
        </div>

        <div class="col-12">
          <h3 class="section-title" style="font-size:16px;margin:6px 0 0;">Top 3 países (plays)</h3>
          <p class="section-subtitle">Preencha país e plays.</p>
        </div>

        <div class="col-4"><input class="input" id="c1" placeholder="País 1" /></div>
        <div class="col-4"><input class="input" id="c2" placeholder="País 2" /></div>
        <div class="col-4"><input class="input" id="c3" placeholder="País 3" /></div>

        <div class="col-4"><input class="input" id="p1" type="number" step="1" placeholder="Plays 1" /></div>
        <div class="col-4"><input class="input" id="p2" type="number" step="1" placeholder="Plays 2" /></div>
        <div class="col-4"><input class="input" id="p3" type="number" step="1" placeholder="Plays 3" /></div>

        <div class="col-12">
          <h3 class="section-title" style="font-size:16px;margin:6px 0 0;">Redes sociais</h3>
        </div>

        <div class="col-6">
          <div class="form-row">
            <label class="label" for="igF">Instagram seguidores</label>
            <input class="input" id="igF" type="number" step="1" />
          </div>
        </div>
        <div class="col-6">
          <div class="form-row">
            <label class="label" for="igE">Instagram engajamento (%)</label>
            <input class="input" id="igE" type="number" step="0.1" />
          </div>
        </div>

        <div class="col-6">
          <div class="form-row">
            <label class="label" for="fbF">Facebook seguidores</label>
            <input class="input" id="fbF" type="number" step="1" />
          </div>
        </div>
        <div class="col-6">
          <div class="form-row">
            <label class="label" for="fbE">Facebook engajamento (%)</label>
            <input class="input" id="fbE" type="number" step="0.1" />
          </div>
        </div>

        <div class="col-6">
          <div class="form-row">
            <label class="label" for="ytS">YouTube inscritos</label>
            <input class="input" id="ytS" type="number" step="1" />
          </div>
        </div>
        <div class="col-6">
          <div class="form-row">
            <label class="label" for="ytV">YouTube views</label>
            <input class="input" id="ytV" type="number" step="1" />
          </div>
        </div>

        <div class="col-12">
          <button class="btn btn-gold" id="saveAnalyticsDraftBtn" type="button">Salvar no rascunho</button>
          <button class="btn btn-ghost" id="genAnalyticsJsonBtn" type="button">Gerar JSON (data/analytics.json)</button>
          <button class="btn btn-ghost" id="resetAdminBtn" type="button">Descartar rascunho (voltar ao publicado)</button>
        </div>

        <div class="col-12">
          <label class="label" for="analyticsJsonBox">JSON pronto para colar no GitHub</label>
          <textarea class="input" id="analyticsJsonBox" placeholder="Clique em Gerar JSON..."></textarea>
        </div>

        <div class="col-12">
          <label class="label" for="importAnalyticsBox">Importar JSON (rascunho)</label>
          <textarea class="input" id="importAnalyticsBox" placeholder="Cole um analytics.json aqui..."></textarea>
          <div class="row" style="margin-top:10px;">
            <button class="btn btn-gold" id="importAnalyticsBtn" type="button">Importar</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAdmin(sess) {
  return `
    ${pageHeader("Admin", "Use o menu Analytics para editar e publicar o arquivo data/analytics.json.")}
    <div class="panel">
      <p class="section-subtitle">
        Vá em <b>Analytics</b> no menu e use a área de Admin para gerar o JSON.
      </p>
    </div>
  `;
}

/* ---------------- Events wiring ---------------- */
function bindPageEvents(sess, routeKey) {
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

  if (routeKey === "analytics" && sess.role !== "admin") {
    $("#periodPickerBtn", UI.page)?.addEventListener("click", () => {
      const artistBlock = DataStore.getArtistAnalytics(sess.artistId);
      const periods = listPeriods(artistBlock);
      const choice = prompt(
        "Escolha o período (digite o número):\n" +
        periods.map((p,i)=>`${i+1}) ${p}`).join("\n")
      );
      if (!choice) return;
      const idx = Number(choice) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= periods.length) { toast("Seleção inválida."); return; }
      localStorage.setItem("vp.analytics.period.sel", periods[idx]);
      navigate("analytics", sess, { silentToast: true });
    });
  }

  if (routeKey === "analytics" && sess.role === "admin") {
    $("#saveAnalyticsDraftBtn", UI.page)?.addEventListener("click", () => {
      const artistId = ($("#adArtistId", UI.page).value || "").trim();
      const period = ($("#adPeriod", UI.page).value || "").trim();
      if (!artistId || !period) { toast("Preencha Artista e Período."); return; }

      const streams = Number(($("#adStreams", UI.page).value || "0").trim());
      const downloads = Number(($("#adDownloads", UI.page).value || "0").trim());
      const top_track = ($("#adTopTrack", UI.page).value || "").trim();

      const c1 = ($("#c1", UI.page).value || "").trim();
      const c2 = ($("#c2", UI.page).value || "").trim();
      const c3 = ($("#c3", UI.page).value || "").trim();
      const p1 = Number(($("#p1", UI.page).value || "0").trim());
      const p2 = Number(($("#p2", UI.page).value || "0").trim());
      const p3 = Number(($("#p3", UI.page).value || "0").trim());

      const igF = Number(($("#igF", UI.page).value || "0").trim());
      const igE = Number(($("#igE", UI.page).value || "0").trim());
      const fbF = Number(($("#fbF", UI.page).value || "0").trim());
      const fbE = Number(($("#fbE", UI.page).value || "0").trim());
      const ytS = Number(($("#ytS", UI.page).value || "0").trim());
      const ytV = Number(($("#ytV", UI.page).value || "0").trim());

      const block = DataStore.analyticsData.artists[artistId] || { name: DataStore.getArtistById(artistId)?.name || artistId, analytics: [] };
      if (!Array.isArray(block.analytics)) block.analytics = [];

      const entry = {
        period,
        music: { streams: Number.isNaN(streams) ? 0 : streams, downloads: Number.isNaN(downloads) ? 0 : downloads, top_track },
        countries: [
          { country: c1 || "—", plays: Number.isNaN(p1) ? 0 : p1 },
          { country: c2 || "—", plays: Number.isNaN(p2) ? 0 : p2 },
          { country: c3 || "—", plays: Number.isNaN(p3) ? 0 : p3 }
        ],
        social: {
          instagram: { followers: Number.isNaN(igF) ? 0 : igF, engagement: Number.isNaN(igE) ? 0 : igE },
          facebook: { followers: Number.isNaN(fbF) ? 0 : fbF, engagement: Number.isNaN(fbE) ? 0 : fbE },
          youtube: { subscribers: Number.isNaN(ytS) ? 0 : ytS, views: Number.isNaN(ytV) ? 0 : ytV }
        }
      };

      const i = block.analytics.findIndex(x => x.period === period);
      if (i >= 0) block.analytics[i] = entry;
      else block.analytics.push(entry);

      DataStore.analyticsData.artists[artistId] = block;
      DataStore.adminSave();
      toast("Salvo no rascunho do admin.");
    });

    $("#genAnalyticsJsonBtn", UI.page)?.addEventListener("click", () => {
      const out = DataStore.adminGeneratePublishAnalyticsJSON();
      $("#analyticsJsonBox", UI.page).value = out;
      toast("JSON gerado. Cole no GitHub: data/analytics.json");
    });

    $("#resetAdminBtn", UI.page)?.addEventListener("click", async () => {
      const ok = confirm("Descartar rascunho local e voltar ao publicado?");
      if (!ok) return;
      await DataStore.init(sess);
      DataStore.adminResetToServer();
      toast("Rascunho descartado.");
      navigate("analytics", sess, { silentToast: true });
    });

    $("#importAnalyticsBtn", UI.page)?.addEventListener("click", () => {
      const txt = ($("#importAnalyticsBox", UI.page).value || "").trim();
      if (!txt) { toast("Cole o JSON."); return; }
      const res = DataStore.adminImportAnalyticsDraft(txt);
      if (!res.ok) { toast(res.error || "Falha ao importar."); return; }
      toast("Importado no rascunho do admin.");
      navigate("analytics", sess, { silentToast: true });
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

  await DataStore.refreshForArtists(sess);

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

  await DataStore.init(null);

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = ($("#loginUser").value || "").trim();
    const password = ($("#loginPass").value || "").trim();

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