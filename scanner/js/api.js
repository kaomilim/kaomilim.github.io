/**
 * API Integration Layer - Fetches stock and options data
 * Supports Yahoo Finance (free), Polygon.io, and Finnhub
 * OptiMax Scanner
 */

const API = (() => {
    // Configuration
    let config = {
        provider: 'yahoo',
        apiKey: '',
        corsProxy: 'corsproxy',
        requestDelay: 500,
        batchSize: 10,
    };

    // Load saved config
    function loadConfig() {
        try {
            const saved = localStorage.getItem('optimax_config');
            if (saved) {
                Object.assign(config, JSON.parse(saved));
            }
        } catch (e) {
            console.warn('Failed to load config:', e);
        }
    }

    function saveConfig() {
        try {
            localStorage.setItem('optimax_config', JSON.stringify(config));
        } catch (e) {
            console.warn('Failed to save config:', e);
        }
    }

    function setConfig(key, value) {
        config[key] = value;
        saveConfig();
    }

    function getConfig() {
        return { ...config };
    }

    // CORS proxy URL builder
    function proxyUrl(url) {
        switch (config.corsProxy) {
            case 'corsproxy':
                return `https://corsproxy.io/?${encodeURIComponent(url)}`;
            case 'allorigins':
                return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            case 'none':
            default:
                return url;
        }
    }

    // Rate limiter
    let lastRequestTime = 0;
    async function rateLimitedFetch(url, options = {}) {
        const now = Date.now();
        const elapsed = now - lastRequestTime;
        if (elapsed < config.requestDelay) {
            await new Promise(r => setTimeout(r, config.requestDelay - elapsed));
        }
        lastRequestTime = Date.now();

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response;
        } catch (err) {
            clearTimeout(timeout);
            throw err;
        }
    }

    // ===== Yahoo Finance API =====
    const Yahoo = {
        // Get stock quote
        async getQuote(ticker) {
            const url = proxyUrl(
                `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`
            );
            const resp = await rateLimitedFetch(url);
            const data = await resp.json();

            if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
                throw new Error(`No data for ${ticker}`);
            }

            const result = data.chart.result[0];
            const meta = result.meta;
            const quotes = result.indicators.quote[0];
            const closes = quotes.close.filter(c => c !== null);
            const currentPrice = meta.regularMarketPrice || closes[closes.length - 1];
            const previousClose = meta.chartPreviousClose || meta.previousClose || closes[closes.length - 2];

            return {
                ticker: ticker,
                price: currentPrice,
                previousClose: previousClose,
                change: currentPrice - previousClose,
                changePercent: ((currentPrice - previousClose) / previousClose) * 100,
                volume: meta.regularMarketVolume || 0,
                currency: meta.currency || 'USD',
                exchange: meta.exchangeName || '',
                marketState: meta.marketState || 'CLOSED',
            };
        },

        // Get options chain
        async getOptionsChain(ticker) {
            const url = proxyUrl(
                `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`
            );
            const resp = await rateLimitedFetch(url);
            const data = await resp.json();

            if (!data.optionChain || !data.optionChain.result || data.optionChain.result.length === 0) {
                throw new Error(`No options data for ${ticker}`);
            }

            const result = data.optionChain.result[0];
            const quote = result.quote;
            const expirations = result.expirationDates || [];
            const options = result.options || [];

            return {
                ticker: ticker,
                price: quote.regularMarketPrice,
                expirations: expirations.map(ts => new Date(ts * 1000)),
                calls: options.length > 0 ? options[0].calls || [] : [],
                puts: options.length > 0 ? options[0].puts || [] : [],
                quote: quote
            };
        },

        // Get options for specific expiration
        async getOptionsForExpiry(ticker, expiryTimestamp) {
            const url = proxyUrl(
                `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}?date=${expiryTimestamp}`
            );
            const resp = await rateLimitedFetch(url);
            const data = await resp.json();

            if (!data.optionChain || !data.optionChain.result || data.optionChain.result.length === 0) {
                throw new Error(`No options data for ${ticker} at expiry ${expiryTimestamp}`);
            }

            const result = data.optionChain.result[0];
            const options = result.options || [];

            return {
                calls: options.length > 0 ? options[0].calls || [] : [],
                puts: options.length > 0 ? options[0].puts || [] : [],
                expirationDate: new Date(expiryTimestamp * 1000)
            };
        },

        // Get historical volatility
        async getHistoricalData(ticker, range = '3mo') {
            const url = proxyUrl(
                `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`
            );
            const resp = await rateLimitedFetch(url);
            const data = await resp.json();

            if (!data.chart || !data.chart.result) {
                throw new Error(`No historical data for ${ticker}`);
            }

            const result = data.chart.result[0];
            const quotes = result.indicators.quote[0];
            return {
                closes: quotes.close.filter(c => c !== null),
                highs: quotes.high.filter(h => h !== null),
                lows: quotes.low.filter(l => l !== null),
                volumes: quotes.volume.filter(v => v !== null),
                timestamps: result.timestamp || []
            };
        }
    };

    // ===== Polygon.io API =====
    const Polygon = {
        baseUrl: 'https://api.polygon.io',

        async getQuote(ticker) {
            const url = `${this.baseUrl}/v2/aggs/ticker/${ticker}/prev?apiKey=${config.apiKey}`;
            const resp = await rateLimitedFetch(url);
            const data = await resp.json();

            if (!data.results || data.results.length === 0) {
                throw new Error(`No data for ${ticker}`);
            }

            const r = data.results[0];
            return {
                ticker: ticker,
                price: r.c,
                previousClose: r.o,
                change: r.c - r.o,
                changePercent: ((r.c - r.o) / r.o) * 100,
                volume: r.v,
                currency: 'USD',
            };
        },

        async getOptionsChain(ticker) {
            const url = `${this.baseUrl}/v3/reference/options/contracts?underlying_ticker=${ticker}&limit=250&apiKey=${config.apiKey}`;
            const resp = await rateLimitedFetch(url);
            const data = await resp.json();

            // Get current price
            const quote = await this.getQuote(ticker);

            const calls = [];
            const puts = [];
            const expirations = new Set();

            if (data.results) {
                for (const contract of data.results) {
                    const option = {
                        contractSymbol: contract.ticker,
                        strike: contract.strike_price,
                        expiration: contract.expiration_date,
                        type: contract.contract_type,
                    };
                    expirations.add(contract.expiration_date);
                    if (contract.contract_type === 'call') {
                        calls.push(option);
                    } else {
                        puts.push(option);
                    }
                }
            }

            return {
                ticker: ticker,
                price: quote.price,
                expirations: [...expirations].map(d => new Date(d)),
                calls: calls,
                puts: puts,
                quote: quote
            };
        }
    };

    // ===== Finnhub API =====
    const Finnhub = {
        baseUrl: 'https://finnhub.io/api/v1',

        async getQuote(ticker) {
            const url = `${this.baseUrl}/quote?symbol=${ticker}&token=${config.apiKey}`;
            const resp = await rateLimitedFetch(url);
            const data = await resp.json();

            return {
                ticker: ticker,
                price: data.c,
                previousClose: data.pc,
                change: data.d,
                changePercent: data.dp,
                volume: data.v || 0,
                currency: 'USD',
            };
        }
    };

    // ===== Unified API Interface =====
    async function getQuote(ticker) {
        switch (config.provider) {
            case 'polygon':
                return await Polygon.getQuote(ticker);
            case 'finnhub':
                return await Finnhub.getQuote(ticker);
            case 'yahoo':
            default:
                return await Yahoo.getQuote(ticker);
        }
    }

    async function getOptionsChain(ticker) {
        switch (config.provider) {
            case 'polygon':
                return await Polygon.getOptionsChain(ticker);
            case 'yahoo':
            default:
                return await Yahoo.getOptionsChain(ticker);
        }
    }

    async function getOptionsForExpiry(ticker, expiryTimestamp) {
        return await Yahoo.getOptionsForExpiry(ticker, expiryTimestamp);
    }

    async function getHistoricalData(ticker, range) {
        return await Yahoo.getHistoricalData(ticker, range);
    }

    // ===== Stock Screener - Fetch full market filtered by volume =====

    /**
     * Screen entire US market for stocks with average volume >= minVolume
     * Uses Yahoo Finance screener POST endpoint
     * @param {number} minVolume - Minimum average daily dollar volume (e.g., 50000000 for 50M)
     * @param {number} maxResults - Max tickers to return (default 250)
     * @returns {Array} Array of {ticker, price, volume, marketCap, name}
     */
    async function screenUSByVolume(minVolume = 50000000, maxResults = 250) {
        // Yahoo Finance screener query
        const body = JSON.stringify({
            size: maxResults,
            offset: 0,
            sortField: 'avgdailyvol3m',
            sortType: 'DESC',
            quoteType: 'EQUITY',
            query: {
                operator: 'AND',
                operands: [
                    { operator: 'or', operands: [
                        { operator: 'EQ', operands: ['region', 'us'] }
                    ]},
                    { operator: 'GT', operands: ['avgdailyvol3m', minVolume / 100] }, // volume in shares
                    { operator: 'GT', operands: ['intradaymarketcap', 1000000000] }, // min 1B market cap
                ]
            }
        });

        const url = proxyUrl('https://query2.finance.yahoo.com/v1/finance/screener?formatted=false&lang=en-US&region=US');
        const resp = await rateLimitedFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        });
        const data = await resp.json();

        if (!data.finance || !data.finance.result || data.finance.result.length === 0) {
            throw new Error('Screener returned no results');
        }

        const quotes = data.finance.result[0].quotes || [];
        return quotes.map(q => ({
            ticker: q.symbol,
            name: q.shortName || q.longName || q.symbol,
            price: q.regularMarketPrice || 0,
            volume: q.regularMarketVolume || 0,
            avgVolume: q.averageDailyVolume3Month || 0,
            marketCap: q.marketCap || 0,
            exchange: q.exchange || '',
        }));
    }

    /**
     * Screen SGX market for stocks with volume >= minVolume
     * Uses Yahoo Finance screener for Singapore exchange
     * @param {number} minVolume - Minimum daily volume in shares (e.g., 1000000 for 1M)
     * @param {number} maxResults - Max tickers to return
     */
    async function screenSGXByVolume(minVolume = 1000000, maxResults = 100) {
        const body = JSON.stringify({
            size: maxResults,
            offset: 0,
            sortField: 'avgdailyvol3m',
            sortType: 'DESC',
            quoteType: 'EQUITY',
            query: {
                operator: 'AND',
                operands: [
                    { operator: 'or', operands: [
                        { operator: 'EQ', operands: ['exchange', 'SES'] }
                    ]},
                    { operator: 'GT', operands: ['avgdailyvol3m', minVolume] },
                ]
            }
        });

        const url = proxyUrl('https://query2.finance.yahoo.com/v1/finance/screener?formatted=false&lang=en-US&region=SG');
        const resp = await rateLimitedFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        });
        const data = await resp.json();

        if (!data.finance || !data.finance.result || data.finance.result.length === 0) {
            throw new Error('SGX screener returned no results');
        }

        const quotes = data.finance.result[0].quotes || [];
        return quotes.map(q => ({
            ticker: q.symbol,
            name: q.shortName || q.longName || q.symbol,
            price: q.regularMarketPrice || 0,
            volume: q.regularMarketVolume || 0,
            avgVolume: q.averageDailyVolume3Month || 0,
            marketCap: q.marketCap || 0,
            exchange: q.exchange || 'SES',
        }));
    }

    /**
     * Alternative: Use Yahoo Finance's most-active endpoint
     * Falls back to this if screener POST is blocked
     */
    async function getMostActive(market = 'US', count = 100) {
        let listName;
        if (market === 'SGX' || market === 'SG') {
            listName = 'day_gainers'; // Fallback - SGX specific lists limited
        } else {
            listName = 'most_actives';
        }

        const url = proxyUrl(
            `https://query1.finance.yahoo.com/v1/finance/trending/${market === 'SGX' ? 'SG' : 'US'}?count=${count}`
        );

        try {
            const resp = await rateLimitedFetch(url);
            const data = await resp.json();
            if (data.finance && data.finance.result) {
                const quotes = data.finance.result[0]?.quotes || [];
                return quotes.map(q => ({
                    ticker: q.symbol,
                    name: q.symbol,
                    price: 0,
                    volume: 0,
                    avgVolume: 0,
                }));
            }
        } catch (e) {
            console.warn('Trending endpoint failed:', e.message);
        }
        return [];
    }

    /**
     * Full market scan: Screen → Filter → Return ticker list
     * This is the main entry point for dynamic stock discovery
     */
    async function discoverStocks(market, usMinVolume = 50000000, sgxMinVolume = 1000000, maxResults = 250) {
        const results = [];

        if (market === 'US' || market === 'ALL') {
            try {
                const usStocks = await screenUSByVolume(usMinVolume, maxResults);
                results.push(...usStocks);
                console.log(`Screener found ${usStocks.length} US stocks with volume > ${(usMinVolume/1e6).toFixed(0)}M`);
            } catch (e) {
                console.warn('US screener failed, falling back to hardcoded list:', e.message);
                // Fallback to hardcoded list
                const fallbackTickers = MarketData.getTickers('US', 'sp500');
                results.push(...fallbackTickers.map(t => ({ ticker: t, name: t, price: 0, volume: 0, avgVolume: 0 })));
            }
        }

        if (market === 'SGX' || market === 'ALL') {
            try {
                const sgxStocks = await screenSGXByVolume(sgxMinVolume, maxResults);
                results.push(...sgxStocks);
                console.log(`Screener found ${sgxStocks.length} SGX stocks with volume > ${(sgxMinVolume/1e6).toFixed(1)}M`);
            } catch (e) {
                console.warn('SGX screener failed, falling back to hardcoded list:', e.message);
                const fallbackTickers = MarketData.getTickers('SGX', 'sti');
                results.push(...fallbackTickers.map(t => ({ ticker: t, name: t, price: 0, volume: 0, avgVolume: 0 })));
            }
        }

        return results;
    }

    // ===== Batch Operations =====
    async function batchGetQuotes(tickers, onProgress) {
        const results = [];
        const errors = [];
        const batchSize = config.batchSize;

        for (let i = 0; i < tickers.length; i += batchSize) {
            const batch = tickers.slice(i, i + batchSize);
            const batchResults = await Promise.allSettled(
                batch.map(ticker => getQuote(ticker))
            );

            for (let j = 0; j < batchResults.length; j++) {
                if (batchResults[j].status === 'fulfilled') {
                    results.push(batchResults[j].value);
                } else {
                    errors.push({ ticker: batch[j], error: batchResults[j].reason.message });
                }
            }

            if (onProgress) {
                onProgress(Math.min(i + batchSize, tickers.length), tickers.length);
            }
        }

        return { results, errors };
    }

    async function batchGetOptions(tickers, onProgress) {
        const results = [];
        const errors = [];

        for (let i = 0; i < tickers.length; i++) {
            try {
                const chain = await getOptionsChain(tickers[i]);
                results.push(chain);
            } catch (err) {
                errors.push({ ticker: tickers[i], error: err.message });
            }

            if (onProgress) {
                onProgress(i + 1, tickers.length);
            }
        }

        return { results, errors };
    }

    // Calculate Historical Volatility from price data
    function calcHistoricalVolatility(closes) {
        if (closes.length < 10) return 0;

        const returns = [];
        for (let i = 1; i < closes.length; i++) {
            if (closes[i - 1] > 0) {
                returns.push(Math.log(closes[i] / closes[i - 1]));
            }
        }

        if (returns.length < 5) return 0;

        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
        const dailyVol = Math.sqrt(variance);
        const annualVol = dailyVol * Math.sqrt(252); // Annualize

        return annualVol;
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
        screenUSByVolume,
        screenSGXByVolume,
        getMostActive,
        discoverStocks,
        setConfig,
        getConfig,
        loadConfig,
        saveConfig,
    };
})();
