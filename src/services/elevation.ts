// Récupération des altitudes du terrain.
//  • IGN Géoplateforme (RGE ALTI®, France, précision métrique) — sans clé.
//  • Open-Meteo (Copernicus DEM 90 m, monde entier) — sans clé.
// Mode « auto » : IGN, puis Open-Meteo pour les points hors couverture.

export type ElevationSource = 'auto' | 'ign' | 'open-meteo';

type LatLon = { lat: number; lon: number };

const IGN_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/elevation';

async function ignBatch(pts: LatLon[]): Promise<(number | null)[]> {
  const params = new URLSearchParams({
    lon: pts.map((p) => p.lon.toFixed(7)).join('|'),
    lat: pts.map((p) => p.lat.toFixed(7)).join('|'),
    resource: 'ign_rge_alti_wld',
    delimiter: '|',
    zonly: 'true',
    indent: 'false',
  });
  const res = await fetch(`${IGN_URL}?${params}`);
  if (!res.ok) throw new Error(`IGN : erreur ${res.status}`);
  const json = await res.json();
  const arr: unknown[] = json.elevations ?? [];
  return arr.map((z) => {
    const v = typeof z === 'number' ? z : Number((z as { z?: number })?.z);
    return Number.isFinite(v) && v > -1000 ? v : null;
  });
}

async function openMeteoBatch(pts: LatLon[]): Promise<(number | null)[]> {
  const params = new URLSearchParams({
    latitude: pts.map((p) => p.lat.toFixed(6)).join(','),
    longitude: pts.map((p) => p.lon.toFixed(6)).join(','),
  });
  const res = await fetch(`${OPEN_METEO_URL}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo : erreur ${res.status}`);
  const json = await res.json();
  return (json.elevation ?? []).map((z: number) => (Number.isFinite(z) ? z : null));
}

async function batched(
  pts: LatLon[],
  size: number,
  fn: (b: LatLon[]) => Promise<(number | null)[]>,
  onProgress?: (done: number, total: number) => void,
): Promise<(number | null)[]> {
  const out: (number | null)[] = [];
  for (let i = 0; i < pts.length; i += size) {
    const part = await fn(pts.slice(i, i + size));
    out.push(...part);
    onProgress?.(Math.min(i + size, pts.length), pts.length);
  }
  return out;
}

export async function fetchElevations(
  pts: LatLon[],
  source: ElevationSource = 'auto',
  onProgress?: (done: number, total: number) => void,
): Promise<(number | null)[]> {
  if (!pts.length) return [];
  if (source === 'open-meteo') return batched(pts, 100, openMeteoBatch, onProgress);
  let res: (number | null)[];
  try {
    res = await batched(pts, 100, ignBatch, onProgress);
  } catch (e) {
    if (source === 'ign') throw e;
    return batched(pts, 100, openMeteoBatch, onProgress);
  }
  if (source === 'auto') {
    const missing = res.map((z, i) => (z == null ? i : -1)).filter((i) => i >= 0);
    if (missing.length) {
      const fill = await batched(missing.map((i) => pts[i]), 100, openMeteoBatch);
      missing.forEach((i, k) => (res[i] = fill[k]));
    }
  }
  return res;
}
