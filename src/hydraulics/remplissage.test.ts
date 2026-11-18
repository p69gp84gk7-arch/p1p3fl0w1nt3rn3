import { describe, expect, it } from 'vitest';
import { emptyNetwork, makeNode, makePipe } from '../model/defaults';
import { formatDuree, simulateFilling } from './remplissage';

const spec = { ref: 't', materiau: 'Fonte', dn: 200, pn_bar: 100, diametre_int_mm: 200, rugosite_mm: 0.1 };
const vol = (L: number) => ((Math.PI * 0.2 ** 2) / 4) * L;

function net0() {
  const net = emptyNetwork();
  net.nodes.push(makeNode('salle_machines', 45, 6, net.params, { id: 'SM', altitude_m: 1000, pression_consigne_bar: 40, debit_remplissage_m3h: 36 }));
  return net;
}

describe('simulation du remplissage', () => {
  it('temps = volume / débit, point haut puis vallée remplie par le bas', () => {
    const net = net0();
    net.nodes.push(
      makeNode('jonction', 45, 6, net.params, { id: 'J', altitude_m: 1100 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'E', altitude_m: 1050, actif: false }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'F', altitude_m: 1020, actif: false }),
    );
    net.pipes.push(
      makePipe('SM', 'J', spec, { id: 'P1', longueur_auto: false, longueur_m: 1000 }),
      makePipe('J', 'E', spec, { id: 'P2', longueur_auto: false, longueur_m: 500 }),
      makePipe('SM', 'F', spec, { id: 'P3', longueur_auto: false, longueur_m: 200 }),
    );
    const r = simulateFilling(net);
    const rate = 36 / 3600;
    // F (1020 m, branche basse) d'abord, puis la montée vers J, puis la vallée derrière J
    expect(r.nodeTime.F).toBeCloseTo(vol(200) / rate, 3);
    expect(r.nodeTime.J).toBeCloseTo((vol(200) + vol(1000)) / rate, 3);
    expect(r.nodeTime.E).toBeCloseTo((vol(200) + vol(1000) + vol(500)) / rate, 3);
    expect(r.total_s).toBeCloseTo(r.nodeTime.E, 6);
    expect(r.volume_m3).toBeCloseTo(vol(1700), 6);
    expect(formatDuree(3723)).toBe('1 h 02 min');
  });

  it('pression insuffisante pour franchir un point haut : la suite ne se remplit pas', () => {
    const net = net0();
    net.nodes[0].pression_consigne_bar = 5; // ≈ 51 m : niveau max 1051 m
    net.nodes.push(makeNode('jonction', 45, 6, net.params, { id: 'J', altitude_m: 1100 }), makeNode('enneigeur', 45, 6, net.params, { id: 'E', altitude_m: 1020, actif: false }));
    net.pipes.push(makePipe('SM', 'J', spec, { id: 'P1', longueur_auto: false, longueur_m: 500 }), makePipe('J', 'E', spec, { id: 'P2', longueur_auto: false, longueur_m: 500 }));
    const r = simulateFilling(net);
    expect(r.nodeTime.E).toBeUndefined();
    expect(r.jamais).toContain('E');
  });

  it('canalisation non reliée : jamais remplie', () => {
    const net = net0();
    net.nodes.push(makeNode('jonction', 45, 6, net.params, { id: 'A', altitude_m: 900 }), makeNode('jonction', 45, 6, net.params, { id: 'B', altitude_m: 900 }));
    net.pipes.push(makePipe('A', 'B', spec, { id: 'X', longueur_auto: false, longueur_m: 100 }));
    const r = simulateFilling(net);
    expect(r.segments.every((s) => !Number.isFinite(s.t))).toBe(true);
  });

  it('zone du booster : démarre quand l’eau arrive au booster, avec son propre débit', () => {
    const net = net0();
    net.nodes.push(
      makeNode('surpresseur', 45, 6, net.params, { id: 'B', altitude_m: 1200, pression_consigne_bar: 30, debit_remplissage_m3h: 18 }),
      makeNode('enneigeur', 45, 6, net.params, { id: 'H', altitude_m: 1100, actif: false }),
    );
    net.pipes.push(makePipe('SM', 'B', spec, { id: 'P1', longueur_auto: false, longueur_m: 1000 }), makePipe('B', 'H', spec, { id: 'P2', longueur_auto: false, longueur_m: 500 }));
    const r = simulateFilling(net);
    const tB = vol(1000) / (36 / 3600);
    expect(r.boosters.B.depart_s).toBeCloseTo(tB, 3);
    expect(r.nodeTime.H).toBeCloseTo(tB + vol(500) / (18 / 3600), 3);
    // booster arrêté : la zone reste vide
    net.nodes[1].en_marche = false;
    expect(simulateFilling(net).nodeTime.H).toBeUndefined();
  });
});
