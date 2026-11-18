import { describe, expect, it } from 'vitest';
import { emptyNetwork, makeNode, makePipe } from '../model/defaults';
import type { Network } from '../model/types';
import { frictionFactor, G, solve, waterDensity, waterViscosity } from './solver';

function base(): Network {
  const net = emptyNetwork();
  net.params.temperature_eau_c = 2;
  return net;
}

const spec = { ref: 't', materiau: 'Fonte', dn: 150, pn_bar: 100, diametre_int_mm: 150, rugosite_mm: 0.1 };

describe('propriétés de l’eau', () => {
  it('viscosité et masse volumique plausibles à 2 °C', () => {
    expect(waterDensity(2)).toBeGreaterThan(999.8);
    expect(waterDensity(2)).toBeLessThan(1000.1);
    expect(waterViscosity(2)).toBeGreaterThan(1.6e-6);
    expect(waterViscosity(2)).toBeLessThan(1.7e-6);
  });
});

describe('solveur', () => {
  it('une canalisation : perte de charge Darcy-Weisbach et pression', () => {
    const net = base();
    const sm = makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 40 });
    const e = makeNode('enneigeur', 45.001, 6, net.params, { id: 'E', altitude_m: 1100, debit_m3h: 36, pression_min_bar: 10 });
    net.nodes.push(sm, e);
    net.pipes.push(makePipe('SM', 'E', spec, { id: 'C', longueur_auto: false, longueur_m: 1000 }));
    const r = solve(net);
    expect(r.converged).toBe(true);

    const rho = waterDensity(2);
    const nu = waterViscosity(2);
    const D = 0.15;
    const A = (Math.PI * D * D) / 4;
    const Q = 0.01;
    const V = Q / A;
    const f = frictionFactor((V * D) / nu, 0.0001, D);
    const hl = (f * 1000 * V * V) / (D * 2 * G);
    const Hsrc = 1000 + (40 * 1e5) / (rho * G);
    const P = ((Hsrc - hl - 1100) * rho * G) / 1e5;

    expect(r.pipes.C.debit_m3h).toBeCloseTo(36, 6);
    expect(r.pipes.C.perte_charge_m).toBeCloseTo(hl, 4);
    expect(r.nodes.E.pression_bar).toBeCloseTo(P, 4);
    expect(r.nodes.SM.debit_m3h).toBeCloseTo(36, 6);
    expect(r.nodes.E.statut).toBe('ok');
    // vitesse d'arrivée au regard = vitesse dans la canalisation qui l'alimente
    expect(r.nodes.E.vitesse_arrivee_m_s).toBeCloseTo(V, 6);
    expect(r.nodes.E.debit_arrivee_m3h).toBeCloseTo(36, 6);
    // ~ 40 bar - 9.8 bar de dénivelé - pertes
    expect(P).toBeGreaterThan(29);
    expect(P).toBeLessThan(30.3);
  });

  it('deux canalisations identiques en parallèle se partagent le débit', () => {
    const net = base();
    net.nodes.push(
      makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 30 }),
      makeNode('enneigeur', 45.01, 6, net.params, { id: 'E', altitude_m: 1000, debit_m3h: 100 }),
    );
    net.pipes.push(
      makePipe('SM', 'E', spec, { id: 'A', longueur_auto: false, longueur_m: 500 }),
      makePipe('E', 'SM', spec, { id: 'B', longueur_auto: false, longueur_m: 500 }),
    );
    const r = solve(net);
    expect(r.converged).toBe(true);
    expect(r.pipes.A.debit_m3h).toBeCloseTo(50, 4);
    expect(r.pipes.B.debit_m3h).toBeCloseTo(-50, 4);
  });

  it('maille : conservation des débits à chaque nœud', () => {
    const net = base();
    net.nodes.push(
      makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 900, pression_consigne_bar: 50 }),
      makeNode('jonction', 45, 6, net.params, { id: 'J1', altitude_m: 950 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E1', altitude_m: 1000, debit_m3h: 40 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E2', altitude_m: 1050, debit_m3h: 25 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E3', altitude_m: 1100, debit_m3h: 60 }),
    );
    const p = (id: string, a: string, b: string, L: number, d = 150) =>
      makePipe(a, b, { ...spec, diametre_int_mm: d }, { id, longueur_auto: false, longueur_m: L });
    net.pipes.push(p('P1', 'SM', 'J1', 800, 200), p('P2', 'J1', 'E1', 400), p('P3', 'J1', 'E2', 600, 100), p('P4', 'E1', 'E3', 500), p('P5', 'E2', 'E3', 300, 100), p('P6', 'E1', 'E2', 250, 80));
    const r = solve(net);
    expect(r.converged).toBe(true);
    const bal = new Map<string, number>();
    for (const pp of net.pipes) {
      const q = r.pipes[pp.id].debit_m3h;
      bal.set(pp.amont, (bal.get(pp.amont) ?? 0) - q);
      bal.set(pp.aval, (bal.get(pp.aval) ?? 0) + q);
    }
    expect(bal.get('J1')).toBeCloseTo(0, 5);
    expect(bal.get('E1')).toBeCloseTo(40, 5);
    expect(bal.get('E2')).toBeCloseTo(25, 5);
    expect(bal.get('E3')).toBeCloseTo(60, 5);
    expect(r.totals.debit_total_m3h).toBeCloseTo(125, 5);
    // cohérence charge / perte de charge sur chaque tronçon
    for (const pp of net.pipes) {
      const dh = r.nodes[pp.amont].charge_m - r.nodes[pp.aval].charge_m;
      expect(r.pipes[pp.id].perte_charge_m).toBeCloseTo(dh, 6);
    }
  });

  it('buse : Q = k·√P', () => {
    const net = base();
    net.nodes.push(
      makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 30 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E', altitude_m: 1050, mode_debit: 'buse', k_buse: 5 }),
    );
    net.pipes.push(makePipe('SM', 'E', spec, { id: 'C', longueur_auto: false, longueur_m: 2000 }));
    const r = solve(net);
    expect(r.converged).toBe(true);
    const P = r.nodes.E.pression_bar;
    expect(r.nodes.E.debit_m3h).toBeCloseTo(5 * Math.sqrt(P), 3);
    expect(r.pipes.C.debit_m3h).toBeCloseTo(r.nodes.E.debit_m3h, 3);
  });

  it('gradient conjugué et Cholesky donnent le même résultat', () => {
    const net = base();
    net.nodes.push(makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 60 }));
    let prev = 'SM';
    for (let i = 0; i < 60; i++) {
      const id = `N${i}`;
      net.nodes.push(makeNode(i % 3 ? 'enneigeur' : 'jonction', 45, 6, net.params, { id, altitude_m: 1000 + i * 5, debit_m3h: 10 + (i % 7) }));
      net.pipes.push(makePipe(prev, id, { ...spec, diametre_int_mm: 200 - i }, { id: `P${i}`, longueur_auto: false, longueur_m: 100 + i }));
      if (i > 5 && i % 10 === 0) net.pipes.push(makePipe(`N${i - 6}`, id, spec, { id: `L${i}`, longueur_auto: false, longueur_m: 400 }));
      prev = i % 4 === 0 ? id : prev;
    }
    const a = solve(net, { linear: 'dense' });
    const b = solve(net, { linear: 'cg' });
    expect(a.converged && b.converged).toBe(true);
    for (const n of net.nodes) expect(b.nodes[n.id].pression_bar).toBeCloseTo(a.nodes[n.id].pression_bar, 5);
  });

  it('nœud isolé et canalisation fermée', () => {
    const net = base();
    net.nodes.push(
      makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 30 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E', altitude_m: 1000 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'F', altitude_m: 1000 }),
    );
    net.pipes.push(makePipe('SM', 'E', spec, { id: 'C1', longueur_auto: false, longueur_m: 100 }));
    net.pipes.push(makePipe('E', 'F', spec, { id: 'C2', longueur_auto: false, longueur_m: 100, statut: 'fermee' }));
    const r = solve(net);
    expect(r.converged).toBe(true);
    expect(r.nodes.F.statut).toBe('isole');
    expect(r.nodes.E.statut).toBe('ok');
    expect(r.pipes.C2.debit_m3h).toBe(0);
  });

  it('pression statique et dépassement de PN', () => {
    const net = base();
    net.nodes.push(
      makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1500, pression_consigne_bar: 40 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E', altitude_m: 1200, actif: false }),
    );
    net.pipes.push(makePipe('SM', 'E', { ...spec, pn_bar: 64 }, { id: 'C', longueur_auto: false, longueur_m: 1000 }));
    const r = solve(net);
    const rho = waterDensity(2);
    expect(r.nodes.E.pression_bar).toBeCloseTo(40 + (300 * rho * G) / 1e5, 6);
    expect(r.pipes.C.statut).toBe('erreur');
  });

  it('pression insuffisante signalée', () => {
    const net = base();
    net.nodes.push(
      makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 20 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E', altitude_m: 1150, pression_min_bar: 10 }),
    );
    net.pipes.push(makePipe('SM', 'E', spec, { id: 'C', longueur_auto: false, longueur_m: 500 }));
    const r = solve(net);
    expect(r.nodes.E.statut).toBe('erreur');
    expect(r.totals.enneigeurs_insuffisants).toBe(1);
  });

  it('surpresseur : refoulement à pression imposée, débit aspiré = débit refoulé', () => {
    const net = base();
    net.nodes.push(
      makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 30 }),
      makeNode('surpresseur', 45, 6, net.params, { id: 'B', altitude_m: 1200, pression_consigne_bar: 40 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E1', altitude_m: 1100, debit_m3h: 20 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E2', altitude_m: 1400, debit_m3h: 36 }),
    );
    net.pipes.push(
      makePipe('SM', 'E1', spec, { id: 'C0', longueur_auto: false, longueur_m: 500 }),
      makePipe('E1', 'B', spec, { id: 'C1', longueur_auto: false, longueur_m: 1000 }),
      makePipe('B', 'E2', spec, { id: 'C2', longueur_auto: false, longueur_m: 1000 }),
    );
    const r = solve(net);
    expect(r.converged).toBe(true);
    const barPerM = (waterDensity(2) * G) / 1e5;
    expect(r.nodes.B.debit_m3h).toBeCloseTo(36, 4);
    expect(r.pipes.C1.debit_m3h).toBeCloseTo(36, 4);
    expect(r.pipes.C0.debit_m3h).toBeCloseTo(56, 4);
    expect(r.nodes.B.pression_bar).toBeCloseTo(40, 6);
    expect(r.nodes.E2.pression_bar).toBeCloseTo(40 - 200 * barPerM - r.pipes.C2.perte_charge_m * barPerM, 4);
    // aspiration = pression amont – dénivelé – pertes
    const Pin = r.nodes.E1.pression_bar - 100 * barPerM - r.pipes.C1.perte_charge_m * barPerM;
    expect(r.nodes.B.pression_aspiration_bar!).toBeCloseTo(Pin, 4);
    expect(r.totals.debit_total_m3h).toBeCloseTo(56, 4);
  });

  it('calques : un projet non calculé est ignoré', () => {
    const net = base();
    net.nodes.push(
      makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 30 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E', altitude_m: 1000, debit_m3h: 30 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'F', altitude_m: 1000, debit_m3h: 30, calque: 'projet' }),
    );
    net.pipes.push(
      makePipe('SM', 'E', spec, { id: 'C1', longueur_auto: false, longueur_m: 100 }),
      makePipe('E', 'F', spec, { id: 'C2', longueur_auto: false, longueur_m: 100, calque: 'projet' }),
    );
    let r = solve(net);
    expect(r.totals.debit_total_m3h).toBeCloseTo(30, 6);
    expect(r.nodes.F.statut).toBe('isole');
    net.calques.find((l) => l.id === 'projet')!.calcul = true;
    r = solve(net);
    expect(r.totals.debit_total_m3h).toBeCloseTo(60, 6);
  });

  it('réducteur de pression : consigne en sortie, puis by-pass si amont trop faible', () => {
    const mk = (consigne: number) => {
      const net = base();
      net.nodes.push(
        makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1500, pression_consigne_bar: 20 }),
        makeNode('reducteur', 45, 6, net.params, { id: 'R', altitude_m: 1300, pression_consigne_bar: consigne }),
        makeNode('enneigeur', 45, 6, net.params, { id: 'E', altitude_m: 1000, debit_m3h: 30 }),
      );
      net.pipes.push(
        makePipe('SM', 'R', spec, { id: 'C1', longueur_auto: false, longueur_m: 800 }),
        makePipe('R', 'E', spec, { id: 'C2', longueur_auto: false, longueur_m: 800 }),
      );
      return solve(net);
    };
    const a = mk(25);
    expect(a.nodes.R.pression_bar).toBeCloseTo(25, 4);
    expect(a.nodes.E.debit_m3h).toBeCloseTo(30, 4);
    const b = mk(60); // consigne inatteignable : grand ouvert
    expect(b.nodes.R.pression_bar).toBeLessThan(60);
    expect(b.nodes.R.messages.join(' ')).toMatch(/grand ouvert/);
  });

  it('vanne fermée : coupe l’alimentation en aval', () => {
    const net = base();
    net.nodes.push(
      makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 30 }),
      makeNode('vanne', 45, 6, net.params, { id: 'V', altitude_m: 1000, actif: false }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E', altitude_m: 1000 }),
    );
    net.pipes.push(makePipe('SM', 'V', spec, { id: 'C1' }), makePipe('V', 'E', spec, { id: 'C2' }));
    const r = solve(net);
    expect(r.nodes.E.statut).toBe('isole');
  });

  it('débit par étage de couronnes', () => {
    const net = base();
    net.nodes.push(
      makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 30 }),
      makeNode('enneigeur', 45.001, 6, net.params, { id: 'E', altitude_m: 1000, debit_m3h: 99, couronnes: 'c1+c2', debit_c1: 3.5, debit_c1c2: 7, debit_c1c3: 10.6, debit_c1c2c3: 14.1 }),
    );
    net.pipes.push(makePipe('SM', 'E', spec, { id: 'C1' }));
    expect(solve(net).totals.debit_total_m3h).toBeCloseTo(7, 6);
  });

  it('salle des machines à l’arrêt / surpresseur à l’arrêt (pas de by-pass)', () => {
    const net = base();
    net.nodes.push(
      makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 30 }),
      makeNode('surpresseur', 45, 6, net.params, { id: 'B', altitude_m: 1050, pression_consigne_bar: 40 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E', altitude_m: 1100, debit_m3h: 10 }),
    );
    net.pipes.push(makePipe('SM', 'B', spec, { id: 'C1', longueur_auto: false, longueur_m: 300 }), makePipe('B', 'E', spec, { id: 'C2', longueur_auto: false, longueur_m: 300 }));
    const on = solve(net);
    expect(on.nodes.B.pression_bar).toBeCloseTo(40, 6);
    net.nodes[1].en_marche = false;
    const stopped = solve(net); // booster arrêté : la ligne en aval n'est pas alimentée
    expect(stopped.nodes.E.statut).toBe('isole');
    expect(stopped.nodes.B.messages.join(' ')).toMatch(/arrêt/);
    expect(stopped.nodes.B.pression_aspiration_bar).toBeCloseTo(30 - 50 * 0.0981, 1);
    expect(stopped.totals.debit_total_m3h).toBeCloseTo(0, 6);
    net.nodes[0].en_marche = false;
    const off = solve(net);
    expect(off.nodes.E.statut).toBe('isole');
    expect(off.messages[0]).toMatch(/arrêt/);
  });

  it('surpresseur désamorcé tant que l’eau ne lui arrive pas', () => {
    const net = base();
    net.nodes.push(
      makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 10 }),
      makeNode('surpresseur', 45, 6, net.params, { id: 'B', altitude_m: 1300, pression_consigne_bar: 40 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E', altitude_m: 1400, actif: false }),
    );
    net.pipes.push(makePipe('SM', 'B', spec, { id: 'C1', longueur_auto: false, longueur_m: 300 }), makePipe('B', 'E', spec, { id: 'C2', longueur_auto: false, longueur_m: 300 }));
    const dry = solve(net); // 10 bar ≈ 102 m : l'eau n'atteint pas 1300 m
    expect(dry.nodes.B.pression_aspiration_bar).toBeLessThan(0);
    expect(dry.nodes.E.statut).toBe('isole'); // pas d'eau en aval du booster
    expect(dry.nodes.B.messages.join(' ')).toMatch(/désamorcé/);
    net.nodes[0].pression_consigne_bar = 40; // ≈ 408 m : l'eau arrive, le booster repart
    const wet = solve(net);
    expect(wet.nodes.B.pression_bar).toBeCloseTo(40, 4);
    expect(wet.nodes.E.pression_bar).toBeGreaterThan(29);
  });

  it('booster désamorcé en production : débit trop fort pour l’aspiration', () => {
    const net = base();
    net.nodes.push(
      makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 25 }),
      makeNode('surpresseur', 45, 6, net.params, { id: 'B', altitude_m: 1200, pression_consigne_bar: 40 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E', altitude_m: 1300, debit_m3h: 400 }),
    );
    net.pipes.push(
      makePipe('SM', 'B', { ...spec, diametre_int_mm: 100 }, { id: 'C1', longueur_auto: false, longueur_m: 3000 }),
      makePipe('B', 'E', spec, { id: 'C2', longueur_auto: false, longueur_m: 300 }),
    );
    const r = solve(net);
    expect(r.converged).toBe(true);
    expect(r.nodes.B.statut).toBe('erreur');
    expect(r.nodes.E.statut).toBe('isole');
  });
});
