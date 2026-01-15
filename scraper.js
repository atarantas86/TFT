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
            entry.characterId ||
            entry.character_id ||
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
  const units = entry.units || entry.champions || entry.board || entry.finalUnits || entry.coreUnits;
  return Boolean(name && (winrate !== null || avgPlace !== null || units));
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

const safeJsonParse = (value) => {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const extractFromResponses = async (page) => {
  const payloads = [];
  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (!url.includes('tactics.tools')) return;
      const contentType = response.headers()['content-type'] || '';
      if (!/(json|text\/plain|application\/octet-stream)/i.test(contentType)) return;
      const text = await response.text();
      const data = safeJsonParse(text);
      if (data) payloads.push(data);
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

const extractFromEmbeddedJson = async (page) => {
  const scripts = await page.evaluate(() => {
    const entries = [];
    document.querySelectorAll('script[type="application/json"]').forEach((script) => {
      if (script.textContent) entries.push(script.textContent);
    });
    return entries;
  });

  for (const script of scripts) {
    const parsed = safeJsonParse(script);
    if (!parsed) continue;
    const comps = findCompsInPayload(parsed);
    if (comps.length >= 10) return comps;
  }
  return [];
};

const extractFromNuxt = async (page) => {
  const nuxtPayload = await page.evaluate(() =>
    window.__NUXT__ || window.__NEXT_DATA__ || window.__DATA__ || window.__APOLLO_STATE__ || null
  );
  if (!nuxtPayload) return [];
  return findCompsInPayload(nuxtPayload);
};

const extractFromDom = async (page) => {
  const comps = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll(
        '[data-comp], [data-comp-name], [data-test*="comp"], .team-comp, .comp-card, .comp'
      )
    );

    const pickText = (el, selectors) => {
      for (const selector of selectors) {
        const node = el.querySelector(selector);
        if (node && node.textContent) return node.textContent.trim();
      }
      return '';
    };

    const extractNumber = (text) => {
      if (!text) return null;
      const match = text.replace(',', '.').match(/([0-9]+\.?[0-9]*)/);
      if (!match) return null;
      return Number.parseFloat(match[1]);
    };

    return cards
      .map((card) => {
        const name = pickText(card, ['.comp-name', '.name', '[data-comp-name]']) || card.getAttribute('data-comp-name');
        const tier =
          pickText(card, ['.comp-tier', '.tier', '.rank']) ||
          (card.textContent.match(/\b[SA]\b/) || [])[0];
        const winrateText = pickText(card, ['.comp-wr', '.winrate', '.wr']);
        const avgText = pickText(card, ['.avg-place', '.avg', '.placement']);
        const units = Array.from(card.querySelectorAll('img'))
          .map((img) => img.getAttribute('alt') || img.getAttribute('data-unit') || img.getAttribute('data-champion'))
          .filter(Boolean);
        const items = Array.from(card.querySelectorAll('[data-item], .item, .bis-item, .comp-bis-item'))
          .map((el) =>
            el.getAttribute('data-item') ||
            el.getAttribute('data-item-id') ||
            (el.textContent ? el.textContent.trim() : '')
          )
          .filter(Boolean);

        return {
          name,
          tier,
          winrate: extractNumber(winrateText),
          avgPlace: extractNumber(avgText),
          units,
          bisItems: items
        };
      })
      .filter((comp) => comp.name);
  });

  return comps;
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
    if (!rawComps.length) rawComps = await extractFromNuxt(page);
    if (!rawComps.length) rawComps = await extractFromEmbeddedJson(page);
    if (!rawComps.length) rawComps = await extractFromDom(page);

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
