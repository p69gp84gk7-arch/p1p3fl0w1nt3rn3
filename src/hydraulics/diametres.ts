// Estimation des diamètres quand ils ne sont pas connus :
//  • calage sur une pression mesurée (ex. 16 bar au canon 122, tout ouvert),
//  • ou dimensionnement automatique selon une vitesse maximale.

import type { Network, Pipe, PipeSpec } from '../model/types';
import { solve } from './solver';

/** Tous les canons ouverts, au plus grand étage de couronnes disponible. */
export function allOpenNetwork(net: Network): Network {
  return {
    ...net,
    nodes: net.nodes.map((n) => {
      if (n.type !== 'enneigeur') return n;
      const c = n.debit_c1c2c3 > 0 ? 'c1+c2+c3' : n.debit_c1c3 > 0 ? 'c1+c3' : n.debit_c1c2 > 0 ? 'c1+c2' : n.debit_c1 > 0 ? 'c1' : n.couronnes;
      return { ...n, actif: true, couronnes: c };
    }),
  };
}

const applySpec = (p: Pipe, s: PipeSpec): Pipe => ({
  ...p,
  dn: s.dn,
  diametre_int_mm: s.diametre_int_mm,
  materiau: s.materiau,
  rugosite_mm: s.rugosite_mm,
  pn_bar: s.pn_bar,
  diametre_estime: true,
});

/** Applique une même canalisation du catalogue aux canalisations retenues. */
export function withUniformSpec(net: Network, spec: PipeSpec, only: (p: Pipe) => boolean): Network {
  return { ...net, pipes: net.pipes.map((p) => (only(p) ? applySpec(p, spec) : p)) };
}

export interface UniformTrial {
  spec: PipeSpec;
  pression: number;
}

/** Essaie chaque diamètre candidat et renvoie la pression obtenue au point de mesure. */
export function calibrateUniform(net: Network, scenario: (n: Network) => Network, nodeId: string, candidates: PipeSpec[], only: (p: Pipe) => boolean) {
  const trials: UniformTrial[] = candidates.map((spec) => {
    const r = solve(scenario(withUniformSpec(net, spec, only)));
    const nr = r.nodes[nodeId];
    return { spec, pression: nr ? nr.pression_bar : NaN };
  });
  return trials;
}

/** Plus petit diamètre du catalogue respectant la vitesse maximale, pour chaque canalisation retenue. */
export function autoSize(net: Network, scenario: (n: Network) => Network, candidates: PipeSpec[], vmax: number, only: (p: Pipe) => boolean): Network {
  const sorted = [...candidates].sort((a, b) => a.diametre_int_mm - b.diametre_int_mm);
  const biggest = sorted[sorted.length - 1];
  // débits calculés avec le plus gros diamètre (pertes minimales)
  const r = solve(scenario(withUniformSpec(net, biggest, only)));
  return {
    ...net,
    pipes: net.pipes.map((p) => {
      if (!only(p)) return p;
      const Q = Math.abs(r.pipes[p.id]?.debit_m3h ?? 0) / 3600;
      const spec = sorted.find((s) => Q / ((Math.PI * (s.diametre_int_mm / 1000) ** 2) / 4) <= vmax) ?? biggest;
      return applySpec(p, spec);
    }),
  };
}

/** Diamètres candidats : même matériau et même PN que la canalisation de référence. */
export function candidateSpecs(catalogue: PipeSpec[], materiau: string, pn: number): PipeSpec[] {
  return catalogue.filter((c) => c.materiau === materiau && c.pn_bar === pn).sort((a, b) => a.dn - b.dn);
}

