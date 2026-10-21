// ===== CONFIGURAÇÃO =====
const HOME_ADV       = 3;
const NOISE          = 3;
const K              = 0.032;
const BASE_GOALS     = 1.30;
const MAX_DIFF       = 26;
const MAX_GOALS      = 7;
const FORM_WEIGHT    = 2;
const ROUNDS         = 99;

const PROMOTED_COUNT   = 30;
const RELEGATED_COUNT  = 30;

const REP_UPDATE_ROUNDS = [20, 40, 60, 80, 99];
const REP_FACTOR        = 0.10;
const REP_CAP           = 2.0;

const DIVISIONS = ['div1', 'div2', 'div3'];
const STORAGE_KEY = 'football-manager-v2';   // bump → save antigo v1 é ignorado

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
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// ===== ESTADO =====
function createInitialState() {
  const teams = TEAMS_DATA.map((row, idx) => ({
    id: row[3],
    name: row[0],
    country: row[1],
    reputation: row[2],
    overall: +(row[2] * 10).toFixed(2),
    division: idx < 100 ? 1 : idx < 200 ? 2 : 3,
    form: [],
    lastRepDelta: 0,
    stats: { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 }
  }));

  return {
    season: 2025,
    round: 0,
    teams,
    fixtures: rebuildFixtures(teams),
    results:  emptyResults(),
    history: [],
    repLog: [],
    lastRepUpdateRound: 0
  };
}

function rebuildFixtures(teams) {
  const f = {};
  for (const div of DIVISIONS) {
    const n = div === 'div1' ? 1 : div === 'div2' ? 2 : 3;
    f[div] = generateCalendar(teams.filter(t => t.division === n));
  }
  return f;
}
function emptyResults() {
  const r = {};
  for (const div of DIVISIONS) r[div] = Array(ROUNDS).fill(null);
  return r;
}

// ===== CALENDÁRIO =====
function generateCalendar(teams) {
  const n = teams.length;
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
  return (pts / form.length - 1.5) * FORM_WEIGHT;
}

function simularPartida(h, a) {
  const formH = calcForm(h.form);
  const formA = calcForm(a.form);

  let diff = (h.overall + HOME_ADV + formH) - (a.overall + formA);
  diff += gauss() * NOISE;
  diff = clamp(diff, -MAX_DIFF, MAX_DIFF);

  const lamH = BASE_GOALS * Math.exp( K * diff);
  const lamA = BASE_GOALS * Math.exp(-K * diff);

  return {
    gH: Math.min(MAX_GOALS, poisson(lamH)),
    gA: Math.min(MAX_GOALS, poisson(lamA))
  };
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

// ===== REPUTAÇÃO =====
function expectedPts(myOvr, oppOvr, isHome) {
  const diff = myOvr - oppOvr + (isHome ? HOME_ADV : -HOME_ADV);
  const pWin  = 1 / (1 + Math.exp(-0.10 * diff));
  const pDraw = 0.25 * Math.exp(-0.015 * diff * diff);
  return 3 * pWin + pDraw;
}

function updateReputations(state) {
  const fromRound = state.lastRepUpdateRound || 0;
  const toRound = state.round;
  if (toRound - fromRound < 5) return;

  const teamMap = Object.create(null);
  for (const t of state.teams) teamMap[t.id] = t;

  const accum = Object.create(null);
  for (const t of state.teams) accum[t.id] = { actual: 0, expected: 0, games: 0 };

  for (let r = fromRound; r < toRound; r++) {
    for (const div of DIVISIONS) {
      const fixtures = state.fixtures[div][r];
      const results  = state.results[div][r];
      if (!fixtures || !results) continue;
      fixtures.forEach((f, i) => {
        const h = teamMap[f.home], a = teamMap[f.away], res = results[i];
        const hPts = res.gH > res.gA ? 3 : res.gH === res.gA ? 1 : 0;
        const aPts = res.gA > res.gH ? 3 : res.gH === res.gA ? 1 : 0;

        accum[h.id].actual   += hPts;
        accum[h.id].expected += expectedPts(h.overall, a.overall, true);
        accum[h.id].games++;

        accum[a.id].actual   += aPts;
        accum[a.id].expected += expectedPts(a.overall, h.overall, false);
        accum[a.id].games++;
      });
    }
  }

  const changes = [];
  for (const team of state.teams) {
    const acc = accum[team.id];
    if (acc.games < 3) continue;
    let delta = (acc.actual - acc.expected) * REP_FACTOR;
    delta = clamp(delta, -REP_CAP, REP_CAP);
    if (Math.abs(delta) < 0.02) { team.lastRepDelta = 0; continue; }
    const oldOvr = team.overall;
    team.overall = clamp(team.overall + delta, 60, 95);
    team.reputation = +(team.overall / 10).toFixed(3);
    team.lastRepDelta = team.overall - oldOvr;
    changes.push({ team: team.name, oldOvr, newOvr: team.overall, delta });
  }

  state.lastRepUpdateRound = toRound;
  state.repLog.push({ round: toRound, changes });
  if (state.repLog.length > 20) state.repLog.shift();
}

// ===== RODADA =====
function simulateRound(state) {
  if (state.round >= ROUNDS) return false;

  const teamMap = Object.create(null);
  for (const t of state.teams) teamMap[t.id] = t;

  const r = state.round;
  for (const div of DIVISIONS) {
    const fixtures = state.fixtures[div][r];
    const results  = new Array(fixtures.length);
    for (let i = 0; i < fixtures.length; i++) {
      const h = teamMap[fixtures[i].home];
      const a = teamMap[fixtures[i].away];
      const { gH, gA } = simularPartida(h, a);
      results[i] = { gH, gA };
      updateTeam(h, gH, gA);
      updateTeam(a, gA, gH);
    }
    state.results[div][r] = results;
  }

  state.round++;

  if (REP_UPDATE_ROUNDS.includes(state.round) &&
      state.round > (state.lastRepUpdateRound || 0)) {
    updateReputations(state);
  }
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

function getZoneClass(division, pos, total) {
  if (division === 1) return pos > total - RELEGATED_COUNT ? 'relegation' : '';
  if (division === 2) {
    if (pos <= PROMOTED_COUNT) return 'promotion';
    if (pos > total - RELEGATED_COUNT) return 'relegation';
    return '';
  }
  return pos <= PROMOTED_COUNT ? 'promotion' : '';
}

// ===== FIM DE TEMPORADA =====
function applySeasonEnd(state) {
  const d1 = getStandings(state, 1);
  const d2 = getStandings(state, 2);
  const d3 = getStandings(state, 3);

  const relegateToDiv2 = d1.slice(-RELEGATED_COUNT);   // div1 → div2
  const promoteToDiv1  = d2.slice(0, PROMOTED_COUNT);   // div2 → div1
  const relegateToDiv3 = d2.slice(-RELEGATED_COUNT);   // div2 → div3
  const promoteToDiv2  = d3.slice(0, PROMOTED_COUNT);   // div3 → div2

  state.history.push({
    season: state.season,
    div1Champion: d1[0].name,
    div2Champion: d2[0].name,
    div3Champion: d3[0].name,
    promotedToDiv1: promoteToDiv1.map(t => t.name),
    promotedToDiv2: promoteToDiv2.map(t => t.name),
    relegatedToDiv2: relegateToDiv2.map(t => t.name),
    relegatedToDiv3: relegateToDiv3.map(t => t.name)
  });

  // conjuntos disjuntos por divisão de origem → ordem não importa
  relegateToDiv2.forEach(t => t.division = 2);
  promoteToDiv1.forEach(t => t.division = 1);
  relegateToDiv3.forEach(t => t.division = 3);
  promoteToDiv2.forEach(t => t.division = 2);
}

function resetForNewSeason(state) {
  state.teams.forEach(t => {
    t.stats = { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
    t.form = [];
    t.lastRepDelta = 0;
  });
  state.fixtures = rebuildFixtures(state.teams);
  state.results  = emptyResults();
  state.round = 0;
  state.season++;
  state.lastRepUpdateRound = 0;
}

// ===== PERSISTÊNCIA =====
function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error('Falha ao salvar:', e); }
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (!state.teams || state.teams.length !== TEAMS_DATA.length) return null; // incompatível
    if (state.lastRepUpdateRound === undefined) state.lastRepUpdateRound = 0;
    if (!state.repLog) state.repLog = [];
    state.teams.forEach(t => { if (t.lastRepDelta === undefined) t.lastRepDelta = 0; });
    return state;
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
  for (const div of DIVISIONS) {
    const division = div === 'div1' ? 1 : div === 'div2' ? 2 : 3;
    const standings = getStandings(state, division);
    const container = document.getElementById('standings-' + div);

    let html = `<thead><tr>
      <th>#</th><th>Time</th><th>País</th><th>OVR</th>
      <th>P</th><th>J</th><th>V</th><th>E</th><th>D</th>
      <th>GP</th><th>GC</th><th>SG</th>
    </tr></thead><tbody>`;

    standings.forEach((team, i) => {
      const pos = i + 1;
      const cls = getZoneClass(division, pos, standings.length);
      const gd = team.stats.gd;
      const d  = team.lastRepDelta || 0;
      const arrow = d >  0.05 ? ' <span style="color:#4ade80;font-size:11px">▲</span>'
                  : d < -0.05 ? ' <span style="color:#ef4444;font-size:11px">▼</span>'
                  : '';
      html += `<tr class="${cls}">
        <td>${pos}</td>
        <td class="team-name">${team.name}</td>
        <td class="country">${team.country}</td>
        <td title="Reputação ${team.reputation.toFixed(3)}">${team.overall.toFixed(1)}${arrow}</td>
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
  for (const div of DIVISIONS) {
    const divName = div === 'div1' ? 'Divisão 1' : div === 'div2' ? 'Divisão 2' : 'Divisão 3';
    const fixtures = state.fixtures[div][r];
    const results  = state.results[div][r];
    if (!fixtures || !results) continue;

    html += `<h3>${divName} — Rodada ${r + 1}</h3><div class="matches">`;
    fixtures.forEach((f, i) => {
      const home = teamMap[f.home], away = teamMap[f.away], res = results[i];
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
  let html = '';

  if (state.repLog && state.repLog.length > 0) {
    html += '<h3>Atualizações de Reputação</h3><div class="history-list">';
    state.repLog.slice().reverse().forEach(entry => {
      const movers = entry.changes
        .slice()
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 10);
      if (movers.length === 0) return;
      html += `<div class="history-item"><h4>Após rodada ${entry.round}</h4>`;
      movers.forEach(m => {
        const up = m.delta > 0;
        const color = up ? '#4ade80' : '#ef4444';
        const arrow = up ? '▲' : '▼';
        html += `<p><span style="color:${color}">${arrow}</span> <b>${m.team}</b>: 
                 ${m.oldOvr.toFixed(1)} → ${m.newOvr.toFixed(1)} 
                 <span style="color:${color}">(${up ? '+' : ''}${m.delta.toFixed(2)})</span></p>`;
      });
      html += '</div>';
    });
    html += '</div>';
  }

  if (state.history.length > 0) {
    html += '<h3>Temporadas Concluídas</h3><div class="history-list">';
    state.history.slice().reverse().forEach(h => {
      html += `<div class="history-item">
        <h4>Temporada ${h.season}</h4>
        <p><b>Campeão Div 1:</b> ${h.div1Champion}</p>
        <p><b>Campeão Div 2:</b> ${h.div2Champion}</p>
        <p><b>Campeão Div 3:</b> ${h.div3Champion}</p>
        <p><b>Sobem para Div 1 (${h.promotedToDiv1.length}):</b> ${h.promotedToDiv1.join(', ')}</p>
        <p><b>Sobem para Div 2 (${h.promotedToDiv2.length}):</b> ${h.promotedToDiv2.join(', ')}</p>
        <p><b>Caem para Div 2 (${h.relegatedToDiv2.length}):</b> ${h.relegatedToDiv2.join(', ')}</p>
        <p><b>Caem para Div 3 (${h.relegatedToDiv3.length}):</b> ${h.relegatedToDiv3.join(', ')}</p>
      </div>`;
    });
    html += '</div>';
  }

  if (html === '') html = '<p class="empty">Nenhuma atualização ainda.</p>';
  container.innerHTML = html;
}

// ===== AÇÕES =====
function simulateOne() {
  if (!simulateRound(state)) { alert('Temporada já concluída.'); return; }
  saveState(state); renderAll();
}
function simulateMany(n) {
  for (let i = 0; i < n; i++) if (!simulateRound(state)) break;
  saveState(state); renderAll();
}
function simulateAll() {
  while (simulateRound(state)) { /* roda tudo */ }
  saveState(state); renderAll();
}
function startNewSeason() {
  if (state.round === 0) { alert('A temporada ainda não começou.'); return; }

  if (state.round >= ROUNDS) {
    applySeasonEnd(state);
    resetForNewSeason(state);
  } else {
    if (!confirm('Temporada em andamento. Reiniciar do zero?')) return;
    state.teams.forEach(t => {
      t.stats = { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
      t.form = [];
      t.lastRepDelta = 0;
    });
    state.fixtures = rebuildFixtures(state.teams);
    state.results  = emptyResults();
    state.round = 0;
    state.lastRepUpdateRound = 0;
  }
  saveState(state); renderAll();
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
      if (loaded.teams.length !== TEAMS_DATA.length)
        throw new Error(`arquivo tem ${loaded.teams.length} times, esperado ${TEAMS_DATA.length}`);
      if (loaded.lastRepUpdateRound === undefined) loaded.lastRepUpdateRound = 0;
      if (!loaded.repLog) loaded.repLog = [];
      loaded.teams.forEach(t => { if (t.lastRepDelta === undefined) t.lastRepDelta = 0; });
      state = loaded;
      saveState(state); renderAll();
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
