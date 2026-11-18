// Contenu des bulles affichées sur la carte, et leur explication pour la légende.

import { effectiveFlow, isConsumer } from '../model/defaults';
import type { NetNode, NodeResult, Pipe, PipeResult } from '../model/types';
import type { NodeLabelField, PipeLabelField } from '../services/storage';
import { escapeHtml, fmt } from './display';

interface NodeFieldDef {
  id: NodeLabelField;
  /** Libellé de la case à cocher. */
  label: string;
  /** Explication dans la légende. */
  help: string;
  /** Exemple affiché dans la légende. */
  sample: string;
  needsResults?: boolean;
}

export const NODE_FIELDS: NodeFieldDef[] = [
  { id: 'nom', label: 'Nom / numéro', help: 'Nom ou numéro du point', sample: '<b>318</b>' },
  { id: 'altitude', label: 'Altitude', help: 'Altitude du terrain lue depuis le GPS (IGN), en mètres', sample: '⛰ 1 853 m' },
  { id: 'pression', label: 'Pression calculée', help: 'Pression disponible au point, en bar — rouge si inférieure à la pression mini du canon', sample: 'P 42,6 bar', needsResults: true },
  { id: 'marge', label: 'Marge de pression', help: 'Pression calculée moins pression mini requise (bar) — négatif = canon sous-alimenté', sample: 'Δ +24,6', needsResults: true },
  { id: 'pression_min', label: 'Pression mini requise', help: 'Pression minimale de fonctionnement du canon (bar)', sample: 'min 18 bar' },
  { id: 'vitesse', label: 'Vitesse d’arrivée', help: 'Vitesse de l’eau dans la canalisation qui alimente le point (m/s)', sample: 'V 0,7 m/s', needsResults: true },
  { id: 'debit', label: 'Débit', help: 'Débit du canon en production (m³/h), ou débit arrivant au point', sample: 'Q 14,1 m³/h' },
  { id: 'charge', label: 'Niveau d’eau (charge)', help: 'Altitude atteinte par la ligne d’eau (charge hydraulique, m) : terrain + pression', sample: 'H 2 286 m', needsResults: true },
  { id: 'modele', label: 'Modèle', help: 'Modèle de canon', sample: 'rubis' },
  { id: 'couronnes', label: 'Couronnes', help: 'Étage de couronnes utilisé pour le débit', sample: 'C1+C2+C3' },
  { id: 'secteur', label: 'Piste', help: 'Piste / secteur', sample: 'lac' },
];

interface PipeFieldDef {
  id: PipeLabelField;
  label: string;
  help: string;
  needsResults?: boolean;
}

export const PIPE_FIELDS: PipeFieldDef[] = [
  { id: 'vitesse', label: 'Vitesse', help: 'Vitesse de l’eau (m/s)', needsResults: true },
  { id: 'debit', label: 'Débit', help: 'Débit transporté (m³/h)', needsResults: true },
  { id: 'dn', label: 'Diamètre (DN)', help: 'Diamètre nominal' },
  { id: 'perte', label: 'Pertes de charge', help: 'Perte de charge (m par km)', needsResults: true },
  { id: 'pression', label: 'Pression mini–maxi', help: 'Pressions extrêmes le long du tracé (bar)', needsResults: true },
  { id: 'nom', label: 'Nom', help: 'Nom de la canalisation' },
];

const n0 = (v: number) => fmt(v, 0);

/** HTML de la bulle d'un point (vide si rien à afficher). */
export function nodeBubble(n: NetNode, r: NodeResult | undefined, fields: NodeLabelField[]): string {
  const parts: string[] = [];
  const hasP = r && Number.isFinite(r.pression_bar);
  const consumer = isConsumer(n.type);
  for (const f of fields) {
    switch (f) {
      case 'nom':
        if (n.nom) parts.push(`<b>${escapeHtml(n.nom)}</b>`);
        break;
      case 'altitude':
        parts.push(`⛰ ${n0(n.altitude_m)} m`);
        break;
      case 'pression':
        if (hasP) {
          const low = consumer && n.actif && r!.pression_bar < n.pression_min_bar;
          const neg = r!.pression_bar < 0;
          parts.push(`<span class="${low || neg ? 'ko' : ''}">P ${fmt(r!.pression_bar, 1)} bar</span>`);
        } else if (r && r.statut === 'isole') parts.push('<span class="dry">sec</span>');
        break;
      case 'marge':
        if (hasP && consumer) {
          const m = r!.pression_bar - n.pression_min_bar;
          parts.push(`<span class="${m < 0 ? 'ko' : 'ok'}">Δ ${m >= 0 ? '+' : ''}${fmt(m, 1)}</span>`);
        }
        break;
      case 'pression_min':
        if (consumer) parts.push(`min ${fmt(n.pression_min_bar, 0)} bar`);
        break;
      case 'vitesse':
        if (r && Number.isFinite(r.vitesse_arrivee_m_s) && r.vitesse_arrivee_m_s > 0) parts.push(`V ${fmt(r.vitesse_arrivee_m_s, 2)} m/s`);
        break;
      case 'debit': {
        const q = consumer ? (n.actif ? (r && r.debit_m3h > 0 ? r.debit_m3h : effectiveFlow(n)) : 0) : r?.debit_arrivee_m3h ?? 0;
        if (q > 0) parts.push(`Q ${fmt(q, 1)} m³/h`);
        else if (consumer) parts.push('<span class="dim">arrêt</span>');
        break;
      }
      case 'charge':
        if (r && Number.isFinite(r.charge_m)) parts.push(`H ${n0(r.charge_m)} m`);
        break;
      case 'modele':
        if (n.modele) parts.push(escapeHtml(n.modele));
        break;
      case 'couronnes':
        if (consumer && n.couronnes) parts.push(n.couronnes.toUpperCase());
        break;
      case 'secteur':
        if (n.secteur) parts.push(escapeHtml(n.secteur));
        break;
    }
  }
  return parts.map((p) => `<span>${p}</span>`).join('');
}

/** Texte de l'étiquette d'une canalisation. */
export function pipeLabel(p: Pipe, r: PipeResult | undefined, fields: PipeLabelField[]): string {
  const parts: string[] = [];
  for (const f of fields) {
    switch (f) {
      case 'vitesse':
        if (r && r.vitesse_m_s > 0.005) parts.push(`${fmt(r.vitesse_m_s, 1)} m/s`);
        break;
      case 'debit':
        if (r && Math.abs(r.debit_m3h) > 0.05) parts.push(`${fmt(Math.abs(r.debit_m3h), 0)} m³/h`);
        break;
      case 'dn':
        parts.push(`DN${p.dn}`);
        break;
      case 'perte':
        if (r && r.perte_m_km > 0.05) parts.push(`${fmt(r.perte_m_km, 1)} m/km`);
        break;
      case 'pression':
        if (r && Number.isFinite(r.pression_min_bar)) parts.push(`${fmt(r.pression_min_bar, 0)}–${fmt(r.pression_max_bar, 0)} bar`);
        break;
      case 'nom':
        if (p.nom) parts.push(p.nom);
        break;
    }
  }
  return parts.join(' · ');
}
