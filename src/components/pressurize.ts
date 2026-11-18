// Mise en pression progressive, réseau chargé et canons fermés.
//  • Usine : la pression monte de 0 à la consigne ; l'eau monte dans le réseau.
//  • Les zones alimentées par un booster (ex. Hount) se remplissent par le bas
//    dès que l'eau arrive au booster (il démarre alors tout seul).
//  • Booster : sa ligne se remplit par le bas, puis prend sa pression.
// Pendant le remplissage tout est bleu ; le dégradé de pression s'affiche à la fin.

import { useStore } from '../store';
import { boosterZones } from '../hydraulics/zones';

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
  useStore.getState().set('fillLevels', {});
}

/** Le booster pompe-t-il (eau arrivée, en marche) dans le dernier calcul ? */
function boosterPrimed(id: string): boolean {
  const st = useStore.getState();
  const n = st.net.nodes.find((x) => x.id === id);
  const r = st.results?.nodes[id];
  return !!n && n.en_marche !== false && !!r && Number.isFinite(r.pression_bar) && r.pression_bar >= 0;
}

/**
 * Lance la mise en pression de `stationId`. Pour l'usine, la pression va de
 * `from` à `to` ; pour un booster, sa ligne se remplit puis il prend `to`.
 */
export function pressurize(stationId: string, from: number, to: number, done?: () => void) {
  stopPressurize();
  const st = useStore.getState();
  const station = st.net.nodes.find((x) => x.id === stationId);
  if (!station) return;
  const isSdm = station.type === 'salle_machines';
  // point d'annulation + station en marche
  st.commit({ ...st.net, nodes: st.net.nodes.map((x) => (x.id === stationId ? { ...x, en_marche: true, pression_consigne_bar: isSdm ? x.pression_consigne_bar : to } : x)) });
  st.set('colorBy', 'remplissage');
  st.set('filling', stationId);

  // Zones des boosters et leur plage d'altitude.
  const net = useStore.getState().net;
  const zones = boosterZones(net);
  const zinfo = new Map<string, { zmin: number; zmax: number }>();
  for (const [b, zone] of zones) {
    const z = net.nodes.filter((n) => zone.has(n.id)).map((n) => n.altitude_m);
    if (z.length) zinfo.set(b, { zmin: Math.min(...z) - 1, zmax: Math.max(...z) + 1 });
  }
  // Niveau d'eau de chaque zone : vide au départ (sauf boosters non concernés lors d'un remplissage booster).
  const levels: Record<string, number> = {};
  for (const [b, info] of zinfo) levels[b] = isSdm || b === stationId ? info.zmin - 1000 : info.zmax + 1000;
  useStore.getState().set('fillLevels', { ...levels });

  const rampSteps = isSdm ? 60 : 0;
  const zoneSteps = 30;
  let k = 0;
  if (isSdm) setPressure(stationId, Math.round(from * 10) / 10);
  else useStore.getState().runCalc(true);

  timer = window.setInterval(() => {
    k += 1;
    if (k <= rampSteps) setPressure(stationId, Math.round((from + ((to - from) * k) / rampSteps) * 10) / 10);
    // Les zones dont le booster pompe se remplissent par le bas.
    let filling = false;
    for (const [b, info] of zinfo) {
      if (!boosterPrimed(b)) {
        levels[b] = info.zmin - 1000;
        continue;
      }
      if (levels[b] < info.zmin) levels[b] = info.zmin;
      if (levels[b] < info.zmax) {
        levels[b] = Math.min(info.zmax, levels[b] + (info.zmax - info.zmin) / zoneSteps);
        filling = true;
      }
    }
    useStore.getState().set('fillLevels', { ...levels });
    if (k >= rampSteps && !filling) {
      stopPressurize();
      done?.();
    }
    if (k > rampSteps + zoneSteps + 20) {
      stopPressurize();
      done?.();
    }
  }, 115);
}
