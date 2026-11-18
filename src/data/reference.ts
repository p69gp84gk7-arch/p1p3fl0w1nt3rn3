// Réseau de référence de la station, construit à partir des fichiers
// fournis (public/data/) : canalisations.kmz, canons.kmz, debits-canons.csv.

import { buildNetwork, defaultImportChoices, mergeKml, withPointOverrides, type KmlContent } from '../import/kmz';
import { applyFlowTable, readFlowTable } from '../import/csv';
import { DEFAULT_MODELES, emptyNetwork } from '../model/defaults';
import type { Network } from '../model/types';

export const REFERENCE_FILES = {
  kmz: ['data/canalisations.kmz', 'data/canons.kmz'],
  csv: 'data/debits-canons.csv',
};

export const REFERENCE_NAME = 'Réseau neige – référence';

/** Construit le réseau à partir des fichiers (sans les altitudes). */
export function buildReferenceNetwork(kmls: KmlContent[], csvText: string): Network {
  const kml = mergeKml(kmls);
  const net = emptyNetwork();
  net.params.nom_projet = REFERENCE_NAME;
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
