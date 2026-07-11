// backend/src/services/aiService.js

const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const { BID_HIERARCHY, BID_MULTIPLIERS } = require('../core/constants');

const BID_ORDER_TEXT = BID_HIERARCHY.join(' < ');
const BID_MULTIPLIER_TEXT = Object.entries(BID_MULTIPLIERS)
    .map(([bid, multiplier]) => `${bid}=${multiplier}x`)
    .join(', ');

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

Example response: {"card": "6S", "reasoning": "Force opponent to trump low card, they're void in spades"}`;
        } else if (type === 'bid') {
            return `You are an expert Sluff card game player in the bidding phase.

CRITICAL RULE: You will be given a list of VALID BIDS. You MUST choose ONLY from that list.
The valid bids will be shown in the prompt. DO NOT choose any bid not in the valid list.

Bid meanings:
- Pass: Skip bidding
Bid order (lowest to highest): ${BID_ORDER_TEXT}
- Frog (${BID_MULTIPLIERS.Frog}x): Take the 3-card widow, then discard exactly 3 cards; hearts are trump
- Solo (${BID_MULTIPLIERS.Solo}x): Choose diamonds, clubs, or spades as trump; the bidder receives the widow points
- Heart Solo (${BID_MULTIPLIERS['Heart Solo']}x): Hearts are trump; the team that wins the last trick receives the widow points

CRITICAL: Return ONLY a JSON object with these exact fields:
- "bid": string (MUST be one of the valid bids provided in the prompt)
- "reasoning": string (max 100 characters explaining your choice)

Example response: {"bid": "Solo", "reasoning": "Strong spades suit with multiple high cards"}`;
        } else {
            return `You are an expert Sluff card game player in the insurance phase.

INSURANCE SYSTEM:
- BIDDER: Player who won the bid and sets the insurance REQUIREMENT
- DEFENDERS: Two active opponents who each set an insurance OFFER
- The deal locks immediately and unconditionally when combined defender offers meet or exceed the bidder requirement
- Locking never waits for, or depends on, whether the bidder later wins or loses the round
- Once locked, the agreed insurance transfers replace the normal round score exchange
- The bidder's settlement is the exact combined offer total; each defender receives the opposite of their own signed offer, so the deal is zero-sum

NORMAL SCORE EXCHANGE (only if no insurance deal locks):
Bid Multipliers: ${BID_MULTIPLIER_TEXT}
Base target: 60 points

BIDDER scoring without a locked deal (delta from 60 points × bid multiplier):
- Above 60: bidder collects one exchange share from each of 2 defenders (2 shares total)
- Below 60: bidder pays 3 exchange shares (2 defenders plus the score absorber/dealer)
- Frog example: 10 above 60 = +10×${BID_MULTIPLIERS.Frog}×2=+20; 10 below 60 = -10×${BID_MULTIPLIERS.Frog}×3=-30

MAX NORMAL EXCHANGE PER DEFENDER:
- Frog=${60 * BID_MULTIPLIERS.Frog}, Solo=${60 * BID_MULTIPLIERS.Solo}, Heart Solo=${60 * BID_MULTIPLIERS['Heart Solo']}

YOUR ROLE: You're either the BIDDER or a DEFENDER
- If BIDDER: Set a requirement for the fixed insurance transfer you will accept
- If DEFENDER: Set an offer for the fixed insurance transfer you will accept
- Evaluate the likely no-deal score only as negotiation context; a locked deal applies regardless of the card result

SIGNED VALUE RULES:
- Positive defender offer = defender pays those points to the bidder
- Negative defender offer = defender asks the bidder to pay them
- Positive bidder requirement = bidder requires a net receipt; a negative requirement accepts a net payment

CRITICAL: Return ONLY a JSON object using signed engine values:
- If you're BIDDER: {"offer": 0, "requirement": [signed value from -120×multiplier to +120×multiplier], "reasoning": "[why]"}
- If you're DEFENDER: {"offer": [signed value from -60×multiplier to +60×multiplier], "requirement": 0, "reasoning": "[why]"}

DEFENDER STRATEGY: Compare a fixed insurance transfer with your normal no-deal risk before choosing an offer.`;
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
        const availableBids = validBids || [...BID_HIERARCHY];

        return `Bidding Phase:
- Your hand: ${myHand.join(', ')}
- Suit distribution: Hearts(${suits.H.length}), Spades(${suits.S.length}), Clubs(${suits.C.length}), Diamonds(${suits.D.length})
- Current highest bid: ${currentHighestBid || 'None'}
- Current scores: ${Object.entries(scores).map(([p, s]) => `${p}: ${s}`).join(', ')}

VALID BIDS (choose ONLY from these): ${availableBids.join(', ')}

Rules:
- Bid order (lowest to highest): ${BID_ORDER_TEXT}
- Frog (${BID_MULTIPLIERS.Frog}x): Take the 3-card widow, discard exactly 3 cards, and play with hearts as trump
- Solo (${BID_MULTIPLIERS.Solo}x): Choose diamonds, clubs, or spades as trump; the bidder receives the widow points
- Heart Solo (${BID_MULTIPLIERS['Heart Solo']}x): Hearts are trump; the last-trick winner's team receives the widow points
- You MUST choose from the valid bids listed above

Consider:
1. Point cards: A=11, 10=10, K=4, Q=3, J=2 (Aces and 10s are most valuable)
2. Long suits (5+ cards) are strong for bidding
3. Heart Solo requires 4+ hearts with high cards
4. Frog's widow exchange can improve a weak hand, but it remains the lowest non-pass bid`;
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
- Trick ${trickNumber}/11 (${roundPhase} game)

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
        const tricksRemaining = 11 - tricksPlayed;
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
- Bid multiplier: ${BID_MULTIPLIERS[bidType] || 1}x

CURRENT GAME STATE (Trick ${trickNumber}/11):
- Points captured: Bidder=${bidderPoints}, Total=${totalPointsCaptured}, Remaining=${pointsRemaining}
- Bidder needs 60 to break even, currently at ${bidderPoints}
- Expected bidder final: ${Math.round(expectedBidderFinal)} points (${bidderDelta > 0 ? '+' : ''}${bidderDelta} from 60)

YOUR ANALYSIS:
- You hold ${myHighCards} high cards (A/10) worth ${myPoints} points
- ${tricksRemaining} tricks remaining with ${pointsRemaining} points still in play
- Based on current pace, bidder likely to ${bidderDelta > 0 ? 'WIN' : 'LOSE'} by ${Math.abs(bidderDelta)} points

STRATEGIC INSURANCE CALCULATION:
${(() => {
    const bidMultiplier = BID_MULTIPLIERS[bidType] || 1;
    const normalExchangeShare = Math.abs(bidderDelta) * bidMultiplier;

    if (isBidder) {
        const projectedNormalChange = bidderDelta > 0
            ? normalExchangeShare * 2
            : bidderDelta < 0 ? -normalExchangeShare * 3 : 0;
        const suggestedRequirement = Math.max(0, Math.abs(projectedNormalChange) - 20);

        return `As BIDDER, compare insurance with the normal no-deal outcome:
- Projected normal score exchange: ${projectedNormalChange >= 0 ? '+' : ''}${projectedNormalChange} points
- A locked insurance deal replaces that result with the fixed signed offer total, regardless of who wins
- Consider a requirement near ${suggestedRequirement} points based on that no-deal exposure
- The deal locks as soon as combined defender offers meet or exceed your requirement`;
    } else {
        const projectedNormalChange = bidderDelta > 0
            ? -normalExchangeShare
            : bidderDelta < 0 ? normalExchangeShare : 0;
        const suggestedOfferMagnitude = Math.min(
            60 * bidMultiplier,
            bidderDelta > 0 ? normalExchangeShare : Math.round(normalExchangeShare * 0.3),
        );
        const suggestedOffer = bidderDelta >= 0 ? suggestedOfferMagnitude : -suggestedOfferMagnitude;

        return `As DEFENDER, compare insurance with the normal no-deal outcome:
- Projected normal score exchange: ${projectedNormalChange >= 0 ? '+' : ''}${projectedNormalChange} points
- A locked insurance deal replaces that result with the fixed signed agreement, regardless of who wins
- Consider a signed offer near ${suggestedOffer} points based on that no-deal exposure
- Positive offers pay the bidder; negative offers ask the bidder to pay you
- The deal locks as soon as all defender offers together meet or exceed the bidder requirement`;
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
