// Réseau de référence de la station, construit à partir des fichiers
// fournis (public/data/) : canalisations.kmz, canons.kmz, debits-canons.csv.

import { buildNetwork, defaultImportChoices, mergeKml, withPointOverrides, type KmlContent } from '../import/kmz';
import { applyFlowTable, readFlowTable } from '../import/csv';
import { applyMinPressures, DEFAULT_MODELES, emptyNetwork } from '../model/defaults';
import { calibrateSource } from '../hydraulics/calage';
import { allOpenNetwork, calibrateUniform, candidateSpecs, withUniformSpec } from '../hydraulics/diametres';
import type { Network } from '../model/types';

export const REFERENCE_FILES = {
  kmz: ['data/canalisations.kmz', 'data/canons.kmz'],
  csv: 'data/debits-canons.csv',
};

export const REFERENCE_NAME = 'Réseau neige – référence';
/** À incrémenter à chaque évolution du réseau de référence. */
export const REFERENCE_VERSION = '2026-11-19.1';

/** Construit le réseau à partir des fichiers (sans les altitudes). */
export function buildReferenceNetwork(kmls: KmlContent[], csvText: string): Network {
  const kml = mergeKml(kmls);
  const net = emptyNetwork();
  net.params.nom_projet = REFERENCE_NAME;
  net.params.reference_version = REFERENCE_VERSION;
  const d = defaultImportChoices(kml);
  const { kml: kml2, categoryTypes, categoryModels } = withPointOverrides(kml, d.catTypes, d.catModels, d.pointTypes);
  const res = buildNetwork(kml2, {
    categoryTypes,
    categoryModels,
    folderSpecs: {},
    detectDn: true,
    tolerance_m: net.params.tolerance_accrochage_m,
    params: net.params,
    catalogue: net.catalogue,
    calque: 'existant',
  });
  let out: Network = { ...net, nodes: res.nodes, pipes: res.pipes };
  const models = [...out.modeles];
  for (const n of out.nodes) {
    if (n.type === 'enneigeur' && n.modele && !models.some((m) => m.modele === n.modele)) models.push({ ...DEFAULT_MODELES[0], modele: n.modele });
  }
  out = { ...out, modeles: models };
  const f = applyFlowTable(out, readFlowTable(csvText), 'c1+c2+c3');
  out = { ...out, nodes: f.nodes, modeles: f.modeles };
  // Noms explicites pour l'usine et le booster
  out.nodes = out.nodes.map((n) => {
    if (n.type === 'salle_machines') return { ...n, notes: n.notes || 'Pression de refoulement et débit maximal à renseigner.' };
    if (n.type === 'surpresseur') return { ...n, notes: n.notes || 'Pression de refoulement et débit maximal à renseigner.' };
    return n;
  });
  // Pressions mini : rubis 18 bar, canons BP 8 bar, autres modèles 12 bar.
  // Rubis et Revo : 18 bar mini, vanne régulée à 45 bar.
  const regulated = (m: string) => ['rubis', 'revo'].includes(m.toLowerCase());
  out.modeles = out.modeles.map((m) => (regulated(m.modele) ? { ...m, pression_min_bar: 18, pression_regulation_bar: 45 } : m));
  out.modeles = out.modeles.map((m) =>
    DEFAULT_MODELES.some((d) => d.modele === m.modele) || regulated(m.modele) ? m : { ...m, pression_min_bar: out.params.pression_min_defaut_bar },
  );
  // Abris de sectionnement : vannes (ouvertes), pas des canons.
  out.nodes = out.nodes.map((n) => (/sectionnement/i.test(n.notes) && n.type === 'enneigeur' ? { ...n, type: 'vanne' as const, actif: true, modele: '', debit_m3h: 0 } : n));
  out = applyMinPressures(out);
  // Pompage en service par défaut.
  out.nodes = out.nodes.map((n) => (n.type === 'salle_machines' || n.type === 'surpresseur' ? { ...n, en_marche: true } : n));

  // État initial : canons à l'arrêt ; un scénario par piste (C1+C2+C3) et un
  // scénario « toutes pistes » en C1.
  out.nodes = out.nodes.map((n) => (n.type === 'enneigeur' || n.type === 'regard' ? { ...n, actif: false } : n));
  const guns = out.nodes.filter((n) => n.type === 'enneigeur');
  const secteurs = [...new Set(guns.map((n) => n.secteur).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const hasStage = (n: (typeof guns)[number], c: 'c1' | 'c1+c2+c3') => (c === 'c1' ? n.debit_c1 > 0 : n.debit_c1c2c3 > 0);
  out.scenarios = [
    {
      nom: 'Toutes pistes – C1',
      entries: guns.map((n) => ({ noeud_id: n.id, actif: true, debit_m3h: n.debit_m3h, couronnes: hasStage(n, 'c1') ? 'c1' : n.couronnes })),
    },
    ...secteurs.map((s) => ({
      nom: `Piste ${s} – C1+C2+C3`,
      entries: guns.map((n) => ({ noeud_id: n.id, actif: n.secteur === s, debit_m3h: n.debit_m3h, couronnes: hasStage(n, 'c1+c2+c3') ? ('c1+c2+c3' as const) : n.couronnes })),
    })),
  ];
  return out;
}

/**
 * Calage de l'usine (une fois les altitudes connues) : 15 bar à l'arrivée du
 * booster, réseau chargé et canons fermés (valeur relevée sur l'installation).
 */
export function calibrateReference(net: Network): Network {
  const sdm = net.nodes.find((n) => n.type === 'salle_machines');
  const booster = net.nodes.find((n) => n.type === 'surpresseur');
  if (!sdm || !booster) return net;
  const c = calibrateSource(net, sdm.id, booster.id, net.params.calage_pression_bar);
  if (!c.ok) return net;
  return {
    ...net,
    params: { ...net.params, calage_noeud: booster.id },
    nodes: net.nodes.map((n) =>
      n.id === sdm.id ? { ...n, pression_consigne_bar: c.consigne, notes: `Pression calée pour ${net.params.calage_pression_bar} bar à l’arrivée du booster (canons fermés). Débit maximal à renseigner.` } : n,
    ),
  };
}

/** Mesure relevée sur l'installation : au canon 122, tout ouvert, 15 à 17 bar. */
export const MESURE_DIAMETRES = { canon: '122', pression_bar: 16 };

/**
 * Diamètres inconnus (absents des KMZ) : on retient le diamètre de fonte
 * ductile qui redonne la pression mesurée au canon 122, tous canons ouverts.
 */
export function calibrateReferenceDiameters(net: Network): Network {
  const node = net.nodes.find((n) => n.nom === MESURE_DIAMETRES.canon);
  if (!node) return net;
  const specs = candidateSpecs(net.catalogue, 'Fonte ductile', 64);
  const trials = calibrateUniform(net, allOpenNetwork, node.id, specs, () => true);
  const best = trials.filter((t) => Number.isFinite(t.pression)).sort((a, b) => Math.abs(a.pression - MESURE_DIAMETRES.pression_bar) - Math.abs(b.pression - MESURE_DIAMETRES.pression_bar))[0];
  if (!best) return net;
  const out = withUniformSpec(net, best.spec, () => true);
  return {
    ...out,
    pipes: out.pipes.map((p) => ({ ...p, notes: p.notes || `Diamètre estimé (DN${best.spec.dn}) par calage : ${MESURE_DIAMETRES.pression_bar} bar au canon ${MESURE_DIAMETRES.canon}, tout ouvert. À confirmer.` })),
  };
}
