import type { Network } from '../model/types';
import { emptyNetwork, makeNode } from '../model/defaults';
import type { ElevationSource } from './elevation';

const NET_KEY = 'pipeflow-neige:reseau';
const SETTINGS_KEY = 'pipeflow-neige:reglages';

/** Informations affichables dans la bulle d'un point. */
export type NodeLabelField = 'nom' | 'altitude' | 'pression' | 'marge' | 'pression_min' | 'vitesse' | 'debit' | 'charge' | 'modele' | 'couronnes' | 'secteur';
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
  nodeLabels: ['nom', 'pression'],
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

export function loadSettings(): Settings {
  const raw = safeGet(SETTINGS_KEY);
  try {
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
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
  const node0 = makeNode('jonction', 0, 0, e.params);
  return {
    nodes: (n.nodes ?? []).map((x) => ({ ...node0, ...x })),
    pipes: (n.pipes ?? []).map((p) => ({ ...p, calque: p.calque ?? 'existant', geometrie: p.geometrie ?? [] })),
    calques: n.calques?.length ? n.calques : e.calques,
    catalogue: n.catalogue?.length ? n.catalogue : e.catalogue,
    modeles: n.modeles?.length ? n.modeles : e.modeles,
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
