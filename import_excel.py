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
    "tvaCompta": "TVA Collectée",
    "venteHT": "Ventes HT",
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


def _num(x):
    try:
        return float(str(x).replace(" ", "").replace(",", ".")) if x not in ("", None) else 0.0
    except ValueError:
        return 0.0


# Mots-clés de libellés qui ne sont PAS des œuvres d'art
SERVICE_KW = ("commission", "refacturation", "refacture")
ECRITURE_KW = ("extourne", "cumul", "ecart", "écart", "provision", "pca", "fae", "artlogic")


def enrichir(v):
    """Pré-remplit les champs déterminants quand ils se déduisent sans ambiguïté
    du régime d'origine et du libellé. N'invente jamais les conditions du droit
    de suite ni de la taxe forfaitaire (laissées vides, à valider)."""
    notes = []
    reg = v.get("regimeChoisi") or ""
    achat = _num(v.get("achatTTC"))
    lib = str(v.get("oeuvre") or "").lower()

    # ---- Nature du bien ----
    if any(k in lib for k in ECRITURE_KW) or (not lib.strip() and not _num(v.get("venteTTC"))):
        # Ligne d'écriture comptable / cadrage : à exclure ou reclasser
        notes.append("ligne d'écriture comptable à vérifier (exclure ou reclasser)")
    elif any(k in lib for k in SERVICE_KW) or "frais" in lib:
        v["natureBien"] = "prestation"
        notes.append("nature = prestation/commission (déduit du libellé) → 20%")
    elif reg == "DC_20":
        v["natureBien"] = "bien_non_art"
        notes.append("nature = bien non éligible au 5,5% (régime 20% d'origine)")

    # ---- Mode d'acquisition (pilote marge vs droit commun) ----
    if "MARGE" in reg:
        v["modeAcquisition"] = "sans_tva"
        notes.append("acquisition sans TVA déductible (régime de marge d'origine)")
    elif reg in ("DC_55", "DC_20") and v.get("natureBien") != "":
        if achat:
            v["modeAcquisition"] = "tva_normale"
            notes.append("acquisition avec TVA normale (déduit : achat présent + droit commun)")
        else:
            v["modeAcquisition"] = "aucun_achat"
            notes.append("aucun achat (déduit)")
    # EXPORT / INTRACOM : le mode d'acquisition n'a pas d'effet sur l'exonération → laissé vide.

    if notes:
        prefix = "[auto] " + " ; ".join(notes)
        v["commentaire"] = (prefix + (" | " + v["commentaire"] if v.get("commentaire") else "")).strip()
    return v


# ---------------------------------------------------------------------------
#  NOUVELLE STRUCTURE : "OUTIL_TVA_GALERIE … .xlsx" (onglet "Suivi des ventes")
#  En-têtes en ligne 2, données à partir de la ligne 3. Achats détaillés.
# ---------------------------------------------------------------------------
REGIME_MAP_NEW = {
    "exportation exo": ("EXPORT", "oeuvre_art"),
    "livraison intra. exo": ("INTRACOM", "oeuvre_art"),
    "droit commun 5,5%": ("DC_55", "oeuvre_art"),
    "droit commun 20%": ("DC_20", "oeuvre_art"),
    "marge réelle (option 297 a)": ("MARGE", "oeuvre_art"),
    "commission": ("DC_20", "prestation"),
    "location le muy": ("DC_20", "prestation"),
    "catalogue 5,5%": ("DC_55", "produit_annexe"),
    "produits annexes 5,5%": ("DC_55", "produit_annexe"),
    "produits annexes 20%": ("DC_20", "produit_annexe"),
    "produits annexes hue": ("EXPORT", "produit_annexe"),
    "produits annexes ue": ("INTRACOM", "produit_annexe"),
}
ZONE_MAP_NEW = {"france": "FR", "ue": "UE", "hors ue": "HUE"}


def _val(ws, r, c):
    return ws.cell(row=r, column=c).value


def lire_balance(wb):
    """Lit l'onglet 'Balance BG' -> dict {compte: solde_net} (Cr - Db)."""
    nom = next((s for s in wb.sheetnames if s.lower().startswith("balance")), None)
    if not nom:
        return {}
    ws = wb[nom]
    bal = {}
    for r in range(2, ws.max_row + 1):
        cpt = ws.cell(row=r, column=1).value
        net = ws.cell(row=r, column=5).value  # E : solde net (Cr - Db)
        if cpt is None:
            continue
        cpt = str(cpt).strip()
        if cpt and net not in (None, ""):
            bal[cpt] = _num(net)
    return bal


def lire_nouvelle_structure(ws):
    """Lit l'onglet 'Suivi des ventes 20xx' de la nouvelle base."""
    ventes = []
    n = 0
    for r in range(3, ws.max_row + 1):
        regime_lbl = _val(ws, r, 7)   # G
        vente_ttc = _val(ws, r, 11)   # K
        if regime_lbl in (None, "TOTAUX") and vente_ttc is None:
            continue
        if str(regime_lbl).strip().upper() == "TOTAUX":
            continue
        n += 1
        reg_code, nature = REGIME_MAP_NEW.get(str(regime_lbl).strip().lower(), ("", "oeuvre_art"))
        zone = ZONE_MAP_NEW.get(str(_val(ws, r, 34) or "").strip().lower(), "")  # AH
        if not zone:
            zone = deviner_zone(_val(ws, r, 8))  # H pays

        stock = _num(_val(ws, r, 15))   # O Vente sur stock
        ach2026 = _num(_val(ws, r, 16))  # P Achats 2026
        achat_ttc = stock + ach2026
        frais = _val(ws, r, 17)          # Q
        commissions = _val(ws, r, 18)    # R

        dds_appli = "oui" if str(_val(ws, r, 19) or "").strip().lower() == "oui" else \
                    ("non" if str(_val(ws, r, 19) or "").strip().lower() == "non" else "")
        tf_appli = "oui" if str(_val(ws, r, 23) or "").strip().lower() == "oui" else \
                   ("non" if str(_val(ws, r, 23) or "").strip().lower() == "non" else "")

        mode = ""
        if reg_code == "MARGE":
            mode = "sans_tva"
        elif reg_code in ("DC_55", "DC_20"):
            mode = "tva_normale" if achat_ttc else "aucun_achat"

        v = {
            "id": f"xl{r}",
            "ligneCompta": n,
            "numFacture": _val(ws, r, 2),
            "dateFacture": norm_date(_val(ws, r, 3)),
            "artiste": _val(ws, r, 4),
            "oeuvre": _val(ws, r, 5),
            "refSiam": _val(ws, r, 6),
            "natureBien": nature,
            "regimeSource": str(regime_lbl).strip(),   # libellé d'origine (précise le compte)
            "venteTTC": vente_ttc,
            "htCompta": _val(ws, r, 12),         # L Ventes HT (réf. compta)
            "tvaCompta": _val(ws, r, 13),        # M TVA collectée (réf. compta)
            "margeBaseRef": _val(ws, r, 14),     # N Base marge 297 A (réf.)
            "achatTTC": achat_ttc,               # O + P (stock + achats 2026)
            "venteSurStock": stock,
            "achats2026": ach2026,
            "fraisAccessoiresHT": frais,
            "commissions": commissions,
            "modeAcquisition": mode,
            "client": "",
            "pays": _val(ws, r, 8),
            "zone": zone,
            "typeClient": map_type_client(_val(ws, r, 9)),
            "compteRef": _val(ws, r, 10),        # J N° Compte (réf. compta)
            "regimeChoisi": reg_code,
            "commentaire": _val(ws, r, 29),
            "exercice": _val(ws, r, 30),
            "ds": {
                "applicabiliteManuelle": dds_appli,
                "baseReference": _val(ws, r, 20),     # T
                "montantReference": _val(ws, r, 22),  # V DdS facturé
            },
            "tf": {
                "applicabiliteManuelle": tf_appli,
                "baseReference": _val(ws, r, 24),     # X
                "montantReference": _val(ws, r, 25),  # Y Taxe forf. 6,5%
                "typeObjet": "art",
                "vendeurDomicilieFR": True,
            },
        }
        for k, val in list(v.items()):
            if val is None:
                v[k] = ""
        ventes.append(v)
    return ventes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx", help="chemin du fichier Excel")
    ap.add_argument("-o", "--out", default="ventes.json")
    ap.add_argument("--sheet", default="Suivi du CA")
    ap.add_argument("--enrich", action="store_true",
                    help="pré-remplit mode d'acquisition / nature du bien quand ils se déduisent du régime d'origine")
    args = ap.parse_args()

    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl requis : pip install openpyxl")

    wb = openpyxl.load_workbook(args.xlsx, data_only=True)

    # Détection automatique de la nouvelle base ("Suivi des ventes …")
    nouvelle = next((s for s in wb.sheetnames if s.lower().startswith("suivi des ventes")), None)
    if nouvelle:
        ventes = lire_nouvelle_structure(wb[nouvelle])
        balance = lire_balance(wb)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"ventes": ventes, "compta": {}, "balanceBG": balance},
                      f, ensure_ascii=False, indent=2)
        print(f"{len(ventes)} vente(s) importée(s) depuis '{nouvelle}' vers {args.out}")
        print(f"Balance Générale : {len(balance)} comptes repris (pour le cadrage ventes & achats).")
        return

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
            # Valeurs de référence telles que comptabilisées dans l'ancien fichier
            # (servent au cadrage : comparaison avec le recalcul de l'outil).
            "htCompta": ws.cell(row=r, column=col(COLS["venteHT"])).value if col(COLS["venteHT"]) else "",
            "tvaCompta": ws.cell(row=r, column=col(COLS["tvaCompta"])).value if col(COLS["tvaCompta"]) else "",
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
        if args.enrich:
            v = enrichir(v)
        ventes.append(v)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"ventes": ventes, "compta": {}}, f, ensure_ascii=False, indent=2)

    print(f"{len(ventes)} vente(s) exportée(s) vers {args.out}")
    print("⚠️  Complétez ensuite dans l'outil : mode d'acquisition, conditions "
          "du droit de suite et de la taxe forfaitaire (absents de l'ancien fichier).")


if __name__ == "__main__":
    main()
