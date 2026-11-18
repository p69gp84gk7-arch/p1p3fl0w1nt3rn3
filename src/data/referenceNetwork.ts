import { normalizeNetwork } from '../services/storage';
import type { Network } from '../model/types';

/**
 * Réseau de la station, intégré à l'application (généré par
 * scripts/generer-reseau-reference.ts). Chargé à la demande pour garder
 * l'application légère.
 */
export async function referenceNetwork(): Promise<Network> {
  const mod = await import('./reseau-reference.json');
  return normalizeNetwork(structuredClone(mod.default) as unknown as Partial<Network>);
}
