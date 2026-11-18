import L from 'leaflet';
import type { NodeType, ResultStatus } from '../model/types';

export const STATUS_COLOR: Record<ResultStatus | 'none', string> = {
  ok: '#2e9d5b',
  alerte: '#e0a106',
  erreur: '#d64545',
  isole: '#9aa5b1',
  none: '#1c5c9e',
};

export const STATUS_LABEL: Record<ResultStatus, string> = {
  ok: 'Conforme',
  alerte: 'À surveiller',
  erreur: 'Problème',
  isole: 'Non alimenté',
};

export interface Bin {
  max: number;
  color: string;
  label: string;
}

export const PRESSURE_BINS: Bin[] = [
  { max: 10, color: '#d64545', label: '< 10 bar' },
  { max: 20, color: '#f08c2e', label: '10 – 20 bar' },
  { max: 30, color: '#e8c547', label: '20 – 30 bar' },
  { max: 40, color: '#69b36b', label: '30 – 40 bar' },
  { max: 60, color: '#2a8fbd', label: '40 – 60 bar' },
  { max: Infinity, color: '#6b4fb8', label: '> 60 bar' },
];

export const VELOCITY_BINS: Bin[] = [
  { max: 0.5, color: '#9cc3e6', label: '< 0,5 m/s' },
  { max: 1.5, color: '#3d8fd1', label: '0,5 – 1,5 m/s' },
  { max: 2.5, color: '#2e9d5b', label: '1,5 – 2,5 m/s' },
  { max: 3, color: '#e0a106', label: '2,5 – 3 m/s' },
  { max: Infinity, color: '#d64545', label: '> 3 m/s' },
];

export const DN_BINS: Bin[] = [
  { max: 80, color: '#9cc3e6', label: '≤ DN80' },
  { max: 100, color: '#5aa5dc', label: 'DN100' },
  { max: 150, color: '#2a7fc0', label: 'DN125 – 150' },
  { max: 200, color: '#1c5c9e', label: 'DN200' },
  { max: Infinity, color: '#0e3561', label: '≥ DN250' },
];

export function binColor(bins: Bin[], v: number): string {
  if (!Number.isFinite(v)) return STATUS_COLOR.isole;
  return (bins.find((b) => v <= b.max) ?? bins[bins.length - 1]).color;
}

const CAT_COLORS = ['#1c5c9e', '#d9822b', '#2e9d5b', '#7b4fb8', '#c0392b', '#0f8fa3', '#8a6d3b', '#d6489a', '#5d6d7e', '#9bbf2a', '#e0a106', '#2c3e50'];
const catCache = new Map<string, string>();
export function categoryColor(key: string): string {
  if (!key) return '#8796a5';
  if (!catCache.has(key)) catCache.set(key, CAT_COLORS[catCache.size % CAT_COLORS.length]);
  return catCache.get(key)!;
}

export function pipeWeight(dn: number): number {
  if (dn >= 250) return 7;
  if (dn >= 200) return 6;
  if (dn >= 150) return 5;
  if (dn >= 100) return 4;
  return 3;
}

/** Pictogramme SVG d'un type de nœud. */
export function nodeSvg(type: NodeType, fill: string, size = 18, inactive = false): string {
  const s = size;
  const stroke = '#ffffff';
  const op = inactive ? 0.55 : 1;
  switch (type) {
    case 'enneigeur':
      return `<svg width="${s}" height="${s}" viewBox="0 0 20 20" opacity="${op}"><circle cx="10" cy="10" r="8" fill="${fill}" stroke="${stroke}" stroke-width="2"/><g stroke="#fff" stroke-width="1.4" stroke-linecap="round"><path d="M10 5.5v9M6.1 7.75l7.8 4.5M6.1 12.25l7.8-4.5"/></g></svg>`;
    case 'regard':
      return `<svg width="${s}" height="${s}" viewBox="0 0 20 20" opacity="${op}"><rect x="2.5" y="2.5" width="15" height="15" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="2"/><circle cx="10" cy="10" r="3.2" fill="none" stroke="#fff" stroke-width="1.6"/></svg>`;
    case 'jonction':
      return `<svg width="${s * 0.6}" height="${s * 0.6}" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="${fill}" stroke="${stroke}" stroke-width="3"/></svg>`;
    case 'vanne':
      return `<svg width="${s}" height="${s}" viewBox="0 0 20 20"><path d="M2 4l16 12V4L2 16z" fill="${inactive ? '#d64545' : fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    case 'reducteur':
      return `<svg width="${s}" height="${s}" viewBox="0 0 20 20"><path d="M10 18L2 4h16z" fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 7v5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    case 'surpresseur':
      return `<svg width="${s + 4}" height="${s + 4}" viewBox="0 0 20 20"><path d="M10 2l8 14H2z" fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 13V8M7.8 10.2L10 8l2.2 2.2" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`;
    case 'salle_machines':
      return `<svg width="${s + 8}" height="${s + 8}" viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v10H3z" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/><path d="M8 21v-5h8v5" fill="none" stroke="#fff" stroke-width="1.6"/></svg>`;
  }
}

const iconCache = new Map<string, L.DivIcon>();
/** Petite étiquette « 23,4 bar · 1,8 m/s » affichée à côté d'un nœud. */
export function resultLabel(pression: number, vitesse: number | undefined): string | undefined {
  if (!Number.isFinite(pression)) return undefined;
  const v = vitesse !== undefined && Number.isFinite(vitesse) && vitesse > 0 ? ` <span class="v">${fmt(vitesse, 1)} m/s</span>` : '';
  return `${fmt(pression, 1)} bar${v}`;
}
export function nodeIcon(type: NodeType, fill: string, selected: boolean, inactive: boolean, label?: string, result?: string): L.DivIcon {
  const key = `${type}|${fill}|${selected}|${inactive}|${label ?? ''}|${result ?? ''}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const size = type === 'jonction' ? 18 : 18;
    const box = type === 'salle_machines' ? 26 : type === 'surpresseur' ? 22 : 18;
    icon = L.divIcon({
      className: `node-icon${selected ? ' is-selected' : ''}`,
      html: `${nodeSvg(type, fill, size, inactive)}${label ? `<span class="node-label">${escapeHtml(label)}</span>` : ''}${result ? `<span class="node-result">${result}</span>` : ''}`,
      iconSize: [box, box],
      iconAnchor: [box / 2, box / 2],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const fmt = (v: number | undefined, d = 1) =>
  v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

export const BASE_LAYERS = [
  {
    id: 'ign-plan',
    name: 'IGN Plan',
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
    attribution: '© IGN – Géoplateforme',
    maxNativeZoom: 19,
  },
  {
    id: 'ign-ortho',
    name: 'IGN Photo aérienne',
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    attribution: '© IGN – Géoplateforme',
    maxNativeZoom: 19,
  },
  {
    id: 'opentopo',
    name: 'OpenTopoMap (relief)',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)',
    maxNativeZoom: 17,
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    maxNativeZoom: 19,
  },
  {
    id: 'esri',
    name: 'Satellite (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Maxar, Earthstar Geographics',
    maxNativeZoom: 19,
  },
];

export const PISTES_OVERLAY = {
  url: 'https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png',
  attribution: '© OpenSnowMap.org (CC-BY-SA)',
};
