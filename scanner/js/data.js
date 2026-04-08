/**
 * Stock Market Data - Ticker Lists for US and SGX Markets
 * OptiMax Scanner
 */

const MarketData = (() => {

    // S&P 500 - Major tickers with high options liquidity
    const SP500 = [
        'AAPL','MSFT','AMZN','NVDA','GOOGL','META','TSLA','BRK.B','UNH','JNJ',
        'JPM','V','XOM','PG','MA','HD','CVX','MRK','ABBV','LLY',
        'PEP','KO','COST','AVGO','TMO','WMT','MCD','CSCO','ACN','ABT',
        'DHR','CRM','LIN','NEE','TXN','ADBE','AMD','PM','NFLX','UPS',
        'RTX','QCOM','CMCSA','LOW','HON','INTC','INTU','UNP','BA','AMGN',
        'SPGI','ELV','CAT','IBM','GE','DE','SBUX','AMAT','ADP','MDLZ',
        'PLD','ISRG','GS','GILD','BLK','BKNG','ADI','REGN','VRTX','MMC',
        'SYK','CI','TJX','TMUS','CB','PGR','SO','DUK','ZTS','LRCX',
        'BSX','SCHW','BDX','MO','PYPL','AON','CSX','CL','SLB','CME',
        'EQIX','AXP','APD','EMR','ITW','PNC','NOC','SNPS','CDNS','ETN',
        'ICE','GD','CCI','FDX','SHW','NSC','MPC','WM','EOG','MCK',
        'ORLY','HUM','ROP','KMB','AIG','SPG','AEP','D','GM','F',
        'PSA','EW','GIS','SRE','TFC','USB','TRV','WELL','DG','DLTR',
        'AZO','MNST','FAST','ODFL','MCHP','FTNT','DXCM','IDXX','MRNA','ON',
        'ENPH','FSLR','SEDG','CTRA','DVN','HAL','OXY','PSX','VLO','MRO',
        'ABNB','UBER','DASH','SQ','SNAP','PINS','ROKU','COIN','HOOD','RIVN',
        'LCID','PLTR','SOFI','DKNG','RBLX','TTD','CRWD','ZS','NET','SNOW',
        'DDOG','MDB','PANW','OKTA','BILL','HUBS','TEAM','WDAY','VEEV','TWLO',
        'SE','SHOP','MELI','NU','GRAB','BABA','JD','PDD','NIO','XPEV',
        'LI','TSM','ASML','ARM','SMCI','MRVL','MU','KLAC','ANET','FICO'
    ];

    // NASDAQ 100 most actively traded
    const NASDAQ100 = [
        'AAPL','MSFT','AMZN','NVDA','GOOGL','GOOG','META','TSLA','AVGO','COST',
        'NFLX','AMD','ADBE','PEP','CSCO','INTC','TMUS','CMCSA','TXN','QCOM',
        'AMGN','INTU','AMAT','ISRG','BKNG','ADI','LRCX','MDLZ','GILD','VRTX',
        'ADP','REGN','SNPS','CDNS','PYPL','KLAC','MELI','FTNT','MNST','MCHP',
        'DXCM','ORLY','KDP','NXPI','IDXX','ON','CRWD','DASH','FANG','CTAS',
        'ABNB','KHC','EXC','ODFL','FAST','BKR','AZN','MRNA','DLTR','ROST',
        'DDOG','XEL','WDAY','EA','VRSK','WBD','ZS','PCAR','BIIB','ILMN',
        'SIRI','ANSS','CEG','TTD','CPRT','TEAM','PANW','GEHC','CDW','CHTR',
        'MRVL','PAYX','MDB','ENPH','SPLK','GFS','RIVN','LCID','COIN','HOOD'
    ];

    // Popular high-volume US stocks for options
    const POPULAR_US = [
        'AAPL','MSFT','AMZN','NVDA','TSLA','META','GOOGL','AMD','NFLX','SPY',
        'QQQ','IWM','DIA','BABA','NIO','PLTR','SOFI','COIN','HOOD','SNAP',
        'UBER','ABNB','SQ','PYPL','ROKU','DKNG','RIVN','LCID','MARA','RIOT',
        'GME','AMC','BB','BBBY','WISH','CLOV','INTC','BAC','F','GE',
        'T','VZ','WFC','C','PFE','MRNA','BNTX','JNJ','XOM','CVX',
        'CCL','DAL','UAL','AAL','LUV','BA','DIS','CMCSA','WMT','TGT',
        'COST','HD','LOW','NKE','SBUX','MCD','KO','PEP','PG','JNJ',
        'MRK','ABBV','LLY','UNH','CVS','WBA','GILD','AMGN','BIIB','REGN',
        'GS','JPM','MS','V','MA','AXP','BRK.B','BLK','SCHW','USB',
        'XLF','XLE','XLK','XLV','XLI','XLP','XLU','XLB','XLRE','XLC'
    ];

    // SGX Straits Times Index - Singapore's benchmark
    const STI = [
        'D05.SI',  // DBS Group
        'O39.SI',  // OCBC Bank
        'U11.SI',  // UOB
        'Z74.SI',  // Singapore Telecommunications (SingTel)
        'BN4.SI',  // Keppel Corporation
        'C38U.SI', // CapitaLand Integrated Commercial Trust
        'A17U.SI', // CapitaLand Ascendas REIT
        'C09.SI',  // City Developments
        'U96.SI',  // Sembcorp Industries
        'Y92.SI',  // Thai Beverage
        'G13.SI',  // Genting Singapore
        'S58.SI',  // SATS
        'C6L.SI',  // Singapore Airlines
        'N2IU.SI', // Mapletree Pan Asia Commercial Trust
        'ME8U.SI', // Mapletree Industrial Trust
        'M44U.SI', // Mapletree Logistics Trust
        'H78.SI',  // Hongkong Land Holdings
        'F34.SI',  // Wilmar International
        'BS6.SI',  // Yangzijiang Shipbuilding
        'U14.SI',  // UOL Group
        'S63.SI',  // Singapore Technologies Engineering
        'S68.SI',  // Singapore Exchange
        'V03.SI',  // Venture Corporation
        'CC3.SI',  // StarHub
        'J36.SI',  // Jardine Matheson
        'H02.SI',  // Jardine C&C
        'C52.SI',  // ComfortDelGro
        'E5H.SI',  // Golden Agri-Resources
        'UD1U.SI', // Frasers Logistics & Commercial Trust
        'BUOU.SI', // Frasers Centrepoint Trust
    ];

    // Popular SGX stocks with decent volume
    const POPULAR_SGX = [
        'D05.SI','O39.SI','U11.SI','Z74.SI','BN4.SI','C38U.SI','A17U.SI',
        'C09.SI','U96.SI','Y92.SI','G13.SI','S58.SI','C6L.SI','N2IU.SI',
        'ME8U.SI','M44U.SI','F34.SI','BS6.SI','S63.SI','S68.SI','V03.SI',
        'CC3.SI','C52.SI','J36.SI','H78.SI','U14.SI',
        '9CI.SI',  // CapitaLand Investment
        'J69U.SI', // Frasers Centrepoint Trust
        'T39.SI',  // SPH (Singapore Press Holdings)
        'S51.SI',  // Seatrium (formerly Sembcorp Marine)
        'AWX.SI',  // AEM Holdings
        'RE4.SI',  // Sheng Siong Group
        'A7RU.SI', // Keppel DC REIT
        'AJBU.SI', // Keppel Infrastructure Trust
        'TQ5.SI',  // Frasers Property
    ];

    // All SGX options-eligible stocks
    const ALL_SGX = [...new Set([...STI, ...POPULAR_SGX])];

    // Get tickers based on market and universe selection
    function getTickers(market, universe) {
        if (market === 'US' || market === 'ALL') {
            let usTickers;
            switch (universe) {
                case 'sp500': usTickers = SP500; break;
                case 'nasdaq100': usTickers = NASDAQ100; break;
                case 'popular': usTickers = POPULAR_US; break;
                case 'all': usTickers = [...new Set([...SP500, ...NASDAQ100, ...POPULAR_US])]; break;
                default: usTickers = SP500;
            }
            if (market === 'US') return usTickers;
        }

        if (market === 'SGX' || market === 'ALL') {
            let sgxTickers;
            switch (universe) {
                case 'sti': sgxTickers = STI; break;
                case 'popular_sgx': sgxTickers = POPULAR_SGX; break;
                case 'all_sgx': sgxTickers = ALL_SGX; break;
                default: sgxTickers = STI;
            }
            if (market === 'SGX') return sgxTickers;
        }

        if (market === 'ALL') {
            const usUniverse = universe || 'sp500';
            const sgxUni = universe || 'sti';
            let us, sgx;
            switch (usUniverse) {
                case 'sp500': us = SP500; break;
                case 'nasdaq100': us = NASDAQ100; break;
                case 'popular': us = POPULAR_US; break;
                default: us = SP500;
            }
            switch (sgxUni) {
                case 'sti': sgx = STI; break;
                case 'popular_sgx': sgx = POPULAR_SGX; break;
                default: sgx = STI;
            }
            return [...us, ...sgx];
        }

        return SP500;
    }

    // Determine market from ticker
    function getMarket(ticker) {
        if (ticker.endsWith('.SI')) return 'SGX';
        return 'US';
    }

    // Get currency for market
    function getCurrency(market) {
        return market === 'SGX' ? 'SGD' : 'USD';
    }

    // Get display name for a ticker
    const TICKER_NAMES = {
        'AAPL': 'Apple Inc.', 'MSFT': 'Microsoft Corp.', 'AMZN': 'Amazon.com',
        'NVDA': 'NVIDIA Corp.', 'GOOGL': 'Alphabet Inc.', 'META': 'Meta Platforms',
        'TSLA': 'Tesla Inc.', 'AMD': 'AMD Inc.', 'NFLX': 'Netflix Inc.',
        'JPM': 'JPMorgan Chase', 'V': 'Visa Inc.', 'MA': 'Mastercard',
        'D05.SI': 'DBS Group', 'O39.SI': 'OCBC Bank', 'U11.SI': 'UOB',
        'Z74.SI': 'SingTel', 'BN4.SI': 'Keppel Corp', 'C38U.SI': 'CapitaLand CICT',
        'A17U.SI': 'CapitaLand Ascendas REIT', 'C6L.SI': 'Singapore Airlines',
        'G13.SI': 'Genting Singapore', 'S68.SI': 'SGX', 'BS6.SI': 'Yangzijiang',
        'S63.SI': 'ST Engineering', 'F34.SI': 'Wilmar Intl', 'C09.SI': 'City Devt',
        'U96.SI': 'Sembcorp Ind', 'Y92.SI': 'Thai Beverage',
    };

    function getTickerName(ticker) {
        return TICKER_NAMES[ticker] || ticker;
    }

    return {
        SP500, NASDAQ100, POPULAR_US, STI, POPULAR_SGX, ALL_SGX,
        getTickers, getMarket, getCurrency, getTickerName
    };
})();
