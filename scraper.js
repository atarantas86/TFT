const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const DATA_PATH = path.join(__dirname, 'data', 'tactics_data.json');
const ITEMS_PATH = path.join(__dirname, 'data', 'items.json');
const SCRAPE_URL = 'https://tactics.tools/team-comps';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const slugify = (value) =>
  value
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');

const pickNumber = (obj, keys) => {
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), obj);
    if (typeof value === 'number' && !Number.isNaN(value)) {
      return value;
    }
  }
  return null;
};

const pickString = (obj, keys) => {
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), obj);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const normalizeList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (typeof entry === 'number') return entry.toString();
        if (entry && typeof entry === 'object') {
          return (
            entry.id ||
            entry.itemId ||
            entry.unitId ||
            entry.championId ||
            entry.apiName ||
            entry.name ||
            entry.displayName ||
            ''
          );
        }
        return '';
      })
      .filter(Boolean);
  }
  return [];
};

const normalizeTier = (tier) => {
  if (!tier) return 'B';
  const value = tier.toString().trim().toUpperCase();
  if (['S', 'A', 'B', 'C', 'D'].includes(value)) return value;
  if (value.startsWith('S')) return 'S';
  if (value.startsWith('A')) return 'A';
  return 'B';
};

const normalizeComp = (comp, index) => {
  const name =
    pickString(comp, ['name', 'compName', 'compositionName', 'title', 'metaName', 'comp.name', 'composition.name']) ||
    `Compo ${index + 1}`;
  const winrate = pickNumber(comp, ['winrate', 'winRate', 'win_rate', 'stats.winrate', 'stats.winRate', 'avgWinrate']);
  const avgPlace = pickNumber(comp, [
    'avgPlace',
    'avgPlacement',
    'avg_position',
    'stats.avgPlacement',
    'stats.avgPlace',
    'averagePlacement'
  ]);
  const tier =
    pickString(comp, ['tier', 'rank', 'tierRank', 'stats.tier', 'meta.tier', 'rating']) ||
    (winrate && winrate >= 54 ? 'S' : winrate && winrate >= 51 ? 'A' : 'B');

  const units = normalizeList(
    comp.units ||
      comp.champions ||
      comp.board ||
      comp.finalUnits ||
      comp.composition?.units ||
      comp.coreUnits ||
      comp.championsIds
  );

  const bisItems = normalizeList(
    comp.bisItems ||
      comp.items ||
      comp.coreItems ||
      comp.bestItems ||
      comp.itemIds ||
      comp.itemIdsCore ||
      comp.items?.core ||
      comp.items?.bis
  );

  const normalizedWinrate = winrate !== null && winrate <= 1 ? winrate * 100 : winrate;
  const normalizedAvgPlace = avgPlace !== null && avgPlace <= 1 ? avgPlace * 10 : avgPlace;

  return {
    id: slugify(name),
    name,
    tier: normalizeTier(tier),
    winrate: normalizedWinrate !== null ? Number(normalizedWinrate.toFixed(2)) : null,
    avgPlace: normalizedAvgPlace !== null ? Number(normalizedAvgPlace.toFixed(2)) : null,
    units,
    bisItems
  };
};

const isCompLike = (entry) => {
  if (!entry || typeof entry !== 'object') return false;
  const name = pickString(entry, ['name', 'compName', 'compositionName', 'title']);
  const winrate = pickNumber(entry, ['winrate', 'winRate', 'win_rate', 'stats.winrate']);
  const avgPlace = pickNumber(entry, ['avgPlace', 'avgPlacement', 'stats.avgPlacement']);
  return Boolean(name && (winrate !== null || avgPlace !== null));
};

const findCompsInPayload = (payload) => {
  const found = [];
  const visited = new Set();

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      if (node.length > 0 && node.every((entry) => typeof entry === 'object')) {
        const sample = node.filter(isCompLike);
        if (sample.length >= Math.min(5, node.length)) {
          found.push(node);
        }
      }
      node.forEach(walk);
      return;
    }

    Object.values(node).forEach(walk);
  };

  walk(payload);

  found.sort((a, b) => b.length - a.length);
  return found.length ? found[0] : [];
};

const loadItems = () => {
  const raw = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'));
  const itemsByType = { ad: [], ap: [], tank: [], util: [] };
  raw.items.forEach((item) => {
    if (itemsByType[item.type]) {
      itemsByType[item.type].push({ id: item.id, name: item.name, recipe: item.recipe });
    }
  });
  return itemsByType;
};

const extractFromResponses = async (page) => {
  const payloads = [];
  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (!url.includes('tactics.tools')) return;
      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('application/json')) return;
      const data = await response.json();
      payloads.push(data);
    } catch (error) {
      // Ignore parsing errors
    }
  });

  await page.goto(SCRAPE_URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(5000);

  for (const payload of payloads) {
    const comps = findCompsInPayload(payload);
    if (comps.length >= 10) {
      return comps;
    }
  }
  return [];
};

const extractFromNuxt = async (page) => {
  const nuxtPayload = await page.evaluate(() => window.__NUXT__ || window.__NEXT_DATA__ || null);
  if (!nuxtPayload) return [];
  return findCompsInPayload(nuxtPayload);
};

const scrapeAll = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );

    let rawComps = await extractFromResponses(page);
    if (!rawComps.length) {
      await page.goto(SCRAPE_URL, { waitUntil: 'networkidle2', timeout: 120000 });
      await sleep(3000);
      rawComps = await extractFromNuxt(page);
    }

    if (!rawComps.length) {
      throw new Error('Impossible de récupérer les données via Tactics.tools.');
    }

    const normalized = rawComps.map(normalizeComp).filter((comp) => comp.name && comp.name !== 'Compo');
    const uniqueComps = [];
    const seen = new Set();
    for (const comp of normalized) {
      if (!seen.has(comp.id)) {
        seen.add(comp.id);
        uniqueComps.push(comp);
      }
    }

    if (uniqueComps.length < 10) {
      throw new Error('Le scraping a retourné trop peu de compositions.');
    }

    const payload = {
      timestamp: new Date().toISOString(),
      source: SCRAPE_URL,
      items: loadItems(),
      comps: uniqueComps
    };

    fs.writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  } finally {
    await browser.close();
  }
};

if (require.main === module) {
  scrapeAll()
    .then(() => console.log('✅ Scraping terminé.'))
    .catch((error) => {
      console.error('❌ Scraping échoué:', error.message);
      process.exitCode = 1;
    });
}

module.exports = { scrapeAll, DATA_PATH };
