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
    "François-Xavier Lalanne": { dds: "oui", note: "décédé 2008 (≤ 70 ans)" },
    "Claude Lalanne": { dds: "oui", note: "décédée 2019" },
    "Les Lalanne": { dds: "oui", note: "≤ 70 ans" },
    "Niki de Saint Phalle": { dds: "oui", note: "décédée 2002" },
    "Robert Morris": { dds: "oui", note: "décédé 2018" },
    "Fred Sandback": { dds: "oui", note: "décédé 2003" },
    "Donald Judd Furniture": { dds: "oui", note: "Donald Judd, décédé 1994" },
    "Ron Gorchov": { dds: "oui", note: "décédé 2020" },
    "Roberto Matta": { dds: "oui", note: "décédé 2002" }
  };

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
        dds: connu.dds || "oui",
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
  function evaluer(v0) {
    const v = appliquerReferentiel(v0);
    const tva = R.calculerTVA(v);
    const ds = R.calculerDroitDeSuite(v);
    const tf = R.calculerTaxeForfaitaire(v);
    const ctrl = R.controlerLigne(v, tva);
    const venteTTC = R.num(v.venteTTC), achatTTC = R.num(v.achatTTC);
    const frais = R.num(v.fraisAccessoiresHT), commissions = R.num(v.commissions);
    // Marge économique HT = Ventes HT - achats (stock + achats) - frais accessoires - commissions.
    // Ventes HT = TTC - TVA collectée (cohérent quel que soit le régime).
    const venteHT = R.r2(venteTTC - tva.tva);
    const marge = R.r2(venteHT - achatTTC - frais - commissions);
    const tauxMarge = venteHT ? marge / venteHT : 0;
    const alertes = [].concat(tva.alertes, ds.alertes, tf.alertes, ctrl);
    return { tva, ds, tf, alertes, marge, tauxMarge, venteTTC, venteHT, achatTTC, frais, commissions };
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
      achatTTC: $("f-achatTTC").value,
      fraisAccessoiresHT: $("f-fraisAccessoiresHT").value,
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
    ["commissions", "regimeSource", "exercice", "htCompta", "tvaCompta", "compteRef",
      "venteSurStock", "achats2026", "margeBaseRef"].forEach(k => {
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
    $("f-achatTTC").value = v.achatTTC || "";
    $("f-fraisAccessoiresHT").value = v.fraisAccessoiresHT || "";
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
  function resetFormulaire() { $("form-vente").reset(); $("f-id").value = ""; $("live-result").style.display = "none"; }

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
  function renderVentes() {
    const wrap = $("ventes-table");
    if (!state.ventes.length) { wrap.innerHTML = '<div class="empty">Aucune vente. Saisissez-en une (onglet 1) ou chargez un jeu d\'exemple.</div>'; return; }
    let h = '<div class="table-wrap"><table><thead><tr>' +
      '<th>Ligne</th><th>Facture</th><th>Date</th><th>Artiste</th><th>Œuvre</th>' +
      '<th class="num">Vente TTC</th><th class="num">Achat</th><th class="num">Frais</th><th class="num">Comm.</th><th class="num">Marge HT</th><th class="num">% marge</th>' +
      '<th>Régime</th><th class="num">HT (réf. compta)</th><th class="num">TVA (réf. compta)</th>' +
      '<th class="num">Base HT (outil)</th><th class="num">TVA (outil)</th><th class="num">Écart TVA</th><th>DS</th><th>TF</th><th>!</th><th></th></tr></thead><tbody>';
    state.ventes.forEach(v => {
      const r = evaluer(v);
      const nbA = r.alertes.length;
      const nbDanger = r.alertes.filter(a => a.niveau === "danger").length;
      const htRef = v.htCompta === "" || v.htCompta == null ? null : R.num(v.htCompta);
      const tvaRef = v.tvaCompta === "" || v.tvaCompta == null ? null : R.num(v.tvaCompta);
      const ecartTVA = tvaRef == null ? null : R.r2(r.tva.tva - tvaRef);
      h += '<tr>';
      h += '<td>' + esc(v.ligneCompta) + '</td><td>' + esc(v.numFacture) + '</td><td>' + esc(v.dateFacture) + '</td>';
      h += '<td>' + esc(v.artiste) + '</td><td>' + esc(v.oeuvre) + '</td>';
      h += '<td class="num">' + fmt(r.venteTTC) + '</td><td class="num">' + fmt(r.achatTTC) + '</td>';
      h += '<td class="num">' + fmt(r.frais) + '</td><td class="num">' + fmt(r.commissions) + '</td>';
      h += '<td class="num">' + fmt(r.marge) + '</td><td class="num">' + pct(r.tauxMarge) + '</td>';
      h += '<td><span class="tag ' + (r.tva.regime ? r.tva.regime.code : "") + '">' + esc(r.tva.regime ? r.tva.regime.label : "?") + '</span></td>';
      h += '<td class="num">' + (htRef == null ? "—" : fmt(htRef)) + '</td><td class="num">' + (tvaRef == null ? "—" : fmt(tvaRef)) + '</td>';
      h += '<td class="num">' + fmt(r.tva.baseHT) + '</td><td class="num">' + fmt(r.tva.tva) + '</td>';
      h += '<td class="num">' + (ecartTVA == null ? "" : '<span class="' + (Math.abs(ecartTVA) < 1 ? "ecart-ok" : "ecart-ko") + '">' + fmt(ecartTVA) + '</span>') + '</td>';
      h += '<td class="num">' + (r.ds.du ? fmt(r.ds.montant) : "—") + '</td>';
      h += '<td class="num">' + (r.tf.du ? fmt(r.tf.montant) : "—") + '</td>';
      h += '<td>' + (nbA ? '<span class="dot ' + (nbDanger ? "danger" : "warn") + '"></span>' + nbA : "") + '</td>';
      h += '<td><button class="btn small secondary" data-edit="' + v.id + '">Éditer</button> ' +
        '<button class="btn small danger" data-del="' + v.id + '">×</button></td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    wrap.innerHTML = h;
    wrap.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editVente(b.getAttribute("data-edit")));
    wrap.querySelectorAll("[data-del]").forEach(b => b.onclick = () => delVente(b.getAttribute("data-del")));
  }
  function editVente(id) {
    const v = state.ventes.find(x => x.id === id); if (!v) return;
    ecrireFormulaire(v); switchView("saisie");
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
    state.ventes.forEach(v => {
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
      '<th class="num">Prix vente</th><th>Dû ?</th><th class="num">Montant</th><th>Motif</th></tr></thead><tbody>';
    let total = 0, n = 0;
    state.ventes.forEach(v => {
      const ds = R.calculerDroitDeSuite(v);
      if (ds.du) { total += ds.montant; n++; }
      h += '<tr><td>' + esc(v.numFacture) + '</td><td>' + esc(v.artiste) + '</td><td>' + esc(v.oeuvre) + '</td>' +
        '<td class="num">' + fmt(R.num(v.venteTTC)) + '</td>' +
        '<td>' + (ds.du ? '<span class="dot ok"></span>Oui' : "Non") + '</td>' +
        '<td class="num">' + (ds.du ? fmt(ds.montant) : "—") + '</td><td>' + esc(ds.motif) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="5">TOTAL droit de suite (' + n + ' œuvre(s))</td><td class="num">' + fmt(total) + '</td><td></td></tr></tfoot></table></div>';
    if (!state.ventes.length) h = '<div class="empty">Aucune donnée.</div>';
    $("ds-table").innerHTML = h;
  }

  /* =================================================================
   *  TAXE FORFAITAIRE
   * ================================================================= */
  function renderTF() {
    let h = '<div class="table-wrap"><table><thead><tr><th>Facture</th><th>Vendeur</th><th>Œuvre</th>' +
      '<th class="num">Assiette</th><th class="num">Taux</th><th class="num">Montant</th><th>Statut</th></tr></thead><tbody>';
    let total = 0, n = 0;
    state.ventes.forEach(v => {
      const tf = R.calculerTaxeForfaitaire(v);
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
  // CA HT "comptable" d'une vente (base imposable + part non imposable + montant exonéré).
  function caHTComptable(t, v) {
    const exo = t.regime && (t.regime.code === "EXPORT" || t.regime.code === "INTRACOM");
    return t.baseHT + (t.partNonImposable || 0) + (exo ? R.num(v.venteTTC) : 0);
  }
  const soldeBG = (c) => R.num(state.balanceBG[c]);
  const ecartCell = (e) => '<span class="' + (Math.abs(e) < 1 ? "ecart-ok" : "ecart-ko") + '">' + fmt(e) + '</span>';

  function renderCadrage() {
    if (!state.ventes.length) { $("cadrage-table").innerHTML = '<div class="empty">Aucune donnée.</div>'; return; }

    /* --- Volet A : CA classe 70 par compte --- */
    const caCpt = {};
    state.ventes.forEach(v => {
      const t = R.calculerTVA(v);
      const c = t.compte || "—";
      caCpt[c] = caCpt[c] || { libelle: t.libelleCompte || "", ht: 0, tva: 0 };
      caCpt[c].ht += caHTComptable(t, v); caCpt[c].tva += t.tva;
    });
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
    let tvaO = 0; state.ventes.forEach(v => tvaO += R.calculerTVA(v).tva);
    const tvaB = R.CADRAGE.tvaCollectee.reduce((s, c) => s + soldeBG(c), 0);
    let hB = '<div class="table-wrap"><table><thead><tr><th>Indicateur</th><th class="num">Montant</th></tr></thead><tbody>' +
      '<tr><td>TVA collectée outil (toutes lignes)</td><td class="num">' + fmt(tvaO) + '</td></tr>' +
      '<tr><td>TVA collectée Balance (comptes ' + R.CADRAGE.tvaCollectee.join(", ") + ')</td><td class="num">' + fmt(tvaB) + '</td></tr>' +
      '<tr><td><b>Écart BG − outil</b></td><td class="num">' + ecartCell(R.r2(tvaB - tvaO)) + '</td></tr>' +
      '</tbody></table></div>';

    /* --- Volet C : achats & coûts (classe 6) --- */
    const som = { achat: 0, frais: 0, commissions: 0, ds: 0, tf: 0 };
    state.ventes.forEach(v => {
      som.achat += R.num(v.achatTTC); som.frais += R.num(v.fraisAccessoiresHT); som.commissions += R.num(v.commissions);
      const ds = R.calculerDroitDeSuite(v); if (ds.du) som.ds += ds.montant;
      const tf = R.calculerTaxeForfaitaire(v); if (tf.du) som.tf += tf.montant;
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
    const vs = ventesFiltrees().map(v => ({ v, r: evaluer(v) }));
    let caTTC = 0, caHT = 0, achats = 0, marge = 0, tva = 0;
    vs.forEach(({ v, r }) => {
      caTTC += r.venteTTC; achats += r.achatTTC; marge += r.marge; tva += r.tva.tva;
      caHT += r.venteHT;
    });
    const tauxMargeGlobal = caHT ? marge / caHT : 0;
    $("db-kpi").innerHTML =
      kpi(fmt0(caTTC) + " €", "Chiffre d'affaires (TTC)") +
      kpi(fmt0(caHT) + " €", "CA HT") +
      kpi(fmt0(marge) + " €", "Marge HT (nette de comm.)") +
      kpi(pct(tauxMargeGlobal), "Taux de marge moyen") +
      kpi(fmt0(tva) + " €", "TVA collectée") +
      kpi(vs.length, "Nombre de ventes");

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
      '<th>Droit de suite éligible</th><th>Taxe forf. (défaut)</th><th>Type objet</th><th>Note</th><th></th></tr></thead><tbody>';
    noms.forEach(nom => {
      const a = state.artistes[nom], s = stat[nom] || { n: 0, ca: 0 };
      h += '<tr><td>' + esc(nom) + '</td><td class="num">' + s.n + '</td><td class="num">' + fmt0(s.ca) + '</td>' +
        '<td>' + selArt(nom, "dds", a.dds, [["oui", "Oui"], ["non", "Non (+70 ans)"], ["", "—"]]) + '</td>' +
        '<td>' + selArt(nom, "tf", a.tf, [["", "—"], ["non", "Non applicable"], ["oui", "Applicable"]]) + '</td>' +
        '<td>' + selArt(nom, "typeObjet", a.typeObjet || "art", [["art", "Objet d'art"], ["metaux", "Métaux précieux"]]) + '</td>' +
        '<td><input data-art="' + esc(nom) + '" data-champ="note" value="' + esc(a.note || "") + '" style="min-width:160px"></td>' +
        '<td><button class="btn small danger" data-artdel="' + esc(nom) + '">×</button></td></tr>';
    });
    h += '</tbody></table></div>';
    $("artistes-table").innerHTML = h;
    $("artistes-table").querySelectorAll("[data-art]").forEach(elm => {
      elm.onchange = () => {
        const nom = elm.getAttribute("data-art"), champ = elm.getAttribute("data-champ");
        if (state.artistes[nom]) { state.artistes[nom][champ] = elm.value; save(); refreshAll(); }
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
    renderVentes(); renderTVA(); renderDS(); renderTF(); renderCadrage(); renderControles(); renderDashboard(); renderArtistes();
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
    state.ventes.forEach(v => {
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
    if (p.includes("france")) return "FR";
    const ue = ["allemagne", "belgique", "espagne", "italie", "pays-bas", "luxembourg", "portugal", "autriche", "irlande", "grèce", "pologne", "suède", "danemark", "finlande"];
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
    ["f-natureBien", "f-modeAcquisition", "f-zone", "f-typeClient", "f-venteTTC", "f-achatTTC", "f-regimeChoisi", "f-optionDroitCommun"].forEach(id => {
      const e = $(id); if (e) e.addEventListener("change", () => { if ($("live-result").style.display !== "none") $("live-result-body").innerHTML = renderAnalyse(lireFormulaire()); });
    });
    $("btn-demo").onclick = demo;
    $("btn-clear").onclick = () => { if (confirm("Effacer toutes les ventes ?")) { state.ventes = []; state.compta = {}; save(); refreshAll(); } };
    $("btn-export-json").onclick = exportJSON;
    $("btn-export-csv").onclick = exportCSV;
    $("btn-print").onclick = () => window.print();
    $("btn-import").onclick = () => $("file-input").click();
    $("file-input").onchange = (e) => { if (e.target.files[0]) importerFichier(e.target.files[0]); e.target.value = ""; };
    $("db-from").onchange = renderDashboard; $("db-to").onchange = renderDashboard;
    $("db-reset-period").onclick = () => { $("db-from").value = ""; $("db-to").value = ""; renderDashboard(); };
    $("btn-recenser").onclick = () => { const n = recenserArtistes(); save(); refreshAll(); alert(n + " artiste(s) ajouté(s) au référentiel."); };
    $("btn-art-add").onclick = () => {
      const nom = $("art-nom").value.trim();
      if (!nom) { alert("Indiquez le nom de l'artiste."); return; }
      state.artistes[nom] = { dds: $("art-dds").value, tf: $("art-tf").value, typeObjet: $("art-typeObjet").value, note: $("art-note").value };
      save(); refreshAll(); $("art-nom").value = ""; $("art-note").value = "";
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
