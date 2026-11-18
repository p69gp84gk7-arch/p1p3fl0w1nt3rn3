// Zones alimentées uniquement par un surpresseur (ex. piste de Hount) :
// les nœuds qu'on ne peut plus atteindre depuis l'usine si le booster est retiré.

import type { Network, Pipe } from '../model/types';

function reachable(net: Network, removed: string | null): Set<string> {
  const closed = new Set(net.nodes.filter((n) => n.type === 'vanne' && !n.actif).map((n) => n.id));
  const excludedLayers = new Set((net.calques ?? []).filter((l) => !l.calcul).map((l) => l.id));
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
  for (const p of net.pipes as Pipe[]) {
    if (p.statut === 'fermee' || excludedLayers.has(p.calque)) continue;
    add(p.amont, p.aval);
    add(p.aval, p.amont);
  }
  const start = net.nodes.filter((n) => n.type === 'salle_machines' && n.en_marche !== false).map((n) => n.id);
  const seen = new Set(start);
  const stack = [...start];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === removed || (closed.has(id) && !start.includes(id))) continue;
    for (const nb of adj.get(id) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        stack.push(nb);
      }
    }
  }
  return seen;
}

/** Pour chaque surpresseur, les nœuds alimentés uniquement à travers lui. */
export function boosterZones(net: Network): Map<string, Set<string>> {
  const all = reachable(net, null);
  const out = new Map<string, Set<string>>();
  for (const b of net.nodes.filter((n) => n.type === 'surpresseur')) {
    const without = reachable(net, b.id);
    const zone = new Set([...all].filter((id) => !without.has(id) && id !== b.id));
    if (zone.size) out.set(b.id, zone);
  }
  return out;
}
