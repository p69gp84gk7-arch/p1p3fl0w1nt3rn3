// Calage de la pression de refoulement de l'usine : on cherche la pression
// qui donne une pression voulue en un point du réseau (par défaut à
// l'arrivée du booster), réseau chargé et canons fermés.

import type { Network, NetNode } from '../model/types';
import { staticNetwork } from '../model/scenario';
import { solve } from './solver';

/** Pression mesurée au point de calage : arrivée pour un booster / réducteur, sinon pression au nœud. */
export function pressureAt(net: Network, nodeId: string): number {
  const r = solve(net);
  const res = r.nodes[nodeId];
  if (!res) return NaN;
  if (res.pression_aspiration_bar !== undefined && Number.isFinite(res.pression_aspiration_bar)) return res.pression_aspiration_bar;
  return res.pression_bar;
}

export interface CalageResult {
  ok: boolean;
  /** Pression de refoulement de l'usine (bar). */
  consigne: number;
  /** Pression obtenue au point de calage (bar). */
  obtenue: number;
  message: string;
}

/** Recherche (dichotomie) la pression de l'usine `sourceId` donnant `cible` bar au nœud `nodeId`, canons fermés. */
export function calibrateSource(net: Network, sourceId: string, nodeId: string, cible: number, maxBar = 200): CalageResult {
  const base = staticNetwork(net);
  const withP = (bar: number): Network => ({
    ...base,
    nodes: base.nodes.map((n: NetNode) => (n.id === sourceId ? { ...n, pression_consigne_bar: bar, en_marche: true } : n)),
  });
  const f = (bar: number) => {
    const p = pressureAt(withP(bar), nodeId);
    return Number.isFinite(p) ? p : -1e9;
  };
  let lo = 0;
  let hi = maxBar;
  if (f(hi) < cible) return { ok: false, consigne: hi, obtenue: f(hi), message: `Même à ${maxBar} bar, la pression visée n’est pas atteinte.` };
  if (f(lo) > cible) return { ok: false, consigne: 0, obtenue: f(lo), message: 'La pression visée est déjà dépassée sans pompage (point plus bas que l’usine).' };
  for (let i = 0; i < 40 && hi - lo > 0.005; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < cible) lo = mid;
    else hi = mid;
  }
  const consigne = Math.round(hi * 10) / 10;
  return { ok: true, consigne, obtenue: f(consigne), message: '' };
}
