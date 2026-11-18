import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { profilePath, profileSamples } from './profile';
import { fmt } from './display';

const BAR_PER_M = 0.0980638; // eau à 2 °C

export default function ProfileChart() {
  const net = useStore((s) => s.net);
  const results = useStore((s) => s.results);
  const target = useStore((s) => s.profileTarget);
  const selection = useStore((s) => s.selection);
  const st = useStore.getState;
  const [hover, setHover] = useState<number | null>(null);

  const path = useMemo(() => (target ? profilePath(net, target) : null), [net, target]);
  const samples = useMemo(() => (path ? profileSamples(net, path, results) : []), [net, path, results]);
  const targetNode = net.nodes.find((n) => n.id === target);

  if (!target || !targetNode) {
    return (
      <div className="empty">
        Sélectionnez un enneigeur puis cliquez sur « 📈 Profil en long » pour afficher le terrain et la ligne piézométrique depuis la salle des machines.
        {selection?.kind === 'node' && (
          <div>
            <button className="btn" onClick={() => st().set('profileTarget', selection.id)}>
              Afficher le profil de la sélection
            </button>
          </div>
        )}
      </div>
    );
  }
  if (!path || samples.length < 2) return <div className="empty">Aucun chemin entre une salle des machines et {targetNode.nom}.</div>;

  const W = 1000;
  const H = 230;
  const m = { l: 52, r: 16, t: 14, b: 28 };
  const Smax = samples[samples.length - 1].s || 1;
  const ys = samples.flatMap((p) => (p.H != null ? [p.z, p.H] : [p.z]));
  let ymin = Math.min(...ys);
  let ymax = Math.max(...ys);
  const pad = (ymax - ymin) * 0.08 || 10;
  ymin -= pad;
  ymax += pad;
  const x = (s: number) => m.l + ((W - m.l - m.r) * s) / Smax;
  const y = (z: number) => m.t + ((H - m.t - m.b) * (ymax - z)) / (ymax - ymin);
  const terrain = samples.map((p) => `${x(p.s)},${y(p.z)}`).join(' ');
  const hgl = samples.filter((p) => p.H != null).map((p) => `${x(p.s)},${y(p.H!)}`).join(' ');
  const ticks = niceTicks(ymin, ymax, 5);
  const xticks = niceTicks(0, Smax, 6);
  const nodesOnPath = samples.filter((p) => p.label);
  const h = hover != null ? samples[hover] : null;
  const pressures = samples.filter((p) => p.H != null).map((p) => (p.H! - p.z) * BAR_PER_M);

  return (
    <div className="profile">
      <div className="profile-head">
        <b>Profil : salle des machines → {targetNode.nom}</b>
        <span className="muted small">
          {fmt(Smax, 0)} m · dénivelé {fmt(Math.max(...samples.map((p) => p.z)) - Math.min(...samples.map((p) => p.z)), 0)} m
          {pressures.length > 0 && ` · pression ${fmt(Math.min(...pressures), 1)} à ${fmt(Math.max(...pressures), 1)} bar`}
        </span>
        <span className="legend inline">
          <i style={{ background: '#a68b6d' }} /> Terrain <i style={{ background: '#1c5c9e' }} /> Ligne piézométrique
        </span>
        {!results && <span className="muted small">— lancez un calcul pour la ligne piézométrique</span>}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="profile-svg"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const sx = ((e.clientX - rect.left) / rect.width) * W;
          const s = ((sx - m.l) / (W - m.l - m.r)) * Smax;
          let best = 0;
          samples.forEach((p, i) => Math.abs(p.s - s) < Math.abs(samples[best].s - s) && (best = i));
          setHover(best);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end" className="axis">
              {t.toFixed(0)}
            </text>
          </g>
        ))}
        {xticks.map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="axis">
            {t.toFixed(0)} m
          </text>
        ))}
        <polygon points={`${x(0)},${y(ymin)} ${terrain} ${x(Smax)},${y(ymin)}`} fill="#a68b6d" opacity={0.25} />
        <polyline points={terrain} fill="none" stroke="#a68b6d" strokeWidth={2} />
        {hgl && <polyline points={hgl} fill="none" stroke="#1c5c9e" strokeWidth={2.5} />}
        {nodesOnPath.map((p, i) => (
          <g key={i}>
            <line x1={x(p.s)} x2={x(p.s)} y1={y(p.z)} y2={y(p.z) + 6} stroke="#5d6d7e" />
            {nodesOnPath.length < 40 && (
              <text x={x(p.s)} y={y(p.z) + 16} textAnchor="middle" className="axis small">
                {p.label}
              </text>
            )}
          </g>
        ))}
        {h && (
          <g>
            <line x1={x(h.s)} x2={x(h.s)} y1={m.t} y2={H - m.b} stroke="#111827" strokeDasharray="3 3" />
            <circle cx={x(h.s)} cy={y(h.z)} r={4} fill="#a68b6d" />
            {h.H != null && <circle cx={x(h.s)} cy={y(h.H)} r={4} fill="#1c5c9e" />}
          </g>
        )}
        <text x={12} y={m.t + 4} className="axis" transform={`rotate(-90 12 ${m.t + 4})`} textAnchor="end">
          m
        </text>
      </svg>
      <div className="profile-readout small">
        {h ? (
          <>
            {h.label && <b>{h.label} · </b>}
            {fmt(h.s, 0)} m · terrain {fmt(h.z, 1)} m
            {h.H != null && (
              <>
                {' '}
                · charge {fmt(h.H, 1)} m · <b>{fmt((h.H - h.z) * BAR_PER_M, 1)} bar</b>
              </>
            )}
          </>
        ) : (
          <span className="muted">Survolez le graphique pour lire les valeurs.</span>
        )}
      </div>
    </div>
  );
}

function niceTicks(a: number, b: number, n: number): number[] {
  const span = b - a;
  if (span <= 0) return [a];
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= step0) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b; v += step) out.push(v);
  return out;
}
