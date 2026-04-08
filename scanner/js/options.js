/**
 * Options Strategy Calculator & Analyzer
 * Calculates max gain, max loss, breakeven, risk/reward for all strategies
 * OptiMax Scanner
 */

const OptionsCalc = (() => {

    // ===== Strategy Definitions =====
    const STRATEGIES = {
        long_call: {
            name: 'Long Call',
            direction: 'bullish',
            legs: 1,
            description: 'Buy a call option. Profit from upside, limited risk.',
        },
        long_put: {
            name: 'Long Put',
            direction: 'bearish',
            legs: 1,
            description: 'Buy a put option. Profit from downside, limited risk.',
        },
        bull_call_spread: {
            name: 'Bull Call Spread',
            direction: 'bullish',
            legs: 2,
            description: 'Buy lower call, sell higher call. Capped gain, reduced cost.',
        },
        bear_put_spread: {
            name: 'Bear Put Spread',
            direction: 'bearish',
            legs: 2,
            description: 'Buy higher put, sell lower put. Capped gain, reduced cost.',
        },
        straddle: {
            name: 'Long Straddle',
            direction: 'neutral',
            legs: 2,
            description: 'Buy ATM call + put. Profit from large moves either direction.',
        },
        strangle: {
            name: 'Long Strangle',
            direction: 'neutral',
            legs: 2,
            description: 'Buy OTM call + OTM put. Cheaper than straddle.',
        },
        iron_condor: {
            name: 'Iron Condor',
            direction: 'neutral',
            legs: 4,
            description: 'Sell inner strangle, buy outer wings. Profit from low volatility.',
        },
        covered_call: {
            name: 'Covered Call',
            direction: 'neutral-bullish',
            legs: 1,
            description: 'Own stock + sell call. Income generation strategy.',
        },
        protective_put: {
            name: 'Protective Put',
            direction: 'bullish',
            legs: 1,
            description: 'Own stock + buy put. Downside protection.',
        },
        butterfly: {
            name: 'Butterfly Spread',
            direction: 'neutral',
            legs: 3,
            description: 'Buy 1 ITM + 1 OTM call, sell 2 ATM calls. Low cost, limited risk.',
        },
    };

    // ===== Core Calculations =====

    /**
     * Calculate Long Call metrics
     */
    function calcLongCall(stockPrice, strike, premium, dte) {
        const cost = premium * 100; // Per contract
        const breakeven = strike + premium;
        const maxLoss = cost;
        // Max gain is theoretically unlimited, approximate with 2x stock price move
        const targetPrice = stockPrice * 1.5;
        const maxGainAtTarget = (targetPrice - strike - premium) * 100;
        const maxGainPercent = (maxGainAtTarget / cost) * 100;

        // Probability proxy: distance to breakeven as % of stock price
        const distToBreakeven = ((breakeven - stockPrice) / stockPrice) * 100;

        return {
            strategy: 'long_call',
            strategyName: 'Long Call',
            strike: strike,
            premium: premium,
            cost: cost,
            breakeven: breakeven,
            maxLoss: maxLoss,
            maxGain: 'Unlimited',
            maxGainPercent: maxGainPercent,
            maxGainDollars: maxGainAtTarget,
            riskReward: maxGainAtTarget / maxLoss,
            distToBreakeven: distToBreakeven,
            dte: dte,
            direction: 'bullish',
        };
    }

    /**
     * Calculate Long Put metrics
     */
    function calcLongPut(stockPrice, strike, premium, dte) {
        const cost = premium * 100;
        const breakeven = strike - premium;
        const maxLoss = cost;
        const maxGainDollars = (strike - premium) * 100; // stock goes to 0
        const maxGainPercent = (maxGainDollars / cost) * 100;

        const distToBreakeven = ((stockPrice - breakeven) / stockPrice) * 100;

        return {
            strategy: 'long_put',
            strategyName: 'Long Put',
            strike: strike,
            premium: premium,
            cost: cost,
            breakeven: breakeven,
            maxLoss: maxLoss,
            maxGain: maxGainDollars,
            maxGainPercent: maxGainPercent,
            maxGainDollars: maxGainDollars,
            riskReward: maxGainDollars / maxLoss,
            distToBreakeven: distToBreakeven,
            dte: dte,
            direction: 'bearish',
        };
    }

    /**
     * Calculate Bull Call Spread metrics
     */
    function calcBullCallSpread(stockPrice, longStrike, shortStrike, longPremium, shortPremium, dte) {
        const netDebit = (longPremium - shortPremium) * 100;
        const maxGainDollars = (shortStrike - longStrike) * 100 - netDebit;
        const maxLoss = netDebit;
        const breakeven = longStrike + (longPremium - shortPremium);
        const maxGainPercent = (maxGainDollars / netDebit) * 100;

        return {
            strategy: 'bull_call_spread',
            strategyName: 'Bull Call Spread',
            strikes: `${longStrike}/${shortStrike}`,
            premium: longPremium - shortPremium,
            cost: netDebit,
            breakeven: breakeven,
            maxLoss: maxLoss,
            maxGain: maxGainDollars,
            maxGainPercent: maxGainPercent,
            maxGainDollars: maxGainDollars,
            riskReward: maxGainDollars / maxLoss,
            distToBreakeven: ((breakeven - stockPrice) / stockPrice) * 100,
            dte: dte,
            direction: 'bullish',
        };
    }

    /**
     * Calculate Bear Put Spread metrics
     */
    function calcBearPutSpread(stockPrice, longStrike, shortStrike, longPremium, shortPremium, dte) {
        const netDebit = (longPremium - shortPremium) * 100;
        const maxGainDollars = (longStrike - shortStrike) * 100 - netDebit;
        const maxLoss = netDebit;
        const breakeven = longStrike - (longPremium - shortPremium);
        const maxGainPercent = (maxGainDollars / netDebit) * 100;

        return {
            strategy: 'bear_put_spread',
            strategyName: 'Bear Put Spread',
            strikes: `${longStrike}/${shortStrike}`,
            premium: longPremium - shortPremium,
            cost: netDebit,
            breakeven: breakeven,
            maxLoss: maxLoss,
            maxGain: maxGainDollars,
            maxGainPercent: maxGainPercent,
            maxGainDollars: maxGainDollars,
            riskReward: maxGainDollars / maxLoss,
            distToBreakeven: ((stockPrice - breakeven) / stockPrice) * 100,
            dte: dte,
            direction: 'bearish',
        };
    }

    /**
     * Calculate Long Straddle metrics
     */
    function calcStraddle(stockPrice, strike, callPremium, putPremium, dte) {
        const totalPremium = callPremium + putPremium;
        const cost = totalPremium * 100;
        const maxLoss = cost;
        const breakevenUp = strike + totalPremium;
        const breakevenDown = strike - totalPremium;

        // Max gain unlimited on upside, limited on downside (strike - totalPremium)
        const upsideGain = (stockPrice * 0.5) * 100; // assume 50% move for scoring
        const downsideGain = (breakevenDown) * 100;
        const maxGainPercent = (Math.max(upsideGain, downsideGain) / cost) * 100;

        return {
            strategy: 'straddle',
            strategyName: 'Long Straddle',
            strike: strike,
            premium: totalPremium,
            cost: cost,
            breakeven: `${breakevenDown.toFixed(2)} / ${breakevenUp.toFixed(2)}`,
            breakevenUp: breakevenUp,
            breakevenDown: breakevenDown,
            maxLoss: maxLoss,
            maxGain: 'Unlimited',
            maxGainPercent: maxGainPercent,
            maxGainDollars: upsideGain,
            riskReward: upsideGain / maxLoss,
            distToBreakeven: (totalPremium / stockPrice) * 100,
            dte: dte,
            direction: 'neutral',
        };
    }

    /**
     * Calculate Long Strangle metrics
     */
    function calcStrangle(stockPrice, callStrike, putStrike, callPremium, putPremium, dte) {
        const totalPremium = callPremium + putPremium;
        const cost = totalPremium * 100;
        const maxLoss = cost;
        const breakevenUp = callStrike + totalPremium;
        const breakevenDown = putStrike - totalPremium;

        const upsideGain = (stockPrice * 0.5) * 100;
        const maxGainPercent = (upsideGain / cost) * 100;

        return {
            strategy: 'strangle',
            strategyName: 'Long Strangle',
            strikes: `${putStrike}/${callStrike}`,
            premium: totalPremium,
            cost: cost,
            breakeven: `${breakevenDown.toFixed(2)} / ${breakevenUp.toFixed(2)}`,
            breakevenUp: breakevenUp,
            breakevenDown: breakevenDown,
            maxLoss: maxLoss,
            maxGain: 'Unlimited',
            maxGainPercent: maxGainPercent,
            maxGainDollars: upsideGain,
            riskReward: upsideGain / maxLoss,
            distToBreakeven: (totalPremium / stockPrice) * 100,
            dte: dte,
            direction: 'neutral',
        };
    }

    /**
     * Calculate Iron Condor metrics
     */
    function calcIronCondor(stockPrice, putBuyStrike, putSellStrike, callSellStrike, callBuyStrike,
                             putBuyPremium, putSellPremium, callSellPremium, callBuyPremium, dte) {
        const netCredit = ((putSellPremium - putBuyPremium) + (callSellPremium - callBuyPremium)) * 100;
        const putSpreadWidth = (putSellStrike - putBuyStrike) * 100;
        const callSpreadWidth = (callBuyStrike - callSellStrike) * 100;
        const maxLoss = Math.max(putSpreadWidth, callSpreadWidth) - netCredit;

        const maxGainDollars = netCredit;
        const maxGainPercent = (netCredit / maxLoss) * 100;

        return {
            strategy: 'iron_condor',
            strategyName: 'Iron Condor',
            strikes: `${putBuyStrike}/${putSellStrike}/${callSellStrike}/${callBuyStrike}`,
            premium: netCredit / 100,
            cost: -netCredit, // Credit received
            breakeven: `${putSellStrike - netCredit/100} / ${callSellStrike + netCredit/100}`,
            maxLoss: maxLoss,
            maxGain: maxGainDollars,
            maxGainPercent: maxGainPercent,
            maxGainDollars: maxGainDollars,
            riskReward: maxGainDollars / maxLoss,
            dte: dte,
            direction: 'neutral',
        };
    }

    /**
     * Calculate Covered Call metrics
     */
    function calcCoveredCall(stockPrice, strike, premium, dte) {
        const stockCost = stockPrice * 100;
        const premiumReceived = premium * 100;
        const maxGainDollars = (strike - stockPrice) * 100 + premiumReceived;
        const maxLoss = stockCost - premiumReceived; // Stock goes to 0
        const breakeven = stockPrice - premium;
        const maxGainPercent = (maxGainDollars / stockCost) * 100;

        return {
            strategy: 'covered_call',
            strategyName: 'Covered Call',
            strike: strike,
            premium: premium,
            cost: stockCost - premiumReceived,
            breakeven: breakeven,
            maxLoss: maxLoss,
            maxGain: maxGainDollars,
            maxGainPercent: maxGainPercent,
            maxGainDollars: maxGainDollars,
            riskReward: maxGainDollars / maxLoss,
            dte: dte,
            direction: 'neutral-bullish',
        };
    }

    // ===== Options Scoring Engine =====

    /**
     * Score an options opportunity (0-100)
     * Higher = better risk/reward & probability combo
     */
    function scoreOpportunity(result, ivRank, volume, openInterest) {
        let score = 0;

        // Risk/Reward ratio (max 30 points)
        const rr = result.riskReward || 0;
        if (rr >= 5) score += 30;
        else if (rr >= 3) score += 25;
        else if (rr >= 2) score += 20;
        else if (rr >= 1.5) score += 15;
        else if (rr >= 1) score += 10;
        else score += 5;

        // Max Gain Percent (max 25 points)
        const gainPct = result.maxGainPercent || 0;
        if (gainPct >= 500) score += 25;
        else if (gainPct >= 300) score += 20;
        else if (gainPct >= 200) score += 17;
        else if (gainPct >= 100) score += 13;
        else if (gainPct >= 50) score += 8;
        else score += 3;

        // IV Rank (max 20 points) - higher IV rank means options are expensive
        // For buyers: want low IV rank. For sellers: want high IV rank.
        const isBuyer = ['long_call', 'long_put', 'straddle', 'strangle', 'bull_call_spread', 'bear_put_spread'].includes(result.strategy);
        if (isBuyer) {
            if (ivRank < 20) score += 20;
            else if (ivRank < 35) score += 15;
            else if (ivRank < 50) score += 10;
            else score += 5;
        } else {
            // Sellers want high IV
            if (ivRank > 80) score += 20;
            else if (ivRank > 60) score += 15;
            else if (ivRank > 40) score += 10;
            else score += 5;
        }

        // Volume & Liquidity (max 15 points)
        const vol = volume || 0;
        const oi = openInterest || 0;
        if (vol >= 1000 && oi >= 5000) score += 15;
        else if (vol >= 500 && oi >= 2000) score += 12;
        else if (vol >= 100 && oi >= 500) score += 8;
        else if (vol >= 50) score += 5;
        else score += 2;

        // DTE efficiency (max 10 points) - sweet spot 20-45 DTE
        const dte = result.dte || 30;
        if (dte >= 20 && dte <= 45) score += 10;
        else if (dte >= 10 && dte <= 60) score += 7;
        else if (dte >= 5 && dte <= 90) score += 4;
        else score += 2;

        return Math.min(100, Math.max(0, Math.round(score)));
    }

    // ===== Payoff Diagram Generator =====

    /**
     * Generate payoff data points for charting
     * Returns array of {price, profit} objects
     */
    function generatePayoff(strategy, params) {
        const points = [];
        const { stockPrice } = params;
        const low = stockPrice * 0.7;
        const high = stockPrice * 1.3;
        const step = (high - low) / 100;

        for (let price = low; price <= high; price += step) {
            let profit = 0;

            switch (strategy) {
                case 'long_call':
                    profit = Math.max(0, price - params.strike) - params.premium;
                    break;
                case 'long_put':
                    profit = Math.max(0, params.strike - price) - params.premium;
                    break;
                case 'bull_call_spread':
                    profit = Math.max(0, price - params.longStrike) -
                             Math.max(0, price - params.shortStrike) -
                             (params.longPremium - params.shortPremium);
                    break;
                case 'bear_put_spread':
                    profit = Math.max(0, params.longStrike - price) -
                             Math.max(0, params.shortStrike - price) -
                             (params.longPremium - params.shortPremium);
                    break;
                case 'straddle':
                    profit = Math.max(0, price - params.strike) +
                             Math.max(0, params.strike - price) -
                             params.totalPremium;
                    break;
                case 'strangle':
                    profit = Math.max(0, price - params.callStrike) +
                             Math.max(0, params.putStrike - price) -
                             params.totalPremium;
                    break;
                case 'covered_call':
                    profit = (price - stockPrice) + params.premium -
                             Math.max(0, price - params.strike);
                    break;
                default:
                    profit = 0;
            }

            points.push({ price: parseFloat(price.toFixed(2)), profit: parseFloat((profit * 100).toFixed(2)) });
        }

        return points;
    }

    // ===== Helper: Find best options from chain =====

    /**
     * Find ATM (at-the-money) options from an option chain
     */
    function findATM(options, stockPrice) {
        if (!options || options.length === 0) return null;
        let closest = options[0];
        let minDiff = Math.abs((options[0].strike || 0) - stockPrice);

        for (const opt of options) {
            const diff = Math.abs((opt.strike || 0) - stockPrice);
            if (diff < minDiff) {
                minDiff = diff;
                closest = opt;
            }
        }
        return closest;
    }

    /**
     * Find OTM (out-of-the-money) options
     * For calls: strike > stockPrice
     * For puts: strike < stockPrice
     */
    function findOTM(options, stockPrice, type = 'call', otmPercent = 5) {
        const targetStrike = type === 'call'
            ? stockPrice * (1 + otmPercent / 100)
            : stockPrice * (1 - otmPercent / 100);

        return findClosestStrike(options, targetStrike);
    }

    function findClosestStrike(options, targetStrike) {
        if (!options || options.length === 0) return null;
        let closest = options[0];
        let minDiff = Math.abs((options[0].strike || 0) - targetStrike);

        for (const opt of options) {
            const diff = Math.abs((opt.strike || 0) - targetStrike);
            if (diff < minDiff) {
                minDiff = diff;
                closest = opt;
            }
        }
        return closest;
    }

    /**
     * Calculate DTE from expiration date
     */
    function calcDTE(expirationDate) {
        const now = new Date();
        const expiry = new Date(expirationDate);
        const diffMs = expiry - now;
        return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }

    /**
     * Calculate implied volatility rank (simplified)
     * Compares current IV to historical IV range
     */
    function calcIVRank(currentIV, historicalVol) {
        if (!historicalVol || historicalVol === 0) return 50; // Default to 50%
        // Simple IV rank: ratio of current IV to historical vol
        const ratio = currentIV / historicalVol;
        // Normalize to 0-100 range
        const rank = Math.min(100, Math.max(0, (ratio - 0.5) * 100));
        return Math.round(rank);
    }

    return {
        STRATEGIES,
        calcLongCall,
        calcLongPut,
        calcBullCallSpread,
        calcBearPutSpread,
        calcStraddle,
        calcStrangle,
        calcIronCondor,
        calcCoveredCall,
        scoreOpportunity,
        generatePayoff,
        findATM,
        findOTM,
        findClosestStrike,
        calcDTE,
        calcIVRank,
    };
})();
