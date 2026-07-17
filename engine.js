// ===================== MOTOR DO JOGO (LADO DO SERVIDOR) =====================
// Lógica pura e autoritativa do Bingo. O servidor é a única fonte da verdade.

const PHASES = {
    kuadra: { label: 'Kuadra', description: '4 números na mesma linha horizontal', prize: '💰 R$ 0,50', reward: 500 },
    kina: { label: 'Kina', description: '5 números na mesma linha horizontal', prize: '💰 R$ 1,00', reward: 1000 },
    keno: { label: 'Bingo', description: 'Cartela completa', prize: '💰 R$ 2,00', reward: 2000 }
};
const PHASE_SEQUENCE = ['kuadra', 'kina', 'keno'];
const CARD_COST = 100; // fallback padrão
const CARD_TIERS = [
    { name: 'Standard', emoji: '🎱', cost: 150, weight: 100 }
];
// % da receita destinada a cada fase + casa (sempre seguros)
const PRIZE_PERCENTS = { kuadra: 0.15, kina: 0.15, keno: 0.50, jackpot: 0.12, casa: 0.08 };
const JACKPOT_BALL_LIMIT = 37; // Igual ao site de referencia — quase impossivel
const JACKPOT_INITIAL = 50000; // R$50,00 semente (nunca é tocada)
const JACKPOT_CONTRIBUTION_PER_CARD = 10; // fallback
const JACKPOT_MAX = 1000000; // R$1.000,00 teto (igual ao site)
const KENO_MIN_MULTIPLIER = 1.25; // Keno mínimo = 40cart × preço × 1.25 (sempre maior que o gasto)

const INITIAL_CHIPS = 0; // R$0,00 — quem se cadastra começa com 0 e precisa depositar
const HUMAN_MAX_CARDS = 9999; // Sem limite pratico — igual ao site
const BOT_NAMES = ['Renata 🌸', 'Carlos 🍀', 'Fernanda 🌷', 'Juliana 💎', 'Pedro 🎯', 'Aline 🌺', 'Rodrigo ⚡', 'Tatiana 🌟', 'Bruno 🍀', 'Camila 🦋', 'Lucas 🔥', 'Beatriz 🌻', 'Gustavo 🍎', 'Larissa 🦄', 'Rafael 🎲', 'Patrícia 🌹', 'Thiago ⚽', 'Vanessa 🍓', 'Felipe 🚀', 'Mariana 🐬'];
const BOT_MAX_CARDS = 25;
const BOT_INITIAL_CHIPS = 10000; // R$10,00 somente para bots

function getMaxCardsForPlayer(player) {
    if (!player) return HUMAN_MAX_CARDS;
    if (player.isBot) return BOT_MAX_CARDS;
    return HUMAN_MAX_CARDS;
}

function generateBingoCardData() {
    const card = Array.from({ length: 3 }, () => Array(9).fill(''));

    for (let column = 0; column < 9; column++) {
        const start = column === 0 ? 1 : column * 10;
        const end = column === 8 ? 90 : column * 10 + 9;
        const pool = [];
        for (let n = start; n <= end; n++) pool.push(n);

        const selected = [];
        for (let row = 0; row < 3; row++) {
            const index = Math.floor(Math.random() * pool.length);
            selected.push(pool.splice(index, 1)[0]);
        }

        selected.sort((a, b) => a - b);
        for (let row = 0; row < 3; row++) {
            card[row][column] = selected[row];
        }
    }

    for (let row = 0; row < 3; row++) {
        const emptyColumns = [];
        while (emptyColumns.length < 4) {
            const column = Math.floor(Math.random() * 9);
            if (!emptyColumns.includes(column)) emptyColumns.push(column);
        }
        emptyColumns.forEach(column => {
            card[row][column] = '';
        });
    }

    const cardId = `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const codigo = Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    return { id: cardId, codigo, numbers: card, awards: { kuadra: false, kina: false, keno: false } };
}

function getMarkedCountInRow(card, row, drawnBalls) {
    return card[row].reduce((count, value) => count + (value !== '' && drawnBalls.includes(Number(value)) ? 1 : 0), 0);
}

function getCardCompleted(card, drawnBalls) {
    return card.flat().every(value => value === '' || drawnBalls.includes(Number(value)));
}

function computeCardAwards(cardData, currentPhaseIndex, drawnBalls) {
    const awards = [];
    const numbers = cardData.numbers;
    const currentPhase = PHASE_SEQUENCE[currentPhaseIndex] || 'keno';
    const completed = getCardCompleted(numbers, drawnBalls);

    if (currentPhase === 'kuadra') {
        for (let row = 0; row < 3; row++) {
            const count = getMarkedCountInRow(numbers, row, drawnBalls);
            if (count >= 4 && !cardData.awards.kuadra) {
                cardData.awards.kuadra = true;
                awards.push('kuadra');
                break;
            }
        }
        return awards;
    }

    if (currentPhase === 'kina') {
        for (let row = 0; row < 3; row++) {
            const count = getMarkedCountInRow(numbers, row, drawnBalls);
            if (count >= 5 && !cardData.awards.kina) {
                cardData.awards.kina = true;
                awards.push('kina');
                break;
            }
        }
        return awards;
    }

    if (currentPhase === 'keno' && completed && !cardData.awards.keno) {
        cardData.awards.keno = true;
        awards.push('keno');
        return awards;
    }

    return awards;
}

function getCardClosePhase(cardData, currentPhaseIndex, drawnBalls) {
    cardData.awards = cardData.awards || { kuadra: false, kina: false, keno: false };
    const numbers = cardData.numbers;

    if (currentPhaseIndex === 0) {
        if (cardData.awards.kuadra) return { phase: 'kuadra', won: true };
        for (let row = 0; row < 3; row++) {
            const rowMarks = getMarkedCountInRow(numbers, row, drawnBalls);
            if (rowMarks >= 3) return { phase: 'kuadra', won: false };
        }
    }

    if (currentPhaseIndex === 1) {
        if (cardData.awards.kina) return { phase: 'kina', won: true };
        for (let row = 0; row < 3; row++) {
            const rowMarks = getMarkedCountInRow(numbers, row, drawnBalls);
            if (rowMarks >= 4) return { phase: 'kina', won: false };
        }
    }

    if (currentPhaseIndex === 2) {
        if (cardData.awards.keno) return { phase: 'keno', won: true };
        const totalMarked = numbers.flat().reduce((count, value) => count + (value !== '' && drawnBalls.includes(Number(value)) ? 1 : 0), 0);
        if (totalMarked >= 14) return { phase: 'keno', won: false };
    }

    return null;
}

function computeCloseCardsForAllPlayers(players, currentPhaseIndex, drawnBalls) {
    const map = {};
    players.forEach(player => {
        if (!player || !player.cards) return;
        const list = [];
        player.cards.forEach((card) => {
            const result = getCardClosePhase(card, currentPhaseIndex, drawnBalls);
            if (result) list.push({ cardId: card.id, phase: result.phase, won: result.won });
        });
        if (list.length) map[player.id || player.name] = list;
    });
    return map;
}

function checkAwardsForAllPlayers(players, currentPhaseIndex, drawnBalls) {
    const winners = [];
    players.forEach(player => {
        (player.cards || []).forEach((cardData, cardIndex) => {
            const newAwards = computeCardAwards(cardData, currentPhaseIndex, drawnBalls);
            newAwards.forEach(phase => {
                winners.push({ player, cardIndex, phase });
            });
        });
    });
    return winners;
}

function isJackpotEligible(phaseKey, drawnBalls) {
    return phaseKey === 'keno' && drawnBalls.length <= JACKPOT_BALL_LIMIT;
}

function pickCardTier() {
    const totalWeight = CARD_TIERS.reduce((sum, t) => sum + t.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const tier of CARD_TIERS) {
        rand -= tier.weight;
        if (rand <= 0) return { ...tier };
    }
    return { ...CARD_TIERS[0] };
}

function calculatePhaseRewards(totalCards, tier) {
    const revenue = totalCards * tier.cost;
    const kuadra = Math.floor(revenue * PRIZE_PERCENTS.kuadra);
    const kina = Math.floor(revenue * PRIZE_PERCENTS.kina);
    const kenoBase = Math.floor(revenue * PRIZE_PERCENTS.keno);
    const kenoMinimum = Math.floor(40 * tier.cost * KENO_MIN_MULTIPLIER);
    const kenoGap = Math.max(0, kenoMinimum - kenoBase);
    const jackpotContrib = Math.floor(revenue * PRIZE_PERCENTS.jackpot);
    const casaLucro = Math.floor(revenue * PRIZE_PERCENTS.casa);
    return { kuadra, kina, kenoBase, kenoMinimum, kenoGap, jackpotContrib, casaLucro };
}

function processPhaseWinners(winners, phaseKey, drawnBalls, humanCards, jackpotAmount, dynamicReward) {
    const reward = dynamicReward || PHASES[phaseKey].reward;

    // Vencedores únicos (1 prêmio por jogador, não por cartela)
    const uniquePlayers = [];
    const humanWinners = [];
    const seen = new Set();
    winners.forEach(({ player }) => {
        if (!player || typeof player.chips !== 'number') return;
        const key = player.id || player.name;
        if (seen.has(key)) return;
        seen.add(key);
        uniquePlayers.push(player);
        if (!player.isBot) humanWinners.push(player);
    });

    if (uniquePlayers.length === 0) return { results: [], isJackpot: false };

    // Prêmio base é dividido entre TODOS os vencedores (humanos E bots) — bots dão vida ao jogo
    const perPlayer = Math.max(1, Math.floor(reward / uniquePlayers.length));

    // Jackpot: só vence se Keno em ate 34 bolas — quase impossível
    // O prêmio é o acumulado total (jackpot menos a semente de R$50)
    const isJackpot = isJackpotEligible(phaseKey, drawnBalls);
    const jackpotPool = jackpotAmount || JACKPOT_INITIAL;
    const jackpotPerPlayer = isJackpot ? Math.floor(jackpotPool / Math.max(1, uniquePlayers.length)) : 0;

    const results = uniquePlayers.map(player => {
        let totalReward = perPlayer;
        let jackpotCount = 0;
        if (isJackpot) {
            totalReward += jackpotPerPlayer;
            jackpotCount = 1;
        }
        player.winnings = (player.winnings || 0) + totalReward;
        player.chips += totalReward;
        return { player, cards: 0, totalReward, jackpotCount };
    });

    return { results, isJackpot };
}

module.exports = {
    PHASES, PHASE_SEQUENCE, CARD_COST, CARD_TIERS, PRIZE_PERCENTS,
    JACKPOT_BALL_LIMIT, JACKPOT_INITIAL, JACKPOT_CONTRIBUTION_PER_CARD, JACKPOT_MAX, KENO_MIN_MULTIPLIER,
    INITIAL_CHIPS, HUMAN_MAX_CARDS, BOT_NAMES, BOT_MAX_CARDS, BOT_INITIAL_CHIPS,
    getMaxCardsForPlayer, generateBingoCardData,
    computeCardAwards, getCardClosePhase, computeCloseCardsForAllPlayers,
    checkAwardsForAllPlayers, processPhaseWinners,
    pickCardTier, calculatePhaseRewards
};
