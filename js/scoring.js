// ========== SCORING MODULE V2 ==========
// Gestion du calcul des scores avec support composants et bonus BIS

/**
 * Trouve tous les items craftables avec les composants disponibles
 * @param {Object} components - Composants sélectionnés {bf: 1, tear: 1}
 * @param {Array} itemsData - Données des items
 * @returns {Array} Liste des items craftables avec leurs infos
 */
function findCraftableItems(components, itemsData) {
    console.log('⚙️ findCraftableItems called');
    console.log('   input components:', components);
    console.log('   itemsData count:', itemsData?.length);

    const available = {...components};
    const craftable = [];

    // Trier par "valeur" (items BIS populaires en premier)
    const sortedItems = [...itemsData].sort((a, b) => {
        const priority = ['shojin', 'jg', 'guinsoo', 'ie', 'bt', 'archangel', 'void'];
        return priority.indexOf(a.id) - priority.indexOf(b.id);
    });

    for (const item of sortedItems) {
        if (!item.recipe) continue;
        const [c1, c2] = item.recipe;

        if (c1 === c2) {
            // Double composant (ex: Deathblade = bf+bf)
            while ((available[c1] || 0) >= 2) {
                available[c1] -= 2;
                craftable.push({ ...item, usedComponents: [c1, c2] });
            }
        } else {
            // Composants différents
            while ((available[c1] || 0) >= 1 && (available[c2] || 0) >= 1) {
                available[c1]--;
                available[c2]--;
                craftable.push({ ...item, usedComponents: [c1, c2] });
            }
        }
    }

    return craftable;
}

/**
 * Calcul du score basé sur les composants et les BIS de la compo
 * @param {Object} components - Composants sélectionnés
 * @param {Object} compo - La composition
 * @param {Array} itemsData - Données des items
 * @returns {Object} { score, details }
 */
function calculateComponentScore(components, compo, itemsData) {
    const details = [];
    let score = 0;
    const available = {...components};
    const bisItems = compo.bisItems || [];
    const wantedItems = compo.items || {};

    // 1. D'abord, essayer de crafter les BIS items
    const craftedBis = [];
    for (const bisId of bisItems) {
        const item = itemsData.find(i => i.id === bisId);
        if (!item || !item.recipe) continue;

        const [c1, c2] = item.recipe;
        let canCraft = false;

        if (c1 === c2) {
            if ((available[c1] || 0) >= 2) {
                available[c1] -= 2;
                canCraft = true;
            }
        } else {
            if ((available[c1] || 0) >= 1 && (available[c2] || 0) >= 1) {
                available[c1]--;
                available[c2]--;
                canCraft = true;
            }
        }

        if (canCraft) {
            // BIS COMPLET = GROS BONUS (+25 points)
            const bisBonus = 25;
            score += bisBonus;
            craftedBis.push(item.name);
            details.push(`✅ BIS ${item.name} craftable → +${bisBonus} pts`);
        } else {
            // Vérifier si on a au moins 1 composant du BIS
            const hasC1 = (components[c1] || 0) > 0;
            const hasC2 = (components[c2] || 0) > 0;
            if (hasC1 || hasC2) {
                const partialBonus = 8;
                score += partialBonus;
                const missing = hasC1 ? c2 : c1;
                details.push(`⏳ BIS ${item.name} partiel (manque ${missing}) → +${partialBonus} pts`);
            }
        }
    }

    // 2. Ensuite, vérifier les autres items utiles (non-BIS)
    const otherItems = Object.entries(wantedItems)
        .filter(([id]) => !bisItems.includes(id))
        .sort((a, b) => b[1] - a[1]);

    for (const [itemId, weight] of otherItems) {
        const item = itemsData.find(i => i.id === itemId);
        if (!item || !item.recipe) continue;

        const [c1, c2] = item.recipe;
        let canCraft = false;

        if (c1 === c2) {
            if ((available[c1] || 0) >= 2) {
                available[c1] -= 2;
                canCraft = true;
            }
        } else {
            if ((available[c1] || 0) >= 1 && (available[c2] || 0) >= 1) {
                available[c1]--;
                available[c2]--;
                canCraft = true;
            }
        }

        if (canCraft) {
            const itemBonus = Math.round(weight * 0.8);
            score += itemBonus;
            details.push(`🔧 ${item.name} craftable → +${itemBonus} pts`);
        }
    }

    return { score, details, craftedBis };
}

/**
 * Calcul du score total d'une composition (V2)
 * @param {Object} compo - La composition à scorer
 * @param {Object} state - État actuel (selectedComponents, selectedUnits, etc.)
 * @param {Object} data - Données (items, tierDefaults, tierMultipliers)
 * @returns {Object} { score, details }
 */
function calculateCompoScore(compo, state, data) {
    const allDetails = [];
    let baseScore = 0;

    // 1. Score des composants/items
    const { score: itemScore, details: itemDetails, craftedBis } = calculateComponentScore(
        state.selectedComponents || {},
        compo,
        data.items
    );
    baseScore += itemScore;
    allDetails.push(...itemDetails);

    // 2. Score des unités
    let unitScore = 0;
    Object.entries(compo.units || {}).forEach(([unit, weight]) => {
        if (state.selectedUnits && state.selectedUnits[unit]) {
            unitScore += weight;
            allDetails.push(`👤 ${unit} possédé → +${weight} pts`);
        }
        if (state.contestedUnits && state.contestedUnits[unit]) {
            const penalty = Math.round(weight * 0.5);
            unitScore -= penalty;
            allDetails.push(`⚠️ ${unit} contesté → -${penalty} pts`);
        }
    });
    baseScore += unitScore;

    // 3. Multiplicateur de tier
    const tier = data.tierDefaults[compo.id] || 'B';
    const mult = data.tierMultipliers[tier];
    let finalScore = Math.round(baseScore * mult);
    if (mult !== 1) {
        allDetails.push(`🏆 Tier ${tier} (x${mult}) → ${baseScore} × ${mult} = ${finalScore}`);
    }

    // 4. Bonus augments
    const augments = state.augments || [];
    if (augments.includes('ap') && compo.bisType === 'ap') {
        finalScore += 10;
        allDetails.push(`🔮 Augment AP → +10 pts`);
    }
    if (augments.includes('ad') && compo.bisType === 'ad') {
        finalScore += 10;
        allDetails.push(`🗡️ Augment AD → +10 pts`);
    }
    if (augments.includes('tank') && compo.bisType === 'tank') {
        finalScore += 10;
        allDetails.push(`🛡️ Augment Tank → +10 pts`);
    }
    if (augments.includes('reroll') && compo.tag.toLowerCase().includes('reroll')) {
        finalScore += 8;
        allDetails.push(`🎲 Augment Reroll → +8 pts`);
    }
    if (augments.includes('fast8') && compo.tag.toLowerCase().includes('fast')) {
        finalScore += 8;
        allDetails.push(`⬆️ Augment Fast8 → +8 pts`);
    }
    if (augments.includes('lose') && compo.tag.toLowerCase().includes('lose')) {
        finalScore += 8;
        allDetails.push(`💀 Augment Lose → +8 pts`);
    }

    return { score: finalScore, details: allDetails, craftedBis };
}

/**
 * Détermine la classe CSS du score
 */
function getScoreClass(score) {
    if (score >= 40) return 'score-high';
    if (score >= 20) return 'score-med';
    return 'score-low';
}

/**
 * Génère un résumé HTML du calcul de score
 */
function generateScoreDebug(compoName, details, finalScore) {
    return `
        <div style="margin-bottom: 8px; padding: 6px; background: rgba(0,0,0,0.3); border-radius: 4px;">
            <div style="color: #ffd700; font-weight: bold; margin-bottom: 4px;">${compoName} → ${finalScore} pts</div>
            ${details.map(d => `<div style="margin-left: 8px;">${d}</div>`).join('')}
        </div>
    `;
}

// ========== SCORING INTELLIGENT ==========

/**
 * Calcule le score intelligent pour une compo Tactics.tools
 * Combine: items BIS craftables + winrate
 * @param {Object} components - Composants sélectionnés {bf: 1, tear: 1}
 * @param {Object} tacticsComp - Compo depuis Tactics.tools avec bisItems, winrate
 * @param {Array} itemsData - Données des items
 * @returns {Object} { score, bisMatch, bisCraftable, bisTotal, winrate, details }
 */
function calculateIntelligentScore(components, tacticsComp, itemsData) {
    const details = [];
    const bisItems = tacticsComp.bisItems || [];
    const bisTotal = bisItems.length;

    if (bisTotal === 0) {
        return {
            score: 0,
            bisMatch: 0,
            bisCraftable: [],
            bisTotal: 0,
            winrate: tacticsComp.winrate || null,
            details: ['Pas de BIS définis']
        };
    }

    // Clone des composants pour calcul
    const available = {...components};
    const bisCraftable = [];
    const bisPartial = [];

    // Pour chaque BIS, vérifier si on peut le crafter
    for (const bisId of bisItems) {
        const item = itemsData.find(i => i.id === bisId);
        if (!item || !item.recipe) continue;

        const [c1, c2] = item.recipe;
        let canCraft = false;

        if (c1 === c2) {
            if ((available[c1] || 0) >= 2) {
                available[c1] -= 2;
                canCraft = true;
            }
        } else {
            if ((available[c1] || 0) >= 1 && (available[c2] || 0) >= 1) {
                available[c1]--;
                available[c2]--;
                canCraft = true;
            }
        }

        if (canCraft) {
            bisCraftable.push({
                id: bisId,
                name: item.name,
                recipe: item.recipe
            });
            details.push(`✅ ${item.name} craftable`);
        } else {
            // Vérifier si on a au moins 1 composant
            const hasC1 = (components[c1] || 0) > 0;
            const hasC2 = (components[c2] || 0) > 0;
            if (hasC1 || hasC2) {
                bisPartial.push({
                    id: bisId,
                    name: item.name,
                    has: hasC1 ? c1 : c2,
                    missing: hasC1 ? c2 : c1
                });
                details.push(`⏳ ${item.name} (manque ${hasC1 ? c2 : c1})`);
            }
        }
    }

    // Calcul du score
    // Base: 100 points max
    // - BIS match: 60% du score (chaque BIS craftable = 60/bisTotal points)
    // - Winrate bonus: 40% du score (winrate >= 50% = bonus)
    // - Partial BIS: +5 points chacun

    const bisMatchRatio = bisCraftable.length / bisTotal;
    let bisScore = Math.round(bisMatchRatio * 60);

    // Bonus pour BIS partiels
    bisScore += bisPartial.length * 5;

    // Bonus winrate (0-40 points basé sur winrate)
    let winrateScore = 0;
    const winrate = tacticsComp.winrate;
    if (winrate) {
        // Winrate 45% = 0pts, 55% = 40pts, linéaire entre les deux
        winrateScore = Math.round(Math.max(0, Math.min(40, (winrate - 45) * 4)));
    }

    const totalScore = bisScore + winrateScore;
    const matchPercent = Math.round(bisMatchRatio * 100);

    return {
        score: totalScore,
        bisMatch: bisCraftable.length,
        bisCraftable,
        bisPartial,
        bisTotal,
        matchPercent,
        winrate,
        winrateScore,
        bisScore,
        details
    };
}

/**
 * Calcule les TOP compos intelligentes basées sur composants + Tactics.tools
 * @param {Object} components - Composants sélectionnés
 * @param {Array} localCompos - Compos locales avec bisItems
 * @param {Array} tacticsComps - Compos Tactics.tools avec winrate
 * @param {Array} itemsData - Données des items
 * @returns {Array} Top compos triées par score intelligent
 */
function getIntelligentRecommendations(components, localCompos, tacticsComps, itemsData) {
    const results = [];

    // Créer une map des winrates depuis Tactics.tools
    const winrateMap = {};
    if (tacticsComps && tacticsComps.length > 0) {
        tacticsComps.forEach(tc => {
            const normalizedName = tc.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            winrateMap[normalizedName] = tc;
        });
    }

    // Pour chaque compo locale, calculer le score intelligent
    for (const compo of localCompos) {
        const normalizedName = compo.name.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Chercher le winrate correspondant
        let tacticsData = null;
        for (const [key, value] of Object.entries(winrateMap)) {
            // Match partiel sur les 6 premiers caractères
            if (key.includes(normalizedName.slice(0, 6)) || normalizedName.includes(key.slice(0, 6))) {
                tacticsData = value;
                break;
            }
        }

        // Fusionner les données
        const mergedCompo = {
            ...compo,
            winrate: tacticsData?.winrate || null,
            avgPlace: tacticsData?.avgPlace || null,
            tacticsName: tacticsData?.name || null
        };

        // Calculer le score intelligent
        const scoreResult = calculateIntelligentScore(components, mergedCompo, itemsData);

        results.push({
            compo: mergedCompo,
            ...scoreResult
        });
    }

    // Trier par score décroissant
    results.sort((a, b) => b.score - a.score);

    return results;
}

// Export des fonctions
window.Scoring = {
    findCraftableItems,
    calculateComponentScore,
    calculateCompoScore,
    getScoreClass,
    generateScoreDebug,
    calculateIntelligentScore,
    getIntelligentRecommendations
};
