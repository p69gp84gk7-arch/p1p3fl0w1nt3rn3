import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { buildNetwork, guessNodeType, iconName, mergeKml, readKmlFile, type KmlContent } from '../import/kmz';
import { applyFlowTable, readFlowTable, type FlowRow } from '../import/csv';
import { DEFAULT_MODELES, DEFAULT_PIPE_SPEC, LAYER_COLORS, NODE_LABEL, NODE_TYPES, emptyNetwork } from '../model/defaults';
import { nearestPipe, splitPipe } from '../model/edit';
import { newId } from '../model/ids';
import type { Couronnes, Layer, Network, NodeType, PipeSpec } from '../model/types';
import { COURONNES } from '../model/types';
import { normalizeNetwork } from '../services/storage';
import Modal from './Modal';

type PType = NodeType | 'ignorer';

interface Loaded {
  kml: KmlContent | null;
  flows: FlowRow[] | null;
  json: Network | null;
  files: string[];
}

export default function ImportDialog({ onClose }: { onClose: () => void }) {
  const net = useStore((s) => s.net);
  const st = useStore.getState;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const readFiles = async (files: FileList | File[]) => {
    setError(null);
    const list = Array.from(files);
    const kmls: KmlContent[] = [];
    let flows: FlowRow[] | null = null;
    let json: Network | null = null;
    try {
      for (const f of list) {
        if (/\.(kmz|kml)$/i.test(f.name)) kmls.push(await readKmlFile(f, f.name));
        else if (/\.(csv|txt|tsv)$/i.test(f.name)) flows = readFlowTable(await f.text());
        else if (/\.json$/i.test(f.name)) json = normalizeNetwork(JSON.parse(await f.text()));
        else throw new Error(`Format non reconnu : ${f.name}`);
      }
      setLoaded({ kml: kmls.length ? mergeKml(kmls) : null, flows, json, files: list.map((f) => f.name) });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="Importer des données" onClose={onClose} wide>
      {!loaded ? (
        <div
          className={`dropzone ${drag ? 'drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void readFiles(e.dataTransfer.files);
          }}
        >
          <div className="dropzone-icon">📂</div>
          <p>
            <b>Glissez vos fichiers ici</b> ou
          </p>
          <label className="btn primary">
            Choisir des fichiers
            <input type="file" multiple accept=".kmz,.kml,.csv,.json,.txt" hidden onChange={(e) => e.target.files && readFiles(e.target.files)} />
          </label>
          <ul className="small muted formats">
            <li>
              <b>.kmz / .kml</b> (Google Earth) : canons, regards, salles des machines (points) et canalisations (lignes). Vous pouvez en sélectionner plusieurs à la fois.
            </li>
            <li>
              <b>.csv</b> : débits par canon (colonnes pistes, n°, c1, c1+c2, c1+c3, c1+c2+c3, types…) rattachés par numéro.
            </li>
            <li>
              <b>.json</b> : sauvegarde complète exportée depuis PipeFlow Neige.
            </li>
          </ul>
          {error && <div className="notice error">{error}</div>}
        </div>
      ) : loaded.json ? (
        <div>
          <p>
            Sauvegarde : <b>{loaded.json.params.nom_projet}</b> — {loaded.json.nodes.length} nœuds, {loaded.json.pipes.length} canalisations.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setLoaded(null)}>
              Retour
            </button>
            <button
              className="btn primary"
              onClick={() => {
                st().replaceNetwork(loaded.json!);
                st().toast('Réseau importé.', 'success');
                onClose();
              }}
            >
              Remplacer le réseau actuel
            </button>
          </div>
        </div>
      ) : loaded.kml ? (
        <KmlConfig loaded={loaded} net={net} onBack={() => setLoaded(null)} onDone={onClose} />
      ) : loaded.flows ? (
        <FlowsOnly flows={loaded.flows} onBack={() => setLoaded(null)} onDone={onClose} />
      ) : null}
    </Modal>
  );
}

function StagePicker({ value, onChange }: { value: Couronnes; onChange: (c: Couronnes) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Couronnes)}>
      {COURONNES.map((c) => (
        <option key={c} value={c}>
          {c.toUpperCase()}
        </option>
      ))}
      <option value="">Débit manuel</option>
    </select>
  );
}

function FlowsOnly({ flows, onBack, onDone }: { flows: FlowRow[]; onBack: () => void; onDone: () => void }) {
  const net = useStore((s) => s.net);
  const st = useStore.getState;
  const [stage, setStage] = useState<Couronnes>('c1+c2+c3');
  const preview = useMemo(() => applyFlowTable(net, flows, stage), [net, flows, stage]);
  return (
    <div>
      <p>
        {flows.length} lignes de débits lues. <b>{preview.report.rattaches}</b> enneigeurs du réseau reconnus par leur numéro.
      </p>
      {preview.report.nonTrouves.length > 0 && <p className="small muted">Absents du réseau : {preview.report.nonTrouves.join(', ')}</p>}
      {preview.report.sansDonnees.length > 0 && <p className="small muted">Enneigeurs sans débit dans le fichier : {preview.report.sansDonnees.slice(0, 40).join(', ')}</p>}
      <label className="field">
        <span className="field-label">Couronnes utilisées pour le calcul</span>
        <StagePicker value={stage} onChange={setStage} />
      </label>
      <div className="modal-actions">
        <button className="btn" onClick={onBack}>
          Retour
        </button>
        <button
          className="btn primary"
          disabled={!preview.report.rattaches}
          onClick={() => {
            st().commit({ ...net, nodes: preview.nodes, modeles: preview.modeles });
            st().toast(`Débits appliqués à ${preview.report.rattaches} enneigeurs.`, 'success');
            onDone();
          }}
        >
          Appliquer les débits
        </button>
      </div>
    </div>
  );
}

function defaultCategoryType(kml: KmlContent, category: string): PType {
  const pts = kml.points.filter((p) => p.category === category);
  const numeric = pts.filter((p) => /^\d+\s*[a-z]?$/i.test(p.name.trim())).length;
  if (numeric >= pts.length / 2) return 'enneigeur';
  const g = guessNodeType(category);
  return g === 'enneigeur' ? (/canon|enneig/i.test(category) ? 'enneigeur' : 'jonction') : g;
}

function KmlConfig({ loaded, net, onBack, onDone }: { loaded: Loaded; net: Network; onBack: () => void; onDone: () => void }) {
  const kml = loaded.kml!;
  const st = useStore.getState;
  const hasNet = net.nodes.length > 0;
  const categories = useMemo(() => {
    const m = new Map<string, { icon: string; folder: string; idx: number[] }>();
    kml.points.forEach((p, i) => {
      if (!m.has(p.category)) m.set(p.category, { icon: p.icon, folder: p.folder, idx: [] });
      m.get(p.category)!.idx.push(i);
    });
    return [...m.entries()];
  }, [kml]);
  const lineFolders = useMemo(() => {
    const m = new Map<string, number>();
    kml.lines.forEach((l) => m.set(l.folder, (m.get(l.folder) ?? 0) + 1));
    return [...m.entries()];
  }, [kml]);

  const [mode, setMode] = useState<'remplacer' | 'ajouter'>(hasNet ? 'ajouter' : 'remplacer');
  const [layerChoice, setLayerChoice] = useState<string>(hasNet ? '__new__' : 'existant');
  const [newLayerName, setNewLayerName] = useState('Projet futur');
  const [catTypes, setCatTypes] = useState<Record<string, PType>>(() => Object.fromEntries(categories.map(([c]) => [c, defaultCategoryType(kml, c)])));
  const [catModels, setCatModels] = useState<Record<string, string>>(() => Object.fromEntries(categories.map(([c, v]) => [c, iconName(v.icon) && v.icon.startsWith('files/') ? iconName(v.icon) : ''])));
  const [pointTypes, setPointTypes] = useState<Record<number, PType>>(() => {
    const o: Record<number, PType> = {};
    kml.points.forEach((p, i) => {
      const g = guessNodeType(p.name);
      if (g !== 'enneigeur') o[i] = g;
    });
    return o;
  });
  const [lineSpecs, setLineSpecs] = useState<Record<string, string>>(() => Object.fromEntries(lineFolders.map(([f]) => [f, DEFAULT_PIPE_SPEC.ref])));
  const [detectDn, setDetectDn] = useState(true);
  const [tol, setTol] = useState(net.params.tolerance_accrochage_m || 15);
  const [altitudes, setAltitudes] = useState(true);
  const [stage, setStage] = useState<Couronnes>('c1+c2+c3');
  const catalogue = net.catalogue;

  const layers: Layer[] = mode === 'remplacer' ? emptyNetwork().calques : net.calques;
  const targetLayerId = layerChoice === '__new__' ? '__new__' : layerChoice;

  const build = () => {
    // Sous-ensemble de points avec un type par point (catégorie ou surcharge).
    const kml2: KmlContent = { ...kml, points: kml.points.map((p, i) => ({ ...p, category: pointTypes[i] ? `${p.category}#${i}` : p.category })) };
    const categoryTypes: Record<string, PType> = { ...catTypes };
    const categoryModels: Record<string, string> = { ...catModels };
    kml.points.forEach((p, i) => {
      if (pointTypes[i]) {
        categoryTypes[`${p.category}#${i}`] = pointTypes[i];
        categoryModels[`${p.category}#${i}`] = catModels[p.category];
      }
    });
    const folderSpecs: Record<string, PipeSpec | 'ignorer'> = {};
    for (const [f, ref] of Object.entries(lineSpecs)) folderSpecs[f] = ref === 'ignorer' ? 'ignorer' : catalogue.find((c) => c.ref === ref) ?? DEFAULT_PIPE_SPEC;
    return buildNetwork(kml2, {
      categoryTypes,
      categoryModels,
      folderSpecs,
      detectDn,
      tolerance_m: tol,
      params: net.params,
      catalogue,
      calque: targetLayerId,
      existingNodes: mode === 'ajouter' ? net.nodes : [],
    });
  };
  const preview = useMemo(build, [kml, catTypes, catModels, pointTypes, lineSpecs, detectDn, tol, mode, targetLayerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const doImport = () => {
    const res = build();
    let base: Network = mode === 'remplacer' ? { ...emptyNetwork(), catalogue: net.catalogue, modeles: net.modeles, params: { ...net.params, tolerance_accrochage_m: tol } } : net;
    let layerId = targetLayerId;
    if (layerId === '__new__') {
      layerId = newId('L');
      const l: Layer = { id: layerId, nom: newLayerName || 'Import', couleur: LAYER_COLORS[base.calques.length % LAYER_COLORS.length], visible: true, calcul: mode === 'remplacer', verrouille: false, description: loaded.files.join(', ') };
      base = { ...base, calques: [...base.calques, l] };
    }
    const fixLayer = <T extends { calque: string }>(x: T) => (x.calque === '__new__' ? { ...x, calque: layerId } : x);
    let next: Network = { ...base, nodes: [...base.nodes, ...res.nodes.map(fixLayer)], pipes: [...base.pipes, ...res.pipes.map(fixLayer)] };

    // Ajout : raccorde les nouveaux points isolés aux canalisations existantes.
    let raccordes = 0;
    if (mode === 'ajouter') {
      const connected = new Set(next.pipes.flatMap((p) => [p.amont, p.aval]));
      for (const n of res.nodes) {
        if (connected.has(n.id)) continue;
        const near = nearestPipe(next, n.lat, n.lon, tol);
        if (!near) continue;
        const s = splitPipe(next, near.pipe.id, n.lat, n.lon, next.nodes.find((x) => x.id === n.id)!);
        if (s) {
          next = s.net;
          raccordes++;
        }
      }
    }
    // Modèles d'enneigeurs utilisés
    const models = [...next.modeles];
    for (const n of next.nodes) {
      if (n.type === 'enneigeur' && n.modele && !models.some((m) => m.modele === n.modele)) models.push({ ...DEFAULT_MODELES[0], modele: n.modele });
    }
    next = { ...next, modeles: models };
    // Débits CSV
    let csvMsg = '';
    if (loaded.flows) {
      const f = applyFlowTable(next, loaded.flows, stage);
      next = { ...next, nodes: f.nodes, modeles: f.modeles };
      csvMsg = ` Débits CSV : ${f.report.rattaches} enneigeurs.`;
    }
    if (mode === 'remplacer') st().replaceNetwork(next);
    else {
      st().commit(next);
      st().set('fitToken', st().fitToken + 1);
    }
    st().toast(
      `Import : ${res.nodes.length} nœuds, ${res.pipes.length} canalisations${raccordes ? `, ${raccordes} points raccordés au réseau existant` : ''}.${csvMsg}`,
      'success',
    );
    if (res.report.pointsNonRelies.length) st().toast(`${res.report.pointsNonRelies.length} point(s) non reliés : ${res.report.pointsNonRelies.slice(0, 12).join(', ')}`, 'error');
    if (altitudes) void st().fillAltitudes(mode === 'remplacer' ? undefined : res.nodes.map((n) => n.id), true);
    onDone();
  };

  const iconSrc = (icon: string) => kml.icons[icon] ?? (/^https?:/.test(icon) ? icon : undefined);
  const flowsPreview = loaded.flows ? applyFlowTable({ ...net, nodes: preview.nodes }, loaded.flows, stage).report : null;

  return (
    <div className="import-config">
      <p className="small muted">Fichiers : {loaded.files.join(', ')}</p>
      <div className="grid2">
        <div>
          <h4>Destination</h4>
          {hasNet && (
            <div className="segmented">
              <button
                className={mode === 'ajouter' ? 'on' : ''}
                onClick={() => {
                  setMode('ajouter');
                  setLayerChoice('__new__');
                }}
              >
                Ajouter au réseau
              </button>
              <button
                className={mode === 'remplacer' ? 'on' : ''}
                onClick={() => {
                  setMode('remplacer');
                  setLayerChoice('existant');
                }}
              >
                Remplacer le réseau
              </button>
            </div>
          )}
          <label className="field">
            <span className="field-label">Calque</span>
            <select value={layerChoice} onChange={(e) => setLayerChoice(e.target.value)}>
              {layers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nom}
                </option>
              ))}
              <option value="__new__">➕ Nouveau calque…</option>
            </select>
          </label>
          {layerChoice === '__new__' && (
            <label className="field">
              <span className="field-label">Nom du calque</span>
              <input value={newLayerName} onChange={(e) => setNewLayerName(e.target.value)} />
            </label>
          )}
        </div>
        <div>
          <h4>Raccordement automatique</h4>
          <label className="field">
            <span className="field-label">Tolérance d’accrochage</span>
            <span className="field-input">
              <input type="range" min={1} max={50} value={tol} onChange={(e) => setTol(Number(e.target.value))} /> <b>{tol} m</b>
            </span>
          </label>
          <div className="preview-stats">
            <span>
              <b>{preview.nodes.length}</b> nœuds
            </span>
            <span>
              <b>{preview.pipes.length}</b> canalisations
            </span>
            <span>
              <b>{preview.report.jonctions}</b> jonctions créées
            </span>
            <span className={preview.report.pointsNonRelies.length ? 'ko' : 'ok'}>
              <b>{preview.report.pointsNonRelies.length}</b> non reliés
            </span>
          </div>
          {preview.report.pointsNonRelies.length > 0 && <p className="small muted">Non reliés : {preview.report.pointsNonRelies.slice(0, 20).join(', ')}</p>}
          <label className="check">
            <input type="checkbox" checked={altitudes} onChange={(e) => setAltitudes(e.target.checked)} /> Récupérer les altitudes depuis les positions GPS (IGN)
          </label>
        </div>
      </div>

      <h4>Points ({kml.points.length}) — type par dossier et icône</h4>
      <div className="table-wrap tall">
        <table className="cat-table">
          <thead>
            <tr>
              <th></th>
              <th>Catégorie</th>
              <th className="num">Nb</th>
              <th>Importer comme</th>
              <th>Modèle</th>
            </tr>
          </thead>
          <tbody>
            {categories.map(([c, v]) => (
              <CatRow
                key={c}
                category={c}
                icon={iconSrc(v.icon)}
                idx={v.idx}
                kml={kml}
                type={catTypes[c]}
                model={catModels[c]}
                pointTypes={pointTypes}
                setType={(t) => setCatTypes({ ...catTypes, [c]: t })}
                setModel={(m) => setCatModels({ ...catModels, [c]: m })}
                setPointType={(i, t) => setPointTypes({ ...pointTypes, [i]: t })}
                models={net.modeles.map((m) => m.modele)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {lineFolders.length > 0 && (
        <>
          <h4>Lignes ({kml.lines.length}) — canalisation par défaut</h4>
          {lineFolders.map(([f, n]) => (
            <label key={f} className="field">
              <span className="field-label">
                {f} <span className="muted">({n})</span>
              </span>
              <select value={lineSpecs[f]} onChange={(e) => setLineSpecs({ ...lineSpecs, [f]: e.target.value })}>
                {catalogue.map((c) => (
                  <option key={c.ref} value={c.ref}>
                    {c.ref} — {c.materiau} DN{c.dn} PN{c.pn_bar}
                  </option>
                ))}
                <option value="ignorer">Ne pas importer</option>
              </select>
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={detectDn} onChange={(e) => setDetectDn(e.target.checked)} /> Reconnaître le diamètre dans le nom des lignes (« DN150 », « Ø200 »…)
          </label>
          <p className="small muted">Les diamètres se modifient ensuite canalisation par canalisation (ou dans Google Sheets).</p>
        </>
      )}

      {loaded.flows && (
        <>
          <h4>Débits par canon (CSV)</h4>
          <p className="small">
            {loaded.flows.length} lignes — <b>{flowsPreview?.rattaches ?? 0}</b> rattachées aux points importés.
            {flowsPreview && flowsPreview.nonTrouves.length > 0 && <span className="muted"> Absents : {flowsPreview.nonTrouves.join(', ')}</span>}
          </p>
          <label className="field">
            <span className="field-label">Couronnes utilisées pour le calcul</span>
            <StagePicker value={stage} onChange={setStage} />
          </label>
        </>
      )}

      <div className="modal-actions">
        <button className="btn" onClick={onBack}>
          Retour
        </button>
        <button className="btn primary" onClick={doImport}>
          Importer {preview.nodes.length} nœuds et {preview.pipes.length} canalisations
        </button>
      </div>
    </div>
  );
}

function CatRow(props: {
  category: string;
  icon?: string;
  idx: number[];
  kml: KmlContent;
  type: PType;
  model: string;
  models: string[];
  pointTypes: Record<number, PType>;
  setType: (t: PType) => void;
  setModel: (m: string) => void;
  setPointType: (i: number, t: PType) => void;
}) {
  const { category, icon, idx, kml, type, model, models, pointTypes } = props;
  const [open, setOpen] = useState(idx.length <= 8 && idx.some((i) => pointTypes[i]));
  const names = idx.map((i) => kml.points[i].name).filter(Boolean);
  return (
    <>
      <tr>
        <td>{icon ? <img src={icon} alt="" className="cat-icon" /> : <span className="cat-icon" />}</td>
        <td>
          <div>{category}</div>
          <button className="linklike small" onClick={() => setOpen(!open)}>
            {names.slice(0, 6).join(', ')}
            {names.length > 6 ? '…' : ''} {open ? '▴' : '▾ détail'}
          </button>
        </td>
        <td className="num">{idx.length}</td>
        <td>
          <TypeSelect value={type} onChange={props.setType} />
        </td>
        <td>
          {type === 'enneigeur' && (
            <>
              <input list="models-list" value={model} placeholder="Modèle" onChange={(e) => props.setModel(e.target.value)} />
              <datalist id="models-list">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          )}
        </td>
      </tr>
      {open && (
        <tr className="sub">
          <td></td>
          <td colSpan={4}>
            <div className="point-overrides">
              {idx.map((i) => (
                <span key={i} className="point-chip">
                  {kml.points[i].name || '(sans nom)'}
                  <TypeSelect value={pointTypes[i] ?? type} onChange={(t) => props.setPointType(i, t)} />
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TypeSelect({ value, onChange }: { value: PType; onChange: (t: PType) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as PType)}>
      {NODE_TYPES.map((t) => (
        <option key={t} value={t}>
          {NODE_LABEL[t]}
        </option>
      ))}
      <option value="ignorer">Ne pas importer</option>
    </select>
  );
}
