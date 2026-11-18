import { useMemo, useState } from 'react';
import Modal from './Modal';
import { useStore } from '../store';
import { allOpenNetwork, autoSize, calibrateUniform, candidateSpecs, withUniformSpec, type UniformTrial } from '../hydraulics/diametres';
import type { Network, Pipe } from '../model/types';
import { NumField, Row } from './fields';
import { fmt } from './display';

/** Estimation des diamètres inconnus : calage sur une pression mesurée ou dimensionnement automatique. */
export default function DiametersDialog({ onClose }: { onClose: () => void }) {
  const net = useStore((s) => s.net);
  const st = useStore.getState;
  const guns = useMemo(() => net.nodes.filter((n) => n.type === 'enneigeur').sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true })), [net.nodes]);
  const [nodeId, setNodeId] = useState(guns.find((n) => n.nom === '122')?.id ?? guns[0]?.id ?? '');
  const [mesure, setMesure] = useState(16);
  const [cond, setCond] = useState<'tout' | 'actuel'>('tout');
  const [scope, setScope] = useState<'estimes' | 'toutes'>(net.pipes.some((p) => p.diametre_estime) ? 'estimes' : 'toutes');
  const [vmax, setVmax] = useState(2);
  const materiaux = useMemo(() => [...new Set(net.catalogue.map((c) => `${c.materiau}|${c.pn_bar}`))], [net.catalogue]);
  const [mat, setMat] = useState(materiaux.find((m) => m.startsWith('Fonte ductile|64')) ?? materiaux[0]);
  const [trials, setTrials] = useState<UniformTrial[] | null>(null);

  const [materiau, pnStr] = mat.split('|');
  const specs = candidateSpecs(net.catalogue, materiau, Number(pnStr));
  const only = (p: Pipe) => scope === 'toutes' || p.diametre_estime;
  const scenario = (n: Network) => (cond === 'tout' ? allOpenNetwork(n) : n);
  const nEstimes = net.pipes.filter((p) => p.diametre_estime).length;
  const best = trials?.filter((t) => Number.isFinite(t.pression)).sort((a, b) => Math.abs(a.pression - mesure) - Math.abs(b.pression - mesure))[0];
  const nodeName = net.nodes.find((n) => n.id === nodeId)?.nom;

  return (
    <Modal title="Diamètres des canalisations" onClose={onClose} wide>
      <p className="small muted">
        Quand les diamètres réels ne sont pas connus, ils peuvent être estimés. Les canalisations concernées sont marquées « estimé » et restent modifiables une à une (ou dans Google Sheets). Les diamètres réels donnent toujours un calcul plus juste.
      </p>
      <div className="grid2">
        <div>
          <Row label="Canalisations">
            <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="estimes">Diamètres estimés seulement ({nEstimes})</option>
              <option value="toutes">Toutes ({net.pipes.length})</option>
            </select>
          </Row>
          <Row label="Type de tuyau">
            <select value={mat} onChange={(e) => setMat(e.target.value)}>
              {materiaux.map((m) => (
                <option key={m} value={m}>
                  {m.replace('|', ' PN')}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Canons">
            <select value={cond} onChange={(e) => setCond(e.target.value as typeof cond)}>
              <option value="tout">Tous ouverts (C1+C2+C3)</option>
              <option value="actuel">État / scénario actuel</option>
            </select>
          </Row>
        </div>
        <div>
          <h4>1. Caler sur une pression mesurée</h4>
          <Row label="Canon">
            <select value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
              {guns.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nom} {n.secteur && `(${n.secteur})`}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Pression mesurée">
            <NumField value={mesure} unit="bar" digits={1} onChange={setMesure} />
          </Row>
          <button className="btn small" onClick={() => setTrials(calibrateUniform(st().net, scenario, nodeId, specs, only))}>
            Chercher le diamètre
          </button>
        </div>
      </div>

      {trials && (
        <div className="table-wrap tall">
          <table>
            <thead>
              <tr>
                <th>Diamètre</th>
                <th className="num">Pression calculée au {nodeName}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {trials.map((t) => (
                <tr key={t.spec.ref} className={t === best ? 'selected' : ''}>
                  <td>
                    DN{t.spec.dn} <span className="muted">({t.spec.ref}, Ø int. {t.spec.diametre_int_mm} mm)</span>
                  </td>
                  <td className="num">{fmt(t.pression, 1)} bar</td>
                  <td>
                    <button
                      className={`btn small ${t === best ? 'primary' : ''}`}
                      onClick={() => {
                        st().commit(withUniformSpec(st().net, t.spec, only));
                        st().runCalc();
                        st().toast(`DN${t.spec.dn} appliqué aux canalisations ${scope === 'estimes' ? 'estimées' : ''} (${fmt(t.pression, 1)} bar au ${nodeName}).`, 'success');
                        onClose();
                      }}
                    >
                      Appliquer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4>2. Ou dimensionner automatiquement</h4>
      <p className="small muted">Chaque canalisation reçoit le plus petit diamètre du catalogue qui garde la vitesse sous le seuil, pour la condition choisie.</p>
      <div className="calage-actions">
        <Row label="Vitesse maximale">
          <NumField value={vmax} unit="m/s" digits={1} onChange={setVmax} />
        </Row>
        <button
          className="btn small"
          onClick={() => {
            st().commit(autoSize(st().net, scenario, specs, vmax, only));
            st().runCalc();
            st().toast(`Diamètres dimensionnés pour ${fmt(vmax, 1)} m/s maximum.`, 'success');
            onClose();
          }}
        >
          Dimensionner
        </button>
      </div>
    </Modal>
  );
}
