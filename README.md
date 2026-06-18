# Outil TVA — Galerie d'art

Outil d'aide à la décision pour accompagner une galerie d'art dans l'application
du **régime de TVA** (export / livraison intracommunautaire / taux réduit 5,5% /
régime de la marge), le **droit de suite**, la **taxe forfaitaire sur les objets
précieux**, et le **cadrage avec la comptabilité** — conforme à la réglementation
**en vigueur au 1er janvier 2025**.

Il remplace l'ancien classeur Excel `TABLEAU_MARGE…POUR_TVA.xlsx`, dont la logique
était devenue partiellement obsolète après la réforme 2025.

## Lancer l'outil

Aucune installation : ouvrez **`index.html`** dans un navigateur (Chrome, Edge,
Firefox, Safari). Les données sont enregistrées **localement** dans le navigateur
(localStorage) ; rien n'est envoyé sur Internet.

**L'historique des ventes est pré-chargé** : au premier lancement, l'outil charge
automatiquement les ventes embarquées dans `historique_seed.js` — elles
apparaissent directement dans le tableau (onglet 2 · Ventes), sans réimport. Vos
modifications sont ensuite conservées dans le navigateur. Le bouton « Tout
effacer » remet l'historique d'origine au rechargement suivant.

Pour régénérer l'historique embarqué après une mise à jour de l'Excel :

```bash
# Nouvelle base "OUTIL_TVA_GALERIE … .xlsx" (détectée automatiquement,
# reprend ventes, achats, droit de suite, taxe forfaitaire et Balance Générale) :
python3 import_excel.py "OUTIL_TVA_GALERIE_2026.xlsx" -o historique_ventes.json
python3 build_seed.py

# Ancien classeur "TABLEAU_MARGE …" (ajouter --enrich pour pré-remplir) :
python3 import_excel.py "TABLEAU_MARGE_2026_POUR_TVA.xlsx" -o historique_ventes.json --enrich
python3 build_seed.py
```

Fichiers :
- `index.html` — interface
- `styles.css` — mise en forme
- `app.js` — logique d'écran, persistance, import/export, tableau de bord
- `regles.js` — **moteur réglementaire** (tous les taux, seuils, barèmes, arbres
  de décision) — *c'est ici que le cabinet vérifie / met à jour la règle fiscale*
- `import_excel.py` — convertit l'ancien Excel en JSON importable

## Les 8 écrans

| Onglet | Rôle |
|---|---|
| **0 · Tableau de bord** | CA, marge, taux de marge, top ventes, top taux de marge, top artistes, répartition par régime. Filtrable par période. |
| **1 · Saisie guidée** | Questionnaire qui détermine automatiquement le régime, le droit de suite et la taxe forfaitaire, et signale les points à vérifier. |
| **2 · Ventes** | Tableau de toutes les ventes avec régime, marge, TVA, droit de suite, taxe forfaitaire et indicateur d'alerte. |
| **3 · Récap TVA (CA3)** | Ventilation par régime et par ligne de la CA3 (04 export, 06 intracom, 08 / 09, 05 non imposable). |
| **4 · Droit de suite** | Œuvres concernées + barème dégressif (plafond 12 500 €). |
| **5 · Taxe forfaitaire** | Cessions par des particuliers (art. 150 VI s.). |
| **6 · Cadrage compta** | Cadrage avec la Balance Générale en 3 volets : **A.** CA par compte (classe 70), **B.** TVA collectée (44571*), **C.** achats & coûts (classe 6 : achats d'œuvres, frais, commissions, droit de suite, taxe forfaitaire). Écarts BG − outil automatiques. |
| **7 · Contrôles** | Toutes les questions d'orientation et alertes consolidées (rouge = erreur probable). |
| **8 · Artistes** | Référentiel des artistes : statut droit de suite (vivant ou décédé ≤ 70 ans) et défaut taxe forfaitaire, renseignés une fois et propagés automatiquement à toutes les ventes de l'artiste. |

## Importer l'historique depuis l'ancien Excel

```bash
pip install openpyxl
python3 import_excel.py "TABLEAU_MARGE_2026_POUR_TVA.xlsx" -o ventes.json
```

Puis dans l'outil : **Importer (JSON/CSV)** → `ventes.json`.

> ⚠️ L'ancien fichier ne contient pas le **mode d'acquisition** ni les conditions
> du **droit de suite** / **taxe forfaitaire**. Ces champs (déterminants depuis
> 2025) sont à compléter dans l'outil pour une qualification fiable.

## Règles fiscales encodées (réforme du 1er janvier 2025)

**TVA sur les œuvres d'art**
- Taux réduit **5,5%** = principe pour œuvres d'art, objets de collection et
  d'antiquité (CGI art. 278-0 bis).
- **Régime de la marge interdit** si l'œuvre a été acquise/importée au taux
  réduit (on ne cumule plus) → droit commun 5,5% (CGI art. 297 A modifié).
- **Marge de plein droit** seulement si achat **sans TVA déductible**
  (particulier, non-assujetti, revendeur sous marge) → **20% sur la marge**.
- **Forfait de marge 30% : supprimé** (CGI art. 297 A III abrogé) — l'ancien
  fichier le calculait encore : l'outil le signale comme régime à reclasser.
- **Option art. 297 C** : possibilité d'opter, opération par opération, pour le
  droit commun 5,5% même quand la marge serait applicable.
- Export hors UE et livraison intracommunautaire : exonérés sous justificatifs.

**Droit de suite** — œuvre originale, revente avec professionnel, prix ≥ 750 € HT,
artiste vivant ou décédé ≤ 70 ans. Barème : 4% ≤ 50 000 ; 3% jusqu'à 200 000 ;
1% jusqu'à 350 000 ; 0,5% jusqu'à 500 000 ; 0,25% au-delà — plafond **12 500 €**.
Exonération du revendeur si œuvre acquise directement de l'artiste < 3 ans et
prix < 10 000 €.

**Taxe forfaitaire sur les objets précieux** (CGI art. 150 VI et s.) — cessions
par des particuliers. Taux **6%** (objets d'art/collection/antiquité/bijoux) ou
**11%** (métaux précieux), **+ 0,5% CRDS** si vendeur domicilié en France.
Exonérée si prix ≤ 5 000 €. Assiette = prix de cession (commission non
déductible). La galerie, intermédiaire établi en France, déclare et verse pour le
compte du vendeur. Option possible pour le régime réel des plus-values.

## Mise à jour réglementaire

Tous les paramètres (taux, seuils, barèmes) sont regroupés dans l'objet `PARAMS`
en haut de **`regles.js`**. À revoir à chaque loi de finances.

## Avertissement

Outil d'aide à la décision. Il ne se substitue pas à l'analyse du conseil ni à la
documentation officielle (BOFiP, CGI). Les références d'articles sont indiquées
pour faciliter l'audit.
