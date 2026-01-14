// ========== TFT ASSISTANT - ITEMS BASED ==========

// Data
let ITEMS = { ad: [], ap: [], tank: [], util: [] };
let COMPS = [];
let ITEMS_MAP = {}; // id -> item info

// State
let selectedItems = new Set();
let lastUpdateTimestamp = null;

// ========== INIT ==========
async function init() {
    console.log('🚀 Loading data...');

    try {
        const data = await fetchData();
        ITEMS = data.items;
        COMPS = data.comps;
        lastUpdateTimestamp = data.timestamp || null;

        // Build items map
        ['ad', 'ap', 'tank', 'util'].forEach(type => {
            ITEMS[type].forEach(item => {
                ITEMS_MAP[item.id] = { ...item, type };
            });
        });

        console.log('✅ Loaded:', Object.keys(ITEMS_MAP).length, 'items,', COMPS.length, 'comps');

        updateHeaderStatus();
        updateScrapeStatus(`Données chargées depuis ${data.source || 'local'}.`);
        renderItems();
        renderAllComps();
        bindEvents();
        updateRecommendations();

    } catch (error) {
        console.error('❌ Error loading data:', error);
        updateScrapeStatus('Erreur de chargement des données.');
    }
}

async function fetchData() {
    const apiRes = await fetch('/api/tactics-data');
    if (apiRes.ok) {
        const payload = await apiRes.json();
        if (payload.success && payload.data) {
            return payload.data;
        }
    }

    const fallbackRes = await fetch('data/tactics_data.json');
    return fallbackRes.json();
}

function updateHeaderStatus() {
    const lastUpdateEl = document.getElementById('lastUpdate');
    const compsStatusEl = document.getElementById('compsStatus');

    if (lastUpdateTimestamp) {
        const date = new Date(lastUpdateTimestamp);
        lastUpdateEl.textContent = date.toLocaleString('fr-FR');
    } else {
        lastUpdateEl.textContent = '--';
    }

    compsStatusEl.textContent = `${COMPS.length} compos chargées`;
}

function updateScrapeStatus(message) {
    const statusEl = document.getElementById('scrapeStatus');
    statusEl.textContent = message;
}

// ========== RENDER ITEMS ==========
function renderItems() {
    const containers = {
        ad: document.getElementById('itemsAD'),
        ap: document.getElementById('itemsAP'),
        tank: document.getElementById('itemsTank'),
        util: document.getElementById('itemsUtil')
    };

    ['ad', 'ap', 'tank', 'util'].forEach(type => {
        const container = containers[type];
        container.innerHTML = ITEMS[type].map(item => `
            <div class="item-chip ${type}" data-id="${item.id}">
                ${item.name}
            </div>
        `).join('');
    });
}

// ========== RENDER ALL COMPS ==========
function renderAllComps() {
    const list = document.getElementById('compsList');
    document.getElementById('compsCount').textContent = `${COMPS.length} compos`;

    list.innerHTML = COMPS.map(comp => {
        const bisHtml = (comp.bisItems || []).map(id => {
            const item = ITEMS_MAP[id];
            const label = item ? item.name : id;
            return label ? `<span class="comp-bis-item">${label}</span>` : '';
        }).join('');

        return `
            <div class="comp-card">
                <div class="comp-header">
                    <span class="comp-name">${comp.name}</span>
                    <div class="comp-stats">
                        <span class="comp-tier ${comp.tier}">${comp.tier}</span>
                        <span class="comp-wr">${comp.winrate}%</span>
                    </div>
                </div>
                <div class="comp-bis">${bisHtml}</div>
            </div>
        `;
    }).join('');
}

// ========== BIND EVENTS ==========
function bindEvents() {
    // Item clicks
    document.querySelectorAll('.item-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            const id = chip.dataset.id;

            if (e.shiftKey) {
                // Shift+click = remove
                selectedItems.delete(id);
            } else {
                // Click = toggle
                if (selectedItems.has(id)) {
                    selectedItems.delete(id);
                } else {
                    selectedItems.add(id);
                }
            }

            updateUI();
        });
    });

    // Clear button
    document.getElementById('clearItems').addEventListener('click', () => {
        selectedItems.clear();
        updateUI();
    });

    // Refresh data button
    document.getElementById('refreshData').addEventListener('click', async () => {
        const button = document.getElementById('refreshData');
        button.classList.add('loading');
        updateScrapeStatus('Scraping en cours...');

        try {
            await fetch('/api/scrape', { method: 'POST' });
            await pollScrapeStatus();
            const data = await fetchData();
            ITEMS = data.items;
            COMPS = data.comps;
            lastUpdateTimestamp = data.timestamp || null;

            ITEMS_MAP = {};
            ['ad', 'ap', 'tank', 'util'].forEach(type => {
                ITEMS[type].forEach(item => {
                    ITEMS_MAP[item.id] = { ...item, type };
                });
            });

            renderItems();
            renderAllComps();
            updateUI();
            updateHeaderStatus();
            updateScrapeStatus('Données mises à jour.');
        } catch (error) {
            console.error('Erreur scraping:', error);
            updateScrapeStatus('Erreur pendant le scraping.');
        } finally {
            button.classList.remove('loading');
        }
    });
}

async function pollScrapeStatus() {
    const start = Date.now();
    const timeoutMs = 120000;
    while (Date.now() - start < timeoutMs) {
        const res = await fetch('/api/scrape-status');
        if (!res.ok) break;
        const status = await res.json();
        if (!status.inProgress) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('Timeout scraping');
}

// ========== UPDATE UI ==========
function updateUI() {
    // Update item chips
    document.querySelectorAll('.item-chip').forEach(chip => {
        chip.classList.toggle('selected', selectedItems.has(chip.dataset.id));
    });

    // Update selected panel
    const panel = document.getElementById('selectedPanel');
    const list = document.getElementById('selectedList');

    if (selectedItems.size > 0) {
        panel.classList.add('visible');
        list.innerHTML = Array.from(selectedItems).map(id => {
            const item = ITEMS_MAP[id];
            return item ? `<span class="selected-item ${item.type}">${item.name}</span>` : '';
        }).join('');
    } else {
        panel.classList.remove('visible');
    }

    // Update recommendations
    updateRecommendations();
}

// ========== UPDATE RECOMMENDATIONS ==========
function updateRecommendations() {
    const list = document.getElementById('recsList');

    if (selectedItems.size === 0) {
        list.innerHTML = '<div class="recs-empty">Sélectionne des items pour voir les recommandations</div>';
        return;
    }

    const selectedArray = Array.from(selectedItems);
    console.log('📊 Calculating scores for:', selectedArray);

    // Score each comp
    const scored = COMPS.map(comp => {
        const bisItems = comp.bisItems || [];
        const bisTotal = bisItems.length;

        // Count matches
        const matches = bisItems.filter(id => selectedItems.has(id));
        const matchCount = matches.length;
        const matchPercent = bisTotal > 0 ? Math.round((matchCount / bisTotal) * 100) : 0;

        // Score = match percent (0-100) + winrate bonus (0-20)
        // Winrate bonus: 45% = 0, 55% = 20
        const wrBonus = Math.max(0, Math.min(20, (comp.winrate - 45) * 2));
        const score = matchPercent + wrBonus;

        return {
            comp,
            matchCount,
            bisTotal,
            matchPercent,
            matches,
            score
        };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Top 5
    const top5 = scored.slice(0, 5);

    console.log('🏆 Top 5:', top5.map(r => `${r.comp.name}: ${r.score} (${r.matchCount}/${r.bisTotal})`));

    // Render
    list.innerHTML = top5.map((rec, idx) => {
        const { comp, matchCount, bisTotal, matchPercent, matches, score } = rec;

        // Winrate class
        let wrClass = 'med';
        if (comp.winrate >= 52) wrClass = 'high';
        else if (comp.winrate < 49) wrClass = 'low';

        // BIS items HTML
        const bisHtml = comp.bisItems.map(id => {
            const item = ITEMS_MAP[id];
            if (!item && !id) return '';
            const isMatch = matches.includes(id);
            const label = item ? item.name : id;
            return `<span class="rec-bis-item ${isMatch ? 'match' : ''}">${label}</span>`;
        }).join('');

        return `
            <div class="rec-card ${idx === 0 ? 'top' : ''}">
                <div class="rec-rank">${idx + 1}</div>
                <div class="rec-info">
                    <div class="rec-header">
                        <span class="rec-name">${comp.name}</span>
                        <span class="rec-tier ${comp.tier}">${comp.tier}</span>
                        <span class="rec-winrate ${wrClass}">${comp.winrate}% WR</span>
                    </div>
                    <div class="rec-match">
                        Match: <span class="rec-match-score">${matchCount}/${bisTotal} BIS</span>
                        → <span class="rec-match-score">${matchPercent}%</span>
                    </div>
                    <div class="rec-bis">${bisHtml}</div>
                </div>
                <div class="rec-score">
                    <div class="rec-score-value">${Math.round(score)}</div>
                    <div class="rec-score-label">score</div>
                </div>
            </div>
        `;
    }).join('');
}

// ========== START ==========
document.addEventListener('DOMContentLoaded', init);
