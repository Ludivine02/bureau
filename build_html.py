#!/usr/bin/env python3
"""
build_html.py — Génère une version TOUT-EN-UN de l'outil : un unique fichier
'outil_tva_galerie.html' qui embarque la mise en forme (styles.css), le code
(regles.js, app.js) et les données (historique_seed.js).

Avantage : un seul fichier à ouvrir d'un double-clic, où qu'il soit placé —
aucun risque de fichiers compagnons manquants (problème classique quand on
ouvre index.html directement depuis un ZIP non décompressé).

Usage : python3 build_html.py   (après build_seed.py)
"""
import re

idx = open("index.html", encoding="utf-8").read()
css = open("styles.css", encoding="utf-8").read()

idx = idx.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + css + "\n</style>")
for src in ["regles.js", "historique_seed.js", "app.js"]:
    content = open(src, encoding="utf-8").read().replace("</script>", "<\\/script>")
    idx = idx.replace('<script src="%s"></script>' % src, "<script>\n" + content + "\n</script>")

leftover = re.findall(r'(?:src|href)="([^"]+\.(?:js|css))"', idx)
if leftover:
    raise SystemExit("Références externes restantes : %s" % leftover)

open("outil_tva_galerie.html", "w", encoding="utf-8").write(idx)
print("outil_tva_galerie.html généré (%d octets) — aucun fichier externe." % len(idx))
