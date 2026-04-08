/**
 * Main Application Controller
 * Handles UI interactions, tab navigation, and ties all modules together
 * OptiMax Scanner
 */

const App = (() => {
    // State
    let currentTab = 'scanner';
    let currentMarket = 'US';
    let currentSort = { field: 'score', ascending: false };
    let watchlist = [];
    let scanStartTime = 0;

    // ===== Initialization =====
    function init() {
        loadWatchlist();
        loadSettings();
        setupEventListeners();
        updateMarketStatus();
        setInterval(updateMarketStatus, 60000);
        console.log('OptiMax Scanner initialized');
    }

    // ===== Event Listeners =====
    function setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });

        // Market toggle
        document.querySelectorAll('.market-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.market-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentMarket = btn.dataset.market;
            });
        });

        // Scan button
        document.getElementById('scanBtn').addEventListener('click', startScan);

        // Export button
        document.getElementById('exportBtn').addEventListener('click', exportResults);

        // Sort button
        document.getElementById('sortBtn').addEventListener('click', cycleSortField);

        // Table header sorting
        document.querySelectorAll('.results-table thead th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (currentSort.field === field) {
                    currentSort.ascending = !currentSort.ascending;
                } else {
                    currentSort.field = field;
                    currentSort.ascending = false;
                }
                const results = Scanner.sortResults(currentSort.field, currentSort.ascending);
                renderResults(results);
            });
        });

        // Watchlist
        document.getElementById('addTickerBtn').addEventListener('click', addToWatchlist);
        document.getElementById('addTickerInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') addToWatchlist();
        });

        // Strategy calculator
        document.getElementById('calcStratBtn').addEventListener('click', calculateStrategy);

        // API Key modal
        document.getElementById('apiKeyBtn').addEventListener('click', () => openModal('apiKeyModal'));
        document.getElementById('apiKeyModalClose').addEventListener('click', () => closeModal('apiKeyModal'));
        document.getElementById('saveModalApiKey').addEventListener('click', saveApiKeyFromModal);

        // Detail modal
        document.getElementById('modalClose').addEventListener('click', () => closeModal('detailModal'));

        // Settings
        document.getElementById('saveApiKey').addEventListener('click', saveSettings);
        document.getElementById('dataProvider').addEventListener('change', (e) => {
            API.setConfig('provider', e.target.value);
        });
        document.getElementById('corsProxy').addEventListener('change', (e) => {
            API.setConfig('corsProxy', e.target.value);
        });
        document.getElementById('batchSize').addEventListener('change', (e) => {
            API.setConfig('batchSize', parseInt(e.target.value) || 10);
        });
        document.getElementById('requestDelay').addEventListener('change', (e) => {
            API.setConfig('requestDelay', parseInt(e.target.value) || 500);
        });

        // Close modals on overlay click
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal(modal.id);
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
            }
        });
    }

    // ===== Tab Navigation =====
    function switchTab(tabId) {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
        document.getElementById(`tab-${tabId}`).classList.add('active');
        currentTab = tabId;
    }

    // ===== Scanner =====
    async function startScan() {
        const scanBtn = document.getElementById('scanBtn');
        const state = Scanner.getState();

        if (state.isScanning) {
            Scanner.stop();
            scanBtn.innerHTML = '<span class="scan-icon">&#9654;</span> Scan Market';
            scanBtn.classList.remove('scanning');
            hideProgress();
            showToast('Scan stopped', 'warning');
            return;
        }

        // Get filters
        const filters = {
            market: currentMarket,
            strategy: document.getElementById('strategyFilter').value,
            minVolume: parseInt(document.getElementById('minVolume').value) || 0,
            maxDTE: parseInt(document.getElementById('maxDTE').value) || 45,
            minGain: parseInt(document.getElementById('minGain').value) || 0,
            maxRisk: parseInt(document.getElementById('maxRisk').value) || 10000,
            usUniverse: document.getElementById('usUniverse')?.value || 'sp500',
            sgxUniverse: document.getElementById('sgxUniverse')?.value || 'sti',
        };

        // UI updates
        scanBtn.innerHTML = '<span class="spinner"></span> Stop Scan';
        scanBtn.classList.add('scanning');
        showProgress();
        clearResults();
        scanStartTime = Date.now();

        updateStat('statScanned', '0');
        updateStat('statFound', '0');
        updateStat('statBestGain', '--');
        updateStat('statAvgIV', '--');
        updateStat('statScanTime', '--');

        showToast(`Scanning ${currentMarket} market...`, 'info');

        let bestGain = 0;
        let totalIV = 0;
        let ivCount = 0;

        try {
            const results = await Scanner.scan(
                filters,
                // Progress callback
                (scanned, total, ticker) => {
                    const pct = Math.round((scanned / total) * 100);
                    updateProgress(pct, `Scanning ${ticker} (${scanned}/${total})`);
                    updateStat('statScanned', scanned.toString());
                },
                // Result callback
                (result) => {
                    updateStat('statFound', Scanner.getState().resultCount.toString());
                    if (result.maxGainPercent > bestGain) {
                        bestGain = result.maxGainPercent;
                        updateStat('statBestGain', bestGain.toFixed(1) + '%');
                    }
                    if (result.ivRank) {
                        totalIV += result.ivRank;
                        ivCount++;
                        updateStat('statAvgIV', Math.round(totalIV / ivCount).toString());
                    }
                }
            );

            // Final stats
            const elapsed = ((Date.now() - scanStartTime) / 1000).toFixed(1);
            updateStat('statScanTime', elapsed + 's');
            updateStat('statFound', results.length.toString());

            renderResults(results);
            showToast(`Scan complete! Found ${results.length} opportunities`, 'success');

        } catch (err) {
            showToast(`Scan error: ${err.message}`, 'error');
            console.error('Scan error:', err);
        }

        // Reset button
        scanBtn.innerHTML = '<span class="scan-icon">&#9654;</span> Scan Market';
        scanBtn.classList.remove('scanning');
        hideProgress();
    }

    // ===== Results Rendering =====
    function renderResults(results) {
        const tbody = document.getElementById('resultsBody');

        if (!results || results.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="17">
                        <div class="empty-state">
                            <div class="empty-icon">&#128269;</div>
                            <p>No opportunities found matching your filters</p>
                            <p class="empty-hint">Try adjusting your filters or scanning a different market</p>
                        </div>
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = results.map((r, i) => {
            const gainClass = r.maxGainPercent >= 100 ? 'gain-positive' : (r.maxGainPercent >= 0 ? '' : 'gain-negative');
            const scoreClass = r.score >= 70 ? 'score-high' : (r.score >= 45 ? 'score-medium' : 'score-low');
            const marketClass = r.market === 'US' ? 'market-us' : 'market-sgx';
            const isStarred = watchlist.includes(r.ticker);

            const strikeDisplay = r.strikes || (r.strike ? r.strike.toFixed(2) : '--');
            const premiumDisplay = r.premium ? r.premium.toFixed(2) : '--';
            const maxLossDisplay = typeof r.maxLoss === 'number' ? r.maxLoss.toFixed(0) : r.maxLoss;
            const breakevenDisplay = typeof r.breakeven === 'number' ? r.breakeven.toFixed(2) : r.breakeven;
            const ivDisplay = r.iv ? (r.iv * 100).toFixed(1) + '%' : '--';

            return `<tr data-index="${i}">
                <td>${i + 1}</td>
                <td class="ticker-cell" onclick="App.showDetail(${i})">${r.ticker}</td>
                <td><span class="market-badge ${marketClass}">${r.market}</span></td>
                <td>${r.stockPrice?.toFixed(2) || '--'}</td>
                <td><span class="strategy-badge">${r.strategyName}</span></td>
                <td>${strikeDisplay}</td>
                <td>${r.expiry || '--'}</td>
                <td>${r.dte || '--'}</td>
                <td>${premiumDisplay}</td>
                <td class="${gainClass}">${r.maxGainPercent?.toFixed(1) || '--'}%</td>
                <td>${maxLossDisplay}</td>
                <td>${breakevenDisplay}</td>
                <td>${ivDisplay}</td>
                <td>${r.ivRank || '--'}</td>
                <td>${r.volume?.toLocaleString() || '--'}</td>
                <td><span class="${scoreClass}">${r.score}</span></td>
                <td>
                    <button class="star-btn ${isStarred ? 'starred' : ''}" onclick="App.toggleWatchlist('${r.ticker}')" title="Add to watchlist">
                        ${isStarred ? '&#9733;' : '&#9734;'}
                    </button>
                    <button class="detail-btn" onclick="App.showDetail(${i})">View</button>
                </td>
            </tr>`;
        }).join('');
    }

    function clearResults() {
        document.getElementById('resultsBody').innerHTML = `
            <tr class="empty-row">
                <td colspan="17">
                    <div class="empty-state">
                        <div class="empty-icon"><span class="spinner" style="width:24px;height:24px;border-width:3px;"></span></div>
                        <p>Scanning in progress...</p>
                    </div>
                </td>
            </tr>`;
    }

    // ===== Detail Modal =====
    function showDetail(index) {
        const results = Scanner.getResults();
        if (index < 0 || index >= results.length) return;

        const r = results[index];
        const modal = document.getElementById('detailModal');
        const title = document.getElementById('modalTitle');
        const body = document.getElementById('modalBody');

        title.textContent = `${r.ticker} - ${r.strategyName}`;

        const maxGainStr = r.maxGain === 'Unlimited' ? 'Unlimited' : `$${r.maxGain?.toFixed(2)}`;

        body.innerHTML = `
            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-item-label">Stock Price</div>
                    <div class="detail-item-value">${r.currency} ${r.stockPrice?.toFixed(2)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Strike(s)</div>
                    <div class="detail-item-value">${r.strikes || r.strike?.toFixed(2) || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Premium</div>
                    <div class="detail-item-value">${r.currency} ${r.premium?.toFixed(2)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Expiry</div>
                    <div class="detail-item-value">${r.expiry} (${r.dte} DTE)</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Max Gain</div>
                    <div class="detail-item-value" style="color:var(--accent-green)">${maxGainStr} (${r.maxGainPercent?.toFixed(1)}%)</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Max Loss</div>
                    <div class="detail-item-value" style="color:var(--accent-red)">$${typeof r.maxLoss === 'number' ? r.maxLoss.toFixed(2) : r.maxLoss}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Breakeven</div>
                    <div class="detail-item-value">${typeof r.breakeven === 'number' ? r.breakeven.toFixed(2) : r.breakeven}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Risk/Reward</div>
                    <div class="detail-item-value">${r.riskReward?.toFixed(2)}x</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">IV</div>
                    <div class="detail-item-value">${r.iv ? (r.iv * 100).toFixed(1) : '--'}%</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">IV Rank</div>
                    <div class="detail-item-value">${r.ivRank || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Volume</div>
                    <div class="detail-item-value">${r.volume?.toLocaleString() || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Score</div>
                    <div class="detail-item-value" style="color:var(--accent-blue)">${r.score}/100</div>
                </div>
            </div>
            <div class="payoff-diagram" id="payoffCanvas"></div>
            <p style="margin-top:0.75rem;font-size:0.78rem;color:var(--text-muted);">
                Strategy: ${OptionsCalc.STRATEGIES[r.strategy]?.description || r.strategyName}
            </p>
        `;

        openModal('detailModal');

        // Draw payoff diagram
        setTimeout(() => drawPayoffDiagram(r), 100);
    }

    // ===== Payoff Diagram (Canvas) =====
    function drawPayoffDiagram(result) {
        const container = document.getElementById('payoffCanvas');
        if (!container) return;

        const canvas = document.createElement('canvas');
        canvas.width = container.offsetWidth * 2;
        canvas.height = container.offsetHeight * 2;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        container.innerHTML = '';
        container.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        // Generate payoff data
        let params = { stockPrice: result.stockPrice };
        if (result.strategy === 'long_call') {
            params.strike = result.strike;
            params.premium = result.premium;
        } else if (result.strategy === 'long_put') {
            params.strike = result.strike;
            params.premium = result.premium;
        } else if (result.strategy === 'bull_call_spread') {
            const strikes = result.strikes.split('/');
            params.longStrike = parseFloat(strikes[0]);
            params.shortStrike = parseFloat(strikes[1]);
            params.longPremium = result.premium + 1; // approximate
            params.shortPremium = 1;
        } else if (result.strategy === 'straddle') {
            params.strike = result.strike;
            params.totalPremium = result.premium;
        } else if (result.strategy === 'strangle') {
            const strikes = result.strikes.split('/');
            params.putStrike = parseFloat(strikes[0]);
            params.callStrike = parseFloat(strikes[1]);
            params.totalPremium = result.premium;
        } else if (result.strategy === 'covered_call') {
            params.strike = result.strike;
            params.premium = result.premium;
        } else {
            params.strike = result.strike || result.stockPrice;
            params.premium = result.premium || 0;
        }

        const points = OptionsCalc.generatePayoff(result.strategy, params);
        if (points.length === 0) return;

        const prices = points.map(p => p.price);
        const profits = points.map(p => p.profit);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const minProfit = Math.min(...profits);
        const maxProfit = Math.max(...profits);

        const padding = { top: 40, right: 40, bottom: 50, left: 70 };
        const plotW = w - padding.left - padding.right;
        const plotH = h - padding.top - padding.bottom;

        const scaleX = (price) => padding.left + ((price - minPrice) / (maxPrice - minPrice)) * plotW;
        const profitRange = Math.max(maxProfit - minProfit, 1);
        const scaleY = (profit) => padding.top + plotH - ((profit - minProfit) / profitRange) * plotH;

        // Background
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, w, h);

        // Grid
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (plotH / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(w - padding.right, y);
            ctx.stroke();
        }

        // Zero line
        const zeroY = scaleY(0);
        if (zeroY >= padding.top && zeroY <= padding.top + plotH) {
            ctx.strokeStyle = '#374151';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(padding.left, zeroY);
            ctx.lineTo(w - padding.right, zeroY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Current price line
        const currX = scaleX(result.stockPrice);
        ctx.strokeStyle = '#6b7280';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(currX, padding.top);
        ctx.lineTo(currX, padding.top + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Payoff line
        ctx.beginPath();
        ctx.moveTo(scaleX(points[0].price), scaleY(points[0].profit));
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(scaleX(points[i].price), scaleY(points[i].profit));
        }
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Fill profit area green, loss area red
        for (let i = 0; i < points.length - 1; i++) {
            const x1 = scaleX(points[i].price);
            const x2 = scaleX(points[i + 1].price);
            const y1 = scaleY(points[i].profit);
            const y2 = scaleY(points[i + 1].profit);
            const zy = scaleY(0);

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineTo(x2, zy);
            ctx.lineTo(x1, zy);
            ctx.closePath();

            const avgProfit = (points[i].profit + points[i + 1].profit) / 2;
            ctx.fillStyle = avgProfit >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
            ctx.fill();
        }

        // Labels
        ctx.fillStyle = '#9ca3af';
        ctx.font = '22px Inter, sans-serif';
        ctx.textAlign = 'center';

        // X-axis labels
        for (let i = 0; i <= 4; i++) {
            const price = minPrice + (maxPrice - minPrice) * (i / 4);
            ctx.fillText('$' + price.toFixed(0), scaleX(price), h - 15);
        }

        // Y-axis labels
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const profit = minProfit + profitRange * (1 - i / 4);
            ctx.fillText('$' + profit.toFixed(0), padding.left - 10, padding.top + (plotH / 4) * i + 7);
        }

        // Title
        ctx.fillStyle = '#e5e7eb';
        ctx.font = 'bold 24px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('P&L at Expiration', w / 2, 28);

        // Current price label
        ctx.fillStyle = '#9ca3af';
        ctx.font = '18px Inter, sans-serif';
        ctx.fillText('Current: $' + result.stockPrice.toFixed(2), currX, padding.top - 8);
    }

    // ===== Strategy Calculator =====
    function calculateStrategy() {
        const stratType = document.getElementById('stratType').value;
        const stockPrice = parseFloat(document.getElementById('stratStockPrice').value);
        const strike1 = parseFloat(document.getElementById('stratStrike1').value);
        const strike2 = parseFloat(document.getElementById('stratStrike2').value);
        const premium1 = parseFloat(document.getElementById('stratPremium1').value);
        const premium2 = parseFloat(document.getElementById('stratPremium2').value);
        const dte = parseInt(document.getElementById('stratDTE').value) || 30;

        if (!stockPrice || stockPrice <= 0) {
            showToast('Please enter a valid stock price', 'error');
            return;
        }

        let result;
        try {
            switch (stratType) {
                case 'long_call':
                    if (!strike1 || !premium1) { showToast('Enter Strike 1 and Premium 1', 'error'); return; }
                    result = OptionsCalc.calcLongCall(stockPrice, strike1, premium1, dte);
                    break;
                case 'long_put':
                    if (!strike1 || !premium1) { showToast('Enter Strike 1 and Premium 1', 'error'); return; }
                    result = OptionsCalc.calcLongPut(stockPrice, strike1, premium1, dte);
                    break;
                case 'bull_call_spread':
                    if (!strike1 || !strike2 || !premium1 || !premium2) { showToast('Enter both strikes and premiums', 'error'); return; }
                    result = OptionsCalc.calcBullCallSpread(stockPrice, strike1, strike2, premium1, premium2, dte);
                    break;
                case 'bear_put_spread':
                    if (!strike1 || !strike2 || !premium1 || !premium2) { showToast('Enter both strikes and premiums', 'error'); return; }
                    result = OptionsCalc.calcBearPutSpread(stockPrice, strike1, strike2, premium1, premium2, dte);
                    break;
                case 'straddle':
                    if (!strike1 || !premium1 || !premium2) { showToast('Enter Strike 1, Premium 1 (call), Premium 2 (put)', 'error'); return; }
                    result = OptionsCalc.calcStraddle(stockPrice, strike1, premium1, premium2, dte);
                    break;
                case 'strangle':
                    if (!strike1 || !strike2 || !premium1 || !premium2) { showToast('Enter both strikes and premiums', 'error'); return; }
                    result = OptionsCalc.calcStrangle(stockPrice, strike1, strike2, premium1, premium2, dte);
                    break;
                case 'covered_call':
                    if (!strike1 || !premium1) { showToast('Enter Strike 1 and Premium 1', 'error'); return; }
                    result = OptionsCalc.calcCoveredCall(stockPrice, strike1, premium1, dte);
                    break;
                default:
                    showToast('Strategy not implemented yet', 'warning');
                    return;
            }
        } catch (err) {
            showToast('Calculation error: ' + err.message, 'error');
            return;
        }

        renderStrategyResult(result, stockPrice);
    }

    function renderStrategyResult(result, stockPrice) {
        const container = document.getElementById('stratResults');
        const maxGainStr = result.maxGain === 'Unlimited' ? 'Unlimited' : `$${result.maxGain?.toFixed(2)}`;

        container.innerHTML = `
            <div class="strategy-results-grid">
                <div class="strat-result-card">
                    <div class="strat-result-label">Max Gain</div>
                    <div class="strat-result-value" style="color:var(--accent-green)">${maxGainStr}</div>
                </div>
                <div class="strat-result-card">
                    <div class="strat-result-label">Max Gain %</div>
                    <div class="strat-result-value" style="color:var(--accent-green)">${result.maxGainPercent?.toFixed(1)}%</div>
                </div>
                <div class="strat-result-card">
                    <div class="strat-result-label">Max Loss</div>
                    <div class="strat-result-value" style="color:var(--accent-red)">$${result.maxLoss?.toFixed(2)}</div>
                </div>
                <div class="strat-result-card">
                    <div class="strat-result-label">Cost / Contract</div>
                    <div class="strat-result-value">$${Math.abs(result.cost)?.toFixed(2)}</div>
                </div>
                <div class="strat-result-card">
                    <div class="strat-result-label">Breakeven</div>
                    <div class="strat-result-value">${typeof result.breakeven === 'number' ? '$' + result.breakeven.toFixed(2) : result.breakeven}</div>
                </div>
                <div class="strat-result-card">
                    <div class="strat-result-label">Risk / Reward</div>
                    <div class="strat-result-value">${result.riskReward?.toFixed(2)}x</div>
                </div>
            </div>
            <div class="payoff-diagram" id="stratPayoffCanvas"></div>
        `;

        // Draw payoff
        setTimeout(() => {
            const fakeResult = { ...result, stockPrice };
            drawPayoffDiagramInContainer(fakeResult, 'stratPayoffCanvas');
        }, 100);
    }

    function drawPayoffDiagramInContainer(result, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Reuse the same drawPayoffDiagram logic
        const tempPayoff = document.getElementById('payoffCanvas');
        const origId = container.id;
        container.id = 'payoffCanvas';
        drawPayoffDiagram(result);
        container.id = origId;
    }

    // ===== Watchlist =====
    function addToWatchlist() {
        const input = document.getElementById('addTickerInput');
        const ticker = input.value.trim().toUpperCase();
        if (!ticker) return;

        if (!watchlist.includes(ticker)) {
            watchlist.push(ticker);
            saveWatchlist();
            renderWatchlist();
            showToast(`${ticker} added to watchlist`, 'success');
        } else {
            showToast(`${ticker} already in watchlist`, 'warning');
        }
        input.value = '';
    }

    function toggleWatchlist(ticker) {
        const idx = watchlist.indexOf(ticker);
        if (idx >= 0) {
            watchlist.splice(idx, 1);
            showToast(`${ticker} removed from watchlist`, 'info');
        } else {
            watchlist.push(ticker);
            showToast(`${ticker} added to watchlist`, 'success');
        }
        saveWatchlist();
        // Re-render current results to update star icons
        const results = Scanner.getResults();
        if (results.length > 0) renderResults(results);
        renderWatchlist();
    }

    function renderWatchlist() {
        const grid = document.getElementById('watchlistGrid');
        if (watchlist.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">&#11088;</div>
                    <p>Your watchlist is empty</p>
                    <p class="empty-hint">Add tickers above or click the star icon on scan results</p>
                </div>`;
            return;
        }

        grid.innerHTML = watchlist.map(ticker => {
            const name = MarketData.getTickerName(ticker);
            const market = MarketData.getMarket(ticker);
            const currency = MarketData.getCurrency(market);

            return `<div class="watchlist-card">
                <div class="watchlist-card-header">
                    <span class="watchlist-card-ticker">${ticker}</span>
                    <button class="watchlist-remove" onclick="App.toggleWatchlist('${ticker}')" title="Remove">&times;</button>
                </div>
                <div class="watchlist-card-details">
                    <span class="watchlist-detail-label">Name</span>
                    <span class="watchlist-detail-value">${name}</span>
                    <span class="watchlist-detail-label">Market</span>
                    <span class="watchlist-detail-value">${market}</span>
                    <span class="watchlist-detail-label">Currency</span>
                    <span class="watchlist-detail-value">${currency}</span>
                </div>
            </div>`;
        }).join('');
    }

    function loadWatchlist() {
        try {
            const saved = localStorage.getItem('optimax_watchlist');
            if (saved) watchlist = JSON.parse(saved);
        } catch (e) { watchlist = []; }
        renderWatchlist();
    }

    function saveWatchlist() {
        try {
            localStorage.setItem('optimax_watchlist', JSON.stringify(watchlist));
        } catch (e) { /* ignore */ }
    }

    // ===== Settings =====
    function loadSettings() {
        const cfg = API.getConfig();
        const providerEl = document.getElementById('dataProvider');
        const apiKeyEl = document.getElementById('apiKeyInput');
        const corsEl = document.getElementById('corsProxy');
        const batchEl = document.getElementById('batchSize');
        const delayEl = document.getElementById('requestDelay');

        if (providerEl) providerEl.value = cfg.provider || 'yahoo';
        if (apiKeyEl) apiKeyEl.value = cfg.apiKey || '';
        if (corsEl) corsEl.value = cfg.corsProxy || 'corsproxy';
        if (batchEl) batchEl.value = cfg.batchSize || 10;
        if (delayEl) delayEl.value = cfg.requestDelay || 500;
    }

    function saveSettings() {
        const apiKey = document.getElementById('apiKeyInput').value.trim();
        API.setConfig('apiKey', apiKey);
        showToast('Settings saved', 'success');
    }

    function saveApiKeyFromModal() {
        const provider = document.getElementById('modalProvider').value;
        const apiKey = document.getElementById('modalApiKey').value.trim();
        API.setConfig('provider', provider);
        API.setConfig('apiKey', apiKey);

        // Update settings tab too
        document.getElementById('dataProvider').value = provider;
        document.getElementById('apiKeyInput').value = apiKey;

        closeModal('apiKeyModal');
        showToast('API configuration saved', 'success');
    }

    // ===== Market Status =====
    function updateMarketStatus() {
        const now = new Date();
        const utcHour = now.getUTCHours();
        const utcMin = now.getUTCMinutes();
        const utcDay = now.getUTCDay();
        const dot = document.querySelector('.status-dot');
        const text = document.querySelector('.status-text');

        // US market: 9:30 AM - 4:00 PM ET (13:30 - 20:00 UTC)
        const isWeekday = utcDay >= 1 && utcDay <= 5;
        const utcTime = utcHour * 60 + utcMin;
        const usOpen = utcTime >= 810 && utcTime < 1200; // 13:30 - 20:00 UTC

        // SGX market: 9:00 AM - 5:00 PM SGT (1:00 - 9:00 UTC)
        const sgxOpen = utcTime >= 60 && utcTime < 540;

        if (isWeekday && (usOpen || sgxOpen)) {
            dot.classList.add('open');
            const markets = [];
            if (usOpen) markets.push('US');
            if (sgxOpen) markets.push('SGX');
            text.textContent = `${markets.join(' & ')} Open`;
        } else {
            dot.classList.remove('open');
            text.textContent = 'Markets Closed';
        }
    }

    // ===== UI Helpers =====
    function openModal(id) {
        document.getElementById(id).classList.add('open');
    }

    function closeModal(id) {
        document.getElementById(id).classList.remove('open');
    }

    function showProgress() {
        document.getElementById('progressContainer').style.display = 'block';
    }

    function hideProgress() {
        document.getElementById('progressContainer').style.display = 'none';
    }

    function updateProgress(pct, text) {
        document.getElementById('progressFill').style.width = pct + '%';
        document.getElementById('progressText').textContent = text;
    }

    function updateStat(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = { success: '&#10003;', error: '&#10007;', warning: '&#9888;', info: '&#8505;' };
        toast.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    function cycleSortField() {
        const fields = ['score', 'maxGain', 'maxGainPercent', 'riskReward', 'volume', 'ivRank'];
        const names = ['Score', 'Max Gain $', 'Max Gain %', 'Risk/Reward', 'Volume', 'IV Rank'];
        const idx = fields.indexOf(currentSort.field);
        const nextIdx = (idx + 1) % fields.length;
        currentSort.field = fields[nextIdx];
        currentSort.ascending = false;

        const results = Scanner.sortResults(currentSort.field, currentSort.ascending);
        renderResults(results);
        showToast(`Sorted by ${names[nextIdx]}`, 'info');
    }

    function exportResults() {
        const csv = Scanner.exportCSV();
        if (!csv) {
            showToast('No results to export', 'warning');
            return;
        }

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `optimax_scan_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Results exported to CSV', 'success');
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API
    return {
        showDetail,
        toggleWatchlist,
    };
})();
