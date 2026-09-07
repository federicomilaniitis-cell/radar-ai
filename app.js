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

/* ------------------------------------------------------------
   Stato dell'applicazione
   ------------------------------------------------------------ */
const S = {
  statici: null,      // glossario, tecniche, scenari, fornitori
  extra: [],          // modelli curati (video, voce, immagini fuori OpenRouter)
  modelli: [],        // catalogo normalizzato completo
  notizie: [],        // notizie dal repository
  paper: [],
  fonte: "",          // "diretta" | "istantanea" | "incorporati"
  quando: null,       // Date dell'ultimo caricamento riuscito
  confronto: [],
  filtri: { cat: "tutto", lic: "tutte", budget: "tutti", sort: "q", q: "" },
  usaCache: false,
  provider: "auto"
};

/* ------------------------------------------------------------
   Normalizzazione: da record OpenRouter a modello della pagina
   Tutto quello che segue e' dedotto dai dati, mai scritto a mano.
   ------------------------------------------------------------ */
function perMilione(v) {
  const n = parseFloat(v);
  return isFinite(n) ? Math.round(n * 1e6 * 1e6) / 1e6 : null;
}

function nomeFornitore(prefisso) {
  const mappa = (S.statici && S.statici.fornitori) || {};
  if (mappa[prefisso]) return mappa[prefisso];
  // Fornitore mai visto prima: ricavo un nome leggibile dall'identificativo.
  return prefisso.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function normalizza(r) {
  const prefisso = (r.id || "").split("/")[0].replace(/^~/, "");
  const nome = (r.name || r.id || "").includes(": ")
    ? r.name.split(": ").slice(1).join(": ")
    : (r.name || r.id);

  const p = r.pricing || {};
  const a = r.architecture || {};
  const im = a.input_modalities || [];
  const om = a.output_modalities || ["text"];
  const sp = r.supported_parameters || [];
  const aa = (r.benchmarks || {}).artificial_analysis || {};

  const inp = perMilione(p.prompt);
  const out = perMilione(p.completion);

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
  if (scade && parseInt(scade.slice(0, 4), 10) > 2090) scade = null;  // segnaposto "mai"

  const gratis = (inp === 0 && out === 0) || r.ha_versione_gratuita === true;

  return {
    id: r.id,
    nome: nome,
    prov: nomeFornitore(prefisso),
    prefisso: prefisso,
    cat: cat,
    lic: r.hugging_face_id ? "aperto" : "chiuso",
    hf: r.hugging_face_id || null,
    inp: inp, out: out,
    cache: perMilione(p.input_cache_read),
    cacheW: perMilione(p.input_cache_write),
    ctx: r.context_length || null,
    maxOut: (r.top_provider || {}).max_completion_tokens || null,
    rel: r.created ? new Date(r.created * 1000).toISOString().slice(0, 10) : null,
    q: aa.intelligence_index != null ? aa.intelligence_index : null,
    qCod: aa.coding_index != null ? aa.coding_index : null,
    qAg: aa.agentic_index != null ? aa.agentic_index : null,
    gratis: gratis,
    dismesso: scade,
    descr: r.description || "",
    unit: "token",
    origine: "openrouter"
  };
}

/* I modelli curati (video, voce) usano gia' la forma finale. */
function normalizzaExtra(e) {
  return Object.assign({
    prefisso: "", hf: null, cache: null, cacheW: null, ctx: null, maxOut: null,
    q: null, qCod: null, qAg: null, gratis: false, descr: "", origine: "curato",
    inp: null, out: null
  }, e);
}

/* ------------------------------------------------------------
   Caricamento dati — in diretta, poi istantanea, poi incorporati
   ------------------------------------------------------------ */
async function prendiJSON(url, timeout) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout || 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

const INCORPORATI = (typeof DATI_INCORPORATI !== "undefined") ? DATI_INCORPORATI : null;

async function caricaStatici() {
  // Glossario, tecniche, scenari: dal repository, altrimenti dalla copia inclusa.
  try {
    S.statici = await prendiJSON(CARTELLA_DATI + "statici.json", 8000);
  } catch (_) {
    S.statici = INCORPORATI ? INCORPORATI.statici : null;
  }
  try {
    const e = await prendiJSON(CARTELLA_DATI + "extra.json", 8000);
    S.extra = (e.modelli || []).map(normalizzaExtra);
  } catch (_) {
    S.extra = INCORPORATI ? (INCORPORATI.extra.modelli || []).map(normalizzaExtra) : [];
  }
  try {
    const n = await prendiJSON(CARTELLA_DATI + "notizie.json", 8000);
    S.notizie = n.notizie || [];
  } catch (_) {
    S.notizie = INCORPORATI ? (INCORPORATI.notizie.notizie || []) : [];
  }
  try {
    const p = await prendiJSON(CARTELLA_DATI + "paper.json", 8000);
    S.paper = p.paper || [];
  } catch (_) {
    S.paper = INCORPORATI ? (INCORPORATI.paper.paper || []) : [];
  }
}

async function caricaCatalogo(forzaLive) {
  // 1) in diretta da OpenRouter
  try {
    const d = await prendiJSON(FONTE_LIVE, 15000);
    if (d && d.data && d.data.length) {
      const gratuiti = {};
      d.data.forEach(m => { if (m.id.endsWith(":free")) gratuiti[m.id.split(":")[0]] = true; });
      const puliti = d.data.filter(m =>
        !(m.id.indexOf(":") >= 0 && !m.id.endsWith(":free")) && m.id.indexOf("openrouter/") !== 0);
      puliti.forEach(m => { m.ha_versione_gratuita = !!gratuiti[m.id.split(":")[0]]; });
      S.modelli = puliti.map(normalizza).concat(S.extra);
      S.fonte = "diretta";
      S.quando = new Date();
      return true;
    }
  } catch (_) { /* si passa alla riserva */ }

  if (forzaLive) return false;

  // 2) istantanea salvata nel repository
  try {
    const c = await prendiJSON(CARTELLA_DATI + "cache.json", 12000);
    if (c && c.modelli && c.modelli.length) {
      S.modelli = c.modelli.map(normalizza).concat(S.extra);
      S.fonte = "istantanea";
      S.quando = new Date(c.aggiornato);
      return true;
    }
  } catch (_) { /* si passa alla copia inclusa */ }

  // 3) copia inclusa nel file
  if (INCORPORATI && INCORPORATI.cache && INCORPORATI.cache.modelli) {
    S.modelli = INCORPORATI.cache.modelli.map(normalizza).concat(S.extra);
    S.fonte = "incorporati";
    S.quando = new Date(INCORPORATI.cache.aggiornato);
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
    stato.textContent = "In diretta";
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
  } else {
    disegnaTutto();
  }
  b.disabled = false; b.classList.remove("gira");
  if (ok) mostraStato(false);
}

/* ------------------------------------------------------------
   Prima pagina — tutto calcolato dai dati
   ------------------------------------------------------------ */
function conPrezzo() { return S.modelli.filter(m => m.inp != null && m.out != null && m.out > 0); }
function conIndice() { return S.modelli.filter(m => m.q != null && m.out != null); }
function giorniDa(iso) { return (Date.now() - new Date(iso).getTime()) / 864e5; }

function disegnaTestata() {
  const cp = conPrezzo();
  const economico = cp.length ? cp.reduce((a, b) => b.out < a.out ? b : a) : null;
  const nuovi = S.modelli.filter(m => m.rel && giorniDa(m.rel) < 30).length;
  const righe = [
    ["Edizione", S.quando ? dataLunga(S.quando) : "—"],
    ["Modelli seguiti", nf.format(S.modelli.length)],
    ["Fornitori", new Set(S.modelli.map(m => m.prov)).size],
    ["Usciti in 30 giorni", nuovi],
    ["Uscita più economica", economico ? soldi(economico.out) + " / mln" : "—"],
    ["Prossimo controllo automatico", prossimoGiro()]
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

/* Il modello di punta e' semplicemente quello con l'indice piu' alto.
   Se domani esce un fornitore nuovo che lo supera, prende il suo posto
   da solo: qui non c'e' nessuna classifica scritta a mano. */
function disegnaApertura() {
  const ci = conIndice().sort((a, b) => b.q - a.q);
  if (!ci.length) { $("#lead").innerHTML = '<p class="vuoto">Dati non disponibili.</p>'; return; }
  const re = ci[0], sfid = ci[1];
  const recente = S.modelli.filter(m => m.rel && giorniDa(m.rel) < 14 && m.q != null)
    .sort((a, b) => b.q - a.q)[0];

  const scalzato = recente && recente.id === re.id;
  const kicker = scalzato ? "Cambio in vetta" : "In vetta oggi";

  let testo = re.nome + " di " + re.prov + " è oggi il modello con il punteggio di intelligenza più alto fra i " +
    nf.format(S.modelli.length) + " che questa pagina segue: {indice|" + String(re.q).replace(".", ",") + " punti}";
  if (sfid) testo += ", contro i " + String(sfid.q).replace(".", ",") + " di " + sfid.nome;
  testo += ". ";
  if (re.inp != null && re.out != null) {
    testo += "Costa " + soldi(re.inp) + " per far leggere un milione di {token|token} e " + soldi(re.out) + " per farli scrivere. ";
  }
  if (re.ctx) testo += "Tiene " + ctxIt(re.ctx) + " di token davanti agli occhi in una volta sola.";

  const eco = conIndice().filter(m => m.q >= re.q * 0.8).sort((a, b) => a.out - b.out)[0];

  $("#lead").innerHTML =
    '<div class="kicker"><span class="chip hot">' + esc(kicker) + '</span>' +
    '<span class="date">' + (re.rel ? "uscito il " + dataIt(re.rel) : "") + '</span></div>' +
    '<h3>' + esc(re.nome) + '</h3>' +
    '<p class="standfirst">' + glossifica(testo) + '</p>' +
    '<div class="bignum">' +
      '<div><div class="k">Indice di intelligenza</div><div class="v">' + String(re.q).replace(".", ",") + '</div></div>' +
      (re.qCod != null ? '<div><div class="k">Sul codice</div><div class="v">' + String(re.qCod).replace(".", ",") + '</div></div>' : '') +
      (re.out != null ? '<div><div class="k">Scrivere 1 mln token</div><div class="v">' + soldi(re.out) + '</div></div>' : '') +
      (re.ctx ? '<div><div class="k">Contesto</div><div class="v">' + ctxIt(re.ctx) + '</div></div>' : '') +
    '</div>' +
    (eco && eco.id !== re.id ?
      '<div class="why" style="margin-top:16px"><b>Se il budget conta</b>' +
      esc(eco.nome + " di " + eco.prov + " arriva a " + String(eco.q).replace(".", ",") + " punti — l'" +
        Math.round(eco.q / re.q * 100) + "% del capofila — ma far scrivere un milione di token costa " +
        soldi(eco.out) + " invece di " + soldi(re.out) + ".") + '</div>' : '');
}

/* Notizie: quelle calcolate dal repository (che sa cosa e' cambiato da
   ieri) piu' quelle che si deducono qui e ora dal catalogo. */
function notizieCalcolate() {
  const n = [];
  S.modelli.filter(m => m.rel && giorniDa(m.rel) < 21 && m.origine === "openrouter")
    .sort((a, b) => new Date(b.rel) - new Date(a.rel))
    .slice(0, 6)
    .forEach(m => {
      let t = m.nome + " di " + m.prov + " è entrato nel catalogo.";
      if (m.inp != null && m.out != null) t += " Prezzo: " + soldi(m.inp) + " per milione di token in entrata, " + soldi(m.out) + " in uscita.";
      if (m.ctx) t += " Contesto: " + ctxIt(m.ctx) + " token.";
      if (m.q != null) t += " Punteggio di intelligenza indipendente: " + String(m.q).replace(".", ",") + ".";
      n.push({
        id: "auto-" + m.id, data: m.rel,
        tag: m.lic === "aperto" ? "open" : (m.q != null && m.q > 45 ? "hot" : ""),
        tagT: m.lic === "aperto" ? "Pesi aperti" : "Nuovo modello",
        titolo: m.nome + ": disponibile da " + dataIt(m.rel),
        testo: t,
        perche: m.lic === "aperto"
          ? "Lo puoi scaricare e far girare su macchine tue: i dati non escono di casa."
          : "Un'opzione in più sul tavolo quando decidi con chi lavorare."
      });
    });
  return n;
}

function disegnaNotizie() {
  const viste = {};
  const tutte = S.notizie.concat(notizieCalcolate()).filter(x => {
    if (viste[x.id]) return false; viste[x.id] = 1; return true;
  }).slice(0, 12);

  if (!tutte.length) { $("#newsGrid").innerHTML = '<p class="vuoto">Nessuna novità registrata.</p>'; return; }
  $("#newsGrid").innerHTML = tutte.map(n =>
    '<article class="news">' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<span class="chip ' + esc(n.tag || "") + '">' + esc(n.tagT) + '</span>' +
        '<span class="date">' + dataIt(n.data) + '</span></div>' +
      '<h4>' + esc(n.titolo) + '</h4>' +
      '<p class="body">' + esc(n.testo) + '</p>' +
      '<div class="why"><b>Perché ti riguarda</b>' + esc(n.perche) + '</div>' +
      '<footer><button class="ghost" type="button" data-spiega="' + esc(n.id) + '">Spiegamelo più semplice</button></footer>' +
    '</article>').join("");
  window.__notizie = tutte;
}

function disegnaScadenze() {
  const oggi = new Date();
  const sc = S.modelli.filter(m => m.dismesso).map(m => {
    const g = Math.round((new Date(m.dismesso) - oggi) / 864e5);
    return { m: m, g: g };
  }).filter(x => x.g >= -3 && x.g < 400).sort((a, b) => a.g - b.g).slice(0, 8);

  if (!sc.length) {
    $("#deadlines").innerHTML = '<p style="font-size:13px;color:var(--ink-2)">Nessuna dismissione annunciata fra i modelli seguiti. Quando un fornitore ne fissa una, compare qui con il conto alla rovescia.</p>';
    return;
  }
  $("#deadlines").innerHTML = sc.map(x =>
    '<div class="deadline"><span class="d" style="' + (x.g <= 30 ? "color:var(--crit)" : "") + '">' +
    (x.g < 0 ? "scaduto" : x.g === 0 ? "oggi" : x.g + " gg") + '</span>' +
    '<span class="t"><b>' + esc(x.m.nome) + '</b> (' + esc(x.m.prov) + ') si spegne il ' + dataIt(x.m.dismesso) + '.</span></div>').join("");
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

/* ------------------------------------------------------------
   Catalogo e filtri
   ------------------------------------------------------------ */
function catLabel(k) {
  const c = (S.statici.categorie || []).find(x => x.k === k);
  return c ? c.l : k;
}

function costruisciFiltri() {
  const seg = (items, sel) => items.map(i =>
    '<button type="button" data-v="' + i.k + '" aria-pressed="' + (i.k === sel) + '">' + esc(i.l) + '</button>').join("");
  $("#fCat").innerHTML = seg(S.statici.categorie, S.filtri.cat);
  $("#fLic").innerHTML = seg([{ k: "tutte", l: "Tutte" }, { k: "chiuso", l: "Solo via API" }, { k: "aperto", l: "Pesi aperti" }], S.filtri.lic);
  $("#fBudget").innerHTML = seg([
    { k: "tutti", l: "Qualsiasi" }, { k: "free", l: "Ha una versione gratuita" },
    { k: "basso", l: "Economico (< 2 $)" }, { k: "medio", l: "Medio (2-15 $)" }, { k: "alto", l: "Premium (> 15 $)" }
  ], S.filtri.budget);
  $("#fSort").innerHTML = seg([
    { k: "q", l: "Punteggio" }, { k: "prezzo", l: "Prezzo crescente" },
    { k: "nuovo", l: "Più recenti" }, { k: "ctx", l: "Contesto più ampio" }
  ], S.filtri.sort);
}

function legaSeg(sel, chiave) {
  $(sel).addEventListener("click", e => {
    const b = e.target.closest("button[data-v]"); if (!b) return;
    $$("button", $(sel)).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    S.filtri[chiave] = b.dataset.v;
    disegnaCatalogo();
  });
}

function filtra() {
  let r = S.modelli.slice();
  const f = S.filtri;
  if (f.cat !== "tutto") r = r.filter(m => m.cat.indexOf(f.cat) >= 0);
  if (f.lic !== "tutte") r = r.filter(m => m.lic === f.lic);
  if (f.budget === "free") r = r.filter(m => m.gratis);
  if (f.budget === "basso") r = r.filter(m => m.out != null && m.out < 2);
  if (f.budget === "medio") r = r.filter(m => m.out != null && m.out >= 2 && m.out <= 15);
  if (f.budget === "alto") r = r.filter(m => m.out != null && m.out > 15);
  if (f.q) {
    const t = f.q.toLowerCase();
    r = r.filter(m => (m.nome + " " + m.prov + " " + m.id).toLowerCase().indexOf(t) >= 0);
  }
  const ord = {
    q: (a, b) => (b.q == null ? -1 : b.q) - (a.q == null ? -1 : a.q),
    prezzo: (a, b) => (a.out == null ? 1e9 : a.out) - (b.out == null ? 1e9 : b.out),
    nuovo: (a, b) => new Date(b.rel || 0) - new Date(a.rel || 0),
    ctx: (a, b) => (b.ctx || 0) - (a.ctx || 0)
  };
  return r.sort(ord[f.sort]);
}

function strisciaPrezzo(m) {
  if (m.inp != null && m.out != null) {
    return '<div class="price-strip">' +
      '<div><div class="k">Entrata / mln</div><div class="v">' + soldi(m.inp) + '</div></div>' +
      '<div><div class="k">Uscita / mln</div><div class="v">' + soldi(m.out) + '</div></div>' +
      '<div><div class="k">Con cache</div><div class="v">' + (m.cache != null ? soldi(m.cache) : "—") + '</div></div>' +
      '</div>';
  }
  if (m.prezzo != null) {
    const u = { immagine: "a immagine", clip: "a clip", "1kchar": "ogni 1.000 caratteri" }[m.unit] || "";
    return '<div class="price-strip">' +
      '<div><div class="k">Prezzo</div><div class="v">' + soldi(m.prezzo) + '</div></div>' +
      '<div><div class="k">Unità</div><div class="v" style="font-size:12px">' + esc(u) + '</div></div></div>';
  }
  return '<div class="price-strip"><div><div class="k">Listino</div><div class="v" style="font-size:12.5px">Si scarica e si ospita</div></div></div>';
}

function descrizioneBreve(m) {
  if (m.usa) return m.usa;
  // Descrizione dedotta dalle capacita' misurate, senza giudizi inventati.
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
  return p.length ? titolo(p.join(", ")) + "." : "Nessuna caratteristica dichiarata oltre alla generazione di testo.";
}

function disegnaCatalogo() {
  const r = filtra();
  $("#resCount").textContent = r.length + (r.length === 1 ? " modello trovato" : " modelli trovati") +
    " su " + S.modelli.length;
  $("#cmpCount").textContent = S.confronto.length ? S.confronto.length + "/4 nel confronto" : "";

  if (!r.length) {
    $("#modelGrid").innerHTML = '<div class="box vuoto" style="grid-column:1/-1">Nessun modello con questi filtri. Prova ad allargare il budget o a togliere un vincolo.</div>';
    return;
  }
  $("#modelGrid").innerHTML = r.slice(0, 120).map(m => {
    const sel = S.confronto.indexOf(m.id) >= 0;
    const nuovo = m.rel && giorniDa(m.rel) < 30;
    const gg = m.dismesso ? Math.round((new Date(m.dismesso) - Date.now()) / 864e5) : null;
    return '<article class="mcard' + (sel ? ' sel' : '') + '">' +
      '<div class="mcard-top"><div><h4>' + esc(m.nome) + '</h4>' +
        '<div class="prov">' + esc(m.prov) + (m.rel ? ' · ' + dataIt(m.rel) : '') + '</div></div>' +
        (m.q != null ? '<div class="qring"><div class="n">' + String(m.q).replace(".", ",") + '</div><div class="l">Indice</div></div>' : '') +
      '</div>' +
      '<div class="tags">' +
        (nuovo ? '<span class="chip hot">Novità</span>' : '') +
        (gg != null && gg < 90 ? '<span class="chip crit">Si spegne fra ' + gg + ' gg</span>' : '') +
        (m.lic === "aperto" ? '<span class="chip open">Pesi aperti</span>' : '') +
        (m.gratis ? '<span class="chip ok">Versione gratuita</span>' : '') +
        m.cat.slice(0, 4).map(c => '<span class="chip">' + esc(catLabel(c)) + '</span>').join("") +
        (m.ctx ? '<span class="chip">Contesto ' + ctxIt(m.ctx) + '</span>' : '') +
      '</div>' +
      strisciaPrezzo(m) +
      '<p class="use"><b>In sintesi:</b> ' + esc(descrizioneBreve(m)) + '</p>' +
      (m.evita ? '<p class="use" style="color:var(--ink-3)"><b style="color:var(--ink-3)">Attenzione:</b> ' + esc(m.evita) + '</p>' : '') +
      '<footer>' +
        '<button class="ghost' + (sel ? ' on' : '') + '" type="button" data-cmp="' + esc(m.id) + '">' + (sel ? 'Nel confronto ✓' : 'Confronta') + '</button>' +
        '<button class="ghost" type="button" data-ask="' + esc(m.id) + '">Chiedi</button>' +
      '</footer></article>';
  }).join("") + (r.length > 120
    ? '<div class="box vuoto" style="grid-column:1/-1">Mostro i primi 120 di ' + r.length + '. Usa la ricerca o i filtri per restringere.</div>' : '');
}

/* ------------------------------------------------------------
   Grafici
   ------------------------------------------------------------ */
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
function legaTip(host) {
  $$("[data-tip]", host).forEach(el => {
    el.addEventListener("mousemove", ev => mostraTip(el.dataset.tip, ev));
    el.addEventListener("mouseleave", nascondiTip);
  });
}

/* Mappa: prezzo di uscita (scala logaritmica) contro punteggio. */
function disegnaMappa() {
  const host = $("#scatter"); if (!host) return;
  const d = conIndice().filter(m => m.out > 0);
  if (d.length < 3) { host.innerHTML = '<p class="vuoto">Servono più modelli con punteggio misurato.</p>'; return; }

  const W = 900, H = 470, L = 62, R = 26, T = 22, B = 58;
  const pw = W - L - R, ph = H - T - B;
  const prezzi = d.map(m => m.out);
  const x0 = Math.log10(Math.min.apply(null, prezzi) * 0.7);
  const x1 = Math.log10(Math.max.apply(null, prezzi) * 1.4);
  const X = v => L + (Math.log10(v) - x0) / (x1 - x0) * pw;
  const qs = d.map(m => m.q);
  const y0 = Math.floor(Math.min.apply(null, qs) / 5) * 5 - 2;
  const y1 = Math.ceil(Math.max.apply(null, qs) / 5) * 5 + 2;
  const Y = v => T + (1 - (v - y0) / (y1 - y0)) * ph;

  const grid = tok("--grid"), axis = tok("--axis"), ink2 = tok("--ink-2"), ink3 = tok("--ink-3"), surf = tok("--surface");
  let s = svgApri(W, H);

  const passo = Math.max(5, Math.round((y1 - y0) / 6 / 5) * 5);
  for (let q = Math.ceil(y0 / passo) * passo; q <= y1; q += passo) {
    s += '<line x1="' + L + '" y1="' + Y(q) + '" x2="' + (W - R) + '" y2="' + Y(q) + '" stroke="' + grid + '" stroke-width="1"/>';
    s += '<text x="' + (L - 10) + '" y="' + (Y(q) + 4) + '" text-anchor="end" font-size="11" fill="' + ink3 + '" font-family="' + "JetBrains Mono, monospace" + '">' + q + '</text>';
  }
  [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 200].forEach(v => {
    if (Math.log10(v) < x0 || Math.log10(v) > x1) return;
    s += '<line x1="' + X(v) + '" y1="' + T + '" x2="' + X(v) + '" y2="' + (H - B) + '" stroke="' + grid + '" stroke-width="1"/>';
    s += '<text x="' + X(v) + '" y="' + (H - B + 18) + '" text-anchor="middle" font-size="11" fill="' + ink3 + '" font-family="JetBrains Mono, monospace">' + soldi(v) + '</text>';
  });
  s += '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="' + axis + '" stroke-width="1"/>';
  s += '<text x="' + (L + pw / 2) + '" y="' + (H - 14) + '" text-anchor="middle" font-size="12" fill="' + ink2 + '">Costo per far scrivere un milione di token — ogni tacca vale dieci volte la precedente →</text>';
  s += '<text transform="translate(16,' + (T + ph / 2) + ') rotate(-90)" text-anchor="middle" font-size="12" fill="' + ink2 + '">Punteggio di intelligenza →</text>';

  const medianaQ = qs.slice().sort((a, b) => a - b)[Math.floor(qs.length / 2)];
  const medianaP = prezzi.slice().sort((a, b) => a - b)[Math.floor(prezzi.length / 2)];
  s += '<rect x="' + L + '" y="' + T + '" width="' + (X(medianaP) - L) + '" height="' + (Y(medianaQ) - T) + '" fill="' + tok("--s1") + '" opacity="0.07"/>';
  s += '<text x="' + (L + 9) + '" y="' + (T + 17) + '" font-size="11" fill="' + ink3 + '" font-family="JetBrains Mono, monospace">ZONA AFFARE</text>';

  const etich = {};
  d.slice().sort((a, b) => b.q - a.q).slice(0, 6).forEach(m => etich[m.id] = 1);
  d.slice().sort((a, b) => a.out - b.out).slice(0, 3).forEach(m => etich[m.id] = 1);
  d.slice().sort((a, b) => (b.q / Math.max(b.out, 0.01)) - (a.q / Math.max(a.out, 0.01))).slice(0, 3).forEach(m => etich[m.id] = 1);

  d.forEach(m => {
    const col = m.lic === "aperto" ? tok("--s2") : tok("--s1");
    s += '<circle cx="' + X(m.out) + '" cy="' + Y(m.q) + '" r="7" fill="' + col + '" stroke="' + surf + '" stroke-width="2" style="cursor:pointer" data-tip="' +
      esc('<b>' + m.nome + '</b><span class="m">' + m.prov + ' · ' + (m.lic === "aperto" ? "pesi aperti" : "solo via API") +
        '</span><br><span class="m">Punteggio ' + m.q + '<br>Entrata ' + soldi(m.inp) + ' · Uscita ' + soldi(m.out) + '<br>Contesto ' + ctxIt(m.ctx) + '</span>') + '"/>';
  });
  d.forEach(m => {
    if (!etich[m.id]) return;
    const cx = X(m.out), cy = Y(m.q);
    const dx = cx > W - 210 ? -11 : 11, anc = cx > W - 210 ? "end" : "start";
    s += '<text x="' + (cx + dx) + '" y="' + (cy + 4) + '" text-anchor="' + anc + '" font-size="11.5" fill="' + ink2 +
      '" stroke="' + surf + '" stroke-width="3" paint-order="stroke" font-weight="600">' + esc(m.nome) + '</text>';
  });
  s += '</svg>';
  host.innerHTML = s;
  legaTip(host);
}

/* Classifica dei punteggi */
function disegnaClassifica() {
  const host = $("#rank"); if (!host) return;
  const d = conIndice().sort((a, b) => b.q - a.q).slice(0, 20);
  if (!d.length) { host.innerHTML = ""; return; }
  const rowH = 27, L = 210, R = 120, T = 14, B = 14, W = 900;
  const H = T + d.length * rowH + B, pw = W - L - R;
  const max = d[0].q;
  const ink = tok("--ink"), ink2 = tok("--ink-2"), ink3 = tok("--ink-3"), surf = tok("--surface");

  let s = svgApri(W, H);
  d.forEach((m, i) => {
    const y = T + i * rowH, w = Math.max(2, m.q / max * pw);
    const col = m.lic === "aperto" ? tok("--s2") : tok("--s1");
    s += '<text x="' + (L - 10) + '" y="' + (y + 16) + '" text-anchor="end" font-size="11.5" fill="' + (i === 0 ? ink : ink2) + '" font-weight="' + (i === 0 ? 700 : 400) + '">' + esc(m.nome) + '</text>';
    s += '<rect x="' + L + '" y="' + (y + 5) + '" width="' + w + '" height="15" rx="4" fill="' + col + '" data-tip="' +
      esc('<b>' + m.nome + '</b><span class="m">' + m.prov + '</span><br><span class="m">Punteggio ' + m.q + ' · uscita ' + soldi(m.out) + '</span>') + '" style="cursor:pointer"/>';
    s += '<text x="' + (L + w + 9) + '" y="' + (y + 17) + '" font-size="11.5" fill="' + ink3 + '" font-family="JetBrains Mono, monospace">' +
      String(m.q).replace(".", ",") + ' · ' + soldi(m.out) + '/mln</text>';
  });
  s += '</svg>';
  host.innerHTML = s;
  legaTip(host);
}

/* Linea del tempo dei rilasci */
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
    const x = X(new Date(m.rel).getTime());
    const larg = m.nome.length * 6.1 + 18;
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
    const col = p.m.lic === "aperto" ? tok("--s2") : tok("--s1");
    s += '<line x1="' + p.x + '" y1="' + (y + 7) + '" x2="' + p.x + '" y2="' + baseY + '" stroke="' + grid + '" stroke-width="1"/>';
    s += '<circle cx="' + p.x + '" cy="' + (y + 7) + '" r="4.5" fill="' + col + '" stroke="' + surf + '" stroke-width="2"/>';
    s += '<text x="' + (p.x + 9) + '" y="' + (y + 11) + '" font-size="10.5" fill="' + ink2 + '" stroke="' + surf + '" stroke-width="3" paint-order="stroke">' + esc(p.m.nome) + '</text>';
  });
  s += '</svg>';
  host.innerHTML = s;
}

/* Risparmio per tecnica */
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

/* ------------------------------------------------------------
   Confronto
   ------------------------------------------------------------ */
const RIGHE_CMP = [
  ["Fornitore", m => m.prov],
  ["Uscito il", m => m.rel ? dataIt(m.rel) : "n.d."],
  ["Punteggio di intelligenza", m => m.q != null ? String(m.q).replace(".", ",") : "non misurato"],
  ["Punteggio sul codice", m => m.qCod != null ? String(m.qCod).replace(".", ",") : "—"],
  ["Licenza", m => m.lic === "aperto" ? "Pesi aperti (scaricabile)" : "Solo via API"],
  ["Sa fare", m => m.cat.map(catLabel).join(", ") || "—"],
  ["Entrata", m => m.inp != null ? soldi(m.inp) + " / mln token" : (m.prezzo != null ? soldi(m.prezzo) : "—")],
  ["Uscita", m => m.out != null ? soldi(m.out) + " / mln token" : "—"],
  ["Rilettura cache", m => m.cache != null ? soldi(m.cache) + " / mln token" : "—"],
  ["Contesto", m => ctxIt(m.ctx)],
  ["Massimo in uscita", m => m.maxOut ? nf.format(m.maxOut) + " token" : "n.d."],
  ["Versione gratuita", m => m.gratis ? "Sì" : "No"],
  ["Dismissione annunciata", m => m.dismesso ? dataIt(m.dismesso) : "nessuna"],
  ["In sintesi", m => descrizioneBreve(m)]
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

  let h = '<thead><tr><th>Voce</th>' + ms.map(m => '<th>' + esc(m.nome) + '</th>').join("") + '</tr></thead><tbody>';
  RIGHE_CMP.forEach(([k, f]) => {
    h += '<tr><td>' + esc(k) + '</td>' + ms.map(m => {
      const v = String(f(m));
      return '<td' + (/^[$\d]/.test(v) || k === "Contesto" ? ' class="num"' : '') + '>' + esc(v) + '</td>';
    }).join("") + '</tr>';
  });
  $("#cmpTable").innerHTML = h + '</tbody>';

  const host = $("#cmpChart");
  const cp = ms.filter(m => m.inp != null && m.out != null);
  if (!cp.length) {
    host.innerHTML = '<p class="note" style="margin:0">Nessuno dei modelli scelti ha un listino per token: sono a pesi aperti, oppure si pagano a immagine, a clip o a carattere. Il confronto di prezzo si legge nella tabella.</p>';
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
    s += '<text x="' + (L + X(m.inp) + 8) + '" y="' + (y + 13) + '" font-size="11.5" font-weight="700" fill="' + ink + '" font-family="JetBrains Mono, monospace">' + soldi(m.inp) + ' in entrata</text>';
    s += '<rect x="' + L + '" y="' + (y + 22) + '" width="' + X(m.out) + '" height="18" rx="4" fill="' + col + '"/>';
    s += '<text x="' + (L + X(m.out) + 8) + '" y="' + (y + 35) + '" font-size="11.5" font-weight="700" fill="' + ink + '" font-family="JetBrains Mono, monospace">' + soldi(m.out) + ' in uscita</text>';
  });
  s += '</svg>';
  host.innerHTML = s;
}

/* ------------------------------------------------------------
   Calcolatore di spesa
   ------------------------------------------------------------ */
function costruisciScenari() {
  $("#cPreset").innerHTML = S.statici.scenari.map(p =>
    '<button type="button" data-p="' + p.k + '">' + esc(p.l) + '</button>').join("");
  $("#cCache").innerHTML =
    '<button type="button" data-c="no" aria-pressed="true">Senza cache</button>' +
    '<button type="button" data-c="si" aria-pressed="false">Con cache sul testo fisso</button>';
}

function calcolaCosti() {
  if (!S.statici) return;
  const req = +$("#cReq").value, pin = +$("#cIn").value, pout = +$("#cOut").value;
  $("#cReqV").textContent = nf.format(req);
  $("#cInV").textContent = nf.format(pin) + " parole";
  $("#cOutV").textContent = nf.format(pout) + " parole";

  const tIn = pin * 1.5, tOut = pout * 1.5;
  const d = conPrezzo().map(m => {
    const costoIn = (S.usaCache && m.cache != null)
      ? (tIn * 0.7 * m.cache + tIn * 0.3 * m.inp) / 1e6
      : tIn * m.inp / 1e6;
    return { m: m, costo: req * (costoIn + tOut * m.out / 1e6) };
  }).sort((a, b) => a.costo - b.costo);
  if (!d.length) return;

  $("#costLede").innerHTML = nf.format(req) + ' richieste al mese, ' + nf.format(pin) +
    ' parole in entrata e ' + nf.format(pout) + ' in uscita ciascuna. ' +
    (S.usaCache
      ? 'Ipotesi: il 70% del testo in entrata è sempre lo stesso e viene riletto dalla <b>cache</b>.'
      : 'Nessuna ottimizzazione applicata — è lo scenario più caro possibile.');

  const conQ = d.filter(x => x.m.q != null);
  const mostra = (conQ.length >= 12 ? conQ : d).slice(0, 16);
  const W = 900, L = 190, R = 108, T = 16, rowH = 27, B = 26;
  const H = T + mostra.length * rowH + B, pw = W - L - R;
  const max = Math.max.apply(null, mostra.map(x => x.costo)) || 1;
  const ink = tok("--ink"), ink2 = tok("--ink-2"), ink3 = tok("--ink-3");

  let s = svgApri(W, H);
  mostra.forEach((x, i) => {
    const y = T + i * rowH, w = Math.max(2, x.costo / max * pw);
    const col = x.m.lic === "aperto" ? tok("--s2") : tok("--s1");
    const primo = i === 0;
    s += '<text x="' + (L - 10) + '" y="' + (y + 16) + '" text-anchor="end" font-size="11.5" fill="' + (primo ? ink : ink2) + '" font-weight="' + (primo ? 700 : 400) + '">' + esc(x.m.nome) + '</text>';
    s += '<rect x="' + L + '" y="' + (y + 5) + '" width="' + w + '" height="15" rx="4" fill="' + col + '" opacity="' + (primo ? 1 : 0.72) + '" data-tip="' +
      esc('<b>' + x.m.nome + '</b><span class="m">' + x.m.prov + '</span><br><span class="m">' + costoIt(x.costo) + ' al mese · ' + costoIt(x.costo * 12) + ' all\'anno</span>') + '" style="cursor:pointer"/>';
    s += '<text x="' + (L + w + 9) + '" y="' + (y + 17) + '" font-size="11.5" fill="' + (primo ? ink : ink3) + '" font-weight="' + (primo ? 700 : 500) + '" font-family="JetBrains Mono, monospace">' + costoIt(x.costo) + '</text>';
  });
  s += '</svg>';
  $("#costChart").innerHTML = s;
  legaTip($("#costChart"));

  const caro = d[d.length - 1], eco = d[0];
  $("#costTitle").textContent = "Da " + costoIt(eco.costo) + " a " + costoIt(caro.costo) + " al mese, per lo stesso lavoro";

  $("#costTable").innerHTML = '<thead><tr><th>Modello</th><th>Fornitore</th><th>Al mese</th><th>All\'anno</th><th>Rispetto al minimo</th><th>Punteggio</th></tr></thead><tbody>' +
    d.slice(0, 60).map(x => '<tr><td>' + esc(x.m.nome) + '</td><td>' + esc(x.m.prov) + '</td>' +
      '<td class="num">' + costoIt(x.costo) + '</td><td class="num">' + costoIt(x.costo * 12) + '</td>' +
      '<td class="num">×' + (x.costo / Math.max(eco.costo, 1e-9)).toFixed(1).replace(".", ",") + '</td>' +
      '<td class="num">' + (x.m.q != null ? String(x.m.q).replace(".", ",") : "—") + '</td></tr>').join("") + '</tbody>';
}

/* ------------------------------------------------------------
   Glossario e termini cliccabili
   ------------------------------------------------------------ */
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
document.addEventListener("click", e => {
  const b = e.target.closest(".gl");
  if (!b) { if (pop && !e.target.closest(".pop")) chiudiPop(); return; }
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
    chiedi('Fammi un altro esempio concreto per spiegare il concetto di "' + n + '" nel mondo dell\'AI, a chi non è tecnico. Massimo 4 righe.');
  });
});
document.addEventListener("keydown", e => { if (e.key === "Escape") { chiudiPop(); nascondiTip(); } });
window.addEventListener("scroll", chiudiPop, { passive: true });

/* ------------------------------------------------------------
   Tecniche e paper
   ------------------------------------------------------------ */
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
  if (!S.paper.length) {
    $("#papers").innerHTML = '<p class="vuoto">Elenco dei lavori scientifici non disponibile in questa vista.</p>';
    return;
  }
  $("#papers").innerHTML = S.paper.map(p =>
    '<div class="paper"><span class="id">' + esc(p.data) + '</span>' +
      '<span><a class="t" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.titolo) + '</a>' +
      (p.sommario ? '<div class="s">' + esc(p.sommario) + '…</div>' : '') + '</span></div>').join("");
}

/* ------------------------------------------------------------
   Chat — Claude qui dentro se possibile, altrimenti il tuo assistente
   ------------------------------------------------------------ */
let sample = null, sampleProvato = false, inCorso = false, storico = [];

const PROVIDER = {
  auto: { nome: "Qui dentro", url: null },
  chatgpt: { nome: "ChatGPT", url: d => "https://chatgpt.com/?q=" + encodeURIComponent(d) },
  gemini: { nome: "Gemini", url: () => "https://gemini.google.com/app" },
  claude: { nome: "Claude", url: d => "https://claude.ai/new?q=" + encodeURIComponent(d) }
};

function bolla(cls, testo) {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  if (cls === "sys") d.innerHTML = testo; else d.textContent = testo;
  $("#msgs").appendChild(d);
  $("#msgs").scrollTop = $("#msgs").scrollHeight;
  return d;
}

function contestoDati(max) {
  return S.modelli.slice(0, max || 120).map(m => [
    m.nome, m.prov, m.cat.join("/"),
    m.lic === "aperto" ? "pesi aperti" : "solo API",
    m.inp != null ? "entrata $" + m.inp + "/mln, uscita $" + m.out + "/mln" : (m.prezzo != null ? "$" + m.prezzo + " " + m.unit : "senza listino a token"),
    m.q != null ? "punteggio " + m.q : "",
    m.ctx ? "contesto " + ctxIt(m.ctx) : ""
  ].filter(Boolean).join(" · ")).join("\n");
}

function istruzioni(breve) {
  return "Sei l'assistente di 'Radar AI', una dashboard in italiano sui modelli di intelligenza artificiale. " +
    "Chi legge NON è un ingegnere informatico. Regole: rispondi in italiano; niente gergo non spiegato; " +
    "se usi un termine tecnico spiegalo fra parentesi; massimo 6 frasi; quando consigli un modello dì anche quanto costa e perché.\n\n" +
    "Dati della pagina" + (S.quando ? ", aggiornati al " + dataLunga(S.quando) : "") + ":\n" +
    contestoDati(breve ? 45 : 130);
}

function apriDock() { $("#dockPanel").hidden = false; }
function chiedi(domanda) { apriDock(); inviaChat(domanda); }

async function inviaChat(testo) {
  if (!testo || inCorso) return;
  apriDock();
  bolla("u", testo);
  $("#chatInput").value = "";

  // provider scelto a mano: si apre l'app esterna con la domanda già dentro
  if (S.provider !== "auto") {
    const p = PROVIDER[S.provider];
    const pacchetto = istruzioni(true) + "\n\n---\n\nDomanda: " + testo;
    let copiato = false;
    try { await navigator.clipboard.writeText(pacchetto); copiato = true; } catch (_) { }
    const url = p.url(testo);
    window.open(url, "_blank", "noopener");
    bolla("sys", "Ho aperto <b>" + esc(p.nome) + "</b> in una scheda nuova con la tua domanda." +
      (copiato ? " Negli appunti hai anche la domanda insieme ai dati di questa pagina: incollala lì se vuoi che risponda con i prezzi aggiornati." : ""));
    return;
  }

  // dentro Claude: risposta qui, senza uscire dalla pagina
  if (!sampleProvato) {
    sampleProvato = true;
    try { sample = (window.claude && typeof window.claude.use === "function") ? await window.claude.use("sample") : null; }
    catch (_) { sample = null; }
  }
  if (!sample) {
    bolla("sys", "La risposta qui dentro funziona solo quando la pagina è aperta come Artifact su Claude. " +
      "Scegli <b>ChatGPT</b>, <b>Gemini</b> o <b>Claude</b> qui sopra: la domanda si apre là, già scritta.");
    return;
  }

  inCorso = true; $("#chatSend").disabled = true;
  const risposta = bolla("a", "Sto pensando…");
  storico.push({ role: "user", content: testo });
  const turni = [{ role: "user", content: istruzioni(false) + "\n\n---\n\n" + storico[0].content }];
  for (let i = 1; i < storico.length; i++) turni.push(storico[i]);

  try {
    const r = await sample(turni, {
      cache: false, modelTier: "quick",
      onText: ({ text }) => { risposta.textContent = text; $("#msgs").scrollTop = $("#msgs").scrollHeight; }
    });
    risposta.textContent = r.text;
    storico.push({ role: "assistant", content: r.text });
    if (storico.length > 12) storico = storico.slice(-12);
  } catch (err) {
    const code = err && err.code;
    if (code === "not_granted") { risposta.remove(); bolla("sys", "Serve il tuo consenso: riprova e accetta la richiesta che compare in alto."); }
    else if (code === "rate_limited") risposta.textContent = "Troppe domande di fila. Aspetta qualche secondo e riprova.";
    else if (err && err.text) risposta.textContent = err.text;
    else risposta.textContent = "Non sono riuscito a rispondere. Riprova fra poco.";
  } finally {
    inCorso = false; $("#chatSend").disabled = false;
    $("#msgs").scrollTop = $("#msgs").scrollHeight;
  }
}

function costruisciChat() {
  $("#dockProv").innerHTML = '<span>Rispondi con</span>' +
    Object.keys(PROVIDER).map(k =>
      '<button type="button" data-pr="' + k + '" aria-pressed="' + (k === S.provider) + '">' + esc(PROVIDER[k].nome) + '</button>').join("");
  $("#dockProv").addEventListener("click", e => {
    const b = e.target.closest("button[data-pr]"); if (!b) return;
    S.provider = b.dataset.pr;
    $$("button", $("#dockProv")).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    $("#dockStatus").textContent = S.provider === "auto"
      ? "Risponde qui dentro (serve Claude)"
      : "Apre " + PROVIDER[S.provider].nome + " in una scheda nuova";
  });
  const sugg = ["Qual è il modello migliore per i video?", "Come taglio la bolletta del 50%?",
    "Cos'è un token, in due righe?", "Che modello uso per trascrivere riunioni?"];
  $("#suggest").innerHTML = sugg.map(s => '<button type="button">' + esc(s) + '</button>').join("");
  $("#suggest").addEventListener("click", e => {
    const b = e.target.closest("button"); if (b) inviaChat(b.textContent);
  });
  bolla("a", "Ciao. Chiedimi qualsiasi cosa sui modelli AI e ti rispondo senza gergo. Se preferisci ChatGPT o Gemini, sceglili qui sopra: la domanda si apre là, già scritta.");
}

/* ------------------------------------------------------------
   Navigazione, tema, eventi
   ------------------------------------------------------------ */
const SEZIONI = [
  { id: "oggi", l: "Prima pagina" },
  { id: "modelli", l: "Catalogo modelli" },
  { id: "mappa", l: "Mappa e grafici" },
  { id: "confronto", l: "Confronto" },
  { id: "costi", l: "Quanto costa" },
  { id: "risparmio", l: "Risparmiare token" },
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
    if (!p.hidden) $("#chatInput").focus();
  });
  $("#dockClose").addEventListener("click", () => { $("#dockPanel").hidden = true; });
  $("#composer").addEventListener("submit", e => { e.preventDefault(); inviaChat($("#chatInput").value.trim()); });

  document.addEventListener("click", e => {
    const c = e.target.closest("[data-cmp]");
    if (c) {
      const id = c.dataset.cmp, i = S.confronto.indexOf(id);
      if (i >= 0) S.confronto.splice(i, 1);
      else if (S.confronto.length < 4) S.confronto.push(id);
      else { alert("Il confronto tiene 4 modelli. Togline uno per aggiungerne un altro."); return; }
      disegnaCatalogo(); disegnaConfronto(); riempiSelect();
    }
    const a = e.target.closest("[data-ask]");
    if (a) {
      const m = S.modelli.find(x => x.id === a.dataset.ask);
      if (m) chiedi("In parole semplici: quando conviene usare " + m.nome + " di " + m.prov + " e quando no? Rispondi a chi non è tecnico.");
    }
    const s = e.target.closest("[data-spiega]");
    if (s) {
      const n = (window.__notizie || []).find(x => x.id === s.dataset.spiega);
      if (n) chiedi("Rispiega questa notizia a chi non sa niente di AI, in 4 righe, con un paragone concreto:\n\n" + n.titolo + " — " + n.testo);
    }
  });

  window.addEventListener("resize", () => { chiudiPop(); nascondiTip(); });
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
  costruisciFiltri(); costruisciScenari(); collegaEventi(); costruisciChat();
  disegnaGlossario(); disegnaTecniche(); disegnaPaper();

  const ok = await caricaCatalogo(false);
  mostraStato(false);
  if (ok) disegnaTutto();
  else $("#modelGrid").innerHTML = '<div class="box vuoto" style="grid-column:1/-1">Nessuna fonte raggiungibile. Premi <b>Aggiorna ora</b> quando torni in rete.</div>';
})();
