#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Radar AI — raccolta dati.

Gira su GitHub Actions (o a mano) e riscrive i file dentro dati/:

  cache.json    istantanea del catalogo OpenRouter, ripulita. Serve come
                riserva quando il browser non riesce a raggiungere OpenRouter
                da solo, e come termine di paragone per capire cosa e' cambiato.
  notizie.json  le notizie di oggi, dedotte confrontando l'istantanea di ieri
                con quella di oggi: modelli nuovi, prezzi cambiati, dismissioni.
  paper.json    i lavori di ricerca piu' recenti sul risparmio di token.

Nessuna chiave d'accesso, nessuna dipendenza esterna: solo libreria standard.
"""

import json, os, re, sys, urllib.request, urllib.error
from datetime import datetime, timezone, date

QUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATI = os.path.join(QUI, "dati")

OPENROUTER = "https://openrouter.ai/api/v1/models"
ARXIV = ("https://export.arxiv.org/api/query?search_query="
         "abs:%22KV+cache%22+OR+abs:%22prompt+compression%22+OR+abs:%22context+compression%22"
         "+OR+abs:%22token+reduction%22+OR+abs:%22efficient+inference%22"
         "&sortBy=submittedDate&sortOrder=descending&max_results=24")

MESI = ["gennaio","febbraio","marzo","aprile","maggio","giugno",
        "luglio","agosto","settembre","ottobre","novembre","dicembre"]


def scarica(url, timeout=60):
    req = urllib.request.Request(url, headers={
        "User-Agent": "RadarAI/1.0 (dashboard divulgativa; https://github.com/)",
        "Accept": "application/json, application/atom+xml, */*",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def data_it(d):
    return "%d %s %d" % (d.day, MESI[d.month - 1], d.year)


# ----------------------------------------------------------------------------
# 1. Catalogo modelli
# ----------------------------------------------------------------------------

# I campi che servono alla pagina. Tutto il resto viene buttato per tenere
# il file leggero: viene scaricato da chi apre la pagina, non da noi.
CAMPI = ("id", "name", "created", "context_length", "description",
         "hugging_face_id", "expiration_date", "architecture", "pricing",
         "top_provider", "supported_parameters", "reasoning", "benchmarks",
         "supported_voices")


def snellisci(m):
    o = {k: m.get(k) for k in CAMPI if m.get(k) is not None}
    if o.get("description"):
        o["description"] = o["description"][:400]
    a = o.get("architecture") or {}
    o["architecture"] = {k: a.get(k) for k in
                         ("input_modalities", "output_modalities", "modality") if a.get(k)}
    b = (o.get("benchmarks") or {}).get("artificial_analysis")
    o["benchmarks"] = {"artificial_analysis": b} if b else None
    if o["benchmarks"] is None:
        del o["benchmarks"]
    tp = o.get("top_provider") or {}
    if tp:
        o["top_provider"] = {"max_completion_tokens": tp.get("max_completion_tokens")}
    p = o.get("pricing") or {}
    o["pricing"] = {k: p.get(k) for k in
                    ("prompt", "completion", "input_cache_read", "input_cache_write",
                     "image", "audio", "request", "web_search") if p.get(k)}
    sp = set(o.get("supported_parameters") or [])
    o["supported_parameters"] = sorted(sp & {"tools", "reasoning", "structured_outputs"})
    return o


def prezzo(m, chiave):
    """Prezzo per milione di token, o None."""
    v = (m.get("pricing") or {}).get(chiave)
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return round(v * 1_000_000, 6) if v > 0 else 0.0


def nome_pulito(m):
    n = m.get("name") or m["id"]
    return n.split(": ", 1)[1] if ": " in n else n


def catalogo():
    dati = json.loads(scarica(OPENROUTER))["data"]
    # Le varianti ":batch", ":free", ":extended" dello stesso modello confondono
    # e basta: teniamo la principale e segnaliamo a parte se ne esiste una gratuita.
    gratuiti = {m["id"].split(":")[0] for m in dati if m["id"].endswith(":free")}
    puliti = []
    for m in dati:
        if ":" in m["id"] and not m["id"].endswith(":free"):
            continue
        if m["id"].startswith("openrouter/"):      # meta-modelli di instradamento
            continue
        o = snellisci(m)
        o["ha_versione_gratuita"] = m["id"].split(":")[0] in gratuiti
        puliti.append(o)
    puliti.sort(key=lambda x: -(x.get("created") or 0))
    return puliti


# ----------------------------------------------------------------------------
# 2. Notizie dedotte dal confronto fra ieri e oggi
# ----------------------------------------------------------------------------

def euro(v):
    if v is None:
        return "n.d."
    s = ("%.3f" % v).rstrip("0").rstrip(".") if v < 1 else ("%.2f" % v).rstrip("0").rstrip(".")
    return "$" + s.replace(".", ",")


def notizie(oggi, ieri):
    """Confronta due istantanee e scrive le notizie in italiano."""
    vecchi = {m["id"]: m for m in ieri}
    n, adesso = [], datetime.now(timezone.utc)
    oggi_iso = adesso.date().isoformat()

    # --- modelli comparsi ---
    nuovi = [m for m in oggi if m["id"] not in vecchi]
    if not vecchi:  # primo giro: niente confronto, prendiamo gli ultimi 30 giorni
        nuovi = [m for m in oggi
                 if m.get("created") and (adesso.timestamp() - m["created"]) < 30 * 86400]

    for m in sorted(nuovi, key=lambda x: -(x.get("created") or 0))[:6]:
        aa = ((m.get("benchmarks") or {}).get("artificial_analysis") or {}).get("intelligence_index")
        pi, po = prezzo(m, "prompt"), prezzo(m, "completion")
        aperto = bool(m.get("hugging_face_id"))
        testo = "%s entra nel catalogo." % nome_pulito(m)
        if pi is not None and po is not None:
            testo += " Prezzo: %s per milione di token in entrata, %s in uscita." % (euro(pi), euro(po))
        if m.get("context_length"):
            testo += " Tiene %s token di contesto." % format(m["context_length"], ",d").replace(",", ".")
        if aa:
            testo += " Punteggio di intelligenza indipendente: %s." % str(aa).replace(".", ",")
        n.append({
            "tag": "hot" if (aa and aa > 45) else ("open" if aperto else ""),
            "tagT": "Pesi aperti" if aperto else "Nuovo modello",
            "data": date.fromtimestamp(m["created"]).isoformat() if m.get("created") else oggi_iso,
            "titolo": "%s: e' disponibile da oggi" % nome_pulito(m),
            "testo": testo,
            "perche": ("Puoi scaricarlo e farlo girare su macchine tue, senza che i dati escano."
                       if aperto else
                       "Un'opzione in piu' da mettere sul tavolo quando scegli con chi lavorare."),
            "id": "nuovo-" + re.sub(r"[^a-z0-9]+", "-", m["id"].lower()),
        })

    # --- prezzi cambiati ---
    for m in oggi:
        v = vecchi.get(m["id"])
        if not v:
            continue
        for chiave, verso in (("prompt", "in entrata"), ("completion", "in uscita")):
            a, b = prezzo(v, chiave), prezzo(m, chiave)
            if a is None or b is None or a == 0 or a == b:
                continue
            delta = (b - a) / a
            if abs(delta) < 0.05:      # sotto il 5% e' rumore
                continue
            giu = delta < 0
            n.append({
                "tag": "ok" if giu else "warn",
                "tagT": "Prezzo giu'" if giu else "Prezzo su'",
                "data": oggi_iso,
                "titolo": "%s: il prezzo %s %s del %d%%" % (
                    nome_pulito(m), verso, "scende" if giu else "sale", round(abs(delta) * 100)),
                "testo": "Da %s a %s per milione di token %s." % (euro(a), euro(b), verso),
                "perche": ("Se lo stai usando, la bolletta del mese prossimo cala da sola."
                           if giu else
                           "Se lo stai usando, la bolletta del mese prossimo sale: vale la pena rifare due conti."),
                "id": "prezzo-" + re.sub(r"[^a-z0-9]+", "-", (m["id"] + chiave).lower()),
            })

    # --- dismissioni in arrivo ---
    for m in oggi:
        sc = m.get("expiration_date")
        if not sc:
            continue
        try:
            g = (date.fromisoformat(sc) - adesso.date()).days
        except ValueError:
            continue
        if 0 <= g <= 60:
            n.append({
                "tag": "crit",
                "tagT": "Chiusura",
                "data": oggi_iso,
                "titolo": "%s viene spento fra %d giorni" % (nome_pulito(m), g),
                "testo": "Il fornitore ha fissato la data di dismissione al %s. Dopo, le richieste smettono di funzionare." % sc,
                "perche": "Se qualcosa nel tuo lavoro passa da qui, spostalo prima di quella data.",
                "id": "fine-" + re.sub(r"[^a-z0-9]+", "-", m["id"].lower()),
            })

    ordine = {"crit": 0, "hot": 1, "ok": 2, "warn": 3, "open": 4, "": 5}
    n.sort(key=lambda x: (ordine.get(x["tag"], 9), x["data"]), reverse=False)
    return n[:14]


# ----------------------------------------------------------------------------
# 3. Ricerca scientifica sul risparmio di token
# ----------------------------------------------------------------------------

def paper():
    try:
        xml = scarica(ARXIV, timeout=45)
    except Exception as e:
        print("  arXiv non raggiungibile (%s), lascio i paper precedenti" % e, file=sys.stderr)
        return None
    out = []
    for e in re.findall(r"<entry>(.*?)</entry>", xml, re.S):
        def campo(tag):
            m = re.search(r"<%s>(.*?)</%s>" % (tag, tag), e, re.S)
            return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""
        tit, pub, url = campo("title"), campo("published")[:10], campo("id")
        somm = campo("summary")
        if not tit or not url:
            continue
        out.append({"titolo": tit, "data": pub, "url": url,
                    "id": url.rstrip("/").split("/")[-1],
                    "sommario": somm[:280]})
    return out[:12] or None


# ----------------------------------------------------------------------------

def leggi(nome, difetto):
    p = os.path.join(DATI, nome)
    if not os.path.exists(p):
        return difetto
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return difetto


def scrivi(nome, contenuto):
    os.makedirs(DATI, exist_ok=True)
    with open(os.path.join(DATI, nome), "w", encoding="utf-8") as f:
        json.dump(contenuto, f, ensure_ascii=False, indent=1)
    print("  scritto dati/%s" % nome)


def main():
    adesso = datetime.now(timezone.utc)
    print("Radar AI — raccolta del %s" % adesso.isoformat(timespec="seconds"))

    precedente = leggi("cache.json", {})
    ieri = precedente.get("modelli", [])

    print("Scarico il catalogo OpenRouter...")
    modelli = catalogo()
    print("  %d modelli (erano %d)" % (len(modelli), len(ieri)))

    print("Confronto con l'istantanea precedente...")
    nuove = notizie(modelli, ieri)
    print("  %d notizie" % len(nuove))
    # le notizie di oggi si aggiungono in cima a quelle di ieri, senza doppioni
    storiche = leggi("notizie.json", {}).get("notizie", [])
    visti = {x["id"] for x in nuove}
    unite = nuove + [x for x in storiche if x["id"] not in visti]

    scrivi("cache.json", {
        "aggiornato": adesso.isoformat(timespec="seconds"),
        "aggiornato_it": data_it(adesso.date()),
        "fonte": "OpenRouter (openrouter.ai/api/v1/models)",
        "totale": len(modelli),
        "modelli": modelli,
    })
    scrivi("notizie.json", {
        "aggiornato": adesso.isoformat(timespec="seconds"),
        "notizie": unite[:24],
    })

    print("Cerco i paper su arXiv...")
    p = paper()
    if p:
        scrivi("paper.json", {"aggiornato": adesso.isoformat(timespec="seconds"), "paper": p})
        print("  %d paper" % len(p))

    print("Fatto.")


if __name__ == "__main__":
    main()
