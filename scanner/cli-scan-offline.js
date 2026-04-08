#!/usr/bin/env node
/**
 * OptiMax Offline Scanner - Simulated market data with Black-Scholes pricing
 * Scans US & SGX markets for max-gain option trades
 *
 * DISCLAIMER: This uses SIMULATED data based on Black-Scholes pricing models.
 * Prices are NOT live quotes. Always verify with your broker before trading.
 */
const fs = require('fs');
const SCAN_DATE = '2026-04-08'; // Simulated scan date

// ===== Black-Scholes =====
function normCDF(x) {
    const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t * Math.exp(-x*x);
    return 0.5 * (1.0 + sign * y);
}

function bsPrice(S, K, T, r, sigma, type) {
    if (T <= 0 || sigma <= 0) return Math.max(0, type === 'call' ? S - K : K - S);
    const d1 = (Math.log(S/K) + (r + sigma*sigma/2)*T) / (sigma*Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    if (type === 'call') return S * normCDF(d1) - K * Math.exp(-r*T) * normCDF(d2);
    return K * Math.exp(-r*T) * normCDF(-d2) - S * normCDF(-d1);
}

// ===== Seeded RNG =====
let seed = 42;
function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
function randRange(lo, hi) { return lo + rand() * (hi - lo); }
function randInt(lo, hi) { return Math.floor(randRange(lo, hi + 1)); }

// ===== Stock Data =====
const US_STOCKS = [
    ['AAPL',220],['MSFT',440],['AMZN',210],['NVDA',125],['GOOGL',175],['META',570],['TSLA',250],['AMD',115],['NFLX',960],['JPM',245],
    ['V',330],['MA',540],['HD',385],['COST',960],['AVGO',190],['CRM',310],['ADBE',460],['INTC',22],['QCOM',175],['PYPL',72],
    ['BA',185],['DIS',105],['UBER',78],['ABNB',155],['SQ',80],['COIN',235],['PLTR',95],['SOFI',14],['DKNG',42],['SNAP',12],
    ['ROKU',82],['RIVN',14],['NIO',4.5],['BABA',120],['PFE',24],['MRNA',35],['XOM',108],['CVX',155],['GS',560],['BAC',42],
    ['WMT',92],['TGT',125],['NKE',70],['SBUX',95],['MCD',300],['KO',65],['PEP',155],['JNJ',160],['UNH',530],['LLY',850],
    ['ABBV',185],['MRK',85],['BMY',50],['GILD',115],['AMGN',310],['REGN',780],['ISRG',530],['DXCM',78],['CRWD',370],['PANW',195],
    ['ZS',235],['NET',115],['SNOW',175],['DDOG',130],['MDB',235],['SHOP',110],['SE',115],['MELI',1850],['TTD',85],['ENPH',68],
    ['FSLR',185],['F',10],['GM',48],['DAL',52],['AAL',14],['CCL',22],['T',28],['VZ',42],['C',70],['WFC',72],
    ['SPY',570],['QQQ',510],['IWM',210],['XLF',46],['XLE',85],['XLK',230],['GLD',300],['SLV',33],['TLT',88],['EEM',42],
    ['SMCI',38],['ARM',160],['MRVL',85],['MU',98],['ANET',95],['ON',42],['LRCX',85],['KLAC',710],['AMAT',165],['TXN',180],
];

const SGX_STOCKS = [
    ['D05.SI',42],['O39.SI',16],['U11.SI',35],['Z74.SI',3.2],['BN4.SI',7.5],['C38U.SI',2.1],['A17U.SI',2.8],
    ['C09.SI',5.5],['U96.SI',6.2],['Y92.SI',0.55],['G13.SI',0.95],['S58.SI',3.8],['C6L.SI',7.2],['N2IU.SI',1.4],
    ['ME8U.SI',2.5],['M44U.SI',1.6],['F34.SI',3.3],['BS6.SI',2.2],['S63.SI',4.5],['S68.SI',12.5],['V03.SI',12.8],
    ['CC3.SI',1.2],['C52.SI',1.4],['J36.SI',58],['H78.SI',5.5],['U14.SI',6.8],
];

// IV profiles by stock type
function getIV(ticker, price) {
    const highVol = ['TSLA','COIN','PLTR','SOFI','DKNG','SNAP','ROKU','RIVN','NIO','MRNA','SMCI','ENPH','GME','AMC','MARA','HOOD','FSLR'];
    const medVol = ['AMD','NVDA','META','NFLX','SQ','UBER','ABNB','BABA','SHOP','NET','CRWD','PANW','ZS','SNOW','DDOG','MDB','ARM','SE','TTD','DXCM','BA'];
    const lowVol = ['KO','PEP','JNJ','PG','WMT','MCD','T','VZ','SPY','GLD','TLT','XLF'];
    
    if (highVol.some(t => ticker.includes(t))) return randRange(0.50, 0.80);
    if (medVol.some(t => ticker.includes(t))) return randRange(0.32, 0.55);
    if (lowVol.some(t => ticker.includes(t))) return randRange(0.15, 0.28);
    if (ticker.endsWith('.SI')) return randRange(0.18, 0.38);
    return randRange(0.22, 0.45);
}

function getVolMultiplier(ticker) {
    const mega = ['AAPL','MSFT','AMZN','NVDA','TSLA','META','SPY','QQQ','AMD','NFLX','GOOGL'];
    const large = ['JPM','V','BA','DIS','COIN','PLTR','SOFI','NIO','BAC','F','INTC','SNAP','IWM','XLE','XLK'];
    if (mega.some(t => ticker === t)) return randRange(8, 20);
    if (large.some(t => ticker === t)) return randRange(3, 8);
    if (ticker.endsWith('.SI')) return randRange(0.3, 1.5);
    return randRange(1, 4);
}

// ===== Scoring =====
function score(strategy, rr, gainPct, ivRank, vol, oi, dte) {
    let s = 0;
    if (rr >= 5) s += 30; else if (rr >= 3) s += 25; else if (rr >= 2) s += 20;
    else if (rr >= 1.5) s += 15; else if (rr >= 1) s += 10; else s += 5;
    if (gainPct >= 500) s += 25; else if (gainPct >= 300) s += 20; else if (gainPct >= 200) s += 17;
    else if (gainPct >= 100) s += 13; else if (gainPct >= 50) s += 8; else s += 3;
    const buyer = ['Long Call','Long Put','Long Straddle','Bull Call Spread','Bear Put Spread'].includes(strategy);
    if (buyer) { if (ivRank<20) s+=20; else if (ivRank<35) s+=15; else if (ivRank<50) s+=10; else s+=5; }
    else { if (ivRank>80) s+=20; else if (ivRank>60) s+=15; else if (ivRank>40) s+=10; else s+=5; }
    if (vol>=1000 && oi>=5000) s+=15; else if (vol>=500 && oi>=2000) s+=12; else if (vol>=100 && oi>=500) s+=8; else if (vol>=50) s+=5; else s+=2;
    if (dte>=20 && dte<=45) s+=10; else if (dte>=10 && dte<=60) s+=7; else if (dte>=5 && dte<=90) s+=4; else s+=2;
    return Math.min(100, Math.max(0, s));
}

// ===== Main =====
function main() {
    const allStocks = [...US_STOCKS.map(s => ({ticker:s[0], price:s[1], market:'US', rf:0.045, ccy:'USD'})),
                        ...SGX_STOCKS.map(s => ({ticker:s[0], price:s[1], market:'SGX', rf:0.035, ccy:'SGD'}))];
    
    const results = [];
    const dteOptions = [14, 21, 30, 45];
    const today = new Date('2026-04-08');
    
    for (const stock of allStocks) {
        const {ticker, price, market, rf} = stock;
        const iv = getIV(ticker, price);
        const hv = iv * randRange(0.7, 1.1);
        const ivRank = Math.min(100, Math.max(0, Math.round(((iv / hv) - 0.5) * 100)));
        const volMult = getVolMultiplier(ticker);
        
        const strikePcts = [0.90, 0.925, 0.95, 0.975, 1.0, 1.025, 1.05, 1.075, 1.10];
        
        for (const dte of dteOptions) {
            const T = dte / 365;
            const expiry = new Date(today);
            expiry.setDate(expiry.getDate() + dte);
            const expiryStr = expiry.toISOString().split('T')[0];
            
            const chain = strikePcts.map(pct => {
                const K = Math.round(price * pct * 100) / 100;
                const callPrice = bsPrice(price, K, T, rf, iv, 'call');
                const putPrice = bsPrice(price, K, T, rf, iv, 'put');
                const vol = Math.max(10, Math.round(randRange(100, 5000) * volMult * (pct > 0.95 && pct < 1.05 ? 2 : 0.5)));
                const oi = Math.max(50, Math.round(vol * randRange(3, 20)));
                return { K, callPrice: Math.max(0.01, callPrice), putPrice: Math.max(0.01, putPrice), vol, oi, iv };
            });
            
            const atmIdx = strikePcts.indexOf(1.0);
            const atm = chain[atmIdx];
            
            // Expected 1-sigma move for realistic gain targets
            const sigmaMove = price * iv * Math.sqrt(T);
            const targetUp = price + 1.5 * sigmaMove;   // 1.5 sigma up
            const targetDown = price - 1.5 * sigmaMove;  // 1.5 sigma down

            // Bid/ask spread simulation (tighter for liquid stocks)
            const spreadPct = volMult > 5 ? 0.02 : (volMult > 2 ? 0.04 : 0.08);

            // Helper: build trade setup fields
            function tradeSetup(premium, stopPct) {
                const bid = +(premium * (1 - spreadPct/2)).toFixed(2);
                const ask = +(premium * (1 + spreadPct/2)).toFixed(2);
                const mid = +(premium).toFixed(2);
                const stopLoss = +(premium * (1 - stopPct)).toFixed(2); // exit at this option price
                return { entryDate: SCAN_DATE, bid, ask, entryPrice: mid, stopLoss };
            }

            // ===== Long Call (OTM calls) =====
            for (let i = atmIdx; i < chain.length; i++) {
                const c = chain[i];
                const premium = c.callPrice;
                if (premium < 0.10) continue;
                const cost = premium * 100;
                const breakeven = c.K + premium;
                if (targetUp <= breakeven) continue;
                const targetGain = (targetUp - c.K - premium) * 100;
                if (targetGain <= 0) continue;
                const gainPct = (targetGain / cost) * 100;
                if (gainPct < 10) continue;
                const rr = targetGain / cost;
                const s = score('Long Call', rr, gainPct, ivRank, c.vol, c.oi, dte);
                const ts = tradeSetup(premium, 0.50);
                const tgtPrice = +(premium * (1 + gainPct/100 * 0.5)).toFixed(2); // target 50% of max
                results.push({
                    ticker, market, stockPrice:price, strategy:'Long Call', strike:c.K.toFixed(2),
                    expiry:expiryStr, dte, premium:premium.toFixed(2), maxGainPct:gainPct.toFixed(1),
                    maxLoss:cost.toFixed(0), breakeven:breakeven.toFixed(2), iv:(c.iv*100).toFixed(1),
                    ivRank, volume:c.vol, oi:c.oi, riskReward:rr.toFixed(2), score:s,
                    entryDate:ts.entryDate, bid:ts.bid, ask:ts.ask, entryPrice:ts.entryPrice,
                    targetStockPrice:targetUp.toFixed(2), targetOptionPrice:tgtPrice,
                    stopLoss:ts.stopLoss,
                    action:`BUY ${c.K.toFixed(0)} CALL @ $${ts.entryPrice} (ask $${ts.ask}), stop $${ts.stopLoss}, target $${tgtPrice}`
                });
            }

            // ===== Long Put (OTM puts) =====
            for (let i = 0; i <= atmIdx; i++) {
                const c = chain[i];
                const premium = c.putPrice;
                if (premium < 0.10) continue;
                const cost = premium * 100;
                const breakeven = c.K - premium;
                if (targetDown >= breakeven) continue;
                const targetGainVal = (c.K - premium - Math.max(0, targetDown)) * 100;
                if (targetGainVal <= 0) continue;
                const gainPct = (targetGainVal / cost) * 100;
                if (gainPct < 10) continue;
                const rr = targetGainVal / cost;
                const s = score('Long Put', rr, gainPct, ivRank, c.vol, c.oi, dte);
                const ts = tradeSetup(premium, 0.50);
                const tgtPrice = +(premium * (1 + gainPct/100 * 0.5)).toFixed(2);
                results.push({
                    ticker, market, stockPrice:price, strategy:'Long Put', strike:c.K.toFixed(2),
                    expiry:expiryStr, dte, premium:premium.toFixed(2), maxGainPct:gainPct.toFixed(1),
                    maxLoss:cost.toFixed(0), breakeven:breakeven.toFixed(2), iv:(c.iv*100).toFixed(1),
                    ivRank, volume:c.vol, oi:c.oi, riskReward:rr.toFixed(2), score:s,
                    entryDate:ts.entryDate, bid:ts.bid, ask:ts.ask, entryPrice:ts.entryPrice,
                    targetStockPrice:targetDown.toFixed(2), targetOptionPrice:tgtPrice,
                    stopLoss:ts.stopLoss,
                    action:`BUY ${c.K.toFixed(0)} PUT @ $${ts.entryPrice} (ask $${ts.ask}), stop $${ts.stopLoss}, target $${tgtPrice}`
                });
            }

            // ===== Bull Call Spread (ATM long, 5% OTM short) =====
            const otmCallIdx = strikePcts.indexOf(1.05);
            if (otmCallIdx >= 0 && atmIdx >= 0) {
                const longC = chain[atmIdx], shortC = chain[otmCallIdx];
                const netDebit = (longC.callPrice - shortC.callPrice) * 100;
                if (netDebit > 0) {
                    const maxGain = (shortC.K - longC.K) * 100 - netDebit;
                    if (maxGain > 0) {
                        const gainPct = (maxGain / netDebit) * 100;
                        const rr = maxGain / netDebit;
                        const breakeven = longC.K + (longC.callPrice - shortC.callPrice);
                        const avgVol = Math.floor((longC.vol + shortC.vol) / 2);
                        const avgOI = Math.floor((longC.oi + shortC.oi) / 2);
                        const s = score('Bull Call Spread', rr, gainPct, ivRank, avgVol, avgOI, dte);
                        const netPrem = longC.callPrice - shortC.callPrice;
                        const ts = tradeSetup(netPrem, 0.60);
                        results.push({
                            ticker, market, stockPrice:price, strategy:'Bull Call Spread',
                            strike:`${longC.K.toFixed(2)}/${shortC.K.toFixed(2)}`,
                            expiry:expiryStr, dte, premium:netPrem.toFixed(2),
                            maxGainPct:gainPct.toFixed(1), maxLoss:netDebit.toFixed(0),
                            breakeven:breakeven.toFixed(2), iv:(longC.iv*100).toFixed(1), ivRank,
                            volume:avgVol, oi:avgOI, riskReward:rr.toFixed(2), score:s,
                            entryDate:ts.entryDate, bid:ts.bid, ask:ts.ask, entryPrice:ts.entryPrice,
                            targetStockPrice:shortC.K.toFixed(2), targetOptionPrice:'spread max',
                            stopLoss:ts.stopLoss,
                            action:`BUY ${longC.K.toFixed(0)} CALL @ $${longC.callPrice.toFixed(2)} + SELL ${shortC.K.toFixed(0)} CALL @ $${shortC.callPrice.toFixed(2)}, net debit $${netPrem.toFixed(2)}`
                        });
                    }
                }
            }

            // ===== Bear Put Spread (ATM long, 5% OTM short) =====
            const otmPutIdx = strikePcts.indexOf(0.95);
            if (otmPutIdx >= 0 && atmIdx >= 0) {
                const longP = chain[atmIdx], shortP = chain[otmPutIdx];
                const netDebit = (longP.putPrice - shortP.putPrice) * 100;
                if (netDebit > 0) {
                    const maxGain = (longP.K - shortP.K) * 100 - netDebit;
                    if (maxGain > 0) {
                        const gainPct = (maxGain / netDebit) * 100;
                        const rr = maxGain / netDebit;
                        const breakeven = longP.K - (longP.putPrice - shortP.putPrice);
                        const avgVol = Math.floor((longP.vol + shortP.vol) / 2);
                        const avgOI = Math.floor((longP.oi + shortP.oi) / 2);
                        const s = score('Bear Put Spread', rr, gainPct, ivRank, avgVol, avgOI, dte);
                        const netPrem = longP.putPrice - shortP.putPrice;
                        const ts = tradeSetup(netPrem, 0.60);
                        results.push({
                            ticker, market, stockPrice:price, strategy:'Bear Put Spread',
                            strike:`${longP.K.toFixed(2)}/${shortP.K.toFixed(2)}`,
                            expiry:expiryStr, dte, premium:netPrem.toFixed(2),
                            maxGainPct:gainPct.toFixed(1), maxLoss:netDebit.toFixed(0),
                            breakeven:breakeven.toFixed(2), iv:(longP.iv*100).toFixed(1), ivRank,
                            volume:avgVol, oi:avgOI, riskReward:rr.toFixed(2), score:s,
                            entryDate:ts.entryDate, bid:ts.bid, ask:ts.ask, entryPrice:ts.entryPrice,
                            targetStockPrice:shortP.K.toFixed(2), targetOptionPrice:'spread max',
                            stopLoss:ts.stopLoss,
                            action:`BUY ${longP.K.toFixed(0)} PUT @ $${longP.putPrice.toFixed(2)} + SELL ${shortP.K.toFixed(0)} PUT @ $${shortP.putPrice.toFixed(2)}, net debit $${netPrem.toFixed(2)}`
                        });
                    }
                }
            }

            // ===== Long Straddle =====
            {
                const c = atm;
                const totalPrem = c.callPrice + c.putPrice;
                const cost = totalPrem * 100;
                const upsideGain = (1.5 * sigmaMove - totalPrem) * 100;
                if (upsideGain > 0) {
                    const gainPct = (upsideGain / cost) * 100;
                    if (gainPct >= 20) {
                        const rr = upsideGain / cost;
                        const beUp = c.K + totalPrem, beDn = c.K - totalPrem;
                        const s = score('Long Straddle', rr, gainPct, ivRank, c.vol, c.oi, dte);
                        const ts = tradeSetup(totalPrem, 0.40);
                        results.push({
                            ticker, market, stockPrice:price, strategy:'Long Straddle', strike:c.K.toFixed(2),
                            expiry:expiryStr, dte, premium:totalPrem.toFixed(2), maxGainPct:gainPct.toFixed(1),
                            maxLoss:cost.toFixed(0), breakeven:`${beDn.toFixed(2)}/${beUp.toFixed(2)}`,
                            iv:(c.iv*100).toFixed(1), ivRank, volume:c.vol, oi:c.oi, riskReward:rr.toFixed(2), score:s,
                            entryDate:ts.entryDate, bid:ts.bid, ask:ts.ask, entryPrice:ts.entryPrice,
                            targetStockPrice:`>${beUp.toFixed(2)} or <${beDn.toFixed(2)}`,
                            targetOptionPrice:+(totalPrem * (1 + gainPct/100 * 0.5)).toFixed(2),
                            stopLoss:ts.stopLoss,
                            action:`BUY ${c.K.toFixed(0)} CALL @ $${c.callPrice.toFixed(2)} + BUY ${c.K.toFixed(0)} PUT @ $${c.putPrice.toFixed(2)}, total $${totalPrem.toFixed(2)}`
                        });
                    }
                }
            }

            // ===== Covered Call (5% OTM) =====
            if (otmCallIdx >= 0) {
                const c = chain[otmCallIdx];
                const stockCost = price * 100;
                const premRcvd = c.callPrice * 100;
                const maxGain = (c.K - price) * 100 + premRcvd;
                if (maxGain > 0) {
                    const gainPct = (maxGain / stockCost) * 100;
                    const maxLoss = stockCost - premRcvd;
                    const rr = maxGain / maxLoss;
                    const breakeven = price - c.callPrice;
                    const s = score('Covered Call', rr, gainPct, ivRank, c.vol, c.oi, dte);
                    const ts = tradeSetup(c.callPrice, 0.30);
                    results.push({
                        ticker, market, stockPrice:price, strategy:'Covered Call', strike:c.K.toFixed(2),
                        expiry:expiryStr, dte, premium:c.callPrice.toFixed(2), maxGainPct:gainPct.toFixed(1),
                        maxLoss:maxLoss.toFixed(0), breakeven:breakeven.toFixed(2), iv:(c.iv*100).toFixed(1),
                        ivRank, volume:c.vol, oi:c.oi, riskReward:rr.toFixed(2), score:s,
                        entryDate:ts.entryDate, bid:ts.bid, ask:ts.ask, entryPrice:ts.entryPrice,
                        targetStockPrice:c.K.toFixed(2), targetOptionPrice:'expire worthless',
                        stopLoss: (price * 0.92).toFixed(2),
                        action:`BUY 100 shares @ $${price.toFixed(2)} + SELL ${c.K.toFixed(0)} CALL @ $${c.callPrice.toFixed(2)} (bid $${ts.bid})`
                    });
                }
            }
        }
    }
    
    // Sort: score desc, then gainPct desc
    results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return parseFloat(b.maxGainPct) - parseFloat(a.maxGainPct);
    });
    
    // CSV output with trade setup columns
    const headers = 'Rank,Ticker,Market,Stock Price,Strategy,Strike(s),Expiry,DTE,Entry Date,Bid,Ask,Entry Price,Premium/Contract,Max Gain %,Max Loss $,Breakeven,Target Stock Price,Target Option Price,Stop Loss,IV %,IV Rank,Volume,Open Interest,Risk/Reward,Score,Trade Action';
    const csvLines = [headers];
    results.forEach((r, i) => {
        csvLines.push([
            i+1, r.ticker, r.market, r.stockPrice, r.strategy, `"${r.strike}"`,
            r.expiry, r.dte, r.entryDate, r.bid, r.ask, r.entryPrice, r.premium,
            r.maxGainPct, r.maxLoss, `"${r.breakeven}"`, `"${r.targetStockPrice}"`,
            r.targetOptionPrice, r.stopLoss, r.iv, r.ivRank, r.volume, r.oi,
            r.riskReward, r.score, `"${r.action}"`
        ].join(','));
    });
    const csv = csvLines.join('\n');
    fs.writeFileSync('/home/user/kaomilim.github.io/scanner/scan_results.csv', csv);
    console.log(csv);

    // Summary
    console.error(`\n=== OptiMax Scanner Results (SIMULATED DATA - ${SCAN_DATE}) ===`);
    console.error(`*** DISCLAIMER: Prices are simulated via Black-Scholes. Verify with broker before trading. ***`);
    console.error(`Total: ${results.length} opportunities from ${US_STOCKS.length + SGX_STOCKS.length} tickers\n`);
    console.error('=== TOP 30 TRADE SETUPS (Highest Confidence + Gain) ===');
    console.error('═'.repeat(160));
    console.error(
        '#'.padEnd(4)+'Ticker'.padEnd(9)+'Mkt'.padEnd(5)+'Price'.padEnd(9)+
        'Strategy'.padEnd(19)+'Strike'.padEnd(14)+'Expiry'.padEnd(12)+'DTE'.padEnd(5)+
        'Entry$'.padEnd(9)+'Bid'.padEnd(8)+'Ask'.padEnd(8)+
        'Gain%'.padEnd(9)+'MaxLoss$'.padEnd(10)+'StopLoss'.padEnd(10)+
        'Score'.padEnd(6)+'Trade Action'
    );
    console.error('─'.repeat(160));
    results.slice(0, 30).forEach((r, i) => {
        console.error(
            String(i+1).padEnd(4)+r.ticker.padEnd(9)+r.market.padEnd(5)+
            String(r.stockPrice).padEnd(9)+r.strategy.padEnd(19)+
            String(r.strike).substring(0,12).padEnd(14)+r.expiry.padEnd(12)+
            String(r.dte).padEnd(5)+
            ('$'+r.entryPrice).padEnd(9)+('$'+r.bid).padEnd(8)+('$'+r.ask).padEnd(8)+
            (r.maxGainPct+'%').padEnd(9)+
            ('$'+r.maxLoss).padEnd(10)+('$'+r.stopLoss).padEnd(10)+
            String(r.score).padEnd(6)+r.action.substring(0,60)
        );
    });
    console.error('═'.repeat(160));
    console.error(`\nCSV saved to: scanner/scan_results.csv`);
    console.error(`Entry Date for all trades: ${SCAN_DATE}`);
}

main();
