// Import d'un tableau (CSV) de débits par canon, par exemple :
//   pistes,n°,air,c1,c1+c2,c1+c3,c1+c2+c3,types,priorité
//   lac,1,36,7,"14,1","21,1","28,2",rubis,
// Les lignes sont rattachées aux nœuds par leur nom (n°).

import { DEFAULT_MODELES } from '../model/defaults';
import type { Couronnes, GunModel, Network, NetNode } from '../model/types';
import { num } from '../services/sheets';

/** Découpe un CSV (séparateur « , » ou « ; », guillemets gérés). */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s°º_.-]/g, '');

const HEADERS: Record<string, string[]> = {
  secteur: ['pistes', 'piste', 'secteur', 'zone'],
  nom: ['n', 'no', 'num', 'numero', 'nom', 'canon', 'id'],
  air: ['air', 'debitair'],
  c1: ['c1'],
  c1c2: ['c1+c2', 'c12'],
  c1c3: ['c1+c3', 'c13'],
  c1c2c3: ['c1+c2+c3', 'c123'],
  modele: ['types', 'type', 'modele', 'model'],
  priorite: ['priorite', 'prio'],
  debit: ['debit', 'debitm3h', 'q'],
};

export interface FlowRow {
  secteur: string;
  nom: string;
  air: number;
  c1: number;
  c1c2: number;
  c1c3: number;
  c1c2c3: number;
  modele: string;
  priorite: string;
  debit: number;
}

export function readFlowTable(text: string): FlowRow[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const head = rows[0].map(norm);
  const col: Record<string, number> = {};
  for (const [key, names] of Object.entries(HEADERS)) {
    const idx = head.findIndex((h) => names.map(norm).includes(h));
    if (idx >= 0) col[key] = idx;
  }
  if (col.nom === undefined) throw new Error('Colonne « n° » (ou « nom ») introuvable dans le fichier.');
  const get = (r: string[], k: string) => (col[k] !== undefined ? (r[col[k]] ?? '').trim() : '');
  return rows
    .slice(1)
    .map((r) => ({
      secteur: get(r, 'secteur'),
      nom: get(r, 'nom'),
      air: num(get(r, 'air')),
      c1: num(get(r, 'c1')),
      c1c2: num(get(r, 'c1c2')),
      c1c3: num(get(r, 'c1c3')),
      c1c2c3: num(get(r, 'c1c2c3')),
      modele: get(r, 'modele'),
      priorite: get(r, 'priorite'),
      debit: num(get(r, 'debit')),
    }))
    .filter((r) => r.nom !== '' && !/total/i.test(r.nom));
}

export interface FlowImportReport {
  rattaches: number;
  nonTrouves: string[];
  sansDonnees: string[];
  nouveauxModeles: string[];
}

/** « 2 rubis » → « rubis » ; « 2tl4 » → « tl4 ». */
export function cleanModel(m: string): string {
  return m.trim().replace(/^\d+\s*(?=[a-z])/i, '').trim();
}

export function applyFlowTable(
  net: Network,
  rows: FlowRow[],
  couronnes: Couronnes,
): { nodes: NetNode[]; modeles: GunModel[]; report: FlowImportReport } {
  const byName = new Map<string, FlowRow>();
  for (const r of rows) byName.set(norm(r.nom), r);
  const used = new Set<string>();
  // Correspondance de secours par numéro seul (« BP179 » ↔ « 179 »), si non ambiguë.
  const exact = new Set(net.nodes.map((n) => norm(n.nom)));
  const digitsOf = (s: string) => /^[a-z]*(\d+[a-z]?)$/.exec(norm(s))?.[1];
  const lookup = (nom: string): { row: FlowRow; key: string } | undefined => {
    const k = norm(nom);
    const r = byName.get(k);
    if (r) return { row: r, key: k };
    const d = digitsOf(nom);
    if (d && d !== k && !exact.has(d) && byName.has(d)) return { row: byName.get(d)!, key: d };
    return undefined;
  };
  const modeles = [...net.modeles];
  const nouveauxModeles: string[] = [];
  const nodes = net.nodes.map((n) => {
    if (n.type !== 'enneigeur' && n.type !== 'regard') return n;
    const hit = lookup(n.nom);
    if (!hit) return n;
    const r = hit.row;
    used.add(hit.key);
    const modele = cleanModel(r.modele) || n.modele;
    const count = Number(/^(\d+)\s*[a-z]/i.exec(r.modele.trim())?.[1] ?? 1);
    if (modele && !modeles.some((m) => m.modele.toLowerCase() === modele.toLowerCase())) {
      const base = DEFAULT_MODELES[2];
      modeles.push({ ...base, modele, type: '', debit_nominal_m3h: r.c1c2c3 || r.debit || base.debit_nominal_m3h, pression_min_bar: net.params.pression_min_defaut_bar });
      nouveauxModeles.push(modele);
    }
    const hasStages = r.c1 + r.c1c2 + r.c1c3 + r.c1c2c3 > 0;
    return {
      ...n,
      secteur: r.secteur || n.secteur,
      modele,
      air: r.air,
      priorite: r.priorite,
      debit_c1: r.c1,
      debit_c1c2: r.c1c2,
      debit_c1c3: r.c1c3,
      debit_c1c2c3: r.c1c2c3,
      couronnes: hasStages ? couronnes : n.couronnes,
      debit_m3h: r.debit > 0 ? r.debit : hasStages ? r.c1c2c3 || n.debit_m3h : n.debit_m3h,
      notes: count > 1 && !n.notes.includes('canons') ? `${count} canons sur ce point. ${n.notes}`.trim() : n.notes,
    };
  });
  const nonTrouves = rows.filter((r) => !used.has(norm(r.nom))).map((r) => r.nom);
  const sansDonnees = nodes.filter((n) => n.type === 'enneigeur' && !lookup(n.nom)).map((n) => n.nom);
  return { nodes, modeles, report: { rattaches: used.size, nonTrouves, sansDonnees, nouveauxModeles } };
}
