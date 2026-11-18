// Lecture animée de la simulation de remplissage (chargement du réseau,
// canons fermés) : l'eau avance le long des canalisations reliées, avec les
// temps réels calculés à partir des volumes et des débits de remplissage.
// Pendant la lecture tout est bleu ; à la fin, le dégradé de pression
// (calcul statique) s'affiche.

import { useStore } from '../store';
import { simulateFilling, formatDuree } from '../hydraulics/remplissage';

let timer: number | undefined;

/** Durée de lecture à l'écran (ms), quelle que soit la durée réelle simulée. */
const PLAY_MS = 14000;
const FRAME_MS = 80;

export function stopPressurize() {
  window.clearInterval(timer);
  timer = undefined;
  useStore.getState().set('filling', null);
}

/**
 * Remplissage depuis l'usine (réseau vide au départ), ou seulement de la
 * zone d'un booster (réseau principal déjà plein).
 */
export function pressurize(stationId: string) {
  stopPressurize();
  const st = useStore.getState();
  const station = st.net.nodes.find((x) => x.id === stationId);
  if (!station) return;
  // point d'annulation + station en marche
  st.commit({ ...st.net, nodes: st.net.nodes.map((x) => (x.id === stationId ? { ...x, en_marche: true } : x)) });
  const sim = simulateFilling(useStore.getState().net, station.type === 'surpresseur' ? stationId : undefined);
  st.set('fillSim', sim);
  st.set('fillTime', 0);
  st.set('colorBy', 'remplissage');
  st.set('filling', stationId);
  if (!(sim.total_s > 0)) {
    stopPressurize();
    st.runCalc(true);
    st.toast(sim.messages[0] ?? 'Rien à remplir.', 'error');
    return;
  }
  const t0 = performance.now();
  timer = window.setInterval(() => {
    const f = Math.min((performance.now() - t0) / PLAY_MS, 1);
    useStore.getState().set('fillTime', sim.total_s * f);
    if (f >= 1) {
      stopPressurize();
      const s2 = useStore.getState();
      s2.runCalc(true);
      s2.set('fillTime', Infinity);
      s2.toast(
        `Réseau chargé en ${formatDuree(sim.total_s)} (${Math.round(sim.volume_m3)} m³).${sim.messages.length ? ' ' + sim.messages.join(' ') : ''}`,
        sim.jamais.length ? 'info' : 'success',
      );
    }
  }, FRAME_MS);
}
