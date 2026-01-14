# TFT Challenger Assistant

## Lancer le projet

### Prérequis
- Node.js 18+ (pour Puppeteer)

### Installation
```bash
npm install
```

### Démarrer le serveur
```bash
npm start
```

Puis ouvrir http://localhost:8080

### Mettre à jour les données (scraping)
Le bouton **Refresh Data** lance le scraping depuis Tactics.tools.

Vous pouvez aussi lancer manuellement :
```bash
npm run scrape
```

Les données scrappées sont enregistrées dans `data/tactics_data.json`.
