import { useStore, type MobileSheet } from '../store';

const ITEMS: { id: Exclude<MobileSheet, null>; icon: string; label: string }[] = [
  { id: 'affichage', icon: '🎨', label: 'Affichage' },
  { id: 'panneau', icon: '⛽', label: 'Pompage' },
  { id: 'tableaux', icon: '📋', label: 'Tableaux' },
  { id: 'outils', icon: '✏️', label: 'Outils' },
];

/** Barre de navigation du bas, sur téléphone. */
export default function MobileNav() {
  const sheet = useStore((s) => s.mobileSheet);
  const selection = useStore((s) => s.selection);
  const st = useStore.getState;
  const open = (id: Exclude<MobileSheet, null>) => {
    if (sheet === id) {
      st().set('mobileSheet', null);
      if (id === 'panneau') st().setSelection(null);
      return;
    }
    if (id !== 'panneau') st().setSelection(null);
    if (id === 'tableaux' && !st().bottomTab) st().set('bottomTab', 'enneigeurs');
    st().set('mobileSheet', id);
  };
  return (
    <nav className="mobile-nav" aria-label="Navigation">
      <button className={sheet === null ? 'active' : ''} onClick={() => { st().set('mobileSheet', null); st().setSelection(null); }}>
        <span>🗺️</span>
        Carte
      </button>
      {ITEMS.map((it) => (
        <button key={it.id} className={sheet === it.id ? 'active' : ''} onClick={() => open(it.id)}>
          <span>{it.id === 'panneau' && selection ? '📍' : it.icon}</span>
          {it.id === 'panneau' && selection ? 'Fiche' : it.label}
        </button>
      ))}
    </nav>
  );
}

/** En-tête d'un panneau coulissant (téléphone). */
export function SheetHeader({ title }: { title: string }) {
  const st = useStore.getState;
  return (
    <div className="sheet-head">
      <span className="sheet-grip" />
      <b>{title}</b>
      <button
        className="btn icon small"
        title="Fermer"
        onClick={() => {
          st().set('mobileSheet', null);
          st().setSelection(null);
        }}
      >
        ✕
      </button>
    </div>
  );
}
