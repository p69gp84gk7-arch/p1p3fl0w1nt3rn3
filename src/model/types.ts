// Modèle de données du réseau neige.
// Les noms de champs correspondent aux colonnes de la base Google Sheets
// (voir apps-script/Code.gs et src/services/sheets.ts).

export type NodeType =
  | 'enneigeur'
  | 'regard'
  | 'jonction'
  | 'vanne'
  | 'reducteur'
  | 'surpresseur'
  | 'salle_machines';

/** Étage de couronnes d'un enneigeur ('' = débit saisi manuellement). */
export type Couronnes = '' | 'c1' | 'c1+c2' | 'c1+c3' | 'c1+c2+c3';
export const COURONNES: Exclude<Couronnes, ''>[] = ['c1', 'c1+c2', 'c1+c3', 'c1+c2+c3'];

/** Mode de calcul du débit d'un enneigeur. */
export type FlowMode =
  /** Débit imposé (m³/h), indépendant de la pression. */
  | 'fixe'
  /** Débit fonction de la pression : Q = k · √P (buses). */
  | 'buse';

export interface NetNode {
  id: string;
  type: NodeType;
  nom: string;
  lat: number;
  lon: number;
  /** Altitude du terrain (m NGF). */
  altitude_m: number;
  /** Modèle d'enneigeur (référence vers Modeles_Enneigeurs). */
  modele: string;
  /** Débit demandé (m³/h) — enneigeurs et regards. */
  debit_m3h: number;
  mode_debit: FlowMode;
  /** Coefficient de buse k (m³/h / √bar) pour le mode « buse ». */
  k_buse: number;
  /** Pression minimale requise au nœud (bar). */
  pression_min_bar: number;
  /** Enneigeur en production / vanne ouverte. */
  actif: boolean;
  /** Salle des machines, surpresseur, réducteur : pression de consigne en sortie (bar). */
  pression_consigne_bar: number;
  /** Salle des machines / surpresseur : débit maximal des pompes (m³/h). */
  debit_max_m3h: number;
  notes: string;
  /** Calque (id) auquel appartient l'élément. */
  calque: string;
  /** Surpresseur / réducteur : id de la canalisation d'entrée (vide = automatique). */
  aspiration: string;
  /** Piste / secteur. */
  secteur: string;
  /** Étage de couronnes utilisé pour le débit ('' = débit_m3h). */
  couronnes: Couronnes;
  debit_c1: number;
  debit_c1c2: number;
  debit_c1c3: number;
  debit_c1c2c3: number;
  /** Débit d'air (information). */
  air: number;
  priorite: string;
  /** Salle des machines / surpresseur / réducteur : en service (sinon arrêt / by-pass). */
  en_marche: boolean;
}

export type PipeStatus = 'ouverte' | 'fermee';

/** Point de géométrie : [lat, lon, altitude (m) ou null si inconnue]. */
export type GeoPoint = [number, number, number | null];

export interface Pipe {
  id: string;
  nom: string;
  /** Nœud amont (id). */
  amont: string;
  /** Nœud aval (id). */
  aval: string;
  longueur_m: number;
  /** La longueur est recalculée depuis le tracé. */
  longueur_auto: boolean;
  dn: number;
  diametre_int_mm: number;
  materiau: string;
  rugosite_mm: number;
  pn_bar: number;
  /** Somme des coefficients de pertes de charge singulières (coudes, vannes…). */
  k_singulier: number;
  statut: PipeStatus;
  /** Tracé intermédiaire (sans les extrémités, qui sont les nœuds). */
  geometrie: GeoPoint[];
  notes: string;
  /** Calque (id) auquel appartient l'élément. */
  calque: string;
  /** Diamètre estimé (calage / dimensionnement), à confirmer sur le terrain. */
  diametre_estime: boolean;
}

/** Calque : regroupe des éléments (réseau existant, projets futurs…). */
export interface Layer {
  id: string;
  nom: string;
  couleur: string;
  /** Affiché sur la carte. */
  visible: boolean;
  /** Pris en compte dans le calcul hydraulique. */
  calcul: boolean;
  /** Protégé contre les modifications. */
  verrouille: boolean;
  description: string;
}

export interface PipeSpec {
  ref: string;
  materiau: string;
  dn: number;
  pn_bar: number;
  diametre_int_mm: number;
  rugosite_mm: number;
}

export interface GunModel {
  modele: string;
  type: string;
  debit_nominal_m3h: number;
  debit_min_m3h: number;
  debit_max_m3h: number;
  pression_min_bar: number;
  pression_max_bar: number;
  k_buse: number;
  /** Régulation de pression de la vanne du canon (bar, 0 = aucune). */
  pression_regulation_bar: number;
}

export interface ScenarioEntry {
  noeud_id: string;
  actif: boolean;
  debit_m3h: number;
  couronnes: Couronnes;
}

export interface Scenario {
  nom: string;
  entries: ScenarioEntry[];
}

export interface Params {
  nom_projet: string;
  temperature_eau_c: number;
  vitesse_max_m_s: number;
  marge_pn_pct: number;
  debit_defaut_m3h: number;
  pression_min_defaut_bar: number;
  tolerance_accrochage_m: number;
  scenario_actif: string;
  /** Pression minimale des canons marqués « BP » (basse pression), bar. */
  pression_min_bp_bar: number;
  /** Borne haute du curseur de pression des salles des machines, bar. */
  pression_max_curseur_bar: number;
  /** Version du réseau de référence intégré dont provient ce réseau ('' sinon). */
  reference_version: string;
  /** Calage : point de contrôle (id du nœud, '' = le booster). */
  calage_noeud: string;
  /** Calage : pression voulue au point de contrôle, réseau chargé et canons fermés (bar). */
  calage_pression_bar: number;
}

export interface Network {
  nodes: NetNode[];
  pipes: Pipe[];
  calques: Layer[];
  catalogue: PipeSpec[];
  modeles: GunModel[];
  scenarios: Scenario[];
  params: Params;
}

// ---------- Résultats de calcul ----------

export type ResultStatus = 'ok' | 'alerte' | 'erreur' | 'isole';

export interface NodeResult {
  id: string;
  /** Charge hydraulique (m). */
  charge_m: number;
  pression_bar: number;
  /** Débit soutiré (enneigeur) ou fourni (salle des machines), m³/h. */
  debit_m3h: number;
  /** Surpresseur : pression à l'aspiration (bar). */
  pression_aspiration_bar?: number;
  /** Canon : pression après la vanne régulée (bar) = min(pression au regard, régulation). */
  pression_vanne_bar?: number;
  /** Vitesse de l'eau dans la (les) canalisation(s) qui alimente(nt) le nœud (m/s, la plus forte). */
  vitesse_arrivee_m_s: number;
  /** Débit arrivant au nœud (m³/h). */
  debit_arrivee_m3h: number;
  statut: ResultStatus;
  messages: string[];
}

export interface PipeResult {
  id: string;
  /** Débit signé (m³/h), positif de l'amont vers l'aval. */
  debit_m3h: number;
  vitesse_m_s: number;
  perte_charge_m: number;
  perte_m_km: number;
  charge_amont_m: number;
  charge_aval_m: number;
  /** Pression maximale le long du tracé (bar). */
  pression_max_bar: number;
  /** Pression minimale le long du tracé (bar). */
  pression_min_bar: number;
  statut: ResultStatus;
  messages: string[];
}

export interface SolveResult {
  ok: boolean;
  iterations: number;
  converged: boolean;
  date: string;
  scenario: string;
  nodes: Record<string, NodeResult>;
  pipes: Record<string, PipeResult>;
  /** Messages globaux (erreurs de topologie, non-convergence…). */
  messages: string[];
  totals: {
    debit_total_m3h: number;
    enneigeurs_actifs: number;
    enneigeurs_ok: number;
    enneigeurs_insuffisants: number;
  };
}
