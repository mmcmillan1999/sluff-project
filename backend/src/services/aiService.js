// backend/src/services/aiService.js

const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

// Single source of truth for every model the bots can use.
// id = what the UI/bots reference; apiModel = what the provider API expects.
const MODELS = {
    'gpt-5.4-mini':      { provider: 'openai',    apiModel: 'gpt-5.4-mini',           name: 'GPT-5.4 Mini',      speed: 'fast' },
    'gpt-5.5':           { provider: 'openai',    apiModel: 'gpt-5.5',                name: 'GPT-5.5',           speed: 'medium' },
    'gpt-5.4-nano':      { provider: 'openai',    apiModel: 'gpt-5.4-nano',           name: 'GPT-5.4 Nano',      speed: 'very-fast' },
    'claude-haiku-4.5':  { provider: 'anthropic', apiModel: 'claude-haiku-4-5',       name: 'Claude Haiku 4.5',  speed: 'fast' },
    'claude-sonnet-4.6': { provider: 'anthropic', apiModel: 'claude-sonnet-4-6',      name: 'Claude Sonnet 4.6', speed: 'medium' },
    'gemini-2.5-flash':  { provider: 'google',    apiModel: 'gemini-2.5-flash',       name: 'Gemini 2.5 Flash',  speed: 'fast' },
    'gemini-3.5-flash':  { provider: 'google',    apiModel: 'gemini-3.5-flash',       name: 'Gemini 3.5 Flash',  speed: 'medium' },
    'llama-3.3-70b':     { provider: 'groq',      apiModel: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B',    speed: 'fast' },
    'llama-3.1-8b':      { provider: 'groq',      apiModel: 'llama-3.1-8b-instant',   name: 'Llama 3.1 8B',      speed: 'very-fast' },
};

// Old model ids (pre-2026 makeover) resolve to current equivalents so any
// stored bot configs or stale clients keep working.
const LEGACY_ALIASES = {
    'gpt-4o-mini':       'gpt-5.4-mini',
    'gpt-4o':            'gpt-5.5',
    'gpt-3.5-turbo':     'gpt-5.4-nano',
    'claude-3.5-haiku':  'claude-haiku-4.5',
    'claude-3.5-sonnet': 'claude-sonnet-4.6',
    'gemini-2.0-flash':  'gemini-2.5-flash',
    'gemini-1.5-flash':  'gemini-2.5-flash',
    'gemini-flash-latest': 'gemini-2.5-flash',
};

// If the chosen model fails all retries, try these (skipping the failed
// provider) so a single provider outage never stalls a game.
const FALLBACK_ORDER = ['llama-3.3-70b', 'gemini-2.5-flash', 'gpt-5.4-mini', 'claude-haiku-4.5'];

class AIService {
    constructor() {
        this.openai = null;
        this.anthropic = null;
        this.google = null;
        this.groq = null;
        this.initialized = false;
    }

    initialize() {
        if (this.initialized) return;

        if (process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
        }

        if (process.env.ANTHROPIC_API_KEY) {
            this.anthropic = new Anthropic({
                apiKey: process.env.ANTHROPIC_API_KEY
            });
        }

        if (process.env.GOOGLE_API_KEY) {
            this.google = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        }

        if (process.env.GROQ_API_KEY) {
            this.groq = new Groq({
                apiKey: process.env.GROQ_API_KEY
            });
        }

        this.initialized = true;
    }

    _resolveModel(modelId) {
        const id = LEGACY_ALIASES[modelId] || modelId;
        const entry = MODELS[id];
        return entry ? { id, ...entry } : null;
    }

    _providerClient(provider) {
        switch (provider) {
            case 'openai': return this.openai;
            case 'anthropic': return this.anthropic;
            case 'google': return this.google;
            case 'groq': return this.groq;
            default: return null;
        }
    }

    async getCardDecision(model, gameState, legalPlays) {
        const prompt = this._buildCardPrompt(gameState, legalPlays);
        return this._decideWithFallback(model, prompt, 'card');
    }

    async getBidDecision(model, gameState, currentHighestBid, validBids = null) {
        const prompt = this._buildBidPrompt(gameState, currentHighestBid, validBids);
        return this._decideWithFallback(model, prompt, 'bid');
    }

    async getInsuranceDecision(model, gameState) {
        const prompt = this._buildInsurancePrompt(gameState);

        // Log the analysis being shown to the AI
        const promptLines = prompt.split('\n');
        const analysisStart = promptLines.findIndex(line => line.includes('CURRENT GAME STATE'));
        const analysisEnd = promptLines.findIndex(line => line.includes('STRATEGIC INSURANCE'));
        if (analysisStart >= 0 && analysisEnd > analysisStart) {
            const analysisSection = promptLines.slice(analysisStart, analysisEnd).join('\n');
            console.log(`📊 [INSURANCE-ANALYSIS] ${gameState.myName} analysis:\n${analysisSection}`);
        }

        return this._decideWithFallback(model, prompt, 'insurance');
    }

    // Try the requested model first; on total failure walk the fallback
    // chain (skipping models from the provider that just failed).
    async _decideWithFallback(modelId, prompt, type) {
        this.initialize();

        const primary = this._resolveModel(modelId);
        if (!primary) {
            console.warn(`Unknown AI model: ${modelId}, using fallback chain`);
        }

        const candidates = [];
        if (primary) candidates.push(primary);
        for (const fallbackId of FALLBACK_ORDER) {
            const entry = this._resolveModel(fallbackId);
            if (!entry) continue;
            if (primary && entry.provider === primary.provider) continue;
            if (candidates.some(c => c.id === entry.id)) continue;
            candidates.push(entry);
        }

        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i];
            if (!this._providerClient(candidate.provider)) continue;

            const isFallback = i > 0;
            console.log(`📡 [AI-API] Calling ${candidate.id}${isFallback ? ' (fallback)' : ''} for ${type} decision...`);
            try {
                const startTime = Date.now();
                const result = await this._decide(candidate, prompt, type);
                if (result) {
                    console.log(`✅ [AI-API] ${candidate.id} ${type} response in ${Date.now() - startTime}ms`);
                    return result;
                }
            } catch (error) {
                console.error(`❌ [AI-API] ${candidate.id} ${type} error:`, error.message);
            }
            // Only fall through to other providers on hard failure; stop after
            // two extra attempts so a full multi-provider outage fails fast.
            if (i >= 2) break;
        }

        return null;
    }

    async _decide(entry, prompt, type) {
        switch (entry.provider) {
            case 'openai': return this._getOpenAIDecision(entry.apiModel, prompt, type);
            case 'anthropic': return this._getAnthropicDecision(entry.apiModel, prompt, type);
            case 'google': return this._getGoogleDecision(entry.apiModel, prompt, type);
            case 'groq': return this._getGroqDecision(entry.apiModel, prompt, type);
            default: return null;
        }
    }

    _validate(result, type) {
        if (!result) return false;
        if (type === 'card' && !result.card) return false;
        if (type === 'bid' && !result.bid) return false;
        if (type === 'insurance' && (typeof result.offer !== 'number' || typeof result.requirement !== 'number')) return false;
        return true;
    }

    async _getOpenAIDecision(model, prompt, type) {
        if (!this.openai) return null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                // GPT-5 family: max_tokens is rejected (use max_completion_tokens),
                // temperature must stay at default, and reasoning tokens count
                // against the cap — so the budget is well above the old 150.
                const response = await this.openai.chat.completions.create({
                    model: model,
                    messages: [
                        { role: 'system', content: this._getSystemPrompt(type) + '\nIMPORTANT: Return ONLY valid JSON. No explanations outside JSON.' },
                        { role: 'user', content: prompt }
                    ],
                    max_completion_tokens: 4000,
                    response_format: { type: 'json_object' }
                });

                const content = response.choices[0].message.content;
                const result = JSON.parse(content);
                if (!this._validate(result, type)) continue;
                return result;
            } catch (error) {
                console.log(`OpenAI attempt ${attempt} failed: ${error.message}`);
                if (attempt === 3) throw error;
            }
        }

        return null;
    }

    async _getAnthropicDecision(model, prompt, type) {
        if (!this.anthropic) return null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const response = await this.anthropic.messages.create({
                    model: model,
                    max_tokens: 300,
                    messages: [
                        {
                            role: 'user',
                            content: `${this._getSystemPrompt(type)}\n\n${prompt}\n\nIMPORTANT: Respond with ONLY a valid JSON object. No text before or after the JSON.`
                        }
                    ]
                });

                const text = response.content[0].text.trim();
                // Extract JSON if wrapped in text
                const jsonMatch = text.match(/\{.*\}/s);
                const jsonStr = jsonMatch ? jsonMatch[0] : text;
                const result = JSON.parse(jsonStr);
                if (!this._validate(result, type)) continue;
                return result;
            } catch (error) {
                console.log(`Anthropic attempt ${attempt} failed: ${error.message}`);
                if (attempt === 3) throw error;
            }
        }

        return null;
    }

    async _getGoogleDecision(model, prompt, type) {
        if (!this.google) return null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const genModel = this.google.getGenerativeModel({
                    model: model,
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: 2000,
                        responseMimeType: 'application/json',
                    }
                });

                const fullPrompt = `${this._getSystemPrompt(type)}

${prompt}

CRITICAL: Your response must be ONLY a valid JSON object, nothing else.`;

                const result = await genModel.generateContent(fullPrompt);
                const response = await result.response;
                const text = response.text().trim();

                // Extract JSON from response
                const jsonMatch = text.match(/\{.*\}/s);
                if (!jsonMatch) continue;

                const jsonResult = JSON.parse(jsonMatch[0]);
                if (!this._validate(jsonResult, type)) continue;
                return jsonResult;
            } catch (error) {
                console.log(`Google attempt ${attempt} failed: ${error.message}`);

                // Handle rate limits specifically for Gemini
                if (error.message?.includes('429') || error.message?.includes('quota') ||
                    error.message?.includes('rate') || error.message?.includes('Resource exhausted')) {
                    const waitTime = attempt * 6000;
                    console.log(`⚠️ Gemini rate limited, waiting ${waitTime/1000}s before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                if (attempt === 3) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        return null;
    }

    async _getGroqDecision(model, prompt, type) {
        if (!this.groq) return null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const response = await this.groq.chat.completions.create({
                    model: model,
                    messages: [
                        {
                            role: 'system',
                            content: this._getSystemPrompt(type) + '\nYou MUST respond with valid JSON only.'
                        },
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: 300,
                    temperature: 0.1,
                    response_format: { type: 'json_object' }
                });

                const content = response.choices[0].message.content;
                const result = JSON.parse(content);
                if (!this._validate(result, type)) continue;
                return result;
            } catch (error) {
                console.log(`Groq attempt ${attempt} failed: ${error.status} ${error.message}`);

                // Handle rate limits specifically
                if (error.status === 429 || error.message?.includes('rate_limit')) {
                    const waitTime = attempt === 1 ? 4000 : attempt === 2 ? 8000 : 12000;
                    console.log(`Rate limited, waiting ${waitTime}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                if (attempt === 3) throw error;
                await new Promise(resolve => setTimeout(resolve, 500 * attempt));
            }
        }

        return null;
    }

    _getSystemPrompt(type) {
        if (type === 'card') {
            return `You are an expert Sluff card game player. Analyze the game state and choose the best card to play.
Rules: Sluff is a trick-taking game. Card values: A=11, 10=10, K=4, Q=3, J=2, others=0 (total 120 points).
You must follow suit if possible. Trump beats all other suits.

KEY STRATEGIES:
1. TRUMP FORCING: Lead LOW CARDS (6,7,8,9) from suits where opponents are void
2. NEVER WASTE HIGH CARDS: NEVER play A (11pts) or 10 (10pts) to force trump - that's giving away points!
3. TRACK VOIDS: Know who can't follow suit to control endgame
4. COUNT TRUMP: Track remaining trump cards for endgame control
5. POINT PRESERVATION: If forcing trump, use your LOWEST card. Save A/10 for winning tricks!

CRITICAL: Return ONLY a JSON object with these exact fields:
- "card": string (the card code like "AS", "10H", "9C")
- "reasoning": string (max 100 characters explaining your choice)

Example response: {"card": "3S", "reasoning": "Force opponent to trump low card, they're void in spades"}`;
        } else if (type === 'bid') {
            return `You are an expert Sluff card game player in the bidding phase.

CRITICAL RULE: You will be given a list of VALID BIDS. You MUST choose ONLY from that list.
The valid bids will be shown in the prompt. DO NOT choose any bid not in the valid list.

Bid meanings:
- Pass: Skip bidding
- Solo: Bid to choose trump (not hearts)
- Frog: Higher bid, get widow exchange (3 cards)
- Heart Solo: Highest bid, hearts are trump

CRITICAL: Return ONLY a JSON object with these exact fields:
- "bid": string (MUST be one of the valid bids provided in the prompt)
- "reasoning": string (max 100 characters explaining your choice)

Example response: {"bid": "Solo", "reasoning": "Strong spades suit with multiple high cards"}`;
        } else {
            return `You are an expert Sluff card game player in the insurance phase.

INSURANCE SYSTEM:
- BIDDER: Player who won the bid, trying to win the round
- DEFENDERS: Two players opposing the bidder (you may be one)
- Bidder sets REQUIREMENT (points they want to collect)
- Defenders make OFFERS (points they'll RECEIVE if bidder wins - protection!)
- Deal executes when: sum of defender offers >= bidder requirement
- NOTE: In the UI, negative values = incoming points (good for defenders)

POINT CALCULATION:
Bid Multipliers: Solo=1x, Frog=2x, Heart Solo=3x
Base target: 60 points

BIDDER scoring (delta from 60 points × bid multiplier):
- If WIN: delta × bid_mult × 2 (collects from 2 defenders)
- If LOSE: delta × bid_mult × 3 (pays out to 2 defenders)
Example Frog: Win by 10 pts = +10×2×2=+40, Lose by 10 pts = -10×2×3=-60

DEFENDER scoring:
- Max risk: 60 × bid_mult (Solo=60, Frog=120, Heart Solo=180)

OUTCOMES:
- If bidder WINS: Defenders pay their offers to bidder
- If bidder LOSES: Bidder pays requirement to defenders (split)

YOUR ROLE: You're either the BIDDER or a DEFENDER
- If BIDDER: Set requirement based on your confidence
- If DEFENDER: Offer based on bidder's likelihood to win

CRITICAL: Return ONLY a JSON object with POSITIVE point values:
- If you're BIDDER: {"offer": 0, "requirement": [60-360 points you want], "reasoning": "[why]"}
- If you're DEFENDER: {"offer": [0-180 points you'll RECEIVE if bidder wins], "requirement": 0, "reasoning": "[why]"}
NOTE: Always use positive numbers! The system converts them appropriately.

DEFENDER STRATEGY: If bidder is strong, ALWAYS make an offer to limit losses!
Refusing when bidder will win = lose DOUBLE the points!`;
        }
    }

    _buildBidPrompt(gameState, currentHighestBid, validBids) {
        const { myHand, scores } = gameState;

        // Count high cards and suits
        const suits = { H: [], S: [], C: [], D: [] };
        for (const card of myHand) {
            const suit = card[card.length - 1];
            suits[suit].push(card);
        }

        // Use provided valid bids or default to all bids
        const availableBids = validBids || ['Pass', 'Solo', 'Frog', 'Heart Solo'];

        return `Bidding Phase:
- Your hand: ${myHand.join(', ')}
- Suit distribution: Hearts(${suits.H.length}), Spades(${suits.S.length}), Clubs(${suits.C.length}), Diamonds(${suits.D.length})
- Current highest bid: ${currentHighestBid || 'None'}
- Current scores: ${Object.entries(scores).map(([p, s]) => `${p}: ${s}`).join(', ')}

VALID BIDS (choose ONLY from these): ${availableBids.join(', ')}

Rules:
- Solo/Frog: You pick trump (not hearts), need strong non-heart suit
- Heart Solo: Hearts are trump, need strong hearts
- You MUST choose from the valid bids listed above

Consider:
1. Point cards: A=11, 10=10, K=4, Q=3, J=2 (Aces and 10s are most valuable)
2. Long suits (5+ cards) are strong for bidding
3. Heart Solo requires 4+ hearts with high cards
4. Frog allows widow exchange (3 cards)`;
    }

    _buildCardPrompt(gameState, legalPlays) {
        const { myHand, currentTrick, trumpSuit, leadSuit, playedCards, scores, trickNumber,
                capturedTricksCount, pointsCaptured, seatPosition, insurance, bidder,
                suitTracking, remainingHighCards } = gameState;

        // Calculate round phase
        const roundPhase = trickNumber <= 4 ? 'early' : trickNumber <= 9 ? 'mid' : 'late';

        // Build void information
        let voidInfo = '';
        if (suitTracking) {
            const voids = [];
            Object.entries(suitTracking).forEach(([player, data]) => {
                if (player !== gameState.myName && data.voids) {
                    const playerVoids = [];
                    Object.entries(data.voids).forEach(([suit, isVoid]) => {
                        if (isVoid) playerVoids.push(suit);
                    });
                    if (playerVoids.length > 0) {
                        voids.push(`${player}: void in ${playerVoids.join(',')}`);
                    }
                }
            });
            if (voids.length > 0) {
                voidInfo = `\n- Known voids: ${voids.join('; ')}`;
            }
        }

        // High cards remaining summary
        let highCardInfo = '';
        if (remainingHighCards) {
            const highCards = [];
            Object.entries(remainingHighCards).forEach(([suit, cards]) => {
                if (cards.length > 0) {
                    highCards.push(`${suit}: ${cards.join(',')}`);
                }
            });
            if (highCards.length > 0) {
                highCardInfo = `\n- High cards out: ${highCards.join('; ')}`;
            }
        }

        return `Game State:
- Your hand: ${myHand.join(', ')}
- Legal plays: ${legalPlays.join(', ')}
- Trump suit: ${trumpSuit || 'None'}
- Lead suit: ${leadSuit || 'None (you lead)'}
- Current trick: ${currentTrick.map(t => `${t.player}: ${t.card}`).join(', ') || 'Empty (you lead)'}
- Trick ${trickNumber}/13 (${roundPhase} game)

Current Standing:
- Tricks captured: ${Object.entries(capturedTricksCount || {}).map(([p, c]) => `${p}: ${c}`).join(', ')}
- Points captured: ${Object.entries(pointsCaptured || {}).map(([p, pts]) => `${p}: ${pts}`).join(', ')}
- Position: ${seatPosition} (Bidder: ${bidder || 'None'})${voidInfo}${highCardInfo}
${insurance?.dealActive ? '- Insurance deal is ACTIVE' : ''}

ENDGAME CONTROL:
${roundPhase === 'late' ? `Critical: Track voids! If opponent is void in a suit, they can trump.
Count remaining ${trumpSuit || 'trump'}: Use your ${trumpSuit || 'trump'} wisely.` :
roundPhase === 'mid' ? 'Start tracking who might be void in suits.' :
'Early game - establish suit control.'}

TRUMP FORCING STRATEGY:
${trumpSuit ? `Leading suits where opponents are void FORCES them to use trump.
If you can force trump WITHOUT sacrificing A/10, DO IT!
This depletes their trump for endgame control.` : ''}

Choose the best card. Consider:
1. ${roundPhase === 'late' ? 'WHO CONTROLS remaining tricks (voids matter!)' : 'Build toward endgame control'}
2. Force trump plays: Lead suits where opponents are void (protect your A/10)
3. ${voidInfo ? 'EXPLOIT VOIDS: Force them to trump low cards!' : 'Watch for suit patterns'}
4. Position: ${seatPosition === 'right_of_bidder' ? 'You see bidder\'s play first' : seatPosition === 'left_of_bidder' ? 'Bidder plays after you' : 'Your position'}
5. ${highCardInfo ? 'Save high cards for when trump is exhausted' : 'Track high cards'}`;
    }

    _buildInsurancePrompt(gameState) {
        const { myHand, scores, bidder, bidType, insurance, capturedTricksCount,
                pointsCaptured, trickNumber, seatPosition, myName, remainingHighCards } = gameState;

        // Determine if I'm the bidder or a defender
        const isBidder = (bidder === myName);
        const role = isBidder ? 'BIDDER' : 'DEFENDER';

        // Calculate current game state
        const tricksPlayed = trickNumber - 1;
        const tricksRemaining = 13 - tricksPlayed;
        const bidderPoints = pointsCaptured?.[bidder] || 0;
        const totalPointsCaptured = Object.values(pointsCaptured || {}).reduce((sum, pts) => sum + pts, 0);
        const pointsRemaining = 120 - totalPointsCaptured;

        // Count high cards in my hand
        let myHighCards = 0;
        let myPoints = 0;
        if (myHand) {
            for (const card of myHand) {
                const rank = card.slice(0, -1);
                const value = rank === 'A' ? 11 : rank === '10' ? 10 : rank === 'K' ? 4 : rank === 'Q' ? 3 : rank === 'J' ? 2 : 0;
                myPoints += value;
                if (rank === 'A' || rank === '10') myHighCards++;
            }
        }

        // Calculate expected final score
        const bidderCurrentPace = tricksPlayed > 0 ? (bidderPoints / totalPointsCaptured) : 0.5;
        const expectedBidderFinal = bidderPoints + (pointsRemaining * bidderCurrentPace);
        const bidderDelta = Math.round(expectedBidderFinal - 60);

        return `Insurance Decision - You are a ${role}:
- Your hand: ${myHand.join(', ')} (worth ${myPoints} points)
- You: ${myName} (${role})
- Bidder: ${bidder} (${bidType})

CURRENT GAME STATE (Trick ${trickNumber}/13):
- Points captured: Bidder=${bidderPoints}, Total=${totalPointsCaptured}, Remaining=${pointsRemaining}
- Bidder needs 60 to break even, currently at ${bidderPoints}
- Expected bidder final: ${Math.round(expectedBidderFinal)} points (${bidderDelta > 0 ? '+' : ''}${bidderDelta} from 60)

YOUR ANALYSIS:
- You hold ${myHighCards} high cards (A/10) worth ${myPoints} points
- ${tricksRemaining} tricks remaining with ${pointsRemaining} points still in play
- Based on current pace, bidder likely to ${bidderDelta > 0 ? 'WIN' : 'LOSE'} by ${Math.abs(bidderDelta)} points

STRATEGIC INSURANCE CALCULATION:
${(() => {
    const bidMultiplier = bidType === 'Heart Solo' ? 3 : bidType === 'Frog' ? 2 : 1;

    if (isBidder) {
        // Bidder calculates expected score impact
        const myExpectedDelta = bidderDelta;
        const myExpectedScore = myExpectedDelta * bidMultiplier * 2; // 2-way payout if win
        const myExpectedLoss = -Math.abs(myExpectedDelta) * bidMultiplier * 3; // 3-way payout if lose

        return `As BIDDER, your expected outcome:
- If you WIN by ${Math.abs(bidderDelta)} points: You gain ${Math.abs(myExpectedScore)} points
- If you LOSE by ${Math.abs(bidderDelta)} points: You lose ${Math.abs(myExpectedLoss)} points
- Set requirement SLIGHTLY BELOW your expected gain (ask for ${Math.max(0, Math.abs(myExpectedScore) - 20)} points)
- This ensures insurance executes if you're winning as expected`;
    } else {
        // Defender calculates protection needed
        const bidderExpectedDelta = bidderDelta;
        const myRiskIfBidderWins = Math.abs(bidderExpectedDelta) * bidMultiplier;
        const myGainIfBidderLoses = Math.abs(bidderExpectedDelta) * bidMultiplier / 2;

        return `As DEFENDER, your risk analysis:
- If bidder WINS by ${Math.abs(bidderDelta)}: You lose ${myRiskIfBidderWins} points
- If bidder LOSES by ${Math.abs(bidderDelta)}: You gain ${Math.round(myGainIfBidderLoses)} points
- Expected outcome: Bidder ${bidderDelta > 0 ? 'WINS' : 'LOSES'}
- Offer ${bidderDelta > 0 ? Math.min(60 * bidMultiplier, myRiskIfBidderWins - 10) : Math.round(myRiskIfBidderWins * 0.3)} points protection
- This protects you if outcome matches expectation`;
    }
})()}

Your move (offer=${isBidder ? '0' : '?'}, requirement=${isBidder ? '?' : '0'}):`;
    }

    getAvailableModels() {
        this.initialize();

        return Object.entries(MODELS)
            .filter(([, m]) => this._providerClient(m.provider))
            .map(([id, m]) => ({
                id,
                name: m.name,
                provider: { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', groq: 'Groq' }[m.provider],
                speed: m.speed,
            }));
    }
}

module.exports = new AIService();
