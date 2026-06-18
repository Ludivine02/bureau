#!/usr/bin/env python3
"""
import_excel.py — Convertit le classeur Excel existant de la galerie
("TABLEAU_MARGE ... POUR_TVA.xlsx", onglet "Suivi du CA") en un fichier JSON
importable dans l'outil web (bouton « Importer »).

Usage :
    pip install openpyxl
    python3 import_excel.py "TABLEAU_MARGE_2026_POUR_TVA.xlsx" -o ventes.json

Puis, dans l'outil web : « Importer (JSON/CSV) » > ventes.json.

Le script fait une PRÉ-qualification du régime à partir de la colonne
« Choix TVA » de l'ancien fichier ; il revient ensuite au moteur de l'outil
(regles.js) de re-trancher selon la réglementation 2025. Les champs non
présents dans l'ancien fichier (mode d'acquisition, conditions du droit de
suite, etc.) doivent être complétés ensuite dans l'outil.
"""
import argparse
import json
import sys

# Colonnes de l'onglet "Suivi du CA" (en-têtes ligne 2, données à partir de la ligne 3)
COLS = {
    "ligneCompta": "Ligne",
    "numFacture": "N° Facture",
    "dateFacture": "Date",
    "artiste": "Artiste",
    "oeuvre": "Œuvre",
    "refSiam": "Référence SIAM",
    "venteTTC": "Ventes TTC",
    "achatTTC": "Achats TTC",
    "client": "Client",
    "pays": "Pays",
    "typeClient": "Type client",
    "choixTVA": "Choix TVA",
    "commentaire": "Commentaire divers",
}

UE = {"allemagne", "belgique", "espagne", "italie", "pays-bas", "luxembourg",
      "portugal", "autriche", "irlande", "grèce", "pologne", "suède",
      "danemark", "finlande", "tchéquie", "roumanie", "hongrie", "slovaquie",
      "slovénie", "croatie", "bulgarie", "lituanie", "lettonie", "estonie",
      "chypre", "malte"}


def deviner_zone(pays):
    if not pays:
        return "FR"
    p = str(pays).strip().lower()
    if "france" in p:
        return "FR"
    if any(x in p for x in UE):
        return "UE"
    return "HUE"


def map_type_client(s):
    return "professionnel" if s and "pro" in str(s).lower() else "particulier"


def map_regime(s):
    if not s:
        return ""
    x = str(s).lower()
    if "export" in x:
        return "EXPORT"
    if "intra" in x:
        return "INTRACOM"
    if "5,5" in x or "5.5" in x:
        return "DC_55"
    if "20" in x:
        return "DC_20"
    if "forfait" in x:
        return "MARGE_FORFAITAIRE"
    if "marge" in x:
        return "MARGE"
    return ""


def norm_date(d):
    try:
        return d.strftime("%Y-%m-%d")
    except AttributeError:
        return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx", help="chemin du fichier Excel")
    ap.add_argument("-o", "--out", default="ventes.json")
    ap.add_argument("--sheet", default="Suivi du CA")
    args = ap.parse_args()

    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl requis : pip install openpyxl")

    wb = openpyxl.load_workbook(args.xlsx, data_only=True)
    if args.sheet not in wb.sheetnames:
        sys.exit(f"Onglet '{args.sheet}' introuvable. Onglets : {wb.sheetnames}")
    ws = wb[args.sheet]

    # En-têtes en ligne 2
    headers = {}
    for c in range(1, ws.max_column + 1):
        val = ws.cell(row=2, column=c).value
        if val is not None:
            headers[str(val).strip()] = c

    def col(name):
        return headers.get(name)

    ventes = []
    for r in range(3, ws.max_row + 1):
        ligne = ws.cell(row=r, column=col(COLS["ligneCompta"])).value if col(COLS["ligneCompta"]) else None
        vente_ttc = ws.cell(row=r, column=col(COLS["venteTTC"])).value if col(COLS["venteTTC"]) else None
        if ligne is None and vente_ttc is None:
            continue
        pays = ws.cell(row=r, column=col(COLS["pays"])).value if col(COLS["pays"]) else ""
        v = {
            "id": f"xl{r}",
            "ligneCompta": ligne,
            "numFacture": ws.cell(row=r, column=col(COLS["numFacture"])).value if col(COLS["numFacture"]) else "",
            "dateFacture": norm_date(ws.cell(row=r, column=col(COLS["dateFacture"])).value) if col(COLS["dateFacture"]) else "",
            "artiste": ws.cell(row=r, column=col(COLS["artiste"])).value if col(COLS["artiste"]) else "",
            "oeuvre": ws.cell(row=r, column=col(COLS["oeuvre"])).value if col(COLS["oeuvre"]) else "",
            "refSiam": ws.cell(row=r, column=col(COLS["refSiam"])).value if col(COLS["refSiam"]) else "",
            "natureBien": "oeuvre_art",
            "venteTTC": vente_ttc,
            "achatTTC": ws.cell(row=r, column=col(COLS["achatTTC"])).value if col(COLS["achatTTC"]) else "",
            "modeAcquisition": "",  # à compléter dans l'outil (réforme 2025)
            "client": ws.cell(row=r, column=col(COLS["client"])).value if col(COLS["client"]) else "",
            "pays": pays,
            "zone": deviner_zone(pays),
            "typeClient": map_type_client(ws.cell(row=r, column=col(COLS["typeClient"])).value if col(COLS["typeClient"]) else ""),
            "regimeChoisi": map_regime(ws.cell(row=r, column=col(COLS["choixTVA"])).value if col(COLS["choixTVA"]) else ""),
            "commentaire": ws.cell(row=r, column=col(COLS["commentaire"])).value if col(COLS["commentaire"]) else "",
            "ds": {},
            "tf": {},
        }
        # Nettoyage : None -> ""
        for k, val in list(v.items()):
            if val is None:
                v[k] = ""
        ventes.append(v)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"ventes": ventes, "compta": {}}, f, ensure_ascii=False, indent=2)

    print(f"{len(ventes)} vente(s) exportée(s) vers {args.out}")
    print("⚠️  Complétez ensuite dans l'outil : mode d'acquisition, conditions "
          "du droit de suite et de la taxe forfaitaire (absents de l'ancien fichier).")


if __name__ == "__main__":
    main()
