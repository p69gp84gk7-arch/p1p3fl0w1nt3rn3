// Liaison avec la base Google Sheets via l'application Web Apps Script
// (voir apps-script/Code.gs). Chaque onglet est échangé sous forme de
// tableau d'objets { colonne: valeur }.

import { emptyNetwork } from '../model/defaults';
import { NODE_TYPES } from '../model/defaults';
import type { Couronnes, GeoPoint, GunModel, Layer, Network, NetNode, Params, Pipe, PipeSpec, Scenario, SolveResult, NodeType, FlowMode } from '../model/types';
import type { Settings } from './storage';

type Row = Record<string, unknown>;

export const SHEETS = {
  nodes: 'Noeuds',
  pipes: 'Canalisations',
  layers: 'Calques',
  catalogue: 'Catalogue_Tuyaux',
  modeles: 'Modeles_Enneigeurs',
  scenarios: 'Scenarios',
  params: 'Parametres',
  resNodes: 'Resultats_Noeuds',
  resPipes: 'Resultats_Canalisations',
} as const;

export const NODE_COLUMNS: (keyof NetNode)[] = [
  'id', 'type', 'nom', 'lat', 'lon', 'altitude_m', 'modele', 'debit_m3h', 'mode_debit', 'k_buse',
  'pression_min_bar', 'actif', 'pression_consigne_bar', 'debit_max_m3h', 'notes', 'calque', 'aspiration',
  'secteur', 'couronnes', 'debit_c1', 'debit_c1c2', 'debit_c1c3', 'debit_c1c2c3', 'air', 'priorite',
];
export const PIPE_COLUMNS: (keyof Pipe)[] = [
  'id', 'nom', 'amont', 'aval', 'longueur_m', 'longueur_auto', 'dn', 'diametre_int_mm', 'materiau',
  'rugosite_mm', 'pn_bar', 'k_singulier', 'statut', 'geometrie', 'notes', 'calque',
];
export const LAYER_COLUMNS: (keyof Layer)[] = ['id', 'nom', 'couleur', 'visible', 'calcul', 'verrouille', 'description'];

// ---------- conversions de valeurs ----------

export function num(v: unknown, def = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : def;
  if (typeof v === 'string') {
    const s = v.trim().replace(/\s/g, '').replace(',', '.');
    if (s === '') return def;
    const n = Number(s);
    return Number.isFinite(n) ? n : def;
  }
  return def;
}

export function bool(v: unknown, def = false): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', 'vrai', 'oui', 'yes', '1', 'x'].includes(s)) return true;
    if (['false', 'faux', 'non', 'no', '0', ''].includes(s)) return s === '' ? def : false;
  }
  return def;
}

const str = (v: unknown) => (v == null ? '' : String(v));

const MAX_CELL = 45000;

/** Sérialise un tracé en JSON compact, en le simplifiant si la cellule déborde. */
export function encodeGeometry(g: GeoPoint[]): string {
  let pts = g.map((p) => [round(p[0], 7), round(p[1], 7), p[2] == null ? null : round(p[2], 1)]);
  let s = JSON.stringify(pts);
  while (s.length > MAX_CELL && pts.length > 2) {
    pts = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
    s = JSON.stringify(pts);
  }
  return pts.length ? s : '';
}

export function decodeGeometry(v: unknown): GeoPoint[] {
  if (Array.isArray(v)) return v as GeoPoint[];
  const s = str(v).trim();
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p) => Array.isArray(p) && p.length >= 2)
      .map((p) => [Number(p[0]), Number(p[1]), p[2] == null || p[2] === '' ? null : Number(p[2])] as GeoPoint);
  } catch {
    return [];
  }
}

function couronnes(v: unknown): Couronnes {
  const s = str(v).trim().toLowerCase().replace(/\s/g, '');
  return (COURONNES_VALUES.includes(s) ? s : '') as Couronnes;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

const COURONNES_VALUES = ['c1', 'c1+c2', 'c1+c3', 'c1+c2+c3'];

// ---------- Réseau → lignes ----------

export function networkToRows(net: Network): Record<string, Row[]> {
  return {
    [SHEETS.nodes]: net.nodes.map((n) => {
      const r: Row = {};
      for (const c of NODE_COLUMNS) r[c] = n[c];
      return r;
    }),
    [SHEETS.pipes]: net.pipes.map((p) => {
      const r: Row = {};
      for (const c of PIPE_COLUMNS) r[c] = c === 'geometrie' ? encodeGeometry(p.geometrie) : p[c];
      return r;
    }),
    [SHEETS.layers]: net.calques.map((l) => ({ ...l })),
    [SHEETS.catalogue]: net.catalogue.map((c) => ({ ...c })),
    [SHEETS.modeles]: net.modeles.map((m) => ({ ...m })),
    [SHEETS.scenarios]: net.scenarios.flatMap((s) =>
      s.entries.map((e) => ({ scenario: s.nom, noeud_id: e.noeud_id, actif: e.actif, debit_m3h: e.debit_m3h, couronnes: e.couronnes })),
    ),
    [SHEETS.params]: Object.entries(net.params).map(([cle, valeur]) => ({ cle, valeur })),
  };
}

// ---------- lignes → Réseau ----------

export function rowsToNetwork(data: Record<string, Row[]>): Network {
  const e = emptyNetwork();
  const nodes: NetNode[] = (data[SHEETS.nodes] ?? [])
    .filter((r) => str(r.id).trim() !== '')
    .map((r) => {
      const type = (NODE_TYPES.includes(str(r.type) as NodeType) ? str(r.type) : 'enneigeur') as NodeType;
      return {
        id: str(r.id).trim(),
        type,
        nom: str(r.nom),
        lat: num(r.lat),
        lon: num(r.lon),
        altitude_m: num(r.altitude_m),
        modele: str(r.modele),
        debit_m3h: num(r.debit_m3h),
        mode_debit: (str(r.mode_debit) === 'buse' ? 'buse' : 'fixe') as FlowMode,
        k_buse: num(r.k_buse),
        pression_min_bar: num(r.pression_min_bar),
        actif: bool(r.actif, type === 'enneigeur' || type === 'vanne'),
        pression_consigne_bar: num(r.pression_consigne_bar),
        debit_max_m3h: num(r.debit_max_m3h),
        notes: str(r.notes),
        calque: str(r.calque).trim() || 'existant',
        aspiration: str(r.aspiration).trim(),
        secteur: str(r.secteur),
        couronnes: couronnes(r.couronnes),
        debit_c1: num(r.debit_c1),
        debit_c1c2: num(r.debit_c1c2),
        debit_c1c3: num(r.debit_c1c3),
        debit_c1c2c3: num(r.debit_c1c2c3),
        air: num(r.air),
        priorite: str(r.priorite),
      };
    });
  const pipes: Pipe[] = (data[SHEETS.pipes] ?? [])
    .filter((r) => str(r.id).trim() !== '')
    .map((r) => ({
      id: str(r.id).trim(),
      nom: str(r.nom),
      amont: str(r.amont).trim(),
      aval: str(r.aval).trim(),
      longueur_m: num(r.longueur_m),
      longueur_auto: bool(r.longueur_auto, true),
      dn: num(r.dn),
      diametre_int_mm: num(r.diametre_int_mm),
      materiau: str(r.materiau),
      rugosite_mm: num(r.rugosite_mm, 0.1),
      pn_bar: num(r.pn_bar),
      k_singulier: num(r.k_singulier),
      statut: str(r.statut) === 'fermee' ? 'fermee' : 'ouverte',
      geometrie: decodeGeometry(r.geometrie),
      notes: str(r.notes),
      calque: str(r.calque).trim() || 'existant',
    }));
  const calques: Layer[] = (data[SHEETS.layers] ?? [])
    .filter((r) => str(r.id).trim() !== '')
    .map((r) => ({
      id: str(r.id).trim(),
      nom: str(r.nom) || str(r.id),
      couleur: str(r.couleur) || '#1c5c9e',
      visible: bool(r.visible, true),
      calcul: bool(r.calcul, true),
      verrouille: bool(r.verrouille, false),
      description: str(r.description),
    }));
  // Tout calque référencé doit exister.
  for (const id of new Set([...nodes.map((n) => n.calque), ...pipes.map((p) => p.calque)])) {
    if (!calques.some((l) => l.id === id) && !(calques.length === 0 && e.calques.some((l) => l.id === id))) {
      calques.push({ id, nom: id, couleur: '#1c5c9e', visible: true, calcul: true, verrouille: false, description: '' });
    }
  }
  const catalogue: PipeSpec[] = (data[SHEETS.catalogue] ?? [])
    .filter((r) => str(r.ref).trim() !== '')
    .map((r) => ({
      ref: str(r.ref),
      materiau: str(r.materiau),
      dn: num(r.dn),
      pn_bar: num(r.pn_bar),
      diametre_int_mm: num(r.diametre_int_mm),
      rugosite_mm: num(r.rugosite_mm, 0.1),
    }));
  const modeles: GunModel[] = (data[SHEETS.modeles] ?? [])
    .filter((r) => str(r.modele).trim() !== '')
    .map((r) => ({
      modele: str(r.modele),
      type: str(r.type),
      debit_nominal_m3h: num(r.debit_nominal_m3h),
      debit_min_m3h: num(r.debit_min_m3h),
      debit_max_m3h: num(r.debit_max_m3h),
      pression_min_bar: num(r.pression_min_bar),
      pression_max_bar: num(r.pression_max_bar),
      k_buse: num(r.k_buse),
    }));
  const scenMap = new Map<string, Scenario>();
  for (const r of data[SHEETS.scenarios] ?? []) {
    const nom = str(r.scenario).trim();
    if (!nom) continue;
    if (!scenMap.has(nom)) scenMap.set(nom, { nom, entries: [] });
    scenMap.get(nom)!.entries.push({ noeud_id: str(r.noeud_id), actif: bool(r.actif), debit_m3h: num(r.debit_m3h), couronnes: couronnes(r.couronnes) });
  }
  const params: Params = { ...e.params };
  for (const r of data[SHEETS.params] ?? []) {
    const k = str(r.cle).trim() as keyof Params;
    if (!(k in params)) continue;
    const def = params[k];
    (params as unknown as Record<string, unknown>)[k] = typeof def === 'number' ? num(r.valeur, def) : str(r.valeur);
  }
  return {
    nodes,
    pipes,
    calques: calques.length ? calques : e.calques,
    catalogue: catalogue.length ? catalogue : e.catalogue,
    modeles: modeles.length ? modeles : e.modeles,
    scenarios: [...scenMap.values()],
    params,
  };
}

export function resultsToRows(net: Network, res: SolveResult): Record<string, Row[]> {
  const date = new Date(res.date).toLocaleString('fr-FR');
  const nodeName = new Map(net.nodes.map((n) => [n.id, n.nom || n.id]));
  return {
    [SHEETS.resNodes]: net.nodes.map((n) => {
      const r = res.nodes[n.id];
      return {
        date_calcul: date,
        scenario: res.scenario,
        id: n.id,
        nom: n.nom,
        type: n.type,
        altitude_m: n.altitude_m,
        charge_m: r && Number.isFinite(r.charge_m) ? round(r.charge_m, 2) : '',
        pression_bar: r && Number.isFinite(r.pression_bar) ? round(r.pression_bar, 2) : '',
        debit_m3h: r ? round(r.debit_m3h, 2) : '',
        vitesse_arrivee_m_s: r && Number.isFinite(r.vitesse_arrivee_m_s) ? round(r.vitesse_arrivee_m_s, 3) : '',
        debit_arrivee_m3h: r ? round(r.debit_arrivee_m3h, 2) : '',
        pression_min_bar: n.pression_min_bar,
        statut: r ? [r.statut, ...r.messages].join(' – ') : '',
      };
    }),
    [SHEETS.resPipes]: net.pipes.map((p) => {
      const r = res.pipes[p.id];
      return {
        date_calcul: date,
        scenario: res.scenario,
        id: p.id,
        nom: p.nom,
        amont: nodeName.get(p.amont) ?? p.amont,
        aval: nodeName.get(p.aval) ?? p.aval,
        debit_m3h: r ? round(r.debit_m3h, 2) : '',
        vitesse_m_s: r ? round(r.vitesse_m_s, 3) : '',
        perte_charge_m: r ? round(r.perte_charge_m, 3) : '',
        perte_m_km: r ? round(r.perte_m_km, 3) : '',
        pression_max_bar: r && Number.isFinite(r.pression_max_bar) ? round(r.pression_max_bar, 2) : '',
        pn_bar: p.pn_bar,
        statut: r ? [r.statut, ...r.messages].join(' – ') : '',
      };
    }),
  };
}

// ---------- appels réseau ----------

async function call(settings: Settings, payload: Record<string, unknown>): Promise<unknown> {
  if (!settings.sheetsUrl) throw new Error("L'adresse de la base Google Sheets n'est pas configurée (Réglages).");
  // text/plain : requête « simple », pas de pré-vol CORS vers Apps Script.
  const res = await fetch(settings.sheetsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, key: settings.apiKey }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Google Sheets : erreur HTTP ${res.status}`);
  const text = await res.text();
  let json: { ok?: boolean; error?: string; data?: unknown };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Réponse inattendue de Google Sheets : vérifiez que l'application Web est déployée avec l'accès « Tout le monde ».");
  }
  if (!json.ok) throw new Error(json.error || 'Erreur Google Sheets');
  return json.data;
}

export async function loadFromSheets(settings: Settings): Promise<Network> {
  const data = (await call(settings, { action: 'load' })) as Record<string, Row[]>;
  return rowsToNetwork(data);
}

export async function saveToSheets(settings: Settings, net: Network): Promise<void> {
  await call(settings, { action: 'save', data: networkToRows(net) });
}

export async function saveResultsToSheets(settings: Settings, net: Network, res: SolveResult): Promise<void> {
  await call(settings, { action: 'save', data: resultsToRows(net, res) });
}

export async function pingSheets(settings: Settings): Promise<{ title: string; sheets: string[] }> {
  return (await call(settings, { action: 'ping' })) as { title: string; sheets: string[] };
}
