import { describe, expect, it } from 'vitest';
import { emptyNetwork, makeNode } from '../model/defaults';
import { applyFlowTable, cleanModel, parseCsv, readFlowTable } from './csv';

const CSV = `pistes,n°,air,c1,c1+c2,c1+c3,c1+c2+c3,types,priorité
lac,1,36,7,"14,1","21,1","28,2",rubis,
lac,3,36,"8,5",17,20,"26,4",safyr,1
lac,total piste,435,"71,8","146,6","209,6","275,9",,
campistrous,98,50,"5,8","11,6","17,4","23,2",2 rubis,
`;

describe('import CSV des débits', () => {
  it('découpe le CSV avec guillemets et virgules décimales', () => {
    const rows = parseCsv(CSV);
    expect(rows[1]).toEqual(['lac', '1', '36', '7', '14,1', '21,1', '28,2', 'rubis', '']);
  });

  it('lit le tableau et ignore les totaux', () => {
    const t = readFlowTable(CSV);
    expect(t).toHaveLength(3);
    expect(t[0]).toMatchObject({ secteur: 'lac', nom: '1', c1: 7, c1c2: 14.1, c1c3: 21.1, c1c2c3: 28.2, modele: 'rubis' });
    expect(cleanModel('2 rubis')).toBe('rubis');
  });

  it('rattache les débits aux enneigeurs par leur nom', () => {
    const net = emptyNetwork();
    net.nodes.push(
      makeNode('enneigeur', 0, 0, net.params, { nom: '1' }),
      makeNode('enneigeur', 0, 0, net.params, { nom: '98' }),
      makeNode('enneigeur', 0, 0, net.params, { nom: '500' }),
    );
    const r = applyFlowTable(net, readFlowTable(CSV), 'c1+c2');
    expect(r.report.rattaches).toBe(2);
    expect(r.report.nonTrouves).toEqual(['3']);
    expect(r.report.sansDonnees).toEqual(['500']);
    expect(r.report.nouveauxModeles).toContain('rubis');
    const n1 = r.nodes[0];
    expect(n1.couronnes).toBe('c1+c2');
    expect(n1.debit_c1c2c3).toBe(28.2);
    expect(n1.secteur).toBe('lac');
    expect(r.nodes[1].notes).toMatch(/2 canons/);
  });
});
