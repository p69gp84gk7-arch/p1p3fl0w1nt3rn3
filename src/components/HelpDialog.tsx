import Modal from './Modal';

export default function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Aide" onClose={onClose} wide>
      <div className="help">
        <h4>Construire le réseau</h4>
        <ul>
          <li>
            <b>Importer</b> (Fichier → Importer) : sélectionnez ensemble vos KMZ de canalisations et de canons, et le CSV des débits. Chaque catégorie de points (dossier + icône) reçoit un type : enneigeur, regard, vanne, jonction, réducteur, surpresseur ou salle des machines.
          </li>
          <li>
            Les points situés à moins de la <b>tolérance d’accrochage</b> d’une ligne y sont raccordés et la ligne est découpée en tronçons.
          </li>
          <li>
            <b>Ajouter</b> : choisissez un type dans la barre de gauche puis cliquez sur la carte. Sur une canalisation, l’élément y est inséré automatiquement.
          </li>
          <li>
            <b>Tracer une canalisation</b> : cliquez sur le nœud de départ, sur des points intermédiaires, puis sur le nœud d’arrivée.
          </li>
          <li>
            <b>Modifier une liaison</b> : sélectionnez la canalisation, puis « Changer » à côté de l’amont ou de l’aval et cliquez sur le nouveau nœud. ⇄ inverse le sens.
          </li>
          <li>
            <b>Déplacer</b> : faites glisser un élément ; son altitude est relue depuis le GPS.
          </li>
          <li>
            <b>Suppr</b> supprime la sélection, <b>Ctrl+Z / Ctrl+Y</b> annule / rétablit.
          </li>
        </ul>
        <h4>Calculer</h4>
        <ul>
          <li>
            <b>▶ Calculer</b> (Ctrl+Entrée) : pressions, débits, vitesses et pertes de charge pour les enneigeurs en production.
          </li>
          <li>
            Le débit d’un canon dépend de l’étage de <b>couronnes</b> (C1, C1+C2, C1+C3, C1+C2+C3) ou d’un débit saisi ; le mode « buse » calcule Q = k·√P.
          </li>
          <li>
            <b>Pression statique</b> : tous les canons à l’arrêt, pour vérifier la tenue des canalisations (PN) aux points bas.
          </li>
          <li>
            <b>Scénarios</b> : enregistrez un ensemble de canons en marche (＋ à côté du sélecteur), rappelez-le à tout moment.
          </li>
          <li>
            <b>Profil en long</b> : terrain et ligne piézométrique de la salle des machines jusqu’au canon choisi.
          </li>
        </ul>
        <h4>Calques</h4>
        <p>
          Chaque élément appartient à un calque (« Existant », « Projet 2027 »…). Œil : affichage ; Σ : pris en compte dans le calcul ; cadenas : protégé. Dessinez vos extensions sur un calque projet, activez Σ pour mesurer leur impact sur le réseau existant.
        </p>
        <h4>Hypothèses</h4>
        <p className="small">
          Darcy-Weisbach (λ Swamee-Jain, laminaire 64/Re), viscosité de l’eau selon la température, pertes singulières K·V²/2g, méthode du gradient global (EPANET). Salle des machines : pression de refoulement imposée. Surpresseur / réducteur : pression de sortie imposée, mis en by-pass automatiquement si la consigne est sans effet. Altitudes : IGN RGE ALTI® (France) ou Copernicus DEM.
        </p>
      </div>
    </Modal>
  );
}
