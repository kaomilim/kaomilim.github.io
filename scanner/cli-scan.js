#!/usr/bin/env node
/**
 * OptiMax CLI Scanner
 * Scans US & SGX markets for max-gain option trades, outputs CSV
 */

const https = require('https');
const http = require('http');
const fs = require('fs');

// ===== Configuration =====
const CONFIG = {
    requestDelay: 600,   // ms between requests
    timeout: 15000,      // request timeout
    maxDTE: 60,
    minVolume: 50,
    minGain: 20,
    maxRisk: 50000,
};

// ===== Ticker Lists =====
// Top US stocks with high options liquidity
const US_TICKERS = [
    'AAPL','MSFT','AMZN','NVDA','GOOGL','META','TSLA','AMD','NFLX','JPM',
    'V','MA','HD','COST','AVGO','CRM','ADBE','INTC','QCOM','PYPL',
    'BA','DIS','UBER','ABNB','SQ','COIN','PLTR','SOFI','DKNG','SNAP',
    'ROKU','RIVN','NIO','BABA','PFE','MRNA','XOM','CVX','GS','BAC',
    'WMT','TGT','NKE','SBUX','MCD','KO','PEP','JNJ','UNH','LLY',
    'ABBV','MRK','BMY','GILD','AMGN','REGN','ISRG','DXCM','CRWD','PANW',
    'ZS','NET','SNOW','DDOG','MDB','SHOP','SE','MELI','TTD','ENPH',
    'FSLR','F','GM','DAL','AAL','CCL','T','VZ','C','WFC',
    'SPY','QQQ','IWM','XLF','XLE','XLK','GLD','SLV','TLT','EEM',
    'SMCI','ARM','MRVL','MU','ANET','ON','LRCX','KLAC','AMAT','TXN',
];

// SGX Straits Times Index
const SGX_TICKERS = [
    'D05.SI','O39.SI','U11.SI','Z74.SI','BN4.SI','C38U.SI','A17U.SI',
    'C09.SI','U96.SI','Y92.SI','G13.SI','S58.SI','C6L.SI','N2IU.SI',
    'ME8U.SI','M44U.SI','F34.SI','BS6.SI','S63.SI','S68.SI','V03.SI',
    'CC3.SI','C52.SI','J36.SI','H78.SI','U14.SI',
];

const ALL_TICKERS = [...US_TICKERS, ...SGX_TICKERS];

// ===== HTTP Fetch =====
function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { timeout: CONFIG.timeout }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`JSON parse error: ${e.message}`));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== Yahoo Finance API =====
async function getOptionsChain(ticker) {
    const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`;
    const data = await fetchJSON(url);
    if (!data.optionChain || !data.optionChain.result || data.optionChain.result.length === 0) {
        throw new Error(`No options data for ${ticker}`);
    }
    const result = data.optionChain.result[0];
    const quote = result.quote || {};
    const options = result.options || [];
    return {
        ticker,
        price: quote.regularMarketPrice || 0,
        previousClose: quote.regularMarketPreviousClose || 0,
        calls: options.length > 0 ? (options[0].calls || []) : [],
        puts: options.length > 0 ? (options[0].puts || []) : [],
        expirations: result.expirationDates || [],
    };
}

async function getHistoricalVol(ticker) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=3mo`;
    const data = await fetchJSON(url);
    if (!data.chart || !data.chart.result || data.chart.result.length === 0) return 0.3;
    const closes = (data.chart.result[0].indicators.quote[0].close || []).filter(c => c !== null);
    if (closes.length < 10) return 0.3;
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
        if (closes[i - 1] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
    }
    if (returns.length < 5) return 0.3;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance) * Math.sqrt(252);
}

// ===== Options Math =====
function calcDTE(expirationTs) {
    return Math.max(0, Math.ceil((new Date(expirationTs * 1000) - new Date()) / 86400000));
}

function calcIVRank(iv, hv) {
    if (!hv || hv <= 0) return 50;
    return Math.min(100, Math.max(0, Math.round(((iv / hv) - 0.5) * 100)));
}

function findATM(options, price) {
    if (!options || options.length === 0) return null;
    return options.reduce((best, o) => Math.abs(o.strike - price) < Math.abs(best.strike - price) ? o : best);
}

function findOTM(options, price, type, pct = 5) {
    const target = type === 'call' ? price * (1 + pct / 100) : price * (1 - pct / 100);
    if (!options || options.length === 0) return null;
    return options.reduce((best, o) => Math.abs(o.strike - target) < Math.abs(best.strike - target) ? o : best);
}

function scoreOpportunity(result, ivRank, volume, oi) {
    let score = 0;
    const rr = result.riskReward || 0;
    if (rr >= 5) score += 30; else if (rr >= 3) score += 25; else if (rr >= 2) score += 20;
    else if (rr >= 1.5) score += 15; else if (rr >= 1) score += 10; else score += 5;

    const gp = result.maxGainPercent || 0;
    if (gp >= 500) score += 25; else if (gp >= 300) score += 20; else if (gp >= 200) score += 17;
    else if (gp >= 100) score += 13; else if (gp >= 50) score += 8; else score += 3;

    const isBuyer = ['long_call','long_put','straddle','strangle','bull_call_spread','bear_put_spread'].includes(result.strategy);
    if (isBuyer) {
        if (ivRank < 20) score += 20; else if (ivRank < 35) score += 15; else if (ivRank < 50) score += 10; else score += 5;
    } else {
        if (ivRank > 80) score += 20; else if (ivRank > 60) score += 15; else if (ivRank > 40) score += 10; else score += 5;
    }

    const v = volume || 0, o = oi || 0;
    if (v >= 1000 && o >= 5000) score += 15; else if (v >= 500 && o >= 2000) score += 12;
    else if (v >= 100 && o >= 500) score += 8; else if (v >= 50) score += 5; else score += 2;

    const dte = result.dte || 30;
    if (dte >= 20 && dte <= 45) score += 10; else if (dte >= 10 && dte <= 60) score += 7;
    else if (dte >= 5 && dte <= 90) score += 4; else score += 2;

    return Math.min(100, Math.max(0, Math.round(score)));
}

// ===== Strategy Evaluators =====
function evalLongCall(ticker, price, call, dte, hv, market) {
    const premium = call.lastPrice || call.ask || 0;
    if (premium <= 0) return null;
    const cost = premium * 100;
    const breakeven = call.strike + premium;
    const targetGain = (price * 1.5 - call.strike - premium) * 100;
    const maxGainPct = (targetGain / cost) * 100;
    if (maxGainPct < CONFIG.minGain) return null;
    if (cost > CONFIG.maxRisk) return null;
    const rr = targetGain / cost;
    const iv = call.impliedVolatility || 0;
    const ivRank = calcIVRank(iv, hv);
    const score = scoreOpportunity({ strategy: 'long_call', riskReward: rr, maxGainPercent: maxGainPct, dte }, ivRank, call.volume, call.openInterest);
    return {
        ticker, market, stockPrice: price, strategy: 'Long Call', strike: call.strike.toFixed(2),
        expiry: new Date(call.expiration * 1000).toISOString().split('T')[0], dte, premium: premium.toFixed(2),
        maxGainPct: maxGainPct.toFixed(1), maxLoss: cost.toFixed(0), breakeven: breakeven.toFixed(2),
        iv: (iv * 100).toFixed(1), ivRank, volume: call.volume || 0, oi: call.openInterest || 0,
        riskReward: rr.toFixed(2), score,
    };
}

function evalLongPut(ticker, price, put, dte, hv, market) {
    const premium = put.lastPrice || put.ask || 0;
    if (premium <= 0) return null;
    const cost = premium * 100;
    const breakeven = put.strike - premium;
    const maxGainDollars = (put.strike - premium) * 100;
    const maxGainPct = (maxGainDollars / cost) * 100;
    if (maxGainPct < CONFIG.minGain) return null;
    if (cost > CONFIG.maxRisk) return null;
    const rr = maxGainDollars / cost;
    const iv = put.impliedVolatility || 0;
    const ivRank = calcIVRank(iv, hv);
    const score = scoreOpportunity({ strategy: 'long_put', riskReward: rr, maxGainPercent: maxGainPct, dte }, ivRank, put.volume, put.openInterest);
    return {
        ticker, market, stockPrice: price, strategy: 'Long Put', strike: put.strike.toFixed(2),
        expiry: new Date(put.expiration * 1000).toISOString().split('T')[0], dte, premium: premium.toFixed(2),
        maxGainPct: maxGainPct.toFixed(1), maxLoss: cost.toFixed(0), breakeven: breakeven.toFixed(2),
        iv: (iv * 100).toFixed(1), ivRank, volume: put.volume || 0, oi: put.openInterest || 0,
        riskReward: rr.toFixed(2), score,
    };
}

function evalBullCallSpread(ticker, price, longCall, shortCall, dte, hv, market) {
    const lp = longCall.lastPrice || longCall.ask || 0;
    const sp = shortCall.lastPrice || shortCall.bid || 0;
    if (lp <= 0 || sp <= 0 || longCall.strike >= shortCall.strike) return null;
    const netDebit = (lp - sp) * 100;
    if (netDebit <= 0) return null;
    const maxGain = (shortCall.strike - longCall.strike) * 100 - netDebit;
    const maxGainPct = (maxGain / netDebit) * 100;
    if (maxGainPct < CONFIG.minGain || netDebit > CONFIG.maxRisk) return null;
    const rr = maxGain / netDebit;
    const breakeven = longCall.strike + (lp - sp);
    const iv = longCall.impliedVolatility || 0;
    const ivRank = calcIVRank(iv, hv);
    const avgVol = Math.floor(((longCall.volume || 0) + (shortCall.volume || 0)) / 2);
    const avgOI = Math.floor(((longCall.openInterest || 0) + (shortCall.openInterest || 0)) / 2);
    const score = scoreOpportunity({ strategy: 'bull_call_spread', riskReward: rr, maxGainPercent: maxGainPct, dte }, ivRank, avgVol, avgOI);
    return {
        ticker, market, stockPrice: price, strategy: 'Bull Call Spread',
        strike: `${longCall.strike}/${shortCall.strike}`,
        expiry: new Date(longCall.expiration * 1000).toISOString().split('T')[0], dte,
        premium: (lp - sp).toFixed(2), maxGainPct: maxGainPct.toFixed(1), maxLoss: netDebit.toFixed(0),
        breakeven: breakeven.toFixed(2), iv: (iv * 100).toFixed(1), ivRank, volume: avgVol, oi: avgOI,
        riskReward: rr.toFixed(2), score,
    };
}

function evalBearPutSpread(ticker, price, longPut, shortPut, dte, hv, market) {
    const lp = longPut.lastPrice || longPut.ask || 0;
    const sp = shortPut.lastPrice || shortPut.bid || 0;
    if (lp <= 0 || sp <= 0 || longPut.strike <= shortPut.strike) return null;
    const netDebit = (lp - sp) * 100;
    if (netDebit <= 0) return null;
    const maxGain = (longPut.strike - shortPut.strike) * 100 - netDebit;
    const maxGainPct = (maxGain / netDebit) * 100;
    if (maxGainPct < CONFIG.minGain || netDebit > CONFIG.maxRisk) return null;
    const rr = maxGain / netDebit;
    const breakeven = longPut.strike - (lp - sp);
    const iv = longPut.impliedVolatility || 0;
    const ivRank = calcIVRank(iv, hv);
    const avgVol = Math.floor(((longPut.volume || 0) + (shortPut.volume || 0)) / 2);
    const avgOI = Math.floor(((longPut.openInterest || 0) + (shortPut.openInterest || 0)) / 2);
    const score = scoreOpportunity({ strategy: 'bear_put_spread', riskReward: rr, maxGainPercent: maxGainPct, dte }, ivRank, avgVol, avgOI);
    return {
        ticker, market, stockPrice: price, strategy: 'Bear Put Spread',
        strike: `${longPut.strike}/${shortPut.strike}`,
        expiry: new Date(longPut.expiration * 1000).toISOString().split('T')[0], dte,
        premium: (lp - sp).toFixed(2), maxGainPct: maxGainPct.toFixed(1), maxLoss: netDebit.toFixed(0),
        breakeven: breakeven.toFixed(2), iv: (iv * 100).toFixed(1), ivRank, volume: avgVol, oi: avgOI,
        riskReward: rr.toFixed(2), score,
    };
}

function evalStraddle(ticker, price, call, put, dte, hv, market) {
    const cp = call.lastPrice || call.ask || 0;
    const pp = put.lastPrice || put.ask || 0;
    if (cp <= 0 || pp <= 0) return null;
    const totalPrem = cp + pp;
    const cost = totalPrem * 100;
    const upsideGain = price * 0.5 * 100;
    const maxGainPct = (upsideGain / cost) * 100;
    if (maxGainPct < CONFIG.minGain || cost > CONFIG.maxRisk) return null;
    const rr = upsideGain / cost;
    const beUp = call.strike + totalPrem;
    const beDn = call.strike - totalPrem;
    const iv = call.impliedVolatility || 0;
    const ivRank = calcIVRank(iv, hv);
    const avgVol = Math.floor(((call.volume || 0) + (put.volume || 0)) / 2);
    const avgOI = Math.floor(((call.openInterest || 0) + (put.openInterest || 0)) / 2);
    const score = scoreOpportunity({ strategy: 'straddle', riskReward: rr, maxGainPercent: maxGainPct, dte }, ivRank, avgVol, avgOI);
    return {
        ticker, market, stockPrice: price, strategy: 'Long Straddle',
        strike: call.strike.toFixed(2),
        expiry: new Date(call.expiration * 1000).toISOString().split('T')[0], dte,
        premium: totalPrem.toFixed(2), maxGainPct: maxGainPct.toFixed(1), maxLoss: cost.toFixed(0),
        breakeven: `${beDn.toFixed(2)}/${beUp.toFixed(2)}`, iv: (iv * 100).toFixed(1), ivRank,
        volume: avgVol, oi: avgOI, riskReward: rr.toFixed(2), score,
    };
}

function evalCoveredCall(ticker, price, call, dte, hv, market) {
    const premium = call.lastPrice || call.bid || 0;
    if (premium <= 0) return null;
    const stockCost = price * 100;
    const premRcvd = premium * 100;
    const maxGain = (call.strike - price) * 100 + premRcvd;
    const maxGainPct = (maxGain / stockCost) * 100;
    if (maxGainPct < 1 || stockCost > CONFIG.maxRisk * 10) return null; // covered calls need stock capital
    const maxLoss = stockCost - premRcvd;
    const rr = maxGain / maxLoss;
    const breakeven = price - premium;
    const iv = call.impliedVolatility || 0;
    const ivRank = calcIVRank(iv, hv);
    const score = scoreOpportunity({ strategy: 'covered_call', riskReward: rr, maxGainPercent: maxGainPct, dte }, ivRank, call.volume, call.openInterest);
    return {
        ticker, market, stockPrice: price, strategy: 'Covered Call', strike: call.strike.toFixed(2),
        expiry: new Date(call.expiration * 1000).toISOString().split('T')[0], dte, premium: premium.toFixed(2),
        maxGainPct: maxGainPct.toFixed(1), maxLoss: maxLoss.toFixed(0), breakeven: breakeven.toFixed(2),
        iv: (iv * 100).toFixed(1), ivRank, volume: call.volume || 0, oi: call.openInterest || 0,
        riskReward: rr.toFixed(2), score,
    };
}

// ===== Main Scanner =====
async function scanTicker(ticker) {
    const market = ticker.endsWith('.SI') ? 'SGX' : 'US';
    const results = [];

    const chain = await getOptionsChain(ticker);
    if (!chain.price || chain.price <= 0) return results;
    if (chain.calls.length === 0 && chain.puts.length === 0) return results;

    let hv;
    try { hv = await getHistoricalVol(ticker); } catch { hv = 0.3; }

    const price = chain.price;
    const calls = chain.calls.filter(c => c.strike > 0);
    const puts = chain.puts.filter(p => p.strike > 0);

    // Filter by DTE and volume
    const validCalls = calls.filter(c => {
        const dte = calcDTE(c.expiration);
        return dte >= 1 && dte <= CONFIG.maxDTE && (c.volume || 0) >= CONFIG.minVolume;
    });
    const validPuts = puts.filter(p => {
        const dte = calcDTE(p.expiration);
        return dte >= 1 && dte <= CONFIG.maxDTE && (p.volume || 0) >= CONFIG.minVolume;
    });

    // Long Calls
    for (const call of validCalls) {
        const dte = calcDTE(call.expiration);
        const r = evalLongCall(ticker, price, call, dte, hv, market);
        if (r) results.push(r);
    }

    // Long Puts
    for (const put of validPuts) {
        const dte = calcDTE(put.expiration);
        const r = evalLongPut(ticker, price, put, dte, hv, market);
        if (r) results.push(r);
    }

    // Bull Call Spread (ATM long, OTM short)
    const atmCall = findATM(validCalls.length > 0 ? validCalls : calls, price);
    const otmCall5 = findOTM(validCalls.length > 0 ? validCalls : calls, price, 'call', 5);
    if (atmCall && otmCall5 && atmCall.strike < otmCall5.strike) {
        const dte = calcDTE(atmCall.expiration);
        const r = evalBullCallSpread(ticker, price, atmCall, otmCall5, dte, hv, market);
        if (r) results.push(r);
    }

    // Bear Put Spread (ATM long, OTM short)
    const atmPut = findATM(validPuts.length > 0 ? validPuts : puts, price);
    const otmPut5 = findOTM(validPuts.length > 0 ? validPuts : puts, price, 'put', 5);
    if (atmPut && otmPut5 && atmPut.strike > otmPut5.strike) {
        const dte = calcDTE(atmPut.expiration);
        const r = evalBearPutSpread(ticker, price, atmPut, otmPut5, dte, hv, market);
        if (r) results.push(r);
    }

    // Straddle (ATM call + ATM put)
    if (atmCall && atmPut && Math.abs(atmCall.strike - atmPut.strike) < price * 0.03) {
        const dte = calcDTE(atmCall.expiration);
        const r = evalStraddle(ticker, price, atmCall, atmPut, dte, hv, market);
        if (r) results.push(r);
    }

    // Covered Call (OTM call)
    if (otmCall5) {
        const dte = calcDTE(otmCall5.expiration);
        const r = evalCoveredCall(ticker, price, otmCall5, dte, hv, market);
        if (r) results.push(r);
    }

    return results;
}

async function main() {
    console.error('=== OptiMax CLI Scanner ===');
    console.error(`Scanning ${ALL_TICKERS.length} tickers (${US_TICKERS.length} US + ${SGX_TICKERS.length} SGX)`);
    console.error(`Filters: maxDTE=${CONFIG.maxDTE}, minVol=${CONFIG.minVolume}, minGain=${CONFIG.minGain}%\n`);

    const allResults = [];
    let scanned = 0;
    let errors = 0;

    for (const ticker of ALL_TICKERS) {
        scanned++;
        try {
            process.stderr.write(`\r[${scanned}/${ALL_TICKERS.length}] Scanning ${ticker.padEnd(10)} | Found: ${allResults.length} opportunities | Errors: ${errors}`);
            const results = await scanTicker(ticker);
            allResults.push(...results);
        } catch (err) {
            errors++;
            // silent skip
        }
        await sleep(CONFIG.requestDelay);
    }

    console.error(`\n\nScan complete: ${scanned} tickers, ${allResults.length} opportunities, ${errors} errors\n`);

    // Sort: primary by score (desc), secondary by maxGainPct (desc)
    allResults.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return parseFloat(b.maxGainPct) - parseFloat(a.maxGainPct);
    });

    // Output CSV
    const headers = [
        'Rank','Ticker','Market','Stock Price','Strategy','Strike(s)','Expiry','DTE',
        'Premium','Max Gain %','Max Loss $','Breakeven','IV %','IV Rank','Volume',
        'Open Interest','Risk/Reward','Score'
    ];

    const csvLines = [headers.join(',')];
    allResults.forEach((r, i) => {
        csvLines.push([
            i + 1, r.ticker, r.market, r.stockPrice.toFixed(2), r.strategy,
            `"${r.strike}"`, r.expiry, r.dte, r.premium, r.maxGainPct, r.maxLoss,
            `"${r.breakeven}"`, r.iv, r.ivRank, r.volume, r.oi, r.riskReward, r.score
        ].join(','));
    });

    const csv = csvLines.join('\n');

    // Write to file
    const outFile = '/home/user/kaomilim.github.io/scanner/scan_results.csv';
    fs.writeFileSync(outFile, csv);
    console.error(`CSV saved to: ${outFile}`);

    // Also print to stdout
    console.log(csv);

    // Print top 20 summary
    console.error('\n=== TOP 20 OPPORTUNITIES (Highest Score + Gain) ===');
    console.error('─'.repeat(120));
    console.error(
        'Rank'.padEnd(5) + 'Ticker'.padEnd(10) + 'Mkt'.padEnd(5) + 'Price'.padEnd(10) +
        'Strategy'.padEnd(20) + 'Strike'.padEnd(15) + 'Expiry'.padEnd(12) +
        'Gain%'.padEnd(10) + 'MaxLoss$'.padEnd(10) + 'IV%'.padEnd(8) +
        'Vol'.padEnd(8) + 'Score'.padEnd(6)
    );
    console.error('─'.repeat(120));
    allResults.slice(0, 20).forEach((r, i) => {
        console.error(
            String(i + 1).padEnd(5) +
            r.ticker.padEnd(10) +
            r.market.padEnd(5) +
            String(r.stockPrice.toFixed(2)).padEnd(10) +
            r.strategy.padEnd(20) +
            String(r.strike).padEnd(15) +
            r.expiry.padEnd(12) +
            (r.maxGainPct + '%').padEnd(10) +
            ('$' + r.maxLoss).padEnd(10) +
            (r.iv + '%').padEnd(8) +
            String(r.volume).padEnd(8) +
            String(r.score).padEnd(6)
        );
    });
    console.error('─'.repeat(120));
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
