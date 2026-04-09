/**
 * Scanner Engine - Core scanning logic
 * Scans stocks, fetches options chains, evaluates strategies, ranks by max gain
 * OptiMax Scanner
 */

const Scanner = (() => {
    let isScanning = false;
    let shouldStop = false;
    let scanResults = [];

    /**
     * Main scan function
     * @param {Object} filters - Scan filters
     * @param {Function} onProgress - Progress callback (scanned, total, currentTicker)
     * @param {Function} onResult - Called when a new result is found
     * @returns {Array} Sorted results
     */
    async function scan(filters, onProgress, onResult) {
        if (isScanning) {
            throw new Error('Scan already in progress');
        }

        isScanning = true;
        shouldStop = false;
        scanResults = [];

        const {
            market = 'US',
            strategy = 'all',
            minVolume = 100,
            maxDTE = 45,
            minGain = 50,
            maxRisk = 5000,
            usUniverse = 'sp500',
            sgxUniverse = 'sti',
            usMinDollarVolume = 50000000,   // 50M USD daily dollar volume
            sgxMinShareVolume = 1000000,     // 1M shares daily volume
            useScreener = true,              // Use live screener vs hardcoded
        } = filters;

        // ===== STEP 1: Discover stocks from entire market =====
        let tickers;

        if (useScreener) {
            // Dynamic: Screen full market by volume, then scan options
            if (onProgress) onProgress(0, 0, 'Screening market by volume...');

            try {
                const discovered = await API.discoverStocks(market, usMinDollarVolume, sgxMinShareVolume, 250);
                tickers = discovered.map(s => s.ticker);
                console.log(`Screener discovered ${tickers.length} stocks above volume threshold`);
            } catch (e) {
                console.warn('Screener failed, falling back to hardcoded universe:', e.message);
                tickers = getFallbackTickers(market, usUniverse, sgxUniverse);
            }
        } else {
            // Static: Use hardcoded lists
            tickers = getFallbackTickers(market, usUniverse, sgxUniverse);
        }

        // Remove duplicates
        tickers = [...new Set(tickers)];

        const total = tickers.length;
        let scanned = 0;

        // ===== PARALLEL SCANNING: process 3 tickers at once =====
        const PARALLEL = 3;

        for (let i = 0; i < tickers.length; i += PARALLEL) {
            if (shouldStop) break;

            const batch = tickers.slice(i, i + PARALLEL);

            if (onProgress) {
                onProgress(scanned, total, batch.join(', '));
            }

            // Fetch all tickers in this batch in parallel
            const batchResults = await Promise.allSettled(
                batch.map(ticker => scanSingleTicker(ticker, filters))
            );

            for (const result of batchResults) {
                scanned++;
                if (result.status === 'fulfilled' && result.value) {
                    for (const opp of result.value) {
                        scanResults.push(opp);
                        if (onResult) onResult(opp);
                    }
                }
            }
        }

        // Sort by score (descending)
        scanResults.sort((a, b) => b.score - a.score);

        isScanning = false;
        return scanResults;
    }

    /**
     * Scan a single ticker - fetches options chain and evaluates strategies
     * Skips the slow historical volatility call - uses IV from options chain instead
     */
    async function scanSingleTicker(ticker, filters) {
        const {
            strategy = 'all',
            minVolume = 100,
            maxDTE = 45,
            minGain = 50,
            maxRisk = 5000,
        } = filters;

        // Fetch options chain (single API call per ticker)
        const chain = await API.getOptionsChain(ticker);

        if (!chain || !chain.price || chain.price <= 0) return [];

        const stockPrice = chain.price;
        const mkt = MarketData.getMarket(ticker);
        const calls = chain.calls || [];
        const puts = chain.puts || [];

        if (calls.length === 0 && puts.length === 0) return [];

        // Use average IV from the options chain instead of slow historical API call
        let historicalVol = 0.3;
        const allIVs = [...calls, ...puts]
            .map(o => o.impliedVolatility)
            .filter(iv => iv && iv > 0);
        if (allIVs.length > 0) {
            historicalVol = allIVs.reduce((a, b) => a + b, 0) / allIVs.length;
        }

        const allOptions = { calls, puts };

        return evaluateStrategies(
            ticker, stockPrice, allOptions, historicalVol,
            strategy, minVolume, maxDTE, minGain, maxRisk, mkt
        );
    }

    /**
     * Evaluate all relevant strategies for a ticker
     */
    function evaluateStrategies(ticker, stockPrice, options, historicalVol,
                                 strategyFilter, minVolume, maxDTE, minGain, maxRisk, market) {
        const results = [];
        const { calls, puts } = options;

        // Find key options
        const atmCall = OptionsCalc.findATM(calls, stockPrice);
        const atmPut = OptionsCalc.findATM(puts, stockPrice);
        const otmCall5 = OptionsCalc.findOTM(calls, stockPrice, 'call', 5);
        const otmCall10 = OptionsCalc.findOTM(calls, stockPrice, 'call', 10);
        const otmPut5 = OptionsCalc.findOTM(puts, stockPrice, 'put', 5);
        const otmPut10 = OptionsCalc.findOTM(puts, stockPrice, 'put', 10);

        // Helper to check filters
        function passesFilter(result, volume, dte) {
            if (dte > maxDTE) return false;
            if (volume < minVolume) return false;
            if (result.maxGainPercent < minGain) return false;
            if (result.maxLoss > maxRisk) return false;
            return true;
        }

        // Helper to extract option data
        function getOptData(opt) {
            if (!opt) return null;
            return {
                strike: opt.strike,
                premium: opt.lastPrice || opt.ask || 0,
                bid: opt.bid || 0,
                ask: opt.ask || 0,
                volume: opt.volume || 0,
                openInterest: opt.openInterest || 0,
                iv: opt.impliedVolatility || 0,
                expiry: opt.expiration || '',
                dte: OptionsCalc.calcDTE(opt.expiration ? new Date(opt.expiration * 1000) : new Date()),
            };
        }

        // Calculate DTE from expiration timestamp
        function getDTE(opt) {
            if (!opt) return 999;
            if (opt.expiration) {
                return OptionsCalc.calcDTE(new Date(opt.expiration * 1000));
            }
            return 30; // Default
        }

        // ===== Long Call =====
        if (strategyFilter === 'all' || strategyFilter === 'long_call') {
            for (const call of calls) {
                const data = getOptData(call);
                if (!data || data.premium <= 0 || data.strike <= 0) continue;
                const dte = getDTE(call);
                if (dte > maxDTE || dte < 1) continue;

                const result = OptionsCalc.calcLongCall(stockPrice, data.strike, data.premium, dte);
                if (!passesFilter(result, data.volume, dte)) continue;

                const ivRank = OptionsCalc.calcIVRank(data.iv, historicalVol);
                const score = OptionsCalc.scoreOpportunity(result, ivRank, data.volume, data.openInterest);

                results.push({
                    ...result,
                    ticker,
                    market,
                    stockPrice,
                    expiry: formatExpiry(call.expiration),
                    iv: data.iv,
                    ivRank,
                    volume: data.volume,
                    openInterest: data.openInterest,
                    bid: data.bid,
                    ask: data.ask,
                    score,
                    currency: MarketData.getCurrency(market),
                });
            }
        }

        // ===== Long Put =====
        if (strategyFilter === 'all' || strategyFilter === 'long_put') {
            for (const put of puts) {
                const data = getOptData(put);
                if (!data || data.premium <= 0 || data.strike <= 0) continue;
                const dte = getDTE(put);
                if (dte > maxDTE || dte < 1) continue;

                const result = OptionsCalc.calcLongPut(stockPrice, data.strike, data.premium, dte);
                if (!passesFilter(result, data.volume, dte)) continue;

                const ivRank = OptionsCalc.calcIVRank(data.iv, historicalVol);
                const score = OptionsCalc.scoreOpportunity(result, ivRank, data.volume, data.openInterest);

                results.push({
                    ...result,
                    ticker,
                    market,
                    stockPrice,
                    expiry: formatExpiry(put.expiration),
                    iv: data.iv,
                    ivRank,
                    volume: data.volume,
                    openInterest: data.openInterest,
                    bid: data.bid,
                    ask: data.ask,
                    score,
                    currency: MarketData.getCurrency(market),
                });
            }
        }

        // ===== Bull Call Spread =====
        if (strategyFilter === 'all' || strategyFilter === 'bull_call_spread') {
            if (atmCall && otmCall5) {
                const longData = getOptData(atmCall);
                const shortData = getOptData(otmCall5);
                if (longData && shortData && longData.premium > 0 && shortData.premium > 0 &&
                    longData.strike < shortData.strike) {
                    const dte = getDTE(atmCall);
                    if (dte <= maxDTE && dte >= 1) {
                        const result = OptionsCalc.calcBullCallSpread(
                            stockPrice, longData.strike, shortData.strike,
                            longData.premium, shortData.premium, dte
                        );
                        const avgVol = Math.floor((longData.volume + shortData.volume) / 2);
                        if (passesFilter(result, avgVol, dte)) {
                            const ivRank = OptionsCalc.calcIVRank(longData.iv, historicalVol);
                            const score = OptionsCalc.scoreOpportunity(result, ivRank, avgVol, longData.openInterest);

                            results.push({
                                ...result,
                                ticker,
                                market,
                                stockPrice,
                                expiry: formatExpiry(atmCall.expiration),
                                iv: longData.iv,
                                ivRank,
                                volume: avgVol,
                                openInterest: longData.openInterest,
                                score,
                                currency: MarketData.getCurrency(market),
                            });
                        }
                    }
                }
            }
        }

        // ===== Bear Put Spread =====
        if (strategyFilter === 'all' || strategyFilter === 'bear_put_spread') {
            if (atmPut && otmPut5) {
                const longData = getOptData(atmPut);
                const shortData = getOptData(otmPut5);
                if (longData && shortData && longData.premium > 0 && shortData.premium > 0 &&
                    longData.strike > shortData.strike) {
                    const dte = getDTE(atmPut);
                    if (dte <= maxDTE && dte >= 1) {
                        const result = OptionsCalc.calcBearPutSpread(
                            stockPrice, longData.strike, shortData.strike,
                            longData.premium, shortData.premium, dte
                        );
                        const avgVol = Math.floor((longData.volume + shortData.volume) / 2);
                        if (passesFilter(result, avgVol, dte)) {
                            const ivRank = OptionsCalc.calcIVRank(longData.iv, historicalVol);
                            const score = OptionsCalc.scoreOpportunity(result, ivRank, avgVol, longData.openInterest);

                            results.push({
                                ...result,
                                ticker,
                                market,
                                stockPrice,
                                expiry: formatExpiry(atmPut.expiration),
                                iv: longData.iv,
                                ivRank,
                                volume: avgVol,
                                openInterest: longData.openInterest,
                                score,
                                currency: MarketData.getCurrency(market),
                            });
                        }
                    }
                }
            }
        }

        // ===== Long Straddle =====
        if (strategyFilter === 'all' || strategyFilter === 'straddle') {
            if (atmCall && atmPut && Math.abs(atmCall.strike - atmPut.strike) < stockPrice * 0.02) {
                const callData = getOptData(atmCall);
                const putData = getOptData(atmPut);
                if (callData && putData && callData.premium > 0 && putData.premium > 0) {
                    const dte = getDTE(atmCall);
                    if (dte <= maxDTE && dte >= 1) {
                        const result = OptionsCalc.calcStraddle(
                            stockPrice, callData.strike, callData.premium, putData.premium, dte
                        );
                        const avgVol = Math.floor((callData.volume + putData.volume) / 2);
                        if (passesFilter(result, avgVol, dte)) {
                            const ivRank = OptionsCalc.calcIVRank(callData.iv, historicalVol);
                            const score = OptionsCalc.scoreOpportunity(result, ivRank, avgVol, callData.openInterest);

                            results.push({
                                ...result,
                                ticker,
                                market,
                                stockPrice,
                                expiry: formatExpiry(atmCall.expiration),
                                iv: callData.iv,
                                ivRank,
                                volume: avgVol,
                                openInterest: callData.openInterest,
                                score,
                                currency: MarketData.getCurrency(market),
                            });
                        }
                    }
                }
            }
        }

        // ===== Long Strangle =====
        if (strategyFilter === 'all' || strategyFilter === 'strangle') {
            if (otmCall5 && otmPut5) {
                const callData = getOptData(otmCall5);
                const putData = getOptData(otmPut5);
                if (callData && putData && callData.premium > 0 && putData.premium > 0) {
                    const dte = getDTE(otmCall5);
                    if (dte <= maxDTE && dte >= 1) {
                        const result = OptionsCalc.calcStrangle(
                            stockPrice, callData.strike, putData.strike,
                            callData.premium, putData.premium, dte
                        );
                        const avgVol = Math.floor((callData.volume + putData.volume) / 2);
                        if (passesFilter(result, avgVol, dte)) {
                            const ivRank = OptionsCalc.calcIVRank(callData.iv, historicalVol);
                            const score = OptionsCalc.scoreOpportunity(result, ivRank, avgVol, callData.openInterest);

                            results.push({
                                ...result,
                                ticker,
                                market,
                                stockPrice,
                                expiry: formatExpiry(otmCall5.expiration),
                                iv: callData.iv,
                                ivRank,
                                volume: avgVol,
                                openInterest: callData.openInterest,
                                score,
                                currency: MarketData.getCurrency(market),
                            });
                        }
                    }
                }
            }
        }

        // ===== Iron Condor =====
        if (strategyFilter === 'all' || strategyFilter === 'iron_condor') {
            if (otmPut10 && otmPut5 && otmCall5 && otmCall10) {
                const putBuyData = getOptData(otmPut10);
                const putSellData = getOptData(otmPut5);
                const callSellData = getOptData(otmCall5);
                const callBuyData = getOptData(otmCall10);

                if (putBuyData && putSellData && callSellData && callBuyData &&
                    putBuyData.premium >= 0 && putSellData.premium > 0 &&
                    callSellData.premium > 0 && callBuyData.premium >= 0) {
                    const dte = getDTE(otmCall5);
                    if (dte <= maxDTE && dte >= 1) {
                        const result = OptionsCalc.calcIronCondor(
                            stockPrice,
                            putBuyData.strike, putSellData.strike,
                            callSellData.strike, callBuyData.strike,
                            putBuyData.premium, putSellData.premium,
                            callSellData.premium, callBuyData.premium,
                            dte
                        );
                        const avgVol = Math.floor((putSellData.volume + callSellData.volume) / 2);
                        if (result.maxGainPercent >= 0 && passesFilter(result, avgVol, dte)) {
                            const ivRank = OptionsCalc.calcIVRank(callSellData.iv, historicalVol);
                            const score = OptionsCalc.scoreOpportunity(result, ivRank, avgVol, callSellData.openInterest);

                            results.push({
                                ...result,
                                ticker,
                                market,
                                stockPrice,
                                expiry: formatExpiry(otmCall5.expiration),
                                iv: callSellData.iv,
                                ivRank,
                                volume: avgVol,
                                openInterest: callSellData.openInterest,
                                score,
                                currency: MarketData.getCurrency(market),
                            });
                        }
                    }
                }
            }
        }

        // ===== Covered Call =====
        if (strategyFilter === 'all' || strategyFilter === 'covered_call') {
            if (otmCall5) {
                const data = getOptData(otmCall5);
                if (data && data.premium > 0) {
                    const dte = getDTE(otmCall5);
                    if (dte <= maxDTE && dte >= 1) {
                        const result = OptionsCalc.calcCoveredCall(stockPrice, data.strike, data.premium, dte);
                        if (passesFilter(result, data.volume, dte)) {
                            const ivRank = OptionsCalc.calcIVRank(data.iv, historicalVol);
                            const score = OptionsCalc.scoreOpportunity(result, ivRank, data.volume, data.openInterest);

                            results.push({
                                ...result,
                                ticker,
                                market,
                                stockPrice,
                                expiry: formatExpiry(otmCall5.expiration),
                                iv: data.iv,
                                ivRank,
                                volume: data.volume,
                                openInterest: data.openInterest,
                                score,
                                currency: MarketData.getCurrency(market),
                            });
                        }
                    }
                }
            }
        }

        return results;
    }

    /**
     * Fallback to hardcoded ticker lists when screener is unavailable
     */
    function getFallbackTickers(market, usUniverse, sgxUniverse) {
        if (market === 'US') {
            return MarketData.getTickers('US', usUniverse);
        } else if (market === 'SGX') {
            return MarketData.getTickers('SGX', sgxUniverse);
        } else {
            return MarketData.getTickers('ALL', usUniverse);
        }
    }

    /**
     * Format expiry timestamp to readable date
     */
    function formatExpiry(timestamp) {
        if (!timestamp) return '--';
        const date = new Date(timestamp * 1000);
        return date.toISOString().split('T')[0];
    }

    /**
     * Stop scanning
     */
    function stop() {
        shouldStop = true;
        isScanning = false;
    }

    /**
     * Get scanning state
     */
    function getState() {
        return { isScanning, resultCount: scanResults.length };
    }

    /**
     * Get results
     */
    function getResults() {
        return [...scanResults];
    }

    /**
     * Sort results by field
     */
    function sortResults(field, ascending = false) {
        scanResults.sort((a, b) => {
            let valA = a[field];
            let valB = b[field];

            // Handle string comparison
            if (typeof valA === 'string' && typeof valB === 'string') {
                return ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }

            // Handle 'Unlimited' as very large number
            if (valA === 'Unlimited') valA = Infinity;
            if (valB === 'Unlimited') valB = Infinity;

            valA = parseFloat(valA) || 0;
            valB = parseFloat(valB) || 0;

            return ascending ? valA - valB : valB - valA;
        });

        return scanResults;
    }

    /**
     * Export results to CSV
     */
    function exportCSV() {
        if (scanResults.length === 0) return '';

        const headers = [
            'Rank', 'Ticker', 'Market', 'Stock Price', 'Strategy', 'Strike(s)',
            'Expiry', 'DTE', 'Premium', 'Max Gain %', 'Max Loss $',
            'Breakeven', 'IV', 'IV Rank', 'Volume', 'Score'
        ];

        const rows = scanResults.map((r, i) => [
            i + 1,
            r.ticker,
            r.market,
            r.stockPrice?.toFixed(2),
            r.strategyName,
            r.strikes || r.strike,
            r.expiry,
            r.dte,
            r.premium?.toFixed(2),
            r.maxGainPercent?.toFixed(1),
            typeof r.maxLoss === 'number' ? r.maxLoss.toFixed(2) : r.maxLoss,
            typeof r.breakeven === 'number' ? r.breakeven.toFixed(2) : r.breakeven,
            (r.iv * 100)?.toFixed(1) + '%',
            r.ivRank,
            r.volume,
            r.score,
        ]);

        const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
        return csvContent;
    }

    return {
        scan,
        stop,
        getState,
        getResults,
        sortResults,
        exportCSV,
    };
})();
