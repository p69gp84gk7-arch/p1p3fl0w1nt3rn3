import type { GeoPoint, NetNode, Pipe } from './types';

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Distance horizontale (m) entre deux points WGS84. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Distance 3D (m) si les deux altitudes sont connues, sinon horizontale. */
export function dist3d(a: GeoPoint, b: GeoPoint): number {
  const h = haversine(a[0], a[1], b[0], b[1]);
  if (a[2] == null || b[2] == null) return h;
  return Math.hypot(h, b[2] - a[2]);
}

export function polylineLength(points: GeoPoint[]): number {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += dist3d(points[i - 1], points[i]);
  return L;
}

export function nodePoint(n: NetNode): GeoPoint {
  return [n.lat, n.lon, Number.isFinite(n.altitude_m) && n.altitude_m !== 0 ? n.altitude_m : null];
}

/** Tracé complet d'une canalisation, extrémités comprises. */
export function pipePath(p: Pipe, nodes: Map<string, NetNode>): GeoPoint[] {
  const a = nodes.get(p.amont);
  const b = nodes.get(p.aval);
  const pts: GeoPoint[] = [];
  if (a) pts.push(nodePoint(a));
  pts.push(...p.geometrie);
  if (b) pts.push(nodePoint(b));
  return pts;
}

/** Projection locale équirectangulaire autour d'une latitude de référence (m). */
export function makeProjector(lat0: number) {
  const k = Math.cos(toRad(lat0));
  return {
    to(lat: number, lon: number): [number, number] {
      return [toRad(lon) * R * k, toRad(lat) * R];
    },
    from(x: number, y: number): [number, number] {
      return [((y / R) * 180) / Math.PI, ((x / (R * k)) * 180) / Math.PI];
    },
  };
}

export interface SegmentHit {
  /** Index du segment (entre points i et i+1). */
  index: number;
  /** Position sur le segment, 0..1. */
  t: number;
  distance: number;
  lat: number;
  lon: number;
}

/** Point le plus proche sur une polyligne. */
export function nearestOnPolyline(lat: number, lon: number, pts: GeoPoint[]): SegmentHit | null {
  if (pts.length < 2) return null;
  const proj = makeProjector(lat);
  const [px, py] = proj.to(lat, lon);
  let best: SegmentHit | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = proj.to(pts[i][0], pts[i][1]);
    const [bx, by] = proj.to(pts[i + 1][0], pts[i + 1][1]);
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    const d = Math.hypot(px - qx, py - qy);
    if (!best || d < best.distance) {
      const [qlat, qlon] = proj.from(qx, qy);
      best = { index: i, t, distance: d, lat: qlat, lon: qlon };
    }
  }
  return best;
}

export function interpAlt(a: GeoPoint, b: GeoPoint, t: number): number | null {
  if (a[2] == null || b[2] == null) return a[2] ?? b[2] ?? null;
  return a[2] + (b[2] - a[2]) * t;
}
