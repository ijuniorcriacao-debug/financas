'use strict';
/* Finanças da Casa — app sem dependências. Valores sempre em centavos (inteiros). */

const KEY = 'financas-casa-v1';
const NATURES = { fixa: 'Fixa', variavel: 'Variável', esporadica: 'Esporádica' };
const DEFAULT_CATS = [
  { id: 'moradia', name: 'Moradia', emoji: '🏠', essential: true },
  { id: 'contas', name: 'Contas (luz, água, internet)', emoji: '💡', essential: true },
  { id: 'mercado', name: 'Mercado', emoji: '🛒', essential: true },
  { id: 'transporte', name: 'Transporte', emoji: '🚗', essential: true },
  { id: 'saude', name: 'Saúde', emoji: '🩺', essential: true },
  { id: 'educacao', name: 'Educação', emoji: '📚', essential: true },
  { id: 'dividas', name: 'Dívidas e parcelas', emoji: '🧾', essential: true },
  { id: 'delivery', name: 'Restaurantes e delivery', emoji: '🍔', essential: false },
  { id: 'lazer', name: 'Lazer', emoji: '🎉', essential: false },
  { id: 'assinaturas', name: 'Assinaturas', emoji: '📺', essential: false },
  { id: 'compras', name: 'Compras e roupas', emoji: '🛍️', essential: false },
  { id: 'cuidados', name: 'Cuidados pessoais', emoji: '💇', essential: false },
  { id: 'esporte', name: 'Academia e esporte', emoji: '🏋️', essential: false },
  { id: 'pets', name: 'Pets', emoji: '🐶', essential: true },
  { id: 'presentes', name: 'Presentes e doações', emoji: '🎁', essential: false },
  { id: 'outros', name: 'Outros', emoji: '📦', essential: false },
];

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brl0 = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pct = (x) => (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const num = (n) => (n / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseMoney(str) {
  let s = String(str ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = parseFloat(s);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
}

/* ---------- datas ---------- */
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ymOf = (dateStr) => dateStr.slice(0, 7);
function shiftYm(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
const daysIn = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); };
const monthShort = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''); };
const dayLabel = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
function addMonthsToDate(dateStr, n) {
  const ym = shiftYm(ymOf(dateStr), n);
  return `${ym}-${pad(Math.min(+dateStr.slice(8, 10), daysIn(ym)))}`;
}

/* ---------- estado ---------- */
function defaultState() {
  return {
    v: 1,
    setup: false,
    who: 'casa',
    people: [{ name: 'Pessoa 1', income: 0 }, { name: 'Pessoa 2', income: 0 }],
    savingsPct: 20,
    cats: DEFAULT_CATS.map((c) => ({ ...c, budget: 0 })),
    tx: [],
    tpl: [],
  };
}
const CFG = window.SUPABASE_CONFIG || {};
const CLOUD = !!(CFG.url && CFG.key);
let S = CLOUD ? defaultState() : load();
let ui = { tab: 'resumo', who: !CLOUD && (S.who === 0 || S.who === 1) ? S.who : 'casa', ym: todayStr().slice(0, 7), q: '', cat: '', nat: '' };

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch (e) { /* storage indisponível: segue com estado vazio */ }
  return defaultState();
}
function save() {
  if (CLOUD) { cloudCacheWrite(); cloudSchedule(); return; }
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Não foi possível salvar neste navegador'); }
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200);
}

/* ---------- cálculos ---------- */
const cat = (id) => S.cats.find((c) => c.id === id) || { id, name: id || 'Sem categoria', emoji: '📦', essential: false };
const pName = (i) => (i === 'joint' ? 'Conta conjunta' : S.people[i].name);

/** Proporção de cada um no total da renda — base da divisão justa. */
function ratio() {
  const a = S.people[0].income, b = S.people[1].income;
  if (a + b <= 0) return [0.5, 0.5];
  return [a / (a + b), b / (a + b)];
}
const monthTx = (ym) => S.tx.filter((t) => t.date.startsWith(ym));
const isPersonal = (t) => t.kind === 'despesa' && t.split === 'personal';
/** Tudo que é do casal: gastos pessoais ficam de fora. */
const houseTx = (ym) => monthTx(ym).filter((t) => !isPersonal(t));
const personalTx = (ym, i) => monthTx(ym).filter((t) => isPersonal(t) && t.payer === i);
/** Gasto pessoal "só meu" só aparece para o dono; os demais, também para o parceiro (somente leitura). */
const canSee = (t, who) => !isPersonal(t) || (who !== 'casa' && (t.payer === who || t.vis !== 'private'));
const expenses = (list) => list.filter((t) => t.kind === 'despesa');
const sum = (list) => list.reduce((s, t) => s + t.cents, 0);

function monthIncome(ym) {
  const extras = monthTx(ym).filter((t) => t.kind === 'receita');
  const base = [S.people[0].income, S.people[1].income];
  const ext = [0, 1].map((i) => sum(extras.filter((t) => t.payer === i)));
  return { base, ext, person: [base[0] + ext[0], base[1] + ext[1]], total: base[0] + base[1] + ext[0] + ext[1] };
}

/** Acerto de contas: quanto cada um pagou a mais/menos do que a sua parte justa. */
function settlement(ym) {
  const r = ratio();
  const list = monthTx(ym);
  const shared = expenses(list).filter((t) => t.split === 'shared');
  const total = sum(shared);
  const fair = [total * r[0], total * r[1]];
  const paid = [0, 0];
  let joint = 0;
  shared.forEach((t) => {
    if (t.payer === 'joint') { joint += t.cents; paid[0] += t.cents * r[0]; paid[1] += t.cents * r[1]; }
    else paid[t.payer] += t.cents;
  });
  const net = [paid[0] - fair[0], paid[1] - fair[1]];
  const acertos = list.filter((t) => t.kind === 'acerto');
  acertos.forEach((t) => { net[t.payer] += t.cents; net[1 - t.payer] -= t.cents; });
  const debtor = net[0] < -50 ? 0 : net[1] < -50 ? 1 : null;
  const owes = debtor === null ? 0 : Math.round(-net[debtor]);
  return { r, total, fair, paid, net, joint, debtor, owes, acertos, fiftyFifty: [total / 2, total / 2] };
}


function byCategory(list) {
  const m = {};
  expenses(list).forEach((t) => { m[t.cat] = (m[t.cat] || 0) + t.cents; });
  return Object.entries(m).map(([id, cents]) => ({ id, cents })).sort((a, b) => b.cents - a.cents);
}

function ensureFixed(ym) {
  let changed = false;
  S.tpl.filter((t) => t.active && ym >= t.start).forEach((t) => {
    if (S.tx.some((x) => x.tplId === t.id && x.date.startsWith(ym))) return;
    S.tx.push({
      id: `${t.id}-${ym}`, kind: 'despesa', date: `${ym}-${pad(Math.min(t.day, daysIn(ym)))}`, desc: t.desc, cents: t.cents,
      cat: t.cat, nature: 'fixa', payer: t.payer, split: t.split, vis: t.vis, paid: false, tplId: t.id,
    });
    changed = true;
  });
  if (changed) save();
}

/* ---------- render ---------- */
function render() {
  document.body.classList.remove('gate');
  if (CLOUD && ui.who !== 'casa' && ui.who !== S.me) ui.who = 'casa';
  if (!S.setup && !CLOUD) { openSetup(); }
  ensureFixed(ui.ym);
  const views = { resumo: viewResumo, lanc: () => viewLanc('Lançamentos'), divisao: viewDivisao, plano: viewPlano, ajustes: viewAjustes, meu: viewMeu, meus: () => viewLanc('Meus gastos') };
  if (!tabsFor().some((t) => t[0] === ui.tab)) ui.tab = tabsFor()[0][0];
  $('#view').innerHTML = offlineBanner() + whoBar() + views[ui.tab]();
  if (ui.tab === 'lanc' || ui.tab === 'meus') renderList();
  renderTabs();
  $('#fab').style.display = ui.tab === 'ajustes' ? 'none' : '';
}
const ICON = {
  resumo: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  lanc: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
  divisao: '<path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
  plano: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  ajustes: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  meu: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  meus: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const tabsFor = () => (ui.who === 'casa'
  ? [['resumo', 'resumo', 'Resumo'], ['lanc', 'lanc', 'Lançamentos'], ['divisao', 'divisao', 'Divisão'], ['plano', 'plano', 'Plano'], ['ajustes', 'ajustes', 'Ajustes']]
  : [['meu', 'meu', 'Meu resumo'], ['meus', 'meus', 'Meus gastos'], ['ajustes', 'ajustes', 'Ajustes']]);
function whoBar() {
  const opts = CLOUD ? [['casa', 'Casa', 'home'], [S.me, S.people[S.me].name, 'p' + S.me]]
    : [['casa', 'Casa', 'home'], [0, S.people[0].name, 'p0'], [1, S.people[1].name, 'p1']];
  return `<div class="whobar" role="tablist">${opts.map(([v, l, dot]) => `<button data-a="who" data-v="${v}" class="${ui.who === v ? 'on' : ''}"><span class="who-dot ${dot}"></span><span class="ellipsis">${esc(l)}</span></button>`).join('')}</div>`;
}
function renderTabs() {
  const tabs = tabsFor();
  $('#tabs').innerHTML = tabs.map(([id, ic, l]) => `<button data-a="tab" data-v="${id}" class="${ui.tab === id ? 'on' : ''}" ${ui.tab === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></button>`).join('');
}
function monthHeader(title) {
  return `<div class="header"><div><div class="eyebrow">${ui.who === 'casa' ? 'Finanças da casa' : 'Só meu'}</div><h1>${title}</h1></div><div class="month">
    <button class="icon" data-a="month" data-v="-1" aria-label="Mês anterior">‹</button>
    <b>${monthLabel(ui.ym)}</b>
    <button class="icon" data-a="month" data-v="1" aria-label="Próximo mês">›</button></div></div>`;
}
const bar = (value, max, over) => `<div class="bar ${over ? 'over' : ''}"><i style="width:${max > 0 ? Math.min(100, (value / max) * 100) : 0}%"></i></div>`;

/* ----- Resumo ----- */
function viewResumo() {
  const list = houseTx(ui.ym), exp = expenses(list), spent = sum(exp);
  const inc = monthIncome(ui.ym), left = inc.total - spent;
  const goal = Math.round(inc.total * S.savingsPct / 100);
  const used = inc.total > 0 ? spent / inc.total : 0;
  const nat = { fixa: 0, variavel: 0, esporadica: 0 };
  exp.forEach((t) => { nat[t.nature] = (nat[t.nature] || 0) + t.cents; });
  const pending = sum(exp.filter((t) => t.nature === 'fixa' && !t.paid));
  const cats = byCategory(list);
  const top = cats[0] ? cats[0].cents : 0;

  const months = [-5, -4, -3, -2, -1, 0].map((d) => shiftYm(ui.ym, d));
  const data = months.map((m) => ({ m, inc: monthIncome(m).total, exp: sum(expenses(houseTx(m))) }));
  const maxV = Math.max(1, ...data.map((d) => Math.max(d.inc, d.exp)));

  const teto = inc.total - goal;
  const sev = used > 1 ? 'bad' : spent > teto ? 'warn' : '';
  const capPos = inc.total > 0 ? Math.min(100, (teto / inc.total) * 100) : 100;
  const natTotal = Object.values(nat).reduce((x, y) => x + y, 0);
  const trendMax = niceMax(Math.max(...data.map((d) => Math.max(d.inc, d.exp))));
  const trendCols = data.map((d, i) => `<div class="col ${i === data.length - 1 ? 'now' : ''}" title="${esc(monthLabel(d.m))}: receita ${brl(d.inc)} · despesa ${brl(d.exp)}">
      <div class="pair"><i class="inc" style="height:${(d.inc / trendMax) * 100}%"></i><i class="exp" style="height:${(d.exp / trendMax) * 100}%"></i></div><div class="mo">${monthShort(d.m)}</div></div>`).join('');

  return `${monthHeader('Resumo')}
  <div class="hero"><div class="lbl">${left >= 0 ? 'Sobra depois das contas da casa' : 'Faltou para cobrir a casa'}</div>
    <div class="fig ${left >= 0 ? '' : 'bad'}">${brl(left)}</div>
    <div class="sub"><span class="pill ${left >= goal ? 'good' : 'warn'}">${left >= goal ? 'Meta de guardar atingida' : `Faltam ${brl(goal - Math.max(left, 0))} para a meta`}</span>
      <span style="margin-left:6px">Meta: <b>${brl(goal)}</b> (${S.savingsPct}% da renda)</span></div></div>

  <div class="kpis">
    <div><div class="l">Receitas</div><div class="v">${brl0(inc.total)}</div></div>
    <div><div class="l">Despesas</div><div class="v">${brl0(spent)}</div></div>
    <div><div class="l">Fixas a pagar</div><div class="v ${pending ? 'warn' : ''}">${brl0(pending)}</div></div>
  </div>

  <div class="meterbox"><div class="row"><b>Renda comprometida</b><span class="num ${sev}">${pct(used)}</span></div>
    <div class="meter ${sev}" role="img" aria-label="${pct(used)} da renda comprometida; o traço marca o teto de ${brl0(teto)}"><i style="width:${Math.min(100, used * 100)}%"></i><span class="cap" style="left:calc(${capPos}% - 1px)"></span></div>
    <div class="muted">O traço marca o teto de gastos (${brl0(teto)}) para conseguir guardar ${S.savingsPct}%.</div></div>

  <h2>Tipo de gasto</h2>
  <div class="stack" role="img" aria-label="Fixas, variáveis e esporádicas">${['fixa', 'variavel', 'esporadica'].map((k, i) => (nat[k] ? `<i class="n${i}" style="flex:${nat[k]}"></i>` : '')).join('')}${natTotal ? '' : '<i style="flex:1;background:var(--track)"></i>'}</div>
  <div class="legend3">${['fixa', 'variavel', 'esporadica'].map((k, i) => `<div class="it"><div class="k"><span class="sw n${i}"></span>${NATURES[k]}s</div><div class="v">${brl0(nat[k] || 0)}</div><div class="p">${natTotal ? pct((nat[k] || 0) / natTotal) : '0%'}</div></div>`).join('')}</div>

  <h2>Para onde foi o dinheiro</h2>
  ${cats.length ? cats.map((c) => {
    const k = cat(c.id);
    return `<div class="cat"><div class="top"><span class="glyph">${k.emoji}</span><span class="nm">${esc(k.name)}${k.essential ? '' : '<span class="tag">flexível</span>'}</span><span class="am">${brl(c.cents)}</span><span class="pc">${pct(c.cents / spent)}</span></div>${bar(c.cents, top)}</div>`;
  }).join('') : '<div class="empty">Nenhum gasto neste mês ainda.<br>Toque em Lançar para começar.</div>'}

  <h2>Onde dá para apertar</h2>${insights(list, houseTx(shiftYm(ui.ym, -1)), inc.total, true)}
  <p class="muted">Aqui entram só as contas da casa. Gastos pessoais (academia, hobbies…) ficam na tela de cada um.</p>

  <h2>Últimos 6 meses</h2>
  <div class="trendbox"><div class="trend" role="img" aria-label="Receita e despesa da casa nos últimos 6 meses">
      <div class="grid"><span style="top:0"><b>${compactBrl(trendMax)}</b></span><span style="top:50%"><b>${compactBrl(trendMax / 2)}</b></span></div>${trendCols}</div>
    <div class="legend"><span><span class="sw" style="background:var(--track)"></span>Receita</span><span><span class="sw" style="background:var(--brand)"></span>Despesa da casa</span></div>
    <details class="tbl"><summary>Ver valores</summary><table><tr><th>Mês</th><th>Receita</th><th>Despesa</th></tr>${data.map((d) => `<tr><td>${esc(monthLabel(d.m))}</td><td>${brl(d.inc)}</td><td>${brl(d.exp)}</td></tr>`).join('')}</table></details></div>`;
}
const niceMax = (v) => { if (v <= 0) return 100000; const p = 10 ** Math.floor(Math.log10(v)); const m = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => x * p >= v); return m * p; };
const compactBrl = (c) => { const v = c / 100; return v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(Math.round(v)); };

function insights(list, prevList, incTotal, useBudgets) {
  const exp = expenses(list), spent = sum(exp);
  const prev = byCategory(prevList);
  const out = [];
  if (!exp.length) return '<div class="empty">As dicas aparecem quando houver lançamentos.</div>';

  const flex = exp.filter((t) => !cat(t.cat).essential);
  const flexSum = sum(flex);
  if (flexSum > 0) {
    const cut = Math.round(flexSum * 0.2);
    out.push(['', `Gastos <b>flexíveis</b> (não essenciais) somam <b>${brl(flexSum)}</b> (${pct(flexSum / spent)} do total). Cortar 20% deles libera <b>${brl(cut)}/mês</b> — ${brl(cut * 12)} por ano.`]);
  }
  byCategory(list).forEach((c) => {
    const k = cat(c.id), p = (prev.find((x) => x.id === c.id) || { cents: 0 }).cents;
    if (p > 0 && c.cents > p * 1.2 && c.cents - p >= 5000) out.push(['warn', `<b>${esc(k.name)}</b> subiu ${pct((c.cents - p) / p)} vs. mês passado (${brl(p)} → ${brl(c.cents)}).`]);
    if (useBudgets && k.budget > 0 && c.cents > k.budget) out.push(['bad', `<b>${esc(k.name)}</b> estourou o orçamento em ${brl(c.cents - k.budget)}.`]);
  });
  const subs = sum(exp.filter((t) => t.cat === 'assinaturas'));
  if (subs > 0) out.push(['', `Assinaturas custam <b>${brl(subs)}/mês</b> (${brl(subs * 12)} por ano). Vale revisar o que realmente usam.`]);
  const biggest = [...exp].sort((a, b) => b.cents - a.cents).slice(0, 3);
  out.push(['', `Maiores gastos: ${biggest.map((t) => `${esc(t.desc)} (${brl(t.cents)})`).join(', ')}.`]);
  if (incTotal > 0 && spent > incTotal) out.push(['bad', `Os gastos passaram a renda em <b>${brl(spent - incTotal)}</b>. Foque primeiro nas categorias flexíveis acima.`]);
  return out.map(([c, h]) => `<div class="insight ${c}">${h}</div>`).join('');
}

/* ----- Tela de cada pessoa ----- */
function viewMeu() {
  const i = ui.who, p = S.people[i], o = S.people[1 - i];
  const inc = monthIncome(ui.ym), s = settlement(ui.ym);
  const mine = personalTx(ui.ym, i), spent = sum(mine), income = inc.person[i], fair = s.fair[i];
  const left = income - fair - spent, goal = Math.round(income * S.savingsPct / 100);
  const cats = byCategory(mine), top = cats[0] ? cats[0].cents : 0;
  const shared = personalTx(ui.ym, 1 - i).filter((t) => t.vis !== 'private');
  const acerto = s.debtor === null ? '' : s.debtor === i
    ? `<div class="insight warn">Pelo acerto da casa, você ainda deve transferir <b>${brl(s.owes)}</b> para ${esc(o.name)}.</div>`
    : `<div class="insight">Pelo acerto da casa, ${esc(o.name)} deve transferir <b>${brl(s.owes)}</b> para você.</div>`;
  return `${monthHeader('Olá, ' + esc(p.name))}
  <div class="card big"><div class="muted">${left >= 0 ? 'Sobra pra você no mês' : 'Faltou no mês'}</div>
    <div class="v ${left >= 0 ? 'good' : 'bad'}">${brl(left)}</div>
    <div class="muted">Meta de guardar (${S.savingsPct}%): ${brl(goal)} ${left >= goal ? 'meta atingida' : `— faltam ${brl(goal - Math.max(left, 0))}`}</div></div>
  <div class="card"><table>
    <tr><td>Sua renda</td><td>${brl(income)}</td></tr>
    <tr><td>Sua parte da casa (${pct(s.r[i])})</td><td>− ${brl(fair)}</td></tr>
    <tr><td>Seus gastos pessoais</td><td>− ${brl(spent)}</td></tr>
    <tr><td><b>Sobra</b></td><td class="${left >= 0 ? 'good' : 'bad'}"><b>${brl(left)}</b></td></tr></table></div>
  ${acerto}
  <h2>Seus gastos pessoais</h2>
  <div class="card">${cats.length ? cats.map((c) => { const k = cat(c.id);
    return `<div class="cat"><div class="top"><span>${k.emoji} ${esc(k.name)}</span><b>${brl(c.cents)} <span class="muted">${pct(c.cents / spent)}</span></b></div>${bar(c.cents, top)}</div>`; }).join('')
    : '<div class="empty">Nenhum gasto pessoal neste mês.<br>Toque no + e escolha "Só meu".</div>'}</div>
  ${spent ? `<h2>Onde dá para apertar</h2>${insights(mine, personalTx(shiftYm(ui.ym, -1), i), income, false)}` : ''}
  ${shared.length ? `<h2>Compartilhado por ${esc(o.name)}</h2><p class="muted">Gastos pessoais que ${esc(o.name)} deixou visíveis para você (${brl(sum(shared))} no mês). Veja em "Meus gastos".</p>` : ''}
  <p class="muted">Privacidade: "só meu" esconde o gasto na tela do parceiro, mas os dados ficam no mesmo aparelho e no arquivo de backup.</p>`;
}

/* ----- Lançamentos ----- */
function viewLanc(title) {
  return `${monthHeader(title)}
  ${importCard()}
  <div class="filters">
    <input id="f-q" placeholder="Buscar…" value="${esc(ui.q)}" data-c="filter">
    <select id="f-cat" data-c="filter"><option value="">Categorias</option>${S.cats.map((c) => `<option value="${c.id}" ${ui.cat === c.id ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}</select>
    <select id="f-nat" data-c="filter"><option value="">Tipos</option>${Object.entries(NATURES).map(([k, l]) => `<option value="${k}" ${ui.nat === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </div>
  <div class="card" id="txlist"></div>`;
}
function txSource() {
  if (ui.who === 'casa') return houseTx(ui.ym);
  return monthTx(ui.ym).filter((t) => (isPersonal(t) && canSee(t, ui.who)) || (t.kind === 'receita' && t.payer === ui.who));
}
function renderList() {
  const el = $('#txlist');
  if (!el) return;
  const q = ui.q.toLowerCase();
  const list = txSource()
    .filter((t) => (!ui.cat || t.cat === ui.cat) && (!ui.nat || t.nature === ui.nat) && (!q || t.desc.toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!list.length) { el.innerHTML = '<div class="empty">Nada por aqui. Toque em Lançar para registrar um gasto.</div>'; return; }
  const total = sum(expenses(list).filter((t) => !isPersonal(t) || t.payer === ui.who));
  el.innerHTML = `<div class="muted">${list.length} lançamentos · ${ui.who === 'casa' ? 'despesas' : 'seus gastos'} ${brl(total)} · toque em um lançamento para editar ou excluir</div>` + list.map((t) => {
    const k = t.kind === 'despesa' ? cat(t.cat) : { emoji: t.kind === 'receita' ? '+' : '⇄' };
    const sign = t.kind === 'despesa' ? '−' : '+';
    const mine = !isPersonal(t) || t.payer === ui.who;
    const who = t.kind === 'despesa'
      ? `<span class="pdot" style="background:${t.payer === 'joint' ? 'var(--ink-2)' : `var(--p${t.payer})`}"></span>${esc(pName(t.payer))} · ${t.split === 'shared' ? 'casa' : t.vis === 'private' ? 'só meu' : 'pessoal'}`
      : `<span class="pdot" style="background:var(--p${t.payer})"></span>${esc(pName(t.payer))}`;
    return `<div class="tx ${mine ? 'editable' : ''} ${t.nature === 'fixa' && !t.paid ? 'paid-no' : ''}" ${mine ? `data-a="edit-tx" data-v="${t.id}" role="button" tabindex="0" aria-label="Editar ${esc(t.desc)}"` : ''}>
      <div class="emo">${k.emoji}</div>
      <div class="grow">
        <div class="ellipsis"><b>${esc(t.desc)}</b></div>
        <div class="meta">${dayLabel(t.date)} · ${who}${t.kind === 'despesa' ? ` · <span class="tag">${NATURES[t.nature]}</span>` : ''}</div></div>
      <div style="text-align:right"><div class="amt ${t.kind === 'despesa' ? '' : 'good'}">${sign}&nbsp;${brl(t.cents)}</div>
        ${t.nature === 'fixa' && t.kind === 'despesa' && mine ? `<label class="chk"><input type="checkbox" data-c="paid" data-v="${t.id}" ${t.paid ? 'checked' : ''}> pago</label>` : ''}</div>
    </div>`;
  }).join('');
}

/* ----- Divisão ----- */
function viewDivisao() {
  const s = settlement(ui.ym), [a, b] = S.people, inc = monthIncome(ui.ym);
  const result = s.debtor === null
    ? `<div class="v good">Tudo certo</div><div class="muted">Ninguém deve nada neste mês.</div>`
    : `<div class="muted">Para ficar justo</div><div class="v">${esc(S.people[s.debtor].name)} transfere</div><div class="v bad">${brl(s.owes)}</div><div class="muted">para ${esc(S.people[1 - s.debtor].name)}</div>
       <p><button class="primary" data-a="settle">Registrar acerto feito</button></p>`;
  const sal = S.people[0].income + S.people[1].income;
  return `${monthHeader('Divisão justa')}
  <div class="card"><h3>Proporção pela renda</h3>
    <div class="bar split"><i style="width:${s.r[0] * 100}%"></i><i style="width:${s.r[1] * 100}%"></i></div>
    <div class="row" style="margin-top:6px"><span><span class="pdot" style="background:var(--p0)"></span><b>${esc(a.name)}</b> ${pct(s.r[0])}</span><span><b>${esc(b.name)}</b> ${pct(s.r[1])} <span class="pdot" style="background:var(--p1)"></span></span></div>
    <p class="muted">${sal ? `Cada despesa dividida é repartida assim: quem ganha mais paga mais, na mesma proporção da renda (${brl0(a.income)} e ${brl0(b.income)}).` : 'Configure as rendas em Ajustes para calcular a divisão.'}</p></div>

  <div class="card big">${result}</div>

  <div class="card"><h3>Despesas divididas do mês: ${brl(s.total)}</h3>
    <table><tr><th></th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr>
      <tr><td>Parte justa</td><td>${brl(s.fair[0])}</td><td>${brl(s.fair[1])}</td></tr>
      <tr><td>Já pagou</td><td>${brl(s.paid[0])}</td><td>${brl(s.paid[1])}</td></tr>
      <tr><td>Se fosse 50/50</td><td>${brl(s.fiftyFifty[0])}</td><td>${brl(s.fiftyFifty[1])}</td></tr>
      <tr><td>Diferença p/ 50/50</td><td class="${s.fair[0] < s.fiftyFifty[0] ? 'good' : 'bad'}">${brl(s.fair[0] - s.fiftyFifty[0])}</td><td class="${s.fair[1] < s.fiftyFifty[1] ? 'good' : 'bad'}">${brl(s.fair[1] - s.fiftyFifty[1])}</td></tr>
    </table></div>
  ${s.joint > 0 ? `<div class="card"><h3>Conta conjunta</h3><p>Gastos pagos pela conta conjunta: <b>${brl(s.joint)}</b>. Aporte proporcional: <b>${esc(a.name)} ${brl(s.joint * s.r[0])}</b> · <b>${esc(b.name)} ${brl(s.joint * s.r[1])}</b>.</p></div>` : ''}

  <h2>Visão por pessoa</h2><p class="muted">Sem os gastos pessoais — cada um vê os seus na própria tela.</p>
  <div class="card"><table><tr><th></th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr>
    <tr><td>Renda do mês</td><td>${brl(inc.person[0])}</td><td>${brl(inc.person[1])}</td></tr>
    <tr><td>Parte das divididas</td><td>${brl(s.fair[0])}</td><td>${brl(s.fair[1])}</td></tr>
    <tr><td><b>Sobra após a casa</b></td>${[0, 1].map((i) => { const left = inc.person[i] - s.fair[i]; return `<td class="${left >= 0 ? 'good' : 'bad'}"><b>${brl(left)}</b></td>`; }).join('')}</tr>
    <tr><td>Meta de guardar</td>${[0, 1].map((i) => `<td>${brl(inc.person[i] * S.savingsPct / 100)}</td>`).join('')}</tr></table></div>
  ${s.acertos.length ? `<h2>Acertos registrados</h2><div class="card">${s.acertos.map((t) => `<div class="tx editable" data-a="edit-tx" data-v="${t.id}" role="button" tabindex="0"><div class="emo">⇄</div><div class="grow"><b>${esc(pName(t.payer))} → ${esc(pName(1 - t.payer))}</b><div class="muted">${dayLabel(t.date)}</div></div><div class="amt">${brl(t.cents)}</div></div>`).join('')}</div>` : ''}`;
}

/* ----- Plano ----- */
function viewPlano() {
  const inc = monthIncome(ui.ym), exp = expenses(houseTx(ui.ym)), spent = sum(exp);
  const goal = Math.round(inc.total * S.savingsPct / 100), cap = inc.total - goal;
  const essential = sum(exp.filter((t) => cat(t.cat).essential)), flex = spent - essential;
  const isNow = ui.ym === todayStr().slice(0, 7);
  const daysLeft = isNow ? daysIn(ui.ym) - new Date().getDate() + 1 : 0;
  const rest = cap - spent;
  const byCat = Object.fromEntries(byCategory(houseTx(ui.ym)).map((c) => [c.id, c.cents]));
  return `${monthHeader('Plano')}
  <div class="card"><h3>Quanto guardar por mês</h3>
    <div class="row"><input type="range" min="0" max="50" step="1" value="${S.savingsPct}" data-c="savings" style="flex:1"><b id="sv-pct">${S.savingsPct}%</b></div>
    <table style="margin-top:8px"><tr><th></th><th>Guardar</th><th>Pode gastar</th></tr>
      ${S.people.map((p, i) => `<tr><td><span class="pdot" style="background:var(--p${i})"></span>${esc(p.name)}</td><td>${brl(inc.person[i] * S.savingsPct / 100)}</td><td>${brl(inc.person[i] * (100 - S.savingsPct) / 100)}</td></tr>`).join('')}
      <tr><td><b>Casal</b></td><td><b>${brl(goal)}</b></td><td><b>${brl(cap)}</b></td></tr></table>
    <p class="muted">Guardar a mesma % da renda de cada um mantém o esforço justo. Em um ano: <b>${brl(goal * 12)}</b>.</p></div>

  <div class="card"><h3>Teto de gastos da casa no mês</h3>
    <div class="row"><span>Gasto: <b>${brl(spent)}</b></span><span>Teto: <b>${brl(cap)}</b></span></div>${bar(spent, cap, spent > cap)}
    <p class="${rest >= 0 ? 'good' : 'bad'}"><b>${rest >= 0 ? `Ainda pode gastar ${brl(rest)}` : `Passou do teto em ${brl(-rest)}`}</b>${isNow && rest > 0 && daysLeft ? ` — cerca de ${brl(rest / daysLeft)} por dia até o fim do mês.` : ''}</p></div>

  <div class="card"><h3>Essencial × flexível</h3>
    <div class="grid2"><div><div class="muted">Essenciais</div><b>${brl(essential)}</b><div class="muted">${inc.total ? pct(essential / inc.total) : '0%'} da renda (ideal até ~50%)</div></div>
    <div><div class="muted">Flexíveis</div><b>${brl(flex)}</b><div class="muted">${inc.total ? pct(flex / inc.total) : '0%'} da renda (ideal até ~30%)</div></div></div></div>

  <h2>Orçamento por categoria</h2>
  <div class="card">${S.cats.map((c) => {
    const v = byCat[c.id] || 0;
    return `<div class="cat"><div class="top"><span>${c.emoji} ${esc(c.name)}</span><b>${brl0(v)} ${c.budget ? `/ ${brl0(c.budget)}` : ''}</b></div>
      ${c.budget ? bar(v, c.budget, v > c.budget) : ''}
      <input inputmode="decimal" placeholder="Limite mensal (R$)" value="${c.budget ? num(c.budget) : ''}" data-c="budget" data-v="${c.id}" style="margin-top:6px;padding:6px 10px;font-size:.85rem"></div>`;
  }).join('')}</div>`;
}

/* ----- Ajustes ----- */
function viewAjustes() {
  const fx = S.tpl.filter((t) => (ui.who === 'casa' ? t.split === 'shared' : t.split === 'personal' && t.payer === ui.who)).sort((a, b) => a.day - b.day);
  return `<div class="header"><h1>Ajustes</h1></div>
  ${peopleCard()}

  <div class="card"><div class="row"><h3>${ui.who === 'casa' ? 'Contas fixas da casa' : 'Minhas contas fixas'}</h3><button class="primary" data-a="new-tpl">+ Nova</button></div>
    <p class="muted">${ui.who === 'casa' ? 'Aluguel, internet, escola…' : 'Sua academia, plano do celular…'} são lançadas sozinhas todo mês (você só marca como "pago").</p>
    ${fx.length ? fx.map((t) => `<div class="tx editable" data-a="edit-tpl" data-v="${t.id}" role="button" tabindex="0"><div class="emo">${cat(t.cat).emoji}</div><div class="grow"><b>${esc(t.desc)}</b><div class="muted">dia ${t.day} · ${esc(pName(t.payer))} · ${t.split === 'shared' ? 'casa' : t.vis === 'private' ? '🔒 só meu' : 'pessoal'}${t.active ? '' : ' · pausada'}</div></div><div class="amt">${brl(t.cents)}</div></div>`).join('') : '<div class="empty">Nenhuma conta fixa cadastrada.</div>'}</div>

  <div class="card"><div class="row"><h3>Categorias</h3><button data-a="new-cat">+ Nova</button></div>
    ${S.cats.map((c) => `<div class="row" style="padding:6px 0"><span>${c.emoji} ${esc(c.name)}</span><label style="margin:0;font-size:.8rem"><input type="checkbox" data-c="essential" data-v="${c.id}" ${c.essential ? 'checked' : ''}> essencial</label></div>`).join('')}
    <p class="muted">Categorias que não são essenciais aparecem como "flexíveis" — é onde o app sugere apertar.</p></div>

  ${CLOUD ? accountCard() : `  <div class="card"><h3>Backup e sincronização</h3>
    <p class="muted">Os dados ficam só neste aparelho. Para usar nos dois celulares: exporte aqui e importe no outro (ou mande o arquivo pelo WhatsApp). Faça isso depois de lançar gastos novos.</p>
    <div class="grid2"><button data-a="export">Exportar backup</button><button data-a="import">Importar backup</button></div>
    <button data-a="csv" style="width:100%;margin-top:8px">Exportar planilha (CSV)</button>
    <input type="file" id="file" accept="application/json" hidden>
    <button class="danger" data-a="reset" style="width:100%;margin-top:8px">Apagar todos os dados</button></div>`}`;
}

/* ---------- sheets ---------- */
function openSheet(html) {
  $('#sheet-root').innerHTML = `<div class="backdrop" data-a="close-bd"><div class="sheet" role="dialog">${html}</div></div>`;
}
const closeSheet = () => { $('#sheet-root').innerHTML = ''; };
const catOptions = (sel) => S.cats.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('');
const payerOptions = (sel, joint = true, personalOnly = false) => [0, 1].filter((i) => !(CLOUD && personalOnly && i !== S.me)).map((i) => `<option value="${i}" ${String(sel) === String(i) ? 'selected' : ''}>${esc(S.people[i].name)}</option>`).join('') + (joint ? `<option value="joint" ${sel === 'joint' ? 'selected' : ''}>Conta conjunta</option>` : '');
const seg = (name, opts, sel) => `<div class="seg">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${v === sel ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
const val = (f, n) => f.elements[n].value;

function openSetup() {
  if ($('#setup-form')) return;
  openSheet(`<h1>Bem-vindos</h1><p class="muted">Vamos configurar o básico. Dá para mudar depois em Ajustes.</p>
    <form id="setup-form">
      ${S.people.map((p, i) => `<div class="grid2"><div><label>Nome ${i + 1}</label><input name="n${i}" placeholder="Ex.: ${i ? 'Maria' : 'João'}" required></div>
        <div><label>Renda mensal (R$)</label><input name="i${i}" inputmode="decimal" placeholder="0,00" required></div></div>`).join('')}
      <div class="actions"><button class="primary" type="submit">Começar</button></div></form>`);
  $('#setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    S.people = [0, 1].map((i) => ({ name: val(f, 'n' + i).trim() || `Pessoa ${i + 1}`, income: parseMoney(val(f, 'i' + i)) }));
    S.setup = true; save(); closeSheet(); render();
  });
}

function txForm(t) {
  const isNew = !t.id;
  openSheet(`<h2 style="margin-top:0">${isNew ? 'Novo lançamento' : 'Editar lançamento'}</h2>
  <form id="tx-form">
    ${t.kind === 'acerto' ? '' : seg('kind', [['despesa', 'Despesa'], ['receita', 'Receita extra']], t.kind)}
    <label>Descrição</label><input name="desc" value="${esc(t.desc)}" required placeholder="Ex.: Mercado da semana">
    <div class="grid2"><div><label id="l-val">Valor (R$)</label><input name="val" inputmode="decimal" value="${t.cents ? num(t.cents) : ''}" required placeholder="0,00"></div>
      <div><label>Data</label><input name="date" type="date" value="${t.date}" required></div></div>
    <div id="exp-fields" ${t.kind === 'despesa' ? '' : 'hidden'}>
      <label>Categoria</label><select name="cat">${catOptions(t.cat)}</select>
      <label>Tipo de gasto</label>${seg('nature', Object.entries(NATURES).map(([k, l]) => [k, l]), t.nature)}
      <label>Onde entra</label>${seg('split', [['shared', 'Casa (divide pela renda)'], ['personal', 'Pessoal (só meu)']], t.split)}
      <div id="vis-fields" ${t.split === 'personal' ? '' : 'hidden'}><label>Quem pode ver</label>${seg('vis', [['open', 'Parceiro vê'], ['private', 'Só eu']], t.vis || 'open')}</div>
    </div>
    <label id="l-payer">${t.kind === 'receita' ? 'Quem recebeu' : t.split === 'personal' ? 'De quem é o gasto' : 'Quem pagou'}</label><select name="payer">${payerOptions(t.payer, t.kind === 'despesa' && t.split !== 'personal', t.kind === 'despesa' && t.split === 'personal')}</select>
    ${isNew ? `<div id="inst" ${t.kind === 'despesa' ? '' : 'hidden'}><label>Parcelas (meses seguidos, opcional)</label><input name="n" type="number" min="1" max="60" value="1"></div>` : ''}
    <div class="actions">${isNew ? '' : '<button type="button" class="danger" data-a="del-tx">Excluir</button>'}<button class="primary" type="submit">Salvar</button></div>
  </form>`);
  const f = $('#tx-form');
  const sync = () => {
    const k = t.kind === 'acerto' ? 'acerto' : val(f, 'kind');
    $('#exp-fields').hidden = k !== 'despesa';
    const sp = f.querySelector('[name=split]:checked');
    const personalSel = k === 'despesa' && !!sp && sp.value === 'personal';
    $('#vis-fields').hidden = !personalSel;
    const inst = $('#inst'); if (inst) inst.hidden = k !== 'despesa';
    const sel = f.elements.payer, cur = sel.value;
    const joint = k === 'despesa' && !personalSel;
    sel.innerHTML = payerOptions(cur === 'joint' && !joint ? (CLOUD ? S.me : 0) : cur, joint, personalSel);
    $('#l-payer').textContent = k === 'receita' ? 'Quem recebeu' : k === 'acerto' ? 'Quem transferiu' : personalSel ? 'De quem é o gasto' : 'Quem pagou';
  };
  f.addEventListener('change', sync);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const kind = t.kind === 'acerto' ? 'acerto' : val(f, 'kind');
    const payerRaw = val(f, 'payer');
    const payer = payerRaw === 'joint' ? 'joint' : +payerRaw;
    const cents = parseMoney(val(f, 'val'));
    if (cents <= 0) { toast('Informe um valor maior que zero'); return; }
    const base = { ...t, kind, desc: val(f, 'desc').trim(), cents, date: val(f, 'date'), payer };
    if (kind === 'despesa') {
      base.cat = val(f, 'cat'); base.nature = f.querySelector('[name=nature]:checked').value;
      base.split = payer === 'joint' ? 'shared' : f.querySelector('[name=split]:checked').value;
      base.vis = base.split === 'personal' ? f.querySelector('[name=vis]:checked').value : undefined;
      if (base.nature === 'fixa' && base.paid === undefined) base.paid = true;
    }
    if (isNew) {
      const n = Math.max(1, Math.min(60, +(f.elements.n?.value) || 1));
      const group = n > 1 ? uid() : undefined;
      for (let i = 0; i < n; i++) {
        S.tx.push({ ...base, id: uid(), group, date: addMonthsToDate(base.date, i), desc: n > 1 ? `${base.desc} (${i + 1}/${n})` : base.desc });
      }
    } else {
      S.tx = S.tx.map((x) => (x.id === t.id ? base : x));
    }
    save(); closeSheet(); ui.ym = ymOf(base.date); render(); toast('Salvo ✔');
  });
}

function newTx() {
  const d = todayStr();
  const own = ui.who !== 'casa';
  txForm({ kind: 'despesa', desc: '', cents: 0, date: d.startsWith(ui.ym) ? d : `${ui.ym}-01`, cat: own ? 'esporte' : 'mercado', nature: 'variavel', split: own ? 'personal' : 'shared', vis: 'open', payer: own ? ui.who : (CLOUD ? S.me : 0) });
}

function tplForm(t) {
  const isNew = !t.id;
  openSheet(`<h2 style="margin-top:0">${isNew ? 'Nova conta fixa' : 'Editar conta fixa'}</h2>
  <form id="tpl-form">
    <label>Descrição</label><input name="desc" value="${esc(t.desc)}" required placeholder="Ex.: Aluguel">
    <div class="grid2"><div><label>Valor (R$)</label><input name="val" inputmode="decimal" value="${t.cents ? num(t.cents) : ''}" required></div>
      <div><label>Dia do vencimento</label><input name="day" type="number" min="1" max="31" value="${t.day}" required></div></div>
    <label>Categoria</label><select name="cat">${catOptions(t.cat)}</select>
    <label>Quem paga</label><select name="payer">${payerOptions(t.payer, true, t.split === 'personal')}</select>
    <label>Onde entra</label>${seg('split', [['shared', 'Casa (divide pela renda)'], ['personal', 'Pessoal (só meu)']], t.split)}
    <div id="vis-fields" ${t.split === 'personal' ? '' : 'hidden'}><label>Quem pode ver</label>${seg('vis', [['open', 'Parceiro vê'], ['private', 'Só eu']], t.vis || 'open')}</div>
    <label><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> Ativa (lançar todo mês)</label>
    <div class="actions">${isNew ? '' : '<button type="button" class="danger" data-a="del-tpl">Excluir</button>'}<button class="primary" type="submit">Salvar</button></div>
  </form>`);
  $('#tpl-form').addEventListener('change', (e) => {
    const f = e.currentTarget, personalSel = f.querySelector('[name=split]:checked').value === 'personal';
    $('#vis-fields').hidden = !personalSel;
    if (personalSel && f.elements.payer.value === 'joint') f.elements.payer.value = String(CLOUD ? S.me : 0);
    const keep = f.elements.payer.value;
    f.elements.payer.innerHTML = payerOptions(keep, !personalSel, personalSel);
  });
  $('#tpl-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target, payerRaw = val(f, 'payer'), payer = payerRaw === 'joint' ? 'joint' : +payerRaw;
    const cents = parseMoney(val(f, 'val'));
    if (cents <= 0) { toast('Informe um valor maior que zero'); return; }
    const nt = { ...t, desc: val(f, 'desc').trim(), cents, day: Math.max(1, Math.min(31, +val(f, 'day') || 1)), cat: val(f, 'cat'), payer,
      split: payer === 'joint' ? 'shared' : f.querySelector('[name=split]:checked').value, active: f.elements.active.checked };
    nt.vis = nt.split === 'personal' ? f.querySelector('[name=vis]:checked').value : undefined;
    const cur = todayStr().slice(0, 7);
    if (isNew) { nt.id = uid(); nt.start = cur; S.tpl.push(nt); }
    else {
      S.tpl = S.tpl.map((x) => (x.id === t.id ? nt : x));
      // propaga a mudança para os lançamentos ainda não pagos deste mês em diante
      S.tx.filter((x) => x.tplId === t.id && !x.paid && ymOf(x.date) >= cur).forEach((x) => {
        Object.assign(x, { desc: nt.desc, cents: nt.cents, cat: nt.cat, payer: nt.payer, split: nt.split, vis: nt.vis, date: `${ymOf(x.date)}-${pad(Math.min(nt.day, daysIn(ymOf(x.date))))}` });
      });
      if (!nt.active) S.tx = S.tx.filter((x) => !(x.tplId === t.id && !x.paid && ymOf(x.date) >= cur));
    }
    save(); closeSheet(); render(); toast('Salvo ✔');
  });
}

/* ---------- ações ---------- */
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
let editing = null;

const actions = {
  who: (v) => { ui.who = v === 'casa' ? 'casa' : +v; S.who = ui.who; save(); render(); window.scrollTo(0, 0); },
  tab: (v) => { ui.tab = v; render(); window.scrollTo(0, 0); },
  month: (v) => { ui.ym = shiftYm(ui.ym, +v); render(); },
  'new-tx': newTx,
  'doc-import': () => $('#doc-file').click(),
  'edit-tx': (v) => { const t = S.tx.find((x) => x.id === v); if (t) { editing = t.id; txForm(t); } },
  'del-tx': () => {
    const t = S.tx.find((x) => x.id === editing);
    if (!t) return;
    const more = t.group ? S.tx.filter((x) => x.group === t.group && x.date > t.date).length : 0;
    let all = false;
    if (more && confirm(`Essa compra é parcelada. Excluir também as ${more} parcelas seguintes?`)) all = true;
    else if (!more && !confirm('Excluir este lançamento?')) return;
    S.tx = S.tx.filter((x) => x.id !== t.id && !(all && x.group === t.group && x.date > t.date));
    save(); closeSheet(); render(); toast('Excluído');
  },
  'new-tpl': () => { editing = null; const own = ui.who !== 'casa'; tplForm({ desc: '', cents: 0, day: 5, cat: own ? 'esporte' : 'moradia', payer: own ? ui.who : (CLOUD ? S.me : 0), split: own ? 'personal' : 'shared', vis: 'open', active: true }); },
  'edit-tpl': (v) => { const t = S.tpl.find((x) => x.id === v); if (t) { editing = t.id; tplForm(t); } },
  'del-tpl': () => {
    if (!confirm('Excluir esta conta fixa? Lançamentos já pagos são mantidos.')) return;
    const cur = todayStr().slice(0, 7);
    S.tx = S.tx.filter((x) => !(x.tplId === editing && !x.paid && ymOf(x.date) >= cur));
    S.tpl = S.tpl.filter((x) => x.id !== editing);
    save(); closeSheet(); render();
  },
  'new-cat': () => {
    const name = prompt('Nome da nova categoria:');
    if (!name || !name.trim()) return;
    const emoji = prompt('Um emoji para ela (opcional):', '📦') || '📦';
    S.cats.push({ id: uid(), name: name.trim(), emoji: emoji.trim().slice(0, 4), essential: false, budget: 0 });
    save(); render();
  },
  settle: () => {
    const s = settlement(ui.ym);
    if (s.debtor === null) return;
    const d = todayStr();
    editing = null;
    txForm({ kind: 'acerto', desc: 'Acerto de contas', cents: s.owes, date: d.startsWith(ui.ym) ? d : `${ui.ym}-${pad(daysIn(ui.ym))}`, payer: s.debtor });
  },
  'change-pass': () => gateNewPassword(false),
  logout: async () => {
    try { await sb.auth.signOut(); } catch (e) { /* segue */ }
    location.reload();
  },
  export: () => download(`financas-casa-${todayStr()}.json`, JSON.stringify(S, null, 2), 'application/json'),
  import: () => $('#file').click(),
  csv: () => {
    const rows = [['data', 'tipo', 'descricao', 'valor', 'categoria', 'natureza', 'pagou', 'divisao', 'pago']];
    S.tx.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => rows.push([t.date, t.kind, t.desc, (t.cents / 100).toFixed(2).replace('.', ','),
      t.kind === 'despesa' ? cat(t.cat).name : '', t.kind === 'despesa' ? NATURES[t.nature] : '', pName(t.payer), t.split || '', t.paid ? 'sim' : '']));
    download(`financas-casa-${todayStr()}.csv`, '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv');
  },
  reset: () => {
    if (!confirm('Apagar TODOS os dados deste aparelho? Exporte um backup antes se precisar.')) return;
    S = defaultState(); save(); ui.tab = 'resumo'; render();
  },
  'close-bd': () => {},
};

document.addEventListener('click', (e) => {
  if (e.target.classList?.contains('backdrop') && e.target.dataset.a === 'close-bd' && !$('#setup-form')) { closeSheet(); return; }
  const el = e.target.closest('[data-a]');
  if (!el || el.dataset.a === 'close-bd') return;
  if (el.dataset.a === 'edit-tx' && e.target.closest('label, input')) return;   // marcar "pago" não abre a edição
  const fn = actions[el.dataset.a];
  if (fn) fn(el.dataset.v);
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role=button][data-a]')) { e.preventDefault(); e.target.click(); }
});

document.addEventListener('input', (e) => {
  if (e.target.dataset.c === 'filter') {
    ui.q = $('#f-q').value; ui.cat = $('#f-cat').value; ui.nat = $('#f-nat').value; renderList();
  }
  if (e.target.dataset.c === 'savings') $('#sv-pct').textContent = e.target.value + '%';
});

document.addEventListener('change', (e) => {
  const el = e.target, c = el.dataset.c, v = el.dataset.v;
  if (c === 'paid') { const t = S.tx.find((x) => x.id === v); if (t) { t.paid = el.checked; save(); render(); } }
  else if (c === 'savings') { S.savingsPct = +el.value; save(); render(); }
  else if (c === 'budget') { cat(v).budget = parseMoney(el.value); save(); render(); }
  else if (c === 'essential') { cat(v).essential = el.checked; save(); toast('Salvo ✔'); }
  else if (c === 'pname') { S.people[+v].name = el.value.trim() || `Pessoa ${+v + 1}`; save(); toast('Salvo ✔'); }
  else if (c === 'pincome') { S.people[+v].income = parseMoney(el.value); save(); render(); toast('Renda atualizada ✔'); }
  else if (el.id === 'file' && el.files[0]) {
    el.files[0].text().then((txt) => {
      try {
        const d = JSON.parse(txt);
        if (!Array.isArray(d.tx) || !Array.isArray(d.people)) throw new Error('formato');
        if (!confirm('Substituir os dados deste aparelho pelo backup?')) return;
        S = { ...defaultState(), ...d, setup: true }; save(); render(); toast('Backup importado ✔');
      } catch (err) { toast('Arquivo de backup inválido'); }
    });
  }
});

/* ---------- tela de pessoas / conta ---------- */
function peopleCard() {
  const rows = S.people.map((p, i) => {
    const mine = !CLOUD || i === S.me, dis = mine ? '' : 'disabled';
    return `<div class="grid2"><div><label>Nome</label><input value="${esc(p.name)}" data-c="pname" data-v="${i}" ${dis}></div>
      <div><label>Renda (R$)</label><input inputmode="decimal" value="${num(p.income)}" data-c="pincome" data-v="${i}" ${dis}></div></div>`;
  }).join('');
  const other = CLOUD ? S.people[1 - S.me] : null;
  const invite = other && other.pending
    ? `<div class="insight warn">Falta a outra pessoa entrar. Peça para abrir o app, criar a conta e, em <b>"Entrar com o código"</b>, digitar:<div style="font-size:1.5rem;font-weight:800;letter-spacing:3px;margin-top:4px">${esc(S.invite)}</div></div>` : '';
  return `<div class="card"><h3>Pessoas e renda mensal</h3>${rows}${invite}
    <p class="muted">A divisão das despesas usa a proporção entre as duas rendas. ${CLOUD ? 'Cada um atualiza apenas a própria renda e o próprio nome.' : 'Atualize aqui se algum salário mudar.'}</p></div>`;
}
function accountCard() {
  return `<div class="card"><h3>Conta e sincronização</h3>
    <p class="muted">Conectado como <b>${esc(cloudEmail)}</b>. Tudo é salvo online e aparece no celular do parceiro em segundos. Gastos marcados como "só eu" ficam escondidos dele no servidor.</p>
    <div class="grid2"><button data-a="export">Backup (arquivo)</button><button data-a="csv">Planilha (CSV)</button></div>
    <button data-a="change-pass" style="width:100%;margin-top:8px">Trocar minha senha</button>
    <button class="danger" data-a="logout" style="width:100%;margin-top:8px">Sair da conta</button></div>`;
}
const offlineBanner = () => (CLOUD && cloudOffline ? '<div class="insight warn">Sem conexão. Você vê o último estado salvo; o que lançar agora será enviado quando a internet voltar.</div>' : '');

/* ---------- nuvem (Supabase) ---------- */
let sb = null, cloudEmail = '', cloudUid = null, hid = null, cloudOffline = false;
let snap = { tx: {}, tpl: {}, cats: {}, me: '', pct: -1 };
let pushTimer = null, chain = Promise.resolve(), channel = null;
const isNetErr = (e) => /fetch|network|offline|timeout/i.test(String((e && e.message) || e)) || !navigator.onLine;

const rowTx = (t) => ({ id: t.id, household_id: hid, kind: t.kind, date: t.date, descr: t.desc, cents: t.cents, cat: t.cat ?? null, nature: t.nature ?? null, payer: String(t.payer), split: t.split ?? null, vis: t.vis ?? null, paid: !!t.paid, tpl_id: t.tplId ?? null, grp: t.group ?? null });
const fromTx = (r) => ({ id: r.id, kind: r.kind, date: r.date, desc: r.descr, cents: Number(r.cents), cat: r.cat ?? undefined, nature: r.nature ?? undefined, payer: r.payer === 'joint' ? 'joint' : +r.payer, split: r.split ?? undefined, vis: r.vis ?? undefined, paid: r.paid, tplId: r.tpl_id ?? undefined, group: r.grp ?? undefined });
const rowTpl = (t) => ({ id: t.id, household_id: hid, descr: t.desc, cents: t.cents, day: t.day, cat: t.cat, payer: String(t.payer), split: t.split, vis: t.vis ?? null, active: !!t.active, start_ym: t.start });
const fromTpl = (r) => ({ id: r.id, desc: r.descr, cents: Number(r.cents), day: r.day, cat: r.cat, payer: r.payer === 'joint' ? 'joint' : +r.payer, split: r.split, vis: r.vis ?? undefined, active: r.active, start: r.start_ym });
const rowCat = (c) => ({ household_id: hid, id: c.id, name: c.name, emoji: c.emoji, essential: !!c.essential, budget_cents: c.budget || 0 });
const fromCat = (r) => ({ id: r.id, name: r.name, emoji: r.emoji, essential: r.essential, budget: Number(r.budget_cents) });
const rowMe = (p) => ({ name: p.name, income_cents: p.income });
const TABLES = [['tx', () => S.tx, rowTx, 'id'], ['tpl', () => S.tpl, rowTpl, 'id'], ['cats', () => S.cats, rowCat, 'household_id,id']];

function snapshotAll() {
  TABLES.forEach(([name, get, mk]) => { snap[name] = {}; get().forEach((it) => { snap[name][it.id] = JSON.stringify(mk(it)); }); });
  snap.me = JSON.stringify(rowMe(S.people[S.me])); snap.pct = S.savingsPct;
}
const cacheKey = () => `${KEY}-cloud-${cloudUid}`;
function cloudCacheWrite() {
  if (!cloudUid || !hid) return;
  try { localStorage.setItem(cacheKey(), JSON.stringify({ S, snap, hid })); } catch (e) { /* sem cache */ }
}
function cloudCacheRead() {
  try { const c = JSON.parse(localStorage.getItem(cacheKey())); if (c && c.S) { S = c.S; snap = c.snap; hid = c.hid; return true; } } catch (e) { /* sem cache */ }
  return false;
}
const chunks = (arr, n = 200) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const must = (r) => { if (r.error) throw r.error; return r; };

async function pushAll() {
  if (!hid) return;
  for (const [name, get, mk, conflict] of TABLES) {
    const cur = {}; get().forEach((it) => { cur[it.id] = mk(it); });
    const old = snap[name], fresh = [], changed = [], gone = [];
    for (const id in cur) { const j = JSON.stringify(cur[id]); if (!(id in old)) fresh.push(cur[id]); else if (old[id] !== j) changed.push(cur[id]); }
    for (const id in old) if (!(id in cur)) gone.push(id);
    for (const c of chunks(fresh)) must(await sb.from(name).upsert(c, { onConflict: conflict, ignoreDuplicates: true }));
    for (const c of chunks(changed)) must(await sb.from(name).upsert(c, { onConflict: conflict }));
    for (const c of chunks(gone)) {
      let q = sb.from(name).delete();
      if (name === 'cats') q = q.eq('household_id', hid);
      must(await q.in('id', c));
    }
    for (const id in cur) old[id] = JSON.stringify(cur[id]);
    gone.forEach((id) => delete old[id]);
  }
  const me = JSON.stringify(rowMe(S.people[S.me]));
  if (me !== snap.me) { must(await sb.from('members').update(rowMe(S.people[S.me])).eq('user_id', cloudUid)); snap.me = me; }
  if (S.savingsPct !== snap.pct) { must(await sb.from('households').update({ savings_pct: S.savingsPct }).eq('id', hid)); snap.pct = S.savingsPct; }
}
function enqueue(fn) { chain = chain.then(fn, fn); return chain; }
function cloudSchedule() { clearTimeout(pushTimer); pushTimer = setTimeout(cloudFlush, 400); }
function cloudFlush() {
  clearTimeout(pushTimer);
  return enqueue(async () => {
    try { await pushAll(); setOffline(false); cloudCacheWrite(); }
    catch (e) {
      if (isNetErr(e)) { setOffline(true); return; }
      console.error(e); toast('Não foi possível salvar: ' + (e.message || 'erro')); 
      try { await pull(); render(); } catch (e2) { /* segue */ }
    }
  });
}
function setOffline(v) { if (cloudOffline !== v) { cloudOffline = v; if (hid) render(); } }

async function fetchAll(table, order) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').order(order).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
/** Lê tudo do servidor. Devolve false se o usuário ainda não pertence a nenhuma casa. */
async function pull() {
  const h = must(await sb.from('households').select('*').maybeSingle()).data;
  const members = await fetchAll('members', 'idx');
  const mine = members.find((m) => m.user_id === cloudUid);
  if (!h || !mine) return false;
  const [cats, tx, tpl] = await Promise.all([fetchAll('cats', 'id'), fetchAll('tx', 'date'), fetchAll('tpl', 'id')]);
  hid = h.id;
  S = {
    ...defaultState(), setup: true, me: mine.idx, invite: h.invite_code, savingsPct: h.savings_pct,
    people: [0, 1].map((i) => { const m = members.find((x) => x.idx === i); return m ? { name: m.name, income: Number(m.income_cents) } : { name: 'Aguardando…', income: 0, pending: true }; }),
    cats: cats.length ? cats.map(fromCat) : DEFAULT_CATS.map((c) => ({ ...c, budget: 0 })),
    tx: tx.map(fromTx), tpl: tpl.map(fromTpl),
  };
  snapshotAll();
  if (!cats.length) { snap.cats = {}; }
  cloudCacheWrite(); setOffline(false);
  return true;
}
async function cloudRefresh() {
  const busy = document.activeElement && document.activeElement.closest && document.activeElement.closest('#view, #sheet-root') && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (busy) { setTimeout(cloudRefresh, 3000); return; }
  try { await cloudFlush(); await pull(); render(); } catch (e) { if (isNetErr(e)) setOffline(true); }
}
let refreshTimer = null;
const cloudRefreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(cloudRefresh, 600); };
function startRealtime() {
  if (channel || !hid) return;
  channel = sb.channel('casa-' + hid).on('postgres_changes', { event: '*', schema: 'public' }, cloudRefreshSoon).subscribe();
}

/* ---------- login e convite ---------- */
function showGate(html) { document.body.classList.add('gate'); $('#sheet-root').innerHTML = ''; $('#view').innerHTML = `<div class="gate-box">${html}</div>`; }
const authMsg = (m) => ({ 'Invalid login credentials': 'E-mail ou senha incorretos.', 'User already registered': 'Esse e-mail já tem conta. Use "Entrar".', 'Email not confirmed': 'Confirme o e-mail (veja sua caixa de entrada) antes de entrar.' }[m] || m);
const rpcMsg = (m) => (/invalid_code/.test(m) ? 'Código não encontrado. Confira com quem criou a casa.' : /household_full/.test(m) ? 'Essa casa já tem duas pessoas.' : /already_member/.test(m) ? 'Esta conta já pertence a uma casa.' : m);

function gateAuth(mode = 'login', msg = '') {
  const login = mode === 'login';
  showGate(`<h1>Finanças da Casa</h1><p class="muted">Entre para ver as finanças do casal em qualquer celular.</p>
    <form id="auth-form" class="card"><label>E-mail</label><input name="email" type="email" required autocomplete="email">
      <label>Senha ${login ? '' : '(mínimo 6 caracteres)'}</label><input name="pass" type="password" minlength="6" required autocomplete="${login ? 'current-password' : 'new-password'}">
      <div class="actions"><button class="primary" type="submit">${login ? 'Entrar' : 'Criar conta'}</button></div>
      <p class="muted" id="auth-msg">${esc(msg)}</p></form>
    <button class="link" id="auth-switch" type="button">${login ? 'Primeira vez? Criar conta' : 'Já tenho conta — entrar'}</button>
    ${login ? '<button class="link" id="auth-forgot" type="button">Esqueci a senha</button>' : ''}`);
  $('#auth-switch').onclick = () => gateAuth(login ? 'signup' : 'login');
  if (login) $('#auth-forgot').onclick = async () => {
    const email = $('#auth-form').elements.email.value.trim();
    const out = $('#auth-msg');
    if (!email) { out.textContent = 'Digite seu e-mail no campo acima e toque de novo em "Esqueci a senha".'; return; }
    out.textContent = 'Enviando…';
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    out.textContent = error ? 'Não foi possível enviar agora: ' + (error.message || error) : 'Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Olhe também o spam.';
  };
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button.primary'), out = $('#auth-msg');
    btn.disabled = true; out.textContent = '';
    try {
      const creds = { email: f.elements.email.value.trim(), password: f.elements.pass.value };
      const r = login ? await sb.auth.signInWithPassword(creds) : await sb.auth.signUp(creds);
      if (r.error) throw r.error;
      if (!r.data.session) { out.textContent = 'Enviamos um e-mail de confirmação. Confirme e depois entre.'; btn.disabled = false; return; }
      await enter(r.data.session);
    } catch (err) { out.textContent = authMsg(err.message || String(err)); btn.disabled = false; }
  };
}
function gateHousehold(msg = '') {
  showGate(`<h1>Quase lá</h1><p class="muted">Conectado como ${esc(cloudEmail)}.</p>
    <form id="hh-new" class="card"><h3>1ª pessoa: criar a casa</h3>
      <label>Seu nome</label><input name="name" required placeholder="Ex.: João">
      <label>Sua renda mensal (R$)</label><input name="income" inputmode="decimal" required placeholder="0,00">
      <div class="actions"><button class="primary" type="submit">Criar a casa</button></div></form>
    <form id="hh-join" class="card"><h3>2ª pessoa: entrar com o código</h3>
      <label>Código recebido</label><input name="code" required placeholder="Ex.: 3F9A1C27" autocapitalize="characters">
      <label>Seu nome</label><input name="name" required placeholder="Ex.: Ana">
      <label>Sua renda mensal (R$)</label><input name="income" inputmode="decimal" required placeholder="0,00">
      <div class="actions"><button class="primary" type="submit">Entrar na casa</button></div></form>
    <p class="muted" id="hh-msg">${esc(msg)}</p><button class="link" id="hh-out" type="button">Sair da conta</button>`);
  $('#hh-out').onclick = actions.logout;
  const run = (fn, params) => async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button.primary');
    btn.disabled = true;
    try { must(await sb.rpc(fn, params(f))); await enter(); }
    catch (err) { $('#hh-msg').textContent = rpcMsg(err.message || String(err)); btn.disabled = false; }
  };
  $('#hh-new').onsubmit = run('create_household', (f) => ({ p_name: f.elements.name.value, p_income: parseMoney(f.elements.income.value) }));
  $('#hh-join').onsubmit = run('join_household', (f) => ({ p_code: f.elements.code.value, p_name: f.elements.name.value, p_income: parseMoney(f.elements.income.value) }));
}

function gateNewPassword(recovery) {
  const form = `<h1>${recovery ? 'Crie uma nova senha' : 'Trocar senha'}</h1><p class="muted">Use pelo menos 6 caracteres.</p>
    <form id="pw-form" class="card"><label>Nova senha</label><input name="p1" type="password" minlength="6" required autocomplete="new-password">
      <label>Repita a nova senha</label><input name="p2" type="password" minlength="6" required autocomplete="new-password">
      <div class="actions"><button class="primary" type="submit">Salvar senha</button></div><p class="muted" id="pw-msg"></p></form>
    ${recovery ? '' : '<button class="link" id="pw-cancel" type="button">Voltar</button>'}`;
  showGate(form);
  if (!recovery) $('#pw-cancel').onclick = () => render();
  $('#pw-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, out = $('#pw-msg');
    if (f.elements.p1.value !== f.elements.p2.value) { out.textContent = 'As duas senhas precisam ser iguais.'; return; }
    f.querySelector('button.primary').disabled = true;
    const { error } = await sb.auth.updateUser({ password: f.elements.p1.value });
    if (error) { out.textContent = 'Não foi possível trocar: ' + (error.message || error); f.querySelector('button.primary').disabled = false; return; }
    toast('Senha atualizada ✔');
    if (recovery) { history.replaceState(null, '', location.pathname); await enter(); } else render();
  };
}

async function enter(session) {
  if (!session) session = (await sb.auth.getSession()).data.session;
  if (!session) return gateAuth();
  cloudUid = session.user.id; cloudEmail = session.user.email || '';
  try {
    if (!(await pull())) return gateHousehold();
    if (!S.cats.length || !Object.keys(snap.cats).length) cloudSchedule();   // 1ª vez: sobe as categorias padrão
  } catch (e) {
    if (isNetErr(e) && cloudCacheRead()) setOffline(true);
    else { showGate(`<h1>Não foi possível carregar</h1><p class="muted">${esc(e.message || e)}</p><button class="primary" onclick="location.reload()">Tentar de novo</button>`); return; }
  }
  startRealtime(); render();
}
async function boot() {
  if (!CLOUD) { render(); return; }
  if (!window.supabase) { showGate('<h1>Sem conexão com o servidor</h1><p class="muted">Não foi possível carregar o necessário para entrar. Verifique a internet e tente de novo.</p><button class="primary" onclick="location.reload()">Tentar de novo</button>'); return; }
  const cameFromRecovery = /type=recovery/.test(location.hash);
  sb = window.supabase.createClient(CFG.url, CFG.key);
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { hid = null; channel = null; gateAuth(); } });
  if (cameFromRecovery) {
    const { data } = await sb.auth.getSession();
    if (data.session) { cloudUid = data.session.user.id; cloudEmail = data.session.user.email || ''; gateNewPassword(true); }
    else await enter();
  } else await enter();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && hid) cloudRefreshSoon(); });
  window.addEventListener('online', () => { if (hid) cloudRefresh(); });
}

boot();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
