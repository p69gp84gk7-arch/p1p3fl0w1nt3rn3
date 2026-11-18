import type { Network } from '../model/types';
import { emptyNetwork, makeNode } from '../model/defaults';
import type { ElevationSource } from './elevation';

const NET_KEY = 'pipeflow-neige:reseau';
const SETTINGS_KEY = 'pipeflow-neige:reglages';

/** Informations affichables dans la bulle d'un point. */
export type NodeLabelField = 'nom' | 'altitude' | 'pression' | 'pression_vanne' | 'marge' | 'pression_min' | 'vitesse' | 'debit' | 'charge' | 'modele' | 'couronnes' | 'secteur';
/** Informations affichables sur une canalisation. */
export type PipeLabelField = 'vitesse' | 'debit' | 'dn' | 'perte' | 'pression' | 'nom';

export interface Settings {
  /** URL de l'application Web Apps Script liée à la base Google Sheets. */
  sheetsUrl: string;
  /** Clé facultative partagée avec le script (propriété API_KEY). */
  apiKey: string;
  elevationSource: ElevationSource;
  baseLayer: string;
  /** Superposer les pistes de ski (OpenSnowMap). */
  showPistes: boolean;
  /** Lien du classeur Google Sheets (pour l'ouvrir depuis l'application). */
  sheetLink: string;
  /** Contenu des bulles des points. */
  nodeLabels: NodeLabelField[];
  /** Types de points qui portent une bulle. */
  labelGuns: boolean;
  labelOthers: boolean;
  labelJunctions: boolean;
  /** Afficher les bulles même en vue éloignée. */
  labelsAlways: boolean;
  /** Étiquettes des canalisations. */
  pipeLabels: PipeLabelField[];
  /** Panneau « Affichage & légende » déplié. */
  legendOpen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sheetsUrl: '',
  apiKey: '',
  elevationSource: 'auto',
  baseLayer: 'ign-plan',
  showPistes: false,
  sheetLink: '',
  nodeLabels: ['nom', 'pression', 'pression_vanne'],
  labelGuns: true,
  labelOthers: true,
  labelJunctions: false,
  labelsAlways: false,
  pipeLabels: ['vitesse'],
  legendOpen: true,
};

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* stockage indisponible : on ignore */
  }
}

export function loadLocalNetwork(): Network | null {
  const raw = safeGet(NET_KEY);
  if (!raw) return null;
  try {
    return normalizeNetwork(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveLocalNetwork(net: Network) {
  safeSet(NET_KEY, JSON.stringify(net));
}

const PRISTINE_KEY = 'pipeflow-neige:reference-intacte';
const SOURCE_KEY = 'pipeflow-neige:source';
const DIRTY_KEY = 'pipeflow-neige:modifs-non-enregistrees';

/** Origine du réseau affiché : réseau de la station, Google Sheets ou fichier importé. */
export type NetworkSource = 'reference' | 'sheets' | 'fichier';
export function getSource(): NetworkSource | null {
  return safeGet(SOURCE_KEY) as NetworkSource | null;
}
export function setSource(s: NetworkSource) {
  safeSet(SOURCE_KEY, s);
}
/** Des modifications faites sur cet appareil n'ont pas encore été enregistrées dans Google Sheets. */
export function hasUnsavedChanges(): boolean {
  return safeGet(DIRTY_KEY) === '1';
}
export function setUnsavedChanges(v: boolean) {
  safeSet(DIRTY_KEY, v ? '1' : '0');
}

/** Le réseau de la station n'a pas été modifié sur cet appareil depuis son chargement. */
export function isReferencePristine(): boolean {
  return safeGet(PRISTINE_KEY) === '1';
}
export function setReferencePristine(v: boolean) {
  safeSet(PRISTINE_KEY, v ? '1' : '0');
}

export function loadSettings(): Settings {
  const raw = safeGet(SETTINGS_KEY);
  try {
    const s: Settings & { v?: number } = { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
    // v2 : ajout de la pression à la vanne à côté de la pression au regard.
    if ((s.v ?? 1) < 2) {
      if (s.nodeLabels.includes('pression') && !s.nodeLabels.includes('pression_vanne')) s.nodeLabels = [...s.nodeLabels, 'pression_vanne'];
      s.v = 2;
    }
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  safeSet(SETTINGS_KEY, JSON.stringify(s));
}

/** Complète un réseau partiel (fichier JSON, ancienne version…). */
export function normalizeNetwork(n: Partial<Network>): Network {
  const e = emptyNetwork();
  return {
    nodes: (n.nodes ?? []).map((x) => ({ ...makeNode(x.type ?? 'jonction', 0, 0, e.params), ...x })),
    pipes: (n.pipes ?? []).map((p) => ({ ...p, calque: p.calque ?? 'existant', geometrie: p.geometrie ?? [], diametre_estime: p.diametre_estime ?? false })),
    calques: n.calques?.length ? n.calques : e.calques,
    catalogue: n.catalogue?.length ? n.catalogue : e.catalogue,
    modeles: (n.modeles?.length ? n.modeles : e.modeles).map((m) => ({ ...m, pression_regulation_bar: m.pression_regulation_bar ?? 0 })),
    scenarios: n.scenarios ?? [],
    params: { ...e.params, ...(n.params ?? {}) },
  };
}

export function downloadFile(name: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
