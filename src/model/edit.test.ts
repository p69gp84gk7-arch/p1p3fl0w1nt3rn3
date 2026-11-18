import { describe, expect, it } from 'vitest';
import { emptyNetwork, makeNode, makePipe } from './defaults';
import { connect, deleteNode, mergeAtNode, reconnect, reversePipe, splitPipe } from './edit';
import { networkToRows, rowsToNetwork } from '../services/sheets';
import { demoNetwork } from './demo';

function line() {
  const net = emptyNetwork();
  net.nodes.push(makeNode('salle_machines', 45, 6, net.params, { id: 'A', altitude_m: 1000 }), makeNode('enneigeur', 45.002, 6, net.params, { id: 'B', altitude_m: 1100 }));
  net.pipes.push(makePipe('A', 'B', undefined, { id: 'P', geometrie: [[45.001, 6.0001, 1050]] }));
  return net;
}

describe('édition des liaisons', () => {
  it('insère un nœud sur une canalisation en la coupant', () => {
    const r = splitPipe(line(), 'P', 45.0015, 6.0001, 'regard')!;
    expect(r.net.pipes).toHaveLength(2);
    const [p1, p2] = r.net.pipes;
    expect(p1.amont).toBe('A');
    expect(p1.aval).toBe(r.node.id);
    expect(p2.amont).toBe(r.node.id);
    expect(p2.aval).toBe('B');
    expect(p1.geometrie).toHaveLength(1); // le sommet intermédiaire reste sur le 1er tronçon
    expect(r.node.altitude_m).toBeGreaterThan(1050);
    expect(r.node.altitude_m).toBeLessThan(1100);
  });

  it('fusionne deux tronçons autour d’une jonction', () => {
    const s = splitPipe(line(), 'P', 45.0015, 6.0001, 'jonction')!;
    const m = mergeAtNode(s.net, s.node.id)!;
    expect(m.pipes).toHaveLength(1);
    expect(m.pipes[0].amont).toBe('A');
    expect(m.pipes[0].aval).toBe('B');
    expect(m.nodes).toHaveLength(2);
  });

  it('change une extrémité, inverse, relie et supprime', () => {
    let net = line();
    net.nodes.push(makeNode('enneigeur', 45.003, 6, net.params, { id: 'C' }));
    net = reconnect(net, 'P', 'aval', 'C');
    expect(net.pipes[0].aval).toBe('C');
    net = reversePipe(net, 'P');
    expect(net.pipes[0].amont).toBe('C');
    net = connect(net, 'C', 'B', [], net.catalogue[0], 'existant').net;
    expect(net.pipes).toHaveLength(2);
    net = deleteNode(net, 'C');
    expect(net.pipes).toHaveLength(0);
  });
});

describe('Google Sheets', () => {
  it('aller-retour réseau → onglets → réseau', () => {
    const net = demoNetwork();
    const rows = JSON.parse(JSON.stringify(networkToRows(net)));
    const back = rowsToNetwork(rows);
    expect(back.nodes).toEqual(net.nodes);
    expect(back.pipes.map((p) => ({ ...p, geometrie: p.geometrie.length }))).toEqual(net.pipes.map((p) => ({ ...p, geometrie: p.geometrie.length })));
    expect(back.calques).toEqual(net.calques);
    expect(back.scenarios).toEqual(net.scenarios);
    expect(back.params).toEqual(net.params);
  });

  it('lit les valeurs saisies à la française', () => {
    const net = rowsToNetwork({
      Noeuds: [{ id: 'X', type: 'enneigeur', nom: 318, lat: '42,77', lon: 0.56, actif: 'VRAI', debit_c1: '3,5', couronnes: 'C1+C2' }],
    });
    expect(net.nodes[0]).toMatchObject({ nom: '318', lat: 42.77, actif: true, debit_c1: 3.5, couronnes: 'c1+c2', calque: 'existant' });
  });
});

describe('pressions mini', () => {
  it('BP et modèle', async () => {
    const { applyMinPressures, isBP } = await import('./defaults');
    const net = emptyNetwork();
    net.modeles.push({ ...net.modeles[0], modele: 'rubis', pression_min_bar: 18 });
    net.nodes.push(
      makeNode('enneigeur', 0, 0, net.params, { nom: '12', modele: 'rubis' }),
      makeNode('enneigeur', 0, 0, net.params, { nom: 'BP179', modele: 'rubis' }),
      makeNode('enneigeur', 0, 0, net.params, { nom: '13', modele: 'tl4', priorite: 'BP' }),
    );
    expect(isBP(net.nodes[1])).toBe(true);
    expect(isBP({ nom: 'BPX', modele: '', priorite: '', notes: '' })).toBe(false);
    const out = applyMinPressures(net);
    expect(out.nodes.map((n) => n.pression_min_bar)).toEqual([18, 8, 8]);
  });
});

