import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { couronneField, effectiveFlow, isBP, isConsumer, isRegulator, LAYER_COLORS, minPressureFor, NODE_LABEL, NODE_TYPES } from '../model/defaults';
import { deleteNode, deletePipe, mergeAtNode, nodeMapOf, orientByFlow, reversePipe } from '../model/edit';
import { pipeLength } from '../hydraulics/solver';
import { COURONNES, type Couronnes, type Layer, type NetNode, type NodeType, type Pipe } from '../model/types';
import { NumField, Row, Section, TextField, Toggle } from './fields';
import { BASE_LAYERS, fmt, STATUS_COLOR, STATUS_LABEL } from './display';
import { newId } from '../model/ids';
import { SheetHeader } from './MobileNav';
import { calibrateSource, pressureAt, type CalageResult } from '../hydraulics/calage';
import { staticNetwork } from '../model/scenario';
import { pressurize, stopPressurize } from './pressurize';
import { REFERENCE_NAME, REFERENCE_VERSION } from '../data/reference';

export default function SidePanel() {
  const selection = useStore((s) => s.selection);
  const net = useStore((s) => s.net);
  const tool = useStore((s) => s.tool);
  const node = selection?.kind === 'node' ? net.nodes.find((n) => n.id === selection.id) : undefined;
  const pipe = selection?.kind === 'pipe' ? net.pipes.find((p) => p.id === selection.id) : undefined;
  return (
    <aside className="sidepanel">
      <div className="mobile-only">
        <SheetHeader title={node ? `${NODE_LABEL[node.type]} ${node.nom}` : pipe ? `Canalisation ${pipe.nom}` : 'Réseau & pompage'} />
      </div>
      {tool.kind === 'draw' && <DrawSpecPicker />}
      {node ? <NodeEditor key={node.id} node={node} /> : pipe ? <PipeEditor key={pipe.id} pipe={pipe} /> : <Overview />}
    </aside>
  );
}

function useLocked(calque: string) {
  return useStore((s) => s.net.calques.find((l) => l.id === calque)?.verrouille === true);
}

function LayerSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const calques = useStore((s) => s.net.calques);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {calques.map((l) => (
        <option key={l.id} value={l.id}>
          {l.nom}
        </option>
      ))}
    </select>
  );
}

function StatusBadge({ statut }: { statut: keyof typeof STATUS_LABEL }) {
  return (
    <span className="badge" style={{ background: STATUS_COLOR[statut] }}>
      {STATUS_LABEL[statut]}
    </span>
  );
}

// ---------------------------------------------------------------------------

function NodeEditor({ node }: { node: NetNode }) {
  const net = useStore((s) => s.net);
  const results = useStore((s) => s.results);
  const stale = useStore((s) => s.stale);
  const locked = useLocked(node.calque);
  const st = useStore.getState;
  const up = (patch: Partial<NetNode>) => st().updateNode(node.id, patch);
  const r = results?.nodes[node.id];
  const connected = net.pipes.filter((p) => p.amont === node.id || p.aval === node.id);
  const nodes = nodeMapOf(net);
  const model = net.modeles.find((m) => m.modele === node.modele);
  const consumer = isConsumer(node.type);

  const applyModel = (name: string) => {
    const m = net.modeles.find((x) => x.modele === name);
    up(m ? { modele: name, pression_min_bar: minPressureFor({ ...node, modele: name }, net), k_buse: m.k_buse, debit_m3h: node.debit_m3h || m.debit_nominal_m3h } : { modele: name });
  };

  return (
    <div className="editor">
      <div className="editor-head">
        <div>
          <div className="eyebrow">{NODE_LABEL[node.type]}</div>
          <h2>{node.nom || node.id}</h2>
        </div>
        <button className="btn icon" title="Fermer" onClick={() => st().setSelection(null)}>
          ✕
        </button>
      </div>
      {locked && <div className="notice">Calque verrouillé : modifications désactivées.</div>}

      {r && (
        <div className={`result-card ${stale ? 'is-stale' : ''}`}>
          <div className="result-main">
            <div>
              <div className="big">{fmt(r.pression_bar, 1)}</div>
              <div className="muted small">bar</div>
            </div>
            {consumer || node.type === 'salle_machines' || isRegulator(node.type) ? (
              <div>
                <div className="big">{fmt(r.debit_m3h, 1)}</div>
                <div className="muted small">m³/h</div>
              </div>
            ) : null}
            <StatusBadge statut={r.statut} />
          </div>
          {Number.isFinite(r.vitesse_arrivee_m_s) && (
            <div className="small">
              Vitesse de l’eau à l’arrivée : <b>{fmt(r.vitesse_arrivee_m_s, 2)} m/s</b> ({fmt(r.debit_arrivee_m3h, 1)} m³/h)
            </div>
          )}
          {r.pression_aspiration_bar !== undefined && <div className="small">Pression à l’entrée : {fmt(r.pression_aspiration_bar, 1)} bar</div>}
          <div className="small muted">Charge : {fmt(r.charge_m, 1)} m</div>
          {r.messages.map((m, i) => (
            <div key={i} className="small msg">
              {m}
            </div>
          ))}
          {stale && <div className="small muted">Le réseau a changé : relancez le calcul.</div>}
        </div>
      )}

      <Section title="Général">
        <Row label="Nom">
          <TextField value={node.nom} onChange={(v) => up({ nom: v })} disabled={locked} />
        </Row>
        <Row label="Type">
          <select value={node.type} disabled={locked} onChange={(e) => up({ type: e.target.value as NodeType })}>
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {NODE_LABEL[t]}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Calque">
          <LayerSelect value={node.calque} onChange={(v) => up({ calque: v })} disabled={locked} />
        </Row>
        <Row label="Piste / secteur">
          <TextField value={node.secteur} onChange={(v) => up({ secteur: v })} disabled={locked} />
        </Row>
        <Row label="Altitude" hint="Récupérée automatiquement depuis la position GPS (IGN RGE ALTI®)">
          <NumField value={node.altitude_m} unit="m" digits={1} onChange={(v) => up({ altitude_m: v })} disabled={locked} />
          <button className="btn small" title="Recalculer depuis la position GPS" disabled={locked} onClick={() => st().fillAltitudes([node.id])}>
            ↻ GPS
          </button>
        </Row>
        <div className="small muted coords">
          {node.lat.toFixed(6)}, {node.lon.toFixed(6)}
        </div>
      </Section>

      {consumer && (
        <Section title="Production">
          <Row label={node.type === 'regard' ? 'Soutirage actif' : 'En production'}>
            <Toggle checked={node.actif} onChange={(v) => up({ actif: v })} disabled={locked} />
          </Row>
          <Row label="Modèle">
            <select value={node.modele} onChange={(e) => applyModel(e.target.value)} disabled={locked}>
              <option value="">—</option>
              {net.modeles.map((m) => (
                <option key={m.modele} value={m.modele}>
                  {m.modele}
                </option>
              ))}
              {node.modele && !model && <option value={node.modele}>{node.modele}</option>}
            </select>
          </Row>
          <Row label="Couronnes">
            <div className="segmented">
              {(['', ...COURONNES] as Couronnes[]).map((c) => (
                <button
                  key={c || 'man'}
                  className={node.couronnes === c ? 'on' : ''}
                  disabled={locked || (c !== '' && !(node[couronneField(c)] > 0))}
                  onClick={() => up({ couronnes: c })}
                  title={c ? `${fmt(node[couronneField(c)], 1)} m³/h` : 'Débit saisi manuellement'}
                >
                  {c ? c.toUpperCase() : 'Manuel'}
                </button>
              ))}
            </div>
          </Row>
          <div className="stage-grid">
            {COURONNES.map((c) => (
              <label key={c}>
                <span>{c.toUpperCase()}</span>
                <NumField value={node[couronneField(c)]} unit="m³/h" digits={1} disabled={locked} onChange={(v) => up({ [couronneField(c)]: v } as Partial<NetNode>)} />
              </label>
            ))}
          </div>
          <Row label="Mode de débit" hint="Fixe : débit imposé. Buse : Q = k·√P, le débit dépend de la pression disponible.">
            <select value={node.mode_debit} onChange={(e) => up({ mode_debit: e.target.value as NetNode['mode_debit'] })} disabled={locked}>
              <option value="fixe">Débit imposé</option>
              <option value="buse">Buse (Q = k·√P)</option>
            </select>
          </Row>
          {node.mode_debit === 'fixe' ? (
            <Row label={node.couronnes ? 'Débit utilisé' : 'Débit'}>
              {node.couronnes ? (
                <span className="value">{fmt(effectiveFlow(node), 1)} m³/h</span>
              ) : (
                <NumField value={node.debit_m3h} unit="m³/h" digits={1} onChange={(v) => up({ debit_m3h: v })} disabled={locked} />
              )}
            </Row>
          ) : (
            <Row label="Coefficient k">
              <NumField value={node.k_buse} unit="m³/h/√bar" onChange={(v) => up({ k_buse: v })} disabled={locked} />
            </Row>
          )}
          <Row label="Pression mini" hint={isBP(node) ? 'Canon BP (basse pression)' : 'Pression mini du modèle'}>
            <NumField value={node.pression_min_bar} unit="bar" digits={1} onChange={(v) => up({ pression_min_bar: v })} disabled={locked} />
            {node.pression_min_bar !== minPressureFor(node, net) && (
              <button className="btn small" disabled={locked} title={isBP(node) ? 'Pression mini des canons BP' : `Pression mini du modèle ${node.modele}`} onClick={() => up({ pression_min_bar: minPressureFor(node, net) })}>
                ↺ {fmt(minPressureFor(node, net), 0)}
              </button>
            )}
          </Row>
          {isBP(node) && <div className="small muted">Canon BP : pression mini {fmt(net.params.pression_min_bp_bar, 0)} bar.</div>}
          <Row label="Air">
            <NumField value={node.air} digits={1} onChange={(v) => up({ air: v })} disabled={locked} />
          </Row>
          <Row label="Priorité">
            <TextField value={node.priorite} onChange={(v) => up({ priorite: v })} disabled={locked} />
          </Row>
        </Section>
      )}

      {node.type === 'vanne' && (
        <Section title="Vanne">
          <Row label="Ouverte">
            <Toggle checked={node.actif} onChange={(v) => up({ actif: v })} disabled={locked} />
          </Row>
        </Section>
      )}

      {(node.type === 'salle_machines' || isRegulator(node.type)) && (
        <Section title={node.type === 'salle_machines' ? 'Pompage' : node.type === 'surpresseur' ? 'Surpresseur' : 'Réducteur de pression'}>
          <Row label="Pression de sortie" hint="Pression de consigne au refoulement / en aval">
            <NumField value={node.pression_consigne_bar} unit="bar" digits={1} onChange={(v) => up({ pression_consigne_bar: v })} disabled={locked} />
          </Row>
          {node.type !== 'reducteur' && (
            <Row label="Débit maximal">
              <NumField value={node.debit_max_m3h} unit="m³/h" digits={0} onChange={(v) => up({ debit_max_m3h: v })} disabled={locked} />
            </Row>
          )}
          {isRegulator(node.type) && (
            <Row label="Arrivée d’eau" hint="Canalisation par laquelle l'eau arrive (automatique : celle venant de la salle des machines)">
              <select value={node.aspiration} onChange={(e) => up({ aspiration: e.target.value })} disabled={locked}>
                <option value="">Automatique</option>
                {connected.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nom || p.id}
                  </option>
                ))}
              </select>
            </Row>
          )}
        </Section>
      )}

      <Section title={`Canalisations raccordées (${connected.length})`}>
        <ul className="link-list">
          {connected.map((p) => {
            const other = nodes.get(p.amont === node.id ? p.aval : p.amont);
            return (
              <li key={p.id}>
                <button className="linklike" onClick={() => st().setSelection({ kind: 'pipe', id: p.id })}>
                  {p.nom || p.id}
                </button>{' '}
                <span className="muted small">
                  DN{p.dn} → {other?.nom || other?.id}
                </span>
              </li>
            );
          })}
          {!connected.length && <li className="muted small">Aucune : utilisez « Tracer une canalisation » pour le relier.</li>}
        </ul>
      </Section>

      <Section title="Notes">
        <textarea defaultValue={node.notes} onBlur={(e) => e.target.value !== node.notes && up({ notes: e.target.value })} disabled={locked} rows={2} />
      </Section>

      <div className="editor-actions">
        <button
          className="btn"
          onClick={() => {
            st().set('profileTarget', node.id);
            st().set('bottomTab', 'profil');
            st().set('mobileSheet', 'tableaux');
            if (!st().results || st().stale) st().runCalc();
          }}
        >
          📈 Profil en long
        </button>
        {connected.length === 2 && node.type === 'jonction' && (
          <button
            className="btn"
            disabled={locked}
            title="Supprime ce point et fusionne les deux canalisations"
            onClick={() => {
              const m = mergeAtNode(net, node.id);
              if (m) {
                st().commit(m);
                st().setSelection(null);
              }
            }}
          >
            ⤚ Fusionner
          </button>
        )}
        <button
          className="btn danger"
          disabled={locked}
          onClick={() => {
            st().commit(deleteNode(net, node.id));
            st().setSelection(null);
            st().toast('Élément supprimé (Ctrl+Z pour annuler).');
          }}
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PipeEditor({ pipe }: { pipe: Pipe }) {
  const net = useStore((s) => s.net);
  const results = useStore((s) => s.results);
  const stale = useStore((s) => s.stale);
  const locked = useLocked(pipe.calque);
  const st = useStore.getState;
  const up = (patch: Partial<Pipe>) => st().updatePipe(pipe.id, patch);
  const r = results?.pipes[pipe.id];
  const nodes = nodeMapOf(net);
  const a = nodes.get(pipe.amont);
  const b = nodes.get(pipe.aval);
  const L = pipeLength(pipe, nodes);
  const spec = net.catalogue.find((c) => c.dn === pipe.dn && c.diametre_int_mm === pipe.diametre_int_mm && c.materiau === pipe.materiau && c.pn_bar === pipe.pn_bar);

  return (
    <div className="editor">
      <div className="editor-head">
        <div>
          <div className="eyebrow">Canalisation</div>
          <h2>{pipe.nom || pipe.id}</h2>
        </div>
        <button className="btn icon" title="Fermer" onClick={() => st().setSelection(null)}>
          ✕
        </button>
      </div>
      {locked && <div className="notice">Calque verrouillé : modifications désactivées.</div>}

      {r && (
        <div className={`result-card ${stale ? 'is-stale' : ''}`}>
          <div className="result-main">
            <div>
              <div className="big">{fmt(Math.abs(r.debit_m3h), 1)}</div>
              <div className="muted small">m³/h</div>
            </div>
            <div>
              <div className="big">{fmt(r.vitesse_m_s, 2)}</div>
              <div className="muted small">m/s</div>
            </div>
            <StatusBadge statut={r.statut} />
          </div>
          <div className="small">
            Pertes : {fmt(Math.abs(r.perte_charge_m), 2)} m ({fmt(r.perte_m_km, 1)} m/km)
          </div>
          <div className="small">
            Pression sur le tracé : {fmt(r.pression_min_bar, 1)} à {fmt(r.pression_max_bar, 1)} bar (PN {pipe.pn_bar})
          </div>
          {Math.abs(r.debit_m3h) > 1e-6 && (
            <div className="small muted">Écoulement : {r.debit_m3h >= 0 ? `${a?.nom} → ${b?.nom}` : `${b?.nom} → ${a?.nom}`}</div>
          )}
          {r.messages.map((m, i) => (
            <div key={i} className="small msg">
              {m}
            </div>
          ))}
        </div>
      )}

      <Section title="Liaison">
        <div className="ends">
          <div>
            <div className="muted small">Amont</div>
            <button className="linklike" onClick={() => st().setSelection({ kind: 'node', id: pipe.amont })}>
              {a?.nom || pipe.amont}
            </button>
            <button className="btn small" disabled={locked} onClick={() => st().setTool({ kind: 'reconnect', pipeId: pipe.id, end: 'amont' })}>
              Changer
            </button>
          </div>
          <button className="btn icon" title="Inverser le sens" disabled={locked} onClick={() => st().commit(reversePipe(net, pipe.id))}>
            ⇄
          </button>
          <div>
            <div className="muted small">Aval</div>
            <button className="linklike" onClick={() => st().setSelection({ kind: 'node', id: pipe.aval })}>
              {b?.nom || pipe.aval}
            </button>
            <button className="btn small" disabled={locked} onClick={() => st().setTool({ kind: 'reconnect', pipeId: pipe.id, end: 'aval' })}>
              Changer
            </button>
          </div>
        </div>
      </Section>

      <Section title="Caractéristiques">
        <Row label="Nom">
          <TextField value={pipe.nom} onChange={(v) => up({ nom: v })} disabled={locked} />
        </Row>
        <Row label="Calque">
          <LayerSelect value={pipe.calque} onChange={(v) => up({ calque: v })} disabled={locked} />
        </Row>
        <Row label="État">
          <Toggle checked={pipe.statut === 'ouverte'} label={pipe.statut === 'ouverte' ? 'Ouverte' : 'Fermée'} onChange={(v) => up({ statut: v ? 'ouverte' : 'fermee' })} disabled={locked} />
        </Row>
        <Row label="Catalogue">
          <select
            value={spec?.ref ?? ''}
            disabled={locked}
            onChange={(e) => {
              const c = net.catalogue.find((x) => x.ref === e.target.value);
              if (c) up({ dn: c.dn, diametre_int_mm: c.diametre_int_mm, materiau: c.materiau, rugosite_mm: c.rugosite_mm, pn_bar: c.pn_bar });
            }}
          >
            <option value="">Personnalisée</option>
            {net.catalogue.map((c) => (
              <option key={c.ref} value={c.ref}>
                {c.ref} — {c.materiau} DN{c.dn} PN{c.pn_bar}
              </option>
            ))}
          </select>
        </Row>
        <Row label="DN">
          <NumField value={pipe.dn} digits={0} onChange={(v) => up({ dn: v })} disabled={locked} />
        </Row>
        <Row label="Ø intérieur">
          <NumField value={pipe.diametre_int_mm} unit="mm" digits={1} onChange={(v) => up({ diametre_int_mm: v })} disabled={locked} />
        </Row>
        <Row label="Matériau">
          <TextField value={pipe.materiau} onChange={(v) => up({ materiau: v })} disabled={locked} />
        </Row>
        <Row label="Rugosité">
          <NumField value={pipe.rugosite_mm} unit="mm" digits={3} onChange={(v) => up({ rugosite_mm: v })} disabled={locked} />
        </Row>
        <Row label="PN">
          <NumField value={pipe.pn_bar} unit="bar" digits={0} onChange={(v) => up({ pn_bar: v })} disabled={locked} />
        </Row>
        <Row label="Pertes singulières" hint="Somme des coefficients K (coudes, vannes, tés…)">
          <NumField value={pipe.k_singulier} unit="K" digits={2} onChange={(v) => up({ k_singulier: v })} disabled={locked} />
        </Row>
        <Row label="Longueur">
          {pipe.longueur_auto ? (
            <span className="value">{fmt(L, 1)} m (tracé)</span>
          ) : (
            <NumField value={pipe.longueur_m} unit="m" digits={1} onChange={(v) => up({ longueur_m: v })} disabled={locked} />
          )}
        </Row>
        <Row label="Longueur du tracé">
          <Toggle checked={pipe.longueur_auto} onChange={(v) => up({ longueur_auto: v, longueur_m: v ? pipe.longueur_m : Math.round(L * 10) / 10 })} disabled={locked} label="automatique" />
        </Row>
      </Section>

      <Section title="Notes">
        <textarea defaultValue={pipe.notes} onBlur={(e) => e.target.value !== pipe.notes && up({ notes: e.target.value })} disabled={locked} rows={2} />
      </Section>

      <div className="editor-actions">
        <button className="btn" disabled={locked} onClick={() => st().setTool({ kind: 'split' })}>
          ✂ Couper
        </button>
        <button
          className="btn danger"
          disabled={locked}
          onClick={() => {
            st().commit(deletePipe(net, pipe.id));
            st().setSelection(null);
            st().toast('Canalisation supprimée (Ctrl+Z pour annuler).');
          }}
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DrawSpecPicker() {
  const catalogue = useStore((s) => s.net.catalogue);
  const drawSpec = useStore((s) => s.drawSpec);
  return (
    <div className="draw-spec">
      <div className="eyebrow">Canalisation à tracer</div>
      <select
        value={drawSpec.ref}
        onChange={(e) => {
          const c = catalogue.find((x) => x.ref === e.target.value);
          if (c) useStore.getState().set('drawSpec', c);
        }}
      >
        {catalogue.map((c) => (
          <option key={c.ref} value={c.ref}>
            {c.ref} — {c.materiau} DN{c.dn} PN{c.pn_bar}
          </option>
        ))}
      </select>
    </div>
  );
}

function Overview() {
  const net = useStore((s) => s.net);
  const settings = useStore((s) => s.settings);
  const results = useStore((s) => s.results);
  const st = useStore.getState;
  const nodes = useMemo(() => nodeMapOf(net), [net]);
  const totalL = useMemo(() => net.pipes.reduce((a, p) => a + pipeLength(p, nodes), 0), [net, nodes]);
  const guns = net.nodes.filter((n) => n.type === 'enneigeur');
  const active = guns.filter((n) => n.actif);
  const demand = active.reduce((a, n) => a + effectiveFlow(n), 0);

  return (
    <div className="overview">
      <ReferenceUpdateNotice />
      <Section title="Réseau">
        <div className="stats">
          <div>
            <b>{guns.length}</b>
            <span>enneigeurs</span>
          </div>
          <div>
            <b>{active.length}</b>
            <span>en production</span>
          </div>
          <div>
            <b>{fmt(demand, 0)}</b>
            <span>m³/h demandés</span>
          </div>
          <div>
            <b>{fmt(totalL / 1000, 2)}</b>
            <span>km de réseau</span>
          </div>
        </div>
      </Section>

      <PumpingSection />

      <LayersManager />

      <Section title="Fond de carte">
        <Row label="Fond de carte">
          <select value={settings.baseLayer} onChange={(e) => st().updateSettings({ baseLayer: e.target.value })}>
            {BASE_LAYERS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Pistes de ski">
          <Toggle checked={settings.showPistes} onChange={(v) => st().updateSettings({ showPistes: v })} />
        </Row>
        <p className="small muted">Couleurs, contenu des bulles et légende : panneau « Affichage » en haut à gauche de la carte.</p>
      </Section>

      <Section title="Outils">
        <div className="stack">
          <button className="btn" onClick={() => st().fillAltitudes(undefined, true)} disabled={!net.nodes.length}>
            ⛰ Recalculer toutes les altitudes (GPS)
          </button>
          <button
            className="btn"
            disabled={!results}
            title="Met chaque canalisation dans le sens de l'écoulement calculé"
            onClick={() => results && st().commit(orientByFlow(net, results.pipes))}
          >
            ⇄ Orienter selon l’écoulement
          </button>
        </div>
      </Section>
    </div>
  );
}

function LayersManager() {
  const calques = useStore((s) => s.net.calques);
  const net = useStore((s) => s.net);
  const activeLayer = useStore((s) => s.activeLayer);
  const st = useStore.getState;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    net.nodes.forEach((n) => m.set(n.calque, (m.get(n.calque) ?? 0) + 1));
    net.pipes.forEach((p) => m.set(p.calque, (m.get(p.calque) ?? 0) + 1));
    return m;
  }, [net]);
  const upd = (id: string, patch: Partial<Layer>) => st().commit({ ...net, calques: net.calques.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const add = () => {
    const nom = prompt('Nom du nouveau calque (ex. « Projet 2027 – Extension Marmottes ») :');
    if (!nom) return;
    const l: Layer = { id: newId('L'), nom, couleur: LAYER_COLORS[calques.length % LAYER_COLORS.length], visible: true, calcul: false, verrouille: false, description: '' };
    st().commit({ ...net, calques: [...calques, l] });
    st().set('activeLayer', l.id);
  };
  const remove = (l: Layer) => {
    const n = counts.get(l.id) ?? 0;
    if (calques.length <= 1) return;
    const target = calques.find((x) => x.id !== l.id)!;
    if (n && !confirm(`Le calque « ${l.nom} » contient ${n} élément(s). Les déplacer vers « ${target.nom} » et supprimer le calque ?`)) return;
    st().commit({
      ...net,
      calques: calques.filter((x) => x.id !== l.id),
      nodes: net.nodes.map((x) => (x.calque === l.id ? { ...x, calque: target.id } : x)),
      pipes: net.pipes.map((x) => (x.calque === l.id ? { ...x, calque: target.id } : x)),
    });
    if (activeLayer === l.id) st().set('activeLayer', target.id);
  };
  return (
    <Section
      title="Calques"
      actions={
        <button className="btn small" onClick={add}>
          ＋ Calque
        </button>
      }
    >
      <ul className="layers">
        {calques.map((l) => (
          <li key={l.id} className={activeLayer === l.id ? 'active' : ''}>
            <input type="color" value={l.couleur} onChange={(e) => upd(l.id, { couleur: e.target.value })} title="Couleur" />
            <button className="layer-name" title="Calque de travail : les nouveaux éléments y sont créés" onClick={() => st().set('activeLayer', l.id)}>
              <span>{l.nom}</span>
              <small className="muted">{counts.get(l.id) ?? 0} élém.</small>
            </button>
            <button className={`chip ${l.visible ? 'on' : ''}`} title="Afficher sur la carte" onClick={() => upd(l.id, { visible: !l.visible })}>
              👁
            </button>
            <button className={`chip ${l.calcul ? 'on' : ''}`} title="Inclure dans le calcul" onClick={() => upd(l.id, { calcul: !l.calcul })}>
              Σ
            </button>
            <button className={`chip ${l.verrouille ? 'on' : ''}`} title="Verrouiller" onClick={() => upd(l.id, { verrouille: !l.verrouille })}>
              🔒
            </button>
            <details className="layer-more">
              <summary title="Plus">⋯</summary>
              <div className="menu-pop right">
                <button
                  onClick={() => {
                    const nom = prompt('Nouveau nom :', l.nom);
                    if (nom) upd(l.id, { nom });
                  }}
                >
                  Renommer
                </button>
                <button onClick={() => remove(l)} disabled={calques.length <= 1}>
                  Supprimer
                </button>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <p className="small muted">
        Les éléments ajoutés vont dans le calque surligné. Σ = pris en compte dans le calcul : activez un calque projet pour simuler son impact.
      </p>
    </Section>
  );
}

/** Réglage des stations de pompage : usine(s), surpresseurs, réducteurs. */
function PumpingSection() {
  const net = useStore((s) => s.net);
  const stations = net.nodes.filter((n) => n.type === 'salle_machines' || isRegulator(n.type));
  const order = { salle_machines: 0, surpresseur: 1, reducteur: 2 } as Record<string, number>;
  stations.sort((a, b) => order[a.type] - order[b.type]);
  return (
    <Section title="Pompage">
      {!stations.length && <p className="small muted">Aucune salle des machines : ajoutez-en une avec la barre d’outils.</p>}
      {stations.some((n) => n.type === 'salle_machines') && <CalageCard />}
      <div className="stations">
        {stations.map((n) => (
          <StationCard key={n.id} node={n} />
        ))}
      </div>
    </Section>
  );
}

/** Pression appliquée sans entrée d'annulation, puis recalcul immédiat. */
function livePressure(id: string, bar: number) {
  const st = useStore.getState();
  st.patchSilently((cur) => ({ ...cur, nodes: cur.nodes.map((x) => (x.id === id ? { ...x, pression_consigne_bar: bar } : x)) }));
  st.runCalc();
}

/** Calage de la pression de l'usine sur une pression relevée (réseau chargé, canons fermés). */
function CalageCard() {
  const net = useStore((s) => s.net);
  const st = useStore.getState;
  const [res, setRes] = useState<CalageResult | null>(null);
  const sdm = net.nodes.find((n) => n.type === 'salle_machines')!;
  const boosters = net.nodes.filter((n) => isRegulator(n.type));
  const targetId = net.params.calage_noeud && net.nodes.some((n) => n.id === net.params.calage_noeud) ? net.params.calage_noeud : boosters[0]?.id ?? '';
  const candidates = [...boosters, ...net.nodes.filter((n) => !isRegulator(n.type) && n.type !== 'salle_machines' && n.type !== 'jonction').sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }))];
  const setParam = (p: Partial<typeof net.params>) => {
    st().commit({ ...st().net, params: { ...st().net.params, ...p } });
    setRes(null);
  };
  const compute = () => targetId && setRes(calibrateSource(st().net, sdm.id, targetId, net.params.calage_pression_bar, Math.max(200, net.params.pression_max_curseur_bar)));
  const target = net.nodes.find((n) => n.id === targetId);
  return (
    <details className="calage" open>
      <summary>⚙ Calage de la pression (réseau chargé, canons fermés)</summary>
      <p className="small muted">Indiquez une pression relevée sur l’installation, canons fermés : l’application recalcule la pression de refoulement de l’usine.</p>
      <Row label="Pression relevée">
        <NumField value={net.params.calage_pression_bar} unit="bar" digits={1} onChange={(v) => setParam({ calage_pression_bar: v })} />
      </Row>
      <Row label="À l’arrivée de">
        <select value={targetId} onChange={(e) => setParam({ calage_noeud: e.target.value })}>
          {candidates.map((n) => (
            <option key={n.id} value={n.id}>
              {n.nom || n.id} ({NODE_LABEL[n.type].toLowerCase()}, {fmt(n.altitude_m, 0)} m)
            </option>
          ))}
        </select>
      </Row>
      <div className="calage-actions">
        <button className="btn small" onClick={compute} disabled={!targetId}>
          Recalculer
        </button>
        {res && res.ok && (
          <>
            <span className="small">
              Usine : <b>{fmt(res.consigne, 1)} bar</b> → {fmt(res.obtenue, 1)} bar à {target?.nom}
            </span>
            <button
              className="btn small primary"
              disabled={Math.abs(res.consigne - sdm.pression_consigne_bar) < 0.05}
              onClick={() => {
                st().updateNode(sdm.id, { pression_consigne_bar: res.consigne, en_marche: true });
                st().runCalc(true);
                st().toast(`Usine réglée à ${fmt(res.consigne, 1)} bar : ${fmt(res.obtenue, 1)} bar à l’arrivée de ${target?.nom}, canons fermés.`, 'success');
              }}
            >
              Appliquer
            </button>
          </>
        )}
        {res && !res.ok && <span className="small msg">{res.message}</span>}
      </div>
    </details>
  );
}

function StationCard({ node: n }: { node: NetNode }) {
  const net = useStore((s) => s.net);
  const results = useStore((s) => s.results);
  const stale = useStore((s) => s.stale);
  const filling = useStore((s) => s.filling);
  const st = useStore.getState;
  const r = results?.nodes[n.id];
  const locked = net.calques.find((l) => l.id === n.calque)?.verrouille;
  const running = n.en_marche !== false;
  const q = r && Number.isFinite(r.pression_bar) ? r.debit_m3h : NaN;
  const load = n.debit_max_m3h > 0 && Number.isFinite(q) ? q / n.debit_max_m3h : NaN;
  const maxBar = Math.max(net.params.pression_max_curseur_bar || 80, n.pression_consigne_bar);
  const isSdm = n.type === 'salle_machines';
  const isBooster = n.type === 'surpresseur';
  const waterLevel = n.altitude_m + n.pression_consigne_bar / 0.0980638;
  const anim = filling === n.id;
  const sdm = net.nodes.find((x) => x.type === 'salle_machines');
  // Pression d'arrivée au booster, réseau chargé et canons fermés.
  const staticInlet = useMemo(() => (isBooster && !filling ? pressureAt(staticNetwork(net), n.id) : NaN), [isBooster, filling, net, n.id]);

  const setRunning = (v: boolean) => {
    stopPressurize();
    st().updateNode(n.id, { en_marche: v });
    st().runCalc(true);
  };

  const start = () => {
    if (isSdm) {
      pressurize(n.id, 0, n.pression_consigne_bar > 0 ? n.pression_consigne_bar : 60, () =>
        st().toast(`Réseau chargé à ${fmt(n.pression_consigne_bar, 1)} bar en sortie d’usine (canons fermés).`, 'success'),
      );
      return;
    }
    // Booster : il faut que l'eau lui arrive.
    if (!sdm || sdm.en_marche === false) return st().toast('Mettez d’abord l’usine en marche.', 'error');
    const Pin = pressureAt(staticNetwork(st().net), n.id);
    if (!(Pin >= 0)) {
      const need = calibrateSource(st().net, sdm.id, n.id, 0.5);
      return st().toast(`Booster désamorcé : l’eau ne lui arrive pas. Il faut au moins ${fmt(need.consigne, 1)} bar à l’usine.`, 'error');
    }
    pressurize(n.id, Math.min(Pin, n.pression_consigne_bar), n.pression_consigne_bar, () =>
      st().toast(`Ligne du booster chargée à ${fmt(n.pression_consigne_bar, 1)} bar.`, 'success'),
    );
  };
  useEffect(() => () => {
    if (useStore.getState().filling === n.id) stopPressurize();
  }, [n.id]);

  return (
    <div className={`station ${!running ? 'st-off' : r ? `st-${r.statut}` : ''}`}>
      <div className="station-head">
        <button className="linklike" onClick={() => st().setSelection({ kind: 'node', id: n.id })}>
          <b>{n.nom || n.id}</b>
        </button>
        <span className="muted small">
          {NODE_LABEL[n.type]} · {fmt(n.altitude_m, 0)} m
        </span>
      </div>
      <div className="station-run">
        <Toggle
          checked={running}
          disabled={locked}
          onChange={setRunning}
          label={running ? (isSdm ? 'Pompage en marche' : 'En service') : isSdm ? 'Pompage arrêté' : isBooster ? 'Arrêté (ligne non alimentée)' : 'Hors service'}
        />
        {(isSdm || isBooster) && (
          <button
            className={`btn small ${anim ? '' : 'primary'}`}
            disabled={locked || (!!filling && !anim)}
            onClick={anim ? stopPressurize : start}
            title={isSdm ? 'Fait monter la pression depuis 0 bar, canons fermés : on voit les canalisations se remplir' : 'Démarre le booster et fait monter la pression de sa ligne, canons fermés'}
          >
            {anim ? '■ Stop' : '▶ Mise en pression'}
          </button>
        )}
      </div>
      {isBooster && Number.isFinite(staticInlet) && (
        <div className={`small ${staticInlet < 0 ? 'msg' : ''}`}>
          Arrivée canons fermés : <b>{fmt(staticInlet, 1)} bar</b>
          {staticInlet < 0 && ' — désamorcé, augmentez la pression de l’usine'}
        </div>
      )}
      <Row label="Pression de refoulement" hint="Pression maintenue en sortie (variateur / régulation)">
        <NumField value={n.pression_consigne_bar} unit="bar" digits={1} disabled={locked} onChange={(v) => { st().updateNode(n.id, { pression_consigne_bar: v }); st().runCalc(); }} />
      </Row>
      <div className="pressure-slider">
        <input
          type="range"
          min={0}
          max={maxBar}
          step={0.5}
          value={n.pression_consigne_bar}
          disabled={locked || !running}
          onPointerDown={() => {
            stopPressurize();
            st().commit(st().net);
          }}
          onChange={(e) => livePressure(n.id, Number(e.target.value))}
          aria-label={`Pression de refoulement de ${n.nom}`}
        />
        <div className="slider-scale small muted">
          <span>0</span>
          <span>{fmt(maxBar / 2, 0)}</span>
          <span>{fmt(maxBar, 0)} bar</span>
        </div>
      </div>
      {running && (
        <div className="small muted">
          {isSdm ? 'L’eau peut monter jusqu’à' : 'Charge en sortie :'} <b>{fmt(waterLevel, 0)} m</b> d’altitude (sans débit)
        </div>
      )}
      {n.type !== 'reducteur' && (
        <Row label="Débit maximal">
          <NumField value={n.debit_max_m3h} unit="m³/h" digits={0} disabled={locked} onChange={(v) => st().updateNode(n.id, { debit_max_m3h: v })} />
        </Row>
      )}
      {r && running && Number.isFinite(q) && (
        <div className={`station-result ${stale ? 'is-stale' : ''}`}>
          <div className="small">
            Débit calculé <b>{fmt(q, 0)} m³/h</b>
            {Number.isFinite(load) && <> · {fmt(load * 100, 0)} % du maximum</>}
          </div>
          {Number.isFinite(load) && (
            <div className="gauge">
              <i style={{ width: `${Math.min(load, 1) * 100}%`, background: load > 1 ? STATUS_COLOR.erreur : load > 0.9 ? STATUS_COLOR.alerte : STATUS_COLOR.ok }} />
            </div>
          )}
          {r.pression_aspiration_bar !== undefined && (
            <div className="small">
              Pression d’arrivée {fmt(r.pression_aspiration_bar, 1)} bar → refoulement {fmt(r.pression_bar, 1)} bar
            </div>
          )}
          {r.messages.map((m, i) => (
            <div key={i} className="small msg">
              {m}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Propose de recharger le réseau de la station quand une nouvelle version est intégrée. */
function ReferenceUpdateNotice() {
  const params = useStore((s) => s.net.params);
  const fromReference = params.reference_version !== '' || params.nom_projet === REFERENCE_NAME;
  if (!fromReference || params.reference_version === REFERENCE_VERSION) return null;
  return (
    <div className="notice">
      Une nouvelle version du réseau de la station est disponible (pressions mini, réglages…).
      <div style={{ marginTop: 6 }}>
        <button
          className="btn small primary"
          onClick={() => {
            if (confirm('Recharger le réseau de la station ? Les modifications faites sur cet appareil seront remplacées (Ctrl+Z pour annuler).')) void useStore.getState().loadReference();
          }}
        >
          Recharger le réseau de la station
        </button>
      </div>
    </div>
  );
}
