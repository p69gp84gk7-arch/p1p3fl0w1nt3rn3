import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readKmlFile } from '../import/kmz';
import { buildReferenceNetwork, REFERENCE_FILES } from './reference';
import { referenceNetwork } from './referenceNetwork';
import { solve } from '../hydraulics/solver';
import { applyScenario } from '../model/scenario';

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
});
