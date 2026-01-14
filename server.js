// ========== TFT ASSISTANT SERVER ==========
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { scrapeAll, DATA_PATH } = require('./scraper');

const app = express();
const PORT = 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// API: Récupérer les données Tactics.tools
app.get('/api/tactics-data', (req, res) => {
    try {
        if (fs.existsSync(DATA_PATH)) {
            const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
            res.json({ success: true, data });
        } else {
            res.json({ success: false, message: 'Pas de données. Lancez un scraping.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: Lancer le scraping
let isScrapingInProgress = false;

app.post('/api/scrape', async (req, res) => {
    if (isScrapingInProgress) {
        return res.json({ success: false, message: 'Scraping déjà en cours...' });
    }

    isScrapingInProgress = true;
    res.json({ success: true, message: 'Scraping démarré...' });

    try {
        await scrapeAll();
        console.log('✅ Scraping terminé avec succès');
    } catch (error) {
        console.error('❌ Erreur scraping:', error.message);
    } finally {
        isScrapingInProgress = false;
    }
});

// API: Status du scraping
app.get('/api/scrape-status', (req, res) => {
    res.json({
        inProgress: isScrapingInProgress,
        hasData: fs.existsSync(DATA_PATH),
        lastUpdate: fs.existsSync(DATA_PATH)
            ? JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')).timestamp
            : null
    });
});

// Servir index.html pour toutes les autres routes (Express 5 syntax)
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║       TFT Challenger Assistant - Server v2.0             ║
╠══════════════════════════════════════════════════════════╣
║  🌐 http://localhost:${PORT}                               ║
║                                                          ║
║  API Endpoints:                                          ║
║  GET  /api/tactics-data    → Données Tactics.tools       ║
║  POST /api/scrape          → Lancer le scraping          ║
║  GET  /api/scrape-status   → Status du scraping          ║
╚══════════════════════════════════════════════════════════╝
    `);
});
