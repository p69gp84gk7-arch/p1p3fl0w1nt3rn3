// Opérations d'édition du réseau (pures : renvoient un nouveau réseau).

import { makeNode, makePipe, NODE_PREFIX } from './defaults';
import { haversine, nearestOnPolyline, interpAlt, pipePath } from './geo';
import { newId, nextName } from './ids';
import type { GeoPoint, Network, NetNode, NodeType, Pipe, PipeSpec } from './types';

export function nodeMapOf(net: Network) {
  return new Map(net.nodes.map((n) => [n.id, n]));
}

export function addNode(net: Network, type: NodeType, lat: number, lon: number, calque: string, extra: Partial<NetNode> = {}): { net: Network; node: NetNode } {
  const node = makeNode(type, lat, lon, net.params, {
    nom: nextName(NODE_PREFIX[type], net.nodes.map((n) => n.nom)),
    calque,
    ...extra,
  });
  return { net: { ...net, nodes: [...net.nodes, node] }, node };
}

/** Coupe une canalisation au point le plus proche de (lat, lon) et y insère un nœud. */
export function splitPipe(
  net: Network,
  pipeId: string,
  lat: number,
  lon: number,
  nodeOrType: NetNode | NodeType,
  calque?: string,
): { net: Network; node: NetNode } | null {
  const pipe = net.pipes.find((p) => p.id === pipeId);
  if (!pipe) return null;
  const nodes = nodeMapOf(net);
  const path = pipePath(pipe, nodes);
  const hit = nearestOnPolyline(lat, lon, path);
  if (!hit) return null;
  let node: NetNode;
  let base = net;
  if (typeof nodeOrType === 'string') {
    const alt = interpAlt(path[hit.index], path[hit.index + 1], hit.t);
    const r = addNode(net, nodeOrType, hit.lat, hit.lon, calque ?? pipe.calque, { altitude_m: alt ?? 0 });
    base = r.net;
    node = r.node;
  } else {
    node = nodeOrType;
    if (!base.nodes.some((n) => n.id === node.id)) base = { ...base, nodes: [...base.nodes, node] };
  }
  // path = [amont, ...geometrie, aval] ; segment hit.index entre path[i] et path[i+1]
  const geom = pipe.geometrie;
  const cut: GeoPoint = [hit.lat, hit.lon, interpAlt(path[hit.index], path[hit.index + 1], hit.t)];
  const before = geom.slice(0, hit.index);
  const after = geom.slice(hit.index);
  const offset = haversine(node.lat, node.lon, hit.lat, hit.lon) > 1;
  const ratio = totalLen(path) > 0 ? partialLen(path, hit.index, hit.t) / totalLen(path) : 0.5;
  const p1: Pipe = {
    ...pipe,
    id: newId('C'),
    nom: pipe.nom ? `${pipe.nom}-a` : '',
    aval: node.id,
    geometrie: offset ? [...before, cut] : before,
    longueur_m: pipe.longueur_auto ? 0 : pipe.longueur_m * ratio,
  };
  const p2: Pipe = {
    ...pipe,
    id: newId('C'),
    nom: pipe.nom ? `${pipe.nom}-b` : '',
    amont: node.id,
    geometrie: offset ? [cut, ...after] : after,
    longueur_m: pipe.longueur_auto ? 0 : pipe.longueur_m * (1 - ratio),
  };
  const pipes = base.pipes.flatMap((p) => (p.id === pipeId ? [p1, p2] : [p]));
  return { net: { ...base, pipes }, node };
}

function totalLen(path: GeoPoint[]) {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += haversine(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
  return L;
}
function partialLen(path: GeoPoint[], index: number, t: number) {
  let L = 0;
  for (let i = 1; i <= index; i++) L += haversine(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
  return L + t * haversine(path[index][0], path[index][1], path[index + 1][0], path[index + 1][1]);
}

export function connect(net: Network, amont: string, aval: string, vertices: GeoPoint[], spec: PipeSpec, calque: string): { net: Network; pipe: Pipe } {
  const pipe = makePipe(amont, aval, spec, {
    nom: nextName('C', net.pipes.map((p) => p.nom)),
    geometrie: vertices,
    calque,
  });
  return { net: { ...net, pipes: [...net.pipes, pipe] }, pipe };
}

/** Rattache une extrémité d'une canalisation à un autre nœud. */
export function reconnect(net: Network, pipeId: string, end: 'amont' | 'aval', nodeId: string): Network {
  return {
    ...net,
    pipes: net.pipes.map((p) => {
      if (p.id !== pipeId) return p;
      const other = end === 'amont' ? p.aval : p.amont;
      if (other === nodeId) return p;
      return { ...p, [end]: nodeId };
    }),
  };
}

export function reversePipe(net: Network, pipeId: string): Network {
  return {
    ...net,
    pipes: net.pipes.map((p) => (p.id === pipeId ? { ...p, amont: p.aval, aval: p.amont, geometrie: [...p.geometrie].reverse() } : p)),
  };
}

export function deleteNode(net: Network, nodeId: string): Network {
  return {
    ...net,
    nodes: net.nodes.filter((n) => n.id !== nodeId),
    pipes: net.pipes.filter((p) => p.amont !== nodeId && p.aval !== nodeId),
  };
}

export function deletePipe(net: Network, pipeId: string): Network {
  return { ...net, pipes: net.pipes.filter((p) => p.id !== pipeId) };
}

/** Supprime un nœud de passage (2 canalisations) en fusionnant les deux tronçons. */
export function mergeAtNode(net: Network, nodeId: string): Network | null {
  const touching = net.pipes.filter((p) => p.amont === nodeId || p.aval === nodeId);
  if (touching.length !== 2) return null;
  const node = net.nodes.find((n) => n.id === nodeId)!;
  const [a, b] = touching;
  const aGeom = a.aval === nodeId ? a.geometrie : [...a.geometrie].reverse();
  const aStart = a.aval === nodeId ? a.amont : a.aval;
  const bGeom = b.amont === nodeId ? b.geometrie : [...b.geometrie].reverse();
  const bEnd = b.amont === nodeId ? b.aval : b.amont;
  if (aStart === bEnd) return null;
  const merged: Pipe = {
    ...a,
    amont: aStart,
    aval: bEnd,
    geometrie: [...aGeom, [node.lat, node.lon, node.altitude_m || null], ...bGeom],
    longueur_m: a.longueur_auto && b.longueur_auto ? 0 : a.longueur_m + b.longueur_m,
    longueur_auto: a.longueur_auto && b.longueur_auto,
  };
  return {
    ...net,
    nodes: net.nodes.filter((n) => n.id !== nodeId),
    pipes: net.pipes.filter((p) => p.id !== a.id && p.id !== b.id).concat(merged),
  };
}

/** Oriente chaque canalisation dans le sens de l'écoulement calculé. */
export function orientByFlow(net: Network, flows: Record<string, { debit_m3h: number }>): Network {
  let out = net;
  for (const p of net.pipes) if ((flows[p.id]?.debit_m3h ?? 0) < -1e-9) out = reversePipe(out, p.id);
  return out;
}

/** Plus court chemin (en longueur) entre deux nœuds, canalisations ouvertes. */
export function shortestPath(net: Network, fromId: string, toId: string, lengths: Map<string, number>): { nodes: string[]; pipes: string[] } | null {
  const adj = new Map<string, { pipe: Pipe; other: string }[]>();
  for (const p of net.pipes) {
    if (p.statut === 'fermee') continue;
    (adj.get(p.amont) ?? adj.set(p.amont, []).get(p.amont)!).push({ pipe: p, other: p.aval });
    (adj.get(p.aval) ?? adj.set(p.aval, []).get(p.aval)!).push({ pipe: p, other: p.amont });
  }
  const dist = new Map<string, number>([[fromId, 0]]);
  const prev = new Map<string, { node: string; pipe: string }>();
  const done = new Set<string>();
  // Dijkstra simple (réseaux de quelques centaines de nœuds)
  while (true) {
    let u: string | null = null;
    let best = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < best) ((best = d), (u = k));
    if (u === null) return null;
    if (u === toId) break;
    done.add(u);
    for (const { pipe, other } of adj.get(u) ?? []) {
      const nd = best + (lengths.get(pipe.id) ?? 1);
      if (nd < (dist.get(other) ?? Infinity)) {
        dist.set(other, nd);
        prev.set(other, { node: u, pipe: pipe.id });
      }
    }
  }
  const nodes = [toId];
  const pipes: string[] = [];
  let cur = toId;
  while (cur !== fromId) {
    const p = prev.get(cur)!;
    pipes.unshift(p.pipe);
    nodes.unshift(p.node);
    cur = p.node;
  }
  return { nodes, pipes };
}

/** Recherche la canalisation la plus proche d'un point (en mètres). */
export function nearestPipe(net: Network, lat: number, lon: number, maxDist: number, visible?: (p: Pipe) => boolean) {
  const nodes = nodeMapOf(net);
  let best: { pipe: Pipe; distance: number } | null = null;
  for (const p of net.pipes) {
    if (visible && !visible(p)) continue;
    const hit = nearestOnPolyline(lat, lon, pipePath(p, nodes));
    if (hit && hit.distance <= maxDist && (!best || hit.distance < best.distance)) best = { pipe: p, distance: hit.distance };
  }
  return best;
}
