// Simulation du remplissage (chargement) du réseau, canons fermés.
//
// L'eau ne progresse que le long des canalisations reliées. Le réseau se
// remplit « par niveaux » : à chaque instant l'eau occupe d'abord les
// parties les plus basses qu'elle peut atteindre ; une vallée située
// derrière un point haut ne se remplit (par le bas) qu'une fois ce point
// haut franchi. Le temps de remplissage de chaque tronçon est obtenu à
// partir de son volume et du débit de remplissage des stations :
//  • usine : son débit de remplissage, jusqu'au niveau permis par sa
//    pression de refoulement ;
//  • booster : il démarre quand l'eau lui arrive et remplit sa zone (ex.
//    Hount) avec son propre débit, prélevé sur celui de l'usine.

import type { Network, NetNode, Pipe } from '../model/types';
import { isConsumer } from '../model/defaults';
import { G, pipeProfile, waterDensity } from './solver';
import { boosterZones } from './zones';

export interface FillSegment {
  pipeId: string;
  a: [number, number];
  b: [number, number];
  /** Instant où le tronçon est plein (s), Infinity s'il ne se remplit pas. */
  t: number;
  volume: number;
}

export interface FillResult {
  segments: FillSegment[];
  /** Instant où l'eau atteint chaque nœud (s). */
  nodeTime: Record<string, number>;
  total_s: number;
  volume_m3: number;
  volume_total_m3: number;
  boosters: Record<string, { depart_s: number; fin_s: number; volume_m3: number }>;
  secteurs: { secteur: string; fin_s: number; canons: number; vides: number }[];
  jamais: string[];
  messages: string[];
}

interface Seg {
  pipeId: string;
  u: string;
  v: string;
  zu: number;
  zv: number;
  a: [number, number];
  b: [number, number];
  volume: number;
  zone: string | null;
}

class MinHeap {
  private h: [number, number, string][] = [];
  get size() {
    return this.h.length;
  }
  push(k1: number, k2: number, id: string) {
    const h = this.h;
    h.push([k1, k2, id]);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p][0] < h[i][0] || (h[p][0] === h[i][0] && h[p][1] <= h[i][1])) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  pop(): [number, number, string] {
    const h = this.h;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      const less = (a: number, b: number) => h[a][0] < h[b][0] || (h[a][0] === h[b][0] && h[a][1] < h[b][1]);
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && less(l, m)) m = l;
        if (r < h.length && less(r, m)) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Ordre de remplissage des tronçons, par débordement :
 *  • l'eau entre en `entry` et descend jusqu'au point bas le plus proche ;
 *  • le niveau monte alors dans toute la cuvette reliée (tous les versants
 *    sous le niveau courant se remplissent, du plus bas au plus haut) ;
 *  • arrivée à un point haut, l'eau y stagne : de l'autre côté, la descente
 *    (ex. piste gravitaire) se remplit entièrement par le bas avant que le
 *    niveau ne reprenne sa montée ;
 *  • rien ne se remplit au-dessus de `hmax` (pression de refoulement).
 */
function floodOrder(segs: Seg[], entry: { id: string; z: number }, hmax: number): Seg[] {
  const adj = new Map<string, string[]>();
  const zOf = new Map<string, number>();
  zOf.set(entry.id, entry.z);
  for (const s of segs) {
    zOf.set(s.u, s.zu);
    zOf.set(s.v, s.zv);
    (adj.get(s.u) ?? adj.set(s.u, []).get(s.u)!).push(s.v);
    (adj.get(s.v) ?? adj.set(s.v, []).get(s.v)!).push(s.u);
  }
  const z = (id: string) => zOf.get(id)!;
  const rank = new Map<string, number>();
  let counter = 0;
  const wet = (id: string) => rank.set(id, counter++);
  const ek = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  /** Tronçons partant d'un point de débordement : pleins seulement quand la cuvette atteint ce point. */
  const edgeRank = new Map<string, number>();

  /** Remplit la région `allowed` à partir de `start` (déjà mouillé), sans dépasser le niveau `limit`. */
  const fillFrom = (start: string, allowed: (id: string) => boolean, limit: number) => {
    const heap = new MinHeap();
    const queued = new Set<string>();
    const pushNb = (u: string) => {
      for (const v of adj.get(u) ?? []) {
        if (rank.has(v) || queued.has(v) || !allowed(v)) continue;
        queued.add(v);
        heap.push(z(v), 0, v);
      }
    };
    /**
     * Débordement en `v` (niveau `lvl`) : chaque descente qui part de v forme
     * une cuvette ; l'eau y ruisselle jusqu'au point bas et la remplit par le
     * bas jusqu'au niveau de v. Ses bords plus hauts rejoignent ensuite la
     * montée générale.
     */
    const spill = (v: string, lvl: number) => {
      for (const w of adj.get(v) ?? []) {
        if (rank.has(w) || !allowed(w) || z(w) >= lvl) continue;
        const basin = new Set<string>([w]);
        const st = [w];
        while (st.length) {
          const x = st.pop()!;
          for (const y of adj.get(x) ?? []) {
            if (!basin.has(y) && !rank.has(y) && allowed(y) && z(y) < lvl) {
              basin.add(y);
              st.push(y);
            }
          }
        }
        let sink = w;
        for (const x of basin) if (z(x) < z(sink)) sink = x;
        wet(sink);
        fillFrom(sink, (id) => basin.has(id), lvl);
        const full = counter++;
        for (const y of adj.get(v) ?? []) if (basin.has(y)) edgeRank.set(ek(v, y), full);
        for (const x of basin) pushNb(x);
      }
    };
    spill(start, z(start));
    pushNb(start);
    while (heap.size) {
      const [zv, , v] = heap.pop();
      if (rank.has(v)) continue;
      if (zv > limit) break;
      wet(v);
      spill(v, zv);
      pushNb(v);
    }
  };

  wet(entry.id);
  fillFrom(entry.id, () => true, hmax);
  return segs
    .filter((s) => rank.has(s.u) && rank.has(s.v))
    .map((s) => ({ s, r: edgeRank.get(ek(s.u, s.v)) ?? Math.max(rank.get(s.u)!, rank.get(s.v)!) }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.s);
}

/**
 * Simule le remplissage. Avec `onlyBooster`, le réseau principal est supposé
 * déjà plein et seule la zone de ce booster se remplit.
 */
export function simulateFilling(net: Network, onlyBooster?: string): FillResult {
  const barPerM = (waterDensity(net.params.temperature_eau_c ?? 2) * G) / 1e5;
  const messages: string[] = [];
  const excludedLayers = new Set((net.calques ?? []).filter((l) => !l.calcul).map((l) => l.id));
  const okNode = (n: NetNode) => !excludedLayers.has(n.calque) && !(n.type === 'vanne' && !n.actif);
  const nodes = new Map(net.nodes.filter(okNode).map((n) => [n.id, n]));
  const zones = boosterZones(net);
  const zoneOf = new Map<string, string>();
  for (const [b, z] of zones) for (const id of z) zoneOf.set(id, b);

  // Tronçons élémentaires (entre sommets du tracé)
  const segs: Seg[] = [];
  let volumeTotal = 0;
  for (const p of net.pipes as Pipe[]) {
    if (p.statut === 'fermee' || excludedLayers.has(p.calque) || !nodes.has(p.amont) || !nodes.has(p.aval)) continue;
    const prof = pipeProfile(p, nodes);
    if (prof.length < 2) continue;
    const A = (Math.PI * (p.diametre_int_mm / 1000) ** 2) / 4;
    const zone = zoneOf.get(p.amont) ?? zoneOf.get(p.aval) ?? null;
    const vid = (k: number) => (k === 0 ? p.amont : k === prof.length - 1 ? p.aval : `${p.id}#${k}`);
    for (let k = 0; k < prof.length - 1; k++) {
      const volume = A * Math.max(prof[k + 1].s - prof[k].s, 0);
      volumeTotal += volume;
      segs.push({
        pipeId: p.id,
        u: vid(k),
        v: vid(k + 1),
        zu: prof[k].z,
        zv: prof[k + 1].z,
        a: [prof[k].lat, prof[k].lon],
        b: [prof[k + 1].lat, prof[k + 1].lon],
        volume,
        zone,
      });
    }
  }

  // Files de remplissage : réseau principal + une par booster
  interface Queue {
    id: string;
    order: Seg[];
    rate: number; // m³/s
    start: number;
    i: number;
    left: number;
    started: boolean;
    finished: boolean;
  }
  const queues: Queue[] = [];
  const sdms = [...nodes.values()].filter((n) => n.type === 'salle_machines' && n.en_marche !== false);
  const mainRate = sdms.reduce((a, n) => a + Math.max(n.debit_remplissage_m3h || 0, 0), 0) / 3600;
  if (!onlyBooster) {
    if (!sdms.length) messages.push('Aucune salle des machines en marche.');
    const hmax = Math.max(...sdms.map((n) => n.altitude_m + n.pression_consigne_bar / barPerM));
    const mainSegs = segs.filter((s) => !s.zone);
    // plusieurs usines : chacune remplit à partir de son point de départ
    const order: Seg[] = [];
    const seen = new Set<Seg>();
    for (const n of sdms) {
      for (const sg of floodOrder(mainSegs, { id: n.id, z: n.altitude_m }, hmax)) {
        if (!seen.has(sg)) {
          seen.add(sg);
          order.push(sg);
        }
      }
    }
    queues.push({ id: 'main', order, rate: mainRate, start: 0, i: 0, left: order[0]?.volume ?? 0, started: true, finished: !order.length });
    if (!(mainRate > 0) && order.length) messages.push('Débit de remplissage de l’usine nul : renseignez-le dans le panneau Pompage.');
  }
  for (const [b] of zones) {
    if (onlyBooster && b !== onlyBooster) continue;
    const bn = nodes.get(b);
    if (!bn || bn.en_marche === false) continue;
    const order = floodOrder(
      segs.filter((s) => s.zone === b),
      { id: b, z: bn.altitude_m },
      bn.altitude_m + bn.pression_consigne_bar / barPerM,
    );
    const rate = Math.max(bn.debit_remplissage_m3h || 0, 0) / 3600;
    if (!(rate > 0) && order.length) messages.push(`Débit de remplissage du booster ${bn.nom} nul : renseignez-le dans le panneau Pompage.`);
    queues.push({ id: b, order, rate, start: onlyBooster ? 0 : Infinity, i: 0, left: order[0]?.volume ?? 0, started: !!onlyBooster, finished: !order.length });
  }

  // Simulation à événements
  const segTime = new Map<Seg, number>();
  const nodeTime: Record<string, number> = {};
  for (const s of sdms) nodeTime[s.id] = 0;
  if (onlyBooster) nodeTime[onlyBooster] = 0;
  const setNode = (v: string, t: number) => {
    if (nodes.has(v) && !(nodeTime[v] <= t)) nodeTime[v] = t;
  };
  /** Début du remplissage d'un tronçon : l'eau atteint son point bas. */
  const begin = (s: Seg, t: number) => setNode(s.zu <= s.zv ? s.u : s.v, t);
  /** Tronçon plein : l'eau atteint son point haut. */
  const mark = (s: Seg, t: number) => {
    segTime.set(s, t);
    setNode(s.u, t);
    setNode(s.v, t);
  };
  for (const q of queues) if (q.started && q.order.length) begin(q.order[0], 0);
  let t = 0;
  const main = queues.find((q) => q.id === 'main');
  for (let guard = 0; guard < 1e6; guard++) {
    // départ des boosters dont le nœud est mouillé
    for (const q of queues) {
      if (!q.started && q.id !== 'main' && nodeTime[q.id] !== undefined && nodeTime[q.id] <= t) {
        q.started = true;
        q.start = nodeTime[q.id];
        if (q.order.length) begin(q.order[0], t);
      }
    }
    const active = queues.filter((q) => q.started && !q.finished);
    if (!active.length) break;
    // débits effectifs : les boosters prélèvent sur le débit de l'usine
    const rates = new Map<Queue, number>();
    const boostersActive = active.filter((q) => q.id !== 'main');
    const supply = onlyBooster ? Infinity : mainRate;
    let boosterSum = 0;
    for (const q of boostersActive) {
      const r = main && !main.finished ? Math.min(q.rate, supply * 0.9) : Math.min(q.rate, supply);
      rates.set(q, r);
      boosterSum += r;
    }
    if (main && !main.finished) rates.set(main, Math.max(mainRate - boosterSum, 0));
    let dt = Infinity;
    for (const q of active) {
      const r = rates.get(q) ?? 0;
      if (r > 0) dt = Math.min(dt, q.left / r);
    }
    if (!Number.isFinite(dt)) break; // plus rien ne peut avancer
    t += dt;
    for (const q of active) {
      const r = rates.get(q) ?? 0;
      q.left -= r * dt;
      while (!q.finished && q.left <= 1e-9) {
        mark(q.order[q.i], t);
        q.i += 1;
        if (q.i >= q.order.length) q.finished = true;
        else {
          q.left += q.order[q.i].volume;
          begin(q.order[q.i], t);
        }
      }
    }
  }

  const segments: FillSegment[] = segs.map((s) => ({ pipeId: s.pipeId, a: s.a, b: s.b, volume: s.volume, t: segTime.get(s) ?? Infinity }));
  const filled = segments.filter((s) => Number.isFinite(s.t));
  const total_s = filled.reduce((a, s) => Math.max(a, s.t), 0);
  const boosters: FillResult['boosters'] = {};
  for (const q of queues) {
    if (q.id === 'main') continue;
    const zs = segs.filter((s) => s.zone === q.id && segTime.has(s));
    boosters[q.id] = {
      depart_s: q.started ? q.start : Infinity,
      fin_s: zs.reduce((a, s) => Math.max(a, segTime.get(s)!), q.started ? q.start : Infinity),
      volume_m3: zs.reduce((a, s) => a + s.volume, 0),
    };
  }
  const bySector = new Map<string, { fin_s: number; canons: number; vides: number }>();
  for (const n of nodes.values()) {
    if (!isConsumer(n.type)) continue;
    const key = n.secteur || '(sans piste)';
    const e = bySector.get(key) ?? { fin_s: 0, canons: 0, vides: 0 };
    e.canons += 1;
    const tn = nodeTime[n.id];
    if (tn === undefined) e.vides += 1;
    else e.fin_s = Math.max(e.fin_s, tn);
    bySector.set(key, e);
  }
  const jamais = [...nodes.values()].filter((n) => n.type !== 'jonction' && nodeTime[n.id] === undefined && (!onlyBooster || zoneOf.get(n.id) === onlyBooster)).map((n) => n.id);
  if (jamais.length) messages.push(`${jamais.length} point(s) ne se remplissent pas : au-dessus du niveau d’eau possible ou derrière un booster arrêté.`);
  return {
    segments,
    nodeTime,
    total_s,
    volume_m3: filled.reduce((a, s) => a + s.volume, 0),
    volume_total_m3: volumeTotal,
    boosters,
    secteurs: [...bySector.entries()].map(([secteur, e]) => ({ secteur, ...e })).sort((a, b) => a.fin_s - b.fin_s),
    jamais,
    messages,
  };
}

/** « 1 h 05 min », « 12 min 30 s », « 45 s ». */
export function formatDuree(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(sec).padStart(2, '0')} s`;
  return `${sec} s`;
}
