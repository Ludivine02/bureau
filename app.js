/* =====================================================================
 *  app.js — Interface de l'outil TVA Galerie d'art
 *  Logique d'écran, persistance locale, import/export, tableau de bord.
 *  Toute la règle fiscale est dans regles.js (REGLES.*).
 * ===================================================================== */
(function () {
  "use strict";
  const R = REGLES;
  const STORE_KEY = "outil_tva_galerie_v1";

  /* ---------- État ---------- */
  let state = { ventes: [], compta: {}, balanceBG: {}, artistes: {} };

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) state = Object.assign({ ventes: [], compta: {}, balanceBG: {}, artistes: {} }, JSON.parse(raw));
    } catch (e) { console.warn("Lecture stockage:", e); }
  }

  /* ---------- Référentiel artistes ----------
   * Principaux artistes connus de la galerie : tous vivants ou décédés depuis
   * ≤ 70 ans → éligibles au droit de suite. (Modifiable dans l'onglet Artistes.) */
  const ARTISTES_CONNUS = {
    "François-Xavier Lalanne": { deces: "2008", note: "décédé 2008" },
    "Claude Lalanne": { deces: "2019", note: "décédée 2019" },
    "Les Lalanne": { note: "≤ 70 ans" },
    "Niki de Saint Phalle": { deces: "2002", note: "décédée 2002" },
    "Robert Morris": { deces: "2018", note: "décédé 2018" },
    "Fred Sandback": { deces: "2003", note: "décédé 2003" },
    "Donald Judd Furniture": { deces: "1994", note: "Donald Judd, décédé 1994" },
    "Ron Gorchov": { deces: "2020", note: "décédé 2020" },
    "Roberto Matta": { deces: "2002", note: "décédé 2002" }
  };

  // Éligibilité droit de suite déduite de l'année de décès (vivant ou décédé ≤ 70 ans).
  function ddsDepuisDeces(deces) {
    const an = parseInt(deces, 10);
    if (!an) return "oui"; // vivant / inconnu
    return (R.PARAMS.exerciceCourant - an) <= 70 ? "oui" : "non";
  }

  // Applique le référentiel artiste à une vente (sans modifier l'enregistrement).
  function appliquerReferentiel(v) {
    const ref = state.artistes[(v.artiste || "").trim()];
    if (!ref) return v;
    const vc = Object.assign({}, v, { ds: Object.assign({}, v.ds), tf: Object.assign({}, v.tf) });
    if (vc.ds.artisteVivantOuMoins70 == null && ref.dds) vc.ds.artisteVivantOuMoins70 = (ref.dds === "oui");
    if (!vc.ds.applicabiliteManuelle && ref.dds === "non") vc.ds.applicabiliteManuelle = "non";
    if (!vc.tf.applicabiliteManuelle && ref.tf) vc.tf.applicabiliteManuelle = ref.tf;
    if (!vc.tf.typeObjet && ref.typeObjet) vc.tf.typeObjet = ref.typeObjet;
    return vc;
  }

  // Recense les artistes présents dans les ventes et crée les entrées manquantes.
  function recenserArtistes() {
    let ajouts = 0;
    state.ventes.forEach(v => {
      const nom = (v.artiste || "").trim();
      if (!nom || state.artistes[nom]) return;
      const connu = ARTISTES_CONNUS[nom] || {};
      state.artistes[nom] = {
        deces: connu.deces || "",
        dds: ddsDepuisDeces(connu.deces),
        organisme: "ADAGP",
        tf: "", typeObjet: "art",
        note: connu.note || "par défaut — à confirmer"
      };
      ajouts++;
    });
    return ajouts;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { console.warn(e); }
  }

  /* ---------- Helpers DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs, html) => {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === "class") e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (html != null) e.innerHTML = html;
    return e;
  };
  function fmt(n) {
    if (n == null || n === "" || isNaN(n)) return "";
    return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmt0(n) {
    if (n == null || isNaN(n)) return "";
    return Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
  }
  function pct(n) { return n == null || isNaN(n) ? "" : (n * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  const oui = (v) => v === "oui" ? true : v === "non" ? false : null;

  /* ---------- Calcul enrichi d'une vente ---------- */
  // Facture à établir (FAE) : poste de bilan (clients factures à établir 418),
  // exclue du CA ET du cadrage classe 70. Repérée par le n° « FAE » ou un marquage manuel.
  function estFAE(v) {
    if (v.fae === true || v.fae === "oui") return true;
    return /fae/i.test(String(v.numFacture || ""));
  }
  // Produit constaté d'avance / cut-off : vente rattachée à l'exercice antérieur (N-1).
  // Exclue du CA de l'exercice, mais conservée dans le cadrage (comptes 70709xxx).
  function estPCA(v) { return R.estCutoff(v); }
  // Ventes de l'exercice courant (hors FAE et hors PCA/N-1).
  function ventesExercice() { return state.ventes.filter(v => !estFAE(v) && !estPCA(v)); }
  // Ventes retenues pour le cadrage (hors FAE seulement ; PCA conservées).
  function ventesCadrage() { return state.ventes.filter(v => !estFAE(v)); }

  function evaluer(v0) {
    const v = appliquerReferentiel(v0);
    const tva = R.calculerTVA(v);
    const ds = R.calculerDroitDeSuite(v);
    const tf = R.calculerTaxeForfaitaire(v);
    const ctrl = R.controlerLigne(v, tva);
    const venteTTC = R.num(v.venteTTC), achatTTC = R.num(v.achatTTC);
    const frais = R.num(v.fraisAccessoiresHT), commissions = R.num(v.commissions);
    // Reprise FIDÈLE : on reprend le HT et la TVA RÉELLEMENT COMPTABILISÉS
    // (colonnes "Ventes HT" / "TVA Collectée") quand ils existent ; le recalcul
    // par régime (tva.tva) ne sert que de contrôle (onglet Cadrage).
    const aHT = v.htCompta !== "" && v.htCompta != null;
    const aTVA = v.tvaCompta !== "" && v.tvaCompta != null;
    const tvaCollectee = aTVA ? R.num(v.tvaCompta) : tva.tva;
    const venteHT = aHT ? R.num(v.htCompta) : R.r2(venteTTC - tva.tva);
    // Marge économique HT = Ventes HT - achats (stock + achats) - frais accessoires - commissions.
    const marge = R.r2(venteHT - achatTTC - frais - commissions);
    const tauxMarge = venteHT ? marge / venteHT : 0;
    const alertes = [].concat(tva.alertes, ds.alertes, tf.alertes, ctrl);
    return { tva, ds, tf, alertes, marge, tauxMarge, venteTTC, venteHT, tvaCollectee, achatTTC, frais, commissions };
  }

  /* =================================================================
   *  INITIALISATION DES LISTES DÉROULANTES
   * ================================================================= */
  function remplirSelect(id, items, withEmpty) {
    const s = $(id); if (!s) return;
    s.innerHTML = "";
    if (withEmpty) s.appendChild(el("option", { value: "" }, "—"));
    items.forEach(it => s.appendChild(el("option", { value: it.v }, esc(it.label))));
  }
  function initListes() {
    remplirSelect("f-natureBien", R.LISTES.natureBien);
    remplirSelect("f-modeAcquisition", R.LISTES.modeAcquisition, true);
    remplirSelect("f-zone", R.LISTES.zone);
    remplirSelect("f-typeClient", R.LISTES.typeClient);
  }

  /* =================================================================
   *  FORMULAIRE
   * ================================================================= */
  function lireFormulaire() {
    return {
      id: $("f-id").value || ("v" + Date.now()),
      ligneCompta: $("f-ligneCompta").value,
      numFacture: $("f-numFacture").value,
      dateFacture: $("f-dateFacture").value,
      artiste: $("f-artiste").value.trim(),
      oeuvre: $("f-oeuvre").value,
      refSiam: $("f-refSiam").value,
      natureBien: $("f-natureBien").value,
      oeuvreOriginale: oui($("f-oeuvreOriginale").value),
      venteTTC: $("f-venteTTC").value,
      venteSurStock: $("f-venteSurStock").value,
      achats2026: $("f-achats2026").value,
      achatTTC: R.r2(R.num($("f-venteSurStock").value) + R.num($("f-achats2026").value)),
      fraisAccessoiresHT: $("f-fraisAccessoiresHT").value,
      commissions: $("f-commissions").value,
      modeAcquisition: $("f-modeAcquisition").value,
      client: $("f-client").value,
      pays: $("f-pays").value,
      zone: $("f-zone").value,
      typeClient: $("f-typeClient").value,
      numTvaIntra: $("f-numTvaIntra").value,
      justificatifExport: oui($("f-justificatifExport").value),
      transportHorsFR: oui($("f-transportHorsFR").value),
      optionDroitCommun: oui($("f-optionDroitCommun").value),
      regimeChoisi: $("f-regimeChoisi").value,
      fae: $("f-fae").checked,
      commentaire: $("f-commentaire").value,
      ds: {
        applicabiliteManuelle: $("f-ds-applicabiliteManuelle").value,
        oeuvreOriginale: oui($("f-oeuvreOriginale").value),
        premiereCession: oui($("f-ds-premiereCession").value),
        artisteVivantOuMoins70: oui($("f-ds-artisteVivantOuMoins70").value),
        venteSoumiseFrance: oui($("f-ds-venteSoumiseFrance").value),
        acquiseDirecteArtisteMoins3ans: oui($("f-ds-acquiseDirecteArtisteMoins3ans").value)
      },
      tf: {
        applicabiliteManuelle: $("f-tf-applicabiliteManuelle").value,
        vendeurParticulier: oui($("f-tf-vendeurParticulier").value),
        typeObjet: $("f-tf-typeObjet").value,
        vendeurDomicilieFR: oui($("f-tf-vendeurDomicilieFR").value),
        optionPlusValue: oui($("f-tf-optionPlusValue").value),
        prixCession: $("f-tf-prixCession").value
      }
    };
  }

  // Conserve les champs de référence (issus de l'import) non éditables dans le formulaire.
  function fusionnerReferences(nouvelle, ancienne) {
    if (!ancienne) return nouvelle;
    ["regimeSource", "exercice", "htCompta", "tvaCompta", "compteRef", "margeBaseRef"].forEach(k => {
      if (ancienne[k] != null && nouvelle[k] == null) nouvelle[k] = ancienne[k];
    });
    // Références DS / TF (base et montant repris)
    ["baseReference", "montantReference"].forEach(k => {
      if (ancienne.ds && ancienne.ds[k] != null && (nouvelle.ds[k] == null)) nouvelle.ds[k] = ancienne.ds[k];
      if (ancienne.tf && ancienne.tf[k] != null && (nouvelle.tf[k] == null)) nouvelle.tf[k] = ancienne.tf[k];
    });
    return nouvelle;
  }
  const setBool = (id, b) => { $(id).value = b === true ? "oui" : b === false ? "non" : ""; };
  function ecrireFormulaire(v) {
    $("f-id").value = v.id || "";
    $("f-ligneCompta").value = v.ligneCompta || "";
    $("f-numFacture").value = v.numFacture || "";
    $("f-dateFacture").value = v.dateFacture || "";
    $("f-artiste").value = v.artiste || "";
    $("f-oeuvre").value = v.oeuvre || "";
    $("f-refSiam").value = v.refSiam || "";
    $("f-natureBien").value = v.natureBien || "oeuvre_art";
    setBool("f-oeuvreOriginale", v.oeuvreOriginale);
    $("f-venteTTC").value = v.venteTTC || "";
    // valeur en stock + prix d'achat de l'année (rétro-compatibilité : ancien achatTTC seul -> stock)
    $("f-venteSurStock").value = (v.venteSurStock != null && v.venteSurStock !== "") ? v.venteSurStock
      : ((v.achats2026 == null || v.achats2026 === "") && v.achatTTC ? v.achatTTC : "");
    $("f-achats2026").value = v.achats2026 || "";
    $("f-fraisAccessoiresHT").value = v.fraisAccessoiresHT || "";
    $("f-commissions").value = v.commissions || "";
    $("f-modeAcquisition").value = v.modeAcquisition || "";
    $("f-client").value = v.client || "";
    $("f-pays").value = v.pays || "";
    $("f-zone").value = v.zone || "FR";
    $("f-typeClient").value = v.typeClient || "particulier";
    $("f-numTvaIntra").value = v.numTvaIntra || "";
    setBool("f-justificatifExport", v.justificatifExport);
    setBool("f-transportHorsFR", v.transportHorsFR);
    setBool("f-optionDroitCommun", v.optionDroitCommun);
    $("f-regimeChoisi").value = v.regimeChoisi || "";
    $("f-fae").checked = estFAE(v);
    $("f-commentaire").value = v.commentaire || "";
    const ds = v.ds || {};
    $("f-ds-applicabiliteManuelle").value = ds.applicabiliteManuelle || "";
    setBool("f-ds-premiereCession", ds.premiereCession);
    setBool("f-ds-artisteVivantOuMoins70", ds.artisteVivantOuMoins70);
    setBool("f-ds-venteSoumiseFrance", ds.venteSoumiseFrance);
    setBool("f-ds-acquiseDirecteArtisteMoins3ans", ds.acquiseDirecteArtisteMoins3ans);
    const tf = v.tf || {};
    $("f-tf-applicabiliteManuelle").value = tf.applicabiliteManuelle || "";
    setBool("f-tf-vendeurParticulier", tf.vendeurParticulier);
    $("f-tf-typeObjet").value = tf.typeObjet || "art";
    setBool("f-tf-vendeurDomicilieFR", tf.vendeurDomicilieFR);
    setBool("f-tf-optionPlusValue", tf.optionPlusValue);
    $("f-tf-prixCession").value = tf.prixCession || "";
  }
  function resetFormulaire() {
    $("form-vente").reset(); $("f-id").value = ""; $("live-result").style.display = "none";
    const t = $("saisie-titre"); if (t) t.textContent = "Saisie / correction d'une vente";
  }

  /* ---------- Rendu d'une analyse (live) ---------- */
  function renderAnalyse(v) {
    const r = evaluer(v);
    const t = r.tva;
    let h = '<div class="result-card">';
    h += '<span class="tag ' + (t.regime ? t.regime.code : "") + '">' + esc(t.regime ? t.regime.label : "?") + '</span> ';
    h += '<span class="regime"></span>';
    h += '<div class="nums">';
    h += '<div><small>Base HT taxable</small><b>' + fmt(t.baseHT) + ' €</b></div>';
    h += '<div><small>TVA collectée</small><b>' + fmt(t.tva) + ' €</b></div>';
    if (t.partNonImposable) h += '<div><small>Part non imposable (ligne 05)</small><b>' + fmt(t.partNonImposable) + ' €</b></div>';
    h += '<div><small>Ligne CA3</small><b>' + esc(t.ligneCA3) + '</b></div>';
    h += '<div><small>Compte produit</small><b>' + esc(t.compte || "—") + '</b></div>';
    h += '<div><small>Vente HT</small><b>' + fmt(r.venteHT) + ' €</b></div>';
    h += '<div><small>Marge HT / taux <span title="Vente HT − achats − frais − commissions">ⓘ</span></small><b>' + fmt(r.marge) + ' € · ' + pct(r.tauxMarge) + '</b></div>';
    h += '</div></div>';

    if (r.ds.du) h += '<div class="alert info" style="margin-top:10px"><b>Droit de suite dû : ' + fmt(r.ds.montant) + ' €</b> — ' + esc(r.ds.motif) + '</div>';
    else h += '<div class="alert info" style="margin-top:10px">Droit de suite : non dû — <i>' + esc(r.ds.motif) + '</i></div>';

    if (r.tf.du) h += '<div class="alert warn"><b>Taxe forfaitaire due : ' + fmt(r.tf.montant) + ' €</b> (' + pct(r.tf.taux) + ' sur ' + fmt(r.tf.assiette) + ' €) — ' + esc(r.tf.motif) + '</div>';

    if (r.alertes.length) {
      h += '<h3>Points à vérifier</h3>';
      r.alertes.forEach(a => { h += renderAlerte(a); });
    }
    return h;
  }
  function renderAlerte(a) {
    return '<div class="alert ' + a.niveau + '">' + esc(a.message) + ' <span class="src">[' + esc(a.code) + ']</span></div>';
  }

  /* =================================================================
   *  TABLEAU DES VENTES
   * ================================================================= */
  function renderVentes() { renderListeVentes("ventes-table", ventesExercice(), "Cliquez sur une ligne pour ouvrir la fiche et corriger la vente.", "Aucune vente de l'exercice."); }
  function renderListeVentes(wrapId, liste, hint, vide) {
    const wrap = $(wrapId);
    if (!liste.length) { wrap.innerHTML = '<div class="empty">' + vide + '</div>'; return; }
    let h = '<p class="hint">' + hint + '</p>';
    h += '<div class="table-wrap"><table><thead><tr>' +
      '<th>Facture</th><th>Date</th><th>Artiste</th><th>Œuvre</th><th>Zone</th><th>Client</th>' +
      '<th class="num">Vente TTC</th><th class="num">Achat</th><th class="num">Frais</th><th class="num">Comm.</th>' +
      '<th class="num">Marge HT</th><th class="num">% marge</th><th>Régime appliqué</th><th class="num">TVA</th><th class="num">Écart TVA</th>' +
      '<th class="num">DS</th><th class="num">TF</th><th>!</th><th></th></tr></thead><tbody>';
    liste.forEach(v => {
      const r = evaluer(v);
      const nbA = r.alertes.length, nbDanger = r.alertes.filter(a => a.niveau === "danger").length;
      const tvaRef = v.tvaCompta === "" || v.tvaCompta == null ? null : R.num(v.tvaCompta);
      const ecartTVA = tvaRef == null ? null : R.r2(r.tva.tva - tvaRef);
      const zl = { FR: "France", UE: "UE", HUE: "Hors UE" }[v.zone] || esc(v.zone || "");
      h += '<tr class="clic" data-edit="' + v.id + '" title="Cliquer pour corriger cette vente">';
      h += '<td>' + esc(v.numFacture) + '</td><td>' + esc(v.dateFacture) + '</td>';
      h += '<td>' + esc(v.artiste) + '</td><td>' + esc(v.oeuvre) + '</td>';
      h += '<td>' + zl + '</td><td>' + esc(v.typeClient) + '</td>';
      h += '<td class="num">' + fmt(r.venteTTC) + '</td><td class="num">' + fmt(r.achatTTC) + '</td>';
      h += '<td class="num">' + fmt(r.frais) + '</td><td class="num">' + fmt(r.commissions) + '</td>';
      h += '<td class="num">' + fmt(r.marge) + '</td><td class="num">' + pct(r.tauxMarge) + '</td>';
      h += '<td><span class="tag ' + (r.tva.regime ? r.tva.regime.code : "") + '">' + esc(r.tva.regime ? r.tva.regime.label : "?") + '</span></td>';
      h += '<td class="num">' + fmt(r.tvaCollectee) + '</td>';
      h += '<td class="num">' + (ecartTVA == null ? "" : '<span class="' + (Math.abs(ecartTVA) < 1 ? "ecart-ok" : "ecart-ko") + '">' + fmt(ecartTVA) + '</span>') + '</td>';
      h += '<td class="num">' + (r.ds.du ? fmt(r.ds.montant) : "—") + '</td>';
      h += '<td class="num">' + (r.tf.du ? fmt(r.tf.montant) : "—") + '</td>';
      h += '<td>' + (nbA ? '<span class="dot ' + (nbDanger ? "danger" : "warn") + '"></span>' + nbA : "") + '</td>';
      h += '<td><button class="btn small danger" data-del="' + v.id + '">×</button></td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    wrap.innerHTML = h;
    wrap.querySelectorAll("tr.clic").forEach(tr => tr.onclick = () => editVente(tr.getAttribute("data-edit")));
    wrap.querySelectorAll("[data-del]").forEach(b => b.onclick = (e) => { e.stopPropagation(); delVente(b.getAttribute("data-del")); });
  }
  // Onglet Cut-off / N-1 : PCA (N-1) + FAE, séparés des ventes de l'année.
  function renderCutoff() {
    const pca = state.ventes.filter(v => !estFAE(v) && estPCA(v));
    const fae = state.ventes.filter(v => estFAE(v));
    setBadge("badge-cutoff", pca.length + fae.length);
    const bloc = (titre, liste, note) => {
      if (!liste.length) return "";
      let s = '<h3>' + titre + ' <span style="color:var(--muted);font-weight:400">(' + liste.length + ')</span></h3>';
      if (note) s += '<p class="hint">' + note + '</p>';
      s += '<div class="table-wrap"><table><thead><tr><th>Facture</th><th>Date</th><th>Artiste</th><th>Œuvre</th>' +
        '<th>Zone</th><th class="num">Vente TTC</th><th class="num">HT</th><th>Compte</th><th></th></tr></thead><tbody>';
      let tot = 0;
      liste.forEach(v => {
        const ht = (v.htCompta !== "" && v.htCompta != null) ? R.num(v.htCompta) : R.num(v.venteTTC);
        tot += ht;
        const t = R.calculerTVA(v);
        s += '<tr class="clic" data-edit="' + v.id + '" title="Cliquer pour corriger">' +
          '<td>' + esc(v.numFacture) + '</td><td>' + esc(v.dateFacture) + '</td><td>' + esc(v.artiste) + '</td><td>' + esc(v.oeuvre) + '</td>' +
          '<td>' + esc(v.zone) + '</td><td class="num">' + fmt(R.num(v.venteTTC)) + '</td><td class="num">' + fmt(ht) + '</td>' +
          '<td>' + esc(t.compte || v.compteRef || "") + '</td>' +
          '<td><button class="btn small danger" data-del="' + v.id + '">×</button></td></tr>';
      });
      s += '</tbody><tfoot><tr><td colspan="6">TOTAL</td><td class="num">' + fmt(tot) + '</td><td colspan="2"></td></tr></tfoot></table></div>';
      return s;
    };
    let h = bloc("Produits constatés d'avance / cut-off N-1", pca,
      "Ventes rattachées à l'exercice antérieur (date avant l'exercice courant). Comptabilisées sur les comptes de cut-off 70709xxx.");
    h += bloc("Factures à établir (FAE)", fae,
      "Poste de bilan (compte 418 « clients factures à établir »), hors chiffre d'affaires de classe 70.");
    if (!h) h = '<div class="empty">Aucune ligne de cut-off ni facture à établir.</div>';
    const wrap = $("cutoff-table"); wrap.innerHTML = h;
    wrap.querySelectorAll("tr.clic").forEach(tr => tr.onclick = () => editVente(tr.getAttribute("data-edit")));
    wrap.querySelectorAll("[data-del]").forEach(b => b.onclick = (e) => { e.stopPropagation(); delVente(b.getAttribute("data-del")); });
  }
  function editVente(id) {
    const v = state.ventes.find(x => x.id === id); if (!v) return;
    ecrireFormulaire(v); switchView("saisie");
    const t = $("saisie-titre"); if (t) t.textContent = "Correction — " + (v.oeuvre || v.numFacture || "vente");
    $("live-result").style.display = "block"; $("live-result-body").innerHTML = renderAnalyse(v);
    window.scrollTo(0, 0);
  }
  function delVente(id) {
    if (!confirm("Supprimer cette vente ?")) return;
    state.ventes = state.ventes.filter(x => x.id !== id); save(); refreshAll();
  }

  /* =================================================================
   *  RÉCAP TVA (CA3)
   * ================================================================= */
  function renderTVA() {
    const acc = {}; // par code régime
    let totalTVA = 0, totalHT = 0, totalNonImp = 0, totalExo = 0;
    ventesExercice().forEach(v => {
      const t = R.calculerTVA(v);
      const code = t.regime ? t.regime.code : "?";
      acc[code] = acc[code] || { label: t.regime ? t.regime.label : "?", ligne: t.regime ? t.regime.ligneCA3 : "", ht: 0, tva: 0, ni: 0, n: 0 };
      acc[code].ht += t.baseHT; acc[code].tva += t.tva; acc[code].ni += t.partNonImposable; acc[code].n++;
      totalTVA += t.tva; totalHT += t.baseHT; totalNonImp += t.partNonImposable;
      if (code === "EXPORT" || code === "INTRACOM") totalExo += R.num(v.venteTTC);
    });
    $("kpi-tva").innerHTML =
      kpi(fmt0(totalHT) + " €", "Base HT taxable") +
      kpi(fmt0(totalTVA) + " €", "TVA collectée") +
      kpi(fmt0(totalExo) + " €", "CA exonéré (export+intracom)") +
      kpi(fmt0(totalNonImp) + " €", "Part non imposable (marge, ligne 05)");

    let h = '<div class="table-wrap"><table><thead><tr><th>Régime</th><th>Ligne CA3</th><th class="num">Nb</th>' +
      '<th class="num">Base HT</th><th class="num">TVA collectée</th><th class="num">Non imposable</th></tr></thead><tbody>';
    const order = ["DC_55", "DC_20", "MARGE", "INTRACOM", "EXPORT", "?"];
    Object.keys(acc).sort((a, b) => order.indexOf(a) - order.indexOf(b)).forEach(code => {
      const r = acc[code];
      h += '<tr><td><span class="tag ' + code + '">' + esc(r.label) + '</span></td><td>' + esc(r.ligne) + '</td>' +
        '<td class="num">' + r.n + '</td><td class="num">' + fmt(r.ht) + '</td><td class="num">' + fmt(r.tva) + '</td><td class="num">' + fmt(r.ni) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="3">TOTAL</td><td class="num">' + fmt(totalHT) + '</td><td class="num">' + fmt(totalTVA) + '</td><td class="num">' + fmt(totalNonImp) + '</td></tr></tfoot></table></div>';
    if (!state.ventes.length) h = '<div class="empty">Aucune donnée.</div>';
    $("tva-table").innerHTML = h;
  }

  /* =================================================================
   *  DROIT DE SUITE
   * ================================================================= */
  function renderDS() {
    let h = '<div class="table-wrap"><table><thead><tr><th>Facture</th><th>Artiste</th><th>Œuvre</th>' +
      '<th class="num">Prix vente</th><th>Dû ?</th><th class="num">Montant</th><th>Reverser à</th><th>Motif</th></tr></thead><tbody>';
    let total = 0, n = 0, potentielsNon = 0;
    ventesExercice().forEach(v => {
      const ds = R.calculerDroitDeSuite(appliquerReferentiel(v));
      if (!ds.du && ds.potentiel && (v.ds && v.ds.applicabiliteManuelle === "non")) potentielsNon++;
      const ref = state.artistes[(v.artiste || "").trim()];
      const organisme = ds.du ? (ref && ref.organisme ? ref.organisme : "à préciser") : "";
      if (ds.du) { total += ds.montant; n++; }
      h += '<tr><td>' + esc(v.numFacture) + '</td><td>' + esc(v.artiste) + '</td><td>' + esc(v.oeuvre) + '</td>' +
        '<td class="num">' + fmt(R.num(v.venteTTC)) + '</td>' +
        '<td>' + (ds.du ? '<span class="dot ok"></span>Oui' : "Non") + '</td>' +
        '<td class="num">' + (ds.du ? fmt(ds.montant) : "—") + '</td><td>' + esc(organisme) + '</td><td>' + esc(ds.motif) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="5">TOTAL droit de suite (' + n + ' œuvre(s))</td><td class="num">' + fmt(total) + '</td><td colspan="2"></td></tr></tfoot></table></div>';
    if (!state.ventes.length) h = '<div class="empty">Aucune donnée.</div>';
    // Indicateur agrégé d'omissions possibles (au lieu d'une alerte par ligne).
    let banner = "";
    if (potentielsNon > 0) banner = '<div class="alert warn"><b>' + potentielsNon +
      ' vente(s)</b> d\'artistes éligibles, en France/UE et ≥ 750 € sont marquées <b>sans droit de suite</b>. ' +
      'Vérifiez qu\'il s\'agit bien de <b>1ères cessions (marché primaire)</b> ou de cas d\'exonération — sinon le droit de suite a pu être omis.</div>';
    $("ds-table").innerHTML = banner + h;
  }

  /* =================================================================
   *  TAXE FORFAITAIRE
   * ================================================================= */
  function renderTF() {
    let h = '<div class="table-wrap"><table><thead><tr><th>Facture</th><th>Vendeur</th><th>Œuvre</th>' +
      '<th class="num">Assiette</th><th class="num">Taux</th><th class="num">Montant</th><th>Statut</th></tr></thead><tbody>';
    let total = 0, n = 0;
    ventesExercice().forEach(v => {
      const tf = R.calculerTaxeForfaitaire(appliquerReferentiel(v));
      if (tf.du) { total += tf.montant; n++; }
      h += '<tr><td>' + esc(v.numFacture) + '</td><td>' + esc(v.client) + '</td><td>' + esc(v.oeuvre) + '</td>' +
        '<td class="num">' + (tf.du ? fmt(tf.assiette) : "—") + '</td>' +
        '<td class="num">' + (tf.du ? pct(tf.taux) : "—") + '</td>' +
        '<td class="num">' + (tf.du ? fmt(tf.montant) : "—") + '</td><td>' + esc(tf.motif) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="5">TOTAL taxe forfaitaire (' + n + ' cession(s))</td><td class="num">' + fmt(total) + '</td><td></td></tr></tfoot></table></div>';
    if (!state.ventes.length) h = '<div class="empty">Aucune donnée.</div>';
    $("tf-table").innerHTML = h;
  }

  /* =================================================================
   *  CADRAGE COMPTABLE
   * ================================================================= */
  // Ventile le CA HT RÉELLEMENT COMPTABILISÉ (colonne "Ventes HT") d'une vente
  // sur le compte du régime ; pour la marge, la part non imposable va sur 70713000.
  function caVentilation(v, add) {
    const t = R.calculerTVA(v);
    const aHT = v.htCompta !== "" && v.htCompta != null;
    const htTotal = aHT ? R.num(v.htCompta) : R.r2(R.num(v.venteTTC) - t.tva);
    if (t.regime && t.regime.code === "MARGE") {
      const ns = Math.min(t.partNonImposable || 0, htTotal);
      add(t.compte || "—", t.libelleCompte, R.r2(htTotal - ns));
      if (ns) add("70713000", "Ventes œuvres - CA non soumis", R.r2(ns));
    } else {
      add(t.compte || "—", t.libelleCompte, htTotal);
    }
  }
  const soldeBG = (c) => R.num(state.balanceBG[c]);
  const ecartCell = (e) => '<span class="' + (Math.abs(e) < 1 ? "ecart-ok" : "ecart-ko") + '">' + fmt(e) + '</span>';

  function renderCadrage() {
    if (!state.ventes.length) { $("cadrage-table").innerHTML = '<div class="empty">Aucune donnée.</div>'; return; }

    /* --- Volet A : CA classe 70 par compte (HT RÉELLEMENT COMPTABILISÉ) --- */
    const caCpt = {};
    const add = (c, lib, ht) => { caCpt[c] = caCpt[c] || { libelle: lib || (R.PLAN_COMPTES[c] || ""), ht: 0 }; caCpt[c].ht += ht; };
    ventesCadrage().forEach(v => caVentilation(v, add));
    let hA = '<div class="table-wrap"><table><thead><tr><th>Compte</th><th>Libellé</th>' +
      '<th class="num">CA HT outil</th><th class="num">Solde BG (HT)</th><th class="num">Écart BG − outil</th></tr></thead><tbody>';
    let totO = 0, totB = 0;
    Object.keys(caCpt).sort().forEach(c => {
      const r = caCpt[c];
      const saisiBG = state.balanceBG[c] != null && state.balanceBG[c] !== "" ? state.balanceBG[c] : "";
      const bg = R.num(saisiBG);
      const ecart = saisiBG === "" ? null : R.r2(bg - r.ht);
      totO += r.ht; totB += bg;
      hA += '<tr><td>' + esc(c) + '</td><td>' + esc(r.libelle) + '</td>' +
        '<td class="num">' + fmt(r.ht) + '</td>' +
        '<td class="num"><input type="number" step="0.01" data-bg="' + esc(c) + '" value="' + esc(saisiBG) + '" style="max-width:130px;text-align:right"></td>' +
        '<td class="num">' + (ecart == null ? "" : ecartCell(ecart)) + '</td></tr>';
    });
    hA += '</tbody><tfoot><tr><td colspan="2">TOTAL classe 70</td><td class="num">' + fmt(totO) + '</td>' +
      '<td class="num">' + fmt(totB) + '</td><td class="num">' + ecartCell(R.r2(totB - totO)) + '</td></tr></tfoot></table></div>';

    /* --- Volet B : TVA collectée --- */
    let tvaO = 0; ventesCadrage().forEach(v => tvaO += R.calculerTVA(v).tva);
    const tvaB = R.CADRAGE.tvaCollectee.reduce((s, c) => s + soldeBG(c), 0);
    let hB = '<div class="table-wrap"><table><thead><tr><th>Indicateur</th><th class="num">Montant</th></tr></thead><tbody>' +
      '<tr><td>TVA collectée outil (toutes lignes)</td><td class="num">' + fmt(tvaO) + '</td></tr>' +
      '<tr><td>TVA collectée Balance (comptes ' + R.CADRAGE.tvaCollectee.join(", ") + ')</td><td class="num">' + fmt(tvaB) + '</td></tr>' +
      '<tr><td><b>Écart BG − outil</b></td><td class="num">' + ecartCell(R.r2(tvaB - tvaO)) + '</td></tr>' +
      '</tbody></table></div>';

    /* --- Volet C : achats & coûts (classe 6) --- */
    const som = { achat: 0, frais: 0, commissions: 0, ds: 0, tf: 0 };
    ventesCadrage().forEach(v => {
      const vr = appliquerReferentiel(v);
      som.achat += R.num(v.achatTTC); som.frais += R.num(v.fraisAccessoiresHT); som.commissions += R.num(v.commissions);
      const ds = R.calculerDroitDeSuite(vr); if (ds.du) som.ds += ds.montant;
      const tf = R.calculerTaxeForfaitaire(vr); if (tf.du) som.tf += tf.montant;
    });
    let hC = '<div class="table-wrap"><table><thead><tr><th>Poste</th><th>Comptes BG</th>' +
      '<th class="num">Outil</th><th class="num">Balance</th><th class="num">Écart BG − outil</th></tr></thead><tbody>';
    R.CADRAGE.achats.forEach(g => {
      const o = som[g.cle];
      const b = Math.abs(g.comptes.reduce((s, c) => s + soldeBG(c), 0));
      hC += '<tr><td>' + esc(g.label) + '</td><td><small>' + g.comptes.join(", ") + '</small></td>' +
        '<td class="num">' + fmt(o) + '</td><td class="num">' + fmt(b) + '</td><td class="num">' + ecartCell(R.r2(b - o)) + '</td></tr>';
    });
    hC += '</tbody></table></div>';

    $("cadrage-table").innerHTML =
      '<h3>A. Cadrage du CA par compte (classe 70, HT)</h3>' +
      '<p class="hint">Le solde BG est pré-rempli depuis la Balance importée ; vous pouvez l\'ajuster (sauvegarde automatique).</p>' + hA +
      '<h3>B. Cadrage de la TVA collectée</h3>' + hB +
      '<h3>C. Cadrage des achats &amp; coûts (classe 6)</h3>' +
      '<p class="hint">Montants de l\'outil confrontés aux soldes des comptes d\'achats de la Balance (en valeur absolue).</p>' + hC;

    $("cadrage-table").querySelectorAll("input[data-bg]").forEach(inp => {
      inp.onchange = () => { state.balanceBG[inp.getAttribute("data-bg")] = inp.value; save(); renderCadrage(); };
    });
  }

  /* =================================================================
   *  CONTRÔLES CONSOLIDÉS
   * ================================================================= */
  function renderControles() {
    const items = [];
    state.ventes.forEach(v => {
      const r = evaluer(v);
      r.alertes.forEach(a => items.push({ v, a }));
    });
    const nbDanger = items.filter(i => i.a.niveau === "danger").length;
    const nbWarn = items.filter(i => i.a.niveau === "warn").length;
    setBadge("badge-controles", nbDanger + nbWarn);
    let h = '<div class="kpi-row">' +
      kpi(nbDanger, "Erreurs probables", nbDanger ? "alarm" : "") +
      kpi(nbWarn, "Points à vérifier") +
      kpi(items.filter(i => i.a.niveau === "info").length, "Informations") + '</div>';
    if (!items.length) { h += '<div class="alert info">Aucun point de contrôle détecté sur les ventes saisies.</div>'; }
    const ordre = { danger: 0, warn: 1, info: 2 };
    items.sort((x, y) => ordre[x.a.niveau] - ordre[y.a.niveau]);
    items.forEach(i => {
      const ref = (i.v.numFacture || i.v.oeuvre || i.v.id);
      h += '<div class="alert ' + i.a.niveau + '"><b>' + esc(ref) + '</b> — ' + esc(i.a.message) + ' <span class="src">[' + esc(i.a.code) + ']</span></div>';
    });
    $("controles-body").innerHTML = h;
  }

  /* =================================================================
   *  TABLEAU DE BORD
   * ================================================================= */
  function ventesFiltrees() {
    const from = $("db-from").value, to = $("db-to").value;
    return state.ventes.filter(v => {
      if (!v.dateFacture) return !from && !to;
      if (from && v.dateFacture < from) return false;
      if (to && v.dateFacture > to) return false;
      return true;
    });
  }
  function renderDashboard() {
    const vs = ventesFiltrees().filter(v => !estFAE(v) && !estPCA(v)).map(v => ({ v, r: evaluer(v) }));
    let caTTC = 0, caHT = 0, achats = 0, marge = 0, tva = 0;
    vs.forEach(({ v, r }) => {
      caTTC += r.venteTTC; achats += r.achatTTC; marge += r.marge; tva += r.tvaCollectee;
      caHT += r.venteHT;
    });
    const tauxMargeGlobal = caHT ? marge / caHT : 0;
    // CA par rattachement : exercice courant / exercice antérieur (N-1, PCA) / FAE / total.
    const sumHT = arr => arr.reduce((s, v) => s + ((v.htCompta !== "" && v.htCompta != null) ? R.num(v.htCompta) : R.num(v.venteTTC)), 0);
    const caN1 = sumHT(state.ventes.filter(v => !estFAE(v) && estPCA(v)));
    const faeArr = state.ventes.filter(v => estFAE(v));
    const caFAE = sumHT(faeArr);
    // CA total = exercice + N-1 (classe 70). La FAE est un poste de BILAN (418), hors CA.
    const caTotal = caHT + caN1;
    const exo = R.PARAMS.exerciceCourant;
    $("db-kpi").innerHTML =
      kpi(fmt0(caHT) + " €", "CA HT exercice (" + exo + ")") +
      kpi(fmt0(caN1) + " €", "CA HT antérieur (N-1)") +
      kpi(fmt0(caTotal) + " €", "CA HT total (classe 70)") +
      kpi(fmt0(marge) + " €", "Marge HT exercice (nette)") +
      kpi(pct(tauxMargeGlobal), "Taux de marge moyen") +
      kpi(fmt0(tva) + " €", "TVA collectée exercice") +
      kpi(vs.length, "Nb ventes exercice");
    if (caN1 || faeArr.length) {
      $("db-kpi").innerHTML += '<div class="kpi" style="background:#f7f9f9"><div class="l" style="margin-bottom:4px">Détail hors exercice (onglet Cut-off)</div>' +
        '<div style="font-size:13px">dont N-1 (PCA) : <b>' + fmt0(caN1) + ' €</b><br>FAE hors CA (bilan 418) : <b>' + fmt0(caFAE) + ' €</b> (' + faeArr.length + ')</div></div>';
    }

    // Top ventes
    const parVente = vs.slice().sort((a, b) => b.r.venteTTC - a.r.venteTTC).slice(0, 10);
    $("db-top-ventes").innerHTML = miniTable(
      ["Œuvre", "Artiste", "Vente TTC", "Marge HT", "%"],
      parVente.map(x => [esc(x.v.oeuvre || x.v.numFacture), esc(x.v.artiste), fmt0(x.r.venteTTC), fmt0(x.r.marge), pct(x.r.tauxMarge)]),
      [false, false, true, true, true]);

    // Top taux de marge (ventes significatives > 0)
    const parTaux = vs.filter(x => x.r.venteHT > 0).slice().sort((a, b) => b.r.tauxMarge - a.r.tauxMarge).slice(0, 10);
    $("db-top-taux").innerHTML = miniTable(
      ["Œuvre", "Artiste", "% marge", "Vente TTC", "Marge HT"],
      parTaux.map(x => [esc(x.v.oeuvre || x.v.numFacture), esc(x.v.artiste), pct(x.r.tauxMarge), fmt0(x.r.venteTTC), fmt0(x.r.marge)]),
      [false, false, true, true, true]);

    // Top artistes
    const art = {};
    vs.forEach(({ v, r }) => {
      const nom = (v.artiste && v.artiste.trim()) ? v.artiste.trim() : "(non renseigné)";
      art[nom] = art[nom] || { ca: 0, ht: 0, marge: 0, n: 0 };
      art[nom].ca += r.venteTTC; art[nom].ht += r.venteHT; art[nom].marge += r.marge; art[nom].n++;
    });
    const artArr = Object.keys(art).map(k => ({ nom: k, ...art[k] })).sort((a, b) => b.ca - a.ca).slice(0, 10);
    $("db-top-artistes").innerHTML = miniTable(
      ["Artiste", "Nb", "CA TTC", "Marge HT", "% marge"],
      artArr.map(a => [esc(a.nom), a.n, fmt0(a.ca), fmt0(a.marge), pct(a.ht ? a.marge / a.ht : 0)]),
      [false, true, true, true, true]);

    // Répartition par régime
    const reg = {};
    vs.forEach(({ r }) => {
      const code = r.tva.regime ? r.tva.regime.code : "?";
      const label = r.tva.regime ? r.tva.regime.label : "?";
      reg[code] = reg[code] || { label, ca: 0, n: 0 };
      reg[code].ca += r.venteTTC; reg[code].n++;
    });
    const regArr = Object.keys(reg).map(k => ({ code: k, ...reg[k] })).sort((a, b) => b.ca - a.ca);
    $("db-repartition").innerHTML = miniTable(
      ["Régime", "Nb", "CA TTC", "Part"],
      regArr.map(x => ['<span class="tag ' + x.code + '">' + esc(x.label) + '</span>', x.n, fmt0(x.ca), pct(caTTC ? x.ca / caTTC : 0)]),
      [false, true, true, true]);

    if (!vs.length) {
      ["db-top-ventes", "db-top-taux", "db-top-artistes", "db-repartition"].forEach(id => $(id).innerHTML = '<div class="empty">Aucune donnée.</div>');
    }
  }
  function miniTable(headers, rows, nums) {
    if (!rows.length) return '<div class="empty">—</div>';
    let h = '<div class="table-wrap"><table><thead><tr>';
    headers.forEach((hd, i) => h += '<th class="' + (nums[i] ? "num" : "") + '">' + hd + '</th>');
    h += '</tr></thead><tbody>';
    rows.forEach(row => {
      h += '<tr>';
      row.forEach((c, i) => h += '<td class="' + (nums[i] ? "num" : "") + '">' + c + '</td>');
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* ---------- Petits composants ---------- */
  function kpi(value, label, cls) { return '<div class="kpi ' + (cls || "") + '"><div class="v">' + value + '</div><div class="l">' + esc(label) + '</div></div>'; }
  function setBadge(id, n) { const b = $(id); if (!b) return; b.textContent = n; b.classList.toggle("zero", !n); }

  /* =================================================================
   *  SIMULATEUR FOIRE
   * ================================================================= */
  function renderSimulateur() {
    const cout = R.num($("sim-cout").value);
    const tvaRecup = $("sim-tva-recup").value;
    const oeuvre = {
      coutHT: cout,
      margeEligible: R.margeEligibleDe(tvaRecup),
      dsEligible: $("sim-ds-eligible").value === "oui"
    };
    renderAsking(oeuvre);
    renderNego(oeuvre);
  }

  function renderAsking(o) {
    const box = $("asking-result");
    const taux = R.num($("sim-taux").value);
    if (!o.coutHT || !taux) { box.innerHTML = '<div class="empty">Saisissez le coût et le taux de marge attendu.</div>'; return; }
    const r = R.simulerAsking({ coutHT: o.coutHT, margeEligible: o.margeEligible, dsEligible: o.dsEligible, tauxMarge: taux });
    let h = '<div class="result-card"><small>Prix de vente HT espéré</small>' +
      '<div class="regime">' + fmt(r.pvHT) + ' €</div>' +
      '<div class="nums">' +
      '<div><small>Marge HT</small><b>' + fmt(r.margeHT) + ' €</b></div>' +
      '<div><small>Taux de marge</small><b>' + pct(r.tauxMarge) + '</b></div>' +
      '<div><small>Régime probable</small><b style="font-size:13px">' + esc(r.regimeProbable) + '</b></div>' +
      '<div><small>Prix TTC indicatif (France, 5,5%)</small><b>' + fmt(r.ttcFranceParticulier) + ' €</b></div>' +
      '</div></div>';
    if (o.dsEligible) h += '<div class="alert info" style="margin-top:8px">Droit de suite estimé à ce prix : <b>' + fmt(r.ds) + ' €</b> — marge HT après droit de suite : <b>' + fmt(r.margeApresDS) + ' €</b>.</div>';
    box.innerHTML = h;
  }

  function renderNego(o) {
    const box = $("nego-result");
    const ttc = R.num($("sim-ttc-nego").value);
    if (!o.coutHT || !ttc) { box.innerHTML = '<div class="empty">Saisissez le coût de l\'œuvre et le prix TTC négocié.</div>'; return; }
    const r = R.simulerNegociation({
      coutHT: o.coutHT, margeEligible: o.margeEligible, dsEligible: o.dsEligible,
      acquereur: $("sim-acquereur").value, lieu: $("sim-lieu").value,
      transport: $("sim-transport").value, prixTTCnego: ttc
    });
    const alarme = r.marge < 0;
    let h = '<div class="result-card"><small>Marge finale sur la vente</small>' +
      '<div class="regime" style="color:' + (alarme ? "var(--danger)" : "var(--brand-d)") + '">' + fmt(r.marge) + ' €</div>' +
      '<span class="tag ' + r.regimeCode + '">' + esc(r.regime) + '</span> ' +
      '<span style="font-size:13px;color:var(--muted)">taux de marge ' + pct(r.tauxMarge) + '</span>' +
      '<div class="nums" style="margin-top:10px">' +
      '<div><small>Prix TTC négocié</small><b>' + fmt(r.ttc) + ' €</b></div>' +
      '<div><small>TVA</small><b>' + (r.tva > 0 ? fmt(r.tva) + ' €' : "exonérée") + '</b></div>' +
      '<div><small>Prix HT réalisé</small><b>' + fmt(r.ht) + ' €</b></div>' +
      '<div><small>Coût d\'acquisition</small><b>− ' + fmt(o.coutHT) + ' €</b></div>' +
      (r.transport ? '<div><small>Frais de transport</small><b>− ' + fmt(r.transport) + ' €</b></div>' : '') +
      (r.ds ? '<div><small>Droit de suite</small><b>− ' + fmt(r.ds) + ' €</b></div>' : '') +
      '</div></div>';
    if (r.alternative) h += '<div class="alert info" style="margin-top:8px">Régime retenu : le plus avantageux. Autre option (' + esc(r.alternative.regime) + ') : marge ' + fmt(r.alternative.marge) + ' €.</div>';
    // Comparaison à l'objectif d'asking
    const taux = R.num($("sim-taux").value);
    if (taux) {
      const ask = R.simulerAsking({ coutHT: o.coutHT, margeEligible: o.margeEligible, dsEligible: o.dsEligible, tauxMarge: taux });
      const diff = R.r2(r.marge - ask.margeApresDS);
      h += '<div class="alert ' + (diff >= 0 ? "info" : "warn") + '" style="margin-top:8px">Objectif (asking) : marge ' + fmt(ask.margeApresDS) + ' € — ' +
        (diff >= 0 ? 'vous êtes <b>au-dessus</b> de +' + fmt(diff) + ' €.' : 'vous êtes <b>en dessous</b> de ' + fmt(diff) + ' €.') + '</div>';
    }
    box.innerHTML = h;
  }

  /* =================================================================
   *  RÉFÉRENTIEL ARTISTES (rendu)
   * ================================================================= */
  function renderArtistes() {
    // Stats par artiste (à partir des ventes)
    const stat = {};
    state.ventes.forEach(v => {
      const nom = (v.artiste || "").trim(); if (!nom) return;
      stat[nom] = stat[nom] || { n: 0, ca: 0 };
      stat[nom].n++; stat[nom].ca += R.num(v.venteTTC);
    });
    const noms = Object.keys(state.artistes).sort((a, b) => (stat[b] ? stat[b].ca : 0) - (stat[a] ? stat[a].ca : 0));
    if (!noms.length) { $("artistes-table").innerHTML = '<div class="empty">Aucun artiste. Cliquez sur « Recenser les artistes de l\'historique ».</div>'; return; }
    let h = '<div class="table-wrap"><table><thead><tr><th>Artiste</th><th class="num">Ventes</th><th class="num">CA TTC</th>' +
      '<th class="num">Décès</th><th>Droit de suite éligible</th><th>Organisme (reversement)</th>' +
      '<th>Taxe forf. (défaut)</th><th>Type objet</th><th>Note</th><th></th></tr></thead><tbody>';
    noms.forEach(nom => {
      const a = state.artistes[nom], s = stat[nom] || { n: 0, ca: 0 };
      h += '<tr><td>' + esc(nom) + '</td><td class="num">' + s.n + '</td><td class="num">' + fmt0(s.ca) + '</td>' +
        '<td class="num"><input data-art="' + esc(nom) + '" data-champ="deces" value="' + esc(a.deces || "") + '" placeholder="année" style="max-width:70px;text-align:right"></td>' +
        '<td>' + selArt(nom, "dds", a.dds, [["oui", "Oui"], ["non", "Non (+70 ans)"], ["", "—"]]) + '</td>' +
        '<td>' + selArt(nom, "organisme", a.organisme || "", [["ADAGP", "ADAGP"], ["Ayants droit", "Ayants droit"], ["Autre", "Autre"], ["", "—"]]) + '</td>' +
        '<td>' + selArt(nom, "tf", a.tf, [["", "—"], ["non", "Non applicable"], ["oui", "Applicable"]]) + '</td>' +
        '<td>' + selArt(nom, "typeObjet", a.typeObjet || "art", [["art", "Objet d'art"], ["metaux", "Métaux précieux"]]) + '</td>' +
        '<td><input data-art="' + esc(nom) + '" data-champ="note" value="' + esc(a.note || "") + '" style="min-width:140px"></td>' +
        '<td><button class="btn small danger" data-artdel="' + esc(nom) + '">×</button></td></tr>';
    });
    h += '</tbody></table></div>';
    $("artistes-table").innerHTML = h;
    $("artistes-table").querySelectorAll("[data-art]").forEach(elm => {
      elm.onchange = () => {
        const nom = elm.getAttribute("data-art"), champ = elm.getAttribute("data-champ");
        if (!state.artistes[nom]) return;
        state.artistes[nom][champ] = elm.value;
        // L'année de décès recalcule automatiquement l'éligibilité au droit de suite.
        if (champ === "deces") state.artistes[nom].dds = ddsDepuisDeces(elm.value);
        save(); refreshAll();
      };
    });
    $("artistes-table").querySelectorAll("[data-artdel]").forEach(b => b.onclick = () => {
      const nom = b.getAttribute("data-artdel");
      if (confirm("Retirer « " + nom + " » du référentiel ?")) { delete state.artistes[nom]; save(); refreshAll(); }
    });
  }
  function selArt(nom, champ, val, opts) {
    let s = '<select data-art="' + esc(nom) + '" data-champ="' + champ + '">';
    opts.forEach(o => s += '<option value="' + o[0] + '"' + (o[0] === (val || "") ? " selected" : "") + '>' + esc(o[1]) + '</option>');
    return s + '</select>';
  }

  /* =================================================================
   *  RAFRAÎCHISSEMENT GLOBAL
   * ================================================================= */
  function refreshAll() {
    setBadge("badge-ventes", state.ventes.length);
    renderSimulateur(); renderVentes(); renderCutoff(); renderTVA(); renderDS(); renderTF(); renderCadrage(); renderControles(); renderDashboard(); renderArtistes();
  }

  /* =================================================================
   *  NAVIGATION
   * ================================================================= */
  function switchView(name) {
    document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("active", b.getAttribute("data-view") === name));
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  }

  /* =================================================================
   *  IMPORT / EXPORT
   * ================================================================= */
  function exportJSON() {
    télécharger("outil_tva_galerie.json", JSON.stringify(state, null, 2), "application/json");
  }
  function exportCSV() {
    const cols = ["ligneCompta", "numFacture", "dateFacture", "artiste", "oeuvre", "natureBien", "modeAcquisition",
      "zone", "typeClient", "venteTTC", "achatTTC", "fraisAccessoiresHT", "HT_ref_compta", "TVA_ref_compta",
      "regime", "baseHT_outil", "tva_outil", "ecart_tva", "droitDeSuite", "taxeForfaitaire", "compte"];
    let csv = cols.join(";") + "\n";
    ventesExercice().forEach(v => {
      const r = evaluer(v);
      const tvaRef = v.tvaCompta === "" || v.tvaCompta == null ? "" : R.num(v.tvaCompta);
      const ecart = tvaRef === "" ? "" : R.r2(r.tva.tva - tvaRef);
      const row = [v.ligneCompta, v.numFacture, v.dateFacture, v.artiste, v.oeuvre, v.natureBien, v.modeAcquisition,
        v.zone, v.typeClient, R.num(v.venteTTC), R.num(v.achatTTC), R.num(v.fraisAccessoiresHT),
        v.htCompta === "" || v.htCompta == null ? "" : R.num(v.htCompta), tvaRef,
        r.tva.regime ? r.tva.regime.code : "", r.tva.baseHT, r.tva.tva, ecart, r.ds.du ? r.ds.montant : 0, r.tf.du ? r.tf.montant : 0, r.tva.compte || ""];
      csv += row.map(c => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(";") + "\n";
    });
    télécharger("ventes_tva.csv", "﻿" + csv, "text/csv");
  }
  function télécharger(nom, contenu, type) {
    const blob = new Blob([contenu], { type: type + ";charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: nom });
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* =================================================================
   *  EXPORT EXCEL (.xlsx natif, sans librairie externe)
   * ----------------------------------------------------------------- */
  // --- mini-ZIP (méthode "stored", non compressé) ---
  const _crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) { // files: [{name, data:Uint8Array}]
    const enc = new TextEncoder();
    const chunks = [], central = []; let offset = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255];
    const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    files.forEach(f => {
      const name = enc.encode(f.name), data = f.data, crc = crc32(data);
      const lh = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      chunks.push(new Uint8Array(lh), name, data);
      const cd = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
      central.push(new Uint8Array(cd), name);
      offset += lh.length + name.length + data.length;
    });
    let cdSize = 0; central.forEach(c => cdSize += c.length);
    const eocd = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
    const all = [].concat(chunks, central, [eocd]);
    let total = 0; all.forEach(c => total += c.length);
    const out = new Uint8Array(total); let p = 0;
    all.forEach(c => { out.set(c, p); p += c.length; });
    return out;
  }
  // --- OOXML ---
  function colLetter(n) { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
  function escXml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  // cellule : {v, t:'n'|'s', s:styleIndex}
  function cellXml(ref, cell) {
    if (cell == null || cell.v === "" || cell.v == null) return "";
    const s = cell.s ? ' s="' + cell.s + '"' : "";
    if (cell.t === "n") return '<c r="' + ref + '"' + s + '><v>' + cell.v + '</v></c>';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + escXml(cell.v) + '</t></is></c>';
  }
  function sheetXml(rows) {
    let sd = "";
    rows.forEach((row, ri) => {
      let rc = "";
      row.forEach((cell, ci) => { rc += cellXml(colLetter(ci) + (ri + 1), cell); });
      sd += '<row r="' + (ri + 1) + '">' + rc + '</row>';
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + sd + '</sheetData></worksheet>';
  }
  function classeurXlsx(feuilles) { // feuilles: [{nom, rows}]
    const enc = new TextEncoder();
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0"/></cellStyleXfs>' +
      '<cellXfs count="4">' +
      '<xf numFmtId="0" fontId="0"/>' +                                   // 0 défaut
      '<xf numFmtId="0" fontId="1" applyFont="1"/>' +                     // 1 gras
      '<xf numFmtId="4" fontId="0" applyNumberFormat="1"/>' +             // 2 #,##0.00
      '<xf numFmtId="10" fontId="0" applyNumberFormat="1"/>' +            // 3 0.00%
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
    const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      feuilles.map((f, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") +
      '</Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      feuilles.map((f, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") +
      '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      feuilles.map((f, i) => '<sheet name="' + escXml(f.nom) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") +
      '</sheets></workbook>';
    const parts = [
      { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
      { name: "_rels/.rels", data: enc.encode(rels) },
      { name: "xl/workbook.xml", data: enc.encode(workbook) },
      { name: "xl/_rels/workbook.xml.rels", data: enc.encode(wbRels) },
      { name: "xl/styles.xml", data: enc.encode(styles) }
    ];
    feuilles.forEach((f, i) => parts.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: enc.encode(sheetXml(f.rows)) }));
    return zip(parts);
  }
  // helpers cellules
  const cT = (v, s) => ({ v: v, t: "s", s: s });           // texte
  const cN = (v, s) => ({ v: R.r2(R.num(v)), t: "n", s: s || 2 }); // nombre (2 décimales)
  const cP = (v) => ({ v: v, t: "n", s: 3 });              // pourcentage (fraction)

  function exportXLSX() {
    // --- Feuille Ventes ---
    const head = ["Ligne", "Facture", "Date", "Artiste", "Œuvre", "Zone", "Type client", "Régime",
      "Vente TTC", "Achat", "Frais", "Commissions", "Marge HT", "% marge", "Vente HT", "TVA (outil)",
      "HT (réf. compta)", "TVA (réf. compta)", "Écart TVA", "Droit de suite", "Taxe forf.", "Compte"];
    const rowsV = [head.map(h => cT(h, 1))];
    ventesExercice().forEach(v => {
      const r = evaluer(v);
      const tvaRef = (v.tvaCompta === "" || v.tvaCompta == null) ? null : R.num(v.tvaCompta);
      const htRef = (v.htCompta === "" || v.htCompta == null) ? null : R.num(v.htCompta);
      rowsV.push([
        cT(v.ligneCompta), cT(v.numFacture), cT(v.dateFacture), cT(v.artiste), cT(v.oeuvre),
        cT(v.zone), cT(v.typeClient), cT(r.tva.regime ? r.tva.regime.label : ""),
        cN(r.venteTTC), cN(r.achatTTC), cN(r.frais), cN(r.commissions), cN(r.marge), cP(r.tauxMarge),
        cN(r.venteHT), cN(r.tva.tva), htRef == null ? cT("") : cN(htRef), tvaRef == null ? cT("") : cN(tvaRef),
        tvaRef == null ? cT("") : cN(r.tva.tva - tvaRef), cN(r.ds.du ? r.ds.montant : 0), cN(r.tf.du ? r.tf.montant : 0), cT(r.tva.compte || "")
      ]);
    });

    // --- Feuille Tableau de bord ---
    const vs = ventesExercice().map(v => ({ v, r: evaluer(v) }));
    let caTTC = 0, caHT = 0, marge = 0, tva = 0;
    vs.forEach(({ r }) => { caTTC += r.venteTTC; caHT += r.venteHT; marge += r.marge; tva += r.tvaCollectee; });
    const rowsD = [
      [cT("TABLEAU DE BORD", 1)], [],
      [cT("Indicateur", 1), cT("Valeur", 1)],
      [cT("Chiffre d'affaires (TTC)"), cN(caTTC)],
      [cT("CA HT"), cN(caHT)],
      [cT("Marge HT (nette)"), cN(marge)],
      [cT("Taux de marge moyen"), cP(caHT ? marge / caHT : 0)],
      [cT("TVA collectée"), cN(tva)],
      [cT("Nombre de ventes"), { v: vs.length, t: "n", s: 0 }],
      []
    ];
    const top = (titre, arr, cols) => {
      rowsD.push([cT(titre, 1)]);
      rowsD.push(cols.map(c => cT(c, 1)));
      arr.forEach(line => rowsD.push(line));
      rowsD.push([]);
    };
    const parVente = vs.slice().sort((a, b) => b.r.venteTTC - a.r.venteTTC).slice(0, 10)
      .map(x => [cT(x.v.oeuvre || x.v.numFacture), cT(x.v.artiste), cN(x.r.venteTTC), cN(x.r.marge), cP(x.r.tauxMarge)]);
    top("Top 10 — plus grosses ventes", parVente, ["Œuvre", "Artiste", "Vente TTC", "Marge HT", "% marge"]);
    const parTaux = vs.filter(x => x.r.venteHT > 0).sort((a, b) => b.r.tauxMarge - a.r.tauxMarge).slice(0, 10)
      .map(x => [cT(x.v.oeuvre || x.v.numFacture), cT(x.v.artiste), cP(x.r.tauxMarge), cN(x.r.venteTTC), cN(x.r.marge)]);
    top("Top 10 — plus gros taux de marge", parTaux, ["Œuvre", "Artiste", "% marge", "Vente TTC", "Marge HT"]);
    const art = {};
    vs.forEach(({ v, r }) => { const n = (v.artiste || "").trim() || "(non renseigné)"; art[n] = art[n] || { ca: 0, ht: 0, marge: 0, n: 0 }; art[n].ca += r.venteTTC; art[n].ht += r.venteHT; art[n].marge += r.marge; art[n].n++; });
    const parArt = Object.keys(art).map(k => ({ nom: k, ...art[k] })).sort((a, b) => b.ca - a.ca).slice(0, 15)
      .map(a => [cT(a.nom), { v: a.n, t: "n", s: 0 }, cN(a.ca), cN(a.marge), cP(a.ht ? a.marge / a.ht : 0)]);
    top("Top artistes (CA & marge)", parArt, ["Artiste", "Nb", "CA TTC", "Marge HT", "% marge"]);
    const reg = {};
    vs.forEach(({ r }) => { const c = r.tva.regime ? r.tva.regime.label : "?"; reg[c] = reg[c] || { ca: 0, n: 0 }; reg[c].ca += r.venteTTC; reg[c].n++; });
    const parReg = Object.keys(reg).sort((a, b) => reg[b].ca - reg[a].ca)
      .map(k => [cT(k), { v: reg[k].n, t: "n", s: 0 }, cN(reg[k].ca), cP(caTTC ? reg[k].ca / caTTC : 0)]);
    top("Répartition du CA par régime de TVA", parReg, ["Régime", "Nb", "CA TTC", "Part"]);

    // --- Feuille Cadrage compta (3 volets) ---
    const rowsC = construireCadrageRows();

    const data = classeurXlsx([
      { nom: "Ventes", rows: rowsV },
      { nom: "Tableau de bord", rows: rowsD },
      { nom: "Cadrage compta", rows: rowsC }
    ]);
    const d = new Date().toISOString().slice(0, 10);
    télécharger("outil_tva_galerie_" + d + ".xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  // Construit les lignes de la feuille « Cadrage compta » (3 volets), alignées sur l'onglet Cadrage.
  function construireCadrageRows() {
    const rows = [[cT("CADRAGE AVEC LA BALANCE GÉNÉRALE", 1)], []];

    // A. CA par compte (classe 70)
    rows.push([cT("A. Cadrage du CA par compte (classe 70, HT)", 1)]);
    rows.push([cT("Compte", 1), cT("Libellé", 1), cT("CA HT outil", 1), cT("Solde BG (HT)", 1), cT("Écart BG − outil", 1)]);
    const caCpt = {};
    const addC = (c, lib, ht) => { caCpt[c] = caCpt[c] || { libelle: lib || (R.PLAN_COMPTES[c] || ""), ht: 0 }; caCpt[c].ht += ht; };
    ventesCadrage().forEach(v => caVentilation(v, addC));
    let totO = 0, totB = 0;
    Object.keys(caCpt).sort().forEach(c => {
      const r = caCpt[c], bg = soldeBG(c); totO += r.ht; totB += bg;
      rows.push([cT(c), cT(r.libelle), cN(r.ht), cN(bg), cN(bg - r.ht)]);
    });
    rows.push([cT("TOTAL classe 70", 1), cT(""), cN(totO), cN(totB), cN(totB - totO)]);
    rows.push([]);

    // B. TVA collectée
    rows.push([cT("B. Cadrage de la TVA collectée", 1)]);
    rows.push([cT("Indicateur", 1), cT("Montant", 1)]);
    let tvaO = 0; ventesCadrage().forEach(v => tvaO += R.calculerTVA(v).tva);
    const tvaB = R.CADRAGE.tvaCollectee.reduce((s, c) => s + soldeBG(c), 0);
    rows.push([cT("TVA collectée outil (toutes lignes)"), cN(tvaO)]);
    rows.push([cT("TVA collectée Balance (44571*)"), cN(tvaB)]);
    rows.push([cT("Écart BG − outil", 1), cN(tvaB - tvaO)]);
    rows.push([]);

    // C. Achats & coûts (classe 6)
    rows.push([cT("C. Cadrage des achats & coûts (classe 6)", 1)]);
    rows.push([cT("Poste", 1), cT("Comptes BG", 1), cT("Outil", 1), cT("Balance", 1), cT("Écart BG − outil", 1)]);
    const som = { achat: 0, frais: 0, commissions: 0, ds: 0, tf: 0 };
    ventesCadrage().forEach(v => {
      const vr = appliquerReferentiel(v);
      som.achat += R.num(v.achatTTC); som.frais += R.num(v.fraisAccessoiresHT); som.commissions += R.num(v.commissions);
      const ds = R.calculerDroitDeSuite(vr); if (ds.du) som.ds += ds.montant;
      const tf = R.calculerTaxeForfaitaire(vr); if (tf.du) som.tf += tf.montant;
    });
    R.CADRAGE.achats.forEach(g => {
      const o = som[g.cle], b = Math.abs(g.comptes.reduce((s, c) => s + soldeBG(c), 0));
      rows.push([cT(g.label), cT(g.comptes.join(", ")), cN(o), cN(b), cN(b - o)]);
    });
    return rows;
  }

  // Recharge l'historique d'origine embarqué (écrase les données courantes).
  function rechargerHistorique() {
    const seed = window.__HISTORIQUE_SEED__;
    if (!seed || !Array.isArray(seed.ventes) || !seed.ventes.length) { alert("Aucun historique embarqué dans cette version."); return; }
    if (!confirm("Recharger l'historique d'origine (" + seed.ventes.length + " ventes) ? Vos modifications en cours seront remplacées.")) return;
    state.ventes = JSON.parse(JSON.stringify(seed.ventes));
    state.compta = seed.compta || {};
    state.balanceBG = seed.balanceBG || {};
    state.artistes = {};
    recenserArtistes();
    save(); refreshAll(); switchView("ventes");
  }
  function importerFichier(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (file.name.endsWith(".json")) {
          const data = JSON.parse(reader.result);
          if (Array.isArray(data)) state.ventes = data;
          else { state.ventes = data.ventes || []; state.compta = data.compta || {}; state.balanceBG = data.balanceBG || {}; state.artistes = data.artistes || {}; }
        } else {
          importerCSV(reader.result);
        }
        // garantir un id
        state.ventes.forEach((v, i) => { if (!v.id) v.id = "v" + Date.now() + i; });
        if (!Object.keys(state.artistes).length) recenserArtistes();
        save(); refreshAll(); switchView("ventes");
        alert(state.ventes.length + " vente(s) importée(s).");
      } catch (e) { alert("Import impossible : " + e.message); }
    };
    reader.readAsText(file);
  }
  function importerCSV(text) {
    const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
    if (!lines.length) return;
    const sep = lines[0].indexOf(";") >= 0 ? ";" : ",";
    const headers = splitCSV(lines[0], sep).map(h => h.trim());
    const ventes = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCSV(lines[i], sep);
      const o = {}; headers.forEach((h, j) => o[h] = (cells[j] || "").trim());
      ventes.push(normaliserImport(o, i));
    }
    state.ventes = ventes;
  }
  function splitCSV(line, sep) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else { if (c === '"') q = true; else if (c === sep) { out.push(cur); cur = ""; } else cur += c; }
    }
    out.push(cur); return out;
  }
  // Mappe des en-têtes libres (ex. export de l'ancien Excel) vers notre modèle
  function normaliserImport(o, i) {
    const g = (...keys) => { for (const k of keys) { for (const kk in o) if (kk.toLowerCase().trim() === k.toLowerCase()) return o[kk]; } return ""; };
    return {
      id: "v" + Date.now() + i,
      ligneCompta: g("ligneCompta", "Ligne", "N° de ligne"),
      numFacture: g("numFacture", "N° Facture", "Facture"),
      dateFacture: normDate(g("dateFacture", "Date", "Date de facture")),
      artiste: g("artiste", "Artiste"),
      oeuvre: g("oeuvre", "Œuvre", "Nom œuvre", "Oeuvre"),
      refSiam: g("refSiam", "Référence SIAM", "Référence"),
      natureBien: g("natureBien") || "oeuvre_art",
      venteTTC: g("venteTTC", "Ventes TTC", "Montant Ventes TTC", "Vente TTC"),
      achatTTC: g("achatTTC", "Achats TTC", "Montant Achat TTC", "Achat TTC"),
      fraisAccessoiresHT: g("fraisAccessoiresHT", "Frais accessoires HT"),
      modeAcquisition: g("modeAcquisition") || "",
      client: g("client", "Client"),
      pays: g("pays", "Pays"),
      zone: g("zone") || devinerZone(g("Pays", "pays")),
      typeClient: mapTypeClient(g("typeClient", "Type client")),
      regimeChoisi: mapRegime(g("regimeChoisi", "Choix TVA", "Régime de TVA appliqué")),
      commentaire: g("commentaire", "Commentaire divers"),
      ds: {}, tf: {}
    };
  }
  function normDate(s) {
    if (!s) return "";
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
    const fr = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (fr) return fr[3] + "-" + fr[2].padStart(2, "0") + "-" + fr[1].padStart(2, "0");
    return "";
  }
  function devinerZone(pays) {
    if (!pays) return "FR";
    const p = pays.toLowerCase();
    if (p.includes("france") || p.includes("monaco")) return "FR"; // Monaco = territoire TVA français
    const ue = ["allemagne", "belgique", "espagne", "italie", "pays-bas", "luxembourg", "portugal", "autriche", "irlande", "grèce", "grece", "pologne", "suède", "suede", "danemark", "finlande", "tchèque", "tcheque", "tchéquie", "roumanie", "hongrie", "slovaquie", "slovénie", "slovenie", "croatie", "bulgarie", "lituanie", "lettonie", "estonie", "chypre", "malte"];
    if (ue.some(x => p.includes(x))) return "UE";
    return "HUE";
  }
  function mapTypeClient(s) { return /pro/i.test(s) ? "professionnel" : "particulier"; }
  function mapRegime(s) {
    if (!s) return "";
    const x = s.toLowerCase();
    if (x.includes("export")) return "EXPORT";
    if (x.includes("intra")) return "INTRACOM";
    if (x.includes("5,5") || x.includes("5.5")) return "DC_55";
    if (x.includes("20")) return "DC_20";
    if (x.includes("forfait")) return "MARGE_FORFAITAIRE";
    if (x.includes("marge")) return "MARGE";
    return "";
  }

  /* =================================================================
   *  JEU D'EXEMPLE
   * ================================================================= */
  function demo() {
    state.ventes = [
      { id: "d1", ligneCompta: "1", numFacture: "2509079", dateFacture: "2025-09-17", artiste: "Le Muy", oeuvre: "Forme à clé",
        natureBien: "oeuvre_art", modeAcquisition: "tva_reduit", venteTTC: 85000, achatTTC: 20655.92, zone: "FR", typeClient: "particulier",
        client: "Galerie X", pays: "France", regimeChoisi: "DC_55", ds: { premiereCession: false, artisteVivantOuMoins70: true, venteSoumiseFrance: true }, tf: {} },
      { id: "d2", ligneCompta: "2", numFacture: "2602003", dateFacture: "2026-02-10", artiste: "Penone", oeuvre: "Penduluum",
        natureBien: "oeuvre_art", modeAcquisition: "sans_tva", venteTTC: 170000, achatTTC: 153000, zone: "FR", typeClient: "particulier",
        client: "M. Dupont", pays: "France", regimeChoisi: "MARGE", ds: { premiereCession: false, artisteVivantOuMoins70: true, venteSoumiseFrance: true }, tf: {} },
      { id: "d3", ligneCompta: "3", numFacture: "2602009", dateFacture: "2026-02-21", artiste: "Lalanne", oeuvre: "Fauteuils crocodile",
        natureBien: "oeuvre_art", modeAcquisition: "sans_tva", venteTTC: 2333672.78, achatTTC: 2065760.03, zone: "HUE", typeClient: "particulier",
        client: "Collector Gstaad", pays: "Suisse", justificatifExport: false, regimeChoisi: "EXPORT",
        ds: { premiereCession: false, artisteVivantOuMoins70: true, venteSoumiseFrance: false }, tf: {} },
      { id: "d4", ligneCompta: "4", numFacture: "2603021", dateFacture: "2026-03-27", artiste: "Soulages", oeuvre: "Chute métallique",
        natureBien: "oeuvre_art", modeAcquisition: "tva_normale", venteTTC: 50000, achatTTC: 25000, zone: "UE", typeClient: "professionnel",
        client: "Galerie Berlin", pays: "Allemagne", numTvaIntra: "DE123456789", transportHorsFR: true, regimeChoisi: "INTRACOM",
        ds: { premiereCession: false, artisteVivantOuMoins70: false, venteSoumiseFrance: false }, tf: {} },
      { id: "d5", ligneCompta: "5", numFacture: "2603015", dateFacture: "2026-03-06", artiste: "Niki de Saint Phalle", oeuvre: "Attention Dragueur !",
        natureBien: "oeuvre_art", modeAcquisition: "sans_tva", venteTTC: 928, achatTTC: 150, zone: "FR", typeClient: "particulier",
        client: "Particulier vendeur", pays: "France", regimeChoisi: "MARGE_FORFAITAIRE",
        ds: { premiereCession: false, artisteVivantOuMoins70: false, venteSoumiseFrance: true },
        tf: { vendeurParticulier: true, typeObjet: "art", vendeurDomicilieFR: true } }
    ];
    save(); refreshAll(); switchView("ventes");
  }

  /* =================================================================
   *  ÉVÉNEMENTS
   * ================================================================= */
  function bind() {
    document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => switchView(b.getAttribute("data-view")));
    $("form-vente").onsubmit = (e) => {
      e.preventDefault();
      let v = lireFormulaire();
      const idx = state.ventes.findIndex(x => x.id === v.id);
      if (idx >= 0) { v = fusionnerReferences(v, state.ventes[idx]); state.ventes[idx] = v; }
      else state.ventes.push(v);
      save(); refreshAll(); resetFormulaire(); switchView("ventes");
    };
    $("btn-evaluer").onclick = () => { $("live-result").style.display = "block"; $("live-result-body").innerHTML = renderAnalyse(lireFormulaire()); };
    $("btn-reset").onclick = resetFormulaire;
    ["f-natureBien", "f-modeAcquisition", "f-zone", "f-typeClient", "f-venteTTC", "f-venteSurStock", "f-achats2026", "f-fraisAccessoiresHT", "f-commissions", "f-regimeChoisi", "f-optionDroitCommun"].forEach(id => {
      const e = $(id); if (e) e.addEventListener("change", () => { if ($("live-result").style.display !== "none") $("live-result-body").innerHTML = renderAnalyse(lireFormulaire()); });
    });
    $("btn-demo").onclick = demo;
    $("btn-reload-seed").onclick = rechargerHistorique;
    $("btn-clear").onclick = () => { if (confirm("Effacer toutes les ventes ?")) { state.ventes = []; state.compta = {}; save(); refreshAll(); } };
    $("btn-export-json").onclick = exportJSON;
    $("btn-export-csv").onclick = exportCSV;
    $("btn-export-xlsx").onclick = exportXLSX;
    $("btn-print").onclick = () => window.print();
    $("btn-import").onclick = () => $("file-input").click();
    $("file-input").onchange = (e) => { if (e.target.files[0]) importerFichier(e.target.files[0]); e.target.value = ""; };
    $("db-from").onchange = renderDashboard; $("db-to").onchange = renderDashboard;
    $("db-reset-period").onclick = () => { $("db-from").value = ""; $("db-to").value = ""; renderDashboard(); };
    ["sim-cout", "sim-achat-aupres", "sim-tva-recup", "sim-ds-eligible", "sim-taux",
      "sim-acquereur", "sim-lieu", "sim-transport", "sim-ttc-nego"].forEach(id => {
      const e = $(id); if (e) { e.addEventListener("input", renderSimulateur); e.addEventListener("change", renderSimulateur); }
    });
    $("btn-recenser").onclick = () => { const n = recenserArtistes(); save(); refreshAll(); alert(n + " artiste(s) ajouté(s) au référentiel."); };
    $("btn-art-add").onclick = () => {
      const nom = $("art-nom").value.trim();
      if (!nom) { alert("Indiquez le nom de l'artiste."); return; }
      const deces = $("art-deces").value.trim();
      state.artistes[nom] = {
        deces: deces, dds: deces ? ddsDepuisDeces(deces) : $("art-dds").value,
        organisme: $("art-organisme").value, tf: $("art-tf").value,
        typeObjet: $("art-typeObjet").value, note: $("art-note").value
      };
      save(); refreshAll(); $("art-nom").value = ""; $("art-note").value = ""; $("art-deces").value = "";
    };
  }

  /* ---------- Chargement initial de l'historique embarqué ----------
   * Au tout premier lancement (aucune donnée déjà enregistrée dans le
   * navigateur), on charge l'historique fourni dans historique_seed.js.
   * Une fois chargé, il est mémorisé localement : vos modifications
   * ultérieures sont conservées et le seed n'écrase plus rien. */
  function chargerSeedSiVide() {
    if (state.ventes && state.ventes.length) return;
    const seed = window.__HISTORIQUE_SEED__;
    if (seed && Array.isArray(seed.ventes) && seed.ventes.length) {
      state.ventes = seed.ventes;
      state.compta = seed.compta || {};
      state.balanceBG = seed.balanceBG || {};
      state.artistes = seed.artistes || {};
      save();
    }
    // Référentiel artistes : recensement initial si vide.
    if (state.ventes.length && !Object.keys(state.artistes).length) {
      recenserArtistes(); save();
    }
  }

  /* ---------- Boot ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    initListes(); load(); chargerSeedSiVide(); bind(); refreshAll();
  });
})();
