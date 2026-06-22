/* =====================================================================
 *  regles.js — Moteur réglementaire TVA / Droit de suite / Taxe forfaitaire
 *  Galerie d'art — réglementation en vigueur au 1er janvier 2025
 * ---------------------------------------------------------------------
 *  Ce fichier isole TOUTE la règle fiscale (taux, seuils, barèmes,
 *  arbres de décision). Il est volontairement séparé de l'interface afin
 *  que le cabinet puisse l'auditer et le mettre à jour sans toucher au reste.
 *
 *  AVERTISSEMENT : outil d'aide à la décision. Ne se substitue pas à
 *  l'analyse du conseil. Les références CGI sont indiquées pour audit.
 * ===================================================================== */

const REGLES = (function () {
  "use strict";

  /* -----------------------------------------------------------------
   *  PARAMÈTRES — modifiables en un seul endroit
   * ----------------------------------------------------------------- */
  const PARAMS = {
    version: "2025-2026",
    exerciceCourant: 2026,
    tva: {
      tauxReduitArt: 0.055,   // œuvres d'art / collection / antiquité (art. 278-0 bis CGI, depuis 1/1/2025)
      tauxNormal: 0.20,       // biens hors champ art, prestations, commissions, produits annexes
      tauxMargeUnique: 0.20   // le régime de la marge se calcule au taux NORMAL (20%) sur la marge
    },
    droitDeSuite: {
      seuilApplication: 750,        // prix de vente HT minimum (€)
      plafond: 12500,               // plafond global (€)
      // exonération du revendeur : acquise directement de l'artiste depuis < 3 ans ET prix < 10 000 €
      exoRevente: { ansDepuisAcquisition: 3, prixVente: 10000 },
      bareme: [
        { plafondTranche: 50000, taux: 0.04 },
        { plafondTranche: 200000, taux: 0.03 },
        { plafondTranche: 350000, taux: 0.01 },
        { plafondTranche: 500000, taux: 0.005 },
        { plafondTranche: Infinity, taux: 0.0025 }
      ]
    },
    taxeForfaitaire: {
      seuilExoneration: 5000,   // exonérée si prix de cession <= 5 000 € (art. 150 VK CGI)
      tauxObjetArt: 0.06,       // objets d'art, collection, antiquité, bijoux
      tauxMetauxPrecieux: 0.11, // métaux précieux
      tauxCRDS: 0.005           // ajoutée si vendeur domicilié fiscalement en France
    }
  };

  /* -----------------------------------------------------------------
   *  LISTES DE RÉFÉRENCE (pour les listes déroulantes de l'UI)
   * ----------------------------------------------------------------- */
  const LISTES = {
    natureBien: [
      { v: "oeuvre_art", label: "Œuvre d'art originale (éligible 5,5%)" },
      { v: "objet_collection", label: "Objet de collection / antiquité (éligible 5,5%)" },
      { v: "bien_non_art", label: "Bien non éligible (déco, objet non original…) → 20%" },
      { v: "prestation", label: "Prestation / commission / refacturation → 20%" },
      { v: "produit_annexe", label: "Produit annexe (catalogue, location…)" }
    ],
    // Mode d'acquisition de l'œuvre par la galerie : détermine la possibilité du régime de la marge
    modeAcquisition: [
      { v: "sans_tva", label: "Acquise SANS TVA déductible (particulier, non-assujetti, revendeur sous marge)" },
      { v: "tva_reduit", label: "Acquise/importée AVEC taux réduit 5,5% (→ marge INTERDITE)" },
      { v: "tva_normale", label: "Acquise avec TVA normale 20% déductible" },
      { v: "aucun_achat", label: "Pas d'achat (commission, refacturation, création propre…)" }
    ],
    zone: [
      { v: "FR", label: "France" },
      { v: "UE", label: "Union européenne (hors France)" },
      { v: "HUE", label: "Hors UE (export)" }
    ],
    typeClient: [
      { v: "particulier", label: "Particulier / non-assujetti" },
      { v: "professionnel", label: "Professionnel assujetti à la TVA" }
    ],
    // Régimes retenus (sortie du moteur) — alignés sur les lignes de la CA3
    regimes: {
      EXPORT: { code: "EXPORT", label: "Exportation exonérée", ligneCA3: "04" },
      INTRACOM: { code: "INTRACOM", label: "Livraison intracommunautaire exonérée", ligneCA3: "06" },
      DC_55: { code: "DC_55", label: "Droit commun 5,5%", ligneCA3: "09 (+01)" },
      DC_20: { code: "DC_20", label: "Droit commun 20%", ligneCA3: "08 (+01)" },
      MARGE: { code: "MARGE", label: "Régime de la marge (20% sur marge)", ligneCA3: "08 (+01) / 05" }
    }
  };

  /* -----------------------------------------------------------------
   *  MAPPING RÉGIME -> COMPTE PRODUIT (cadrage comptable)
   *  Tiré du plan de comptes de la galerie (onglet "Listes").
   * ----------------------------------------------------------------- */
  const PLAN_COMPTES = {
    "70703000": "Ventes œuvres - Droit Commun France",
    "70703100": "Ventes œuvres - Droit Commun UE",
    "70703200": "Ventes œuvres - Droit Commun HUE",
    "70704000": "Ventes œuvres - Taux réduit France",
    "70704100": "Ventes œuvres - Taux réduit UE",
    "70704200": "Ventes œuvres - Taux réduit HUE",
    "70709901": "Cut-off N-1 FR taux normal",
    "70709902": "Cut-off N-1 FR taux réduit",
    "70709903": "Cut-off N-1 UE",
    "70709904": "Cut-off N-1 HUE",
    "70710000": "Ventes œuvres - Marge Réelle France",
    "70711000": "Ventes œuvres - Marge Réelle UE",
    "70712000": "Ventes œuvres - Marge Réelle Export",
    "70810100": "Commissions sur ventes France",
    "70810200": "Commissions sur ventes UE",
    "70810300": "Commissions sur ventes HUE",
    "70811000": "Ventes de catalogues 5,5%",
    "70820000": "Location Le Muy",
    "70880000": "Produits annexes HUE",
    "70880500": "Produits annexes UE",
    "70882000": "Produits annexes 20%",
    "70884000": "Produits annexes 5,5%"
  };

  /* -----------------------------------------------------------------
   *  CONFIGURATION DU CADRAGE COMPTABLE (outil <-> Balance Générale)
   *  Regroupe les comptes de la balance à confronter aux totaux de l'outil.
   * ----------------------------------------------------------------- */
  const CADRAGE = {
    // Comptes de TVA collectée (classe 4457*) à comparer à la TVA de l'outil.
    tvaCollectee: ["44571200", "44571300", "44571310", "44571340", "44571400"],
    // Cadrage des achats & coûts (classe 6) : champ de l'outil <-> comptes BG.
    achats: [
      { cle: "achat", label: "Achats d'œuvres (vendus + non vendus)", comptes: ["60740000", "607500"] },
      { cle: "frais", label: "Frais accessoires d'achat", comptes: ["607704"] },
      { cle: "commissions", label: "Commissions sur ventes", comptes: ["60780300", "60780301", "60780400"] },
      { cle: "ds", label: "Droit de suite", comptes: ["60737000"] },
      { cle: "tf", label: "Taxe forfaitaire", comptes: ["60770500"] }
    ]
  };

  /* =================================================================
   *  ARRONDIS
   * ================================================================= */
  function r2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }

  /* =================================================================
   *  1) MOTEUR TVA — détermine le régime + les bases CA3
   * -----------------------------------------------------------------
   *  Entrée (objet vente) :
   *    natureBien, modeAcquisition, zone, typeClient,
   *    justificatifExport (bool), numTvaIntra (string), transportHorsFR (bool),
   *    optionDroitCommun (bool, art. 297 C),
   *    venteTTC, achatTTC, fraisAccessoiresHT
   *  Sortie : { regime, baseHT, tva, partNonImposable, ligneCA3, alertes[], compte }
   * ================================================================= */
  const CODES_REGIME = ["EXPORT", "INTRACOM", "DC_55", "DC_20", "MARGE"];

  function calculerTVA(v) {
    const alertes = [];
    const out = {
      regime: null, regimeRecommande: null, baseHT: 0, tva: 0, partNonImposable: 0,
      ligneCA3: "", alertes, compte: null, libelleCompte: ""
    };

    // 1) Régime recommandé par l'outil (déduit du contexte) — sert de contrôle.
    const recommande = deriverRegimeCode(v);
    out.regimeRecommande = LISTES.regimes[recommande] || null;

    // 2) Régime APPLIQUÉ : on respecte le régime saisi s'il est valide
    //    (reprise d'une base déjà qualifiée), sinon on applique la recommandation.
    const choisiValide = CODES_REGIME.indexOf(v.regimeChoisi) >= 0;
    const applique = choisiValide ? v.regimeChoisi : recommande;

    // 3) Calcul des montants selon le régime appliqué.
    appliquerRegime(out, v, applique, alertes);
    out.regime = LISTES.regimes[applique];

    // 4) Contrôle : divergence entre régime saisi et régime recommandé.
    if (choisiValide && v.regimeChoisi !== recommande) {
      alertes.push(warn("REGIME_DIVERGENT",
        "Régime appliqué : « " + LISTES.regimes[applique].label + " ». L'outil aurait plutôt déduit « " +
        LISTES.regimes[recommande].label + " » du contexte (zone/nature/acquisition). À vérifier."));
    }
    return out;
  }

  // Régime déduit du contexte (zone, nature du bien, mode d'acquisition).
  function deriverRegimeCode(v) {
    if (v.zone === "HUE") return "EXPORT";
    if (v.zone === "UE" && v.typeClient === "professionnel") return "INTRACOM";
    if (v.natureBien === "prestation" || v.natureBien === "bien_non_art") return "DC_20";
    if (v.natureBien === "produit_annexe") return "DC_20"; // défaut (catalogue = 5,5% à préciser)
    // Œuvre d'art / collection / antiquité (réforme 2025)
    if (v.modeAcquisition === "tva_reduit") return "DC_55";   // marge interdite
    if (v.modeAcquisition === "sans_tva") return v.optionDroitCommun ? "DC_55" : "MARGE";
    return "DC_55"; // tva_normale, aucun_achat, ou défaut prudent
  }

  // Applique un régime donné : remplit base HT, TVA, part non imposable, ligne CA3, compte.
  function appliquerRegime(out, v, code, alertes) {
    const ttc = num(v.venteTTC), achat = num(v.achatTTC), frais = num(v.fraisAccessoiresHT);
    switch (code) {
      case "EXPORT":
        out.ligneCA3 = "04";
        if (!v.justificatifExport) alertes.push(warn("EXPORT_JUSTIF",
          "Exonération export : avez-vous le justificatif de sortie du territoire UE (DAU/preuve douanière) ?"));
        break;
      case "INTRACOM":
        out.ligneCA3 = "06";
        if (!v.numTvaIntra) alertes.push(warn("INTRACOM_TVA",
          "Livraison intracom exonérée : le n° de TVA intracom du client est-il renseigné ET valide (VIES) ?"));
        if (!v.transportHorsFR) alertes.push(warn("INTRACOM_TRANSPORT",
          "Avez-vous la preuve du transport du bien hors de France vers l'autre État membre ?"));
        break;
      case "DC_55":
        out.baseHT = r2(ttc / (1 + PARAMS.tva.tauxReduitArt));
        out.tva = r2(out.baseHT * PARAMS.tva.tauxReduitArt);
        out.ligneCA3 = "09 (+01)";
        break;
      case "DC_20":
        out.baseHT = r2(ttc / (1 + PARAMS.tva.tauxNormal));
        out.tva = r2(out.baseHT * PARAMS.tva.tauxNormal);
        out.ligneCA3 = "08 (+01)";
        break;
      case "MARGE": {
        if (v.modeAcquisition === "tva_reduit") alertes.push(danger("MARGE_INTERDITE",
          "Régime de la marge appliqué mais œuvre acquise/importée au taux réduit 5,5% : INTERDIT depuis le 1/1/2025 (art. 297 A). Repasser en droit commun 5,5%."));
        const marge = ttc - achat - frais;
        if (marge < 0) alertes.push(warn("MARGE_NEGATIVE",
          "Marge négative (vente < achat + frais) : aucune TVA sur marge ; vérifier l'opération."));
        const margeHT = marge > 0 ? marge / (1 + PARAMS.tva.tauxMargeUnique) : 0;
        out.baseHT = r2(margeHT);
        out.tva = r2(margeHT * PARAMS.tva.tauxMargeUnique);
        out.partNonImposable = r2(ttc - margeHT - out.tva);
        out.ligneCA3 = "08 (marge) + 05 (non imposable)";
        alertes.push(info("MARGE_OPTION_RAPPEL",
          "Option 297 C possible : 5,5% sur le total (" + r2(ttc / (1 + PARAMS.tva.tauxReduitArt) * PARAMS.tva.tauxReduitArt) +
          " € de TVA) vs 20% sur marge (" + out.tva + " € de TVA)."));
        break;
      }
    }
    affecterCompte(out, v, code);
  }

  /* =================================================================
   *  2) DROIT DE SUITE
   * -----------------------------------------------------------------
   *  Entrée :
   *    venteHT (ou venteTTC + taux pour reconstituer), oeuvreOriginale,
   *    artisteVivantOuMoins70, premiereCession, venteSoumiseFrance,
   *    acquiseDirecteArtisteMoins3ans (bool), prixVente (pour exo revente)
   *  Sortie : { du: bool, montant, motif, alertes[] }
   * ================================================================= */
  function calculerDroitDeSuite(v) {
    const ds = v.ds || {};
    const prix = num(ds.baseReference != null && ds.baseReference !== "" ? ds.baseReference
      : (v.venteHT != null ? v.venteHT : reconstituerHT(v)));
    const alertes = [];

    // Décision manuelle (reprise d'une analyse déjà réalisée) — prioritaire.
    // Évaluation conditionnelle (artiste éligible + lieu + prix + revente).
    const cond = conditionsDroitDeSuite(v, prix);

    if (ds.applicabiliteManuelle === "non") {
      // potentiel = vrai si les critères semblent réunis malgré le « non » (omission possible).
      return { du: false, montant: 0, motif: "Non applicable (décision reprise)", potentiel: cond.du, alertes };
    }
    if (ds.applicabiliteManuelle === "oui") {
      const montant = (ds.montantReference != null && ds.montantReference !== "")
        ? num(ds.montantReference) : baremeDroitDeSuite(prix);
      return { du: true, montant: r2(montant), motif: "Applicable (décision reprise)", potentiel: true, alertes };
    }

    // Pas de décision saisie : on PRÉ-REMPLIT à partir des conditions.
    if (!cond.du) return { du: false, montant: 0, motif: cond.motif, potentiel: false, alertes };
    if (ds.artisteVivantOuMoins70 == null) {
      alertes.push(info("DS_ARTISTE_AUTO",
        "Droit de suite présumé dû. Statut de l'artiste non référencé : à confirmer dans l'onglet Artistes."));
    }
    return { du: true, montant: r2(baremeDroitDeSuite(prix)), motif: "OK - Critères réunis", potentiel: true, alertes };
  }

  // Conditions du droit de suite (hors décision manuelle). Le lieu (zone) est
  // déterminant : hors UE -> hors champ du droit de suite ; FR/UE -> dans le champ.
  function conditionsDroitDeSuite(v, prix) {
    const ds = v.ds || {};
    if (v.natureBien !== "oeuvre_art") return { du: false, motif: "Œuvre non éligible (pas une œuvre d'art originale)" };
    if (ds.oeuvreOriginale === false) return { du: false, motif: "Œuvre non originale" };
    if (ds.premiereCession === true) return { du: false, motif: "1ère cession par l'artiste (pas de revente)" };
    if (ds.artisteVivantOuMoins70 === false) return { du: false, motif: "Artiste décédé depuis + de 70 ans" };
    if (v.zone === "HUE" || ds.venteSoumiseFrance === false) return { du: false, motif: "Vente hors UE / non établie en France — hors champ" };
    if (prix < PARAMS.droitDeSuite.seuilApplication) return { du: false, motif: "Vente < 750 €" };
    if (ds.acquiseDirecteArtisteMoins3ans === true && prix < PARAMS.droitDeSuite.exoRevente.prixVente)
      return { du: false, motif: "Exonéré (acquise directement de l'artiste < 3 ans et prix < 10 000 €)" };
    return { du: true, motif: "OK - Critères réunis" };
  }
  function zoneLabel(z) { return z === "FR" ? "France" : z === "UE" ? "UE" : z === "HUE" ? "hors UE" : "?"; }

  function baremeDroitDeSuite(prix) {
    let reste = prix, total = 0, borneBasse = 0;
    for (const t of PARAMS.droitDeSuite.bareme) {
      const largeur = t.plafondTranche - borneBasse;
      const assiette = Math.max(0, Math.min(reste, largeur));
      total += assiette * t.taux;
      reste -= assiette;
      borneBasse = t.plafondTranche;
      if (reste <= 0) break;
    }
    return Math.min(total, PARAMS.droitDeSuite.plafond);
  }

  /* =================================================================
   *  3) TAXE FORFAITAIRE SUR LES OBJETS PRÉCIEUX (art. 150 VI s.)
   * -----------------------------------------------------------------
   *  S'applique aux cessions par un PARTICULIER. La galerie, intermédiaire
   *  établi en France, est redevable du versement pour le compte du vendeur.
   *  Entrée :
   *    tf.vendeurParticulier (bool), tf.prixCession, tf.typeObjet ('art'|'metaux'),
   *    tf.vendeurDomicilieFR (bool), tf.optionPlusValue (bool)
   *  Sortie : { du, assiette, taux, montant, motif, alertes[] }
   * ================================================================= */
  function calculerTaxeForfaitaire(v) {
    const tf = v.tf || {};
    const alertes = [];
    const prix = num(tf.prixCession != null && tf.prixCession !== "" ? tf.prixCession : v.venteTTC);

    // Décision manuelle (reprise d'une analyse déjà réalisée) — prioritaire.
    if (tf.applicabiliteManuelle === "non") {
      return { du: false, montant: 0, motif: "Non applicable (décision reprise)", alertes };
    }
    if (tf.applicabiliteManuelle === "oui") {
      let tx = (tf.typeObjet === "metaux") ? PARAMS.taxeForfaitaire.tauxMetauxPrecieux : PARAMS.taxeForfaitaire.tauxObjetArt;
      if (tf.vendeurDomicilieFR !== false) tx += PARAMS.taxeForfaitaire.tauxCRDS;
      const montant = (tf.montantReference != null && tf.montantReference !== "")
        ? num(tf.montantReference) : r2(prix * tx);
      return { du: true, assiette: r2(prix), taux: tx, montant: r2(montant), motif: "Applicable (décision reprise)", alertes };
    }

    if (!tf.vendeurParticulier) {
      return { du: false, montant: 0, motif: "Vendeur professionnel : hors champ de la taxe forfaitaire (relève des bénéfices pro)", alertes };
    }
    if (tf.optionPlusValue === true) {
      alertes.push(info("TF_OPTION_PV",
        "Option pour le régime réel des plus-values exercée : nécessite la justification de la date et du prix d'acquisition."));
      return { du: false, montant: 0, motif: "Option régime des plus-values réelles", alertes };
    }
    if (prix <= PARAMS.taxeForfaitaire.seuilExoneration) {
      return { du: false, montant: 0, motif: "Exonéré (prix de cession ≤ 5 000 €)", alertes };
    }

    let taux = (tf.typeObjet === "metaux")
      ? PARAMS.taxeForfaitaire.tauxMetauxPrecieux
      : PARAMS.taxeForfaitaire.tauxObjetArt;
    if (tf.vendeurDomicilieFR !== false) {
      taux += PARAMS.taxeForfaitaire.tauxCRDS; // CRDS si vendeur domicilié en France
    }
    alertes.push(info("TF_REDEVABLE",
      "La galerie (intermédiaire établi en France) déclare et verse cette taxe pour le compte du vendeur particulier. Assiette = prix de cession (commission non déductible)."));
    return {
      du: true,
      assiette: r2(prix),
      taux: taux,
      montant: r2(prix * taux),
      motif: "Taxe forfaitaire due (" + (taux * 100).toFixed(1) + "%)",
      alertes
    };
  }

  /* =================================================================
   *  SIMULATEUR — 2 modes
   *  Données communes de l'œuvre : coutHT, achatAupres ('particulier'|'professionnel'),
   *  tvaRecuperable ('oui'|'non'), dsEligible (bool).
   * ================================================================= */

  // Le régime de la marge est possible si l'acquisition n'a PAS ouvert droit à
  // récupération de TVA (achat à un particulier, ou à un pro sans TVA déductible).
  function margeEligibleDe(tvaRecuperable) { return tvaRecuperable !== "oui"; }

  /* --- Mode 1 : ASKING — prix de vente HT espéré ---
   * params : { coutHT, margeEligible, dsEligible, tauxMarge (% sur le PV HT) }
   * PV HT espéré tel que marge HT / PV HT = taux  ->  PV HT = coût / (1 - taux). */
  function simulerAsking(p) {
    const C = num(p.coutHT);
    const taux = num(p.tauxMarge) / 100;
    const pvHT = (taux < 1 && taux >= 0) ? r2(C / (1 - taux)) : 0;
    const margeHT = r2(pvHT - C);
    const ds = p.dsEligible ? r2(baremeDroitDeSuite(pvHT)) : 0;
    return {
      pvHT: pvHT,
      margeHT: margeHT,
      margeApresDS: r2(margeHT - ds),
      ds: ds,
      tauxMarge: taux,
      regimeProbable: p.margeEligible ? "Régime de la marge (20% sur marge)" : "Droit commun 5,5%",
      // Prix TTC indicatif pour un particulier France (taux réduit 5,5%)
      ttcFranceParticulier: r2(pvHT * (1 + PARAMS.tva.tauxReduitArt))
    };
  }

  /* --- Mode 2 : AIDE À LA NÉGOCIATION — marge finale sur un TTC négocié ---
   * params : { coutHT, margeEligible, dsEligible, acquereur, lieu ('FR'|'CEE'|'MONACO'|'EXPORT'),
   *            transport (€), commissionValeur, commissionUnite ('eur'|'pct'), prixTTCnego } */
  function simulerNegociation(p) {
    const C = num(p.coutHT), transport = num(p.transport), ttc = num(p.prixTTCnego);
    const lieu = p.lieu, acq = p.acquereur;
    const margeEligible = !!p.margeEligible, dsEligible = !!p.dsEligible;
    const commVal = num(p.commissionValeur), commPct = p.commissionUnite === "pct";

    let exo = false, regimeFixe = null;
    if (lieu === "EXPORT") { exo = true; regimeFixe = "EXPORT"; }
    else if (lieu === "CEE" && acq === "professionnel") { exo = true; regimeFixe = "INTRACOM"; }
    const dsDansLeChamp = dsEligible && lieu !== "EXPORT";

    function calc(rg) {
      let tva = 0;
      if (rg === "DC_55") tva = ttc * PARAMS.tva.tauxReduitArt / (1 + PARAMS.tva.tauxReduitArt);
      else if (rg === "MARGE") tva = Math.max(0, ttc - C) * PARAMS.tva.tauxMargeUnique / (1 + PARAMS.tva.tauxMargeUnique);
      const ht = ttc - tva;
      const ds = dsDansLeChamp ? baremeDroitDeSuite(ht) : 0;
      const commission = commPct ? ht * commVal / 100 : commVal;
      const marge = ht - C - transport - ds - commission;
      return {
        regimeCode: rg, regime: LISTES.regimes[rg] ? LISTES.regimes[rg].label : rg,
        tva: r2(tva), ht: r2(ht), ds: r2(ds), commission: r2(commission), transport: r2(transport), ttc: r2(ttc),
        marge: r2(marge), tauxMarge: ht ? marge / ht : 0
      };
    }
    if (exo) return calc(regimeFixe);
    const cands = margeEligible ? ["DC_55", "MARGE"] : ["DC_55"];
    let best = null, alt = null;
    cands.forEach(rg => { const r = calc(rg); if (!best || r.marge > best.marge) { alt = best; best = r; } else alt = r; });
    if (alt && cands.length > 1) best.alternative = alt;
    return best;
  }
  function affecterCompte(out, v, codeRegime) {
    const compte = compteDe(v, codeRegime);
    out.compte = compte;
    out.libelleCompte = PLAN_COMPTES[compte] || "";
  }

  // Une vente datée d'un exercice antérieur est basculée sur les comptes de cut-off.
  function estCutoff(v) {
    if (v.exercice && /n-?1|cut/i.test(String(v.exercice))) return true;
    const d = String(v.dateFacture || "");
    const m = d.match(/^(\d{4})/);
    return m ? parseInt(m[1], 10) < PARAMS.exerciceCourant : false;
  }

  // Détermine le compte produit (classe 70) selon exercice, régime, zone et nature.
  function compteDe(v, codeRegime) {
    const z = v.zone;
    if (estCutoff(v)) {
      if (codeRegime === "EXPORT" || z === "HUE") return "70709904";
      if (codeRegime === "INTRACOM" || z === "UE") return "70709903";
      if (codeRegime === "DC_20") return "70709901";
      return "70709902"; // DC_55 / MARGE / défaut : FR taux réduit
    }
    // Régime "source" (libellé d'origine repris de la base) — précise les annexes.
    const lbl = String(v.regimeSource || "").toLowerCase();
    if (lbl.indexOf("catalogue") >= 0) return "70811000";
    if (lbl.indexOf("location") >= 0) return "70820000";
    if (lbl.indexOf("produits annexes") >= 0 || v.natureBien === "produit_annexe") {
      if (z === "HUE" || lbl.indexOf("hue") >= 0) return "70880000";
      if (z === "UE" || lbl.indexOf(" ue") >= 0) return "70880500";
      if (lbl.indexOf("5,5") >= 0) return "70884000";
      return "70882000";
    }
    if (lbl.indexOf("commission") >= 0 || (v.natureBien === "prestation" && lbl === "")) {
      return z === "UE" ? "70810200" : z === "HUE" ? "70810300" : "70810100";
    }
    switch (codeRegime) {
      case "EXPORT": return "70703200";
      case "INTRACOM": return "70703100";
      case "DC_55": return z === "UE" ? "70704100" : z === "HUE" ? "70704200" : "70704000";
      case "DC_20": return z === "UE" ? "70703100" : z === "HUE" ? "70703200" : "70703000";
      case "MARGE": return z === "UE" ? "70711000" : z === "HUE" ? "70712000" : "70710000";
    }
    return "";
  }

  /* =================================================================
   *  CONTRÔLES DE COHÉRENCE GLOBAUX (questions d'orientation)
   *  Renvoie une liste d'alertes pour une vente donnée + son calcul.
   * ================================================================= */
  function controlerLigne(v, calc) {
    const a = [];
    // (La divergence régime saisi vs recommandé est gérée dans calculerTVA.)
    // Marge forfaitaire obsolète
    if (v.regimeChoisi === "MARGE_FORFAITAIRE" || v.regimeChoisi === "Marge forfaitaire") {
      a.push(danger("MARGE_FORF_SUPPRIMEE",
        "« Marge forfaitaire (30%) » : régime SUPPRIMÉ depuis le 1/1/2025 (art. 297 A III abrogé). À reclasser."));
    }
    // Achat manquant pour une marge
    if (calc.regime && calc.regime.code === "MARGE" && !num(v.achatTTC)) {
      a.push(warn("MARGE_SANS_ACHAT",
        "Régime de la marge sans prix d'achat renseigné : la marge ne peut pas être calculée correctement."));
    }
    // Cohérence taux réduit vs nature
    if (calc.regime && calc.regime.code === "DC_55" &&
        (v.natureBien === "prestation" || v.natureBien === "bien_non_art")) {
      a.push(danger("TR_NON_ELIGIBLE",
        "Taux 5,5% appliqué à un bien/prestation non éligible : seules les œuvres d'art/collection/antiquité y ont droit."));
    }
    return a;
  }

  /* =================================================================
   *  HELPERS
   * ================================================================= */
  function num(x) {
    if (x === "" || x == null) return 0;
    if (typeof x === "number") return x;
    const n = parseFloat(String(x).replace(/\s/g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  }
  function reconstituerHT(v) {
    // estimation HT pour le seuil droit de suite (sur la base TTC / taux art)
    return num(v.venteTTC) / (1 + PARAMS.tva.tauxReduitArt);
  }
  function libelleRegime(code) {
    const r = LISTES.regimes[code];
    return r ? r.label : code;
  }
  function danger(code, msg) { return { niveau: "danger", code, message: msg }; }
  function warn(code, msg) { return { niveau: "warn", code, message: msg }; }
  function info(code, msg) { return { niveau: "info", code, message: msg }; }

  /* =================================================================
   *  API PUBLIQUE
   * ================================================================= */
  return {
    PARAMS, LISTES, PLAN_COMPTES, CADRAGE,
    calculerTVA, calculerDroitDeSuite, calculerTaxeForfaitaire, simulerAsking, simulerNegociation, margeEligibleDe,
    controlerLigne, baremeDroitDeSuite, estCutoff, r2, num
  };
})();

// Export pour usage Node (tests) sans casser l'usage navigateur
if (typeof module !== "undefined" && module.exports) { module.exports = REGLES; }
