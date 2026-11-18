import type { Network, Scenario } from './types';

/** Applique un scénario (enneigeurs en marche + débits) à une copie du réseau. */
export function applyScenario(net: Network, scenario: Scenario | undefined): Network {
  if (!scenario) return net;
  const entries = new Map(scenario.entries.map((e) => [e.noeud_id, e]));
  return {
    ...net,
    nodes: net.nodes.map((n) => {
      if (n.type !== 'enneigeur' && n.type !== 'regard') return n;
      const e = entries.get(n.id);
      if (!e) return { ...n, actif: false };
      return { ...n, actif: e.actif, couronnes: e.couronnes ?? n.couronnes, debit_m3h: e.debit_m3h > 0 ? e.debit_m3h : n.debit_m3h };
    }),
  };
}

/** Capture l'état actuel (actif/débit) des enneigeurs dans un scénario. */
export function captureScenario(net: Network, nom: string): Scenario {
  return {
    nom,
    entries: net.nodes
      .filter((n) => n.type === 'enneigeur' || n.type === 'regard')
      .map((n) => ({ noeud_id: n.id, actif: n.actif, debit_m3h: n.debit_m3h, couronnes: n.couronnes })),
  };
}

/** Réseau sans aucun soutirage : pression statique. */
export function staticNetwork(net: Network): Network {
  return { ...net, nodes: net.nodes.map((n) => (n.type === 'enneigeur' || n.type === 'regard' ? { ...n, actif: false } : n)) };
}
