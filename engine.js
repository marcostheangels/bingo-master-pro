// ===================== MOTOR DO JOGO (LADO DO SERVIDOR) =====================
// Lógica pura e autoritativa do Bingo. O servidor é a única fonte da verdade.

const PHASES = {
    kuadra: { label: 'Kuadra', description: '4 números na mesma linha horizontal', prize: '💰 R$ 3,00', reward: 3000 },
    kina: { label: 'Kina', description: '5 números na mesma linha horizontal', prize: '💰 R$ 5,00', reward: 5000 },
    keno: { label: 'Bingo', description: 'Cartela completa', prize: '💰 R$ 7,00', reward: 7000 }
};
const PHASE_SEQUENCE = ['kuadra', 'kina', 'keno'];
const CARD_COST = 150; // R$0,15 cada cartela (em fichas = centavos de real)
const JACKPOT_BALL_LIMIT = 37;
const JACKPOT_REWARD = 100000; // R$100,00 fixo
const INITIAL_CHIPS = 0; // R$0,00 — quem se cadastra começa com 0 e precisa depositar
const HUMAN_MAX_CARDS = 15;
const BOT_NAMES = ['Renata 🌸', 'Carlos 🍀', 'Fernanda 🌷', 'Juliana 💎', 'Pedro 🎯', 'Aline 🌺', 'Rodrigo ⚡', 'Tatiana 🌟', 'Bruno 🍀', 'Camila 🦋', 'Lucas 🔥', 'Beatriz 🌻', 'Gustavo 🍎', 'Larissa 🦄', 'Rafael 🎲', 'Patrícia 🌹', 'Thiago ⚽', 'Vanessa 🍓', 'Felipe 🚀', 'Mariana 🐬'];
const BOT_MAX_CARDS = 15;
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

function processPhaseWinners(winners, phaseKey, drawnBalls, totalCards) {
    const reward = PHASES[phaseKey].reward;
    const isJackpot = isJackpotEligible(phaseKey, drawnBalls);

    // Count unique winners (one prize per player, not per card)
    const uniquePlayers = [];
    const seen = new Set();
    winners.forEach(({ player }) => {
        if (!player || typeof player.chips !== 'number') return;
        const key = player.id || player.name;
        if (!seen.has(key)) {
            seen.add(key);
            uniquePlayers.push(player);
        }
    });

    if (uniquePlayers.length === 0) return { results: [], isJackpot: false };

    // Split phase prize equally among all winners
    const perPlayer = Math.max(1, Math.floor(reward / uniquePlayers.length));
    const jackpotPerPlayer = isJackpot ? Math.floor(JACKPOT_REWARD / uniquePlayers.length) : 0;

    const results = uniquePlayers.map(player => {
        let totalReward = perPlayer;
        let jackpotCount = 0;
        if (isJackpot) {
            totalReward += jackpotPerPlayer;
            jackpotCount = 1;
        }
        const oldWinnings = player.winnings || 0;
        player.winnings = oldWinnings + totalReward;
        player.chips += totalReward;
        return { player, cards: 0, totalReward, jackpotCount };
    });

    return { results, isJackpot };
}

module.exports = {
    PHASES, PHASE_SEQUENCE, CARD_COST, JACKPOT_BALL_LIMIT, JACKPOT_REWARD,
    INITIAL_CHIPS, HUMAN_MAX_CARDS, BOT_NAMES, BOT_MAX_CARDS, BOT_INITIAL_CHIPS,
    getMaxCardsForPlayer, generateBingoCardData,
    computeCardAwards, getCardClosePhase, computeCloseCardsForAllPlayers,
    checkAwardsForAllPlayers, processPhaseWinners
};
