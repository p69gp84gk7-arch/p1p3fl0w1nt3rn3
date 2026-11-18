import { pipeLength, pipeProfile } from '../hydraulics/solver';
import { nodeMapOf, shortestPath } from '../model/edit';
import type { Network, SolveResult } from '../model/types';

export interface ProfileSample {
  s: number;
  z: number;
  /** charge hydraulique (m), si calculée */
  H: number | null;
  label?: string;
  nodeId?: string;
}

/** Chemin depuis la salle des machines la plus proche jusqu'au nœud cible. */
export function profilePath(net: Network, targetId: string) {
  const nodes = nodeMapOf(net);
  const lengths = new Map(net.pipes.map((p) => [p.id, pipeLength(p, nodes)]));
  let best: { nodes: string[]; pipes: string[]; L: number } | null = null;
  for (const src of net.nodes.filter((n) => n.type === 'salle_machines')) {
    const path = shortestPath(net, src.id, targetId, lengths);
    if (!path) continue;
    const L = path.pipes.reduce((a, id) => a + (lengths.get(id) ?? 0), 0);
    if (!best || L < best.L) best = { ...path, L };
  }
  return best;
}

export function profileSamples(net: Network, path: { nodes: string[]; pipes: string[] }, res: SolveResult | null): ProfileSample[] {
  const nodes = nodeMapOf(net);
  const pipes = new Map(net.pipes.map((p) => [p.id, p]));
  const out: ProfileSample[] = [];
  let offset = 0;
  path.pipes.forEach((pid, i) => {
    const p = pipes.get(pid)!;
    const fromId = path.nodes[i];
    const forward = p.amont === fromId;
    let prof = pipeProfile(p, nodes);
    const Ltot = prof[prof.length - 1]?.s ?? 0;
    if (!forward) prof = prof.map((pt) => ({ ...pt, s: Ltot - pt.s })).reverse();
    const r = res?.pipes[pid];
    const Ha = r ? (forward ? r.charge_amont_m : r.charge_aval_m) : NaN;
    const Hb = r ? (forward ? r.charge_aval_m : r.charge_amont_m) : NaN;
    prof.forEach((pt, k) => {
      if (k === 0 && i > 0) return;
      const H = Number.isFinite(Ha) && Number.isFinite(Hb) && Ltot > 0 ? Ha + ((Hb - Ha) * pt.s) / Ltot : null;
      const isNode = k === 0 || k === prof.length - 1;
      const nid = k === 0 ? fromId : k === prof.length - 1 ? path.nodes[i + 1] : undefined;
      out.push({ s: offset + pt.s, z: pt.z, H, nodeId: isNode ? nid : undefined, label: isNode && nid ? nodes.get(nid)?.nom : undefined });
    });
    offset += Ltot;
  });
  return out;
}
