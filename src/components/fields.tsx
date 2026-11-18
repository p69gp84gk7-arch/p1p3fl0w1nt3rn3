import { useEffect, useState, type ReactNode } from 'react';
import { num } from '../services/sheets';

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label" title={hint}>
        {label}
      </span>
      <span className="field-input">{children}</span>
    </label>
  );
}

/** Champ numérique : accepte « 12,5 », valide à la sortie du champ ou sur Entrée. */
export function NumField({
  value,
  onChange,
  unit,
  step,
  disabled,
  digits = 2,
}: {
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  disabled?: boolean;
  digits?: number;
}) {
  const show = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10 ** digits) / 10 ** digits).replace('.', ',') : '');
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const v = num(text, NaN);
    if (Number.isFinite(v) && v !== value) onChange(v);
    else setText(show(value));
  };
  return (
    <span className="num-field">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setText(show(value));
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

export function TextField({ value, onChange, disabled, placeholder }: { value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      type="text"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onChange(text)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" className={`toggle ${checked ? 'on' : ''}`} onClick={() => !disabled && onChange(!checked)} disabled={disabled} aria-pressed={checked}>
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel-section">
      <div className="panel-section-head">
        <h3>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * Liste déroulante des valeurs possibles, avec « Autre… » pour en saisir une
 * nouvelle quand `allowNew` est fourni (libellé de la question).
 */
export function ChoiceField({
  value,
  options,
  onChange,
  disabled,
  allowNew,
  emptyLabel,
  labels,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  allowNew?: string;
  /** Libellé de la valeur vide (absente si non fourni). */
  emptyLabel?: string;
  /** Libellés affichés pour certaines valeurs. */
  labels?: Record<string, string>;
}) {
  const list = [...new Set([...options.filter(Boolean), ...(value ? [value] : [])])];
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value === '__new__') {
          const v = prompt(allowNew ?? 'Nouvelle valeur :');
          if (v && v.trim()) onChange(v.trim());
          return;
        }
        onChange(e.target.value);
      }}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {list.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
      {allowNew && <option value="__new__">➕ Autre…</option>}
    </select>
  );
}
