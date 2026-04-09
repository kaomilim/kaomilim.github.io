/**
 * API Integration Layer - Hardened Yahoo Finance with multi-proxy fallback
 * Returns REAL market data for free, no API key required
 * OptiMax Scanner
 */

const API = (() => {
    // Configuration
    let config = {
        provider: 'yahoo',
        apiKey: '',
        corsProxy: 'auto',  // 'auto' tries all proxies in order
        requestDelay: 300,  // Lower delay since we batch 3 at a time
        batchSize: 3,
    };

    // ===== CORS Proxy Chain (tried in order until one works) =====
    const PROXY_CHAIN = [
        { name: 'corsproxy',   build: (u) => `https://corsproxy.io/?${encodeURIComponent(u)}` },
        { name: 'allorigins',  build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
        { name: 'corsanywhere', build: (u) => `https://cors-anywhere.herokuapp.com/${u}` },
        { name: 'thingproxy',  build: (u) => `https://thingproxy.freeboard.io/fetch/${u}` },
    ];

    let workingProxyIdx = 0; // Start with first proxy
    let proxyFailCounts = {};

    function proxyUrl(url) {
        if (config.corsProxy === 'none') return url;
        if (config.corsProxy !== 'auto') {
            const found = PROXY_CHAIN.find(p => p.name === config.corsProxy);
            return found ? found.build(url) : url;
        }
        // Auto: use the current best proxy
        return PROXY_CHAIN[workingProxyIdx].build(url);
    }

    function rotateProxy() {
        const prevName = PROXY_CHAIN[workingProxyIdx].name;
        proxyFailCounts[prevName] = (proxyFailCounts[prevName] || 0) + 1;
        workingProxyIdx = (workingProxyIdx + 1) % PROXY_CHAIN.length;
        const newName = PROXY_CHAIN[workingProxyIdx].name;
        console.log(`Proxy ${prevName} failed, switching to ${newName}`);
        return newName;
    }

    // Load/save config
    function loadConfig() {
        try {
            const saved = localStorage.getItem('optimax_config');
            if (saved) Object.assign(config, JSON.parse(saved));
        } catch (e) {}
    }
    function saveConfig() {
        try { localStorage.setItem('optimax_config', JSON.stringify(config)); } catch (e) {}
    }
    function setConfig(key, value) { config[key] = value; saveConfig(); }
    function getConfig() { return { ...config }; }

    // ===== Rate Limiter =====
    let lastRequestTime = 0;
    async function rateLimitedFetch(url, options = {}) {
        const now = Date.now();
        const elapsed = now - lastRequestTime;
        if (elapsed < config.requestDelay) {
            await new Promise(r => setTimeout(r, config.requestDelay - elapsed));
        }
        lastRequestTime = Date.now();

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response;
        } catch (err) {
            clearTimeout(timeout);
            throw err;
        }
    }

    // ===== Fetch with Auto-Retry across proxies =====
    async function resilientFetch(rawUrl, options = {}) {
        const maxRetries = PROXY_CHAIN.length;
        let lastError;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const proxied = proxyUrl(rawUrl);
            try {
                const resp = await rateLimitedFetch(proxied, options);
                return resp;
            } catch (err) {
                lastError = err;
                console.warn(`Fetch failed (proxy ${PROXY_CHAIN[workingProxyIdx].name}): ${err.message}`);
                if (config.corsProxy === 'auto') {
                    rotateProxy();
                } else {
                    break; // Fixed proxy, don't rotate
                }
            }
        }
        throw lastError;
    }

    // ===== Yahoo Finance API (Hardened) =====
    const Yahoo = {
        // Base URLs - Yahoo has multiple endpoints, try both
        bases: ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'],
        baseIdx: 0,

        getBase() {
            return this.bases[this.baseIdx];
        },
        swapBase() {
            this.baseIdx = (this.baseIdx + 1) % this.bases.length;
        },

        // Get stock quote
        async getQuote(ticker) {
            const url = `${this.getBase()}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
            let resp;
            try {
                resp = await resilientFetch(url);
            } catch (e) {
                this.swapBase();
                resp = await resilientFetch(`${this.getBase()}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`);
            }
            const data = await resp.json();

            if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
                throw new Error(`No data for ${ticker}`);
            }

            const result = data.chart.result[0];
            const meta = result.meta;
            const quotes = result.indicators.quote[0];
            const closes = (quotes.close || []).filter(c => c !== null);
            const currentPrice = meta.regularMarketPrice || closes[closes.length - 1];
            const previousClose = meta.chartPreviousClose || meta.previousClose || closes[closes.length - 2];

            return {
                ticker,
                price: currentPrice,
                previousClose,
                change: currentPrice - previousClose,
                changePercent: ((currentPrice - previousClose) / previousClose) * 100,
                volume: meta.regularMarketVolume || 0,
                currency: meta.currency || 'USD',
                exchange: meta.exchangeName || '',
                marketState: meta.marketState || 'CLOSED',
            };
        },

        // Get options chain (returns ALL expirations list + nearest expiry's full chain)
        async getOptionsChain(ticker) {
            const url = `${this.getBase()}/v7/finance/options/${encodeURIComponent(ticker)}`;
            let resp;
            try {
                resp = await resilientFetch(url);
            } catch (e) {
                this.swapBase();
                resp = await resilientFetch(`${this.getBase()}/v7/finance/options/${encodeURIComponent(ticker)}`);
            }
            const data = await resp.json();

            if (!data.optionChain || !data.optionChain.result || data.optionChain.result.length === 0) {
                throw new Error(`No options for ${ticker}`);
            }

            const result = data.optionChain.result[0];
            const quote = result.quote;
            const expirations = result.expirationDates || [];
            const options = result.options || [];

            return {
                ticker,
                price: quote.regularMarketPrice,
                expirations: expirations.map(ts => new Date(ts * 1000)),
                expirationTimestamps: expirations,
                calls: options.length > 0 ? options[0].calls || [] : [],
                puts: options.length > 0 ? options[0].puts || [] : [],
                quote: {
                    price: quote.regularMarketPrice,
                    change: quote.regularMarketChange,
                    changePercent: quote.regularMarketChangePercent,
                    volume: quote.regularMarketVolume,
                    avgVolume: quote.averageDailyVolume3Month,
                    marketCap: quote.marketCap,
                    name: quote.shortName || quote.longName || ticker,
                    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
                    fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
                }
            };
        },

        // Get options for a SPECIFIC expiration (to scan multiple expiries)
        async getOptionsForExpiry(ticker, expiryTimestamp) {
            const url = `${this.getBase()}/v7/finance/options/${encodeURIComponent(ticker)}?date=${expiryTimestamp}`;
            const resp = await resilientFetch(url);
            const data = await resp.json();

            if (!data.optionChain || !data.optionChain.result || data.optionChain.result.length === 0) {
                throw new Error(`No options for ${ticker} at ${expiryTimestamp}`);
            }

            const result = data.optionChain.result[0];
            const options = result.options || [];
            return {
                calls: options.length > 0 ? options[0].calls || [] : [],
                puts: options.length > 0 ? options[0].puts || [] : [],
                expirationDate: new Date(expiryTimestamp * 1000)
            };
        },

        // Get historical price data (for HV calculation)
        async getHistoricalData(ticker, range = '3mo') {
            const url = `${this.getBase()}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
            const resp = await resilientFetch(url);
            const data = await resp.json();

            if (!data.chart || !data.chart.result) throw new Error(`No history for ${ticker}`);

            const result = data.chart.result[0];
            const quotes = result.indicators.quote[0];
            return {
                closes: (quotes.close || []).filter(c => c !== null),
                highs: (quotes.high || []).filter(h => h !== null),
                lows: (quotes.low || []).filter(l => l !== null),
                volumes: (quotes.volume || []).filter(v => v !== null),
                timestamps: result.timestamp || []
            };
        }
    };

    // ===== Unified API Interface =====
    async function getQuote(ticker) {
        return await Yahoo.getQuote(ticker);
    }

    async function getOptionsChain(ticker) {
        return await Yahoo.getOptionsChain(ticker);
    }

    async function getOptionsForExpiry(ticker, expiryTimestamp) {
        return await Yahoo.getOptionsForExpiry(ticker, expiryTimestamp);
    }

    async function getHistoricalData(ticker, range) {
        return await Yahoo.getHistoricalData(ticker, range);
    }

    // ===== Stock Discovery - Multiple strategies to find high-volume stocks =====

    /**
     * Strategy 1: Yahoo predefined screeners (GET, more reliable than POST)
     * Fetches most active stocks - these are the highest volume by definition
     */
    async function fetchYahooList(listId, count = 250) {
        const url = `${Yahoo.getBase()}/v1/finance/screener/predefined/saved?scrIds=${listId}&count=${count}`;
        const resp = await resilientFetch(url);
        const data = await resp.json();

        if (data.finance && data.finance.result && data.finance.result.length > 0) {
            return (data.finance.result[0].quotes || []).map(q => ({
                ticker: q.symbol,
                name: q.shortName || q.longName || q.symbol,
                price: q.regularMarketPrice || 0,
                volume: q.regularMarketVolume || 0,
                avgVolume: q.averageDailyVolume3Month || 0,
                marketCap: q.marketCap || 0,
            }));
        }
        throw new Error(`Yahoo list ${listId} returned no data`);
    }

    /**
     * Strategy 2: Yahoo trending tickers
     */
    async function fetchTrending(region = 'US', count = 50) {
        const url = `${Yahoo.getBase()}/v1/finance/trending/${region}?count=${count}`;
        const resp = await resilientFetch(url);
        const data = await resp.json();
        if (data.finance && data.finance.result && data.finance.result.length > 0) {
            return (data.finance.result[0].quotes || []).map(q => ({
                ticker: q.symbol,
                name: q.symbol,
                price: 0,
                volume: 0,
                avgVolume: 0,
            }));
        }
        return [];
    }

    /**
     * Full market discovery: tries multiple Yahoo endpoints to build the biggest stock list
     * Then filters by volume threshold
     */
    async function discoverStocks(market, usMinVolume = 50000000, sgxMinVolume = 1000000, maxResults = 250) {
        const allStocks = [];
        const seen = new Set();

        function addStocks(stocks) {
            for (const s of stocks) {
                if (!seen.has(s.ticker)) {
                    seen.add(s.ticker);
                    allStocks.push(s);
                }
            }
        }

        if (market === 'US' || market === 'ALL') {
            // Try multiple Yahoo screener lists to build comprehensive US universe
            const lists = ['most_actives', 'day_gainers', 'day_losers', 'undervalued_large_caps', 'growth_technology_stocks'];
            for (const listId of lists) {
                try {
                    const stocks = await fetchYahooList(listId, maxResults);
                    addStocks(stocks);
                    console.log(`${listId}: +${stocks.length} stocks (total: ${allStocks.length})`);
                } catch (e) {
                    console.warn(`List ${listId} failed:`, e.message);
                }
            }

            // Also try trending
            try {
                addStocks(await fetchTrending('US', 50));
            } catch (e) {}

            // If all live endpoints failed, fall back to hardcoded
            const usCount = [...seen].filter(t => !t.endsWith('.SI')).length;
            if (usCount < 50) {
                console.warn(`Only ${usCount} US stocks from live data, adding preset list`);
                const fallback = MarketData.getTickers('US', 'sp500');
                addStocks(fallback.map(t => ({ ticker: t, name: t, price: 0, volume: 0, avgVolume: 0 })));
            }
        }

        if (market === 'SGX' || market === 'ALL') {
            // Try trending for SGX
            try {
                addStocks(await fetchTrending('SG', 50));
            } catch (e) {}

            // SGX always include hardcoded STI stocks (small list, options limited anyway)
            const fallback = MarketData.getTickers('SGX', 'all_sgx');
            addStocks(fallback.map(t => ({ ticker: t, name: t, price: 0, volume: 0, avgVolume: 0 })));
        }

        console.log(`Discovery complete: ${allStocks.length} total stocks`);
        return allStocks;
    }

    // ===== Batch Operations =====
    async function batchGetQuotes(tickers, onProgress) {
        const results = [], errors = [];
        for (let i = 0; i < tickers.length; i += config.batchSize) {
            const batch = tickers.slice(i, i + config.batchSize);
            const batchResults = await Promise.allSettled(batch.map(t => getQuote(t)));
            batchResults.forEach((r, j) => {
                if (r.status === 'fulfilled') results.push(r.value);
                else errors.push({ ticker: batch[j], error: r.reason.message });
            });
            if (onProgress) onProgress(Math.min(i + config.batchSize, tickers.length), tickers.length);
        }
        return { results, errors };
    }

    async function batchGetOptions(tickers, onProgress) {
        const results = [], errors = [];
        for (let i = 0; i < tickers.length; i++) {
            try {
                results.push(await getOptionsChain(tickers[i]));
            } catch (err) {
                errors.push({ ticker: tickers[i], error: err.message });
            }
            if (onProgress) onProgress(i + 1, tickers.length);
        }
        return { results, errors };
    }

    // Historical Volatility calculation
    function calcHistoricalVolatility(closes) {
        if (closes.length < 10) return 0;
        const returns = [];
        for (let i = 1; i < closes.length; i++) {
            if (closes[i - 1] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
        }
        if (returns.length < 5) return 0;
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
        return Math.sqrt(variance) * Math.sqrt(252);
    }

    // ===== Connection Test =====
    async function testConnection() {
        const results = [];
        for (let i = 0; i < PROXY_CHAIN.length; i++) {
            const proxy = PROXY_CHAIN[i];
            const url = proxy.build('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d');
            try {
                const start = Date.now();
                const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
                const elapsed = Date.now() - start;
                const data = await resp.json();
                const ok = data.chart && data.chart.result;
                results.push({ name: proxy.name, ok, latency: elapsed, price: ok ? data.chart.result[0].meta.regularMarketPrice : null });
            } catch (e) {
                results.push({ name: proxy.name, ok: false, error: e.message });
            }
        }

        // Set best proxy
        const best = results.find(r => r.ok);
        if (best) {
            workingProxyIdx = PROXY_CHAIN.findIndex(p => p.name === best.name);
            console.log(`Best proxy: ${best.name} (${best.latency}ms, AAPL=$${best.price})`);
        }

        return results;
    }

    // Initialize
    loadConfig();

    return {
        getQuote,
        getOptionsChain,
        getOptionsForExpiry,
        getHistoricalData,
        batchGetQuotes,
        batchGetOptions,
        calcHistoricalVolatility,
        discoverStocks,
        fetchYahooList,
        testConnection,
        setConfig,
        getConfig,
        loadConfig,
        saveConfig,
    };
})();
