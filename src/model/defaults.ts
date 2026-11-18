import type { GunModel, Layer, Network, NetNode, NodeType, Params, Pipe, PipeSpec } from './types';
import { newId } from './ids';

export const DEFAULT_PARAMS: Params = {
  nom_projet: 'Mon réseau neige',
  temperature_eau_c: 2,
  vitesse_max_m_s: 3,
  marge_pn_pct: 0,
  debit_defaut_m3h: 30,
  pression_min_defaut_bar: 12,
  tolerance_accrochage_m: 15,
  scenario_actif: '',
};

export const DEFAULT_CATALOGUE: PipeSpec[] = [
  { ref: 'FD80-C64', materiau: 'Fonte ductile', dn: 80, pn_bar: 64, diametre_int_mm: 81, rugosite_mm: 0.1 },
  { ref: 'FD100-C64', materiau: 'Fonte ductile', dn: 100, pn_bar: 64, diametre_int_mm: 101, rugosite_mm: 0.1 },
  { ref: 'FD125-C64', materiau: 'Fonte ductile', dn: 125, pn_bar: 64, diametre_int_mm: 126, rugosite_mm: 0.1 },
  { ref: 'FD150-C64', materiau: 'Fonte ductile', dn: 150, pn_bar: 64, diametre_int_mm: 151, rugosite_mm: 0.1 },
  { ref: 'FD200-C64', materiau: 'Fonte ductile', dn: 200, pn_bar: 64, diametre_int_mm: 202, rugosite_mm: 0.1 },
  { ref: 'FD250-C64', materiau: 'Fonte ductile', dn: 250, pn_bar: 64, diametre_int_mm: 252, rugosite_mm: 0.1 },
  { ref: 'FD300-C64', materiau: 'Fonte ductile', dn: 300, pn_bar: 64, diametre_int_mm: 302, rugosite_mm: 0.1 },
  { ref: 'FD100-C100', materiau: 'Fonte ductile', dn: 100, pn_bar: 100, diametre_int_mm: 99, rugosite_mm: 0.1 },
  { ref: 'FD150-C100', materiau: 'Fonte ductile', dn: 150, pn_bar: 100, diametre_int_mm: 148, rugosite_mm: 0.1 },
  { ref: 'FD200-C100', materiau: 'Fonte ductile', dn: 200, pn_bar: 100, diametre_int_mm: 198, rugosite_mm: 0.1 },
  { ref: 'AC80', materiau: 'Acier', dn: 80, pn_bar: 100, diametre_int_mm: 77.9, rugosite_mm: 0.05 },
  { ref: 'AC100', materiau: 'Acier', dn: 100, pn_bar: 100, diametre_int_mm: 102.3, rugosite_mm: 0.05 },
  { ref: 'AC125', materiau: 'Acier', dn: 125, pn_bar: 100, diametre_int_mm: 128.2, rugosite_mm: 0.05 },
  { ref: 'AC150', materiau: 'Acier', dn: 150, pn_bar: 100, diametre_int_mm: 154.1, rugosite_mm: 0.05 },
  { ref: 'AC200', materiau: 'Acier', dn: 200, pn_bar: 100, diametre_int_mm: 202.7, rugosite_mm: 0.05 },
  { ref: 'AC250', materiau: 'Acier', dn: 250, pn_bar: 100, diametre_int_mm: 254.5, rugosite_mm: 0.05 },
  { ref: 'AC300', materiau: 'Acier', dn: 300, pn_bar: 100, diametre_int_mm: 303.3, rugosite_mm: 0.05 },
  { ref: 'PE63-PN16', materiau: 'PEHD', dn: 63, pn_bar: 16, diametre_int_mm: 51.4, rugosite_mm: 0.01 },
  { ref: 'PE90-PN16', materiau: 'PEHD', dn: 90, pn_bar: 16, diametre_int_mm: 73.6, rugosite_mm: 0.01 },
  { ref: 'PE110-PN16', materiau: 'PEHD', dn: 110, pn_bar: 16, diametre_int_mm: 90, rugosite_mm: 0.01 },
  { ref: 'PE160-PN16', materiau: 'PEHD', dn: 160, pn_bar: 16, diametre_int_mm: 130.8, rugosite_mm: 0.01 },
  { ref: 'PE200-PN16', materiau: 'PEHD', dn: 200, pn_bar: 16, diametre_int_mm: 163.6, rugosite_mm: 0.01 },
  { ref: 'PE250-PN16', materiau: 'PEHD', dn: 250, pn_bar: 16, diametre_int_mm: 204.6, rugosite_mm: 0.01 },
  { ref: 'PE315-PN16', materiau: 'PEHD', dn: 315, pn_bar: 16, diametre_int_mm: 257.8, rugosite_mm: 0.01 },
];

export const DEFAULT_MODELES: GunModel[] = [
  { modele: 'Ventilateur standard', type: 'ventilateur', debit_nominal_m3h: 30, debit_min_m3h: 5, debit_max_m3h: 60, pression_min_bar: 10, pression_max_bar: 50, k_buse: 5 },
  { modele: 'Ventilateur grand débit', type: 'ventilateur', debit_nominal_m3h: 50, debit_min_m3h: 10, debit_max_m3h: 90, pression_min_bar: 12, pression_max_bar: 50, k_buse: 8 },
  { modele: 'Perche standard', type: 'perche', debit_nominal_m3h: 15, debit_min_m3h: 3, debit_max_m3h: 25, pression_min_bar: 20, pression_max_bar: 60, k_buse: 2.5 },
  { modele: 'Perche basse pression', type: 'perche', debit_nominal_m3h: 8, debit_min_m3h: 2, debit_max_m3h: 15, pression_min_bar: 12, pression_max_bar: 40, k_buse: 1.8 },
];

export const DEFAULT_LAYERS: Layer[] = [
  { id: 'existant', nom: 'Existant', couleur: '#1c5c9e', visible: true, calcul: true, verrouille: false, description: 'Réseau en service' },
  { id: 'projet', nom: 'Projet futur', couleur: '#d9822b', visible: true, calcul: false, verrouille: false, description: "Extensions à l'étude" },
];

export const LAYER_COLORS = ['#1c5c9e', '#d9822b', '#7b4fb8', '#2e8b57', '#c0392b', '#0f8fa3', '#8a6d3b', '#d6489a'];

export function emptyNetwork(): Network {
  return {
    nodes: [],
    pipes: [],
    calques: DEFAULT_LAYERS.map((l) => ({ ...l })),
    catalogue: DEFAULT_CATALOGUE.map((c) => ({ ...c })),
    modeles: DEFAULT_MODELES.map((m) => ({ ...m })),
    scenarios: [],
    params: { ...DEFAULT_PARAMS },
  };
}

export const NODE_PREFIX: Record<NodeType, string> = {
  enneigeur: 'E',
  jonction: 'J',
  regard: 'R',
  salle_machines: 'SM',
  surpresseur: 'B',
  vanne: 'V',
  reducteur: 'RP',
};

export const NODE_LABEL: Record<NodeType, string> = {
  enneigeur: 'Enneigeur',
  jonction: 'Jonction',
  regard: 'Regard',
  salle_machines: 'Salle des machines',
  surpresseur: 'Surpresseur (booster)',
  vanne: 'Vanne',
  reducteur: 'Réducteur de pression',
};

/** Ordre d'affichage des types. */
export const NODE_TYPES: NodeType[] = ['enneigeur', 'regard', 'jonction', 'vanne', 'reducteur', 'surpresseur', 'salle_machines'];

/** Types qui soutirent de l'eau. */
export const isConsumer = (t: NodeType) => t === 'enneigeur' || t === 'regard';
/** Types à pression de sortie régulée. */
export const isRegulator = (t: NodeType) => t === 'surpresseur' || t === 'reducteur';

const COURONNE_FIELD = { c1: 'debit_c1', 'c1+c2': 'debit_c1c2', 'c1+c3': 'debit_c1c3', 'c1+c2+c3': 'debit_c1c2c3' } as const;

/** Débit effectif (m³/h) d'un enneigeur selon l'étage de couronnes choisi. */
export function effectiveFlow(n: NetNode): number {
  if (n.couronnes) {
    const v = n[COURONNE_FIELD[n.couronnes]];
    if (v > 0) return v;
  }
  return n.debit_m3h;
}

export function couronneField(c: Exclude<NetNode['couronnes'], ''>) {
  return COURONNE_FIELD[c];
}

export function makeNode(type: NodeType, lat: number, lon: number, params: Params, extra: Partial<NetNode> = {}): NetNode {
  return {
    id: extra.id ?? newId(NODE_PREFIX[type]),
    type,
    nom: '',
    lat,
    lon,
    altitude_m: 0,
    modele: type === 'enneigeur' ? DEFAULT_MODELES[0].modele : '',
    debit_m3h: type === 'enneigeur' ? params.debit_defaut_m3h : 0,
    mode_debit: 'fixe',
    k_buse: type === 'enneigeur' ? DEFAULT_MODELES[0].k_buse : 0,
    pression_min_bar: type === 'enneigeur' ? params.pression_min_defaut_bar : 0,
    actif: type === 'enneigeur' || type === 'vanne',
    pression_consigne_bar: type === 'salle_machines' ? 40 : type === 'surpresseur' ? 50 : type === 'reducteur' ? 30 : 0,
    debit_max_m3h: type === 'salle_machines' ? 600 : type === 'surpresseur' ? 200 : 0,
    notes: '',
    calque: 'existant',
    aspiration: '',
    secteur: '',
    couronnes: '',
    debit_c1: 0,
    debit_c1c2: 0,
    debit_c1c3: 0,
    debit_c1c2c3: 0,
    air: 0,
    priorite: '',
    ...extra,
  };
}

export const DEFAULT_PIPE_SPEC = DEFAULT_CATALOGUE[3]; // Fonte DN150 C64

export function makePipe(amont: string, aval: string, spec: PipeSpec = DEFAULT_PIPE_SPEC, extra: Partial<Pipe> = {}): Pipe {
  return {
    id: extra.id ?? newId('C'),
    nom: '',
    amont,
    aval,
    longueur_m: 0,
    longueur_auto: true,
    dn: spec.dn,
    diametre_int_mm: spec.diametre_int_mm,
    materiau: spec.materiau,
    rugosite_mm: spec.rugosite_mm,
    pn_bar: spec.pn_bar,
    k_singulier: 0,
    statut: 'ouverte',
    geometrie: [],
    notes: '',
    calque: 'existant',
    ...extra,
  };
}
