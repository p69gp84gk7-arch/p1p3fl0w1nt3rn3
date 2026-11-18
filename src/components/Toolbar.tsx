import { useStore, type Tool } from '../store';
import { NODE_LABEL } from '../model/defaults';
import type { NodeType } from '../model/types';
import { nodeSvg } from './display';

const ADD_TYPES: NodeType[] = ['enneigeur', 'regard', 'vanne', 'jonction', 'reducteur', 'surpresseur', 'salle_machines'];

export default function Toolbar() {
  const tool = useStore((s) => s.tool);
  const st = useStore.getState;
  const is = (t: Tool) => tool.kind === t.kind && (t.kind !== 'add' || (tool.kind === 'add' && tool.type === t.type));
  const btn = (t: Tool, icon: React.ReactNode, label: string, key?: string) => (
    <button
      key={key ?? label}
      className={`tool ${is(t) ? 'active' : ''}`}
      onClick={() => st().setTool(is(t) ? { kind: 'select' } : t)}
      title={label}
      aria-pressed={is(t)}
    >
      <span className="tool-icon">{icon}</span>
      <span className="tool-label">{label}</span>
    </button>
  );
  return (
    <nav className="toolbar" aria-label="Outils">
      <div className="tool-section">Édition</div>
      {btn({ kind: 'select' }, <Svg d="M5 3l14 8-6 1.5L10 19z" />, 'Sélection')}
      {btn({ kind: 'move' }, <Svg d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />, 'Déplacer')}
      {btn({ kind: 'draw' }, <Svg d="M4 20c4-1 5-6 8-8s6-1 8-8" dash />, 'Tracer une canalisation')}
      {btn({ kind: 'split' }, <Svg d="M3 12h7M14 12h7M12 5v14" />, 'Couper une canalisation')}
      <div className="tool-section">Ajouter</div>
      {ADD_TYPES.map((t) =>
        btn({ kind: 'add', type: t }, <span dangerouslySetInnerHTML={{ __html: nodeSvg(t, '#2a7fc0', 20) }} />, NODE_LABEL[t], t),
      )}
    </nav>
  );
}

function Svg({ d, dash }: { d: string; dash?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} strokeDasharray={dash ? '3 3' : undefined} />
    </svg>
  );
}
