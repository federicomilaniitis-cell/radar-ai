# 📡 Radar AI

Il bollettino dei modelli di intelligenza artificiale, in italiano e senza gergo.
Novità, prezzi, confronti, calcolatore di spesa e tecniche per risparmiare token —
spiegati a chi non è un ingegnere informatico.

**La pagina non contiene nessun elenco di modelli scritto a mano.** Legge il catalogo
in diretta ogni volta che la apri: se domani nasce un fornitore nuovo, compare da solo.

---

## Come funziona

```
apri la pagina
      │
      ├─ 1. openrouter.ai/api/v1/models ......... in diretta, dal browser  ✅ preferito
      ├─ 2. dati/cache.json ..................... istantanea del repository
      └─ 3. copia inclusa nel file .............. per la versione Artifact
```

Il primo che risponde vince. La barra sotto la testata dice sempre quale sta usando:
**In diretta**, **Da istantanea** o **Copia inclusa**.

Il pulsante **↻ Aggiorna ora** rilegge tutto all'istante, senza aspettare nessuno.

### Cosa viene calcolato e cosa è scritto

| Dato | Da dove arriva |
|---|---|
| Elenco modelli, prezzi, contesto, data di uscita | OpenRouter, in diretta |
| Punteggio di intelligenza, codice, agenti | Artificial Analysis (dentro OpenRouter) |
| Pesi aperti sì/no | presenza di una pagina Hugging Face |
| Dismissioni e conti alla rovescia | campo `expiration_date` del fornitore |
| Categorie (ragiona, vede, legge PDF, usa strumenti…) | dedotte dalle capacità dichiarate |
| Modello di punta in prima pagina | il punteggio più alto del momento |
| Notizie «prezzo su / prezzo giù» | confronto fra l'istantanea di ieri e quella di oggi |
| Lavori scientifici sul risparmio token | arXiv |
| Video, voce, alcune immagini | `dati/extra.json`, curato a mano |
| Dizionario e tecniche di risparmio | `dati/statici.json`, scritti |

---

## Aggiornamento automatico

`.github/workflows/aggiorna.yml` gira **ogni sei ore** (07, 13, 19, 01 ora italiana),
rigenera i file dentro `dati/` e ripubblica il sito su GitHub Pages.

Per farlo partire a mano: scheda **Actions** → *Aggiorna i dati* → **Run workflow**.

---

## I file

```
index.html                     la pagina
stile.css                      colori, tipografia, componenti
app.js                         caricamento dati, grafici, filtri, chat
dati/cache.json                istantanea del catalogo        ← generato
dati/notizie.json              notizie dedotte dal confronto  ← generato
dati/paper.json                ricerche da arXiv              ← generato
dati/extra.json                video e voce                   ← curato
dati/statici.json              dizionario, tecniche, scenari  ← curato
scripts/aggiorna.py            la raccolta dati
scripts/costruisci_artifact.py crea il file unico per Claude
scripts/servi.py               server locale per le prove
```

## Provare in locale

```bash
python3 scripts/aggiorna.py     # rinfresca i dati
python3 scripts/servi.py        # poi apri http://localhost:8791
```

Serve un server: aprendo `index.html` con un doppio clic il browser blocca la
lettura dei file dentro `dati/`.

## Versione per Claude

```bash
python3 scripts/costruisci_artifact.py
```

Produce `radar-ai-artifact.html`, un file unico con tutto dentro. Serve perché
l'Artifact di Claude non lascia uscire richieste di rete: quella versione mostra
l'ultima istantanea, in cambio ha la chat che risponde nella pagina stessa.

---

## La chat

Nella pagina c'è un riquadro **Chiedi al Radar** che sa rispondere sui modelli
usando i dati che hai davanti. Puoi scegliere chi risponde:

- **Qui dentro** — funziona solo nella versione Artifact su Claude
- **ChatGPT**, **Gemini**, **Claude** — apre l'app in una scheda nuova con la
  domanda già scritta, e mette negli appunti anche i dati della pagina

Nessuna chiave d'accesso è scritta nel codice, e non ce ne sono nel repository:
una chiave dentro una pagina web sarebbe leggibile da chiunque la apra.

---

## Avvertenze

I prezzi cambiano spesso e i listini dei fornitori restano l'unica fonte
vincolante. Il calcolatore di spesa dà un ordine di grandezza per confrontare i
modelli fra loro, non un preventivo. Un'AI può riportare un dato sbagliato con
la stessa sicurezza di uno giusto: se una cifra conta, verificala alla fonte.
