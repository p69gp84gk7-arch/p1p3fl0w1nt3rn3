import { useStore } from '../store';
import { formatDuree } from '../hydraulics/remplissage';
import { fmt } from './display';
import { stopPressurize } from './pressurize';

/** Horloge affichée pendant la lecture d'un remplissage. */
export default function FillClock() {
  const filling = useStore((s) => s.filling);
  const sim = useStore((s) => s.fillSim);
  const t = useStore((s) => s.fillTime);
  const net = useStore((s) => s.net);
  if (!filling || !sim) return null;
  const vol = sim.segments.reduce((a, s) => (s.t <= t ? a + s.volume : a), 0);
  const station = net.nodes.find((n) => n.id === filling);
  return (
    <div className="fill-clock" role="status">
      <span>💧 Remplissage {station?.type === 'surpresseur' ? `ligne ${station.nom}` : 'du réseau'}</span>
      <b>{formatDuree(t)}</b>
      <span>
        {fmt(vol, 0)} / {fmt(sim.volume_m3, 0)} m³
      </span>
      <span className="bar">
        <i style={{ width: `${sim.total_s > 0 ? Math.min(100, (t / sim.total_s) * 100) : 0}%` }} />
      </span>
      <button onClick={stopPressurize}>■ Stop</button>
    </div>
  );
}
