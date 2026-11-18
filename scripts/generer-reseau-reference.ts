// Génère src/data/reseau-reference.json à partir des fichiers de public/data,
// avec les altitudes IGN de chaque nœud et de chaque sommet de canalisation.
//
//   NODE_USE_ENV_PROXY=1 npx vite-node scripts/generer-reseau-reference.ts
//
import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = new JSDOM().window.DOMParser;

const { readKmlFile } = await import('../src/import/kmz');
const { buildReferenceNetwork, REFERENCE_FILES } = await import('../src/data/reference');
const { fetchElevations } = await import('../src/services/elevation');

const read = (p: string) => new Uint8Array(readFileSync(`public/${p}`)).buffer;
const kmls = [];
for (const f of REFERENCE_FILES.kmz) kmls.push(await readKmlFile(read(f), f));
const net = buildReferenceNetwork(kmls, readFileSync(`public/${REFERENCE_FILES.csv}`, 'utf8'));

const pts = [
  ...net.nodes.map((n) => ({ lat: n.lat, lon: n.lon })),
  ...net.pipes.flatMap((p) => p.geometrie.map((g) => ({ lat: g[0], lon: g[1] }))),
];
const z = await fetchElevations(pts, 'auto', (d, t) => process.stdout.write(`\raltitudes ${d}/${t}`));
console.log();
let k = 0;
const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
net.nodes = net.nodes.map((n) => ({ ...n, altitude_m: r1(z[k++]) ?? 0 }));
net.pipes = net.pipes.map((p) => ({ ...p, geometrie: p.geometrie.map((g) => [g[0], g[1], r1(z[k++])] as typeof g) }));
const missing = z.filter((v) => v == null).length;

writeFileSync('src/data/reseau-reference.json', JSON.stringify(net));
console.log(`${net.nodes.length} nœuds, ${net.pipes.length} canalisations, ${missing} altitudes manquantes`);
for (const n of net.nodes.filter((x) => x.type !== 'enneigeur' && x.type !== 'jonction')) console.log(`  ${n.type} ${n.nom} : ${n.altitude_m} m`);
