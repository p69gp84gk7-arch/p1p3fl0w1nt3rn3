import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { couronneField, effectiveFlow, isConsumer, NODE_LABEL, NODE_TYPES } from '../model/defaults';
import { nodeMapOf } from '../model/edit';
import { pipeLength } from '../hydraulics/solver';
import { COURONNES, type Couronnes, type NetNode, type NodeType } from '../model/types';
import { fmt, STATUS_COLOR, STATUS_LABEL } from './display';
import ProfileChart from './ProfileChart';

type Tab = 'enneigeurs' | 'canalisations' | 'alertes' | 'profil';

export default function BottomDrawer() {
  const tab = useStore((s) => s.bottomTab);
  const results = useStore((s) => s.results);
  const st = useStore.getState;
  const nAlerts = results ? Object.values(results.nodes).filter((r) => r.statut === 'erreur' || r.statut === 'alerte').length + Object.values(results.pipes).filter((r) => r.statut === 'erreur' || r.statut === 'alerte').length : 0;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'enneigeurs', label: 'Regards & enneigeurs' },
    { id: 'canalisations', label: 'Canalisations' },
    { id: 'alertes', label: `Alertes${results ? ` (${nAlerts})` : ''}` },
    { id: 'profil', label: 'Profil en long' },
  ];
  return (
    <div className={`drawer ${tab ? 'open' : ''}`}>
      <div className="drawer-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => st().set('bottomTab', tab === t.id ? null : t.id)}>
            {t.label}
          </button>
        ))}
        {tab && (
          <button
            className="drawer-close"
            onClick={() => {
              st().set('bottomTab', null);
              st().set('mobileSheet', null);
            }}
            title="Réduire"
          >
            ▾
          </button>
        )}
      </div>
      {tab && (
        <div className="drawer-body">
          {tab === 'enneigeurs' && <GunsTable />}
          {tab === 'canalisations' && <PipesTable />}
          {tab === 'alertes' && <Alerts />}
          {tab === 'profil' && <ProfileChart />}
        </div>
      )}
    </div>
  );
}

function GunsTable() {
  const net = useStore((s) => s.net);
  const results = useStore((s) => s.results);
  const selection = useStore((s) => s.selection);
  const st = useStore.getState;
  const [secteur, setSecteur] = useState('');
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<'canons' | 'tous' | NodeType>('canons');
  const secteurs = useMemo(() => [...new Set(net.nodes.map((n) => n.secteur).filter(Boolean))].sort(), [net.nodes]);
  const locked = useMemo(() => new Set(net.calques.filter((l) => l.verrouille).map((l) => l.id)), [net.calques]);
  const rows = net.nodes.filter(
    (n) =>
      (typeFilter === 'tous' || (typeFilter === 'canons' ? isConsumer(n.type) : n.type === typeFilter)) &&
      (!secteur || n.secteur === secteur) &&
      (!q || `${n.nom} ${n.modele}`.toLowerCase().includes(q.toLowerCase())),
  );
  const bulk = (patch: (n: NetNode) => Partial<NetNode>) => {
    const ids = new Set(rows.filter((r) => !locked.has(r.calque)).map((r) => r.id));
    st().commit({ ...net, nodes: net.nodes.map((n) => (ids.has(n.id) ? { ...n, ...patch(n) } : n)) });
  };
  const up = (id: string, patch: Partial<NetNode>) => st().updateNode(id, patch);
  const totalQ = rows.filter((r) => r.actif).reduce((a, n) => a + effectiveFlow(n), 0);

  return (
    <>
      <div className="table-tools">
        <select value={secteur} onChange={(e) => setSecteur(e.target.value)}>
          <option value="">Toutes les pistes</option>
          {secteurs.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
          <option value="canons">Enneigeurs et regards</option>
          <option value="tous">Tous les points</option>
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>
              {NODE_LABEL[t]}
            </option>
          ))}
        </select>
        <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">
          {rows.length} points · {rows.filter((r) => r.actif).length} en production · {fmt(totalQ, 1)} m³/h
        </span>
        <span className="spacer" />
        <button className="btn small" onClick={() => bulk((n) => (isConsumer(n.type) ? { actif: true } : {}))}>
          Tout démarrer
        </button>
        <button className="btn small" onClick={() => bulk((n) => (isConsumer(n.type) ? { actif: false } : {}))}>
          Tout arrêter
        </button>
        <select
          value=""
          onChange={(e) => {
            const c = e.target.value as Couronnes;
            bulk((n) => (c === '' || n[couronneField(c)] > 0 ? { couronnes: c } : {}));
          }}
        >
          <option value="" disabled>
            Couronnes pour la liste…
          </option>
          {COURONNES.map((c) => (
            <option key={c} value={c}>
              {c.toUpperCase()}
            </option>
          ))}
          <option value="">Débit manuel</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Marche</th>
              <th>Nom</th>
              <th>Type</th>
              <th>Piste</th>
              <th>Modèle</th>
              <th>Couronnes</th>
              <th className="num">Débit m³/h</th>
              <th className="num">Alt. m</th>
              <th className="num">P mini</th>
              <th className="num">P regard bar</th>
              <th className="num">P vanne bar</th>
              <th className="num">Vitesse arrivée m/s</th>
              <th className="num">Q arrivée m³/h</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const r = results?.nodes[n.id];
              const lk = locked.has(n.calque);
              return (
                <tr key={n.id} className={selection?.id === n.id ? 'selected' : ''} onClick={() => st().setSelection({ kind: 'node', id: n.id })}>
                  <td onClick={(e) => e.stopPropagation()}>
                    {isConsumer(n.type) && <input type="checkbox" checked={n.actif} disabled={lk} onChange={(e) => up(n.id, { actif: e.target.checked })} />}
                  </td>
                  <td>{n.nom}</td>
                  <td className="muted">{NODE_LABEL[n.type]}</td>
                  <td>{n.secteur}</td>
                  <td>{n.modele}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {isConsumer(n.type) && (
                      <select value={n.couronnes} disabled={lk} onChange={(e) => up(n.id, { couronnes: e.target.value as Couronnes })}>
                        <option value="">Manuel</option>
                        {COURONNES.map((c) => (
                          <option key={c} value={c} disabled={!(n[couronneField(c)] > 0)}>
                            {c.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="num">{isConsumer(n.type) ? fmt(effectiveFlow(n), 1) : ''}</td>
                  <td className="num">{fmt(n.altitude_m, 0)}</td>
                  <td className="num">{isConsumer(n.type) ? fmt(n.pression_min_bar, 1) : ''}</td>
                  <td className="num">
                    <b>{r ? fmt(r.pression_bar, 1) : ''}</b>
                  </td>
                  <td className="num">{r?.pression_vanne_bar !== undefined ? fmt(r.pression_vanne_bar, 1) : ''}</td>
                  <td className="num">{r ? fmt(r.vitesse_arrivee_m_s, 2) : ''}</td>
                  <td className="num">{r && r.debit_arrivee_m3h > 0 ? fmt(r.debit_arrivee_m3h, 1) : ''}</td>
                  <td>{r && <Dot statut={r.statut} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PipesTable() {
  const net = useStore((s) => s.net);
  const results = useStore((s) => s.results);
  const selection = useStore((s) => s.selection);
  const st = useStore.getState;
  const nodes = useMemo(() => nodeMapOf(net), [net]);
  const [q, setQ] = useState('');
  const rows = net.pipes.filter((p) => !q || `${p.nom} ${p.materiau} DN${p.dn}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="table-tools">
        <input placeholder="Rechercher (nom, DN150, Fonte…)" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{rows.length} canalisations</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Amont</th>
              <th>Aval</th>
              <th>Matériau</th>
              <th className="num">DN</th>
              <th className="num">PN</th>
              <th className="num">Long. m</th>
              <th className="num">Débit m³/h</th>
              <th className="num">V m/s</th>
              <th className="num">m/km</th>
              <th className="num">P max</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const r = results?.pipes[p.id];
              return (
                <tr key={p.id} className={selection?.id === p.id ? 'selected' : ''} onClick={() => st().setSelection({ kind: 'pipe', id: p.id })}>
                  <td>
                    {p.nom || p.id}
                    {p.statut === 'fermee' && <span className="muted small"> (fermée)</span>}
                  </td>
                  <td>{nodes.get(p.amont)?.nom}</td>
                  <td>{nodes.get(p.aval)?.nom}</td>
                  <td>{p.materiau}</td>
                  <td className="num">{p.dn}</td>
                  <td className="num">{p.pn_bar}</td>
                  <td className="num">{fmt(pipeLength(p, nodes), 0)}</td>
                  <td className="num">{r ? fmt(Math.abs(r.debit_m3h), 1) : ''}</td>
                  <td className="num">{r ? fmt(r.vitesse_m_s, 2) : ''}</td>
                  <td className="num">{r ? fmt(r.perte_m_km, 1) : ''}</td>
                  <td className="num">{r ? fmt(r.pression_max_bar, 1) : ''}</td>
                  <td>{r && <Dot statut={r.statut} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Dot({ statut }: { statut: keyof typeof STATUS_LABEL }) {
  return (
    <span className="dot-label">
      <i style={{ background: STATUS_COLOR[statut] }} />
      {STATUS_LABEL[statut]}
    </span>
  );
}

function Alerts() {
  const net = useStore((s) => s.net);
  const results = useStore((s) => s.results);
  const stale = useStore((s) => s.stale);
  const st = useStore.getState;
  if (!results) return <p className="empty">Lancez un calcul (▶ Calculer) pour voir les alertes.</p>;
  const items: { kind: 'node' | 'pipe'; id: string; name: string; what: string; statut: 'erreur' | 'alerte'; msg: string }[] = [];
  for (const n of net.nodes) {
    const r = results.nodes[n.id];
    if (r && (r.statut === 'erreur' || r.statut === 'alerte')) items.push({ kind: 'node', id: n.id, name: n.nom || n.id, what: NODE_LABEL[n.type], statut: r.statut, msg: r.messages.join(' ') });
  }
  for (const p of net.pipes) {
    const r = results.pipes[p.id];
    if (r && (r.statut === 'erreur' || r.statut === 'alerte')) items.push({ kind: 'pipe', id: p.id, name: p.nom || p.id, what: `Canalisation DN${p.dn}`, statut: r.statut, msg: r.messages.join(' ') });
  }
  items.sort((a, b) => (a.statut === b.statut ? 0 : a.statut === 'erreur' ? -1 : 1));
  const excluded = new Set(net.calques.filter((l) => !l.calcul).map((l) => l.id));
  const isolated = net.nodes.filter((n) => isConsumer(n.type) && n.actif && !excluded.has(n.calque) && results.nodes[n.id]?.statut === 'isole');
  return (
    <div className="alerts">
      {stale && <div className="notice">Le réseau a été modifié depuis ce calcul.</div>}
      {results.messages.map((m, i) => (
        <div key={i} className="notice">
          {m}
        </div>
      ))}
      <p className="small muted">
        Calcul « {results.scenario} » — {results.iterations} itérations, {results.converged ? 'convergé' : 'non convergé'}. Débit total {fmt(results.totals.debit_total_m3h, 0)} m³/h.
      </p>
      {!items.length && !isolated.length && <p className="empty ok">✔ Aucune alerte : vitesses, pressions et PN conformes.</p>}
      <ul>
        {items.map((it) => (
          <li key={it.kind + it.id} onClick={() => st().setSelection({ kind: it.kind, id: it.id })}>
            <i style={{ background: STATUS_COLOR[it.statut] }} />
            <b>{it.name}</b> <span className="muted small">{it.what}</span> — {it.msg}
          </li>
        ))}
        {isolated.map((n) => (
          <li key={'i' + n.id} onClick={() => st().setSelection({ kind: 'node', id: n.id })}>
            <i style={{ background: STATUS_COLOR.isole }} />
            <b>{n.nom}</b> <span className="muted small">Enneigeur</span> — {results.nodes[n.id].messages.join(' ')}
          </li>
        ))}
      </ul>
    </div>
  );
}
