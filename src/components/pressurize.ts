// Mise en pression progressive d'une station (usine ou booster), réseau
// chargé et canons fermés : on voit l'eau monter dans les canalisations.

import { useStore } from '../store';

let timer: number | undefined;

function setPressure(id: string, bar: number) {
  const st = useStore.getState();
  st.patchSilently((cur) => ({ ...cur, nodes: cur.nodes.map((x) => (x.id === id ? { ...x, pression_consigne_bar: bar } : x)) }));
  st.runCalc(true);
}

export function stopPressurize() {
  window.clearInterval(timer);
  timer = undefined;
  useStore.getState().set('filling', null);
}

/** Fait monter la pression de `stationId` de `from` à `to` bar (≈ 7 s). */
export function pressurize(stationId: string, from: number, to: number, done?: () => void) {
  stopPressurize();
  const st = useStore.getState();
  // point d'annulation + station en marche
  st.commit({ ...st.net, nodes: st.net.nodes.map((x) => (x.id === stationId ? { ...x, en_marche: true } : x)) });
  st.set('colorBy', 'remplissage');
  st.set('filling', stationId);
  const steps = 60;
  let k = 0;
  setPressure(stationId, Math.round(from * 10) / 10);
  timer = window.setInterval(() => {
    k += 1;
    setPressure(stationId, Math.round((from + ((to - from) * k) / steps) * 10) / 10);
    if (k >= steps) {
      stopPressurize();
      done?.();
    }
  }, 115);
}
