import { emptyNetwork, makeNode, makePipe, DEFAULT_CATALOGUE } from './defaults';
import type { Network } from './types';

/** Petit réseau fictif pour découvrir l'application. */
export function demoNetwork(): Network {
  const net = emptyNetwork();
  net.params.nom_projet = 'Démonstration – Station des Cimes';
  const P = net.params;
  const spec = (ref: string) => DEFAULT_CATALOGUE.find((c) => c.ref === ref)!;
  const lat0 = 45.3;
  const lon0 = 6.6;
  const at = (dx: number, dy: number) => [lat0 + dy / 111320, lon0 + dx / (111320 * Math.cos((lat0 * Math.PI) / 180))] as const;

  const [sl, so] = at(0, 0);
  net.nodes.push(makeNode('salle_machines', sl, so, P, { id: 'SM', nom: 'Usine', altitude_m: 1500, pression_consigne_bar: 48, debit_max_m3h: 400 }));
  // Piste A : montée vers le nord
  let prev = 'SM';
  for (let i = 1; i <= 8; i++) {
    const [la, lo] = at(30 * Math.sin(i), i * 90);
    const id = `A${i}`;
    net.nodes.push(
      makeNode('enneigeur', la, lo, P, {
        id,
        nom: `${i}`,
        secteur: 'Piste A',
        altitude_m: 1500 + i * 28,
        modele: 'Perche standard',
        couronnes: 'c1+c2+c3',
        debit_c1: 3.5,
        debit_c1c2: 7,
        debit_c1c3: 10.5,
        debit_c1c2c3: 14,
        pression_min_bar: 20,
      }),
    );
    net.pipes.push(makePipe(prev, id, spec(i < 5 ? 'FD150-C64' : 'FD100-C64'), { id: `CA${i}`, nom: `A-${i}` }));
    prev = id;
  }
  // Piste B : départ en piquage sur A2 vers l'est, avec un surpresseur
  const [jl, jo] = at(220, 200);
  net.nodes.push(makeNode('surpresseur', jl, jo, P, { id: 'B1', nom: 'Booster B', altitude_m: 1560, pression_consigne_bar: 45, debit_max_m3h: 150 }));
  net.pipes.push(makePipe('A2', 'B1', spec('FD125-C64'), { id: 'CB0', nom: 'Alim booster' }));
  prev = 'B1';
  for (let i = 1; i <= 6; i++) {
    const [la, lo] = at(220 + i * 70, 200 + i * 80);
    const id = `B${i + 1}`;
    net.nodes.push(
      makeNode('enneigeur', la, lo, P, {
        id,
        nom: `${20 + i}`,
        secteur: 'Piste B',
        altitude_m: 1560 + i * 45,
        modele: 'Ventilateur standard',
        debit_m3h: 25,
        pression_min_bar: 12,
      }),
    );
    net.pipes.push(makePipe(prev, id, spec('FD100-C64'), { id: `CB${i}`, nom: `B-${i}` }));
    prev = id;
  }
  // Projet futur
  const [pl, po] = at(-250, 500);
  net.nodes.push(makeNode('vanne', ...at(-60, 360), P, { id: 'V1', nom: 'V1', altitude_m: 1600, calque: 'projet' }));
  net.pipes.push(makePipe('A4', 'V1', spec('FD100-C64'), { id: 'CP1', nom: 'Projet-1', calque: 'projet' }));
  net.nodes.push(makeNode('enneigeur', pl, po, P, { id: 'P1', nom: '40', secteur: 'Extension', altitude_m: 1640, debit_m3h: 30, calque: 'projet' }));
  net.pipes.push(makePipe('V1', 'P1', spec('FD100-C64'), { id: 'CP2', nom: 'Projet-2', calque: 'projet', geometrie: [[...at(-200, 420), null]] }));
  net.scenarios.push({ nom: 'Piste A seule', entries: net.nodes.filter((n) => n.type === 'enneigeur').map((n) => ({ noeud_id: n.id, actif: n.secteur === 'Piste A', debit_m3h: n.debit_m3h, couronnes: n.couronnes })) });
  return net;
}
