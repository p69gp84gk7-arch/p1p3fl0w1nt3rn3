# PipeFlow Neige

Application web de **calcul de débit et de pression des réseaux de neige de culture** : import des tracés Google Earth (KMZ), édition du réseau sur carte, calcul hydraulique, scénarios de production, calques de projets, base de données Google Sheets.

## Fonctionnalités

- **Import KMZ / KML** (plusieurs fichiers à la fois) : les points deviennent des enneigeurs, regards, vannes, jonctions, réducteurs, surpresseurs ou salles des machines (choix par dossier + icône, avec possibilité de corriger point par point) ; les lignes deviennent des canalisations, **découpées et raccordées automatiquement** aux points proches (tolérance réglable).
- **Import CSV des débits par canon** : débits par étage de couronnes (C1, C1+C2, C1+C3, C1+C2+C3), modèle, piste, air, priorité — rattachés par numéro de canon.
- **Altitudes automatiques** depuis la position GPS de chaque élément (IGN RGE ALTI® en France, Copernicus DEM ailleurs), à l'import, à la création et au déplacement.
- **Édition sur carte** : ajout d'éléments (sur une canalisation → insertion automatique), tracé de canalisations, coupe, fusion, déplacement, **modification des liaisons** (changer l'amont/l'aval, inverser), annuler/rétablir.
- **Tout est éditable** : diamètres (catalogue fonte / acier / PEHD modifiable), rugosité, PN, pertes singulières, débits, couronnes, pression mini, consignes des salles des machines et surpresseurs, vannes ouvertes/fermées.
- **Calcul hydraulique** : Darcy-Weisbach (Swamee-Jain), méthode du gradient global (EPANET), réseaux ramifiés et maillés, buses Q = k·√P, surpresseurs et réducteurs de pression avec by-pass automatique.
- **Contrôles** : pression insuffisante aux canons, vitesse excessive, dépassement de PN (y compris aux points bas du tracé), dépression aux points hauts, capacité des pompes. **Pression statique** en un clic.
- **Scénarios** (canons en marche + couronnes), **profil en long** avec ligne piézométrique.
- **Calques** (« Existant », « Projet 2027 »…) : affichage, inclusion dans le calcul et verrouillage par calque, pour simuler les extensions futures.
- **Google Sheets** comme base de données (lecture / écriture / résultats) ; export JSON et CSV.

## Base de données Google Sheets

Le classeur contient un onglet par table : `Noeuds`, `Canalisations`, `Calques`, `Catalogue_Tuyaux`, `Modeles_Enneigeurs`, `Scenarios`, `Parametres`, `Resultats_Noeuds`, `Resultats_Canalisations`. Les en-têtes de colonnes correspondent aux champs de `src/model/types.ts`.

Mise en place de la liaison (une seule fois) :

1. Dans le classeur : **Extensions → Apps Script**, coller le contenu de [`apps-script/Code.gs`](apps-script/Code.gs), enregistrer.
2. (Recommandé) **Paramètres du projet → Propriétés du script** : ajouter `API_KEY` avec un mot de passe.
3. **Déployer → Nouveau déploiement → Application Web**, « Exécuter en tant que : moi », « Accès : tout le monde ».
4. Dans l'application : **⚙ Réglages → Google Sheets**, coller l'URL `…/exec` (et la clé), puis « Tester la connexion ».

> Après une modification de `Code.gs`, faire **Déployer → Gérer les déploiements → Modifier → Nouvelle version** pour conserver la même URL.

## Développement

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # tests du solveur, de l'import KMZ/CSV et de l'édition
npm run build    # version de production dans dist/
```

Organisation du code :

| Dossier | Contenu |
| --- | --- |
| `src/hydraulics/` | Solveur hydraulique (gradient global, Darcy-Weisbach, régulateurs) |
| `src/import/` | Lecture KMZ/KML, construction de la topologie, import CSV des débits |
| `src/model/` | Types, valeurs par défaut, opérations d'édition, scénarios |
| `src/services/` | Google Sheets (Apps Script), altitudes (IGN / Open-Meteo), stockage local |
| `src/components/` | Interface React + Leaflet |
| `apps-script/` | Script à installer dans le classeur Google Sheets |

## Déploiement

Chaque fusion sur `main` publie l'application sur **GitHub Pages** (workflow `.github/workflows/deploy.yml`). À activer une fois : **Settings → Pages → Source : GitHub Actions**. Les pull requests lancent les tests et la compilation (`ci.yml`).

## Hypothèses de calcul

- Eau à la température choisie (2 °C par défaut) : masse volumique et viscosité calculées.
- Pertes linéaires : Darcy-Weisbach, λ de Swamee-Jain (64/Re en laminaire, interpolation en transition).
- Pertes singulières : K·V²/2g par canalisation.
- Salle des machines : charge imposée = altitude + pression de refoulement.
- Surpresseur / réducteur : pression de sortie imposée ; si la consigne est sans effet (pression d'arrivée suffisante / insuffisante), l'appareil passe en by-pass.
- Pression le long des canalisations : ligne piézométrique linéaire entre les nœuds, terrain aux sommets du tracé.
