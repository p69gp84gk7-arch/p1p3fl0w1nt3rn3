import { create } from 'zustand';
import { DEFAULT_PIPE_SPEC, emptyNetwork } from './model/defaults';
import { referenceNetwork } from './data/referenceNetwork';
import type { FillResult } from './hydraulics/remplissage';
import type { Network, NetNode, NodeType, Pipe, PipeSpec, SolveResult } from './model/types';
import { applyScenario, staticNetwork } from './model/scenario';
import { solve } from './hydraulics/solver';
import { loadLocalNetwork, loadSettings, saveLocalNetwork, saveSettings, setReferencePristine, type Settings } from './services/storage';
import { fetchElevations } from './services/elevation';

export type Tool =
  | { kind: 'select' }
  | { kind: 'move' }
  | { kind: 'add'; type: NodeType }
  | { kind: 'draw' }
  | { kind: 'reconnect'; pipeId: string; end: 'amont' | 'aval' }
  | { kind: 'split' };

export type Selection = { kind: 'node' | 'pipe'; id: string } | null;

export type ColorBy = 'statut' | 'pression' | 'remplissage' | 'vitesse' | 'calque' | 'diametre' | 'secteur';

/** Panneau ouvert par-dessus la carte sur téléphone. */
export type MobileSheet = null | 'affichage' | 'panneau' | 'tableaux' | 'outils';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

interface State {
  net: Network;
  results: SolveResult | null;
  stale: boolean;
  selection: Selection;
  tool: Tool;
  /** Calque sur lequel sont créés les nouveaux éléments. */
  activeLayer: string;
  /** Canalisation utilisée pour les nouveaux tracés. */
  drawSpec: PipeSpec;
  scenario: string;
  colorBy: ColorBy;
  settings: Settings;
  toasts: Toast[];
  past: Network[];
  future: Network[];
  busy: string | null;
  bottomTab: 'enneigeurs' | 'canalisations' | 'alertes' | 'profil' | null;
  profileTarget: string | null;
  /** Incrémenté pour recentrer la carte sur le réseau. */
  fitToken: number;
  /** Téléphone : panneau ouvert par-dessus la carte. */
  mobileSheet: MobileSheet;
  /** Mise en pression en cours (id de la station), le réseau se remplit en bleu. */
  filling: string | null;
  /** Dernière simulation de remplissage (temps de chargement). */
  fillSim: FillResult | null;
  /** Instant simulé affiché pendant la lecture du remplissage (s). */
  fillTime: number;

  /** Applique une modification (avec annulation). */
  commit(next: Network, label?: string): void;
  /** Modification sans entrée d'annulation (ex. altitude reçue). */
  patchSilently(fn: (n: Network) => Network): void;
  undo(): void;
  redo(): void;
  replaceNetwork(net: Network): void;
  updateNode(id: string, patch: Partial<NetNode>): void;
  updatePipe(id: string, patch: Partial<Pipe>): void;
  setSelection(s: Selection): void;
  setTool(t: Tool): void;
  set<K extends keyof State>(k: K, v: State[K]): void;
  toast(text: string, kind?: Toast['kind']): void;
  runCalc(statique?: boolean): SolveResult;
  /** Charge un scénario dans l'état des enneigeurs. */
  loadScenario(nom: string): void;
  updateSettings(p: Partial<Settings>): void;
  fillAltitudes(nodeIds?: string[], withVertices?: boolean): Promise<void>;
  /** Charge le réseau de référence de la station (fichiers intégrés). */
  loadReference(): Promise<void>;
}

let toastId = 0;
const savedNet = loadLocalNetwork();
const initialNet = savedNet ?? emptyNetwork();
/** Aucun réseau enregistré sur cet appareil : on charge celui de la station. */
export const firstVisit = savedNet === null;

export const useStore = create<State>((set, get) => ({
  net: initialNet,
  results: null,
  stale: true,
  selection: null,
  tool: { kind: 'select' },
  activeLayer: initialNet.calques[0]?.id ?? 'existant',
  drawSpec: DEFAULT_PIPE_SPEC,
  scenario: '',
  colorBy: 'statut',
  settings: loadSettings(),
  toasts: [],
  past: [],
  future: [],
  busy: null,
  bottomTab: null,
  profileTarget: null,
  fitToken: 0,
  mobileSheet: null,
  filling: null,
  fillSim: null,
  fillTime: 0,

  commit(next) {
    const { net, past } = get();
    set({ net: next, past: [...past.slice(-49), net], future: [], stale: true });
    saveLocalNetwork(next);
    setReferencePristine(false);
  },
  patchSilently(fn) {
    const next = fn(get().net);
    set({ net: next, stale: true });
    saveLocalNetwork(next);
  },
  undo() {
    const { past, net, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ net: prev, past: past.slice(0, -1), future: [net, ...future], stale: true });
    saveLocalNetwork(prev);
  },
  redo() {
    const { past, net, future } = get();
    if (!future.length) return;
    const nxt = future[0];
    set({ net: nxt, past: [...past, net], future: future.slice(1), stale: true });
    saveLocalNetwork(nxt);
  },
  replaceNetwork(net) {
    const { past } = get();
    set({
      net,
      past: [...past.slice(-49), get().net],
      future: [],
      results: null,
      stale: true,
      selection: null,
      fitToken: get().fitToken + 1,
      activeLayer: net.calques[0]?.id ?? 'existant',
      scenario: net.params.scenario_actif && net.scenarios.some((s) => s.nom === net.params.scenario_actif) ? net.params.scenario_actif : '',
    });
    saveLocalNetwork(net);
  },
  updateNode(id, patch) {
    const { net } = get();
    get().commit({ ...net, nodes: net.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
  },
  updatePipe(id, patch) {
    const { net } = get();
    get().commit({ ...net, pipes: net.pipes.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  },
  setSelection(selection) {
    set({ selection });
  },
  setTool(tool) {
    set({ tool });
  },
  set(k, v) {
    set({ [k]: v } as Partial<State>);
  },
  toast(text, kind = 'info') {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 8000 : 4000);
  },
  runCalc(statique = false) {
    const { net, scenario } = get();
    const r = statique
      ? solve(staticNetwork(net), { scenario: 'Pression statique' })
      : solve(net, { scenario: scenario || 'État actuel' });
    set({ results: r, stale: false });
    return r;
  },
  loadScenario(nom) {
    const { net } = get();
    const sc = net.scenarios.find((s) => s.nom === nom);
    if (sc) get().commit(applyScenario(net, sc));
    set({ scenario: nom });
  },
  updateSettings(p) {
    const s = { ...get().settings, ...p };
    saveSettings(s);
    set({ settings: s });
  },
  async loadReference() {
    set({ busy: 'Chargement du réseau de la station…' });
    try {
      get().replaceNetwork(await referenceNetwork());
      setReferencePristine(true);
    } catch (e) {
      get().toast(`Réseau de référence indisponible : ${(e as Error).message}`, 'error');
    } finally {
      set({ busy: null });
    }
  },
  async fillAltitudes(nodeIds, withVertices = false) {
    const { net, settings } = get();
    const targets = nodeIds ? net.nodes.filter((n) => nodeIds.includes(n.id)) : net.nodes;
    const pts: { lat: number; lon: number }[] = targets.map((n) => ({ lat: n.lat, lon: n.lon }));
    const vertexRefs: { pipe: string; i: number }[] = [];
    if (withVertices) {
      for (const p of net.pipes) {
        p.geometrie.forEach((g, i) => {
          vertexRefs.push({ pipe: p.id, i });
          pts.push({ lat: g[0], lon: g[1] });
        });
      }
    }
    if (!pts.length) return;
    const big = pts.length > 20;
    if (big) set({ busy: `Altitudes : 0 / ${pts.length}` });
    try {
      const z = await fetchElevations(pts, settings.elevationSource, (d, t) => big && set({ busy: `Altitudes : ${d} / ${t}` }));
      const zNodes = new Map(targets.map((n, i) => [n.id, z[i]]));
      const zVert = new Map<string, Map<number, number | null>>();
      vertexRefs.forEach((v, k) => {
        if (!zVert.has(v.pipe)) zVert.set(v.pipe, new Map());
        zVert.get(v.pipe)!.set(v.i, z[targets.length + k]);
      });
      let missing = 0;
      get().patchSilently((cur) => ({
        ...cur,
        nodes: cur.nodes.map((n) => {
          if (!zNodes.has(n.id)) return n;
          const v = zNodes.get(n.id);
          if (v == null) {
            missing++;
            return n;
          }
          return { ...n, altitude_m: Math.round(v * 10) / 10 };
        }),
        pipes: withVertices
          ? cur.pipes.map((p) => {
              const m = zVert.get(p.id);
              if (!m) return p;
              return { ...p, geometrie: p.geometrie.map((g, i) => [g[0], g[1], m.get(i) ?? g[2]] as typeof g) };
            })
          : cur.pipes,
      }));
      if (big) get().toast(`Altitudes mises à jour (${pts.length - missing} points).`, 'success');
      if (missing) get().toast(`${missing} altitude(s) introuvable(s) : à saisir manuellement.`, 'error');
    } catch (e) {
      get().toast(`Altitudes indisponibles : ${(e as Error).message}`, 'error');
    } finally {
      if (big) set({ busy: null });
    }
  },
}));
