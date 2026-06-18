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
    // Marge réelle
    MARGE_FR: { compte: "70710000", libelle: "Ventes œuvres - Marge Réelle France" },
    MARGE_UE: { compte: "70711000", libelle: "Ventes œuvres - Marge Réelle UE" },
    MARGE_EXPORT: { compte: "70712000", libelle: "Ventes œuvres - Marge Réelle Export" },
    MARGE_NON_SOUMIS: { compte: "70713000", libelle: "Ventes œuvres - Prix Achat / CA Non soumis" },
    TVA_MARGE_20: { compte: "70714000", libelle: "TVA/Marges 20%" },
    // Droit commun
    DC_FR: { compte: "70703000", libelle: "Ventes œuvres - Droit Commun France" },
    DC_UE: { compte: "70703100", libelle: "Ventes œuvres - Droit Commun UE" },
    DC_HUE: { compte: "70703200", libelle: "Ventes œuvres - Droit Commun HUE" },
    // Taux réduit 5,5%
    TR_FR: { compte: "70704000", libelle: "Ventes œuvres - Taux réduit France" },
    TR_UE: { compte: "70704100", libelle: "Ventes œuvres - Taux réduit UE" },
    TR_HUE: { compte: "70704200", libelle: "Ventes œuvres - Taux réduit HUE" },
    // Annexes
    COMMISSION: { compte: "70810000", libelle: "Commissions s/vte" },
    PRODUIT_ANNEXE_20: { compte: "70882000", libelle: "Produits activités annexes - 20%" },
    PRODUIT_ANNEXE_NS: { compte: "70880000", libelle: "Produits activités annexes - Non Soumis" }
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
  function calculerTVA(v) {
    const alertes = [];
    const ttc = num(v.venteTTC);
    const achat = num(v.achatTTC);
    const frais = num(v.fraisAccessoiresHT);

    const out = {
      regime: null, baseHT: 0, tva: 0, partNonImposable: 0,
      ligneCA3: "", alertes, compte: null, libelleCompte: ""
    };

    // ---- A. PRIORITÉ GÉOGRAPHIQUE : export / intracom (exonérés) ----
    if (v.zone === "HUE") {
      out.regime = LISTES.regimes.EXPORT;
      out.ligneCA3 = "04";
      if (!v.justificatifExport) {
        alertes.push(warn("EXPORT_JUSTIF",
          "Exonération export : avez-vous le justificatif de sortie du territoire UE (DAU/preuve douanière) ? Sans lui, l'exonération est refusée."));
      }
      affecterCompte(out, v, "EXPORT");
      return out;
    }

    if (v.zone === "UE" && v.typeClient === "professionnel") {
      out.regime = LISTES.regimes.INTRACOM;
      out.ligneCA3 = "06";
      if (!v.numTvaIntra) {
        alertes.push(warn("INTRACOM_TVA",
          "Livraison intracom exonérée : le n° de TVA intracom du client est-il renseigné ET valide (VIES) ?"));
      }
      if (!v.transportHorsFR) {
        alertes.push(warn("INTRACOM_TRANSPORT",
          "Avez-vous la preuve du transport du bien hors de France vers l'autre État membre ?"));
      }
      affecterCompte(out, v, "INTRACOM");
      return out;
    }

    if (v.zone === "UE" && v.typeClient === "particulier") {
      alertes.push(info("UE_B2C",
        "Vente à un particulier UE : pas d'exonération intracom. Traitée comme une vente taxable en France (sous réserve des seuils de vente à distance)."));
      // on poursuit comme une vente taxable France
    }

    // ---- B. NATURE DU BIEN : hors champ œuvre d'art -> 20% ----
    if (v.natureBien === "prestation" || v.natureBien === "bien_non_art") {
      return calculerDroitCommun(out, v, ttc, PARAMS.tva.tauxNormal, "DC_20", "08 (+01)", alertes);
    }
    if (v.natureBien === "produit_annexe") {
      // par défaut 20%, mais signalé pour vérification (certains produits annexes peuvent différer)
      alertes.push(info("PRODUIT_ANNEXE",
        "Produit annexe : vérifier le taux applicable (20% par défaut ; 5,5% catalogue, 10%/non soumis selon le cas)."));
      return calculerDroitCommun(out, v, ttc, PARAMS.tva.tauxNormal, "DC_20", "08 (+01)", alertes);
    }

    // ---- C. ŒUVRE D'ART / COLLECTION / ANTIQUITÉ ----
    // Le régime dépend du mode d'acquisition (réforme 2025).
    const margePossible = (v.modeAcquisition === "sans_tva");

    if (v.modeAcquisition === "tva_reduit") {
      // Achat/import au taux réduit -> MARGE INTERDITE -> droit commun 5,5%
      if (margeDemandee(v)) {
        alertes.push(danger("MARGE_INTERDITE",
          "Régime de la marge demandé mais œuvre acquise/importée au taux réduit 5,5% : INTERDIT depuis le 1/1/2025 (art. 297 A modifié). Application du droit commun 5,5%."));
      }
      return calculerDroitCommun(out, v, ttc, PARAMS.tva.tauxReduitArt, "DC_55", "09 (+01)", alertes);
    }

    if (margePossible) {
      // Marge applicable de plein droit. Option 297 C possible pour le droit commun 5,5%.
      if (v.optionDroitCommun) {
        alertes.push(info("OPTION_297C",
          "Option art. 297 C exercée : droit commun 5,5% sur le prix total au lieu de la marge. (Souvent plus avantageux pour le client.)"));
        return calculerDroitCommun(out, v, ttc, PARAMS.tva.tauxReduitArt, "DC_55", "09 (+01)", alertes);
      }
      // Régime de la marge : 20% sur la marge
      const marge = ttc - achat - frais;
      if (marge < 0) {
        alertes.push(danger("MARGE_NEGATIVE",
          "Marge négative (prix de vente < prix d'achat + frais) : aucune TVA sur marge, mais vérifier la cohérence de l'opération."));
      }
      const margeHT = marge > 0 ? marge / (1 + PARAMS.tva.tauxMargeUnique) : 0;
      const tvaMarge = r2(margeHT * PARAMS.tva.tauxMargeUnique);
      out.regime = LISTES.regimes.MARGE;
      out.baseHT = r2(margeHT);
      out.tva = tvaMarge;
      out.partNonImposable = r2(ttc - margeHT - tvaMarge); // prix d'achat + part non imposable, ligne 05
      out.ligneCA3 = "08 (marge) + 05 (non imposable)";
      alertes.push(info("MARGE_OPTION_RAPPEL",
        "Comparez : 5,5% sur le total (" + r2(ttc / (1 + PARAMS.tva.tauxReduitArt) * PARAMS.tva.tauxReduitArt) +
        " € de TVA via option 297 C) vs 20% sur marge (" + tvaMarge + " € de TVA)."));
      affecterCompte(out, v, "MARGE");
      return out;
    }

    if (v.modeAcquisition === "tva_normale") {
      // Achat avec TVA 20% déductible : revente au régime de droit commun. Œuvre d'art -> 5,5%.
      return calculerDroitCommun(out, v, ttc, PARAMS.tva.tauxReduitArt, "DC_55", "09 (+01)", alertes);
    }

    if (v.modeAcquisition === "aucun_achat") {
      // Œuvre d'art vendue sans achat (création/dépôt) -> droit commun 5,5%
      return calculerDroitCommun(out, v, ttc, PARAMS.tva.tauxReduitArt, "DC_55", "09 (+01)", alertes);
    }

    // Défaut prudent
    alertes.push(warn("MODE_ACQ_INCONNU",
      "Mode d'acquisition non renseigné : impossible de trancher marge / droit commun. Renseignez-le."));
    return calculerDroitCommun(out, v, ttc, PARAMS.tva.tauxReduitArt, "DC_55", "09 (+01)", alertes);
  }

  function calculerDroitCommun(out, v, ttc, taux, codeRegime, ligne, alertes) {
    const ht = ttc / (1 + taux);
    out.regime = LISTES.regimes[codeRegime];
    out.baseHT = r2(ht);
    out.tva = r2(ht * taux);
    out.partNonImposable = 0;
    out.ligneCA3 = ligne;
    affecterCompte(out, v, codeRegime);
    return out;
  }

  // L'utilisateur a-t-il explicitement demandé/saisi un régime de marge ?
  function margeDemandee(v) {
    return v.regimeChoisi === "MARGE";
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
    const prix = num(v.venteHT != null ? v.venteHT : reconstituerHT(v));
    const alertes = [];

    // Conditions d'exclusion (motifs)
    if (v.natureBien !== "oeuvre_art") {
      return { du: false, montant: 0, motif: "Œuvre non éligible (pas une œuvre d'art originale)", alertes };
    }
    if (ds.oeuvreOriginale === false) {
      return { du: false, montant: 0, motif: "Œuvre non originale", alertes };
    }
    if (ds.premiereCession === true) {
      return { du: false, montant: 0, motif: "1ère cession par l'artiste (pas de revente)", alertes };
    }
    if (ds.artisteVivantOuMoins70 === false) {
      return { du: false, montant: 0, motif: "Artiste décédé depuis + de 70 ans", alertes };
    }
    if (ds.venteSoumiseFrance === false) {
      return { du: false, montant: 0, motif: "Vente non établie en France / hors champ", alertes };
    }
    if (prix < PARAMS.droitDeSuite.seuilApplication) {
      return { du: false, montant: 0, motif: "Vente < 750 €", alertes };
    }

    // Exonération du revendeur : acquise directement de l'artiste < 3 ans ET prix < 10 000 €
    if (ds.acquiseDirecteArtisteMoins3ans === true && prix < PARAMS.droitDeSuite.exoRevente.prixVente) {
      return {
        du: false, montant: 0,
        motif: "Exonéré (acquise directement de l'artiste < 3 ans et prix < 10 000 €)",
        alertes
      };
    }

    // Critères réunis -> barème
    const montant = baremeDroitDeSuite(prix);
    if (ds.artisteVivantOuMoins70 == null) {
      alertes.push(warn("DS_ARTISTE",
        "Confirmez : l'artiste est-il vivant ou décédé depuis ≤ 70 ans ? (condition du droit de suite)"));
    }
    return { du: true, montant: r2(montant), motif: "OK - Critères réunis", alertes };
  }

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
    const prix = num(tf.prixCession != null ? tf.prixCession : v.venteTTC);

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
   *  CADRAGE COMPTABLE : régime + zone -> compte produit
   * ================================================================= */
  function affecterCompte(out, v, codeRegime) {
    const z = v.zone;
    let key = null;
    switch (codeRegime) {
      case "MARGE": key = z === "UE" ? "MARGE_UE" : z === "HUE" ? "MARGE_EXPORT" : "MARGE_FR"; break;
      case "DC_55": key = z === "UE" ? "TR_UE" : z === "HUE" ? "TR_HUE" : "TR_FR"; break;
      case "DC_20":
        if (v.natureBien === "prestation") { key = "COMMISSION"; break; }
        if (v.natureBien === "produit_annexe") { key = "PRODUIT_ANNEXE_20"; break; }
        key = z === "UE" ? "DC_UE" : z === "HUE" ? "DC_HUE" : "DC_FR"; break;
      case "EXPORT": key = "TR_HUE"; break;     // export d'œuvre -> compte HUE
      case "INTRACOM": key = "TR_UE"; break;    // livraison intra -> compte UE
      default: key = "DC_FR";
    }
    const c = PLAN_COMPTES[key];
    if (c) { out.compte = c.compte; out.libelleCompte = c.libelle; }
  }

  /* =================================================================
   *  CONTRÔLES DE COHÉRENCE GLOBAUX (questions d'orientation)
   *  Renvoie une liste d'alertes pour une vente donnée + son calcul.
   * ================================================================= */
  function controlerLigne(v, calc) {
    const a = [];
    // Régime saisi vs régime calculé
    if (v.regimeChoisi && calc.regime && v.regimeChoisi !== calc.regime.code) {
      a.push(warn("REGIME_DIVERGENT",
        "Régime saisi (" + libelleRegime(v.regimeChoisi) + ") ≠ régime déterminé par l'outil (" +
        calc.regime.label + "). Vérifiez la qualification."));
    }
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
    PARAMS, LISTES, PLAN_COMPTES,
    calculerTVA, calculerDroitDeSuite, calculerTaxeForfaitaire,
    controlerLigne, baremeDroitDeSuite, r2, num
  };
})();

// Export pour usage Node (tests) sans casser l'usage navigateur
if (typeof module !== "undefined" && module.exports) { module.exports = REGLES; }
