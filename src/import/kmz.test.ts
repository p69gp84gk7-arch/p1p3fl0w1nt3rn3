import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOGUE, DEFAULT_PARAMS } from '../model/defaults';
import { buildNetwork, guessDn, guessNodeType, parseKml, readKmlFile } from './kmz';

// Ligne principale nord-sud de ~ 440 m, une antenne vers l'est depuis le milieu.
const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Folder><name>Salle des machines</name>
    <Placemark><name>SDM</name><Point><coordinates>6.0000,45.0000,0</coordinates></Point></Placemark>
  </Folder>
  <Folder><name>Enneigeurs</name>
    <Placemark><name>E1</name><Point><coordinates>6.00005,45.0010,0</coordinates></Point></Placemark>
    <Placemark><name>E2</name><Point><coordinates>6.0000,45.0040,0</coordinates></Point></Placemark>
    <Placemark><name>E3</name><Point><coordinates>6.0030,45.0020,0</coordinates></Point></Placemark>
    <Placemark><name>Loin</name><Point><coordinates>6.0500,45.0500,0</coordinates></Point></Placemark>
  </Folder>
  <Folder><name>Réseau</name>
    <Placemark><name>Principale DN200</name><LineString><coordinates>
      6.0000,45.0000,1000 6.0000,45.0015,0 6.0000,45.0040,0
    </coordinates></LineString></Placemark>
    <Placemark><name>Antenne DN100</name><LineString><coordinates>
      6.00001,45.0020,0 6.0015,45.0020,0 6.0030,45.0020,0
    </coordinates></LineString></Placemark>
  </Folder>
</Document></kml>`;

const opts = () => ({
  categoryTypes: {},
  folderSpecs: {},
  detectDn: true,
  tolerance_m: 15,
  params: DEFAULT_PARAMS,
  catalogue: DEFAULT_CATALOGUE,
});

describe('import KML', () => {
  it('lit points, lignes et dossiers', () => {
    const k = parseKml(KML);
    expect(k.points).toHaveLength(5);
    expect(k.lines).toHaveLength(2);
    expect(k.folders).toContain('Enneigeurs');
    expect(k.points[0].alt).toBeNull(); // altitude relative au sol → inconnue
  });

  it('devine types et DN', () => {
    expect(guessNodeType('Salle des machines SDM')).toBe('salle_machines');
    expect(guessNodeType('Enneigeurs E12')).toBe('enneigeur');
    expect(guessDn('Principale DN200')).toBe(200);
    expect(guessDn('antenne Ø 125')).toBe(125);
    expect(guessDn('E12')).toBeNull();
  });

  it('construit la topologie : découpe aux enneigeurs et au piquage', () => {
    const r = buildNetwork(parseKml(KML), opts());
    const byName = new Map(r.nodes.map((n) => [n.nom, n]));
    expect(byName.get('SDM')!.type).toBe('salle_machines');
    // Ligne principale : SDM → E1 → J(piquage) → E2 ; antenne J → E3
    expect(r.report.jonctions).toBe(1);
    expect(r.pipes).toHaveLength(4);
    expect(r.report.pointsNonRelies).toEqual(['Loin']);
    const J = r.nodes.find((n) => n.type === 'jonction')!;
    const touching = r.pipes.filter((p) => p.amont === J.id || p.aval === J.id);
    expect(touching).toHaveLength(3);
    const principal = r.pipes.filter((p) => p.nom.startsWith('Principale'));
    expect(principal.every((p) => p.dn === 200)).toBe(true);
    const antenne = r.pipes.find((p) => p.nom.startsWith('Antenne'))!;
    expect(antenne.dn).toBe(100);
    expect(antenne.aval).toBe(byName.get('E3')!.id);
  });

  it('lit un KMZ (zip)', async () => {
    const zip = new JSZip();
    zip.file('doc.kml', KML);
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const k = await readKmlFile(buf, 'reseau.kmz');
    expect(k.points).toHaveLength(5);
  });
});
