/* ============================================================
   RADAR AI — logica della pagina
   ------------------------------------------------------------
   I dati NON sono scritti dentro il codice. Vengono presi, in
   quest'ordine, da:
     1. openrouter.ai/api/v1/models   — in diretta, dal browser
     2. dati/cache.json               — l'istantanea del repository
     3. DATI_INCORPORATI              — la copia inclusa nel file
   Il primo che risponde vince. Cosi' la pagina resta viva anche
   senza rete, e un modello nuovo compare da solo appena esce.

   Regola di scrittura: qualunque numero o parola tecnica che
   compare a schermo deve poter essere spiegato con un clic.
   ============================================================ */
"use strict";

const FONTE_LIVE = "https://openrouter.ai/api/v1/models";
const CARTELLA_DATI = "dati/";

/* ------------------------------------------------------------
   Utilita'
   ------------------------------------------------------------ */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nf = new Intl.NumberFormat("it-IT");
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MESI_LUNGHI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

function dataIt(s) {
  if (!s) return "n.d.";
  const d = s instanceof Date ? s : new Date(s);
  if (isNaN(d)) return "n.d.";
  return d.getDate() + " " + MESI[d.getMonth()] + " " + d.getFullYear();
}
function dataLunga(d) { return d.getDate() + " " + MESI_LUNGHI[d.getMonth()] + " " + d.getFullYear(); }
function oraIt(d) { return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
function num(v) { return String(v).replace(".", ","); }

function soldi(v) {
  if (v == null) return "—";
  if (v === 0) return "gratis";
  if (v < 0.01) return "$" + v.toFixed(4).replace(/0+$/, "").replace(".", ",");
  if (v < 1) return "$" + v.toFixed(2).replace(".", ",");
  if (v < 100) return "$" + (v % 1 ? v.toFixed(2) : v.toFixed(0)).replace(".", ",");
  return "$" + nf.format(Math.round(v));
}
function costoIt(v) {
  if (v == null) return "—";
  if (v >= 1000) return "$" + nf.format(Math.round(v));
  if (v >= 1) return "$" + v.toFixed(2).replace(".", ",");
  if (v < 0.01) return "meno di $0,01";
  return "$" + v.toFixed(2).replace(".", ",");
}
function ctxIt(c) {
  if (!c) return "n.d.";
  if (c >= 1000000) return (c / 1000000).toFixed(c % 1000000 ? 1 : 0).replace(".", ",") + " mln";
  return nf.format(Math.round(c / 1000)) + "k";
}
function titolo(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* Un modello si paga a token, a clip, a immagine o a carattere.
   Molte parti della pagina hanno senso solo per i primi. */
function aToken(m) { return m.inp != null && m.out != null; }
const NOME_UNITA = { immagine: "a immagine", clip: "a clip", "1kchar": "ogni 1.000 caratteri" };

/* ------------------------------------------------------------
   Stato
   ------------------------------------------------------------ */
const S = {
  statici: null, extra: [], modelli: [], notizie: [], paper: [],
  fonte: "", quando: null,
  confronto: [],
  filtri: { cat: "tutto", lic: "tutte", budget: "tutti", sort: "q", q: "" },
  usaCache: false,
  chat: { fornitore: null, chiave: "", modello: "", storico: [] }
};

/* ------------------------------------------------------------
   Normalizzazione
   ------------------------------------------------------------ */
function perMilione(v) {
  const n = parseFloat(v);
  return isFinite(n) ? Math.round(n * 1e6 * 1e6) / 1e6 : null;
}
function nomeFornitore(prefisso) {
  const mappa = (S.statici && S.statici.fornitori) || {};
  if (mappa[prefisso]) return mappa[prefisso];
  return prefisso.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function normalizza(r) {
  const prefisso = (r.id || "").split("/")[0].replace(/^~/, "");
  const nome = (r.name || r.id || "").includes(": ")
    ? r.name.split(": ").slice(1).join(": ") : (r.name || r.id);
  const p = r.pricing || {}, a = r.architecture || {};
  const im = a.input_modalities || [], om = a.output_modalities || ["text"];
  const sp = r.supported_parameters || [];
  const aa = (r.benchmarks || {}).artificial_analysis || {};

  const cat = [];
  if (om.indexOf("text") >= 0) cat.push("testo");
  if (om.indexOf("image") >= 0) cat.push("immagine");
  if (om.indexOf("audio") >= 0) cat.push("voce");
  if (r.reasoning || sp.indexOf("reasoning") >= 0) cat.push("ragiona");
  if (sp.indexOf("tools") >= 0) cat.push("agente");
  if (im.indexOf("image") >= 0) cat.push("vista");
  if (im.indexOf("video") >= 0) cat.push("videoin");
  if (im.indexOf("file") >= 0) cat.push("documenti");
  if (aa.coding_index >= 45 || /cod(e|ex|er)|dev|engineer/i.test(r.id)) cat.push("codice");

  let scade = r.expiration_date || null;
  if (scade && parseInt(scade.slice(0, 4), 10) > 2090) scade = null;

  const inp = perMilione(p.prompt), out = perMilione(p.completion);
  return {
    id: r.id, nome: nome, prov: nomeFornitore(prefisso), prefisso: prefisso, cat: cat,
    lic: r.hugging_face_id ? "aperto" : "chiuso", hf: r.hugging_face_id || null,
    inp: inp, out: out,
    cache: perMilione(p.input_cache_read), cacheW: perMilione(p.input_cache_write),
    ctx: r.context_length || null,
    maxOut: (r.top_provider || {}).max_completion_tokens || null,
    rel: r.created ? new Date(r.created * 1000).toISOString().slice(0, 10) : null,
    q: aa.intelligence_index != null ? aa.intelligence_index : null,
    qCod: aa.coding_index != null ? aa.coding_index : null,
    qAg: aa.agentic_index != null ? aa.agentic_index : null,
    gratis: (inp === 0 && out === 0) || r.ha_versione_gratuita === true,
    dismesso: scade, descr: r.description || "", unit: "token", origine: "openrouter"
  };
}
function normalizzaExtra(e) {
  return Object.assign({
    prefisso: "", hf: null, cache: null, cacheW: null, ctx: null, maxOut: null,
    q: null, qCod: null, qAg: null, gratis: false, descr: "", origine: "curato",
    inp: null, out: null
  }, e);
}

/* ------------------------------------------------------------
   Caricamento
   ------------------------------------------------------------ */
async function prendiJSON(url, timeout, opzioni) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout || 12000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal, cache: "no-store" }, opzioni || {}));
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.stato = r.status; e.corpo = await r.text().catch(() => ""); throw e; }
    return await r.json();
  } finally { clearTimeout(t); }
}
const INCORPORATI = (typeof DATI_INCORPORATI !== "undefined") ? DATI_INCORPORATI : null;

async function caricaStatici() {
  const prova = async (file, chiave, estrai) => {
    try { return estrai(await prendiJSON(CARTELLA_DATI + file, 8000)); }
    catch (_) { return INCORPORATI ? estrai(INCORPORATI[chiave]) : null; }
  };
  S.statici = await prova("statici.json", "statici", d => d);
  S.extra = (await prova("extra.json", "extra", d => (d.modelli || []).map(normalizzaExtra))) || [];
  S.notizie = (await prova("notizie.json", "notizie", d => d.notizie || [])) || [];
  S.paper = (await prova("paper.json", "paper", d => d.paper || [])) || [];
}

async function caricaCatalogo(soloLive) {
  try {
    const d = await prendiJSON(FONTE_LIVE, 15000);
    if (d && d.data && d.data.length) {
      const gratuiti = {};
      d.data.forEach(m => { if (m.id.endsWith(":free")) gratuiti[m.id.split(":")[0]] = true; });
      const puliti = d.data.filter(m =>
        !(m.id.indexOf(":") >= 0 && !m.id.endsWith(":free")) && m.id.indexOf("openrouter/") !== 0);
      puliti.forEach(m => { m.ha_versione_gratuita = !!gratuiti[m.id.split(":")[0]]; });
      S.modelli = puliti.map(normalizza).concat(S.extra);
      S.fonte = "diretta"; S.quando = new Date();
      return true;
    }
  } catch (_) { }
  if (soloLive) return false;
  try {
    const c = await prendiJSON(CARTELLA_DATI + "cache.json", 12000);
    if (c && c.modelli && c.modelli.length) {
      S.modelli = c.modelli.map(normalizza).concat(S.extra);
      S.fonte = "istantanea"; S.quando = new Date(c.aggiornato);
      return true;
    }
  } catch (_) { }
  if (INCORPORATI && INCORPORATI.cache && INCORPORATI.cache.modelli) {
    S.modelli = INCORPORATI.cache.modelli.map(normalizza).concat(S.extra);
    S.fonte = "incorporati"; S.quando = new Date(INCORPORATI.cache.aggiornato);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------
   Barra di stato
   ------------------------------------------------------------ */
function mostraStato(caricando) {
  const pulse = $("#pulse"), stato = $("#statoTxt"), dett = $("#dettTxt");
  if (caricando) {
    pulse.className = "pulse";
    stato.textContent = "Sto leggendo…";
    dett.textContent = "controllo il catalogo dei modelli";
    return;
  }
  const n = S.modelli.length;
  if (S.fonte === "diretta") {
    pulse.className = "pulse live";
    stato.innerHTML = glossifica("{diretta|In diretta}");
    dett.textContent = n + " modelli letti da OpenRouter alle " + oraIt(S.quando) + " di oggi";
  } else if (S.fonte === "istantanea") {
    pulse.className = "pulse cache";
    stato.textContent = "Da istantanea";
    dett.textContent = n + " modelli, ultimo controllo " + dataIt(S.quando) + " — OpenRouter non risponde adesso";
  } else if (S.fonte === "incorporati") {
    pulse.className = "pulse cache";
    stato.textContent = "Copia inclusa";
    dett.textContent = n + " modelli fermi al " + dataIt(S.quando) + " — questa vista non può uscire in rete";
  } else {
    pulse.className = "pulse err";
    stato.textContent = "Nessun dato";
    dett.textContent = "non sono riuscito a raggiungere nessuna fonte";
  }
}

async function aggiornaOra() {
  const b = $("#btnAgg");
  b.disabled = true; b.classList.add("gira");
  mostraStato(true);
  const ok = await caricaCatalogo(true);
  if (!ok) {
    $("#dettTxt").textContent = "OpenRouter non risponde: resto sui dati di prima";
    $("#pulse").className = "pulse cache";
  } else { disegnaTutto(); mostraStato(false); }
  b.disabled = false; b.classList.remove("gira");
}

/* ------------------------------------------------------------
   Prima pagina
   ------------------------------------------------------------ */
function conPrezzo() { return S.modelli.filter(m => aToken(m) && m.out > 0); }
function conIndice() { return S.modelli.filter(m => m.q != null && m.out != null); }
function giorniDa(iso) { return (Date.now() - new Date(iso).getTime()) / 864e5; }

function disegnaTestata() {
  const cp = conPrezzo();
  const eco = cp.length ? cp.reduce((a, b) => b.out < a.out ? b : a) : null;
  const righe = [
    ["Edizione", S.quando ? dataLunga(S.quando) : "—"],
    ["Modelli seguiti", nf.format(S.modelli.length)],
    ["Fornitori", new Set(S.modelli.map(m => m.prov)).size],
    ["Usciti in 30 giorni", S.modelli.filter(m => m.rel && giorniDa(m.rel) < 30).length],
    ["Uscita più economica", eco ? soldi(eco.out) + " / mln" : "—"],
    ["Prossimo controllo", prossimoGiro()]
  ];
  $("#dateline").innerHTML = righe.map(([k, v]) =>
    '<div><dt>' + esc(k) + '</dt><dd>' + esc(String(v)) + '</dd></div>').join("");
}
function prossimoGiro() {
  const ora = new Date(), t = new Date(ora);
  t.setHours(7, 30, 0, 0);
  if (t <= ora) t.setDate(t.getDate() + 1);
  return (t.toDateString() === ora.toDateString() ? "oggi" : "domani") + " alle 7:30";
}

function disegnaApertura() {
  const ci = conIndice().sort((a, b) => b.q - a.q);
  if (!ci.length) { $("#lead").innerHTML = '<p class="vuoto">Dati non disponibili.</p>'; return; }
  const re = ci[0], sfid = ci[1];
  const recente = S.modelli.filter(m => m.rel && giorniDa(m.rel) < 14 && m.q != null).sort((a, b) => b.q - a.q)[0];
  const kicker = (recente && recente.id === re.id) ? "Cambio in vetta" : "In vetta oggi";

  let testo = re.nome + " di " + re.prov + " è oggi il modello con il {indice|punteggio di intelligenza} più alto fra i " +
    nf.format(S.modelli.length) + " che questa pagina segue: " + num(re.q) + " punti";
  if (sfid) testo += ", contro i " + num(sfid.q) + " di " + sfid.nome;
  testo += ". ";
  if (aToken(re)) testo += "Costa " + soldi(re.inp) + " per far leggere un milione di {token|token} e " + soldi(re.out) + " per farli scrivere. ";
  if (re.ctx) testo += "Tiene " + ctxIt(re.ctx) + " di token davanti agli occhi in una volta sola ({contesto|la finestra di contesto}).";

  const conv = conIndice().filter(m => m.q >= re.q * 0.8).sort((a, b) => a.out - b.out)[0];

  $("#lead").innerHTML =
    '<div class="kicker"><span class="chip hot">' + esc(kicker) + '</span>' +
    '<span class="date">' + (re.rel ? "uscito il " + dataIt(re.rel) : "") + '</span></div>' +
    '<h3>' + esc(re.nome) + '</h3>' +
    '<p class="standfirst">' + glossifica(testo) + '</p>' +
    '<div class="bignum">' +
      '<div><div class="k">' + glossifica("{indice|Intelligenza}") + '</div><div class="v">' + num(re.q) + '</div></div>' +
      (re.qCod != null ? '<div><div class="k">' + glossifica("{codicep|Sul codice}") + '</div><div class="v">' + num(re.qCod) + '</div></div>' : '') +
      (re.out != null ? '<div><div class="k">Scrivere 1 mln</div><div class="v">' + soldi(re.out) + '</div></div>' : '') +
      (re.ctx ? '<div><div class="k">' + glossifica("{contesto|Contesto}") + '</div><div class="v">' + ctxIt(re.ctx) + '</div></div>' : '') +
    '</div>' +
    '<div class="lead-azioni">' +
      '<button class="ghost forte" type="button" data-dettaglio="' + esc(re.id) + '">Vedi la scheda completa</button>' +
      '<button class="ghost" type="button" data-ask="' + esc(re.id) + '">Chiedi se fa per me</button>' +
    '</div>' +
    (conv && conv.id !== re.id ?
      '<div class="why" style="margin-top:16px"><b>Se il budget conta</b>' +
      esc(conv.nome + " di " + conv.prov + " arriva a " + num(conv.q) + " punti — l'" +
        Math.round(conv.q / re.q * 100) + "% del capofila — ma far scrivere un milione di token costa " +
        soldi(conv.out) + " invece di " + soldi(re.out) + ".") +
      ' <button class="minilink" type="button" data-dettaglio="' + esc(conv.id) + '">Guardalo</button></div>' : '');
}

function notizieCalcolate() {
  return S.modelli.filter(m => m.rel && giorniDa(m.rel) < 21 && m.origine === "openrouter")
    .sort((a, b) => new Date(b.rel) - new Date(a.rel)).slice(0, 6)
    .map(m => {
      let t = m.nome + " di " + m.prov + " è entrato nel catalogo.";
      if (aToken(m)) t += " Prezzo: " + soldi(m.inp) + " per milione di token in entrata, " + soldi(m.out) + " in uscita.";
      if (m.ctx) t += " Contesto: " + ctxIt(m.ctx) + " token.";
      if (m.q != null) t += " Punteggio di intelligenza indipendente: " + num(m.q) + ".";
      return {
        id: "auto-" + m.id, data: m.rel, modello: m.id,
        tag: m.lic === "aperto" ? "open" : (m.q != null && m.q > 45 ? "hot" : ""),
        tagT: m.lic === "aperto" ? "Pesi aperti" : "Nuovo modello",
        titolo: m.nome + ": disponibile da " + dataIt(m.rel), testo: t,
        perche: m.lic === "aperto"
          ? "Lo puoi scaricare e far girare su macchine tue: i dati non escono di casa."
          : "Un'opzione in più sul tavolo quando decidi con chi lavorare."
      };
    });
}

function disegnaNotizie() {
  const viste = {};
  const tutte = S.notizie.concat(notizieCalcolate())
    .filter(x => { if (viste[x.id]) return false; viste[x.id] = 1; return true; }).slice(0, 12);
  if (!tutte.length) { $("#newsGrid").innerHTML = '<p class="vuoto">Nessuna novità registrata.</p>'; return; }
  $("#newsGrid").innerHTML = tutte.map(n => {
    const mod = n.modello && S.modelli.find(m => m.id === n.modello);
    return '<article class="news">' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<span class="chip ' + esc(n.tag || "") + '">' + esc(n.tagT) + '</span>' +
        '<span class="date">' + dataIt(n.data) + '</span></div>' +
      '<h4>' + esc(n.titolo) + '</h4>' +
      '<p class="body">' + esc(n.testo) + '</p>' +
      '<div class="why"><b>Perché ti riguarda</b>' + esc(n.perche) + '</div>' +
      '<footer>' +
        (mod ? '<button class="ghost" type="button" data-dettaglio="' + esc(mod.id) + '">Scheda</button>' : '') +
        '<button class="ghost" type="button" data-spiega="' + esc(n.id) + '">Spiegamelo più semplice</button>' +
      '</footer></article>';
  }).join("");
  window.__notizie = tutte;
}

function disegnaScadenze() {
  const oggi = new Date();
  const sc = S.modelli.filter(m => m.dismesso).map(m => ({ m: m, g: Math.round((new Date(m.dismesso) - oggi) / 864e5) }))
    .filter(x => x.g >= -3 && x.g < 400).sort((a, b) => a.g - b.g).slice(0, 8);
  if (!sc.length) {
    $("#deadlines").innerHTML = '<p style="font-size:13px;color:var(--ink-2)">Nessuna ' +
      glossifica("{dismissione|dismissione}") + ' annunciata. Quando un fornitore ne fissa una, compare qui con il conto alla rovescia.</p>';
    return;
  }
  $("#deadlines").innerHTML = sc.map(x =>
    '<div class="deadline"><span class="d" style="' + (x.g <= 30 ? "color:var(--crit)" : "") + '">' +
    (x.g < 0 ? "scaduto" : x.g === 0 ? "oggi" : x.g + " gg") + '</span>' +
    '<span class="t"><button class="minilink" type="button" data-dettaglio="' + esc(x.m.id) + '">' + esc(x.m.nome) + '</button> (' +
    esc(x.m.prov) + ') si spegne il ' + dataIt(x.m.dismesso) + '.</span></div>').join("");
}

function disegnaStatistiche() {
  const cp = conPrezzo(), ci = conIndice();
  const max = cp.length ? Math.max.apply(null, cp.map(m => m.out)) : 0;
  const min = cp.length ? Math.min.apply(null, cp.map(m => m.out)) : 0;
  const aperti = S.modelli.filter(m => m.lic === "aperto").length;
  const righe = [
    ["Con punteggio misurato", ci.length + " su " + S.modelli.length],
    ["Uscita più cara", soldi(max) + " / mln"],
    ["Uscita più economica", soldi(min) + " / mln"],
    ["Divario fra le due", min > 0 ? "×" + nf.format(Math.round(max / min)) : "—"],
    ["A pesi aperti", aperti + " (" + Math.round(aperti / S.modelli.length * 100) + "%)"],
    ["Con contesto ≥ 1 mln", S.modelli.filter(m => m.ctx >= 1000000).length]
  ];
  $("#stats").innerHTML = righe.map(([k, v]) =>
    '<div class="stat-row"><span class="k">' + esc(k) + '</span><span class="v">' + esc(String(v)) + '</span></div>').join("");
}

/* ============================================================
   CATALOGO — filtri che dicono sempre cosa stanno facendo
   ============================================================ */
function catLabel(k) {
  const c = ((S.statici && S.statici.categorie) || []).find(x => x.k === k);
  return c ? c.l : k;
}
const ETICHETTA_BUDGET = {
  tutti: "Qualsiasi prezzo", free: "Ha una versione gratuita",
  basso: "Economico (meno di 2 $)", medio: "Medio (fra 2 e 15 $)", alto: "Premium (più di 15 $)"
};
const ETICHETTA_ORDINE = {
  q: "dal punteggio più alto al più basso",
  prezzo: "dal più economico al più caro",
  nuovo: "dal più recente al più vecchio",
  ctx: "da chi tiene più testo a chi ne tiene meno"
};

function costruisciFiltri() {
  const seg = (items, sel) => items.map(i =>
    '<button type="button" data-v="' + i.k + '" aria-pressed="' + (i.k === sel) + '">' + esc(i.l) + '</button>').join("");
  $("#fCat").innerHTML = seg(S.statici.categorie, S.filtri.cat);
  $("#fLic").innerHTML = seg([{ k: "tutte", l: "Tutte" }, { k: "chiuso", l: "Solo via API" }, { k: "aperto", l: "Pesi aperti" }], S.filtri.lic);
  $("#fBudget").innerHTML = seg(Object.keys(ETICHETTA_BUDGET).map(k => ({ k: k, l: ETICHETTA_BUDGET[k] })), S.filtri.budget);
  $("#fSort").innerHTML = seg([
    { k: "q", l: "Punteggio" }, { k: "prezzo", l: "Prezzo" },
    { k: "nuovo", l: "Data di uscita" }, { k: "ctx", l: "Contesto" }
  ], S.filtri.sort);
}

function legaSeg(sel, chiave) {
  $(sel).addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if (!b || b.disabled) return;
    $$("button", $(sel)).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    S.filtri[chiave] = b.dataset.v;
    disegnaCatalogo();
  });
}

/* Applica i filtri uno alla volta, tenendo traccia di quanti modelli
   toglie ciascuno: serve a spiegare all'utente chi ha svuotato la lista. */
function filtraConDiagnosi() {
  const f = S.filtri;
  let r = S.modelli.slice();
  const passi = [];
  const applica = (nome, chiave, fn, valore) => {
    const prima = r.length;
    r = r.filter(fn);
    passi.push({ nome: nome, chiave: chiave, valore: valore, prima: prima, dopo: r.length });
  };
  if (f.cat !== "tutto") applica(catLabel(f.cat), "cat", m => m.cat.indexOf(f.cat) >= 0, f.cat);
  if (f.lic !== "tutte") applica(f.lic === "aperto" ? "Pesi aperti" : "Solo via API", "lic", m => m.lic === f.lic, f.lic);
  if (f.budget !== "tutti") {
    const test = {
      free: m => m.gratis,
      basso: m => aToken(m) && m.out < 2,
      medio: m => aToken(m) && m.out >= 2 && m.out <= 15,
      alto: m => aToken(m) && m.out > 15
    }[f.budget];
    applica(ETICHETTA_BUDGET[f.budget], "budget", test, f.budget);
  }
  if (f.q) {
    const t = f.q.toLowerCase();
    applica('Ricerca «' + f.q + '»', "q", m => (m.nome + " " + m.prov + " " + m.id).toLowerCase().indexOf(t) >= 0, f.q);
  }
  const ord = {
    q: (a, b) => (b.q == null ? -1 : b.q) - (a.q == null ? -1 : a.q),
    prezzo: (a, b) => (a.out == null ? Infinity : a.out) - (b.out == null ? Infinity : b.out),
    nuovo: (a, b) => new Date(b.rel || 0) - new Date(a.rel || 0),
    ctx: (a, b) => (b.ctx || 0) - (a.ctx || 0)
  };
  r.sort(ord[f.sort]);
  return { risultati: r, passi: passi };
}

/* I pulsanti del prezzo non hanno senso su categorie che non si pagano
   a token: invece di lasciarli cliccare e restituire il vuoto, li spengo
   e scrivo perche'. */
function aggiornaDisponibilitaBudget() {
  const f = S.filtri;
  const base = f.cat === "tutto" ? S.modelli : S.modelli.filter(m => m.cat.indexOf(f.cat) >= 0);
  const conTok = base.filter(aToken).length;
  const spegni = base.length > 0 && conTok === 0;
  $$("#fBudget button").forEach(b => {
    const off = spegni && b.dataset.v !== "tutti" && b.dataset.v !== "free";
    b.disabled = off;
    b.classList.toggle("spento", off);
    b.title = off ? "I modelli “" + catLabel(f.cat) + "” non si pagano a token, quindi non hanno un prezzo al milione da filtrare." : "";
  });
  const avviso = $("#avvisoBudget");
  if (spegni) {
    avviso.hidden = false;
    avviso.innerHTML = 'I modelli <b>' + esc(catLabel(f.cat)) + '</b> si pagano ' +
      glossifica("{unita|a clip o a carattere}") + ', non a token: i filtri di prezzo qui non si applicano.';
    if (["basso", "medio", "alto"].indexOf(f.budget) >= 0) {
      S.filtri.budget = "tutti";
      $$("#fBudget button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.v === "tutti")));
    }
  } else avviso.hidden = true;
}

function barraFiltriAttivi(passi) {
  const chip = (chiave, testo) =>
    '<button class="fchip" type="button" data-togli="' + chiave + '">' + esc(testo) + ' <span>×</span></button>';
  let h = "";
  if (passi.length) {
    h = '<span class="fchip-eti">Stai guardando</span>' +
      passi.map(p => chip(p.chiave, p.nome)).join("") +
      '<button class="fchip azzera" type="button" data-togli="tutto">Togli tutti i filtri</button>';
  }
  $("#filtriAttivi").innerHTML = h;
  $("#filtriAttivi").hidden = !passi.length;
}

function vuotoSpiegato(passi) {
  // Il colpevole e' il primo passo che ha azzerato la lista.
  const colpevole = passi.find(p => p.prima > 0 && p.dopo === 0);
  let h = '<div class="box vuoto" style="grid-column:1/-1">';
  h += '<h4 style="font-size:17px;margin-bottom:8px">Nessun modello con questa combinazione</h4>';
  if (colpevole) {
    const altri = passi.filter(p => p !== colpevole).map(p => p.nome);
    h += '<p style="max-width:56ch;margin:0 auto 6px">Il filtro <b>' + esc(colpevole.nome) + '</b> ha azzerato la lista' +
      (altri.length ? ' insieme a ' + esc(altri.join(" e ")) : '') + '.</p>';
    if (colpevole.chiave === "budget") {
      h += '<p style="max-width:56ch;margin:0 auto 14px;color:var(--ink-3)">Quasi sempre succede questo: i modelli di questa categoria ' +
        'non si pagano a token ma ' + glossifica("{unita|a clip, a immagine o a carattere}") + ', quindi un prezzo «al milione di token» per loro non esiste.</p>';
    } else {
      h += '<p style="max-width:56ch;margin:0 auto 14px;color:var(--ink-3)">Prova a toglierlo: il resto della selezione resta com\'è.</p>';
    }
    h += '<button class="ghost forte" type="button" data-togli="' + colpevole.chiave + '">Togli «' + esc(colpevole.nome) + '»</button> ';
  } else {
    h += '<p style="max-width:56ch;margin:0 auto 14px">Nessun modello corrisponde.</p>';
  }
  h += '<button class="ghost" type="button" data-togli="tutto">Ricomincia da capo</button></div>';
  return h;
}

function descrizioneBreve(m) {
  if (m.usa) return m.usa;
  const p = [];
  if (m.q != null) {
    if (m.q >= 50) p.push("fascia di vertice");
    else if (m.q >= 35) p.push("fascia alta");
    else if (m.q >= 20) p.push("fascia intermedia");
    else p.push("modello leggero");
  }
  if (m.cat.indexOf("ragiona") >= 0) p.push("ragiona passo passo");
  if (m.cat.indexOf("agente") >= 0) p.push("sa usare strumenti esterni");
  if (m.cat.indexOf("vista") >= 0) p.push("legge le immagini");
  if (m.cat.indexOf("documenti") >= 0) p.push("legge i PDF");
  if (m.ctx >= 1000000) p.push("contesto da un milione di token");
  return p.length ? titolo(p.join(", ")) + "." : "Genera testo, senza capacità aggiuntive dichiarate.";
}

function strisciaPrezzo(m, evidenzia) {
  const ev = c => evidenzia === c ? ' class="spicca"' : '';
  if (aToken(m)) {
    return '<div class="price-strip">' +
      '<div' + ev("inp") + '><div class="k">' + glossifica("{input|Entrata}") + ' / mln</div><div class="v">' + soldi(m.inp) + '</div></div>' +
      '<div' + ev("out") + '><div class="k">' + glossifica("{input|Uscita}") + ' / mln</div><div class="v">' + soldi(m.out) + '</div></div>' +
      '<div><div class="k">' + glossifica("{cache|Con cache}") + '</div><div class="v">' + (m.cache != null ? soldi(m.cache) : "—") + '</div></div>' +
      '</div>';
  }
  if (m.prezzo != null) {
    return '<div class="price-strip">' +
      '<div><div class="k">Prezzo</div><div class="v">' + soldi(m.prezzo) + '</div></div>' +
      '<div><div class="k">' + glossifica("{unita|Unità}") + '</div><div class="v" style="font-size:12px">' + esc(NOME_UNITA[m.unit] || "") + '</div></div></div>';
  }
  return '<div class="price-strip"><div><div class="k">Listino</div><div class="v" style="font-size:12.5px">Si scarica e si ospita</div></div></div>';
}

function disegnaCatalogo() {
  aggiornaDisponibilitaBudget();
  const { risultati: r, passi } = filtraConDiagnosi();
  barraFiltriAttivi(passi);

  $("#resCount").innerHTML = '<b>' + r.length + '</b> ' + (r.length === 1 ? "modello" : "modelli") +
    ' su ' + S.modelli.length + ' · ordinati ' + ETICHETTA_ORDINE[S.filtri.sort];
  $("#cmpCount").textContent = S.confronto.length ? S.confronto.length + "/4 nel confronto" : "";

  if (!r.length) { $("#modelGrid").innerHTML = vuotoSpiegato(passi); return; }

  // Se ordini per un valore che a molti manca, dillo invece di lasciar credere che sia rotto.
  const senza = { prezzo: r.filter(m => m.out == null).length, ctx: r.filter(m => !m.ctx).length, q: r.filter(m => m.q == null).length, nuovo: r.filter(m => !m.rel).length }[S.filtri.sort];
  const nota = senza > 0
    ? '<div class="nota-ordine">' + senza + ' di questi ' + (senza === 1 ? "non ha" : "non hanno") +
      ' questo dato, quindi ' + (senza === 1 ? "finisce" : "finiscono") + ' in fondo all\'elenco.</div>' : "";

  const evid = { prezzo: "out", q: null, nuovo: null, ctx: null }[S.filtri.sort];
  $("#modelGrid").innerHTML = nota + r.slice(0, 120).map(m => {
    const sel = S.confronto.indexOf(m.id) >= 0;
    const nuovo = m.rel && giorniDa(m.rel) < 30;
    const gg = m.dismesso ? Math.round((new Date(m.dismesso) - Date.now()) / 864e5) : null;
    return '<article class="mcard' + (sel ? ' sel' : '') + '" data-dettaglio="' + esc(m.id) + '" tabindex="0" role="button">' +
      '<div class="mcard-top"><div><h4>' + esc(m.nome) + '</h4>' +
        '<div class="prov">' + esc(m.prov) + (m.rel ? ' · ' + dataIt(m.rel) : '') + '</div></div>' +
        (m.q != null ? '<div class="qring"><div class="n">' + num(m.q) + '</div><div class="l">Indice</div></div>' : '') +
      '</div>' +
      '<div class="tags">' +
        (nuovo ? '<span class="chip hot">Novità</span>' : '') +
        (gg != null && gg < 90 ? '<span class="chip crit">Si spegne fra ' + gg + ' gg</span>' : '') +
        (m.lic === "aperto" ? '<span class="chip open">Pesi aperti</span>' : '') +
        (m.gratis ? '<span class="chip ok">Versione gratuita</span>' : '') +
        m.cat.slice(0, 4).map(c => '<span class="chip">' + esc(catLabel(c)) + '</span>').join("") +
        (m.ctx ? '<span class="chip">Contesto ' + ctxIt(m.ctx) + '</span>' : '') +
      '</div>' +
      strisciaPrezzo(m, evid) +
      '<p class="use"><b>In sintesi:</b> ' + esc(descrizioneBreve(m)) + '</p>' +
      (m.evita ? '<p class="use" style="color:var(--ink-3)"><b style="color:var(--ink-3)">Attenzione:</b> ' + esc(m.evita) + '</p>' : '') +
      '<footer>' +
        '<button class="ghost' + (sel ? ' on' : '') + '" type="button" data-cmp="' + esc(m.id) + '">' + (sel ? 'Nel confronto ✓' : 'Confronta') + '</button>' +
        '<span class="apri-scheda">Scheda completa →</span>' +
      '</footer></article>';
  }).join("") + (r.length > 120
    ? '<div class="box vuoto" style="grid-column:1/-1">Mostro i primi 120 di ' + r.length + '. Usa la ricerca o i filtri per restringere.</div>' : '');
}

/* ============================================================
   SCHEDA DI DETTAGLIO — il punto d'arrivo di ogni clic
   ============================================================ */
function apriDettaglio(id) {
  const m = S.modelli.find(x => x.id === id);
  if (!m) return;
  const d = $("#dettaglio");
  const gg = m.dismesso ? Math.round((new Date(m.dismesso) - Date.now()) / 864e5) : null;

  // Un paragrafo discorsivo, costruito dai dati, senza gergo.
  const frasi = [];
  frasi.push("**" + m.nome + "** è un modello di " + m.prov +
    (m.rel ? ", uscito il " + dataIt(m.rel) : "") + ".");
  if (m.q != null) {
    const fascia = m.q >= 50 ? "nella fascia di vertice" : m.q >= 35 ? "nella fascia alta" : m.q >= 20 ? "nella fascia intermedia" : "fra i modelli leggeri";
    const posto = conIndice().sort((a, b) => b.q - a.q).findIndex(x => x.id === m.id) + 1;
    frasi.push("Nelle prove indipendenti prende " + num(m.q) + " punti, che lo collocano " + fascia +
      (posto ? " — è il " + posto + "° fra quelli misurati" : "") + ".");
  } else {
    frasi.push("Nessun laboratorio indipendente lo ha ancora misurato, quindi sul suo livello si può solo andare a fiducia.");
  }
  if (aToken(m)) {
    const rapporto = m.inp > 0 ? Math.round(m.out / m.inp) : null;
    frasi.push("Farlo leggere costa " + soldi(m.inp) + " al milione di token, farlo scrivere " + soldi(m.out) +
      (rapporto && rapporto > 1 ? ": scrivere costa " + rapporto + " volte più che leggere, ed è la voce che pesa in bolletta." : "."));
    if (m.cache != null && m.inp > 0) {
      frasi.push("Se gli rimandi sempre lo stesso testo iniziale, la rilettura scende a " + soldi(m.cache) +
        " — il " + Math.round(m.cache / m.inp * 100) + "% del prezzo pieno.");
    }
  } else if (m.prezzo != null) {
    frasi.push("Non si paga a token ma " + (NOME_UNITA[m.unit] || "a consumo") + ": " + soldi(m.prezzo) + ".");
  } else {
    frasi.push("Non ha un listino a consumo: si scarica e lo fai girare su macchine tue, pagando hardware ed energia invece della bolletta di un fornitore.");
  }
  if (m.ctx) frasi.push("Tiene " + ctxIt(m.ctx) + " di token davanti agli occhi in una volta sola" +
    (m.ctx >= 1000000 ? ", abbastanza per un archivio intero" : "") + ".");
  if (m.lic === "aperto") frasi.push("È a pesi aperti: puoi scaricarlo, quindi i tuoi dati non devono uscire dall'azienda.");
  if (gg != null && gg >= 0) frasi.push("⚠️ Il fornitore lo spegne fra " + gg + " giorni, il " + dataIt(m.dismesso) + ": non costruirci sopra niente di nuovo.");

  const testo = frasi.join(" ").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  const voce = (etichetta, valore, termine) =>
    valore == null || valore === "—" ? "" :
    '<div class="dv"><div class="dk">' + (termine ? glossifica("{" + termine + "|" + etichetta + "}") : esc(etichetta)) +
    '</div><div class="dn">' + valore + '</div></div>';

  d.innerHTML =
    '<div class="dett-head">' +
      '<div><div class="eyebrow">' + esc(m.prov) + '</div><h3>' + esc(m.nome) + '</h3></div>' +
      '<button class="dett-x" type="button" aria-label="Chiudi">×</button>' +
    '</div>' +
    '<div class="dett-corpo">' +
      '<div class="tags" style="margin-bottom:14px">' +
        (m.lic === "aperto" ? '<span class="chip open">Pesi aperti</span>' : '<span class="chip">Solo via API</span>') +
        (m.gratis ? '<span class="chip ok">Versione gratuita</span>' : '') +
        (gg != null && gg < 90 ? '<span class="chip crit">Si spegne fra ' + gg + ' gg</span>' : '') +
        m.cat.map(c => '<span class="chip">' + esc(catLabel(c)) + '</span>').join("") +
      '</div>' +
      '<p class="dett-testo">' + testo + '</p>' +
      '<div class="dett-griglia">' +
        voce("Intelligenza", m.q != null ? num(m.q) + " / ~60" : null, "indice") +
        voce("Sul codice", m.qCod != null ? num(m.qCod) : null, "codicep") +
        voce("Sugli agenti", m.qAg != null ? num(m.qAg) : null, "agenticop") +
        voce("Entrata", aToken(m) ? soldi(m.inp) + " / mln" : null, "input") +
        voce("Uscita", aToken(m) ? soldi(m.out) + " / mln" : null, "input") +
        voce("Rilettura cache", m.cache != null ? soldi(m.cache) + " / mln" : null, "cache") +
        voce("Contesto", m.ctx ? ctxIt(m.ctx) + " token" : null, "contesto") +
        voce("Massimo in uscita", m.maxOut ? nf.format(m.maxOut) + " token" : null, "maxuscita") +
        voce("Prezzo", m.prezzo != null ? soldi(m.prezzo) + " " + (NOME_UNITA[m.unit] || "") : null, "unita") +
        voce("Fornitore", esc(m.prov), "fornitore") +
        voce("Uscito il", m.rel ? dataIt(m.rel) : null) +
        voce("Dismissione", m.dismesso ? dataIt(m.dismesso) : "nessuna annunciata", "dismissione") +
      '</div>' +
      (m.forte && m.forte.length ? '<div class="why" style="margin-top:16px"><b>Punti di forza</b>' + esc(m.forte.join(" · ")) + '</div>' : '') +
      (m.evita ? '<div class="why" style="margin-top:10px;border-left-color:var(--crit)"><b>Attenzione</b>' + esc(m.evita) + '</div>' : '') +
      (aToken(m) ? '<div class="why" style="margin-top:10px"><b>Cosa spenderesti</b>' + esc(esempioSpesa(m)) + '</div>' : '') +
    '</div>' +
    '<div class="dett-azioni">' +
      '<button class="ghost forte" type="button" data-cmp="' + esc(m.id) + '">' +
        (S.confronto.indexOf(m.id) >= 0 ? "Già nel confronto" : "Aggiungi al confronto") + '</button>' +
      '<button class="ghost" type="button" data-ask="' + esc(m.id) + '">Chiedi al Radar</button>' +
      (m.hf ? '<a class="ghost" href="https://huggingface.co/' + esc(m.hf) + '" target="_blank" rel="noopener">Scaricalo</a>' : '') +
      (m.origine === "openrouter" ? '<a class="ghost" href="https://openrouter.ai/' + esc(m.id) + '" target="_blank" rel="noopener">Listino ufficiale</a>' : '') +
    '</div>';

  $("#dettaglioSfondo").hidden = false;
  d.hidden = false;
  d.querySelector(".dett-x").addEventListener("click", chiudiDettaglio);
  d.scrollTop = 0;
}
function chiudiDettaglio() {
  $("#dettaglio").hidden = true;
  $("#dettaglioSfondo").hidden = true;
}
function esempioSpesa(m) {
  // Mille richieste da una paginetta ciascuna: un mese di lavoro leggero.
  const tIn = 1200 * 1.5, tOut = 400 * 1.5, req = 1000;
  const c = req * (tIn * m.inp + tOut * m.out) / 1e6;
  return "Mille richieste al mese da 1.200 parole in entrata e 400 in uscita — un uso leggero ma continuo — costerebbero circa " +
    costoIt(c) + " al mese. Nella sezione «Quanto costa» puoi metterci i tuoi numeri.";
}

/* ============================================================
   GRAFICI
   ============================================================ */
function tok(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
const tip = () => $("#tip");
function mostraTip(html, ev) {
  const t = tip(); t.innerHTML = html; t.style.opacity = "1";
  const r = t.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY - 12;
  if (x + r.width > innerWidth - 10) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 10) y = innerHeight - r.height - 10;
  t.style.left = Math.max(8, x) + "px"; t.style.top = Math.max(8, y) + "px";
}
function nascondiTip() { tip().style.opacity = "0"; }
function svgApri(w, h) {
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="min-width:' +
    Math.min(w, 660) + 'px;max-width:' + w + 'px" role="img">';
}
/* Ogni marca dei grafici e' cliccabile e apre la scheda del modello. */
function legaMarche(host) {
  $$("[data-tip]", host).forEach(el => {
    el.addEventListener("mousemove", ev => mostraTip(el.dataset.tip, ev));
    el.addEventListener("mouseleave", nascondiTip);
    if (el.dataset.mod) {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => { nascondiTip(); apriDettaglio(el.dataset.mod); });
    }
  });
}
function tipHTML(m) {
  return esc('<b>' + m.nome + '</b><span class="m">' + m.prov + ' · ' + (m.lic === "aperto" ? "pesi aperti" : "solo via API") +
    '</span><br><span class="m">' + (m.q != null ? "Punteggio " + m.q + "<br>" : "") +
    (aToken(m) ? "Entrata " + soldi(m.inp) + " · Uscita " + soldi(m.out) + "<br>" : "") +
    (m.ctx ? "Contesto " + ctxIt(m.ctx) : "") + '</span><br><span class="m2">clicca per la scheda</span>');
}

function disegnaMappa() {
  const host = $("#scatter"); if (!host) return;
  const d = conIndice().filter(m => m.out > 0);
  if (d.length < 3) { host.innerHTML = '<p class="vuoto">Servono più modelli con punteggio misurato.</p>'; return; }
  const W = 900, H = 470, L = 62, R = 26, T = 22, B = 58;
  const pw = W - L - R, ph = H - T - B;
  const prezzi = d.map(m => m.out);
  const x0 = Math.log10(Math.min.apply(null, prezzi) * 0.7), x1 = Math.log10(Math.max.apply(null, prezzi) * 1.4);
  const X = v => L + (Math.log10(v) - x0) / (x1 - x0) * pw;
  const qs = d.map(m => m.q);
  const y0 = Math.floor(Math.min.apply(null, qs) / 5) * 5 - 2, y1 = Math.ceil(Math.max.apply(null, qs) / 5) * 5 + 2;
  const Y = v => T + (1 - (v - y0) / (y1 - y0)) * ph;
  const grid = tok("--grid"), axis = tok("--axis"), ink2 = tok("--ink-2"), ink3 = tok("--ink-3"), surf = tok("--surface");
  let s = svgApri(W, H);

  const passo = Math.max(5, Math.round((y1 - y0) / 6 / 5) * 5);
  for (let q = Math.ceil(y0 / passo) * passo; q <= y1; q += passo) {
    s += '<line x1="' + L + '" y1="' + Y(q) + '" x2="' + (W - R) + '" y2="' + Y(q) + '" stroke="' + grid + '" stroke-width="1"/>';
    s += '<text x="' + (L - 10) + '" y="' + (Y(q) + 4) + '" text-anchor="end" font-size="11" fill="' + ink3 + '" font-family="JetBrains Mono, monospace">' + q + '</text>';
  }
  [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 200].forEach(v => {
    if (Math.log10(v) < x0 || Math.log10(v) > x1) return;
    s += '<line x1="' + X(v) + '" y1="' + T + '" x2="' + X(v) + '" y2="' + (H - B) + '" stroke="' + grid + '" stroke-width="1"/>';
    s += '<text x="' + X(v) + '" y="' + (H - B + 18) + '" text-anchor="middle" font-size="11" fill="' + ink3 + '" font-family="JetBrains Mono, monospace">' + soldi(v) + '</text>';
  });
  s += '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="' + axis + '" stroke-width="1"/>';
  s += '<text x="' + (L + pw / 2) + '" y="' + (H - 14) + '" text-anchor="middle" font-size="12" fill="' + ink2 + '">Costo per far scrivere un milione di token — ogni tacca vale dieci volte la precedente →</text>';
  s += '<text transform="translate(16,' + (T + ph / 2) + ') rotate(-90)" text-anchor="middle" font-size="12" fill="' + ink2 + '">Punteggio di intelligenza →</text>';

  const medQ = qs.slice().sort((a, b) => a - b)[Math.floor(qs.length / 2)];
  const medP = prezzi.slice().sort((a, b) => a - b)[Math.floor(prezzi.length / 2)];
  s += '<rect x="' + L + '" y="' + T + '" width="' + (X(medP) - L) + '" height="' + (Y(medQ) - T) + '" fill="' + tok("--s1") + '" opacity="0.07"/>';
  s += '<text x="' + (L + 9) + '" y="' + (T + 17) + '" font-size="11" fill="' + ink3 + '" font-family="JetBrains Mono, monospace">ZONA AFFARE</text>';

  const etich = {};
  d.slice().sort((a, b) => b.q - a.q).slice(0, 6).forEach(m => etich[m.id] = 1);
  d.slice().sort((a, b) => a.out - b.out).slice(0, 3).forEach(m => etich[m.id] = 1);
  d.slice().sort((a, b) => (b.q / Math.max(b.out, 0.01)) - (a.q / Math.max(a.out, 0.01))).slice(0, 3).forEach(m => etich[m.id] = 1);

  d.forEach(m => {
    const sel = S.confronto.indexOf(m.id) >= 0;
    s += '<circle cx="' + X(m.out) + '" cy="' + Y(m.q) + '" r="' + (sel ? 9 : 7) + '" fill="' +
      (m.lic === "aperto" ? tok("--s2") : tok("--s1")) + '" stroke="' + (sel ? tok("--acido") : surf) +
      '" stroke-width="' + (sel ? 3 : 2) + '" data-mod="' + esc(m.id) + '" data-tip="' + tipHTML(m) + '"/>';
  });
  d.forEach(m => {
    if (!etich[m.id]) return;
    const cx = X(m.out), cy = Y(m.q);
    const dx = cx > W - 210 ? -11 : 11, anc = cx > W - 210 ? "end" : "start";
    s += '<text x="' + (cx + dx) + '" y="' + (cy + 4) + '" text-anchor="' + anc + '" font-size="11.5" fill="' + ink2 +
      '" stroke="' + surf + '" stroke-width="3" paint-order="stroke" font-weight="600" pointer-events="none">' + esc(m.nome) + '</text>';
  });
  s += '</svg>';
  host.innerHTML = s;
  legaMarche(host);
}

function disegnaClassifica() {
  const host = $("#rank"); if (!host) return;
  const d = conIndice().sort((a, b) => b.q - a.q).slice(0, 20);
  if (!d.length) { host.innerHTML = ""; return; }
  const rowH = 27, L = 210, R = 130, T = 14, B = 14, W = 900;
  const H = T + d.length * rowH + B, pw = W - L - R, max = d[0].q;
  const ink = tok("--ink"), ink2 = tok("--ink-2"), ink3 = tok("--ink-3");
  let s = svgApri(W, H);
  d.forEach((m, i) => {
    const y = T + i * rowH, w = Math.max(2, m.q / max * pw);
    s += '<text x="' + (L - 10) + '" y="' + (y + 16) + '" text-anchor="end" font-size="11.5" fill="' + (i === 0 ? ink : ink2) + '" font-weight="' + (i === 0 ? 700 : 400) + '">' + esc(m.nome) + '</text>';
    s += '<rect x="' + L + '" y="' + (y + 5) + '" width="' + w + '" height="15" rx="4" fill="' +
      (m.lic === "aperto" ? tok("--s2") : tok("--s1")) + '" data-mod="' + esc(m.id) + '" data-tip="' + tipHTML(m) + '"/>';
    s += '<text x="' + (L + w + 9) + '" y="' + (y + 17) + '" font-size="11.5" fill="' + ink3 + '" font-family="JetBrains Mono, monospace" pointer-events="none">' +
      num(m.q) + ' · ' + soldi(m.out) + '/mln</text>';
  });
  s += '</svg>';
  host.innerHTML = s;
  legaMarche(host);
}

function disegnaTempo() {
  const host = $("#timeline"); if (!host) return;
  const limite = Date.now() - 240 * 864e5;
  const d = S.modelli.filter(m => m.rel && new Date(m.rel).getTime() > limite && (m.q != null || giorniDa(m.rel) < 60))
    .sort((a, b) => new Date(a.rel) - new Date(b.rel));
  if (d.length < 2) { host.innerHTML = '<p class="vuoto">Non ci sono abbastanza uscite recenti da mostrare.</p>'; return; }
  const W = 900, T = 30, B = 46, laneH = 21, L = 20, R = 20, pw = W - L - R;
  const t0 = new Date(d[0].rel).getTime(), t1 = Date.now();
  const X = t => L + (t - t0) / (t1 - t0) * pw;
  const corsie = [];
  const pos = d.map(m => {
    const x = X(new Date(m.rel).getTime()), larg = m.nome.length * 6.1 + 18;
    let k = 0;
    while (corsie[k] != null && corsie[k] > x - larg) k++;
    corsie[k] = x;
    return { m: m, x: x, lane: k };
  });
  const H = T + corsie.length * laneH + B, baseY = H - B + 6;
  const grid = tok("--grid"), ink2 = tok("--ink-2"), ink3 = tok("--ink-3"), surf = tok("--surface");
  let s = svgApri(W, H);
  s += '<line x1="' + L + '" y1="' + baseY + '" x2="' + (W - R) + '" y2="' + baseY + '" stroke="' + tok("--axis") + '" stroke-width="2"/>';
  const inizio = new Date(t0); inizio.setDate(1);
  for (let c = new Date(inizio); c.getTime() <= t1; c.setMonth(c.getMonth() + 1)) {
    const x = X(c.getTime());
    if (x < L || x > W - R) continue;
    s += '<line x1="' + x + '" y1="' + T + '" x2="' + x + '" y2="' + baseY + '" stroke="' + grid + '" stroke-width="1"/>';
    s += '<text x="' + (x + 5) + '" y="' + (baseY + 18) + '" font-size="11" fill="' + ink3 + '" font-family="JetBrains Mono, monospace">' +
      MESI[c.getMonth()] + (c.getMonth() === 0 ? " " + String(c.getFullYear()).slice(2) : "") + '</text>';
  }
  pos.forEach(p => {
    const y = T + p.lane * laneH;
    s += '<line x1="' + p.x + '" y1="' + (y + 7) + '" x2="' + p.x + '" y2="' + baseY + '" stroke="' + grid + '" stroke-width="1"/>';
    s += '<circle cx="' + p.x + '" cy="' + (y + 7) + '" r="5.5" fill="' + (p.m.lic === "aperto" ? tok("--s2") : tok("--s1")) +
      '" stroke="' + surf + '" stroke-width="2" data-mod="' + esc(p.m.id) + '" data-tip="' + tipHTML(p.m) + '"/>';
    s += '<text x="' + (p.x + 9) + '" y="' + (y + 11) + '" font-size="10.5" fill="' + ink2 + '" stroke="' + surf +
      '" stroke-width="3" paint-order="stroke" pointer-events="none">' + esc(p.m.nome) + '</text>';
  });
  s += '</svg>';
  host.innerHTML = s;
  legaMarche(host);
}

function disegnaRisparmio() {
  const host = $("#saveChart"); if (!host || !S.statici) return;
  const d = S.statici.tecniche.slice().sort((a, b) => (b.min + b.max) - (a.min + a.max));
  const rowH = 40, L = 230, R = 34, T = 30, B = 40, W = 900;
  const H = T + d.length * rowH + B, pw = W - L - R;
  const X = v => L + v / 100 * pw;
  const grid = tok("--grid"), ink = tok("--ink"), ink2 = tok("--ink-2"), ink3 = tok("--ink-3"), surf = tok("--surface");
  let s = svgApri(W, H);
  for (let v = 0; v <= 100; v += 25) {
    s += '<line x1="' + X(v) + '" y1="' + (T - 8) + '" x2="' + X(v) + '" y2="' + (T + d.length * rowH - 8) + '" stroke="' + grid + '" stroke-width="1"/>';
    s += '<text x="' + X(v) + '" y="' + (T - 14) + '" text-anchor="middle" font-size="11" fill="' + ink3 + '" font-family="JetBrains Mono, monospace">' + v + '%</text>';
  }
  d.forEach((t, i) => {
    const y = T + i * rowH, x1 = X(t.min), x2 = X(t.max);
    s += '<text x="' + (L - 12) + '" y="' + (y + 9) + '" text-anchor="end" font-size="12.5" fill="' + ink + '" font-weight="600">' + esc(t.nome) + '</text>';
    s += '<text x="' + (L - 12) + '" y="' + (y + 23) + '" text-anchor="end" font-size="10.5" fill="' + ink3 + '" font-family="JetBrains Mono, monospace">' + esc(t.diff.toUpperCase()) + '</text>';
    s += '<rect x="' + x1 + '" y="' + (y - 2) + '" width="' + Math.max(3, x2 - x1) + '" height="15" rx="4" fill="' + tok("--s1") + '"/>';
    s += '<circle cx="' + x1 + '" cy="' + (y + 5.5) + '" r="5" fill="' + tok("--s1") + '" stroke="' + surf + '" stroke-width="2"/>';
    s += '<circle cx="' + x2 + '" cy="' + (y + 5.5) + '" r="5" fill="' + tok("--s1") + '" stroke="' + surf + '" stroke-width="2"/>';
    s += '<text x="' + (x2 + 11) + '" y="' + (y + 10) + '" font-size="12" font-weight="700" fill="' + ink2 + '" font-family="JetBrains Mono, monospace">' +
      (t.min === t.max ? t.min + "%" : t.min + "–" + t.max + "%") + '</text>';
  });
  s += '</svg>';
  host.innerHTML = s;
}

/* ============================================================
   CONFRONTO — ogni voce spiegata
   ============================================================ */
const RIGHE_CMP = [
  ["Fornitore", "fornitore", m => esc(m.prov)],
  ["Uscito il", null, m => m.rel ? dataIt(m.rel) : "n.d."],
  ["Punteggio di intelligenza", "indice", m => m.q != null ? num(m.q) + " / ~60" : "non misurato"],
  ["Punteggio sul codice", "codicep", m => m.qCod != null ? num(m.qCod) : "—"],
  ["Punteggio sugli agenti", "agenticop", m => m.qAg != null ? num(m.qAg) : "—"],
  ["Licenza", "aperto", m => m.lic === "aperto" ? "Pesi aperti (scaricabile)" : "Solo via API"],
  ["Sa fare", null, m => m.cat.map(catLabel).join(", ") || "—"],
  ["Costo in entrata", "input", m => aToken(m) ? soldi(m.inp) + " / mln token" : (m.prezzo != null ? soldi(m.prezzo) + " " + (NOME_UNITA[m.unit] || "") : "—")],
  ["Costo in uscita", "input", m => aToken(m) ? soldi(m.out) + " / mln token" : "—"],
  ["Rilettura cache", "cache", m => m.cache != null ? soldi(m.cache) + " / mln token" : "—"],
  ["Finestra di contesto", "contesto", m => ctxIt(m.ctx) + (m.ctx ? " token" : "")],
  ["Massimo in uscita", "maxuscita", m => m.maxOut ? nf.format(m.maxOut) + " token" : "n.d."],
  ["Versione gratuita", null, m => m.gratis ? "Sì" : "No"],
  ["Dismissione annunciata", "dismissione", m => m.dismesso ? dataIt(m.dismesso) : "nessuna"],
  ["In sintesi", null, m => esc(descrizioneBreve(m))]
];

function riempiSelect() {
  const sel = $("#cmpAdd");
  const ord = S.modelli.slice().sort((a, b) => (b.q == null ? -1 : b.q) - (a.q == null ? -1 : a.q));
  sel.innerHTML = '<option value="">Scegli un modello…</option>' + ord.map(m =>
    '<option value="' + esc(m.id) + '"' + (S.confronto.indexOf(m.id) >= 0 ? ' disabled' : '') + '>' +
    esc(m.nome + " — " + m.prov) + '</option>').join("");
}

function disegnaConfronto() {
  const ms = S.confronto.map(id => S.modelli.find(m => m.id === id)).filter(Boolean);
  $("#cmpEmpty").hidden = ms.length > 0;
  $("#cmpWrap").hidden = ms.length === 0;
  if (!ms.length) return;

  let h = '<thead><tr><th>Voce</th>' + ms.map(m =>
    '<th><button class="minilink" type="button" data-dettaglio="' + esc(m.id) + '">' + esc(m.nome) + '</button></th>').join("") + '</tr></thead><tbody>';
  RIGHE_CMP.forEach(([k, termine, f]) => {
    h += '<tr><td>' + (termine ? glossifica("{" + termine + "|" + k + "}") : esc(k)) + '</td>' +
      ms.map(m => {
        const v = String(f(m));
        return '<td' + (/^[$\d]/.test(v) ? ' class="num"' : '') + '>' + v + '</td>';
      }).join("") + '</tr>';
  });
  $("#cmpTable").innerHTML = h + '</tbody>';

  const host = $("#cmpChart");
  const cp = ms.filter(aToken);
  if (!cp.length) {
    host.innerHTML = '<p class="note" style="margin:0">Nessuno dei modelli scelti ha un listino per token: sono a pesi aperti, oppure si pagano ' +
      glossifica("{unita|a immagine, a clip o a carattere}") + '. Il confronto di prezzo si legge nella tabella.</p>';
    return;
  }
  const serie = [tok("--s1"), tok("--s2"), tok("--s3"), tok("--s4")];
  const W = 880, L = 140, R = 30, T = 34, B = 30, gruppoH = 66;
  const H = T + cp.length * gruppoH + B, pw = W - L - R;
  const max = Math.max.apply(null, cp.map(m => m.out)) || 1;
  const X = v => Math.max(2, v / max * pw);
  const ink = tok("--ink"), ink3 = tok("--ink-3");
  let s = svgApri(W, H);
  s += '<text x="' + L + '" y="' + (T - 14) + '" font-size="11" fill="' + ink3 + '" font-family="JetBrains Mono, monospace">DOLLARI PER MILIONE DI TOKEN</text>';
  cp.forEach((m, i) => {
    const y = T + i * gruppoH, col = serie[S.confronto.indexOf(m.id) % 4];
    s += '<text x="' + (L - 12) + '" y="' + (y + 24) + '" text-anchor="end" font-size="12.5" font-weight="700" fill="' + ink + '">' + esc(m.nome) + '</text>';
    s += '<rect x="' + L + '" y="' + y + '" width="' + X(m.inp) + '" height="18" rx="4" fill="' + col + '" opacity="0.45"/>';
    s += '<text x="' + (L + X(m.inp) + 8) + '" y="' + (y + 13) + '" font-size="11.5" font-weight="700" fill="' + ink + '" font-family="JetBrains Mono, monospace">' + soldi(m.inp) + ' per leggere</text>';
    s += '<rect x="' + L + '" y="' + (y + 22) + '" width="' + X(m.out) + '" height="18" rx="4" fill="' + col + '"/>';
    s += '<text x="' + (L + X(m.out) + 8) + '" y="' + (y + 35) + '" font-size="11.5" font-weight="700" fill="' + ink + '" font-family="JetBrains Mono, monospace">' + soldi(m.out) + ' per scrivere</text>';
  });
  s += '</svg>';
  host.innerHTML = s;
}

/* ============================================================
   CALCOLATORE
   ============================================================ */
function costruisciScenari() {
  $("#cPreset").innerHTML = S.statici.scenari.map(p =>
    '<button type="button" data-p="' + p.k + '">' + esc(p.l) + '</button>').join("");
  $("#cCache").innerHTML =
    '<button type="button" data-c="no" aria-pressed="true">Senza cache</button>' +
    '<button type="button" data-c="si" aria-pressed="false">Con cache sul testo fisso</button>';
}

function calcolaCosti() {
  if (!S.statici || !S.modelli.length) return;
  const req = +$("#cReq").value, pin = +$("#cIn").value, pout = +$("#cOut").value;
  $("#cReqV").textContent = nf.format(req);
  $("#cInV").textContent = nf.format(pin) + " parole";
  $("#cOutV").textContent = nf.format(pout) + " parole";

  const tIn = pin * 1.5, tOut = pout * 1.5;
  const d = conPrezzo().map(m => {
    const costoIn = (S.usaCache && m.cache != null)
      ? (tIn * 0.7 * m.cache + tIn * 0.3 * m.inp) / 1e6 : tIn * m.inp / 1e6;
    return { m: m, costo: req * (costoIn + tOut * m.out / 1e6) };
  }).sort((a, b) => a.costo - b.costo);
  if (!d.length) return;

  $("#costLede").innerHTML = glossifica(
    nf.format(req) + ' richieste al mese, ' + nf.format(pin) + ' parole in entrata e ' + nf.format(pout) +
    ' in uscita ciascuna — cioè circa ' + nf.format(Math.round(tIn)) + ' e ' + nf.format(Math.round(tOut)) + ' {token|token}. ' +
    (S.usaCache
      ? 'Ipotesi: il 70% del testo in entrata è sempre lo stesso e viene riletto dalla {cache|cache}.'
      : 'Nessuna ottimizzazione applicata — è lo scenario più caro possibile.'));

  const conQ = d.filter(x => x.m.q != null);
  const mostra = (conQ.length >= 12 ? conQ : d).slice(0, 16);
  const W = 900, L = 190, R = 108, T = 16, rowH = 27, B = 26;
  const H = T + mostra.length * rowH + B, pw = W - L - R;
  const max = Math.max.apply(null, mostra.map(x => x.costo)) || 1;
  const ink = tok("--ink"), ink2 = tok("--ink-2"), ink3 = tok("--ink-3");
  let s = svgApri(W, H);
  mostra.forEach((x, i) => {
    const y = T + i * rowH, w = Math.max(2, x.costo / max * pw), primo = i === 0;
    s += '<text x="' + (L - 10) + '" y="' + (y + 16) + '" text-anchor="end" font-size="11.5" fill="' + (primo ? ink : ink2) + '" font-weight="' + (primo ? 700 : 400) + '">' + esc(x.m.nome) + '</text>';
    s += '<rect x="' + L + '" y="' + (y + 5) + '" width="' + w + '" height="15" rx="4" fill="' +
      (x.m.lic === "aperto" ? tok("--s2") : tok("--s1")) + '" opacity="' + (primo ? 1 : 0.72) + '" data-mod="' + esc(x.m.id) + '" data-tip="' +
      esc('<b>' + x.m.nome + '</b><span class="m">' + x.m.prov + '</span><br><span class="m">' + costoIt(x.costo) + ' al mese · ' + costoIt(x.costo * 12) + " all'anno" + '</span><br><span class="m2">clicca per la scheda</span>') + '"/>';
    s += '<text x="' + (L + w + 9) + '" y="' + (y + 17) + '" font-size="11.5" fill="' + (primo ? ink : ink3) + '" font-weight="' + (primo ? 700 : 500) + '" font-family="JetBrains Mono, monospace" pointer-events="none">' + costoIt(x.costo) + '</text>';
  });
  s += '</svg>';
  $("#costChart").innerHTML = s;
  legaMarche($("#costChart"));

  const caro = d[d.length - 1], eco = d[0];
  $("#costTitle").textContent = "Da " + costoIt(eco.costo) + " a " + costoIt(caro.costo) + " al mese, per lo stesso lavoro";
  $("#costTable").innerHTML = '<thead><tr><th>Modello</th><th>' + glossifica("{fornitore|Fornitore}") + '</th><th>Al mese</th><th>All\'anno</th><th>Rispetto al minimo</th><th>' + glossifica("{indice|Punteggio}") + '</th></tr></thead><tbody>' +
    d.slice(0, 60).map(x => '<tr><td><button class="minilink" type="button" data-dettaglio="' + esc(x.m.id) + '">' + esc(x.m.nome) + '</button></td><td>' + esc(x.m.prov) + '</td>' +
      '<td class="num">' + costoIt(x.costo) + '</td><td class="num">' + costoIt(x.costo * 12) + '</td>' +
      '<td class="num">×' + (x.costo / Math.max(eco.costo, 1e-9)).toFixed(1).replace(".", ",") + '</td>' +
      '<td class="num">' + (x.m.q != null ? num(x.m.q) : "—") + '</td></tr>').join("") + '</tbody>';
}

/* ============================================================
   GLOSSARIO
   ============================================================ */
function glossifica(html) {
  return String(html).replace(/\{([a-z]+)\|([^}]+)\}/g, (_, k, txt) =>
    (S.statici && S.statici.glossario[k])
      ? '<button class="gl" type="button" data-g="' + k + '">' + txt + '</button>' : txt);
}

function disegnaGlossario() {
  const g = S.statici.glossario;
  $("#glossGrid").innerHTML = Object.keys(g).map(k => {
    const v = g[k];
    return '<article class="box">' +
      '<div style="font-family:var(--mono);font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--s2);margin-bottom:5px">' + esc(v.k) + '</div>' +
      '<h4 style="font-size:16.5px;font-weight:800;margin-bottom:6px">' + esc(v.n) + '</h4>' +
      '<p style="font-size:13.5px;color:var(--ink-2)">' + esc(v.d) + '</p>' +
      '<div style="margin-top:9px;font-size:13px;background:var(--surface-sunk);padding:9px 11px;border-radius:6px">' + esc(v.e) + '</div>' +
      '</article>';
  }).join("");
}

let pop = null;
function chiudiPop() { if (pop) { pop.remove(); pop = null; } }
function apriPop(b) {
  const g = S.statici && S.statici.glossario[b.dataset.g];
  if (!g) return;
  chiudiPop();
  pop = document.createElement("div");
  pop.className = "pop";
  pop.innerHTML = '<button class="x" type="button" aria-label="Chiudi">×</button>' +
    '<div class="kind">' + esc(g.k) + '</div><h5>' + esc(g.n) + '</h5>' +
    '<p>' + esc(g.d) + '</p><div class="ex"><b>In pratica:</b> ' + esc(g.e) + '</div>' +
    '<div class="more"><button class="ghost" type="button" data-ask-term="' + esc(g.n) + '">Fammi un altro esempio</button></div>';
  document.body.appendChild(pop);
  const r = b.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  let x = r.left, y = r.bottom + 9;
  if (x + pr.width > innerWidth - 12) x = innerWidth - pr.width - 12;
  if (y + pr.height > innerHeight - 12) y = Math.max(12, r.top - pr.height - 9);
  pop.style.left = Math.max(12, x) + "px"; pop.style.top = y + "px";
  pop.querySelector(".x").addEventListener("click", chiudiPop);
  pop.querySelector("[data-ask-term]").addEventListener("click", ev => {
    const n = ev.target.dataset.askTerm;
    chiudiPop();
    chiedi('Fammi un altro esempio concreto per spiegare "' + n + '" a chi non è tecnico. Massimo 4 righe.');
  });
}

function disegnaTecniche() {
  $("#techGrid").innerHTML = S.statici.tecniche.map(t =>
    '<article class="tech">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">' +
        '<div class="save">' + (t.min === t.max ? t.min + "%" : t.min + "–" + t.max + "%") + '</div>' +
        '<span class="chip">' + esc(t.diff) + '</span></div>' +
      '<h4>' + esc(t.nome) + '</h4><p>' + esc(t.cosa) + '</p>' +
      '<div class="how"><b>Come si fa</b>' + esc(t.come) + '</div></article>').join("");
}

function disegnaPaper() {
  if (!S.paper.length) { $("#papers").innerHTML = '<p class="vuoto">Elenco non disponibile in questa vista.</p>'; return; }
  $("#papers").innerHTML = S.paper.map(p =>
    '<div class="paper"><span class="id">' + esc(p.data) + '</span>' +
      '<span><a class="t" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.titolo) + '</a>' +
      (p.sommario ? '<div class="s">' + esc(p.sommario) + '…</div>' : '') + '</span></div>').join("");
}

/* ============================================================
   CHAT — con la tua chiave, dentro la pagina
   ============================================================ */
const FORNITORI_CHAT = {
  openrouter: {
    nome: "OpenRouter",
    sommario: "Una chiave sola per parlare con quasi tutti i modelli di questa pagina, compresi quelli gratuiti.",
    dove: "https://openrouter.ai/keys",
    prefisso: "sk-or-",
    aiuto: "Registrati, apri «Keys», crea una chiave e incollala qui. Ci sono modelli con «(free)» nel nome che non costano nulla.",
    modelliDaCatalogo: true,
    difetto: "z-ai/glm-4.6:free"
  },
  gemini: {
    nome: "Google Gemini",
    sommario: "Il piano gratuito di Google basta per un uso personale.",
    dove: "https://aistudio.google.com/apikey",
    prefisso: "AIza",
    aiuto: "Apri Google AI Studio, premi «Get API key», crea la chiave e incollala qui. Consiglio: limita la chiave al dominio di questa pagina, dalle impostazioni Google.",
    modelli: ["gemini-2.5-flash", "gemini-3.8-flash", "gemini-2.5-flash-lite"],
    difetto: "gemini-2.5-flash"
  },
  openai: {
    nome: "OpenAI (ChatGPT)",
    sommario: "Serve un account con credito: OpenAI non ha un piano gratuito per le chiavi.",
    dove: "https://platform.openai.com/api-keys",
    prefisso: "sk-",
    aiuto: "Apri la pagina delle chiavi, creane una nuova e incollala qui. Ricorda che ogni domanda consuma credito.",
    modelli: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5-nano"],
    difetto: "gpt-5.6-luna"
  }
};
const CHIAVE_MEM = "radar-ai-chat";

function leggiConfigChat() {
  try {
    const v = JSON.parse(localStorage.getItem(CHIAVE_MEM) || "null");
    if (v && v.fornitore) { S.chat.fornitore = v.fornitore; S.chat.chiave = v.chiave || ""; S.chat.modello = v.modello || ""; }
  } catch (_) { }
}
function salvaConfigChat() {
  try {
    localStorage.setItem(CHIAVE_MEM, JSON.stringify({
      fornitore: S.chat.fornitore, chiave: S.chat.chiave, modello: S.chat.modello
    }));
  } catch (_) { }
}
function dimenticaChat() {
  try { localStorage.removeItem(CHIAVE_MEM); } catch (_) { }
  S.chat = { fornitore: null, chiave: "", modello: "", storico: [] };
  disegnaChat();
}

let sampleClaude = null, sampleProvato = false;
async function claudeDisponibile() {
  if (sampleProvato) return sampleClaude;
  sampleProvato = true;
  try { sampleClaude = (window.claude && typeof window.claude.use === "function") ? await window.claude.use("sample") : null; }
  catch (_) { sampleClaude = null; }
  return sampleClaude;
}

function modelliChat() {
  const f = FORNITORI_CHAT[S.chat.fornitore];
  if (!f) return [];
  if (f.modelliDaCatalogo) {
    const gratis = S.modelli.filter(m => m.gratis && m.origine === "openrouter");
    const buoni = conIndice().sort((a, b) => b.q - a.q).slice(0, 25);
    const visti = {};
    return gratis.concat(buoni).filter(m => { if (visti[m.id]) return false; visti[m.id] = 1; return true; })
      .map(m => ({ id: m.id, eti: m.nome + (m.gratis ? " — gratis" : (m.out != null ? " — " + soldi(m.out) + "/mln" : "")) }));
  }
  return (f.modelli || []).map(id => ({ id: id, eti: id }));
}

function disegnaChat() {
  const zona = $("#chatZona");
  const cfg = S.chat.fornitore && S.chat.chiave;

  if (!cfg && S.chat.fornitore !== "claude") {
    // schermata di preparazione
    zona.innerHTML =
      '<div class="setup">' +
        '<p class="setup-intro">Per rispondere qui dentro serve una <b>chiave</b> — ' +
          glossifica("{chiave|cos\'è una chiave?}") + ' — del servizio che preferisci. ' +
          'Resta salvata <b>solo dentro il tuo browser</b>: non viene mai spedita a me, né a GitHub, né a nessun altro. Va solo al fornitore che scegli.</p>' +
        '<div id="claudePronto"></div>' +
        Object.keys(FORNITORI_CHAT).map(k => {
          const f = FORNITORI_CHAT[k];
          const on = S.chat.fornitore === k;
          return '<div class="setup-opz' + (on ? ' aperta' : '') + '">' +
            '<button class="setup-testa" type="button" data-forn="' + k + '">' +
              '<span><b>' + esc(f.nome) + '</b><small>' + esc(f.sommario) + '</small></span>' +
              '<span class="freccia">' + (on ? "−" : "+") + '</span></button>' +
            (on ? '<div class="setup-corpo">' +
              '<p class="setup-aiuto">' + esc(f.aiuto) + '</p>' +
              '<a class="ghost" href="' + esc(f.dove) + '" target="_blank" rel="noopener">Prendi la chiave su ' + esc(f.nome) + ' ↗</a>' +
              '<div class="setup-riga">' +
                '<input type="password" id="campoChiave" placeholder="Incolla qui la chiave (inizia con ' + esc(f.prefisso) + '…)" autocomplete="off" spellcheck="false">' +
                '<button class="btn-agg" type="button" id="salvaChiave">Salva</button>' +
              '</div>' +
              '<div id="esitoChiave" class="setup-esito" hidden></div>' +
            '</div>' : '') +
          '</div>';
        }).join("") +
      '</div>';

    claudeDisponibile().then(s => {
      const box = $("#claudePronto");
      if (!box) return;
      if (s) {
        box.innerHTML = '<div class="setup-opz pronto"><button class="setup-testa" type="button" data-forn="claude">' +
          '<span><b>Claude — già pronto</b><small>Nessuna chiave da inserire: stai leggendo questa pagina dentro Claude.</small></span>' +
          '<span class="freccia">→</span></button></div>';
      }
    });
    return;
  }

  // pannello di conversazione
  const nomeF = S.chat.fornitore === "claude" ? "Claude" : FORNITORI_CHAT[S.chat.fornitore].nome;
  const mods = S.chat.fornitore === "claude" ? [] : modelliChat();
  zona.innerHTML =
    '<div class="chat-barra">' +
      '<span class="chat-chi">' + esc(nomeF) + '</span>' +
      (mods.length ? '<select id="chatModello">' + mods.map(o =>
        '<option value="' + esc(o.id) + '"' + (o.id === S.chat.modello ? ' selected' : '') + '>' + esc(o.eti) + '</option>').join("") + '</select>' : '') +
      '<button class="minilink" type="button" id="cambiaChat">cambia</button>' +
    '</div>' +
    '<div class="msgs" id="msgs"></div>' +
    '<div class="suggest" id="suggest"></div>' +
    '<form class="composer" id="composer">' +
      '<input type="text" id="chatInput" placeholder="Es. quale modello per sottotitolare video?" autocomplete="off">' +
      '<button type="submit" id="chatSend">Invia</button>' +
    '</form>';

  const sugg = ["Qual è il modello migliore per i video?", "Come taglio la bolletta del 50%?",
    "Cos'è un token, in due righe?", "Che modello uso per trascrivere riunioni?"];
  $("#suggest").innerHTML = sugg.map(s => '<button type="button">' + esc(s) + '</button>').join("");
  $("#suggest").addEventListener("click", e => {
    const b = e.target.closest("button"); if (b) inviaChat(b.textContent);
  });
  $("#composer").addEventListener("submit", e => { e.preventDefault(); inviaChat($("#chatInput").value.trim()); });
  $("#cambiaChat").addEventListener("click", () => {
    if (confirm("Vuoi cancellare la chiave salvata e ricominciare?")) dimenticaChat();
    else { S.chat.chiave = ""; disegnaChat(); }
  });
  if ($("#chatModello")) $("#chatModello").addEventListener("change", e => { S.chat.modello = e.target.value; salvaConfigChat(); });

  if (!S.chat.storico.length) {
    bolla("a", "Ciao. Chiedimi qualsiasi cosa sui modelli AI e ti rispondo senza gergo, usando i dati che hai davanti.");
  } else {
    S.chat.storico.forEach(t => bolla(t.role === "user" ? "u" : "a", t.content));
  }
}

function bolla(cls, testo) {
  const m = $("#msgs"); if (!m) return null;
  const d = document.createElement("div");
  d.className = "msg " + cls;
  if (cls === "sys") d.innerHTML = testo; else d.textContent = testo;
  m.appendChild(d); m.scrollTop = m.scrollHeight;
  return d;
}

function contestoDati(max) {
  return S.modelli.slice(0, max || 110).map(m => [
    m.nome, m.prov, m.cat.join("/"),
    m.lic === "aperto" ? "pesi aperti" : "solo API",
    aToken(m) ? "entrata $" + m.inp + "/mln, uscita $" + m.out + "/mln" : (m.prezzo != null ? "$" + m.prezzo + " " + (NOME_UNITA[m.unit] || "") : "senza listino a token"),
    m.q != null ? "punteggio " + m.q : "",
    m.ctx ? "contesto " + ctxIt(m.ctx) : ""
  ].filter(Boolean).join(" · ")).join("\n");
}
function istruzioni() {
  return "Sei l'assistente di 'Radar AI', una dashboard in italiano sui modelli di intelligenza artificiale. " +
    "Chi legge NON è un ingegnere informatico. Regole: rispondi in italiano; niente gergo non spiegato; " +
    "se usi un termine tecnico spiegalo subito fra parentesi con parole comuni; massimo 6 frasi; " +
    "quando consigli un modello dì anche quanto costa e perché proprio quello.\n\n" +
    "Dati della pagina" + (S.quando ? ", aggiornati al " + dataLunga(S.quando) : "") + ":\n" + contestoDati();
}

let inCorso = false;
function apriDock() { $("#dockPanel").hidden = false; }
function chiedi(domanda) { apriDock(); inviaChat(domanda); }

async function inviaChat(testo) {
  if (!testo || inCorso) return;
  apriDock();
  if (!$("#msgs")) return;
  bolla("u", testo);
  if ($("#chatInput")) $("#chatInput").value = "";
  S.chat.storico.push({ role: "user", content: testo });
  inCorso = true;
  if ($("#chatSend")) $("#chatSend").disabled = true;
  const risposta = bolla("a", "Sto pensando…");

  try {
    const t = await chiediAlFornitore(S.chat.storico, txt => { risposta.textContent = txt; $("#msgs").scrollTop = $("#msgs").scrollHeight; });
    risposta.textContent = t;
    S.chat.storico.push({ role: "assistant", content: t });
    if (S.chat.storico.length > 14) S.chat.storico = S.chat.storico.slice(-14);
  } catch (err) {
    risposta.remove();
    bolla("sys", spiegaErroreChat(err));
  } finally {
    inCorso = false;
    if ($("#chatSend")) $("#chatSend").disabled = false;
    $("#msgs").scrollTop = $("#msgs").scrollHeight;
  }
}

function spiegaErroreChat(err) {
  const s = err && err.stato;
  if (s === 401 || s === 403) return 'La chiave non è stata accettata. Controlla di averla incollata per intero, oppure <button class="minilink" type="button" id="rifaiChiave">inseriscine un\'altra</button>.';
  if (s === 429) return "Hai superato il limite di richieste del tuo piano. Aspetta qualche minuto, oppure passa a un modello gratuito.";
  if (s === 402) return "Il tuo credito è esaurito. Ricarica sul sito del fornitore, oppure scegli un modello con «gratis» nel nome.";
  if (s === 400) return "Il modello scelto ha rifiutato la richiesta. Prova a sceglierne un altro dal menù qui sopra.";
  if (err && err.code === "not_granted") return "Serve il tuo consenso: riprova e accetta la richiesta che compare in alto.";
  return "Non sono riuscito a rispondere: " + esc((err && err.message) || "errore di rete") + ". Riprova fra poco.";
}

async function chiediAlFornitore(storico, onTesto) {
  const f = S.chat.fornitore;

  if (f === "claude") {
    const s = await claudeDisponibile();
    if (!s) throw new Error("Claude non disponibile in questa vista");
    const turni = [{ role: "user", content: istruzioni() + "\n\n---\n\n" + storico[0].content }];
    for (let i = 1; i < storico.length; i++) turni.push(storico[i]);
    const r = await s(turni, { cache: false, modelTier: "quick", onText: ({ text }) => onTesto(text) });
    return r.text;
  }

  if (f === "gemini") {
    // Google accetta la chiave solo nell'indirizzo: e' l'unico modo che
    // funziona da dentro un browser. Percio' conviene limitarla al dominio.
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(S.chat.modello) + ":generateContent?key=" + encodeURIComponent(S.chat.chiave);
    const corpo = {
      system_instruction: { parts: [{ text: istruzioni() }] },
      contents: storico.map(t => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
      generationConfig: { maxOutputTokens: 900 }
    };
    const d = await prendiJSON(url, 60000, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const parti = ((((d.candidates || [])[0] || {}).content || {}).parts) || [];
    const t = parti.map(p => p.text || "").join("").trim();
    if (!t) throw new Error("risposta vuota");
    return t;
  }

  const base = f === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const d = await prendiJSON(base, 60000, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + S.chat.chiave },
    body: JSON.stringify({
      model: S.chat.modello,
      messages: [{ role: "system", content: istruzioni() }].concat(storico),
      max_tokens: 900
    })
  });
  const t = ((((d.choices || [])[0] || {}).message || {}).content || "").trim();
  if (!t) throw new Error("risposta vuota");
  return t;
}

/* ============================================================
   NAVIGAZIONE ED EVENTI
   ============================================================ */
const SEZIONI = [
  { id: "oggi", l: "Prima pagina" }, { id: "modelli", l: "Catalogo modelli" },
  { id: "mappa", l: "Mappa e grafici" }, { id: "confronto", l: "Confronto" },
  { id: "costi", l: "Quanto costa" }, { id: "risparmio", l: "Risparmiare token" },
  { id: "glossario", l: "Glossario" }
];

function vaiA(id) {
  $$("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.sec === id)));
  SEZIONI.forEach(s => { const p = $("#p-" + s.id); if (p) p.hidden = (s.id !== id); });
  window.scrollTo({ top: 0, behavior: "instant" });
  if (id === "mappa") { disegnaMappa(); disegnaClassifica(); disegnaTempo(); }
  if (id === "costi") calcolaCosti();
  if (id === "risparmio") disegnaRisparmio();
  if (id === "confronto") disegnaConfronto();
}

function disegnaTutto() {
  disegnaTestata(); disegnaApertura(); disegnaNotizie(); disegnaScadenze(); disegnaStatistiche();
  disegnaCatalogo(); riempiSelect();
  disegnaMappa(); disegnaClassifica(); disegnaTempo();
  disegnaRisparmio(); calcolaCosti(); disegnaConfronto();
}

function togliFiltro(chiave) {
  if (chiave === "tutto") S.filtri = { cat: "tutto", lic: "tutte", budget: "tutti", sort: S.filtri.sort, q: "" };
  else if (chiave === "cat") S.filtri.cat = "tutto";
  else if (chiave === "lic") S.filtri.lic = "tutte";
  else if (chiave === "budget") S.filtri.budget = "tutti";
  else if (chiave === "q") S.filtri.q = "";
  $("#fQ").value = S.filtri.q;
  costruisciFiltri();
  disegnaCatalogo();
}

function collegaEventi() {
  $("#tabs").innerHTML = SEZIONI.map((s, i) =>
    '<button role="tab" type="button" data-sec="' + s.id + '" aria-selected="' + (i === 0) + '">' + esc(s.l) + '</button>').join("");
  $("#tabs").addEventListener("click", e => {
    const b = e.target.closest("button[data-sec]"); if (b) vaiA(b.dataset.sec);
  });
  $("#themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const scuro = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", cur ? (cur === "dark" ? "light" : "dark") : (scuro ? "light" : "dark"));
    disegnaTutto();
  });
  $("#btnAgg").addEventListener("click", aggiornaOra);

  legaSeg("#fCat", "cat"); legaSeg("#fLic", "lic"); legaSeg("#fBudget", "budget"); legaSeg("#fSort", "sort");
  $("#fQ").addEventListener("input", e => { S.filtri.q = e.target.value.trim(); disegnaCatalogo(); });

  $("#cmpAdd").addEventListener("change", e => {
    if (e.target.value && S.confronto.length < 4 && S.confronto.indexOf(e.target.value) < 0) {
      S.confronto.push(e.target.value); disegnaConfronto(); disegnaCatalogo(); riempiSelect();
    }
    e.target.value = "";
  });
  $("#cmpClear").addEventListener("click", () => { S.confronto = []; disegnaConfronto(); disegnaCatalogo(); riempiSelect(); });
  $("#cmpPreset").addEventListener("click", () => {
    S.confronto = conIndice().sort((a, b) => b.q - a.q).slice(0, 3).map(m => m.id);
    const eco = conPrezzo().filter(m => m.q != null).sort((a, b) => a.out - b.out)[0];
    if (eco && S.confronto.indexOf(eco.id) < 0) S.confronto.push(eco.id);
    disegnaConfronto(); disegnaCatalogo(); riempiSelect();
  });

  ["cReq", "cIn", "cOut"].forEach(id => $("#" + id).addEventListener("input", calcolaCosti));
  $("#cPreset").addEventListener("click", e => {
    const b = e.target.closest("button[data-p]"); if (!b) return;
    const p = S.statici.scenari.find(x => x.k === b.dataset.p);
    $("#cReq").value = p.req; $("#cIn").value = p.in; $("#cOut").value = p.out;
    $$("button", $("#cPreset")).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    calcolaCosti();
  });
  $("#cCache").addEventListener("click", e => {
    const b = e.target.closest("button[data-c]"); if (!b) return;
    S.usaCache = b.dataset.c === "si";
    $$("button", $("#cCache")).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    calcolaCosti();
  });

  $("#dockToggle").addEventListener("click", () => {
    const p = $("#dockPanel"); p.hidden = !p.hidden;
    if (!p.hidden && $("#chatInput")) $("#chatInput").focus();
  });
  $("#dockClose").addEventListener("click", () => { $("#dockPanel").hidden = true; });
  $("#dettaglioSfondo").addEventListener("click", chiudiDettaglio);

  /* Un solo ascoltatore per tutti i clic della pagina. */
  document.addEventListener("click", e => {
    const gl = e.target.closest(".gl");
    if (gl) { apriPop(gl); return; }
    if (pop && !e.target.closest(".pop")) chiudiPop();

    const togli = e.target.closest("[data-togli]");
    if (togli) { togliFiltro(togli.dataset.togli); return; }

    const cmp = e.target.closest("[data-cmp]");
    if (cmp) {
      e.stopPropagation();
      const id = cmp.dataset.cmp, i = S.confronto.indexOf(id);
      if (i >= 0) S.confronto.splice(i, 1);
      else if (S.confronto.length < 4) S.confronto.push(id);
      else { alert("Il confronto tiene 4 modelli. Togline uno per aggiungerne un altro."); return; }
      disegnaCatalogo(); disegnaConfronto(); riempiSelect(); disegnaMappa();
      if (!$("#dettaglio").hidden) apriDettaglio(id);
      return;
    }

    const ask = e.target.closest("[data-ask]");
    if (ask) {
      e.stopPropagation();
      const m = S.modelli.find(x => x.id === ask.dataset.ask);
      if (m) chiedi("In parole semplici: quando conviene usare " + m.nome + " di " + m.prov + " e quando no? Rispondi a chi non è tecnico.");
      return;
    }

    const spiega = e.target.closest("[data-spiega]");
    if (spiega) {
      const n = (window.__notizie || []).find(x => x.id === spiega.dataset.spiega);
      if (n) chiedi("Rispiega questa notizia a chi non sa niente di AI, in 4 righe, con un paragone concreto:\n\n" + n.titolo + " — " + n.testo);
      return;
    }

    const det = e.target.closest("[data-dettaglio]");
    if (det) { apriDettaglio(det.dataset.dettaglio); return; }

    // scelta del fornitore di chat
    const forn = e.target.closest("[data-forn]");
    if (forn) {
      const k = forn.dataset.forn;
      if (k === "claude") {
        S.chat.fornitore = "claude"; S.chat.chiave = "gia-pronto"; S.chat.modello = "";
        salvaConfigChat(); disegnaChat();
      } else {
        S.chat.fornitore = S.chat.fornitore === k ? null : k;
        disegnaChat();
      }
      return;
    }
    if (e.target.id === "salvaChiave") { salvaChiaveDalCampo(); return; }
    if (e.target.id === "rifaiChiave") { S.chat.chiave = ""; disegnaChat(); return; }
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { chiudiPop(); nascondiTip(); chiudiDettaglio(); }
    if (e.key === "Enter" && e.target.id === "campoChiave") { e.preventDefault(); salvaChiaveDalCampo(); }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.classList && e.target.classList.contains("mcard")) {
      apriDettaglio(e.target.dataset.dettaglio);
    }
  });
  window.addEventListener("scroll", chiudiPop, { passive: true });
  window.addEventListener("resize", () => { chiudiPop(); nascondiTip(); });
}

async function salvaChiaveDalCampo() {
  const campo = $("#campoChiave"), esito = $("#esitoChiave");
  if (!campo) return;
  const v = campo.value.trim();
  const f = FORNITORI_CHAT[S.chat.fornitore];
  esito.hidden = false;
  if (!v) { esito.className = "setup-esito male"; esito.textContent = "Il campo è vuoto."; return; }
  if (f.prefisso && v.indexOf(f.prefisso) !== 0) {
    esito.className = "setup-esito male";
    esito.textContent = "Le chiavi di " + f.nome + " iniziano con «" + f.prefisso + "». Controlla di aver copiato quella giusta.";
    return;
  }
  esito.className = "setup-esito"; esito.textContent = "Sto provando la chiave…";
  S.chat.chiave = v;
  S.chat.modello = f.difetto;
  try {
    await chiediAlFornitore([{ role: "user", content: "Rispondi solo con la parola: pronto" }], () => { });
    salvaConfigChat();
    S.chat.storico = [];
    disegnaChat();
    bolla("sys", "Chiave salvata nel tuo browser. Da qui in poi rispondo io. Se vuoi cancellarla, premi «cambia» in alto.");
  } catch (err) {
    S.chat.chiave = "";
    esito.className = "setup-esito male";
    esito.innerHTML = spiegaErroreChat(err);
  }
}

/* ------------------------------------------------------------
   Avvio
   ------------------------------------------------------------ */
(async function avvio() {
  mostraStato(true);
  await caricaStatici();
  if (!S.statici) {
    $("#statoTxt").textContent = "Dati mancanti";
    $("#dettTxt").textContent = "manca il file dati/statici.json";
    return;
  }
  leggiConfigChat();
  costruisciFiltri(); costruisciScenari(); collegaEventi();
  disegnaGlossario(); disegnaTecniche(); disegnaPaper(); disegnaChat();

  const ok = await caricaCatalogo(false);
  mostraStato(false);
  if (ok) disegnaTutto();
  else $("#modelGrid").innerHTML = '<div class="box vuoto" style="grid-column:1/-1">Nessuna fonte raggiungibile. Premi <b>Aggiorna ora</b> quando torni in rete.</div>';
})();
