// Solveur hydraulique en régime permanent — méthode du gradient global
// (Todini & Pilati 1988, celle d'EPANET).
//
//  • Pertes de charge linéaires : Darcy-Weisbach, coefficient λ de
//    Swamee-Jain (turbulent) ou 64/Re (laminaire).
//  • Pertes de charge singulières : ΔH = K · V² / 2g.
//  • Salle des machines : nœud à charge imposée
//    H = altitude + pression de consigne.
//  • Enneigeurs : débit imposé, ou débit fonction de la pression
//    (buse : Q = k · √P), modélisé comme un émetteur EPANET.
//
// Les réseaux maillés comme ramifiés sont pris en charge.

import type { NetNode, Network, NodeResult, Pipe, SolveResult, ResultStatus } from '../model/types';
import { pipePath, dist3d } from '../model/geo';
import { effectiveFlow, isConsumer, isRegulator } from '../model/defaults';

export const G = 9.80665;

/** Masse volumique de l'eau (kg/m³) en fonction de la température (°C). */
export function waterDensity(T: number): number {
  // Formule de Kell simplifiée, suffisante entre 0 et 40 °C.
  return 1000 * (1 - ((T + 288.9414) / (508929.2 * (T + 68.12963))) * (T - 3.9863) ** 2);
}

/** Viscosité cinématique de l'eau (m²/s) en fonction de la température (°C). */
export function waterViscosity(T: number): number {
  const mu = 2.414e-5 * 10 ** (247.8 / (T + 133.15)); // Pa·s
  return mu / waterDensity(T);
}

/** Coefficient de frottement λ (Swamee-Jain). */
export function frictionFactor(Re: number, eps_m: number, D: number): number {
  if (Re < 2000) return 64 / Math.max(Re, 1e-9);
  const Ret = Math.max(Re, 4000);
  const f = 0.25 / Math.log10(eps_m / (3.7 * D) + 5.74 / Ret ** 0.9) ** 2;
  if (Re >= 4000) return f;
  // Zone de transition : interpolation linéaire entre laminaire et turbulent.
  const fl = 64 / 2000;
  return fl + ((f - fl) * (Re - 2000)) / 2000;
}

export interface SolverOptions {
  /** Nom du scénario (affichage uniquement, le réseau doit déjà être préparé). */
  scenario?: string;
  maxIterations?: number;
  /** Critère d'arrêt : Σ|ΔQ| / Σ|Q|. */
  accuracy?: number;
  /** Force le solveur linéaire (tests). */
  linear?: 'dense' | 'cg' | 'auto';
}

interface LinkCalc {
  /** perte de charge h(Q) (m) */
  h: number;
  /** dh/dQ */
  g: number;
}

/** Longueur hydraulique d'une canalisation (m). */
export function pipeLength(p: Pipe, nodes: Map<string, NetNode>): number {
  if (!p.longueur_auto && p.longueur_m > 0) return p.longueur_m;
  const path = pipePath(p, nodes);
  let L = 0;
  for (let i = 1; i < path.length; i++) L += dist3d(path[i - 1], path[i]);
  return L > 0 ? L : Math.max(p.longueur_m, 0.1);
}

function solveOnce(net: Network, opts: SolverOptions, passThrough: Set<string>): SolveResult {
  const maxIt = opts.maxIterations ?? 200;
  const accuracy = opts.accuracy ?? 1e-6;
  const T = net.params.temperature_eau_c ?? 2;
  const rho = waterDensity(T);
  const nu = waterViscosity(T);
  /** bar par mètre de colonne d'eau */
  const barPerM = (rho * G) / 1e5;

  const messages: string[] = [];
  const result: SolveResult = {
    ok: false,
    iterations: 0,
    converged: false,
    date: new Date().toISOString(),
    scenario: opts.scenario ?? '',
    nodes: {},
    pipes: {},
    messages,
    totals: { debit_total_m3h: 0, enneigeurs_actifs: 0, enneigeurs_ok: 0, enneigeurs_insuffisants: 0 },
  };

  // ---- Calques exclus du calcul ----
  const excludedLayers = new Set((net.calques ?? []).filter((l) => !l.calcul).map((l) => l.id));
  const closedValves = new Set(net.nodes.filter((n) => n.type === 'vanne' && !n.actif).map((n) => n.id));
  const calcNodes = net.nodes.filter((n) => !excludedLayers.has(n.calque) && !closedValves.has(n.id));
  const nodeMap = new Map(calcNodes.map((n) => [n.id, n]));
  const allNodeIds = new Set(net.nodes.map((n) => n.id));

  const sources = calcNodes.filter((n) => n.type === 'salle_machines');
  if (sources.length === 0) {
    messages.push('Aucune salle des machines dans les calques calculés : ajoutez-en une pour lancer le calcul.');
    return result;
  }

  // ---- Canalisations valides et ouvertes ----
  const pipes: Pipe[] = [];
  for (const p of net.pipes) {
    if (excludedLayers.has(p.calque)) continue;
    if (!allNodeIds.has(p.amont) || !allNodeIds.has(p.aval)) {
      messages.push(`Canalisation ${p.nom || p.id} : extrémité introuvable, ignorée.`);
      continue;
    }
    if (!nodeMap.has(p.amont) || !nodeMap.has(p.aval)) continue; // calque exclu ou vanne fermée
    if (p.amont === p.aval) {
      messages.push(`Canalisation ${p.nom || p.id} : les deux extrémités sont le même nœud, ignorée.`);
      continue;
    }
    if (!(p.diametre_int_mm > 0)) {
      messages.push(`Canalisation ${p.nom || p.id} : diamètre intérieur invalide, ignorée.`);
      continue;
    }
    if (p.statut === 'fermee') continue;
    pipes.push(p);
  }

  // ---- Connexité et aspiration des surpresseurs ----
  const adj = new Map<string, { pipe: Pipe; other: string }[]>();
  const link = (a: string, pipe: Pipe, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ pipe, other: b });
  };
  for (const p of pipes) {
    link(p.amont, p, p.aval);
    link(p.aval, p, p.amont);
  }
  // Régulateurs actifs (surpresseurs, réducteurs) ; ceux « by-passés » sont de simples jonctions.
  const boosters = calcNodes.filter((n) => isRegulator(n.type) && !passThrough.has(n.id));
  const boosterIds = new Set(boosters.map((b) => b.id));
  const aspiration = new Map<string, string>(); // booster id → pipe id
  for (const b of boosters) {
    if (b.aspiration && (adj.get(b.id) ?? []).some((e) => e.pipe.id === b.aspiration)) aspiration.set(b.id, b.aspiration);
  }
  const reached = new Set<string>();
  const queue = sources.map((s) => s.id);
  queue.forEach((s) => reached.add(s));
  while (queue.length) {
    const id = queue.shift()!;
    for (const { pipe, other } of adj.get(id) ?? []) {
      if (reached.has(other)) continue;
      reached.add(other);
      queue.push(other);
      if (boosterIds.has(other) && !aspiration.has(other)) aspiration.set(other, pipe.id);
    }
  }

  // ---- Indexation ----
  // Nœuds à charge imposée : salles des machines + refoulement des surpresseurs.
  const fixedHead = new Map<string, number>();
  for (const s of sources) fixedHead.set(s.id, s.altitude_m + s.pression_consigne_bar / barPerM);
  const activeBoosters = boosters.filter((b) => reached.has(b.id) && aspiration.has(b.id));
  for (const b of boosters) {
    if (reached.has(b.id) && !aspiration.has(b.id)) messages.push(`${b.nom || b.id} : aucune canalisation d'entrée identifiée.`);
  }
  for (const b of activeBoosters) fixedHead.set(b.id, b.altitude_m + b.pression_consigne_bar / barPerM);

  const junctions = calcNodes.filter((n) => reached.has(n.id) && !fixedHead.has(n.id));
  const jIndex = new Map<string, number>();
  junctions.forEach((n, i) => jIndex.set(n.id, i));
  // Nœud virtuel d'aspiration pour chaque surpresseur.
  const boosterInlet = new Map<string, number>();
  activeBoosters.forEach((b, k) => boosterInlet.set(b.id, junctions.length + k));
  const nJ = junctions.length + activeBoosters.length;

  const activePipes = pipes.filter((p) => reached.has(p.amont) && reached.has(p.aval));
  const nP = activePipes.length;

  // Caractéristiques des canalisations
  const L = new Float64Array(nP);
  const D = new Float64Array(nP);
  const A = new Float64Array(nP);
  const eps = new Float64Array(nP);
  const K = new Float64Array(nP);
  const from = new Int32Array(nP); // index jonction, ou -1 si charge imposée
  const to = new Int32Array(nP);
  const fromH = new Float64Array(nP);
  const toH = new Float64Array(nP);
  const endIndex = (p: Pipe, nodeId: string): number => {
    const b = boosterInlet.get(nodeId);
    if (b !== undefined && aspiration.get(nodeId) === p.id) return b;
    return jIndex.get(nodeId) ?? -1;
  };
  activePipes.forEach((p, k) => {
    L[k] = Math.max(pipeLength(p, nodeMap), 0.1);
    D[k] = p.diametre_int_mm / 1000;
    A[k] = (Math.PI * D[k] ** 2) / 4;
    eps[k] = Math.max(p.rugosite_mm, 0) / 1000;
    K[k] = Math.max(p.k_singulier || 0, 0);
    from[k] = endIndex(p, p.amont);
    to[k] = endIndex(p, p.aval);
    fromH[k] = from[k] < 0 ? fixedHead.get(p.amont)! : 0;
    toH[k] = to[k] < 0 ? fixedHead.get(p.aval)! : 0;
  });

  // Demandes et émetteurs
  const demand = new Float64Array(nJ); // m³/s
  const emitC = new Float64Array(nJ); // Q = C · √(H - z)
  junctions.forEach((n, i) => {
    if (isConsumer(n.type) && n.actif) {
      if (n.mode_debit === 'buse' && n.k_buse > 0) {
        emitC[i] = (n.k_buse / 3600) * Math.sqrt(barPerM);
      } else {
        demand[i] = Math.max(effectiveFlow(n), 0) / 3600;
      }
    }
  });
  const elev = new Float64Array(nJ);
  junctions.forEach((n, i) => (elev[i] = n.altitude_m));
  activeBoosters.forEach((b) => (elev[boosterInlet.get(b.id)!] = b.altitude_m));

  // Débit refoulé par chaque surpresseur = somme des débits sortant du nœud fixe.
  const boosterOut = activeBoosters.map((b) => {
    const terms: { k: number; sign: number }[] = [];
    activePipes.forEach((p, k) => {
      if (p.id === aspiration.get(b.id)) return;
      if (p.amont === b.id) terms.push({ k, sign: 1 });
      else if (p.aval === b.id) terms.push({ k, sign: -1 });
    });
    return terms;
  });

  // ---- Lois de perte de charge ----
  const calcPipe = (k: number, q: number): LinkCalc => {
    const aq = Math.abs(q);
    const V = aq / A[k];
    const Re = (V * D[k]) / nu;
    const minor = K[k] / (2 * G * A[k] * A[k]);
    if (Re < 2000) {
      const rl = (32 * nu * L[k]) / (G * D[k] * D[k] * A[k]);
      return { h: rl * q + minor * q * aq, g: rl + 2 * minor * aq };
    }
    const f = frictionFactor(Re, eps[k], D[k]);
    const r = (f * L[k]) / D[k] / (2 * G * A[k] * A[k]) + minor;
    return { h: r * q * aq, g: 2 * r * aq };
  };

  // ---- Initialisation ----
  const Q = new Float64Array(nP);
  for (let k = 0; k < nP; k++) Q[k] = A[k] * 0.3;
  const Qe = new Float64Array(nJ);
  for (let i = 0; i < nJ; i++) Qe[i] = emitC[i] > 0 ? emitC[i] * Math.sqrt(100) : 0;
  const H = new Float64Array(nJ);
  const maxSourceHead = Math.max(...fixedHead.values());
  H.fill(maxSourceHead);

  const solver = opts.linear === 'dense' || (opts.linear !== 'cg' && nJ <= 600) ? denseSolver(nJ) : sparseSolver(nJ);

  let converged = false;
  let it = 0;
  let relax = 1;
  let prevErr = Infinity;
  const Pk = new Float64Array(nP);
  const Yk = new Float64Array(nP);
  const Pe = new Float64Array(nJ);
  const Ye = new Float64Array(nJ);

  for (it = 1; it <= maxIt && nJ > 0; it++) {
    // Mise à jour de la demande d'aspiration des surpresseurs.
    let sumDB = 0;
    activeBoosters.forEach((b, k) => {
      let q = 0;
      for (const t of boosterOut[k]) q += t.sign * Q[t.k];
      const i = boosterInlet.get(b.id)!;
      sumDB += Math.abs(q - demand[i]);
      demand[i] = q;
    });

    solver.reset();
    const F = new Float64Array(nJ);
    for (let i = 0; i < nJ; i++) F[i] = -demand[i];

    for (let k = 0; k < nP; k++) {
      const { h, g } = calcPipe(k, Q[k]);
      const gg = Math.max(g, 1e-10);
      const p = 1 / gg;
      const y = h / gg;
      Pk[k] = p;
      Yk[k] = y;
      const i = from[k];
      const j = to[k];
      const qy = Q[k] - y;
      if (i >= 0) {
        solver.add(i, i, p);
        F[i] -= qy;
        if (j < 0) F[i] += p * toH[k];
      }
      if (j >= 0) {
        solver.add(j, j, p);
        F[j] += qy;
        if (i < 0) F[j] += p * fromH[k];
      }
      if (i >= 0 && j >= 0) solver.addOff(i, j, -p);
    }
    for (let i = 0; i < nJ; i++) {
      if (emitC[i] <= 0) continue;
      const c2 = emitC[i] * emitC[i];
      const q = Qe[i];
      const h = (q * Math.abs(q)) / c2;
      const g = Math.max((2 * Math.abs(q)) / c2, 1e-6);
      const p = 1 / g;
      const y = h / g;
      Pe[i] = p;
      Ye[i] = y;
      solver.add(i, i, p);
      F[i] += -(q - y) + p * elev[i];
    }

    const Hn = solver.solve(F);
    if (!Hn) {
      messages.push('Système hydraulique singulier : vérifiez la connexion des canalisations.');
      break;
    }
    H.set(Hn);

    let sumDQ = sumDB;
    let sumQ = 0;
    for (let k = 0; k < nP; k++) {
      const Hi = from[k] >= 0 ? H[from[k]] : fromH[k];
      const Hj = to[k] >= 0 ? H[to[k]] : toH[k];
      const qn = Q[k] - Yk[k] + Pk[k] * (Hi - Hj);
      const dq = qn - Q[k];
      Q[k] += relax * dq;
      sumDQ += Math.abs(dq);
      sumQ += Math.abs(Q[k]);
    }
    for (let i = 0; i < nJ; i++) {
      if (emitC[i] <= 0) continue;
      const qn = Qe[i] - Ye[i] + Pe[i] * (H[i] - elev[i]);
      const dq = qn - Qe[i];
      Qe[i] += relax * dq;
      sumDQ += Math.abs(dq);
      sumQ += Math.abs(Qe[i]);
    }
    const err = sumQ > 0 ? sumDQ / sumQ : sumDQ;
    if (err < accuracy) {
      converged = true;
      break;
    }
    // Sous-relaxation si la convergence stagne.
    if (it > 10 && err > prevErr * 0.95) relax = Math.max(0.3, relax * 0.8);
    prevErr = err;
  }
  if (nJ === 0) converged = true;
  result.iterations = Math.min(it, maxIt);
  result.converged = converged;
  if (!converged) messages.push(`Le calcul n'a pas convergé après ${maxIt} itérations : les résultats sont indicatifs.`);

  // ---- Résultats nœuds ----
  const headOf = (id: string): number | undefined => {
    if (fixedHead.has(id)) return fixedHead.get(id);
    const i = jIndex.get(id);
    return i === undefined ? undefined : H[i];
  };
  const modelMax = new Map(net.modeles.map((m) => [m.modele, m.pression_max_bar]));

  for (const n of net.nodes) {
    const hd = headOf(n.id);
    const msgs: string[] = [];
    const isGun = isConsumer(n.type) && n.actif;
    if (closedValves.has(n.id) && !excludedLayers.has(n.calque)) {
      result.nodes[n.id] = { id: n.id, charge_m: NaN, pression_bar: NaN, debit_m3h: 0, statut: 'ok', messages: ['Vanne fermée.'], vitesse_arrivee_m_s: NaN, debit_arrivee_m3h: 0 };
      continue;
    }
    if (excludedLayers.has(n.calque)) {
      result.nodes[n.id] = { id: n.id, charge_m: NaN, pression_bar: NaN, debit_m3h: 0, statut: 'isole', messages: ['Calque non inclus dans le calcul.'], vitesse_arrivee_m_s: NaN, debit_arrivee_m3h: 0 };
      continue;
    }
    if (hd === undefined) {
      result.nodes[n.id] = {
        id: n.id,
        charge_m: NaN,
        pression_bar: NaN,
        debit_m3h: 0,
        statut: 'isole',
        messages: [isGun ? "Non alimenté : aucun chemin ouvert jusqu'à une salle des machines." : 'Non relié au réseau alimenté.'],
        vitesse_arrivee_m_s: NaN,
        debit_arrivee_m3h: 0,
      };
      if (isGun) result.totals.enneigeurs_actifs += 1;
      continue;
    }
    const P = (hd - n.altitude_m) * barPerM;
    let q = 0;
    let statut: ResultStatus = 'ok';
    const i = jIndex.get(n.id);
    if (i !== undefined) q = (emitC[i] > 0 ? Qe[i] : demand[i]) * 3600;
    if (isGun) {
      result.totals.enneigeurs_actifs += 1;
      if (P < n.pression_min_bar) {
        statut = 'erreur';
        msgs.push(`Pression insuffisante : ${P.toFixed(1)} bar < ${n.pression_min_bar} bar requis.`);
        result.totals.enneigeurs_insuffisants += 1;
      } else {
        result.totals.enneigeurs_ok += 1;
      }
      const pmax = modelMax.get(n.modele);
      if (pmax && P > pmax) {
        if (statut === 'ok') statut = 'alerte';
        msgs.push(`Pression supérieure au maximum du modèle (${pmax} bar).`);
      }
    }
    if (P < 0) {
      statut = 'erreur';
      msgs.push('Pression négative : risque de dépression / cavitation.');
    }
    const r: NodeResult = { id: n.id, charge_m: hd, pression_bar: P, debit_m3h: q, statut, messages: msgs, vitesse_arrivee_m_s: NaN, debit_arrivee_m3h: 0 };
    const bi = boosterInlet.get(n.id);
    if (bi !== undefined) {
      const Pin = (H[bi] - n.altitude_m) * barPerM;
      r.pression_aspiration_bar = Pin;
      r.debit_m3h = demand[bi] * 3600;
      if (Pin < 0) {
        r.statut = 'erreur';
        msgs.push(`Pression d'entrée négative (${Pin.toFixed(1)} bar).`);
      }
      if (n.debit_max_m3h > 0 && r.debit_m3h > n.debit_max_m3h) {
        if (r.statut === 'ok') r.statut = 'alerte';
        msgs.push(`Débit ${r.debit_m3h.toFixed(0)} m³/h supérieur à la capacité ${n.debit_max_m3h} m³/h.`);
      }
    }
    result.nodes[n.id] = r;
  }

  // ---- Résultats canalisations ----
  const vmax = net.params.vitesse_max_m_s || 3;
  const pnFactor = 1 - (net.params.marge_pn_pct || 0) / 100;
  const sourceFlow = new Map<string, number>();
  const sourceIds = new Set(sources.map((s) => s.id));
  activePipes.forEach((p, k) => {
    const q = Q[k];
    const V = Math.abs(q) / A[k];
    const Ha = from[k] >= 0 ? H[from[k]] : fromH[k];
    const Hb = to[k] >= 0 ? H[to[k]] : toH[k];
    const hl = Ha - Hb;
    const msgs: string[] = [];
    let statut: ResultStatus = 'ok';
    // Profil de pression le long du tracé.
    const { pmin, pmax } = pressureAlong(p, nodeMap, Ha, Hb, barPerM);
    if (V > vmax) {
      statut = 'alerte';
      msgs.push(`Vitesse élevée : ${V.toFixed(2)} m/s > ${vmax} m/s.`);
    }
    if (p.pn_bar > 0 && pmax > p.pn_bar * pnFactor) {
      statut = 'erreur';
      msgs.push(`Pression ${pmax.toFixed(1)} bar supérieure à la PN ${p.pn_bar} bar.`);
    }
    if (pmin < 0) {
      statut = 'erreur';
      msgs.push(`Pression négative sur le tracé (${pmin.toFixed(1)} bar) : point haut à surveiller.`);
    }
    result.pipes[p.id] = {
      id: p.id,
      debit_m3h: q * 3600,
      vitesse_m_s: V,
      perte_charge_m: hl,
      perte_m_km: (Math.abs(hl) / L[k]) * 1000,
      charge_amont_m: Ha,
      charge_aval_m: Hb,
      pression_max_bar: pmax,
      pression_min_bar: pmin,
      statut,
      messages: msgs,
    };
    if (sourceIds.has(p.amont)) sourceFlow.set(p.amont, (sourceFlow.get(p.amont) ?? 0) + q * 3600);
    if (sourceIds.has(p.aval)) sourceFlow.set(p.aval, (sourceFlow.get(p.aval) ?? 0) - q * 3600);
  });
  for (const p of net.pipes) {
    if (result.pipes[p.id]) continue;
    const excluded = excludedLayers.has(p.calque) || !nodeMap.has(p.amont) || !nodeMap.has(p.aval);
    result.pipes[p.id] = {
      id: p.id,
      debit_m3h: 0,
      vitesse_m_s: 0,
      perte_charge_m: 0,
      perte_m_km: 0,
      charge_amont_m: NaN,
      charge_aval_m: NaN,
      pression_max_bar: NaN,
      pression_min_bar: NaN,
      statut: p.statut === 'fermee' && !excluded ? 'ok' : 'isole',
      messages: [excluded ? 'Calque non inclus dans le calcul.' : p.statut === 'fermee' ? 'Canalisation fermée.' : 'Non alimentée.'],
    };
  }

  for (const s of sources) {
    const q = sourceFlow.get(s.id) ?? 0;
    const r = result.nodes[s.id];
    r.debit_m3h = q;
    result.totals.debit_total_m3h += q;
    if (s.debit_max_m3h > 0 && q > s.debit_max_m3h) {
      r.statut = 'alerte';
      r.messages.push(`Débit demandé ${q.toFixed(0)} m³/h supérieur à la capacité ${s.debit_max_m3h} m³/h.`);
    }
    if (q < -1e-6) {
      r.statut = 'alerte';
      r.messages.push("De l'eau remonte vers cette salle des machines (débit négatif).");
    }
  }

  result.ok = converged;
  return result;
}

/**
 * Calcul hydraulique complet. Les régulateurs (surpresseurs, réducteurs de
 * pression) sont d'abord supposés actifs (pression de sortie = consigne) ;
 * ceux dont l'état est incohérent sont ensuite basculés en « by-pass »
 * (simple passage), comme le fait EPANET, jusqu'à stabilisation.
 */
export function solve(net: Network, opts: SolverOptions = {}): SolveResult {
  const regulators = net.nodes.filter((n) => isRegulator(n.type));
  let pass = new Set<string>();
  let r = solveOnce(net, opts, pass);
  const tol = 0.01; // bar
  for (let round = 0; round < 8 && regulators.length; round++) {
    const next = new Set(pass);
    for (const n of regulators) {
      const res = r.nodes[n.id];
      if (!res || !Number.isFinite(res.pression_bar)) continue;
      const set = n.pression_consigne_bar;
      if (!pass.has(n.id)) {
        const Pin = res.pression_aspiration_bar;
        if (Pin === undefined) continue;
        if (n.type === 'surpresseur' && Pin > set + tol) next.add(n.id);
        if (n.type === 'reducteur' && Pin < set - tol) next.add(n.id);
      } else {
        if (n.type === 'surpresseur' && res.pression_bar < set - tol) next.delete(n.id);
        if (n.type === 'reducteur' && res.pression_bar > set + tol) next.delete(n.id);
      }
    }
    if (next.size === pass.size && [...next].every((x) => pass.has(x))) break;
    pass = next;
    r = solveOnce(net, opts, pass);
  }
  // Vitesse et débit d'arrivée à chaque nœud (canalisations qui l'alimentent).
  for (const p of net.pipes) {
    const pr = r.pipes[p.id];
    if (!pr || !(Math.abs(pr.debit_m3h) > 1e-9)) continue;
    const dest = r.nodes[pr.debit_m3h > 0 ? p.aval : p.amont];
    if (!dest) continue;
    dest.debit_arrivee_m3h += Math.abs(pr.debit_m3h);
    dest.vitesse_arrivee_m_s = Number.isFinite(dest.vitesse_arrivee_m_s) ? Math.max(dest.vitesse_arrivee_m_s, pr.vitesse_m_s) : pr.vitesse_m_s;
  }
  for (const n of net.nodes) {
    const nr = r.nodes[n.id];
    if (nr && !Number.isFinite(nr.vitesse_arrivee_m_s) && Number.isFinite(nr.pression_bar)) nr.vitesse_arrivee_m_s = 0;
  }
  for (const id of pass) {
    const n = regulators.find((x) => x.id === id)!;
    const res = r.nodes[id];
    if (!res) continue;
    res.messages.push(
      n.type === 'surpresseur'
        ? "Surpresseur à l'arrêt : la pression d'arrivée dépasse déjà la consigne (by-pass)."
        : "Réducteur grand ouvert : la pression d'arrivée est inférieure à la consigne.",
    );
  }
  return r;
}

/** Pression min/max le long du tracé, ligne piézométrique supposée linéaire. */
export function pressureAlong(
  p: Pipe,
  nodes: Map<string, NetNode>,
  Ha: number,
  Hb: number,
  barPerM: number,
): { pmin: number; pmax: number } {
  const prof = pipeProfile(p, nodes);
  let pmin = Infinity;
  let pmax = -Infinity;
  const Ltot = prof.length ? prof[prof.length - 1].s : 0;
  for (const pt of prof) {
    const Hs = Ltot > 0 ? Ha + ((Hb - Ha) * pt.s) / Ltot : Ha;
    const P = (Hs - pt.z) * barPerM;
    pmin = Math.min(pmin, P);
    pmax = Math.max(pmax, P);
  }
  return { pmin, pmax };
}

export interface ProfilePoint {
  /** abscisse curviligne (m) */
  s: number;
  /** altitude du terrain (m) */
  z: number;
  lat: number;
  lon: number;
}

/** Profil en long d'une canalisation (altitudes manquantes interpolées). */
export function pipeProfile(p: Pipe, nodes: Map<string, NetNode>): ProfilePoint[] {
  const a = nodes.get(p.amont);
  const b = nodes.get(p.aval);
  if (!a || !b) return [];
  const pts: { lat: number; lon: number; z: number | null }[] = [
    { lat: a.lat, lon: a.lon, z: a.altitude_m },
    ...p.geometrie.map((g) => ({ lat: g[0], lon: g[1], z: g[2] })),
    { lat: b.lat, lon: b.lon, z: b.altitude_m },
  ];
  const s: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    s.push(s[i - 1] + dist3d([pts[i - 1].lat, pts[i - 1].lon, null], [pts[i].lat, pts[i].lon, null]));
  }
  // interpolation des altitudes inconnues
  const z: number[] = pts.map((pt) => (pt.z == null ? NaN : pt.z));
  for (let i = 1; i < z.length - 1; i++) {
    if (!Number.isNaN(z[i])) continue;
    let j = i + 1;
    while (j < z.length && Number.isNaN(z[j])) j++;
    const z0 = z[i - 1];
    const z1 = z[j] ?? z0;
    const s0 = s[i - 1];
    const s1 = s[j] ?? s0;
    for (let k = i; k < j; k++) z[k] = s1 > s0 ? z0 + ((z1 - z0) * (s[k] - s0)) / (s1 - s0) : z0;
    i = j - 1;
  }
  // mise à l'échelle sur la longueur hydraulique si saisie manuellement
  const Lh = pipeLength(p, nodes);
  const Lg = s[s.length - 1];
  const k = Lg > 0 ? Lh / Lg : 1;
  return pts.map((pt, i) => ({ s: s[i] * k, z: z[i], lat: pt.lat, lon: pt.lon }));
}

// ---------------------------------------------------------------------------
// Solveurs linéaires (matrice symétrique définie positive)
// ---------------------------------------------------------------------------

interface LinearSolver {
  reset(): void;
  add(i: number, j: number, v: number): void;
  addOff(i: number, j: number, v: number): void;
  solve(b: Float64Array): Float64Array | null;
}

/** Cholesky dense — robuste, pour les réseaux jusqu'à quelques centaines de nœuds. */
function denseSolver(n: number): LinearSolver {
  const M = new Float64Array(n * n);
  return {
    reset() {
      M.fill(0);
    },
    add(i, j, v) {
      M[i * n + j] += v;
    },
    addOff(i, j, v) {
      M[i * n + j] += v;
      M[j * n + i] += v;
    },
    solve(b) {
      // Factorisation en place : M = L·Lᵀ (triangle inférieur)
      for (let j = 0; j < n; j++) {
        let d = M[j * n + j];
        for (let k = 0; k < j; k++) d -= M[j * n + k] ** 2;
        if (!(d > 0)) return null;
        const ljj = Math.sqrt(d);
        M[j * n + j] = ljj;
        for (let i = j + 1; i < n; i++) {
          let s = M[i * n + j];
          const ri = i * n;
          const rj = j * n;
          for (let k = 0; k < j; k++) s -= M[ri + k] * M[rj + k];
          M[ri + j] = s / ljj;
        }
      }
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let s = b[i];
        for (let k = 0; k < i; k++) s -= M[i * n + k] * y[k];
        y[i] = s / M[i * n + i];
      }
      const x = new Float64Array(n);
      for (let i = n - 1; i >= 0; i--) {
        let s = y[i];
        for (let k = i + 1; k < n; k++) s -= M[k * n + i] * x[k];
        x[i] = s / M[i * n + i];
      }
      return x;
    },
  };
}

/** Gradient conjugué préconditionné (Jacobi) — pour les grands réseaux. */
function sparseSolver(n: number): LinearSolver {
  const diag = new Float64Array(n);
  let rows: Map<number, number>[] = [];
  let last: Float64Array | null = null;
  return {
    reset() {
      diag.fill(0);
      rows = Array.from({ length: n }, () => new Map());
    },
    add(i, j, v) {
      if (i === j) diag[i] += v;
      else rows[i].set(j, (rows[i].get(j) ?? 0) + v);
    },
    addOff(i, j, v) {
      rows[i].set(j, (rows[i].get(j) ?? 0) + v);
      rows[j].set(i, (rows[j].get(i) ?? 0) + v);
    },
    solve(b) {
      const cols: Int32Array[] = [];
      const vals: Float64Array[] = [];
      for (let i = 0; i < n; i++) {
        cols.push(Int32Array.from(rows[i].keys()));
        vals.push(Float64Array.from(rows[i].values()));
        if (!(diag[i] > 0)) return null;
      }
      const mul = (x: Float64Array, out: Float64Array) => {
        for (let i = 0; i < n; i++) {
          let s = diag[i] * x[i];
          const c = cols[i];
          const v = vals[i];
          for (let k = 0; k < c.length; k++) s += v[k] * x[c[k]];
          out[i] = s;
        }
      };
      const x = last && last.length === n ? Float64Array.from(last) : new Float64Array(n);
      const r = new Float64Array(n);
      const z = new Float64Array(n);
      const p = new Float64Array(n);
      const Ap = new Float64Array(n);
      mul(x, Ap);
      let bnorm = 0;
      for (let i = 0; i < n; i++) {
        r[i] = b[i] - Ap[i];
        z[i] = r[i] / diag[i];
        p[i] = z[i];
        bnorm += b[i] * b[i];
      }
      bnorm = Math.sqrt(bnorm) || 1;
      let rz = 0;
      for (let i = 0; i < n; i++) rz += r[i] * z[i];
      const maxIt = 10 * n + 100;
      for (let it = 0; it < maxIt; it++) {
        mul(p, Ap);
        let pAp = 0;
        for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
        if (pAp <= 0) break;
        const alpha = rz / pAp;
        let rn = 0;
        for (let i = 0; i < n; i++) {
          x[i] += alpha * p[i];
          r[i] -= alpha * Ap[i];
          rn += r[i] * r[i];
        }
        if (Math.sqrt(rn) / bnorm < 1e-13) break;
        let rzn = 0;
        for (let i = 0; i < n; i++) {
          z[i] = r[i] / diag[i];
          rzn += r[i] * z[i];
        }
        const beta = rzn / rz;
        rz = rzn;
        for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
      }
      last = x;
      return x;
    },
  };
}
