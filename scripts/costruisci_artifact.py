#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Costruisce la versione a file unico per l'Artifact di Claude.

L'Artifact vive in una gabbia che non lascia uscire richieste di rete: la
pagina non puo' leggere ne' OpenRouter ne' i file dentro dati/. Quindi qui
si incolla tutto dentro un solo file HTML — stile, codice e un'istantanea
dei dati — e la pagina, non riuscendo a uscire, ripiega su quella copia.

Il risultato e' radar-ai-artifact.html, da pubblicare come Artifact.
La versione viva resta quella su GitHub Pages.
"""

import json, os, re, sys

QUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def leggi(*p):
    with open(os.path.join(QUI, *p), encoding="utf-8") as f:
        return f.read()


def json_di(*p):
    return json.loads(leggi(*p))


def main():
    html = leggi("index.html")
    css = leggi("stile.css")
    js = leggi("app.js")

    incorporati = {
        "statici": json_di("dati", "statici.json"),
        "extra": json_di("dati", "extra.json"),
        "cache": json_di("dati", "cache.json"),
        "notizie": json_di("dati", "notizie.json"),
        "paper": json_di("dati", "paper.json"),
    }
    # Il testo lungo delle descrizioni non serve alla pagina: via, pesa e basta.
    for m in incorporati["cache"].get("modelli", []):
        m.pop("description", None)

    dati = json.dumps(incorporati, ensure_ascii=False, separators=(",", ":"))
    # "</script>" dentro una stringa chiuderebbe il tag: va spezzato.
    dati = dati.replace("</", "<\\/")

    # L'Artifact incolla il file dentro il proprio scheletro: niente doctype,
    # niente <html>, niente <head>, niente <body> nostri.
    corpo = html
    corpo = re.sub(r"(?is)^.*?<body[^>]*>", "", corpo)
    corpo = re.sub(r"(?is)</body>.*$", "", corpo)

    testa = re.search(r"(?is)<head[^>]*>(.*?)</head>", html).group(1)
    titolo = re.search(r"(?is)<title>(.*?)</title>", testa).group(1)
    fonts = re.findall(r'(?i)<link rel="(?:preconnect|stylesheet)"[^>]*fonts\.[^>]*>', testa)

    fuori = (
        "<title>%s</title>\n" % titolo
        + "\n".join(fonts) + "\n"
        + "<style>\n" + css + "\n</style>\n"
        + corpo.replace('<script src="app.js"></script>', "")
        + '\n<script>\nconst DATI_INCORPORATI = ' + dati + ';\n</script>\n'
        + "<script>\n" + js + "\n</script>\n"
    )

    fuori_path = os.path.join(QUI, "radar-ai-artifact.html")
    with open(fuori_path, "w", encoding="utf-8") as f:
        f.write(fuori)

    kb = os.path.getsize(fuori_path) / 1024
    print("Scritto radar-ai-artifact.html — %.0f KB, %d modelli nell'istantanea"
          % (kb, len(incorporati["cache"].get("modelli", []))))
    if kb > 15000:
        print("ATTENZIONE: sopra il limite di 16 MB degli Artifact.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
