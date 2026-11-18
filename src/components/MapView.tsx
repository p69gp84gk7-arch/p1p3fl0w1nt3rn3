import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { useStore } from '../store';
import { pipePath } from '../model/geo';
import { addNode, connect, nearestPipe, nodeMapOf, reconnect, splitPipe } from '../model/edit';
import type { GeoPoint, NetNode, Network, Pipe } from '../model/types';
import { BASE_LAYERS, binColor, categoryColor, DN_BINS, fmt, nodeIcon, PISTES_OVERLAY, pipeWeight, PRESSURE_BINS, STATUS_COLOR, VELOCITY_BINS } from './display';
import { NODE_LABEL } from '../model/defaults';
import { profilePath } from './profile';

const canvas = L.canvas({ tolerance: 8 });

/** Distance (m) correspondant à n pixels au zoom courant. */
function pxToMeters(map: L.Map, px: number): number {
  const c = map.getCenter();
  const p = map.latLngToContainerPoint(c);
  const q = map.containerPointToLatLng(L.point(p.x + px, p.y));
  return c.distanceTo(q);
}

interface Drawing {
  start: string;
  vertices: GeoPoint[];
}

export default function MapView() {
  const settings = useStore((s) => s.settings);
  const base = BASE_LAYERS.find((b) => b.id === settings.baseLayer) ?? BASE_LAYERS[0];
  return (
    <MapContainer center={[45.3, 6.5]} zoom={7} className="map" zoomControl={false} doubleClickZoom={false} maxZoom={21}>
      <TileLayer key={base.id} url={base.url} attribution={base.attribution} maxNativeZoom={base.maxNativeZoom} maxZoom={21} subdomains="abc" />
      {settings.showPistes && <TileLayer url={PISTES_OVERLAY.url} attribution={PISTES_OVERLAY.attribution} maxNativeZoom={18} maxZoom={21} zIndex={5} />}
      <NetworkLayers />
      <FitOnLoad />
      <ZoomButtons />
    </MapContainer>
  );
}

function ZoomButtons() {
  const map = useMap();
  const net = useStore((s) => s.net);
  return (
    <div className="map-zoom">
      <button title="Zoom avant" onClick={() => map.zoomIn()}>+</button>
      <button title="Zoom arrière" onClick={() => map.zoomOut()}>−</button>
      <button title="Recentrer sur le réseau" onClick={() => fitNetwork(map, net)}>⤢</button>
    </div>
  );
}

function fitNetwork(map: L.Map, net: Network) {
  const pts: L.LatLngExpression[] = net.nodes.map((n) => [n.lat, n.lon]);
  net.pipes.forEach((p) => p.geometrie.forEach((g) => pts.push([g[0], g[1]])));
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 17 });
}

function FitOnLoad() {
  const map = useMap();
  const net = useStore((s) => s.net);
  const fitToken = useStore((s) => s.fitToken);
  const done = useRef(-1);
  useEffect(() => {
    if (done.current === fitToken || !net.nodes.length) return;
    done.current = fitToken;
    fitNetwork(map, net);
  }, [fitToken, net, map]);
  return null;
}

function NetworkLayers() {
  const map = useMap();
  const net = useStore((s) => s.net);
  const results = useStore((s) => s.results);
  const stale = useStore((s) => s.stale);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const colorBy = useStore((s) => s.colorBy);
  const showLabels = useStore((s) => s.showLabels);
  const activeLayer = useStore((s) => s.activeLayer);
  const drawSpec = useStore((s) => s.drawSpec);
  const bottomTab = useStore((s) => s.bottomTab);
  const profileTarget = useStore((s) => s.profileTarget);
  const st = useStore.getState;

  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [cursor, setCursor] = useState<L.LatLng | null>(null);
  const [zoom, setZoom] = useState(map.getZoom());

  const layers = useMemo(() => new Map(net.calques.map((l) => [l.id, l])), [net.calques]);
  const nodes = useMemo(() => nodeMapOf(net), [net]);
  const visibleNode = (n: NetNode) => layers.get(n.calque)?.visible !== false;
  const visiblePipe = (p: Pipe) => layers.get(p.calque)?.visible !== false;
  const locked = (calque: string) => layers.get(calque)?.verrouille === true;

  const profile = useMemo(
    () => (bottomTab === 'profil' && profileTarget ? profilePath(net, profileTarget) : null),
    [bottomTab, profileTarget, net],
  );
  const profilePipes = useMemo(() => new Set(profile?.pipes ?? []), [profile]);

  useEffect(() => {
    if (tool.kind !== 'draw') setDrawing(null);
  }, [tool.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawing(null);
        if (st().tool.kind === 'reconnect') st().setTool({ kind: 'select' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st]);

  const layerFor = () => {
    const l = layers.get(activeLayer);
    if (l?.verrouille) {
      st().toast(`Le calque « ${l.nom} » est verrouillé.`, 'error');
      return null;
    }
    return activeLayer;
  };

  // ----- création d'un nœud (sur une canalisation si on clique dessus) -----
  const createNodeAt = (latlng: L.LatLng, pipeId?: string): NetNode | null => {
    if (tool.kind !== 'add') return null;
    const calque = layerFor();
    if (!calque) return null;
    const cur = st().net;
    const near = pipeId ? { pipe: cur.pipes.find((p) => p.id === pipeId)! } : nearestPipe(cur, latlng.lat, latlng.lng, pxToMeters(map, 10), visiblePipe);
    let res;
    if (near?.pipe) res = splitPipe(cur, near.pipe.id, latlng.lat, latlng.lng, tool.type, calque);
    else res = addNode(cur, tool.type, latlng.lat, latlng.lng, calque);
    if (!res) return null;
    st().commit(res.net);
    st().setSelection({ kind: 'node', id: res.node.id });
    void st().fillAltitudes([res.node.id]);
    st().toast(`${NODE_LABEL[tool.type]} ${res.node.nom} ajouté${near?.pipe ? ' sur la canalisation' : ''}.`, 'success');
    return res.node;
  };

  // ----- tracé de canalisation -----
  const nodeForDraw = (latlng: L.LatLng, nodeId?: string, pipeId?: string): string | null => {
    if (nodeId) return nodeId;
    const calque = layerFor();
    if (!calque) return null;
    const cur = st().net;
    const near = pipeId ? { pipe: cur.pipes.find((p) => p.id === pipeId)! } : nearestPipe(cur, latlng.lat, latlng.lng, pxToMeters(map, 8), visiblePipe);
    const res = near?.pipe ? splitPipe(cur, near.pipe.id, latlng.lat, latlng.lng, 'jonction', calque) : addNode(cur, 'jonction', latlng.lat, latlng.lng, calque);
    if (!res) return null;
    st().commit(res.net);
    void st().fillAltitudes([res.node.id]);
    return res.node.id;
  };

  const drawClick = (latlng: L.LatLng, nodeId?: string, pipeId?: string, finish = false) => {
    if (!drawing) {
      const start = nodeForDraw(latlng, nodeId, pipeId);
      if (start) setDrawing({ start, vertices: [] });
      return;
    }
    if (nodeId || pipeId || finish) {
      const end = nodeForDraw(latlng, nodeId, pipeId);
      if (!end || end === drawing.start) {
        setDrawing(null);
        return;
      }
      const calque = layerFor();
      if (!calque) return;
      const res = connect(st().net, drawing.start, end, drawing.vertices, drawSpec, calque);
      st().commit(res.net);
      st().setSelection({ kind: 'pipe', id: res.pipe.id });
      st().toast(`Canalisation ${res.pipe.nom} créée (${drawSpec.ref}). Cliquez pour en tracer une autre, Échap pour arrêter.`, 'success');
      setDrawing(null);
      return;
    }
    setDrawing({ ...drawing, vertices: [...drawing.vertices, [latlng.lat, latlng.lng, null]] });
  };

  useMapEvents({
    click(e) {
      if (tool.kind === 'add') createNodeAt(e.latlng);
      else if (tool.kind === 'draw') drawClick(e.latlng);
      else if (tool.kind === 'select' || tool.kind === 'move') st().setSelection(null);
    },
    dblclick(e) {
      if (tool.kind === 'draw' && drawing) drawClick(e.latlng, undefined, undefined, true);
    },
    mousemove(e) {
      if (tool.kind === 'draw' && drawing) setCursor(e.latlng);
    },
    zoomend() {
      setZoom(map.getZoom());
    },
  });

  const onNodeClick = (n: NetNode) => {
    if (tool.kind === 'draw') return drawClick(L.latLng(n.lat, n.lon), n.id);
    if (tool.kind === 'reconnect') {
      const p = st().net.pipes.find((x) => x.id === tool.pipeId);
      if (p && (tool.end === 'amont' ? p.aval : p.amont) === n.id) {
        st().toast('Les deux extrémités ne peuvent pas être le même nœud.', 'error');
        return;
      }
      st().commit(reconnect(st().net, tool.pipeId, tool.end, n.id));
      st().setTool({ kind: 'select' });
      st().setSelection({ kind: 'pipe', id: tool.pipeId });
      st().toast(`Extrémité ${tool.end} rattachée à ${n.nom || n.id}.`, 'success');
      return;
    }
    st().setSelection({ kind: 'node', id: n.id });
  };

  const onPipeClick = (p: Pipe, latlng: L.LatLng) => {
    if (tool.kind === 'add') return void createNodeAt(latlng, p.id);
    if (tool.kind === 'draw') return drawClick(latlng, undefined, p.id);
    if (tool.kind === 'split') {
      if (locked(p.calque)) return st().toast('Calque verrouillé.', 'error');
      const res = splitPipe(st().net, p.id, latlng.lat, latlng.lng, 'jonction');
      if (res) {
        st().commit(res.net);
        st().setSelection({ kind: 'node', id: res.node.id });
        void st().fillAltitudes([res.node.id]);
        st().toast('Canalisation coupée : une jonction a été insérée.', 'success');
      }
      return;
    }
    st().setSelection({ kind: 'pipe', id: p.id });
  };

  const onNodeDrag = (n: NetNode, latlng: L.LatLng) => {
    st().updateNode(n.id, { lat: latlng.lat, lon: latlng.lng });
    void st().fillAltitudes([n.id]);
  };

  // ----- couleurs -----
  const showRes = results && !stale ? results : results;
  const pipeColor = (p: Pipe): string => {
    const r = showRes?.pipes[p.id];
    switch (colorBy) {
      case 'calque':
        return layers.get(p.calque)?.couleur ?? '#1c5c9e';
      case 'diametre':
        return binColor(DN_BINS, p.dn);
      case 'vitesse':
        return r ? binColor(VELOCITY_BINS, r.vitesse_m_s) : '#1c5c9e';
      case 'pression':
        return r ? binColor(PRESSURE_BINS, r.pression_min_bar) : '#1c5c9e';
      case 'secteur': {
        const a = nodes.get(p.aval);
        return categoryColor(a?.secteur || nodes.get(p.amont)?.secteur || '');
      }
      default:
        return r ? STATUS_COLOR[r.statut] : layers.get(p.calque)?.couleur ?? '#1c5c9e';
    }
  };
  const nodeColor = (n: NetNode): string => {
    const r = showRes?.nodes[n.id];
    if (n.type === 'salle_machines') return '#1c3f6e';
    switch (colorBy) {
      case 'calque':
        return layers.get(n.calque)?.couleur ?? '#1c5c9e';
      case 'secteur':
        return categoryColor(n.secteur);
      case 'pression':
        return r ? binColor(PRESSURE_BINS, r.pression_bar) : '#5d6d7e';
      case 'diametre':
      case 'vitesse':
        return '#5d6d7e';
      default:
        if (!r) return n.type === 'enneigeur' ? '#2a7fc0' : '#5d6d7e';
        if (n.type === 'jonction' && r.statut === 'ok') return '#5d6d7e';
        return STATUS_COLOR[r.statut];
    }
  };

  const labelsOn = showLabels && zoom >= 15;
  const draggable = tool.kind === 'move';
  const startNode = drawing ? nodes.get(drawing.start) : undefined;

  return (
    <>
      {net.pipes.filter(visiblePipe).map((p) => {
        const path = pipePath(p, nodes);
        if (path.length < 2) return null;
        const sel = selection?.kind === 'pipe' && selection.id === p.id;
        const inProfile = profilePipes.has(p.id);
        const excluded = layers.get(p.calque)?.calcul === false;
        const w = pipeWeight(p.dn);
        const r = showRes?.pipes[p.id];
        return (
          <Polyline
            key={p.id + (sel ? '-s' : '') + (inProfile ? '-p' : '')}
            positions={path.map((g) => [g[0], g[1]] as [number, number])}
            renderer={canvas}
            bubblingMouseEvents={false}
            pathOptions={{
              color: sel ? '#111827' : inProfile ? '#7b4fb8' : pipeColor(p),
              weight: sel ? w + 3 : inProfile ? w + 2 : w,
              opacity: excluded ? 0.6 : 0.95,
              dashArray: p.statut === 'fermee' ? '2 8' : excluded ? '10 6' : undefined,
              lineCap: 'round',
            }}
            eventHandlers={{ click: (e) => onPipeClick(p, e.latlng) }}
          >
            <Tooltip sticky direction="top" opacity={0.95}>
              <strong>{p.nom || p.id}</strong> · DN{p.dn} {p.materiau}
              {r && Number.isFinite(r.pression_max_bar) && (
                <>
                  <br />
                  {fmt(Math.abs(r.debit_m3h), 1)} m³/h · {fmt(r.vitesse_m_s, 2)} m/s · {fmt(r.perte_m_km, 1)} m/km
                </>
              )}
            </Tooltip>
          </Polyline>
        );
      })}

      {net.nodes.filter(visibleNode).map((n) => {
        const sel = selection?.kind === 'node' && selection.id === n.id;
        const r = showRes?.nodes[n.id];
        const inactive = (n.type === 'enneigeur' || n.type === 'regard') && !n.actif;
        const closed = n.type === 'vanne' && !n.actif;
        return (
          <Marker
            key={n.id}
            position={[n.lat, n.lon]}
            icon={nodeIcon(n.type, nodeColor(n), sel, inactive || closed, labelsOn ? n.nom : undefined)}
            draggable={draggable && !locked(n.calque)}
            zIndexOffset={n.type === 'jonction' ? 0 : n.type === 'salle_machines' ? 1000 : 500}
            eventHandlers={{
              click: () => onNodeClick(n),
              dragend: (e) => onNodeDrag(n, (e.target as L.Marker).getLatLng()),
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
              <strong>{n.nom || n.id}</strong> · {NODE_LABEL[n.type]}
              {n.secteur && ` · ${n.secteur}`}
              <br />
              Alt. {fmt(n.altitude_m, 0)} m
              {r && Number.isFinite(r.pression_bar) && <> · {fmt(r.pression_bar, 1)} bar</>}
              {r && r.debit_m3h > 0 && <> · {fmt(r.debit_m3h, 1)} m³/h</>}
            </Tooltip>
          </Marker>
        );
      })}

      {drawing && startNode && (
        <Polyline
          positions={[
            [startNode.lat, startNode.lon],
            ...drawing.vertices.map((v) => [v[0], v[1]] as [number, number]),
            ...(cursor ? [[cursor.lat, cursor.lng] as [number, number]] : []),
          ]}
          pathOptions={{ color: '#7b4fb8', weight: 4, dashArray: '6 6' }}
          interactive={false}
        />
      )}
    </>
  );
}
