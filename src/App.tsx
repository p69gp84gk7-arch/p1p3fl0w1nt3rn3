import { useEffect, useState } from 'react';
import MapView from './components/MapView';
import TopBar from './components/TopBar';
import Toolbar from './components/Toolbar';
import SidePanel from './components/SidePanel';
import BottomDrawer from './components/BottomDrawer';
import Toasts from './components/Toasts';
import Welcome from './components/Welcome';
import ImportDialog from './components/ImportDialog';
import SettingsDialog from './components/SettingsDialog';
import HelpDialog from './components/HelpDialog';
import { useStore } from './store';
import { deleteNode, deletePipe } from './model/edit';

export type Dialog = 'import' | 'settings' | 'help' | null;

export default function App() {
  const [dialog, setDialog] = useState<Dialog>(null);
  const empty = useStore((s) => s.net.nodes.length === 0 && s.net.pipes.length === 0);
  const busy = useStore((s) => s.busy);
  const tool = useStore((s) => s.tool);

  useKeyboardShortcuts();

  return (
    <div className={`app tool-${tool.kind}`}>
      <TopBar openDialog={setDialog} />
      <div className="workspace">
        <Toolbar />
        <div className="map-area">
          <MapView />
          <ToolHint />
          {empty && <Welcome openDialog={setDialog} />}
          <BottomDrawer />
        </div>
        <SidePanel />
      </div>
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {busy && (
        <div className="busy">
          <span className="spinner" /> {busy}
        </div>
      )}
      <Toasts />
    </div>
  );
}

const HINTS: Record<string, string> = {
  add: 'Cliquez sur la carte pour placer l’élément — sur une canalisation, il y est raccordé automatiquement. Échap pour terminer.',
  draw: 'Cliquez sur un nœud (ou une canalisation) de départ, ajoutez des points intermédiaires, puis cliquez sur le nœud d’arrivée. Double-clic : terminer sur une nouvelle jonction. Échap : annuler.',
  move: 'Faites glisser les éléments pour les déplacer. L’altitude est mise à jour automatiquement.',
  split: 'Cliquez sur une canalisation pour la couper en deux (une jonction est insérée).',
  reconnect: 'Cliquez sur le nœud auquel rattacher l’extrémité de la canalisation. Échap pour annuler.',
};

function ToolHint() {
  const tool = useStore((s) => s.tool);
  const hint = HINTS[tool.kind];
  if (!hint) return null;
  return (
    <div className="tool-hint">
      {hint}
      <button onClick={() => useStore.getState().setTool({ kind: 'select' })}>Terminer</button>
    </div>
  );
}

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
      } else if (e.key === 'Escape') {
        if (s.tool.kind !== 'select') s.setTool({ kind: 'select' });
        else s.setSelection(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection) {
        const sel = s.selection;
        const calque = sel.kind === 'node' ? s.net.nodes.find((n) => n.id === sel.id)?.calque : s.net.pipes.find((p) => p.id === sel.id)?.calque;
        if (s.net.calques.find((l) => l.id === calque)?.verrouille) return s.toast('Calque verrouillé.', 'error');
        s.commit(sel.kind === 'node' ? deleteNode(s.net, sel.id) : deletePipe(s.net, sel.id));
        s.setSelection(null);
        s.toast('Élément supprimé (Ctrl+Z pour annuler).');
      } else if (e.key === 'F5' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        s.runCalc();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
