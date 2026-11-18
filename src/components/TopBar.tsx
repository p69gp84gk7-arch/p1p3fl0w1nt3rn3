import { useState } from 'react';
import { useStore } from '../store';
import type { Dialog } from '../App';
import { captureScenario } from '../model/scenario';
import { loadFromSheets, saveResultsToSheets, saveToSheets } from '../services/sheets';
import { downloadFile } from '../services/storage';
import { resultsCsv } from './exports';
import { fmt } from './display';
import { emptyNetwork } from '../model/defaults';

export default function TopBar({ openDialog }: { openDialog: (d: Dialog) => void }) {
  const net = useStore((s) => s.net);
  const results = useStore((s) => s.results);
  const stale = useStore((s) => s.stale);
  const scenario = useStore((s) => s.scenario);
  const settings = useStore((s) => s.settings);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const st = useStore.getState;
  const [menu, setMenu] = useState<'fichier' | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const calc = (statique = false) => {
    const r = st().runCalc(statique);
    if (r.messages.length && !r.converged) st().toast(r.messages[0], 'error');
    else if (r.messages.length) st().toast(r.messages[0], 'info');
    else if (r.totals.enneigeurs_insuffisants) st().toast(`${r.totals.enneigeurs_insuffisants} enneigeur(s) en pression insuffisante.`, 'error');
    else st().toast(statique ? 'Pression statique calculée.' : 'Calcul terminé : tous les enneigeurs actifs sont correctement alimentés.', 'success');
    st().set('bottomTab', st().bottomTab ?? 'alertes');
  };

  const sheets = async (what: 'load' | 'save' | 'results') => {
    if (!settings.sheetsUrl) {
      st().toast('Configurez d’abord la liaison Google Sheets dans les Réglages.', 'error');
      openDialog('settings');
      return;
    }
    setSyncing(what);
    try {
      if (what === 'load') {
        if (net.nodes.length && !confirm('Remplacer le réseau affiché par celui de Google Sheets ?')) return;
        const n = await loadFromSheets(settings);
        st().replaceNetwork(n);
        st().toast(`Réseau chargé : ${n.nodes.length} nœuds, ${n.pipes.length} canalisations.`, 'success');
      } else if (what === 'save') {
        await saveToSheets(settings, net);
        st().toast('Réseau enregistré dans Google Sheets.', 'success');
      } else {
        const r = results ?? st().runCalc();
        await saveResultsToSheets(settings, net, r);
        st().toast('Résultats envoyés dans Google Sheets.', 'success');
      }
    } catch (e) {
      st().toast((e as Error).message, 'error');
    } finally {
      setSyncing(null);
    }
  };

  const saveScenario = () => {
    const nom = prompt('Nom du scénario (ex. « Nuit froide – Lac + Marmottes ») :', scenario || '');
    if (!nom) return;
    const sc = captureScenario(net, nom.trim());
    st().commit({ ...net, scenarios: [...net.scenarios.filter((s) => s.nom !== sc.nom), sc] });
    st().set('scenario', sc.nom);
    st().toast(`Scénario « ${sc.nom} » enregistré.`, 'success');
  };

  const t = results?.totals;
  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden>
          <rect width="64" height="64" rx="14" fill="#1c5c9e" />
          <g stroke="#fff" strokeWidth="4" strokeLinecap="round">
            <path d="M32 12v40M14.7 22l34.6 20M14.7 42l34.6-20" />
          </g>
        </svg>
        <div>
          <div className="brand-name">PipeFlow Neige</div>
          <input
            className="project-name"
            value={net.params.nom_projet}
            onChange={(e) => st().patchSilently((n) => ({ ...n, params: { ...n.params, nom_projet: e.target.value } }))}
            aria-label="Nom du projet"
          />
        </div>
      </div>

      <div className="topbar-group">
        <div className="menu">
          <button className="btn" onClick={() => setMenu(menu ? null : 'fichier')}>
            Fichier ▾
          </button>
          {menu === 'fichier' && (
            <div className="menu-pop" onMouseLeave={() => setMenu(null)} onClick={() => setMenu(null)}>
              <button onClick={() => openDialog('import')}>📥 Importer KMZ / CSV / JSON…</button>
              <hr />
              <button onClick={() => sheets('load')}>☁️ Ouvrir depuis Google Sheets</button>
              <button onClick={() => sheets('save')}>💾 Enregistrer dans Google Sheets</button>
              <button onClick={() => sheets('results')}>📊 Envoyer les résultats dans Google Sheets</button>
              <hr />
              <button onClick={() => downloadFile(`${slug(net.params.nom_projet)}.json`, JSON.stringify(net, null, 1))}>⬇️ Exporter le réseau (JSON)</button>
              <button
                disabled={!results}
                onClick={() => results && downloadFile(`${slug(net.params.nom_projet)}-resultats.csv`, resultsCsv(net, results), 'text/csv;charset=utf-8')}
              >
                ⬇️ Exporter les résultats (CSV)
              </button>
              <hr />
              <button
                onClick={() => {
                  if (confirm('Effacer tout le réseau affiché ? (les données Google Sheets ne sont pas touchées)')) {
                    st().replaceNetwork(emptyNetwork());
                  }
                }}
              >
                🗑️ Nouveau projet vide
              </button>
            </div>
          )}
        </div>
        <button className="btn icon" title="Annuler (Ctrl+Z)" disabled={!past} onClick={() => st().undo()}>
          ↶
        </button>
        <button className="btn icon" title="Rétablir (Ctrl+Y)" disabled={!future} onClick={() => st().redo()}>
          ↷
        </button>
        <button className="btn" title="Enregistrer dans Google Sheets" onClick={() => sheets('save')} disabled={!!syncing}>
          {syncing ? <span className="spinner dark" /> : '☁️'} {syncing === 'load' ? 'Chargement…' : syncing ? 'Envoi…' : 'Enregistrer'}
        </button>
      </div>

      <div className="topbar-group scenario">
        <label className="muted small">Scénario</label>
        <select value={scenario} onChange={(e) => st().loadScenario(e.target.value)}>
          <option value="">État actuel</option>
          {net.scenarios.map((s) => (
            <option key={s.nom} value={s.nom}>
              {s.nom}
            </option>
          ))}
        </select>
        <button className="btn" title="Enregistrer l’état des enneigeurs comme scénario" onClick={saveScenario}>
          ＋
        </button>
      </div>

      <div className="topbar-group grow-right">
        {t && (
          <div className={`summary ${stale ? 'is-stale' : ''}`} title={stale ? 'Le réseau a changé depuis le dernier calcul' : results?.scenario}>
            <span>
              <b>{fmt(t.debit_total_m3h, 0)}</b> m³/h
            </span>
            <span className="ok">● {t.enneigeurs_ok}</span>
            {t.enneigeurs_insuffisants > 0 && <span className="ko">● {t.enneigeurs_insuffisants}</span>}
            {stale && <span className="muted">à recalculer</span>}
          </div>
        )}
        <button className="btn" onClick={() => calc(true)} title="Tous les enneigeurs à l’arrêt : vérifie les pressions maximales (PN)">
          Pression statique
        </button>
        <button className="btn primary" onClick={() => calc()} title="Lancer le calcul (Ctrl+Entrée)">
          ▶ Calculer
        </button>
        <button className="btn icon" title="Réglages" onClick={() => openDialog('settings')}>
          ⚙
        </button>
        <button className="btn icon" title="Aide" onClick={() => openDialog('help')}>
          ?
        </button>
      </div>
    </header>
  );
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'reseau';
