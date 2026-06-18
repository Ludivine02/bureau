#!/usr/bin/env python3
"""
build_seed.py — Génère historique_seed.js à partir de historique_ventes.json.

Le fichier produit embarque l'historique directement dans l'outil : les ventes
apparaissent dans le tableau dès l'ouverture de index.html (en local, sans
Internet, sans réimport manuel).

Usage :
    python3 build_seed.py            # lit historique_ventes.json
    python3 build_seed.py mon.json
"""
import json
import sys

src = sys.argv[1] if len(sys.argv) > 1 else "historique_ventes.json"
with open(src, encoding="utf-8") as f:
    data = json.load(f)

header = (
    "/* Historique des ventes embarqué — chargé automatiquement au premier\n"
    "   lancement, uniquement si aucune donnee n'est deja enregistree dans le\n"
    "   navigateur. Regenerer avec : python3 build_seed.py */\n"
    "window.__HISTORIQUE_SEED__ = "
)
with open("historique_seed.js", "w", encoding="utf-8") as f:
    f.write(header)
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write(";\n")

print("historique_seed.js genere :", len(data.get("ventes", [])), "ventes")
