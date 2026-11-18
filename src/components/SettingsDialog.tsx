import { useState } from 'react';
import { useStore } from '../store';
import Modal from './Modal';
import { NumField, Row, TextField } from './fields';
import { pingSheets } from '../services/sheets';
import type { GunModel, Params, PipeSpec } from '../model/types';
import type { ElevationSource } from '../services/elevation';

type Tab = 'sheets' | 'calcul' | 'catalogue' | 'modeles';

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('sheets');
  return (
    <Modal title="Réglages" onClose={onClose} wide>
      <div className="tabs">
        {(
          [
            ['sheets', 'Google Sheets'],
            ['calcul', 'Calcul & altitudes'],
            ['catalogue', 'Catalogue de canalisations'],
            ['modeles', 'Modèles d’enneigeurs'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'sheets' && <SheetsTab />}
      {tab === 'calcul' && <CalcTab />}
      {tab === 'catalogue' && <CatalogueTab />}
      {tab === 'modeles' && <ModelsTab />}
    </Modal>
  );
}

function SheetsTab() {
  const settings = useStore((s) => s.settings);
  const st = useStore.getState;
  const [test, setTest] = useState<string | null>(null);
  return (
    <div>
      <p>
        Le réseau est enregistré dans un classeur Google Sheets (onglets <i>Noeuds</i>, <i>Canalisations</i>, <i>Calques</i>, <i>Scenarios</i>, <i>Catalogue_Tuyaux</i>, <i>Modeles_Enneigeurs</i>, <i>Parametres</i> et résultats). L’application y accède via un petit script Apps Script.
      </p>
      <details className="howto">
        <summary>Mise en place (5 minutes, une seule fois)</summary>
        <ol>
          <li>Ouvrez le classeur, menu <b>Extensions → Apps Script</b>.</li>
          <li>
            Remplacez le contenu de <code>Code.gs</code> par le fichier <code>apps-script/Code.gs</code> du dépôt GitHub, puis enregistrez.
          </li>
          <li>
            (Facultatif) <b>Paramètres du projet → Propriétés du script</b> : ajoutez <code>API_KEY</code> avec un mot de passe, et saisissez-le ci-dessous.
          </li>
          <li>
            <b>Déployer → Nouveau déploiement → Application Web</b> : « Exécuter en tant que : moi », « Accès : tout le monde ». Autorisez l’accès.
          </li>
          <li>Copiez l’URL de l’application Web (se termine par <code>/exec</code>) dans le champ ci-dessous.</li>
        </ol>
      </details>
      <Row label="URL de l’application Web">
        <TextField value={settings.sheetsUrl} placeholder="https://script.google.com/macros/s/…/exec" onChange={(v) => st().updateSettings({ sheetsUrl: v.trim() })} />
      </Row>
      <Row label="Clé d’accès (API_KEY)">
        <TextField value={settings.apiKey} placeholder="facultatif" onChange={(v) => st().updateSettings({ apiKey: v.trim() })} />
      </Row>
      <Row label="Lien du classeur">
        <TextField value={settings.sheetLink} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(v) => st().updateSettings({ sheetLink: v.trim() })} />
        {settings.sheetLink && (
          <a className="btn small" href={settings.sheetLink} target="_blank" rel="noreferrer">
            Ouvrir
          </a>
        )}
      </Row>
      <div className="modal-actions">
        <button
          className="btn"
          disabled={!settings.sheetsUrl}
          onClick={async () => {
            setTest('…');
            try {
              const r = await pingSheets(settings);
              setTest(`✔ Connecté à « ${r.title} » (${r.sheets.length} onglets)`);
            } catch (e) {
              setTest(`✖ ${(e as Error).message}`);
            }
          }}
        >
          Tester la connexion
        </button>
        {test && <span className="small">{test}</span>}
      </div>
    </div>
  );
}

function CalcTab() {
  const params = useStore((s) => s.net.params);
  const settings = useStore((s) => s.settings);
  const st = useStore.getState;
  const up = (p: Partial<Params>) => st().commit({ ...st().net, params: { ...st().net.params, ...p } });
  return (
    <div className="grid2">
      <div>
        <h4>Hypothèses de calcul</h4>
        <Row label="Température de l’eau">
          <NumField value={params.temperature_eau_c} unit="°C" digits={1} onChange={(v) => up({ temperature_eau_c: v })} />
        </Row>
        <Row label="Vitesse maximale conseillée">
          <NumField value={params.vitesse_max_m_s} unit="m/s" onChange={(v) => up({ vitesse_max_m_s: v })} />
        </Row>
        <Row label="Marge sur la PN">
          <NumField value={params.marge_pn_pct} unit="%" digits={0} onChange={(v) => up({ marge_pn_pct: v })} />
        </Row>
        <Row label="Débit par défaut (nouvel enneigeur)">
          <NumField value={params.debit_defaut_m3h} unit="m³/h" onChange={(v) => up({ debit_defaut_m3h: v })} />
        </Row>
        <Row label="Pression mini par défaut">
          <NumField value={params.pression_min_defaut_bar} unit="bar" onChange={(v) => up({ pression_min_defaut_bar: v })} />
        </Row>
        <p className="small muted">
          Pertes de charge : Darcy-Weisbach (λ de Swamee-Jain) + pertes singulières K·V²/2g. Résolution par la méthode du gradient global (EPANET), réseaux ramifiés et maillés.
        </p>
      </div>
      <div>
        <h4>Altitudes</h4>
        <Row label="Source">
          <select value={settings.elevationSource} onChange={(e) => st().updateSettings({ elevationSource: e.target.value as ElevationSource })}>
            <option value="auto">Automatique (IGN puis mondial)</option>
            <option value="ign">IGN RGE ALTI® (France, ~1 m)</option>
            <option value="open-meteo">Copernicus DEM 90 m (monde)</option>
          </select>
        </Row>
        <p className="small muted">
          L’altitude de chaque regard, canon ou nœud est lue depuis sa position GPS à l’import, à la création et à chaque déplacement. Elle reste modifiable à la main.
        </p>
      </div>
    </div>
  );
}

function EditableTable<T extends object>({
  rows,
  cols,
  onChange,
  make,
}: {
  rows: T[];
  cols: { key: keyof T; label: string; num?: boolean }[];
  onChange: (rows: T[]) => void;
  make: () => T;
}) {
  return (
    <>
      <div className="table-wrap tall">
        <table className="editable">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={String(c.key)}>{c.label}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={String(c.key)}>
                    {c.num ? (
                      <NumField value={r[c.key] as number} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: v } : x)))} />
                    ) : (
                      <TextField value={String(r[c.key] ?? '')} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: v } : x)))} />
                    )}
                  </td>
                ))}
                <td>
                  <button className="btn icon small" title="Supprimer" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn small" onClick={() => onChange([...rows, make()])}>
        ＋ Ajouter une ligne
      </button>
    </>
  );
}

function CatalogueTab() {
  const catalogue = useStore((s) => s.net.catalogue);
  const st = useStore.getState;
  return (
    <EditableTable<PipeSpec>
      rows={catalogue}
      onChange={(rows) => st().commit({ ...st().net, catalogue: rows })}
      make={() => ({ ref: 'NOUVEAU', materiau: 'Fonte ductile', dn: 150, pn_bar: 64, diametre_int_mm: 151, rugosite_mm: 0.1 })}
      cols={[
        { key: 'ref', label: 'Référence' },
        { key: 'materiau', label: 'Matériau' },
        { key: 'dn', label: 'DN', num: true },
        { key: 'pn_bar', label: 'PN (bar)', num: true },
        { key: 'diametre_int_mm', label: 'Ø int. (mm)', num: true },
        { key: 'rugosite_mm', label: 'Rugosité (mm)', num: true },
      ]}
    />
  );
}

function ModelsTab() {
  const modeles = useStore((s) => s.net.modeles);
  const st = useStore.getState;
  return (
    <EditableTable<GunModel>
      rows={modeles}
      onChange={(rows) => st().commit({ ...st().net, modeles: rows })}
      make={() => ({ modele: 'Nouveau modèle', type: 'perche', debit_nominal_m3h: 15, debit_min_m3h: 3, debit_max_m3h: 25, pression_min_bar: 15, pression_max_bar: 60, k_buse: 2.5 })}
      cols={[
        { key: 'modele', label: 'Modèle' },
        { key: 'type', label: 'Type' },
        { key: 'debit_nominal_m3h', label: 'Q nominal (m³/h)', num: true },
        { key: 'debit_min_m3h', label: 'Q min', num: true },
        { key: 'debit_max_m3h', label: 'Q max', num: true },
        { key: 'pression_min_bar', label: 'P min (bar)', num: true },
        { key: 'pression_max_bar', label: 'P max (bar)', num: true },
        { key: 'k_buse', label: 'k buse', num: true },
      ]}
    />
  );
}
