import { useStore } from '../store';
import type { Dialog } from '../App';
import { demoNetwork } from '../model/demo';
import { loadFromSheets } from '../services/sheets';

export default function Welcome({ openDialog }: { openDialog: (d: Dialog) => void }) {
  const settings = useStore((s) => s.settings);
  const st = useStore.getState;
  const openSheets = async () => {
    if (!settings.sheetsUrl) return openDialog('settings');
    try {
      st().set('busy', 'Chargement depuis Google Sheets…');
      const n = await loadFromSheets(settings);
      st().replaceNetwork(n);
      st().toast(`Réseau chargé : ${n.nodes.length} nœuds.`, 'success');
    } catch (e) {
      st().toast((e as Error).message, 'error');
    } finally {
      st().set('busy', null);
    }
  };
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>Bienvenue dans PipeFlow Neige</h1>
        <p className="muted">Calculez les débits et pressions de votre réseau de neige de culture, simulez vos scénarios de production et vos projets d’extension.</p>
        <div className="welcome-actions">
          <button className="welcome-action" onClick={() => openDialog('import')}>
            <span className="wa-icon">🗺️</span>
            <b>Importer mes fichiers KMZ</b>
            <span className="muted small">Canons, regards et canalisations depuis Google Earth, + CSV des débits</span>
          </button>
          <button className="welcome-action" onClick={openSheets}>
            <span className="wa-icon">☁️</span>
            <b>Ouvrir la base Google Sheets</b>
            <span className="muted small">{settings.sheetsUrl ? 'Charger le réseau enregistré' : 'Configurer la liaison (une seule fois)'}</span>
          </button>
          <button
            className="welcome-action"
            onClick={() => {
              st().replaceNetwork(demoNetwork());
              st().runCalc();
            }}
          >
            <span className="wa-icon">🎿</span>
            <b>Découvrir avec un exemple</b>
            <span className="muted small">Petit réseau fictif avec surpresseur et calque projet</span>
          </button>
        </div>
        <ol className="steps small">
          <li>Importez ou dessinez le réseau</li>
          <li>Ajustez diamètres, débits et salles des machines</li>
          <li>Cliquez sur ▶ Calculer</li>
        </ol>
      </div>
    </div>
  );
}
