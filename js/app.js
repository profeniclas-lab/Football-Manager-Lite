// ===== CONFIGURAÇÃO (ajuste para calibrar o jogo) =====
const HOME_ADV     = 3;     // bônus de mando (unidades de overall)
const NOISE        = 5;     // σ do ruído (zebras)
const K            = 0.035; // sensibilidade do placar à diferença
const BASE_GOALS   = 1.30;  // gols esperados em jogo equilibrado
const FORM_WEIGHT  = 2;     // peso da forma recente
const ROUNDS       = 99;
const STORAGE_KEY  = 'football-manager-v1';

// ===== UTIL =====
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function poisson(l) {
  if (l <= 0) return 0;
  const L = Math.exp(-l);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

// ===== ESTADO =====
function createInitialState() {
  const teams = TEAMS_DATA.map((row, idx) => ({
    id: row[3],
    name: row[0],
    country: row[1],
    reputation: row[2],
    overall: +(row[2] * 10).toFixed(2),
    division: idx < 100 ? 1 : 2,
    form: [],
    stats: { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 }
  }));

  const div1 = teams.filter(t => t.division === 1);
  const div2 = teams.filter(t => t.division === 2);

  return {
    season: 2025,
    round: 0,
    teams,
    fixtures: { div1: generateCalendar(div1), div2: generateCalendar(div2) },
    results:  { div1: Array(ROUNDS).fill(null), div2: Array(ROUNDS).fill(null) },
    history: []
  };
}

// ===== CALENDÁRIO (round-robin, método do círculo) =====
function generateCalendar(teams) {
  const n = teams.length;           // 100
  let rot = teams.map((_, i) => i);
  const rounds = [];

  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = rot[i], b = rot[n - 1 - i];
      if ((r + i) % 2 === 0) round.push({ home: teams[a].id, away: teams[b].id });
      else                    round.push({ home: teams[b].id, away: teams[a].id });
    }
    rounds.push(round);
    rot = [rot[0], rot[n - 1], ...rot.slice(1, n - 1)];
  }
  return rounds;
}

// ===== MOTOR =====
function calcForm(form) {
  if (form.length === 0) return 0;
  const pts = form.reduce((acc, r) => acc + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
  return (pts / form.length - 1.5) * FORM_WEIGHT; // -3 .. +3
}

function updateTeam(team, gf, ga) {
  team.stats.played++;
  team.stats.gf += gf;
  team.stats.ga += ga;
  team.stats.gd = team.stats.gf - team.stats.ga;
  if (gf > ga)      { team.stats.won++;    team.stats.pts += 3; team.form.push('W'); }
  else if (gf === ga){ team.stats.drawn++; team.stats.pts += 1; team.form.push('D'); }
  else              { team.stats.lost++;                        team.form.push('L'); }
  if (team.form.length > 5) team.form.shift();
}

function simulateRound(state) {
  if (state.round >= ROUNDS) return false;

  // lookup rápido
  const teamMap = Object.create(null);
  for (const t of state.teams) teamMap[t.id] = t;

  const r = state.round;

  for (const div of ['div1', 'div2']) {
    const fixtures = state.fixtures[div][r];
    const results  = new Array(fixtures.length);

    for (let i = 0; i < fixtures.length; i++) {
      const h = teamMap[fixtures[i].home];
      const a = teamMap[fixtures[i].away];

      const sH = h.overall + HOME_ADV + calcForm(h.form) + gauss() * NOISE;
      const sA = a.overall + calcForm(a.form) + gauss() * NOISE;
      const diff = sH - sA;

      const gH = poisson(BASE_GOALS * Math.exp( K * diff));
      const gA = poisson(BASE_GOALS * Math.exp(-K * diff));

      results[i] = { gH, gA };
      updateTeam(h, gH, gA);
      updateTeam(a, gA, gH);
    }
    state.results[div][r] = results;
  }

  state.round++;
  return true;
}

// ===== CLASSIFICAÇÃO =====
function getStandings(state, division) {
  return state.teams
    .filter(t => t.division === division)
    .slice()
    .sort((a, b) =>
      b.stats.pts - a.stats.pts ||
      b.stats.gd  - a.stats.gd  ||
      b.stats.gf  - a.stats.gf  ||
      a.name.localeCompare(b.name)
    );
}

// ===== TEMPORADA / PROMOÇÃO =====
function applySeasonEnd(state) {
  const div1 = getStandings(state, 1);
  const div2 = getStandings(state, 2);
  const relegated = div1.slice(-3);
  const promoted  = div2.slice(0, 3);

  state.history.push({
    season: state.season,
    div1Champion: div1[0].name,
    div2Champion: div2[0].name,
    promoted: promoted.map(t => t.name),
    relegated: relegated.map(t => t.name)
  });

  relegated.forEach(t => t.division = 2);
  promoted.forEach(t => t.division = 1);
}

function resetForNewSeason(state) {
  state.teams.forEach(t => {
    t.stats = { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
    t.form  = [];
  });
  const div1 = state.teams.filter(t => t.division === 1);
  const div2 = state.teams.filter(t => t.division === 2);
  state.fixtures = { div1: generateCalendar(div1), div2: generateCalendar(div2) };
  state.results  = { div1: Array(ROUNDS).fill(null), div2: Array(ROUNDS).fill(null) };
  state.round = 0;
  state.season++;
}

// ===== PERSISTÊNCIA =====
function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error('Falha ao salvar:', e); }
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ===== UI =====
let state = null;

function renderAll() {
  document.getElementById('season').textContent = state.season;
  document.getElementById('round').textContent  = state.round;
  renderStandings();
  renderRound();
  renderHistory();
}

function renderStandings() {
  for (const div of ['div1', 'div2']) {
    const division = div === 'div1' ? 1 : 2;
    const standings = getStandings(state, division);
    const container = document.getElementById('standings-' + div);

    let html = `<thead><tr>
      <th>#</th><th>Time</th><th>País</th>
      <th>P</th><th>J</th><th>V</th><th>E</th><th>D</th>
      <th>GP</th><th>GC</th><th>SG</th>
    </tr></thead><tbody>`;

    standings.forEach((team, i) => {
      const pos = i + 1;
      let cls = '';
      if (division === 1 && pos <= 3) cls = 'promotion';
      else if (division === 1 && pos > standings.length - 3) cls = 'relegation';
      else if (division === 2 && pos <= 3) cls = 'promotion';

      const gd = team.stats.gd;
      html += `<tr class="${cls}">
        <td>${pos}</td>
        <td class="team-name">${team.name}</td>
        <td class="country">${team.country}</td>
        <td><b>${team.stats.pts}</b></td>
        <td>${team.stats.played}</td>
        <td>${team.stats.won}</td>
        <td>${team.stats.drawn}</td>
        <td>${team.stats.lost}</td>
        <td>${team.stats.gf}</td>
        <td>${team.stats.ga}</td>
        <td>${gd > 0 ? '+' + gd : gd}</td>
      </tr>`;
    });

    container.innerHTML = html + '</tbody>';
  }
}

function renderRound() {
  const container = document.getElementById('round-matches');
  if (state.round === 0) {
    container.innerHTML = '<p class="empty">Temporada não iniciada. Clique em "Simular Rodada".</p>';
    return;
  }
  const r = state.round - 1;
  const teamMap = Object.create(null);
  for (const t of state.teams) teamMap[t.id] = t;

  let html = '';
  for (const div of ['div1', 'div2']) {
    const divName  = div === 'div1' ? 'Divisão 1' : 'Divisão 2';
    const fixtures = state.fixtures[div][r];
    const results  = state.results[div][r];
    if (!fixtures || !results) continue;

    html += `<h3>${divName} — Rodada ${r + 1}</h3><div class="matches">`;
    fixtures.forEach((f, i) => {
      const home = teamMap[f.home];
      const away = teamMap[f.away];
      const res  = results[i];
      html += `<div class="match">
        <span class="home">${home.name}</span>
        <span class="score">${res.gH} - ${res.gA}</span>
        <span class="away">${away.name}</span>
      </div>`;
    });
    html += '</div>';
  }
  container.innerHTML = html;
}

function renderHistory() {
  const container = document.getElementById('history-content');
  if (state.history.length === 0) {
    container.innerHTML = '<p class="empty">Nenhuma temporada concluída ainda.</p>';
    return;
  }
  let html = '<div class="history-list">';
  state.history.slice().reverse().forEach(h => {
    html += `<div class="history-item">
      <h4>Temporada ${h.season}</h4>
      <p><b>Campeão Div 1:</b> ${h.div1Champion}</p>
      <p><b>Campeão Div 2:</b> ${h.div2Champion}</p>
      <p><b>Promovidos:</b> ${h.promoted.join(', ')}</p>
      <p><b>Rebaixados:</b> ${h.relegated.join(', ')}</p>
    </div>`;
  });
  container.innerHTML = html + '</div>';
}

// ===== AÇÕES =====
function simulateOne() {
  if (!simulateRound(state)) { alert('Temporada já concluída.'); return; }
  saveState(state);
  renderAll();
}
function simulateMany(n) {
  for (let i = 0; i < n; i++) if (!simulateRound(state)) break;
  saveState(state);
  renderAll();
}
function simulateAll() {
  while (simulateRound(state)) { /* roda tudo */ }
  saveState(state);
  renderAll();
}
function startNewSeason() {
  if (state.round === 0) { alert('A temporada ainda não começou.'); return; }

  if (state.round >= ROUNDS) {
    applySeasonEnd(state);
    resetForNewSeason(state);
  } else {
    if (!confirm('Temporada em andamento. Reiniciar do zero sem promoção/rebaixamento?')) return;
    // reinicia mantendo as divisões atuais
    state.teams.forEach(t => {
      t.stats = { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
      t.form  = [];
    });
    const div1 = state.teams.filter(t => t.division === 1);
    const div2 = state.teams.filter(t => t.division === 2);
    state.fixtures = { div1: generateCalendar(div1), div2: generateCalendar(div2) };
    state.results  = { div1: Array(ROUNDS).fill(null), div2: Array(ROUNDS).fill(null) };
    state.round = 0;
  }
  saveState(state);
  renderAll();
}
function exportState() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `football-manager-s${state.season}-r${state.round}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
function importState(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const loaded = JSON.parse(e.target.result);
      if (!loaded.teams || !loaded.fixtures) throw new Error('arquivo inválido');
      state = loaded;
      saveState(state);
      renderAll();
      alert('Estado importado!');
    } catch (err) { alert('Erro: ' + err.message); }
  };
  reader.readAsText(file);
}

// ===== INIT =====
function init() {
  state = loadState() || createInitialState();
  if (!localStorage.getItem(STORAGE_KEY)) saveState(state);

  document.getElementById('btnSim1').addEventListener('click', simulateOne);
  document.getElementById('btnSim5').addEventListener('click', () => simulateMany(5));
  document.getElementById('btnSimAll').addEventListener('click', simulateAll);
  document.getElementById('btnNew').addEventListener('click', startNewSeason);
  document.getElementById('btnExport').addEventListener('click', exportState);
  document.getElementById('btnImport').addEventListener('click', () => document.getElementById('fileImport').click());
  document.getElementById('fileImport').addEventListener('change', (e) => {
    if (e.target.files[0]) importState(e.target.files[0]);
    e.target.value = '';
  });

  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
