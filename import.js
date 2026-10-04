'use strict';
/* Importar gastos de PDF ou foto.
   - PDF digital (fatura/extrato): o texto é lido no próprio aparelho, de graça.
   - Foto, cupom ou PDF escaneado: vai para a IA (função "extrair-gastos" no Supabase).
   Nada é lançado sem a pessoa conferir. Depende de app.js (S, save, render, openSheet…) só em tempo de execução. */

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const AI_MAX_BYTES = 6 * 1024 * 1024;
const MESES_ABREV = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

/* ---------- categoria sugerida ---------- */
const CAT_KEYWORDS = [
  ['assinaturas', /netflix|spotify|disney|hbo|prime ?video|amazon ?prime|youtube|apple\.com|icloud|google ?(one|storage)|deezer|globoplay|paramount|crunchyroll|chatgpt|openai/i],
  ['esporte', /academia|smart ?fit|bluefit|crossfit|pilates|nata[cç][aã]o|futebol/i],
  ['delivery', /ifood|rappi|restaur|lanchon|pizz|burger|mc ?donald|subway|outback|padaria|caf[eé]|sorvet|churrasc|sushi|habib|bar /i],
  ['mercado', /mercado|supermerc|atacad|carrefour|assa[ií]|hortifruti|sacol[aã]o|big ?bompre|a[cç]ougue|feira|p[aã]o de a[cç]/i],
  ['transporte', /uber|99 ?(pop|app|taxi)|posto|shell|ipiranga|petrobras|combust|estaciona|sem ?parar|veloe|conectcar|ped[aá]gio|metr[oô]|cptm|bilhete/i],
  ['saude', /farm[aá]c|drog|raia|pacheco|panvel|hospital|cl[ií]nica|laborat|unimed|amil|dent|psic|m[eé]dic|consulta/i],
  ['contas', /enel|cemig|copel|sabesp|cedae|copasa|sanepar|vivo|claro|internet|energia|[aá]gua|g[aá]s|comg[aá]s|naturgy|ultragaz/i],
  ['educacao', /escola|col[eé]gio|faculdade|curso|udemy|alura|livraria|saraiva|material escolar/i],
  ['moradia', /alugu|condom[ií]nio|iptu|imobili|leroy|telhanorte/i],
  ['pets', /petz|cobasi|veterin|pet ?shop/i],
  ['cuidados', /barbear|cabelei|sal[aã]o|est[eé]tica|manicure|botic[aá]rio|natura|sephora|beleza/i],
  ['compras', /amazon|mercado ?livre|shopee|aliexpress|magalu|magazine|americanas|shein|renner|c&a|zara|riachuelo|casas bahia|kabum|netshoes/i],
  ['lazer', /cinema|ingresso|sympla|teatro|steam|playstation|xbox|nintendo|parque|hotel|airbnb|booking|decolar/i],
  ['dividas', /parcelamento|empr[eé]stimo|financiamento|juros|iof|anuidade|multa/i],
];
const normKey = (desc) => String(desc).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
function readRules() { try { return JSON.parse(localStorage.getItem('financas-regras')) || {}; } catch (e) { return {}; } }
function saveRules(r) { try { localStorage.setItem('financas-regras', JSON.stringify(r)); } catch (e) { /* sem regras */ } }
function guessCat(desc) {
  const has = (id) => S.cats.some((c) => c.id === id);
  const learned = readRules()[normKey(desc)];
  if (learned && has(learned)) return learned;
  for (const [id, re] of CAT_KEYWORDS) if (has(id) && re.test(desc)) return id;
  return has('outros') ? 'outros' : S.cats[0].id;
}

/* ---------- leitura de texto de fatura/extrato ---------- */
const DATE_NUM = /^\s*(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?(?!\d)/;
const DATE_TXT = /^\s*(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?(?:\s+(\d{2,4}))?(?![a-z0-9])/i;
const MONEY = /(-|−)?\s?(?:R\$\s?)?(-|−)?\s?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})(?!\d)(?:\s?(-|[CD])(?![A-Za-z]))?/gi;
const SKIP_DESC = /(^|\b)(pagamento (recebido|efetuado|de fatura|on[- ]?line)|pgto|saldo|total|subtotal|estorno|cr[eé]dito de|rendimento|pix recebido|transfer[eê]ncia recebida|dep[oó]sito)/i;

function parseDateTok(m, textMode, docYear, today) {
  const day = +m[1], month = textMode ? MESES_ABREV[m[2].toLowerCase()] : +m[2];
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  let year = m[3] ? +m[3] : docYear;
  if (year < 100) year += 2000;
  const mk = (y) => `${y}-${pad(month)}-${pad(Math.min(day, daysIn(`${y}-${pad(month)}`)))}`;
  let d = mk(year);
  if (!m[3] && d > addDaysStr(today, 3)) d = mk(year - 1);   // sem ano e no futuro → ano anterior
  return d;
}
function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
function modeYear(text, fallback) {
  const c = {};
  (text.match(/\b20\d{2}\b/g) || []).forEach((y) => { c[y] = (c[y] || 0) + 1; });
  const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return best ? +best[0] : fallback;
}
/** Texto de fatura/extrato → lançamentos candidatos. Não inventa nada: só linhas com data e valor. */
function parseStatementText(text, today = todayStr()) {
  const tipo = /fatura|cart[aã]o de cr[eé]dito|vencimento/i.test(text) && !/extrato/i.test(text) ? 'fatura' : 'extrato';
  const docYear = modeYear(text, +today.slice(0, 4));
  const rows = [];
  for (const line of text.split('\n')) {
    let m = line.match(DATE_NUM), textMode = false;
    if (!m) { m = line.match(DATE_TXT); textMode = true; }
    if (!m) continue;
    const date = parseDateTok(m, textMode, docYear, today);
    if (!date) continue;
    const rest = line.slice(m[0].length).trim();
    const moneys = [...rest.matchAll(MONEY)];
    if (!moneys.length) continue;
    const tok = tipo === 'extrato' && moneys.length >= 2 ? moneys[0] : moneys[moneys.length - 1];
    const desc = rest.slice(0, tok.index).replace(/R\$\s*$/i, '').replace(/^[-–•\s]+/, '').replace(/\s{2,}/g, ' ').trim();
    if (desc.length < 2 || SKIP_DESC.test(desc)) continue;
    const marker = (tok[5] || '').toUpperCase();
    const negative = !!(tok[1] || tok[2]) || marker === '-' || marker === 'D';
    const credit = marker === 'C';
    const cents = Math.round(parseFloat(tok[3].replace(/\./g, '') + '.' + tok[4]) * 100);
    if (cents <= 0) continue;
    rows.push({ date, desc: desc.slice(0, 80), cents, negative: negative && !credit, credit });
  }
  // fatura: valores positivos são gastos; extrato: débitos (negativos) são gastos
  let spend = rows.filter((r) => (tipo === 'fatura' ? !r.negative && !r.credit : r.negative));
  let note = '';
  if (!spend.length && tipo === 'extrato' && rows.some((r) => !r.credit)) { spend = rows.filter((r) => !r.credit); note = 'Não achei sinal de débito nas linhas; considerei todas como gastos. Confira.'; }
  return { tipo, note, skipped: rows.length - spend.length, items: spend.map((r) => ({ date: r.date, desc: r.desc, cents: r.cents, cat: guessCat(r.desc) })) };
}

/* ---------- PDF (pdf.js carregado só quando precisa) ---------- */
let pdfjsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_URL; s.onload = resolve; s.onerror = () => { pdfjsPromise = null; reject(new Error('Não consegui carregar o leitor de PDF (verifique a internet).')); };
      document.head.appendChild(s);
    }).then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; });
  }
  return pdfjsPromise;
}
async function pdfLines(file) {
  await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  let doc, password;
  for (let tries = 0; tries < 3; tries++) {
    try { doc = await window.pdfjsLib.getDocument({ data: data.slice(), password }).promise; break; }
    catch (e) {
      if (e && e.name === 'PasswordException') {
        password = prompt(tries ? 'Senha incorreta. Digite de novo a senha do PDF:' : 'Este PDF tem senha (comum em faturas). Digite a senha:');
        if (password === null) throw new Error('PDF protegido por senha.');
      } else throw new Error('Não consegui abrir este PDF.');
    }
  }
  if (!doc) throw new Error('PDF protegido por senha.');
  const lines = [];
  for (let p = 1; p <= Math.min(doc.numPages, 60); p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const items = content.items.filter((it) => it.str && it.str.trim()).map((it) => ({ x: it.transform[4], y: it.transform[5], s: it.str }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    let cur = [], lastY = null;
    const flush = () => { if (cur.length) lines.push(cur.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ')); cur = []; };
    for (const it of items) { if (lastY !== null && Math.abs(it.y - lastY) > 3) flush(); cur.push(it); lastY = it.y; }
    flush();
  }
  return lines;
}

/* ---------- foto → base64 reduzida ---------- */
async function imageB64(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Não consegui abrir a imagem.')); i.src = url; });
    const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] };
  } finally { URL.revokeObjectURL(url); }
}
function fileB64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('Não consegui ler o arquivo.')); r.readAsDataURL(file); });
}

/* ---------- IA ---------- */
const AI_ERRORS = {
  ai_not_configured: 'A leitura por IA ainda não foi ativada neste app (falta a chave no servidor).',
  not_allowed: 'Este e-mail não está liberado para a leitura por IA.', not_member: 'Entre em uma casa antes de usar a leitura por IA.',
  quota: 'Limite diário de leituras por IA atingido. Tente amanhã ou lance à mão.', too_big: 'Arquivo grande demais para a IA (máx. ~6 MB).',
  ai_key_invalid: 'A chave da IA no servidor é inválida. Avise quem administra o app.', ai_busy: 'A IA está ocupada agora. Tente de novo em instantes.',
  ai_no_result: 'A IA não conseguiu ler este documento.', ai_error: 'Erro ao ler com a IA. Tente de novo.', unauthorized: 'Sessão expirada. Entre de novo.',
};
async function aiExtract(mime, data) {
  if (typeof CLOUD === 'undefined' || !CLOUD || !sb) throw new Error('A leitura de fotos por IA só funciona com a conta online (faça login).');
  const { data: out, error } = await sb.functions.invoke('extrair-gastos', { body: { mime, data, today: todayStr(), cats: S.cats.map((c) => ({ id: c.id, name: c.name })) } });
  if (error) {
    let code = '';
    try { code = (await error.context.json()).error; } catch (e) { /* sem corpo */ }
    throw new Error(AI_ERRORS[code] || (isNetErr(error) ? 'Sem conexão com o servidor.' : 'Não foi possível ler com a IA.'));
  }
  return (out.itens || []).map((i) => ({ date: i.data, desc: i.descricao, cents: Math.round(i.valor * 100), cat: S.cats.some((c) => c.id === i.categoria) ? i.categoria : guessCat(i.descricao) }));
}

/* ---------- fluxo ---------- */
function markDuplicates(items) {
  return items.map((it) => ({ ...it, dup: S.tx.some((t) => t.kind === 'despesa' && t.cents === it.cents && t.date === it.date) }));
}
async function importDocs(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  openSheet('<div class="big"><div class="v">⏳</div><p><b>Lendo o arquivo…</b></p><p class="muted">PDF digital é lido aqui no celular. Fotos vão para a IA e podem levar alguns segundos.</p></div>');
  const items = [], notes = [];
  for (const f of files) {
    try {
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      if (isPdf) {
        const r = parseStatementText((await pdfLines(f)).join('\n'));
        if (r.items.length) { items.push(...r.items); notes.push(`${f.name}: ${r.items.length} lançamentos (${r.tipo}).${r.note ? ' ' + r.note : ''}`); continue; }
        if (f.size > AI_MAX_BYTES) throw new Error('Não achei lançamentos no texto e o PDF é grande demais para a IA (máx. ~6 MB).');
        notes.push(`${f.name}: sem texto legível, li com a IA.`);
        items.push(...await aiExtract('application/pdf', await fileB64(f)));
      } else if (f.type.startsWith('image/')) {
        const b = await imageB64(f);
        const r = await aiExtract(b.mime, b.data);
        notes.push(`${f.name}: ${r.length} lançamento(s) lido(s) pela IA.`);
        items.push(...r);
      } else throw new Error('Formato não suportado (use PDF ou foto).');
    } catch (e) { notes.push(`${f.name}: ${e.message || e}`); }
  }
  if (!items.length) { openImportEmpty(notes); return; }
  openImport(markDuplicates(items), notes);
}
function openImportEmpty(notes) {
  openSheet(`<h2 style="margin-top:0">Não consegui ler gastos</h2>${notes.map((n) => `<p class="muted">${esc(n)}</p>`).join('')}
    <p>Você ainda pode lançar à mão com o botão <b>+</b>.</p><div class="actions"><button class="primary" id="imp-close">Fechar</button></div>`);
  $('#imp-close').onclick = closeSheet;
}

function openImport(items, notes) {
  const own = ui.who !== 'casa';
  const st = { items: items.map((it) => ({ ...it, on: !it.dup })), split: own ? 'personal' : 'shared', vis: 'open', nature: 'variavel', payer: own ? String(ui.who) : (CLOUD ? String(S.me) : '0') };
  const rowHtml = (it, i) => `<div class="imp-row ${it.dup ? 'dup' : ''}"><label class="imp-on"><input type="checkbox" data-f="on" data-i="${i}" ${it.on ? 'checked' : ''}></label>
    <div class="grow"><input data-f="desc" data-i="${i}" value="${esc(it.desc)}" maxlength="80">
      <div class="imp-line"><input type="date" data-f="date" data-i="${i}" value="${esc(it.date)}"><input data-f="val" data-i="${i}" inputmode="decimal" value="${num(it.cents)}"><select data-f="cat" data-i="${i}">${catOptions(it.cat)}</select></div>
      ${it.dup ? '<div class="muted warn">Já existe um gasto igual nesse dia — desmarquei para não duplicar.</div>' : ''}</div></div>`;
  openSheet(`<h2 style="margin-top:0">Conferir antes de lançar</h2>
    ${notes.map((n) => `<p class="muted">${esc(n)}</p>`).join('')}
    <div class="imp-opts">
      <label>Onde entram</label>${seg('imp-split', [['shared', '🏠 Casa'], ['personal', '👤 Pessoal']], st.split)}
      <div id="imp-vis" ${st.split === 'personal' ? '' : 'hidden'}><label>Quem pode ver</label>${seg('imp-vis', [['open', '👀 Parceiro vê'], ['private', '🔒 Só eu']], st.vis)}</div>
      <div class="grid2"><div><label id="imp-l-payer">Quem pagou</label><select id="imp-payer"></select></div>
        <div><label>Tipo de gasto</label><select id="imp-nature">${Object.entries(NATURES).map(([k, l]) => `<option value="${k}" ${k === st.nature ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    </div>
    <div class="row" style="margin-top:12px"><b id="imp-count"></b><button class="link" id="imp-all" type="button">marcar/desmarcar todos</button></div>
    <div id="imp-list">${st.items.map(rowHtml).join('')}</div>
    <div class="actions"><button type="button" id="imp-cancel">Cancelar</button><button class="primary" type="button" id="imp-go">Lançar</button></div>`);

  const refreshPayer = () => {
    const personal = st.split === 'personal';
    if (personal && CLOUD) st.payer = String(S.me);
    if (personal && st.payer === 'joint') st.payer = '0';
    $('#imp-payer').innerHTML = payerOptions(st.payer, !personal, personal);
    $('#imp-l-payer').textContent = personal ? 'De quem é o gasto' : 'Quem pagou';
    $('#imp-vis').hidden = !personal;
  };
  const refreshCount = () => {
    const sel = st.items.filter((x) => x.on);
    $('#imp-count').textContent = `${sel.length} de ${st.items.length} selecionados · ${brl(sel.reduce((a, x) => a + (x.cents || 0), 0))}`;
    $('#imp-go').textContent = sel.length ? `Lançar ${sel.length}` : 'Nada selecionado';
    $('#imp-go').disabled = !sel.length;
  };
  refreshPayer(); refreshCount();
  const sheet = $('.sheet');
  sheet.addEventListener('change', (e) => {
    const el = e.target;
    if (el.name === 'imp-split') { st.split = el.value; refreshPayer(); }
    else if (el.name === 'imp-vis') st.vis = el.value;
    else if (el.id === 'imp-payer') st.payer = el.value;
    else if (el.id === 'imp-nature') st.nature = el.value;
    else if (el.dataset.f) {
      const it = st.items[+el.dataset.i], f = el.dataset.f;
      if (f === 'on') it.on = el.checked;
      else if (f === 'desc') it.desc = el.value;
      else if (f === 'date') it.date = el.value;
      else if (f === 'val') { it.cents = parseMoney(el.value); el.value = num(it.cents); }
      else if (f === 'cat') it.cat = el.value;
      refreshCount();
    }
  });
  $('#imp-all').onclick = () => { const all = st.items.every((x) => x.on); st.items.forEach((x, i) => { x.on = !all; sheet.querySelector(`[data-f=on][data-i="${i}"]`).checked = !all; }); refreshCount(); };
  $('#imp-cancel').onclick = closeSheet;
  $('#imp-go').onclick = () => {
    const sel = st.items.filter((x) => x.on);
    const bad = sel.find((x) => !(x.cents > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !x.desc.trim());
    if (bad) { toast('Confira data, descrição e valor de cada linha marcada'); return; }
    const payer = st.split === 'personal' ? (CLOUD ? S.me : +st.payer) : (st.payer === 'joint' ? 'joint' : +st.payer);
    const rules = readRules();
    sel.forEach((x) => {
      S.tx.push({ id: uid(), kind: 'despesa', date: x.date, desc: x.desc.trim().slice(0, 80), cents: x.cents, cat: x.cat, nature: st.nature, payer, split: st.split, vis: st.split === 'personal' ? st.vis : undefined, paid: true });
      rules[normKey(x.desc)] = x.cat;
    });
    saveRules(rules);
    save(); closeSheet();
    if (!sel.some((x) => x.date.startsWith(ui.ym))) ui.ym = sel.map((x) => x.date).sort().pop().slice(0, 7);
    render(); toast(`${sel.length} gastos lançados ✔`);
  };
}

function importCard() {
  return `<div class="card"><div class="row"><div class="grow"><b>📎 Importar de PDF ou foto</b><div class="muted">Fatura, extrato, cupom, comprovante…</div></div>
    <button class="primary" data-a="doc-import">Escolher</button></div>
    <input type="file" id="doc-file" accept="application/pdf,image/*" multiple hidden></div>`;
}
document.addEventListener('change', (e) => {
  if (e.target.id === 'doc-file' && e.target.files.length) { const fs = e.target.files; importDocs(fs).finally(() => { e.target.value = ''; }); }
});
