import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readKmlFile } from '../import/kmz';
import { buildReferenceNetwork, REFERENCE_FILES, REFERENCE_VERSION } from './reference';
import { referenceNetwork } from './referenceNetwork';
import { solve } from '../hydraulics/solver';
import { applyScenario, staticNetwork } from '../model/scenario';
import { pressureAt } from '../hydraulics/calage';
import { allOpenNetwork } from '../hydraulics/diametres';
import { boosterZones } from '../hydraulics/zones';
import { simulateFilling } from '../hydraulics/remplissage';

const read = (p: string) => new Uint8Array(readFileSync(`public/${p}`)).buffer;

describe('réseau de référence intégré', () => {
  it('le JSON intégré correspond aux fichiers sources', async () => {
    const kmls = [];
    for (const f of REFERENCE_FILES.kmz) kmls.push(await readKmlFile(read(f), f));
    const built = buildReferenceNetwork(kmls, readFileSync(`public/${REFERENCE_FILES.csv}`, 'utf8'));
    const ref = await referenceNetwork();
    expect(ref.nodes.map((n) => n.nom).sort()).toEqual(built.nodes.map((n) => n.nom).sort());
    expect(ref.pipes).toHaveLength(built.pipes.length);
  });

  it('contient l’usine, le booster, les canons avec débits et altitudes', async () => {
    const ref = await referenceNetwork();
    expect(ref.nodes.filter((n) => n.type === 'salle_machines').map((n) => n.nom)).toEqual(['usine principale']);
    expect(ref.nodes.filter((n) => n.type === 'surpresseur').map((n) => n.nom)).toEqual(['booster']);
    const guns = ref.nodes.filter((n) => n.type === 'enneigeur');
    expect(guns.filter((n) => n.debit_c1c2c3 > 0).length).toBeGreaterThanOrEqual(200);
    expect(ref.nodes.every((n) => n.altitude_m > 1000)).toBe(true);
    expect(ref.scenarios.length).toBeGreaterThan(5);
  });

  it('se calcule (pression statique et scénario par piste)', async () => {
    const ref = await referenceNetwork();
    const r0 = solve(ref);
    expect(r0.converged).toBe(true);
    const lac = ref.scenarios.find((s) => /lac/.test(s.nom))!;
    const r1 = solve(applyScenario(ref, lac));
    expect(r1.converged).toBe(true);
    expect(r1.totals.debit_total_m3h).toBeGreaterThan(100);
  });

  it('pressions mini : rubis 18 bar, BP 8 bar ; BP179 relié au n°179 du CSV', async () => {
    const ref = await referenceNetwork();
    const rubis = ref.nodes.filter((n) => n.type === 'enneigeur' && n.modele === 'rubis');
    expect(rubis.length).toBeGreaterThan(100);
    expect(rubis.every((n) => n.pression_min_bar === 18)).toBe(true);
    const bp = ref.nodes.find((n) => n.nom === 'BP179')!;
    expect(bp.pression_min_bar).toBe(8);
    expect(bp.debit_c1c2c3).toBeGreaterThan(0);
    expect(ref.nodes.filter((n) => /sectionnement/.test(n.notes)).every((n) => n.type === 'vanne')).toBe(true);
    expect(ref.params.reference_version).toBe(REFERENCE_VERSION);
  });

  it('montée en pression : le niveau d’eau monte avec la pression de la salle des machines', async () => {
    const ref = await referenceNetwork();
    const sdm = ref.nodes.find((n) => n.type === 'salle_machines')!;
    const wet = (bar: number) => {
      const net = { ...ref, nodes: ref.nodes.map((n) => (n.id === sdm.id ? { ...n, pression_consigne_bar: bar } : n)) };
      const r = solve(net);
      return ref.nodes.filter((n) => r.nodes[n.id].pression_bar >= 0).length;
    };
    const w0 = wet(0);
    const w20 = wet(20);
    const w60 = wet(60);
    expect(w0).toBeLessThan(w20);
    expect(w20).toBeLessThan(w60);
  });

  it('calage : 15 bar à l’arrivée du booster canons fermés ; Hount alimenté seulement par le booster', async () => {
    const ref = await referenceNetwork();
    const booster = ref.nodes.find((n) => n.type === 'surpresseur')!;
    const sdm = ref.nodes.find((n) => n.type === 'salle_machines')!;
    expect(sdm.pression_consigne_bar).toBeGreaterThan(55);
    expect(pressureAt(staticNetwork(ref), booster.id)).toBeCloseTo(15, 0);
    const hount = ref.nodes.filter((n) => n.secteur === 'hount estrete');
    expect(hount.length).toBeGreaterThan(10);
    const on = solve(staticNetwork(ref));
    expect(hount.every((n) => on.nodes[n.id].pression_bar > 0)).toBe(true);
    const off = solve(staticNetwork({ ...ref, nodes: ref.nodes.map((n) => (n.id === booster.id ? { ...n, en_marche: false } : n)) }));
    expect(hount.every((n) => off.nodes[n.id].statut === 'isole')).toBe(true);
    // usine trop basse : booster désamorcé, Hount vide
    const low = solve(staticNetwork({ ...ref, nodes: ref.nodes.map((n) => (n.id === sdm.id ? { ...n, pression_consigne_bar: 40 } : n)) }), { realistic: true });
    expect(low.nodes[booster.id].messages.join(' ')).toMatch(/désamorcé/);
    expect(hount.every((n) => low.nodes[n.id].statut === 'isole')).toBe(true);
  });

  it('Revo / Rubis : 18 bar mini, vanne régulée à 45 bar (pression regard et vanne)', async () => {
    const ref = await referenceNetwork();
    for (const m of ['rubis', 'revo']) {
      const mod = ref.modeles.find((x) => x.modele === m)!;
      expect(mod.pression_min_bar).toBe(18);
      expect(mod.pression_regulation_bar).toBe(45);
    }
    const r = solve(staticNetwork(ref));
    const high = ref.nodes.filter((n) => n.modele === 'rubis' && r.nodes[n.id].pression_bar > 45);
    expect(high.length).toBeGreaterThan(0);
    for (const n of high) expect(r.nodes[n.id].pression_vanne_bar).toBe(45);
    const low = ref.nodes.find((n) => n.modele === 'rubis' && r.nodes[n.id].pression_bar < 45)!;
    expect(r.nodes[low.id].pression_vanne_bar).toBeCloseTo(r.nodes[low.id].pression_bar, 9);
  });

  it('diamètres estimés calés : 15 à 17 bar au 122 tout ouvert, la pression augmente en descendant', async () => {
    const ref = await referenceNetwork();
    expect(ref.pipes.every((p) => p.diametre_estime)).toBe(true);
    const r = solve(allOpenNetwork(ref));
    const n122 = ref.nodes.find((n) => n.nom === '122')!;
    expect(r.nodes[n122.id].pression_bar).toBeGreaterThan(14);
    expect(r.nodes[n122.id].pression_bar).toBeLessThan(19);
    // estives : plus bas = plus de pression
    const est = ref.nodes.filter((n) => n.secteur === 'estives').sort((a, b) => b.altitude_m - a.altitude_m);
    expect(r.nodes[est[est.length - 1].id].pression_bar).toBeGreaterThan(r.nodes[est[0].id].pression_bar);
  });

  it('zone du booster : la piste de Hount n’est alimentée que par le booster', async () => {
    const ref = await referenceNetwork();
    const booster = ref.nodes.find((n) => n.type === 'surpresseur')!;
    const zone = boosterZones(ref).get(booster.id)!;
    const hount = ref.nodes.filter((n) => n.secteur === 'hount estrete');
    expect(hount.every((n) => zone.has(n.id))).toBe(true);
    expect(zone.has(ref.nodes.find((n) => n.nom === '122')!.id)).toBe(false);
  });

  it('remplissage du réseau : Hount se charge après le démarrage du booster, temps finis', async () => {
    const ref = await referenceNetwork();
    const sim = simulateFilling(ref);
    const booster = ref.nodes.find((n) => n.type === 'surpresseur')!;
    const dep = sim.boosters[booster.id].depart_s;
    expect(Number.isFinite(dep)).toBe(true);
    expect(sim.total_s).toBeGreaterThan(dep);
    const hount = ref.nodes.filter((n) => n.secteur === 'hount estrete');
    expect(hount.every((n) => sim.nodeTime[n.id] > dep)).toBe(true);
    // booster arrêté : Hount ne se charge pas, mais le booster ne bloque pas les calculs de production
    const off = { ...ref, nodes: ref.nodes.map((n) => (n.id === booster.id ? { ...n, en_marche: false } : n)) };
    expect(hount.every((n) => simulateFilling(off).nodeTime[n.id] === undefined)).toBe(true);
  });
});
