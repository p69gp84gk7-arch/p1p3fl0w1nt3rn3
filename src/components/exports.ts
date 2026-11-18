import type { Network, SolveResult } from '../model/types';
import { resultsToRows, SHEETS } from '../services/sheets';

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = typeof v === 'number' ? v.toString().replace('.', ',') : String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
}

/** CSV (séparateur « ; », virgule décimale) lisible directement par Excel FR. */
export function resultsCsv(net: Network, res: SolveResult): string {
  const rows = resultsToRows(net, res);
  return '﻿' + 'NŒUDS\n' + toCsv(rows[SHEETS.resNodes]) + '\n\nCANALISATIONS\n' + toCsv(rows[SHEETS.resPipes]);
}
