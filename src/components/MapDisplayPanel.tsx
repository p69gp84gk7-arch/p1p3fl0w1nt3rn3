import { useMemo } from 'react';
import { useStore, type ColorBy } from '../store';
import { NODE_LABEL, NODE_TYPES } from '../model/defaults';
import type { NodeLabelField, PipeLabelField } from '../services/storage';
import { categoryColor, DN_BINS, DRY_COLOR, nodeSvg, PRESSURE_BINS, STATUS_COLOR, STATUS_LABEL, VELOCITY_BINS, type Bin } from './display';
import { NODE_FIELDS, PIPE_FIELDS } from './labels';

const COLOR_MODES: { id: ColorBy; label: string; help: string }[] = [
  { id: 'statut', label: 'État (résultat du calcul)', help: 'Vert : conforme. Orange : à surveiller (vitesse élevée…). Rouge : problème (pression insuffisante, dépassement PN…). Gris : non alimenté.' },
  { id: 'pression', label: 'Pression', help: 'Pression calculée aux points ; sur les canalisations, pression la plus basse du tronçon.' },
  { id: 'remplissage', label: 'Niveau d’eau (remplissage)', help: 'Parties en couleur : remplies d’eau sous pression (couleur = pression). Gris clair : au-dessus du niveau d’eau, canalisation vide.' },
  { id: 'vitesse', label: 'Vitesse de l’eau', help: 'Vitesse dans chaque canalisation. Au-delà de 2,5–3 m/s : risque de coups de bélier et d’usure.' },
  { id: 'diametre', label: 'Diamètre', help: 'Diamètre nominal (DN) ; l’épaisseur du trait suit aussi le diamètre.' },
  { id: 'calque', label: 'Calque', help: 'Couleur du calque (existant, projets…).' },
  { id: 'secteur', label: 'Piste / secteur', help: 'Une couleur par piste.' },
];

export default function MapDisplayPanel() {
  const settings = useStore((s) => s.settings);
  const colorBy = useStore((s) => s.colorBy);
  const results = useStore((s) => s.results);
  const net = useStore((s) => s.net);
  const st = useStore.getState;
  const up = st().updateSettings;

  const toggleNode = (f: NodeLabelField) =>
    up({ nodeLabels: settings.nodeLabels.includes(f) ? settings.nodeLabels.filter((x) => x !== f) : NODE_FIELDS.map((d) => d.id).filter((id) => id === f || settings.nodeLabels.includes(id)) });
  const togglePipe = (f: PipeLabelField) =>
    up({ pipeLabels: settings.pipeLabels.includes(f) ? settings.pipeLabels.filter((x) => x !== f) : PIPE_FIELDS.map((d) => d.id).filter((id) => id === f || settings.pipeLabels.includes(id)) });

  const typesPresent = useMemo(() => NODE_TYPES.filter((t) => net.nodes.some((n) => n.type === t)), [net.nodes]);
  const secteurs = useMemo(() => [...new Set(net.nodes.map((n) => n.secteur).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')), [net.nodes]);
  const mode = COLOR_MODES.find((m) => m.id === colorBy)!;

  if (!settings.legendOpen) {
    return (
      <button className="map-panel-toggle" onClick={() => up({ legendOpen: true })}>
        🎨 Affichage & légende
      </button>
    );
  }

  const selectedNodeFields = NODE_FIELDS.filter((f) => settings.nodeLabels.includes(f.id));
  const selectedPipeFields = PIPE_FIELDS.filter((f) => settings.pipeLabels.includes(f.id));
  const needsCalc = !results && (selectedNodeFields.some((f) => f.needsResults) || selectedPipeFields.some((f) => f.needsResults) || ['statut', 'pression', 'remplissage', 'vitesse'].includes(colorBy));

  return (
    <div className="map-panel" onWheel={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="map-panel-head">
        <b>Affichage & légende</b>
        <button className="btn icon small" title="Réduire" onClick={() => up({ legendOpen: false })}>
          ▴
        </button>
      </div>
      <div className="map-panel-body">
        {needsCalc && <div className="notice small">Lancez ▶ Calculer pour afficher pressions, vitesses et niveaux d’eau.</div>}

        <h5>Couleurs</h5>
        <select value={colorBy} onChange={(e) => st().set('colorBy', e.target.value as ColorBy)}>
          {COLOR_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="help">{mode.help}</p>
        {colorBy === 'statut' && (
          <ul className="legend">
            {(['ok', 'alerte', 'erreur', 'isole'] as const).map((k) => (
              <li key={k}>
                <i style={{ background: STATUS_COLOR[k] }} /> {STATUS_LABEL[k]}
              </li>
            ))}
          </ul>
        )}
        {(colorBy === 'pression' || colorBy === 'remplissage') && <BinsLegend bins={PRESSURE_BINS} />}
        {colorBy === 'remplissage' && (
          <ul className="legend">
            <li>
              <i style={{ background: DRY_COLOR }} /> Vide (au-dessus du niveau d’eau)
            </li>
          </ul>
        )}
        {colorBy === 'vitesse' && <BinsLegend bins={VELOCITY_BINS} />}
        {colorBy === 'diametre' && <BinsLegend bins={DN_BINS} />}
        {colorBy === 'calque' && (
          <ul className="legend">
            {net.calques.map((l) => (
              <li key={l.id}>
                <i style={{ background: l.couleur }} /> {l.nom}
              </li>
            ))}
          </ul>
        )}
        {colorBy === 'secteur' && (
          <ul className="legend">
            {secteurs.map((s) => (
              <li key={s}>
                <i style={{ background: categoryColor(s) }} /> {s}
              </li>
            ))}
          </ul>
        )}

        <h5>Bulles des points</h5>
        <div className="checks">
          {NODE_FIELDS.map((f) => (
            <label key={f.id} title={f.help}>
              <input type="checkbox" checked={settings.nodeLabels.includes(f.id)} onChange={() => toggleNode(f.id)} /> {f.label}
            </label>
          ))}
        </div>
        <div className="checks inline">
          <span className="muted">Sur :</span>
          <label>
            <input type="checkbox" checked={settings.labelGuns} onChange={(e) => up({ labelGuns: e.target.checked })} /> canons
          </label>
          <label>
            <input type="checkbox" checked={settings.labelOthers} onChange={(e) => up({ labelOthers: e.target.checked })} /> regards, vannes, pompes
          </label>
          <label>
            <input type="checkbox" checked={settings.labelJunctions} onChange={(e) => up({ labelJunctions: e.target.checked })} /> jonctions
          </label>
        </div>
        <label className="check small">
          <input type="checkbox" checked={settings.labelsAlways} onChange={(e) => up({ labelsAlways: e.target.checked })} /> Afficher même en vue éloignée
          {!settings.labelsAlways && <span className="muted"> (sinon : en zoomant)</span>}
        </label>
        {selectedNodeFields.length > 0 && (
          <div className="bubble-legend">
            <span className="bubble sample">
              {selectedNodeFields.map((f) => (
                <span key={f.id} dangerouslySetInnerHTML={{ __html: f.sample }} />
              ))}
            </span>
            <dl>
              {selectedNodeFields.map((f) => (
                <div key={f.id}>
                  <dt dangerouslySetInnerHTML={{ __html: f.sample }} />
                  <dd>{f.help}</dd>
                </div>
              ))}
            </dl>
            {settings.nodeLabels.includes('pression') && (
              <p className="help">
                <span className="ko">P en rouge</span> : pression inférieure à la pression mini du canon. « sec » : point non alimenté.
              </p>
            )}
          </div>
        )}

        <h5>Étiquettes des canalisations</h5>
        <div className="checks">
          {PIPE_FIELDS.map((f) => (
            <label key={f.id} title={f.help}>
              <input type="checkbox" checked={settings.pipeLabels.includes(f.id)} onChange={() => togglePipe(f.id)} /> {f.label}
            </label>
          ))}
        </div>
        {selectedPipeFields.length > 0 && (
          <p className="help">
            <span className="pipe-sample">{selectedPipeFields.map((f) => f.label).join(' · ')}</span> au milieu de chaque canalisation {settings.labelsAlways ? '' : '(en zoomant)'}.
          </p>
        )}

        <h5>Symboles</h5>
        <ul className="symbols">
          {typesPresent.map((t) => (
            <li key={t}>
              <span dangerouslySetInnerHTML={{ __html: nodeSvg(t, t === 'salle_machines' ? '#1c3f6e' : '#2a7fc0', 16) }} /> {NODE_LABEL[t]}
            </li>
          ))}
          <li>
            <span dangerouslySetInnerHTML={{ __html: nodeSvg('enneigeur', '#2a7fc0', 16, true) }} /> Canon à l’arrêt (pâle)
          </li>
          {typesPresent.includes('vanne') && (
            <li>
              <span dangerouslySetInnerHTML={{ __html: nodeSvg('vanne', '#2a7fc0', 16, true) }} /> Vanne fermée (rouge)
            </li>
          )}
          <li>
            <svg width="34" height="10">
              <line x1="2" y1="5" x2="32" y2="5" stroke="#1c5c9e" strokeWidth="3" />
            </svg>{' '}
            Trait plus épais = plus gros diamètre
          </li>
          <li>
            <svg width="34" height="10">
              <line x1="2" y1="5" x2="32" y2="5" stroke="#1c5c9e" strokeWidth="3" strokeDasharray="1 5" strokeLinecap="round" />
            </svg>{' '}
            Canalisation fermée
          </li>
          <li>
            <svg width="34" height="10">
              <line x1="2" y1="5" x2="32" y2="5" stroke="#d9822b" strokeWidth="3" strokeDasharray="8 5" />
            </svg>{' '}
            Calque non inclus dans le calcul
          </li>
        </ul>
      </div>
    </div>
  );
}

function BinsLegend({ bins }: { bins: Bin[] }) {
  return (
    <ul className="legend">
      {bins.map((b) => (
        <li key={b.label}>
          <i style={{ background: b.color }} /> {b.label}
        </li>
      ))}
    </ul>
  );
}

