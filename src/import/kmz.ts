// Lecture des fichiers KMZ / KML (Google Earth) et construction du réseau :
//  • Les points (Placemark/Point) deviennent des nœuds (enneigeurs par défaut).
//  • Les lignes (LineString) deviennent des canalisations, découpées à chaque
//    point ou extrémité de ligne situé à moins de « tolérance » mètres du tracé.

import JSZip from 'jszip';
import { makeNode, makePipe, DEFAULT_PIPE_SPEC, NODE_PREFIX } from '../model/defaults';
import { haversine, nearestOnPolyline, interpAlt } from '../model/geo';
import { newId, nextName } from '../model/ids';
import type { GeoPoint, NetNode, NodeType, Params, Pipe, PipeSpec } from '../model/types';

export interface KmlPoint {
  name: string;
  description: string;
  folder: string;
  /** Icône (chemin ou URL) issue du style. */
  icon: string;
  /** Catégorie d'import : dossier + icône. */
  category: string;
  lat: number;
  lon: number;
  /** Altitude si absolue dans le fichier, sinon null. */
  alt: number | null;
  data: Record<string, string>;
}

export interface KmlLine {
  name: string;
  description: string;
  folder: string;
  coords: GeoPoint[];
  data: Record<string, string>;
}

export interface KmlContent {
  points: KmlPoint[];
  lines: KmlLine[];
  folders: string[];
  /** Images d'icônes contenues dans le KMZ (chemin → data URL). */
  icons: Record<string, string>;
}

/** Nom court d'une icône : « files/borax_01.png » → « borax ». */
export function iconName(icon: string): string {
  const base = icon.split(/[\\/]/).pop() ?? '';
  return base.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]\d+$/, '');
}

export function pointCategory(folder: string, icon: string): string {
  const n = iconName(icon);
  return n ? `${folder} · ${n}` : folder;
}

/** Lit un fichier .kmz ou .kml. */
export async function readKmlFile(file: Blob | ArrayBuffer, filename = (file as File).name ?? ''): Promise<KmlContent> {
  const buf = typeof (file as Blob).arrayBuffer === 'function' ? await (file as Blob).arrayBuffer() : (file as ArrayBuffer);
  const bytes = new Uint8Array(buf);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // « PK »
  if (isZip || /\.kmz$/i.test(filename)) {
    const zip = await JSZip.loadAsync(buf);
    const kmlFiles = Object.values(zip.files).filter((f) => !f.dir && /\.kml$/i.test(f.name));
    if (!kmlFiles.length) throw new Error('Aucun fichier KML trouvé dans le KMZ.');
    // doc.kml en priorité, sinon le premier
    kmlFiles.sort((a, b) => (/(^|\/)doc\.kml$/i.test(a.name) ? -1 : /(^|\/)doc\.kml$/i.test(b.name) ? 1 : 0));
    const parts: KmlContent[] = [];
    for (const f of kmlFiles) parts.push(parseKml(await f.async('string')));
    const icons: Record<string, string> = {};
    for (const f of Object.values(zip.files)) {
      const m = /\.(png|jpe?g|gif|svg)$/i.exec(f.name);
      if (f.dir || !m) continue;
      const mime = m[1].toLowerCase() === 'svg' ? 'image/svg+xml' : `image/${m[1].toLowerCase().replace('jpg', 'jpeg')}`;
      icons[f.name] = `data:${mime};base64,${await f.async('base64')}`;
    }
    return { ...mergeKml(parts), icons };
  }
  return parseKml(new TextDecoder('utf-8').decode(bytes));
}

function childText(el: Element, tag: string): string {
  for (const c of Array.from(el.children)) if (c.localName === tag) return (c.textContent ?? '').trim();
  return '';
}

function parseCoords(text: string, absolute: boolean): GeoPoint[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tuple) => {
      const [lon, lat, alt] = tuple.split(',').map(Number);
      return [lat, lon, absolute && Number.isFinite(alt) ? alt : null] as GeoPoint;
    })
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function altitudeIsAbsolute(geom: Element): boolean {
  const mode = Array.from(geom.getElementsByTagName('*')).find((e) => e.localName === 'altitudeMode');
  return (mode?.textContent ?? '').trim() === 'absolute';
}

function folderPath(el: Element): string {
  const names: string[] = [];
  let p = el.parentElement;
  while (p) {
    if (p.localName === 'Folder') {
      const n = childText(p, 'name');
      if (n) names.unshift(n);
    }
    p = p.parentElement;
  }
  return names.join(' / ') || '(racine)';
}

function extendedData(pm: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of Array.from(pm.getElementsByTagName('*'))) {
    if (el.localName === 'Data') {
      const name = el.getAttribute('name');
      const v = Array.from(el.children).find((c) => c.localName === 'value');
      if (name) out[name] = (v?.textContent ?? '').trim();
    } else if (el.localName === 'SimpleData') {
      const name = el.getAttribute('name');
      if (name) out[name] = (el.textContent ?? '').trim();
    }
  }
  return out;
}

/** Fusionne plusieurs fichiers KML/KMZ (ex. canalisations + canons). */
export function mergeKml(parts: KmlContent[]): KmlContent {
  return {
    points: parts.flatMap((p) => p.points),
    lines: parts.flatMap((p) => p.lines),
    folders: [...new Set(parts.flatMap((p) => p.folders))],
    icons: Object.assign({}, ...parts.map((p) => p.icons)),
  };
}

function styleIcons(doc: Document): (styleUrl: string) => string {
  const all = Array.from(doc.getElementsByTagName('*'));
  const styles = new Map<string, string>();
  const maps = new Map<string, string>();
  for (const el of all) {
    const id = el.getAttribute('id');
    if (!id) continue;
    if (el.localName === 'Style') {
      const href = Array.from(el.getElementsByTagName('*')).find((e) => e.localName === 'href');
      if (href) styles.set(`#${id}`, (href.textContent ?? '').trim());
    } else if (el.localName === 'StyleMap') {
      for (const pair of Array.from(el.children).filter((c) => c.localName === 'Pair')) {
        if (childText(pair, 'key') === 'normal') maps.set(`#${id}`, childText(pair, 'styleUrl'));
      }
    }
  }
  return (url: string) => {
    const u = url.includes('#') ? url.slice(url.indexOf('#')) : url;
    return styles.get(maps.get(u) ?? u) ?? '';
  };
}

export function parseKml(text: string): KmlContent {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Fichier KML invalide.');
  const iconOf = styleIcons(doc);
  const points: KmlPoint[] = [];
  const lines: KmlLine[] = [];
  const folders = new Set<string>();
  const placemarks = Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === 'Placemark');
  for (const pm of placemarks) {
    const name = childText(pm, 'name');
    const description = childText(pm, 'description');
    const folder = folderPath(pm);
    const data = extendedData(pm);
    const inlineHref = Array.from(pm.getElementsByTagName('*')).find((e) => e.localName === 'href');
    const icon = inlineHref ? (inlineHref.textContent ?? '').trim() : iconOf(childText(pm, 'styleUrl'));
    const geoms = Array.from(pm.getElementsByTagName('*')).filter((e) => e.localName === 'Point' || e.localName === 'LineString');
    for (const g of geoms) {
      const coordEl = Array.from(g.children).find((c) => c.localName === 'coordinates');
      if (!coordEl) continue;
      const coords = parseCoords(coordEl.textContent ?? '', altitudeIsAbsolute(g));
      if (!coords.length) continue;
      folders.add(folder);
      if (g.localName === 'Point') {
        points.push({ name, description, folder, icon, category: pointCategory(folder, icon), lat: coords[0][0], lon: coords[0][1], alt: coords[0][2], data });
      } else if (coords.length >= 2) {
        lines.push({ name, description, folder, coords, data });
      }
    }
  }
  return { points, lines, folders: [...folders], icons: {} };
}

// ---------------------------------------------------------------------------
// Devinettes à partir des noms
// ---------------------------------------------------------------------------

export function guessNodeType(text: string): NodeType {
  const t = text.toLowerCase();
  if (/booster|surpress/.test(t)) return 'surpresseur';
  if (/salle|sdm|\bsm\b|pomp|usine|station|machine/.test(t)) return 'salle_machines';
  if (/jonction|t[eé]\b|piquage|noeud|nœud|vanne/.test(t)) return 'jonction';
  if (/regard|borne|hydrant|chambre/.test(t)) return 'regard';
  return 'enneigeur';
}

/** Cherche un DN dans un texte (« DN150 », « Ø 200 », « D=125 »…). */
export function guessDn(text: string): number | null {
  const m = /(?:dn|ø|⌀|diam(?:[eè]tre)?|d)\s*[=:]?\s*(\d{2,3})\b/i.exec(text);
  return m ? Number(m[1]) : null;
}

export function specForDn(dn: number | null, catalogue: PipeSpec[], fallback: PipeSpec): PipeSpec {
  if (dn == null) return fallback;
  const sameMat = catalogue.filter((c) => c.dn === dn && c.materiau === fallback.materiau);
  return sameMat[0] ?? catalogue.find((c) => c.dn === dn) ?? fallback;
}

// ---------------------------------------------------------------------------
// Construction du réseau
// ---------------------------------------------------------------------------

export interface ImportOptions {
  /** Type de nœud par catégorie de points (dossier · icône). */
  categoryTypes: Record<string, NodeType | 'ignorer'>;
  /** Modèle d'enneigeur par catégorie (vide = modèle par défaut). */
  categoryModels?: Record<string, string>;
  /** Calque d'affectation des nouveaux éléments. */
  calque?: string;
  /** Canalisation par défaut par dossier KML (lignes), ou « ignorer ». */
  folderSpecs: Record<string, PipeSpec | 'ignorer'>;
  /** Utiliser les DN trouvés dans les noms de lignes. */
  detectDn: boolean;
  tolerance_m: number;
  params: Params;
  catalogue: PipeSpec[];
  /** Nœuds déjà présents (import complémentaire). */
  existingNodes?: NetNode[];
}

export interface ImportResult {
  nodes: NetNode[];
  pipes: Pipe[];
  report: {
    points: number;
    lignes: number;
    jonctions: number;
    canalisations: number;
    pointsNonRelies: string[];
  };
}

interface Split {
  pos: number; // index de segment + t
  nodeId: string;
  lat: number;
  lon: number;
}

export function buildNetwork(kml: KmlContent, opts: ImportOptions): ImportResult {
  const tol = opts.tolerance_m;
  const nodes: NetNode[] = [];
  const existing = opts.existingNodes ?? [];
  const usedNames = new Set(existing.map((n) => n.nom));

  // 1. Points → nœuds
  for (const p of kml.points) {
    const type = opts.categoryTypes[p.category] ?? guessNodeType(`${p.folder} ${p.name}`);
    if (type === 'ignorer') continue;
    const nom = p.name || nextName(NODE_PREFIX[type], usedNames);
    usedNames.add(nom);
    const extra: Partial<NetNode> = {
      nom,
      altitude_m: p.alt ?? 0,
      notes: p.description.replace(/<[^>]+>/g, ' ').trim().slice(0, 500),
      calque: opts.calque ?? 'existant',
    };
    const modele = opts.categoryModels?.[p.category];
    if (type === 'enneigeur' && modele) extra.modele = modele;
    const debit = Number(p.data.debit_m3h ?? p.data.debit ?? NaN);
    if (Number.isFinite(debit)) extra.debit_m3h = debit;
    nodes.push(makeNode(type, p.lat, p.lon, opts.params, extra));
  }
  const allNodes = (): NetNode[] => [...existing, ...nodes];

  const findNodeNear = (lat: number, lon: number): NetNode | null => {
    let best: NetNode | null = null;
    let bd = tol;
    for (const n of allNodes()) {
      const d = haversine(lat, lon, n.lat, n.lon);
      if (d <= bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  };

  // 2. Lignes retenues + nœuds d'extrémité
  interface WorkLine {
    line: KmlLine;
    spec: PipeSpec;
    start: string;
    end: string;
    splits: Split[];
  }
  const work: WorkLine[] = [];
  let junctionCount = 0;
  for (const line of kml.lines) {
    const fs = opts.folderSpecs[line.folder];
    if (fs === 'ignorer') continue;
    let spec = fs ?? DEFAULT_PIPE_SPEC;
    if (opts.detectDn) {
      const dn = guessDn(line.name) ?? guessDn(line.data.DN ?? line.data.dn ?? '');
      spec = specForDn(dn, opts.catalogue, spec);
    }
    const ends: string[] = [];
    for (const c of [line.coords[0], line.coords[line.coords.length - 1]]) {
      let n = findNodeNear(c[0], c[1]);
      if (!n) {
        n = makeNode('jonction', c[0], c[1], opts.params, { nom: nextName('J', usedNames), altitude_m: c[2] ?? 0, calque: opts.calque ?? 'existant' });
        usedNames.add(n.nom);
        nodes.push(n);
        junctionCount += 1;
      }
      ends.push(n.id);
    }
    work.push({ line, spec, start: ends[0], end: ends[1], splits: [] });
  }

  // 3. Découpage des lignes au droit des nœuds proches du tracé
  const connected = new Set<string>();
  for (const w of work) {
    connected.add(w.start);
    connected.add(w.end);
  }
  for (const n of allNodes()) {
    for (const w of work) {
      if (n.id === w.start || n.id === w.end) continue;
      const hit = nearestOnPolyline(n.lat, n.lon, w.line.coords);
      if (!hit || hit.distance > tol) continue;
      const pos = hit.index + hit.t;
      const last = w.line.coords.length - 1;
      if (pos <= 1e-9 || pos >= last - 1e-9) continue;
      w.splits.push({ pos, nodeId: n.id, lat: hit.lat, lon: hit.lon });
      connected.add(n.id);
    }
  }

  // 4. Création des canalisations
  const pipes: Pipe[] = [];
  const usedPipeNames = new Set<string>();
  for (const w of work) {
    const coords = w.line.coords;
    const seq: Split[] = [
      { pos: 0, nodeId: w.start, lat: coords[0][0], lon: coords[0][1] },
      ...w.splits.sort((a, b) => a.pos - b.pos),
      { pos: coords.length - 1, nodeId: w.end, lat: coords[coords.length - 1][0], lon: coords[coords.length - 1][1] },
    ];
    for (let s = 0; s < seq.length - 1; s++) {
      const a = seq[s];
      const b = seq[s + 1];
      if (a.nodeId === b.nodeId) continue;
      const geom: GeoPoint[] = [];
      // point de raccordement sur la ligne (si le nœud est décalé du tracé)
      if (s > 0) geom.push(splitPoint(coords, a));
      for (let i = Math.floor(a.pos) + 1; i <= Math.ceil(b.pos) - 1 && i < coords.length - 1; i++) {
        if (i > a.pos + 1e-9 && i < b.pos - 1e-9) geom.push(coords[i]);
      }
      if (s + 1 < seq.length - 1) geom.push(splitPoint(coords, b));
      const base = w.line.name || 'C';
      let nom = seq.length > 2 ? `${base}-${s + 1}` : base;
      if (usedPipeNames.has(nom)) nom = nextName(`${base}-`, usedPipeNames);
      usedPipeNames.add(nom);
      pipes.push(makePipe(a.nodeId, b.nodeId, w.spec, { id: newId('C'), nom, geometrie: dedupe(geom), calque: opts.calque ?? 'existant' }));
    }
  }

  const pointsNonRelies = nodes.filter((n) => !connected.has(n.id) && n.type !== 'jonction').map((n) => n.nom);
  return {
    nodes,
    pipes,
    report: {
      points: kml.points.length,
      lignes: work.length,
      jonctions: junctionCount,
      canalisations: pipes.length,
      pointsNonRelies,
    },
  };
}

function splitPoint(coords: GeoPoint[], s: Split): GeoPoint {
  const i = Math.min(Math.floor(s.pos), coords.length - 2);
  const t = s.pos - i;
  return [s.lat, s.lon, interpAlt(coords[i], coords[i + 1], t)];
}

function dedupe(pts: GeoPoint[]): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && haversine(p[0], p[1], q[0], q[1]) < 0.05) continue;
    out.push(p);
  }
  return out;
}
