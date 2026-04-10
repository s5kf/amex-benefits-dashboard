// ==UserScript==
// @name         Amex Benefits Dashboard
// @namespace    https://github.com/amex-benefits-dashboard
// @version      1.1.0
// @author       jackie099 (forked by s5kf)
// @description  Unified benefits credit tracker across all Amex cards
// @match        https://global.americanexpress.com/*
// @match        https://www.americanexpress.com/*
// @grant        none
// @run-at       document-start
// @inject-into  page
// @sandbox      raw
// ==/UserScript==

(function () {
  'use strict';

  // With @grant none + @run-at document-start, we run in the page context directly
  const pageWindow = window;

  // ============================================================
  // Fetch Interceptor — capture card data from the page's own API calls
  // ============================================================
  const STORAGE_KEY_CARDS = 'amexDash_cardDetails';
  const STORAGE_KEY_TOKENS = 'amexDash_tokens';
  let interceptedCardDetails = [];
  let interceptedTokens = [];

  // Safely capture original fetch — may not exist at document-start on all browsers
  var originalFetch = window.fetch;
  if (!originalFetch) {
    // Wait for fetch to become available, then patch
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      set: function(val) {
        originalFetch = val;
        delete window.fetch;
        installFetchInterceptor();
      }
    });
  } else {
    installFetchInterceptor();
  }

  // Use original fetch for our own API calls (bypass our interceptor)
  function pageFetch() {
    return (originalFetch || window.fetch).apply(window, arguments);
  }
  function saveTokens(newTokens) {
    var seen = {};
    for (var i = 0; i < interceptedTokens.length; i++) seen[interceptedTokens[i]] = true;
    var added = false;
    for (var j = 0; j < newTokens.length; j++) {
      var t = newTokens[j];
      if (t.length >= 10 && t.length <= 20 && /^[A-Z0-9]+$/.test(t) && !seen[t]) {
        seen[t] = true;
        interceptedTokens.push(t);
        added = true;
      }
    }
    if (added) {
      console.debug('[AmexDash] Captured ' + interceptedTokens.length + ' account tokens');
      try { localStorage.setItem(STORAGE_KEY_TOKENS, JSON.stringify(interceptedTokens)); } catch(e) {}
    }
  }

  function extractTokensFromJson(str) {
    var tokens = [];
    // Look for accountToken fields with their values
    var re = /"accountToken[s]?"\s*:\s*(?:"([A-Z0-9]{10,20})"|(\[[^\]]*\]))/g;
    var m;
    while ((m = re.exec(str)) !== null) {
      if (m[1]) {
        tokens.push(m[1]);
      } else if (m[2]) {
        // Array of tokens
        var arrRe = /"([A-Z0-9]{10,20})"/g;
        var am;
        while ((am = arrRe.exec(m[2])) !== null) {
          tokens.push(am[1]);
        }
      }
    }
    return tokens;
  }

  function installFetchInterceptor() {
    if (!originalFetch) {
      console.warn('[AmexDash] Cannot install fetch interceptor — fetch not available');
      return;
    }
    console.debug('[AmexDash] Fetch interceptor installed');
    window.fetch = function() {
      try {
        var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || '';
        var opts = arguments[1] || {};
        var isAmexApi = url.indexOf('americanexpress.com') !== -1;

        if (!isAmexApi) {
          return originalFetch.apply(this, arguments);
        }

        // Capture accountTokens from request body
        if (opts.body) {
          try {
            var bodyStr = typeof opts.body === 'string' ? opts.body : '';
            if (bodyStr.indexOf('accountToken') !== -1 || bodyStr.indexOf('Token') !== -1) {
              saveTokens(extractTokensFromJson(bodyStr));
            }
          } catch(e) {}
        }

        // Inspect response bodies from endpoints that contain account data
        return originalFetch.apply(this, arguments).then(function(response) {
          var shouldInspectResponse =
            url.indexOf('ReadLoyaltyBenefitsCardProduct') !== -1 ||
            url.indexOf('ReadLoyaltyAccounts') !== -1 ||
            url.indexOf('ReadCustomerOverview') !== -1 ||
            url.indexOf('ReadBestLoyaltyBenefitsTrackers') !== -1;
          if (!shouldInspectResponse) return response;
          try {
            var clone = response.clone();
            clone.text().then(function(text) {
              try {
                if (text.indexOf('accountToken') !== -1) {
                  saveTokens(extractTokensFromJson(text));
                }
                if (url.indexOf('ReadLoyaltyBenefitsCardProduct') !== -1) {
                  var data = JSON.parse(text);
                  if (data && data.cardDetails && data.cardDetails.length > 0) {
                    interceptedCardDetails = data.cardDetails;
                    console.debug('[AmexDash] Intercepted ' + data.cardDetails.length + ' card details from API');
                    try { localStorage.setItem(STORAGE_KEY_CARDS, JSON.stringify(data.cardDetails)); } catch(e) {}
                  }
                }
              } catch(e) {}
            }).catch(function(){});
          } catch(e) {
            // Never let interceptor processing errors affect the page's fetch
          }
          return response;
        });
      } catch(e) {
        // Never break the page — fall through to original fetch
        return originalFetch.apply(this, arguments);
      }
    };
  }

  // ============================================================
  // Configuration
  // ============================================================
  const CONFIG = {
    CONCURRENCY: 3,
    MAX_RETRIES: 3,
    RETRY_BASE_DELAY: 2000,
    API_BASE: 'https://functions.americanexpress.com',
    DASHBOARD_PATH: '/card-benefits/view-all/dashboard',
  };

  const CARD_DISPLAY_NAMES = {
    'platinum': 'Platinum',
    'business-platinum': 'Biz Platinum',
    'business-gold': 'Biz Gold',
    'business-green': 'Biz Green',
    'gold': 'Gold',
    'green': 'Green',
    'amex-everyday-preferred': 'EveryDay Preferred',
    'amex-everyday': 'EveryDay',
    'blue-business-plus': 'Blue Biz Plus',
    'blue-business-cash': 'Blue Biz Cash',
    'hilton-honors-aspire': 'Hilton Aspire',
    'hilton-honors-surpass': 'Hilton Surpass',
    'marriott-bonvoy-brilliant': 'Marriott Brilliant',
    'delta-skymiles-reserve': 'Delta Reserve',
    'delta-skymiles-platinum': 'Delta Platinum',
    'delta-skymiles-gold': 'Delta Gold',
  };

  const DURATION_LABELS = {
    'Monthly': 'Monthly',
    'QuarterYear': 'Quarterly',
    'HalfYear': 'Semi-Annual',
    'CalenderYear': 'Annual',       // Amex typo preserved
    'CalendarYear': 'Annual',       // in case they fix it
  };

  /**
   * Calculate period length in months from start/end dates, and derive
   * the actual duration label and annual multiplier. Amex sometimes mislabels
   * durations (e.g., Hilton quarterly credit labeled as CalenderYear).
   */
  function detectPeriod(trackerDuration, startDate, endDate) {
    if (startDate && endDate) {
      // Parse as UTC to avoid timezone issues (Amex dates are date-only strings)
      const sp = String(startDate).slice(0, 10).split('-').map(Number);
      const ep = String(endDate).slice(0, 10).split('-').map(Number);
      const months = (ep[0] - sp[0]) * 12 + (ep[1] - sp[1]) + 1;
      if (months <= 1) return { duration: 'Monthly', label: 'Monthly', multiplier: 12 };
      if (months <= 3) return { duration: 'QuarterYear', label: 'Quarterly', multiplier: 4 };
      if (months <= 6) return { duration: 'HalfYear', label: 'Semi-Annual', multiplier: 2 };
      return { duration: trackerDuration, label: DURATION_LABELS[trackerDuration] || 'Annual', multiplier: 1 };
    }
    // Fallback to label-based
    if (trackerDuration === 'Monthly') return { duration: 'Monthly', label: 'Monthly', multiplier: 12 };
    if (trackerDuration === 'QuarterYear') return { duration: 'QuarterYear', label: 'Quarterly', multiplier: 4 };
    if (trackerDuration === 'HalfYear') return { duration: 'HalfYear', label: 'Semi-Annual', multiplier: 2 };
    return { duration: trackerDuration, label: DURATION_LABELS[trackerDuration] || trackerDuration, multiplier: 1 };
  }

  // Module-level state guard to prevent duplicate dashboard renders
  let dashboardActive = false;
  let originalContent = null;
  let dashboardGeneration = 0;

  console.log('[AmexDash] v1.1.0 loaded | readyState=' + document.readyState + ' | fetch=' + (typeof originalFetch) + ' | body=' + !!document.body);

  // ============================================================
  // Module 1: API Client
  // ============================================================

  class SessionExpiredError extends Error {
    constructor(message = 'Session expired') {
      super(message);
      this.name = 'SessionExpiredError';
    }
  }

  class RateLimitError extends Error {
    constructor(retryAfter, message = 'Rate limited') {
      super(message);
      this.name = 'RateLimitError';
      this.retryAfter = retryAfter;
    }
  }

  class FetchPool {
    constructor(concurrency) {
      this.concurrency = concurrency;
      this.running = 0;
      this.queue = [];
      this.rateLimitCount = 0;
    }

    enqueue(fn) {
      return new Promise((resolve, reject) => {
        this.queue.push({ fn, resolve, reject });
        this._drain();
      });
    }

    _drain() {
      while (this.running < this.concurrency && this.queue.length > 0) {
        const { fn, resolve, reject } = this.queue.shift();
        this.running++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.running--;
            this._drain();
          });
      }
    }

    onRateLimit() {
      this.rateLimitCount++;
      if (this.rateLimitCount >= 3 && this.concurrency > 1) {
        this.concurrency = 1;
        console.warn('[AmexDash] Multiple rate limits detected, reducing concurrency to 1');
      }
    }
  }

  async function amexApiFetch(endpoint, body, retries = CONFIG.MAX_RETRIES) {
    const url = `${CONFIG.API_BASE}${endpoint}`;
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await pageFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(body),
        });

        if (resp.status === 401 || resp.status === 403) {
          throw new SessionExpiredError();
        }

        if (resp.status === 429) {
          const retryAfter = parseInt(resp.headers.get('Retry-After') || '5', 10);
          throw new RateLimitError(retryAfter);
        }

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        return await resp.json();
      } catch (err) {
        lastError = err;

        if (err instanceof SessionExpiredError) {
          throw err; // don't retry auth failures
        }

        if (attempt < retries) {
          let delay;
          if (err instanceof RateLimitError) {
            delay = err.retryAfter * 1000;
          } else {
            delay = CONFIG.RETRY_BASE_DELAY * Math.pow(2, attempt);
          }
          console.warn(`[AmexDash] Retry ${attempt + 1}/${retries} for ${endpoint} in ${delay}ms`, err.message);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Extract account tokens from the page's DOM or inline scripts.
   * Fallback for when fetch interception doesn't work (Chrome MV3 isolated world).
   */
  function extractTokensFromDOM() {
    var tokens = [];
    var seen = {};
    try {
      // Method 1: Look for tokens in inline script tags (page bootstrap data)
      var scripts = document.querySelectorAll('script:not([src])');
      for (var i = 0; i < scripts.length; i++) {
        var text = scripts[i].textContent || '';
        if (text.indexOf('accountToken') !== -1) {
          // Match both "accountToken":"TOKEN" and "accountTokens":["TOKEN1","TOKEN2"]
          var found = extractTokensFromJson(text);
          for (var fi = 0; fi < found.length; fi++) {
            if (!seen[found[fi]]) { seen[found[fi]] = true; tokens.push(found[fi]); }
          }
        }
      }
      // Method 2: Inject a script element to read page globals (bypasses isolated world)
      // Note: may be blocked by CSP on Safari/strict Chrome — Method 3 below is the fallback
      if (tokens.length === 0) {
        try {
          var extractScript = document.createElement('script');
          extractScript.textContent = '(' + function() {
            try {
              var state = window.__INITIAL_STATE__ || window.__ONE_INITIAL_STATE__;
              if (state) {
                var json = JSON.stringify(state);
                var re = /\"accountToken[s]?\"\s*:\s*(?:\"([A-Z0-9]{10,20})\"|\[([^\]]*)\])/g;
                var tokens = [], seen = {}, m;
                while ((m = re.exec(json)) !== null) {
                  if (m[1] && !seen[m[1]]) { seen[m[1]] = true; tokens.push(m[1]); }
                  if (m[2]) {
                    var arrRe = /\"([A-Z0-9]{10,20})\"/g; var am;
                    while ((am = arrRe.exec(m[2])) !== null) {
                      if (!seen[am[1]]) { seen[am[1]] = true; tokens.push(am[1]); }
                    }
                  }
                }
                if (tokens.length > 0) {
                  document.documentElement.setAttribute('data-amexdash-tokens', JSON.stringify(tokens));
                }
              }
            } catch(e) {}
          } + ')();';
          document.documentElement.appendChild(extractScript);
          extractScript.remove();
          var attr = document.documentElement.getAttribute('data-amexdash-tokens');
          if (attr) {
            document.documentElement.removeAttribute('data-amexdash-tokens');
            try { tokens = JSON.parse(attr); } catch(e) {}
          }
        } catch(e) {
          // CSP blocked script injection — fall through to Method 3
        }
      }
      // Method 3: CSP-safe — scan the raw page HTML for token patterns (Safari/strict CSP fallback)
      if (tokens.length === 0) {
        var html = document.documentElement.innerHTML || '';
        var found = extractTokensFromJson(html);
        for (var hi = 0; hi < found.length; hi++) {
          if (!seen[found[hi]]) { seen[found[hi]] = true; tokens.push(found[hi]); }
        }
      }
    } catch(e) {
      console.warn('[AmexDash] DOM token extraction failed:', e.message);
    }
    if (tokens.length > 0) {
      console.debug('[AmexDash] Extracted ' + tokens.length + ' tokens from DOM');
    }
    return tokens;
  }

  /**
   * Get card details from intercepted data, localStorage cache, DOM extraction, or API call.
   * Returns array of card detail objects.
   */
  async function getCardDetails() {
    // 1. Try intercepted card details from this page load
    if (interceptedCardDetails.length > 0) {
      console.debug('[AmexDash] Using intercepted card details:', interceptedCardDetails.length);
      return interceptedCardDetails;
    }

    // 2. Try cached card details from localStorage
    try {
      var cached = localStorage.getItem(STORAGE_KEY_CARDS);
      if (cached) {
        var parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.debug('[AmexDash] Using cached card details:', parsed.length);
          return parsed;
        }
      }
    } catch(e) {}

    // 3. Try fetching card details using intercepted, cached, or DOM-extracted tokens
    var tokens = interceptedTokens.length > 0 ? interceptedTokens : [];
    if (tokens.length === 0) {
      try {
        var cachedTokens = localStorage.getItem(STORAGE_KEY_TOKENS);
        if (cachedTokens) tokens = JSON.parse(cachedTokens);
      } catch(e) {}
    }
    // Fallback: extract tokens from DOM (works even when fetch interception fails on Chrome)
    if (tokens.length === 0) {
      tokens = extractTokensFromDOM();
      if (tokens.length > 0) {
        saveTokens(tokens);
      }
    }

    if (tokens.length > 0) {
      console.debug('[AmexDash] Fetching card details using', tokens.length, 'captured tokens');
      try {
        var data = await amexApiFetch('/ReadLoyaltyBenefitsCardProduct.v1', {
          accountTokens: tokens,
          cardNames: [],
          productType: 'AEXP_CARD_ACCOUNT',
        });
        if (data && data.cardDetails && data.cardDetails.length > 0) {
          interceptedCardDetails = data.cardDetails;
          try { localStorage.setItem(STORAGE_KEY_CARDS, JSON.stringify(data.cardDetails)); } catch(e) {}
          return data.cardDetails;
        }
      } catch(e) {
        console.warn('[AmexDash] Failed to fetch card details:', e.message);
      }
    }

    // 4. No data at all
    console.warn('[AmexDash] No card data available');
    return null;
  }

  /**
   * Fetch loyalty accounts to get displayAccountNumber mappings.
   * Calls ReadLoyaltyAccounts.v1.
   */
  async function fetchLoyaltyAccounts(accountTokens) {
    const body = {
      accountTokens: Array.isArray(accountTokens) ? accountTokens : [accountTokens],
      productType: 'AEXP_CARD_ACCOUNT',
    };
    const data = await amexApiFetch(
      '/ReadLoyaltyAccounts.v1',
      body
    );
    // data is an array; extract relationships from all entries
    const displayMap = {};
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (Array.isArray(entry.relationships)) {
          for (const rel of entry.relationships) {
            if (rel.accountToken && rel.displayAccountNumber) {
              displayMap[rel.accountToken] = rel.displayAccountNumber;
            }
          }
        }
      }
    }
    return displayMap;
  }

  /**
   * Fetch benefit trackers for a single account.
   * Calls ReadBestLoyaltyBenefitsTrackers.v1.
   */
  async function fetchTrackersForAccount(pool, accountToken, onComplete) {
    return pool.enqueue(async () => {
      try {
        const body = [
          {
            accountToken: accountToken,
            locale: 'en-US',
            limit: 'ALL',
          },
        ];
        const data = await amexApiFetch(
          '/ReadBestLoyaltyBenefitsTrackers.v1',
          body
        );
        if (onComplete) onComplete();

        // Response is an array; find the entry for this account
        if (Array.isArray(data)) {
          const entry = data.find((d) => d.accountToken === accountToken);
          return { accountToken, trackers: entry ? entry.trackers || [] : [], error: null };
        }
        return { accountToken, trackers: [], error: null };
      } catch (err) {
        if (onComplete) onComplete();
        if (err instanceof SessionExpiredError) throw err;
        if (err instanceof RateLimitError) pool.onRateLimit();
        console.error(`[AmexDash] Failed to fetch trackers for ${accountToken}:`, err);
        return { accountToken, trackers: [], error: err.message };
      }
    });
  }

  /**
   * Fetch trackers for all cards with progress reporting.
   */
  async function fetchAllData(cardDetails, onProgress) {
    const pool = new FetchPool(CONFIG.CONCURRENCY);
    let completed = 0;
    const total = cardDetails.length;

    const results = await Promise.all(
      cardDetails.map((card) =>
        fetchTrackersForAccount(pool, card.accountToken, () => {
          completed++;
          if (onProgress) onProgress(completed, total);
        })
      )
    );

    return results;
  }

  // ============================================================
  // Module 2: Data Aggregator
  // ============================================================

  /**
   * Compute days until a given date string (YYYY-MM-DD).
   */
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const target = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  }

  /**
   * Build a card info lookup by accountToken.
   */
  function buildCardInfoMap(cardDetails, displayNumberMap) {
    const map = {};
    const nameCounters = {};

    for (const card of cardDetails) {
      const displayName = CARD_DISPLAY_NAMES[card.cardName] || card.cardName;
      const displayNumber = displayNumberMap[card.accountToken] || null;

      // Track duplicates for numbering
      if (!nameCounters[card.cardName]) {
        nameCounters[card.cardName] = [];
      }
      nameCounters[card.cardName].push(card.accountToken);

      map[card.accountToken] = {
        cardName: card.cardName,
        displayName: displayName,
        displayNumber: displayNumber,
        cardType: card.cardType,
        relationship: card.relationship,
        accountToken: card.accountToken,
      };
    }

    // Add ordinal suffixes for duplicate card types
    for (const [, tokens] of Object.entries(nameCounters)) {
      if (tokens.length > 1) {
        tokens.forEach((token, idx) => {
          if (map[token].displayNumber) {
            map[token].label = `${map[token].displayName} (...${map[token].displayNumber})`;
          } else {
            map[token].label = `${map[token].displayName} (${idx + 1})`;
          }
        });
      } else {
        const token = tokens[0];
        if (map[token].displayNumber) {
          map[token].label = `${map[token].displayName} (...${map[token].displayNumber})`;
        } else {
          map[token].label = map[token].displayName;
        }
      }
    }

    return map;
  }

  // ============================================================
  // Self-Tracking — store period data in localStorage for YTD
  // ============================================================
  const STORAGE_KEY_HISTORY = 'amexDash_history';

  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || '{}');
    } catch(e) { return {}; }
  }

  function selfTrackPeriod(benefitId, accountToken, periodKey, spent) {
    var history = getHistory();
    var key = benefitId + '|' + accountToken;
    if (!history[key]) history[key] = {};
    history[key][periodKey] = spent;

    // Prune entries older than 13 months
    var cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 13);
    var cutoffStr = cutoff.toISOString().slice(0, 10);
    for (var pk in history[key]) {
      // periodKey format: "startDate_endDate" — check if endDate is before cutoff
      var endDate = pk.split('_')[1] || '';
      if (endDate && endDate.slice(0, 10) < cutoffStr) {
        delete history[key][pk];
      }
    }

    try { localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history)); } catch(e) {}
  }

  function getSelfTrackedYtd(benefitId, accountToken) {
    var history = getHistory();
    var key = benefitId + '|' + accountToken;
    var periods = history[key];
    if (!periods || Object.keys(periods).length <= 1) return null;
    var total = 0;
    var currentYear = new Date().getFullYear().toString();
    for (var periodKey in periods) {
      // Use the period END date's year to determine if it belongs to current year
      var endDate = (periodKey.split('_')[1] || '').slice(0, 10);
      var endYear = endDate.slice(0, 4);
      if (endYear === currentYear) {
        total += periods[periodKey];
      }
    }
    return total;
  }

  /**
   * Aggregate tracker results across all cards.
   * Groups by benefitId, filters to category==="usage".
   * Returns { grouped: Map<benefitId, AggregatedBenefit>, summary }
   */
  function aggregateTrackers(cardDetails, trackerResults, displayNumberMap) {
    const cardInfoMap = buildCardInfoMap(cardDetails, displayNumberMap);
    const grouped = new Map();

    for (const result of trackerResults) {
      if (result.error || !Array.isArray(result.trackers)) continue;

      const cardInfo = cardInfoMap[result.accountToken];
      if (!cardInfo) {
        console.warn('[AmexDash] No card info for token:', result.accountToken, '— skipping', result.trackers.length, 'trackers');
        continue;
      }

      // Per-card tracker breakdown (debug level — hidden by default in console)
      var cats = {};
      result.trackers.forEach(function(_t) { cats[_t.category] = (cats[_t.category] || 0) + 1; });
      console.debug('[AmexDash] ' + cardInfo.label + ': ' + result.trackers.length + ' trackers', cats);

      for (const t of result.trackers) {
        // Skip access (visit counters like Delta Sky Club visits)
        if (t.category === 'access') continue;
        // Skip non-monetary trackers (e.g., "Earn 20% More Points" = 20 transactions)
        if (t.tracker && t.tracker.targetUnit && t.tracker.targetUnit !== 'MONETARY') continue;

        const key = t.benefitId;
        const period = detectPeriod(t.trackerDuration, t.periodStartDate, t.periodEndDate);

        // Use progress.title as display name — benefitName changes to "Congratulations!" when achieved
        const displayName = (t.progress && t.progress.title) || t.benefitName;

        if (!grouped.has(key)) {
          grouped.set(key, {
            benefitId: t.benefitId,
            benefitName: displayName,
            trackerDuration: period.duration,
            durationLabel: period.label,
            category: t.category,
            periodStartDate: t.periodStartDate,
            periodEndDate: t.periodEndDate,
            daysRemaining: daysUntil(t.periodEndDate),
            currencySymbol: t.tracker ? t.tracker.targetCurrencySymbol || '$' : '$',
            targetUnit: t.tracker ? t.tracker.targetUnit || 'MONETARY' : 'MONETARY',
            periodMultiplier: period.multiplier,
            // Current period totals
            totalTarget: 0,
            totalSpent: 0,
            totalRemaining: 0,
            // Annual totals
            annualTarget: 0,
            annualYtd: 0,
            hasIncompleteYtd: false,
            cards: [],
          });
        }

        const group = grouped.get(key);
        // Update display name if current one is generic (e.g., "Congratulations!")
        if (group.benefitName === 'Congratulations!' && displayName !== 'Congratulations!') {
          group.benefitName = displayName;
        }
        const target = parseFloat(t.tracker?.targetAmount || '0');
        const spent = parseFloat(t.tracker?.spentAmount || '0');
        const remaining = parseFloat(t.tracker?.remainingAmount || '0');
        // YTD: use totalSavingsYearToDate when present (even "0.00" is valid)
        let ytd = null;
        const rawYtd = t.progress?.totalSavingsYearToDate;
        if (rawYtd !== undefined && rawYtd !== null) {
          ytd = parseFloat(rawYtd);
          if (isNaN(ytd)) ytd = null;
        }

        // Self-track: save current period data for YTD calculation
        const periodKey = (t.periodStartDate || '') + '_' + (t.periodEndDate || '');
        selfTrackPeriod(t.benefitId, result.accountToken, periodKey, spent);

        // Fallback chain: API totalSavingsYearToDate > self-tracked > current period
        const selfTrackedYtd = getSelfTrackedYtd(t.benefitId, result.accountToken);
        const effectiveYtd = ytd !== null ? ytd : (selfTrackedYtd !== null ? selfTrackedYtd : spent);

        group.totalTarget += target;
        group.totalSpent += spent;
        group.totalRemaining += remaining;
        group.annualTarget += target * period.multiplier;
        group.annualYtd += effectiveYtd;
        if (ytd === null && selfTrackedYtd === null) group.hasIncompleteYtd = true;

        group.cards.push({
          accountToken: result.accountToken,
          cardLabel: cardInfo.label,
          cardName: cardInfo.cardName,
          displayName: cardInfo.displayName,
          status: t.status,
          target: target,
          spent: spent,
          remaining: remaining,
          annualTarget: target * period.multiplier,
          ytd: effectiveYtd,
          progressTitle: t.progress?.title || t.benefitName,
        });
      }
    }

    const summary = computeSummary(grouped);
    return { grouped, summary };
  }

  /**
   * Compute summary statistics from grouped benefits.
   */
  function computeSummary(grouped) {
    let annualTotal = 0;
    let annualYtd = 0;
    let periodTotal = 0;
    let periodUsed = 0;
    let fullyUsed = 0;
    let partiallyUsed = 0;
    let unused = 0;
    let creditCount = 0;
    let spendGoalCount = 0;

    for (const [, benefit] of grouped) {
      const isSpendGoal = benefit.category === 'spend';

      // Only include actual credits (usage/loan) in dollar summary, not spend thresholds
      if (!isSpendGoal) {
        annualTotal += benefit.annualTarget;
        annualYtd += benefit.annualYtd;
        periodTotal += benefit.totalTarget;
        periodUsed += benefit.totalSpent;
        creditCount++;
      } else {
        spendGoalCount++;
      }

      const pct = benefit.totalTarget > 0
        ? (benefit.totalSpent / benefit.totalTarget) * 100
        : 0;

      if (pct >= 100) fullyUsed++;
      else if (pct > 0) partiallyUsed++;
      else unused++;
    }

    return {
      annualTotal,
      annualYtd,
      annualRemaining: annualTotal - annualYtd,
      periodTotal,
      periodUsed,
      benefitCount: grouped.size,
      creditCount,
      spendGoalCount,
      fullyUsed,
      partiallyUsed,
      unused,
    };
  }

  // ============================================================
  // Module 3: UI Renderer
  // ============================================================

  function injectStyles() {
    if (document.getElementById('amex-dash-styles')) return;
    const style = document.createElement('style');
    style.id = 'amex-dash-styles';
    style.textContent = `
      /* ── Overlay & base ── */
      .amex-dash-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        z-index: 99999;
        background: #f4f6f9;
        overflow-y: auto;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        color: #333;
      }

      /* ── Header (top bar) ── */
      .amex-dash-header {
        background: #006fcf;
        color: #fff;
        padding: 14px 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: sticky;
        top: 0;
        z-index: 10;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        gap: 16px;
        flex-wrap: wrap;
      }
      .amex-dash-header-left h1 {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
        letter-spacing: 0.3px;
        line-height: 1.2;
      }
      .amex-dash-header-subtitle {
        font-size: 12px;
        opacity: 0.8;
        margin-top: 2px;
      }
      .amex-dash-header-right {
        display: flex;
        align-items: center;
        gap: 20px;
        flex-wrap: wrap;
      }
      .amex-dash-header-stats {
        display: flex;
        gap: 20px;
      }
      .amex-dash-header-stat {
        text-align: center;
        line-height: 1.2;
      }
      .amex-dash-header-stat-value {
        font-size: 18px;
        font-weight: 700;
        display: block;
      }
      .amex-dash-header-stat-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        opacity: 0.8;
        display: block;
      }
      .amex-dash-header-actions {
        display: flex;
        gap: 8px;
      }

      /* ── Buttons (header) ── */
      .amex-dash-close,
      .amex-dash-refresh-btn {
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.4);
        color: #fff;
        padding: 7px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: background 0.15s;
      }
      .amex-dash-close:hover,
      .amex-dash-refresh-btn:hover {
        background: rgba(255,255,255,0.35);
      }

      /* ── Filter bar ── */
      .amex-dash-filter-bar {
        background: #fff;
        border-bottom: 1px solid #e0e0e0;
        padding: 10px 24px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        position: sticky;
        top: 56px;
        z-index: 9;
      }
      .amex-dash-filter-separator {
        width: 1px;
        height: 24px;
        background: #ddd;
        margin: 0 4px;
      }
      .amex-dash-filter-btn {
        padding: 6px 16px;
        border: 1px solid #ccc;
        border-radius: 20px;
        background: #fff;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.15s;
        color: #555;
      }
      .amex-dash-filter-btn.active {
        background: #006fcf;
        color: #fff;
        border-color: #006fcf;
      }
      .amex-dash-filter-btn:hover:not(.active) {
        border-color: #006fcf;
        color: #006fcf;
      }
      .amex-dash-filter-btn.needs-action {
        color: #c62828;
        border-color: #ef9a9a;
        background: #ffebee;
      }
      .amex-dash-filter-btn.needs-action.active {
        background: #c62828;
        color: #fff;
        border-color: #c62828;
      }

      /* ── Body / content area ── */
      .amex-dash-body {
        max-width: 1400px;
        margin: 0 auto;
        padding: 24px 24px 64px;
      }

      /* ── Section headers ── */
      .amex-dash-section {
        margin-bottom: 28px;
      }
      .amex-dash-section-title {
        font-size: 13px;
        font-weight: 700;
        color: #555;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 2px solid #e0e7ef;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .amex-dash-section-title .period-badge {
        font-size: 11px;
        padding: 3px 10px;
        border-radius: 10px;
        font-weight: 600;
        text-transform: none;
        letter-spacing: 0;
      }
      .amex-dash-section-title .badge-urgent {
        background: #fce4ec;
        color: #c62828;
      }
      .amex-dash-section-title .badge-warning {
        background: #fff3e0;
        color: #e65100;
      }
      .amex-dash-section-title .badge-ok {
        background: #e8f5e9;
        color: #2e7d32;
      }

      /* ── Benefit card grid ── */
      .amex-dash-benefit-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 12px;
      }

      /* ── Benefit card ── */
      .amex-dash-benefit-row {
        background: #fff;
        border-radius: 6px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        overflow: hidden;
        border: 1px solid #e0e0e0;
        transition: box-shadow 0.2s, border-color 0.2s;
      }
      .amex-dash-benefit-row:hover {
        box-shadow: 0 4px 12px rgba(0,0,0,0.12);
        border-color: #ccc;
      }

      .amex-dash-benefit-main {
        padding: 14px 16px;
        cursor: pointer;
        user-select: none;
      }
      .amex-dash-benefit-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
        margin-bottom: 4px;
      }
      .amex-dash-benefit-name {
        font-size: 14px;
        font-weight: 600;
        color: #1a1a1a;
        line-height: 1.3;
        flex: 1;
        min-width: 0;
      }
      .amex-dash-benefit-amount {
        font-size: 14px;
        font-weight: 700;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .amex-dash-benefit-meta {
        font-size: 11px;
        color: #999;
        margin-bottom: 8px;
      }
      .amex-dash-progress-bar {
        height: 6px;
        background: #e9ecef;
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: 4px;
      }
      .amex-dash-progress-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.4s ease;
      }
      .amex-dash-progress-text {
        font-size: 11px;
        color: #888;
        text-align: right;
      }

      /* ── Expanded card breakdown ── */
      .amex-dash-card-details {
        display: none;
        border-top: 1px solid #eee;
        padding: 0;
      }
      .amex-dash-benefit-row.expanded .amex-dash-card-details {
        display: block;
      }
      .amex-dash-card-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 16px;
        border-bottom: 1px solid #f5f5f5;
        font-size: 12px;
      }
      .amex-dash-card-row:last-child {
        border-bottom: none;
      }
      .amex-dash-card-label {
        font-weight: 500;
        min-width: 120px;
        color: #444;
        flex-shrink: 0;
      }
      .amex-dash-card-progress {
        flex: 1;
        min-width: 40px;
      }
      .amex-dash-card-progress .amex-dash-progress-bar {
        height: 4px;
        margin-bottom: 0;
      }
      .amex-dash-card-amount {
        text-align: right;
        min-width: 80px;
        font-weight: 600;
        color: #555;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .amex-dash-card-status {
        min-width: 18px;
        text-align: center;
        flex-shrink: 0;
      }

      /* ── Loading / skeletons ── */
      .amex-dash-loading {
        text-align: center;
        padding: 60px 20px;
      }
      .amex-dash-loading-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid #e0e7ef;
        border-top-color: #006fcf;
        border-radius: 50%;
        animation: amex-dash-spin 0.8s linear infinite;
        margin: 0 auto 16px;
      }
      @keyframes amex-dash-spin {
        to { transform: rotate(360deg); }
      }
      .amex-dash-loading-text {
        color: #666;
        font-size: 15px;
      }
      .amex-dash-progress-detail {
        color: #888;
        font-size: 13px;
        margin-top: 4px;
      }
      .amex-dash-skeleton {
        background: #fff;
        border-radius: 8px;
        margin-bottom: 10px;
        padding: 20px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
        border: 1px solid #eee;
      }
      .amex-dash-skeleton-line {
        height: 14px;
        background: linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%);
        background-size: 200% 100%;
        animation: amex-dash-shimmer 1.5s infinite;
        border-radius: 4px;
        margin-bottom: 10px;
      }
      .amex-dash-skeleton-line:last-child { margin-bottom: 0; }
      .amex-dash-skeleton-line.short { width: 40%; }
      .amex-dash-skeleton-line.medium { width: 65%; }
      .amex-dash-skeleton-line.long { width: 85%; }
      @keyframes amex-dash-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      /* ── Error / warning states ── */
      .amex-dash-error {
        background: #fff3f3;
        border: 1px solid #ffcdd2;
        border-radius: 8px;
        padding: 24px;
        text-align: center;
        color: #c62828;
        margin: 20px 0;
      }
      .amex-dash-error h3 {
        margin: 0 0 8px;
        font-size: 16px;
      }
      .amex-dash-error p {
        margin: 0;
        font-size: 14px;
        color: #d32f2f;
      }
      .amex-dash-card-errors {
        background: #fff8e1;
        border: 1px solid #ffe082;
        border-radius: 8px;
        padding: 14px 20px;
        margin-bottom: 20px;
        font-size: 13px;
        color: #f57f17;
      }
      .amex-dash-card-errors strong {
        display: block;
        margin-bottom: 6px;
        color: #e65100;
      }

      /* ── Nav link ── */
      .amex-dash-nav-link {
        cursor: pointer;
        color: inherit;
        text-decoration: none;
        white-space: nowrap;
      }
      .amex-dash-nav-link:hover {
        text-decoration: underline;
      }

      /* ── Color utilities ── */
      .color-unused { color: #c62828; }
      .color-partial { color: #e65100; }
      .color-full { color: #2e7d32; }
      .fill-unused { background: #ef5350; }
      .fill-partial { background: #ffa726; }
      .fill-full { background: #66bb6a; }
      .amex-dash-status-check { color: #2e7d32; font-weight: bold; }

      /* ── Empty state ── */
      .amex-dash-empty {
        text-align: center;
        padding: 48px 20px;
        color: #888;
      }
      .amex-dash-empty h3 {
        font-size: 18px;
        color: #666;
        margin-bottom: 8px;
      }
    `;
    document.head.appendChild(style);
  }

  function getColorClass(pct) {
    if (pct >= 100) return 'full';
    if (pct > 0) return 'partial';
    return 'unused';
  }

  function formatCurrency(amount, symbol = '$') {
    const safe = escapeHtml(symbol);
    const formattedAmount = amount % 1 === 0 ? amount : amount.toFixed(2);
    return `${safe}${formattedAmount}`;
  }

  function renderDashboard(container, summary, cardCount) {
    injectStyles();
    container.innerHTML = '';
    container.className = 'amex-dash-overlay';

    const header = document.createElement('div');
    header.className = 'amex-dash-header';

    // Build inline stats only if summary data is available
    let statsHtml = '';
    if (summary) {
      statsHtml = `
        <div class="amex-dash-header-stats">
          <div class="amex-dash-header-stat">
            <span class="amex-dash-header-stat-value">${formatCurrency(summary.annualTotal)}</span>
            <span class="amex-dash-header-stat-label">Annual</span>
          </div>
          <div class="amex-dash-header-stat">
            <span class="amex-dash-header-stat-value">${formatCurrency(summary.annualYtd)}</span>
            <span class="amex-dash-header-stat-label">YTD Used</span>
          </div>
          <div class="amex-dash-header-stat">
            <span class="amex-dash-header-stat-value">${formatCurrency(summary.annualRemaining)}</span>
            <span class="amex-dash-header-stat-label">Remaining</span>
          </div>
        </div>
      `;
    }

    const subtitleParts = [];
    if (cardCount) subtitleParts.push(`${cardCount} cards`);
    if (summary) subtitleParts.push(`${summary.benefitCount} tracked credits`);

    header.innerHTML = `
      <div class="amex-dash-header-left">
        <h1>All Benefits</h1>
        ${subtitleParts.length > 0
          ? `<div class="amex-dash-header-subtitle">${escapeHtml(subtitleParts.join(' \u00b7 '))}</div>`
          : ''}
      </div>
      <div class="amex-dash-header-right">
        ${statsHtml}
        <div class="amex-dash-header-actions">
          <button class="amex-dash-refresh-btn" id="amex-dash-refresh">Refresh</button>
          <button class="amex-dash-close" id="amex-dash-close">Close</button>
        </div>
      </div>
    `;
    container.appendChild(header);

    const body = document.createElement('div');
    body.className = 'amex-dash-body';
    body.id = 'amex-dash-body';
    container.appendChild(body);

    document.getElementById('amex-dash-close').addEventListener('click', () => {
      leaveDashboard();
      if (pageWindow.location.pathname === CONFIG.DASHBOARD_PATH) {
        pageWindow.history.back();
      }
    });
    document.getElementById('amex-dash-refresh').addEventListener('click', () => {
      showDashboard(true);
    });

    return body;
  }

  function renderLoadingProgress(dashBody, completed, total) {
    let loadingEl = dashBody.querySelector('.amex-dash-loading');
    if (!loadingEl) {
      dashBody.innerHTML = '';
      loadingEl = document.createElement('div');
      loadingEl.className = 'amex-dash-loading';
      loadingEl.innerHTML = `
        <div class="amex-dash-loading-spinner"></div>
        <div class="amex-dash-loading-text">Loading benefit trackers...</div>
        <div class="amex-dash-progress-detail"></div>
      `;
      dashBody.appendChild(loadingEl);
    }
    const detail = loadingEl.querySelector('.amex-dash-progress-detail');
    if (detail) {
      detail.textContent = `${completed} of ${total} cards loaded`;
    }
  }

  function renderSkeletons(dashBody, count) {
    dashBody.innerHTML = '';
    const progress = document.createElement('div');
    progress.className = 'amex-dash-skeleton-progress';
    progress.style.cssText = 'text-align:center;color:#888;font-size:13px;margin-bottom:16px;';
    progress.textContent = 'Loading benefit trackers...';
    dashBody.appendChild(progress);
    for (let i = 0; i < count; i++) {
      const skel = document.createElement('div');
      skel.className = 'amex-dash-skeleton';
      skel.innerHTML = `
        <div class="amex-dash-skeleton-line long"></div>
        <div class="amex-dash-skeleton-line medium"></div>
        <div class="amex-dash-skeleton-line short"></div>
      `;
      dashBody.appendChild(skel);
    }
  }

  function renderError(container, message, details) {
    container.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'amex-dash-error';
    el.innerHTML = `
      <h3>${escapeHtml(message)}</h3>
      ${details ? `<p>${escapeHtml(details)}</p>` : ''}
    `;
    container.appendChild(el);
  }

  function renderCardErrors(dashBody, trackerResults) {
    const errors = trackerResults.filter((r) => r.error);
    if (errors.length === 0) return;

    const el = document.createElement('div');
    el.className = 'amex-dash-card-errors';
    el.innerHTML = `
      <strong>Some cards failed to load (${errors.length}):</strong>
      ${errors.map((e) => `<div>${escapeHtml(e.accountToken.slice(0, 6))}...: ${escapeHtml(e.error)}</div>`).join('')}
    `;
    dashBody.prepend(el);
  }

  function renderResults(dashBody, grouped, summary) {
    dashBody.innerHTML = '';

    // Count benefits needing action (current period not fully used)
    let needsActionCount = 0;
    for (const [, benefit] of grouped) {
      if (benefit.totalSpent < benefit.totalTarget) {
        needsActionCount++;
      }
    }

    // Filter bar (inserted before the body content, as a sibling)
    const overlay = dashBody.parentElement;
    let filterBar = overlay.querySelector('.amex-dash-filter-bar');
    if (filterBar) filterBar.remove();

    filterBar = document.createElement('div');
    filterBar.className = 'amex-dash-filter-bar';

    const filterOptions = [
      { key: 'all', label: 'All' },
      { key: 'Monthly', label: 'Monthly' },
      { key: 'QuarterYear', label: 'Quarterly' },
      { key: 'HalfYear', label: 'Semi-Annual' },
      { key: 'CalenderYear', label: 'Annual' },
    ];
    let activeFilter = 'all';

    for (const opt of filterOptions) {
      const btn = document.createElement('button');
      btn.className = `amex-dash-filter-btn${opt.key === activeFilter ? ' active' : ''}`;
      btn.textContent = opt.label;
      btn.dataset.filter = opt.key;
      btn.addEventListener('click', () => {
        activeFilter = opt.key;
        filterBar.querySelectorAll('.amex-dash-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderSections(sectionsContainer, grouped, activeFilter);
      });
      filterBar.appendChild(btn);
    }

    // Separator
    const sep = document.createElement('div');
    sep.className = 'amex-dash-filter-separator';
    filterBar.appendChild(sep);

    // Needs Action pill
    const needsBtn = document.createElement('button');
    needsBtn.className = 'amex-dash-filter-btn needs-action';
    needsBtn.textContent = `Needs Action (${needsActionCount})`;
    needsBtn.dataset.filter = 'needs-action';
    needsBtn.addEventListener('click', () => {
      activeFilter = 'needs-action';
      filterBar.querySelectorAll('.amex-dash-filter-btn').forEach((b) => b.classList.remove('active'));
      needsBtn.classList.add('active');
      renderSections(sectionsContainer, grouped, activeFilter);
    });
    filterBar.appendChild(needsBtn);

    overlay.insertBefore(filterBar, dashBody);

    // Sections container
    const sectionsContainer = document.createElement('div');
    sectionsContainer.id = 'amex-dash-sections';
    dashBody.appendChild(sectionsContainer);

    renderSections(sectionsContainer, grouped, activeFilter);
  }

  function renderSections(container, grouped, filter) {
    container.innerHTML = '';

    // "Needs Action" filter: flatten across all periods, sort by urgency
    if (filter === 'needs-action') {
      const actionable = [];
      for (const [, benefit] of grouped) {
        if (benefit.totalSpent < benefit.totalTarget) {
          actionable.push(benefit);
        }
      }
      // Sort by days remaining ascending (most urgent first)
      actionable.sort((a, b) => {
        const da = a.daysRemaining !== null ? a.daysRemaining : 9999;
        const db = b.daysRemaining !== null ? b.daysRemaining : 9999;
        return da - db;
      });

      if (actionable.length === 0) {
        container.innerHTML = `
          <div class="amex-dash-empty">
            <h3>All caught up!</h3>
            <p>Every benefit is fully used for the current period.</p>
          </div>
        `;
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'amex-dash-benefit-grid';
      for (const benefit of actionable) {
        grid.appendChild(renderBenefitRow(benefit));
      }
      container.appendChild(grid);
      return;
    }

    // Group benefits by duration
    const byDuration = new Map();
    const durationOrder = ['Monthly', 'QuarterYear', 'HalfYear', 'CalenderYear', 'CalendarYear'];

    for (const [, benefit] of grouped) {
      const dur = benefit.trackerDuration || 'Other';

      // Period-based filtering
      if (filter !== 'all') {
        if (dur !== filter && !(filter === 'CalenderYear' && dur === 'CalendarYear')) continue;
      }

      if (!byDuration.has(dur)) {
        byDuration.set(dur, []);
      }
      byDuration.get(dur).push(benefit);
    }

    // Sort durations
    const sortedDurations = [...byDuration.keys()].sort((a, b) => {
      const ai = durationOrder.indexOf(a);
      const bi = durationOrder.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    if (sortedDurations.length === 0) {
      container.innerHTML = `
        <div class="amex-dash-empty">
          <h3>No benefits match this filter</h3>
          <p>Try selecting a different filter above.</p>
        </div>
      `;
      return;
    }

    for (const dur of sortedDurations) {
      const benefits = byDuration.get(dur);
      const section = document.createElement('div');
      section.className = 'amex-dash-section';

      const durationLabel = DURATION_LABELS[dur] || dur;
      const sampleBenefit = benefits[0];
      const daysLeft = sampleBenefit.daysRemaining;
      const daysText = daysLeft !== null
        ? `resets in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`
        : '';
      const badgeColor = daysLeft !== null
        ? (daysLeft <= 7 ? 'badge-urgent' : daysLeft <= 30 ? 'badge-warning' : 'badge-ok')
        : '';

      const titleEl = document.createElement('div');
      titleEl.className = 'amex-dash-section-title';
      titleEl.innerHTML = `
        ${escapeHtml(durationLabel)}
        ${daysText ? `<span class="period-badge ${badgeColor}">${escapeHtml(daysText)}</span>` : ''}
      `;
      section.appendChild(titleEl);

      // Sort: unused first, then partial, then complete
      benefits.sort((a, b) => {
        const pctA = a.totalTarget > 0 ? a.totalSpent / a.totalTarget : 0;
        const pctB = b.totalTarget > 0 ? b.totalSpent / b.totalTarget : 0;
        return pctA - pctB;
      });

      const grid = document.createElement('div');
      grid.className = 'amex-dash-benefit-grid';
      for (const benefit of benefits) {
        grid.appendChild(renderBenefitRow(benefit));
      }
      section.appendChild(grid);

      container.appendChild(section);
    }
  }

  function renderBenefitRow(benefit) {
    const pct = benefit.totalTarget > 0
      ? Math.min((benefit.totalSpent / benefit.totalTarget) * 100, 100)
      : 0;
    const colorClass = getColorClass(pct);
    const symbol = benefit.currencySymbol;

    // Period label for the progress text
    const periodWord = benefit.durationLabel === 'Monthly' ? 'this month'
      : benefit.durationLabel === 'Quarterly' ? 'this quarter'
      : benefit.durationLabel === 'Semi-Annual' ? 'this half'
      : 'this year';

    const row = document.createElement('div');
    row.className = `amex-dash-benefit-row`;

    // Main card area (click to expand)
    const main = document.createElement('div');
    main.className = 'amex-dash-benefit-main';
    
    let ytdHtml = '';
    if (benefit.durationLabel !== 'Annual' && benefit.annualTarget > 0) {
      const ytdPct = Math.min((benefit.annualYtd / benefit.annualTarget) * 100, 100);
      const ytdColorClass = getColorClass(ytdPct);
      ytdHtml = `
        <div class="amex-dash-progress-bar" style="margin-top: 8px;">
          <div class="amex-dash-progress-fill fill-${ytdColorClass}" style="width: ${ytdPct.toFixed(1)}%"></div>
        </div>
        <div class="amex-dash-progress-text">${ytdPct.toFixed(0)}% YTD (${formatCurrency(benefit.annualYtd, symbol)}/${formatCurrency(benefit.annualTarget, symbol)})</div>
      `;
    }

    main.innerHTML = `
      <div class="amex-dash-benefit-top">
        <div class="amex-dash-benefit-name">${escapeHtml(benefit.benefitName)}</div>
        <div class="amex-dash-benefit-amount color-${colorClass}">
          ${formatCurrency(benefit.totalSpent, symbol)}/${formatCurrency(benefit.totalTarget, symbol)}
        </div>
      </div>
      <div class="amex-dash-benefit-meta">
        ${benefit.cards.length} card${benefit.cards.length !== 1 ? 's' : ''} &middot; ${formatCurrency(benefit.annualTarget, symbol)}/yr
      </div>
      <div class="amex-dash-progress-bar">
        <div class="amex-dash-progress-fill fill-${colorClass}" style="width: ${pct.toFixed(1)}%"></div>
      </div>
      <div class="amex-dash-progress-text">${pct.toFixed(0)}% ${escapeHtml(periodWord)}</div>
      ${ytdHtml}
    `;

    main.addEventListener('click', () => {
      row.classList.toggle('expanded');
    });
    row.appendChild(main);

    // Per-card expanded breakdown (hidden until clicked)
    const details = document.createElement('div');
    details.className = 'amex-dash-card-details';

    for (const card of benefit.cards) {
      const cardPct = card.target > 0
        ? Math.min((card.spent / card.target) * 100, 100)
        : 0;
      const cardColor = getColorClass(cardPct);

      const cardRow = document.createElement('div');
      cardRow.className = 'amex-dash-card-row';
      cardRow.style.cssText = 'display:block;padding:8px 16px;border-bottom:1px solid #f5f5f5;font-size:12px;';
      cardRow.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span class="amex-dash-card-label" style="min-width:0;">${escapeHtml(card.cardLabel)}</span>
          ${card.status === 'ACHIEVED' ? '<span class="amex-dash-status-check">&#10003;</span>' : ''}
        </div>
        <div class="amex-dash-progress-bar" style="margin-bottom:3px;">
          <div class="amex-dash-progress-fill fill-${cardColor}" style="width: ${cardPct.toFixed(1)}%"></div>
        </div>
        <div style="font-size:11px;color:#888;text-align:right;">
          <span class="color-${cardColor}" style="font-weight:600;">${formatCurrency(card.spent, symbol)}</span> / ${formatCurrency(card.target, symbol)} ${escapeHtml(periodWord)}
        </div>
      `;
      details.appendChild(cardRow);
    }

    row.appendChild(details);
    return row;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================================
  // Module 4: Nav Injector & Routing
  // ============================================================

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /**
   * Inject "All Benefits" link into the Amex navigation bar.
   */
  function injectNavLink() {
    if (document.getElementById('amex-dash-nav-link')) return;
    if (!document.body) {
      console.log('[AmexDash] Button inject skipped — document.body not ready');
      return;
    }

    // Use a fixed floating button — reliable regardless of Amex's nav DOM structure
    const btn = document.createElement('button');
    btn.id = 'amex-dash-nav-link';
    btn.textContent = 'All Benefits';
    btn.style.cssText = 'position:fixed;bottom:24px;left:24px;z-index:99999;' +
      'background:#006fcf;color:#fff;border:none;padding:14px 28px;' +
      'border-radius:28px;cursor:pointer;font-size:15px;font-weight:600;' +
      'box-shadow:0 4px 16px rgba(0,111,207,0.4);transition:all 0.2s;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
    btn.addEventListener('mouseenter', function() {
      btn.style.transform = 'scale(1.05)';
      btn.style.boxShadow = '0 6px 20px rgba(0,111,207,0.5)';
    });
    btn.addEventListener('mouseleave', function() {
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = '0 4px 16px rgba(0,111,207,0.4)';
    });
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      navigateToDashboard();
    });

    document.body.appendChild(btn);
    console.log('[AmexDash] Floating button injected');
  }

  function navigateToDashboard() {
    pageWindow.history.pushState({ amexDash: true }, '', CONFIG.DASHBOARD_PATH);
    showDashboard();
  }

  /**
   * Main orchestrator: fetch data, aggregate, render.
   */
  let dashboardLoading = false;

  async function showDashboard(forceRefresh = false) {
    if (dashboardActive && !forceRefresh) return;
    if (dashboardLoading && forceRefresh) {
      // Cancel current load by bumping generation
      dashboardGeneration++;
    }
    dashboardActive = true;
    dashboardLoading = true;
    console.log('[AmexDash] Opening dashboard | tokens=' + interceptedTokens.length + ' | cachedCards=' + interceptedCardDetails.length + ' | force=' + forceRefresh);
    const gen = ++dashboardGeneration;

    // Hide existing page content
    const mainContent = document.querySelector('main') || document.querySelector('#main') || document.querySelector('[role="main"]');
    if (mainContent && !originalContent) {
      originalContent = mainContent;
      originalContent.style.display = 'none';
    }

    // Create or reuse overlay container
    let overlay = document.getElementById('amex-dash-container');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'amex-dash-container';
      document.body.appendChild(overlay);
    }

    let dashBody = renderDashboard(overlay);

    // Step 1: Show initial loading
    renderLoadingProgress(dashBody, 0, 0);

    try {
      // Step 2: Get card details (from intercepted data or cache)
      const cardDetails = await getCardDetails();
      if (!cardDetails || cardDetails.length === 0) {
        dashBody.innerHTML = '';
        const msg = document.createElement('div');
        msg.className = 'amex-dash-error';
        msg.innerHTML = '<h3>Card Data Not Yet Available</h3>' +
          '<p>Please visit any <a href="/card-benefits/view-all/platinum" style="color:#006fcf">card benefits page</a> first, ' +
          'then come back and click All Benefits again.</p>' +
          '<p style="margin-top:8px;font-size:12px;color:#888;">This is needed only once — card data will be cached for future visits.</p>';
        dashBody.appendChild(msg);
        dashboardActive = false;
        return;
      }

      console.log('[AmexDash] Found ' + cardDetails.length + ' cards');

      // Step 4: Fetch display account numbers (for card labels)
      let displayNumberMap = {};
      try {
        if (cardDetails.length > 0) {
          displayNumberMap = await fetchLoyaltyAccounts(cardDetails.map(function(c) { return c.accountToken; }));
        }
      } catch (err) {
        console.warn('[AmexDash] Could not fetch display numbers:', err.message);
        // Non-fatal; we'll fall back to numbered labels
      }

      // Step 5: Show skeletons with progress counter while loading trackers
      renderSkeletons(dashBody, Math.min(cardDetails.length, 6));

      // Step 6: Fetch all trackers with progress (update counter without replacing skeletons)
      const trackerResults = await fetchAllData(cardDetails, (completed, total) => {
        const counter = dashBody.querySelector('.amex-dash-skeleton-progress');
        if (counter) {
          counter.textContent = `Loading ${completed} of ${total} cards...`;
        }
      });

      if (gen !== dashboardGeneration) return; // stale render

      // Step 7: Aggregate data
      const { grouped, summary } = aggregateTrackers(cardDetails, trackerResults, displayNumberMap);

      // Step 7b: Re-render dashboard with summary stats in header
      dashBody = renderDashboard(overlay, summary, cardDetails.length);

      if (grouped.size === 0) {
        dashBody.innerHTML = `
          <div class="amex-dash-empty">
            <h3>No benefit trackers found</h3>
            <p>None of your cards have active credit trackers at this time.</p>
          </div>
        `;
        return;
      }

      // Step 8: Render results
      renderResults(dashBody, grouped, summary);

      // Step 9: Show any card errors
      renderCardErrors(dashBody, trackerResults);

      console.log(`[AmexDash] Dashboard rendered: ${grouped.size} benefits across ${cardDetails.length} cards`);
    } catch (err) {
      if (gen !== dashboardGeneration) return;

      if (err instanceof SessionExpiredError) {
        // Clear stale cached data so next attempt uses fresh tokens
        try {
          localStorage.removeItem(STORAGE_KEY_CARDS);
          localStorage.removeItem(STORAGE_KEY_TOKENS);
        } catch(e) {}
        interceptedCardDetails = [];
        interceptedTokens = [];
        dashboardActive = false;

        dashBody.innerHTML = '';
        const errEl = document.createElement('div');
        errEl.className = 'amex-dash-error';
        errEl.innerHTML = '<h3>Session Changed</h3>' +
          '<p>Your session context changed (account switch or expiration).</p>' +
          '<p style="margin-top:8px;">Navigate to any <a href="/card-benefits/view-all/platinum" style="color:#006fcf">benefits page</a> to refresh card data, then try again.</p>' +
          '<p style="margin-top:12px;"><button id="amex-dash-retry" style="background:#006fcf;color:#fff;border:none;padding:8px 20px;border-radius:4px;cursor:pointer;font-size:14px;">Retry Now</button></p>';
        dashBody.appendChild(errEl);
        document.getElementById('amex-dash-retry').addEventListener('click', function() {
          showDashboard(true);
        });
      } else {
        renderError(dashBody, 'Failed to load benefits', err.message);
      }
      console.error('[AmexDash] Dashboard error:', err);
    } finally {
      dashboardLoading = false;
    }
  }

  function leaveDashboard() {
    dashboardActive = false;
    dashboardLoading = false;

    const overlay = document.getElementById('amex-dash-container');
    if (overlay) {
      overlay.remove();
    }

    if (originalContent) {
      originalContent.style.display = '';
      originalContent = null;
    }
  }

  /**
   * Set up popstate listener for browser back/forward.
   */
  function setupRouting() {
    pageWindow.addEventListener('popstate', (e) => {
      if (e.state && e.state.amexDash) {
        showDashboard();
      } else if (dashboardActive) {
        leaveDashboard();
      }
    });

    // Check if we're already on the dashboard path (e.g., page refresh)
    if (pageWindow.location.pathname === CONFIG.DASHBOARD_PATH) {
      showDashboard();
    }
  }

  /**
   * Watch for header changes (SPA navigation) and re-inject nav link.
   */
  function watchHeader() {
    const debouncedInject = debounce(injectNavLink, 500);

    const observer = new MutationObserver((mutations) => {
      // Only re-inject if our link was removed
      if (!document.getElementById('amex-dash-nav-link')) {
        debouncedInject();
      }
    });

    // Observe the header for changes (Amex SPA re-renders the header on navigation)
    const header = document.querySelector('header') || document.querySelector('[data-module-name="axp-global-header"]');
    if (header) {
      observer.observe(header, { childList: true, subtree: true });
    } else {
      // Header not found yet; observe body and wait
      const bodyObserver = new MutationObserver(() => {
        const h = document.querySelector('header') || document.querySelector('[data-module-name="axp-global-header"]');
        if (h) {
          bodyObserver.disconnect();
          observer.observe(h, { childList: true, subtree: true });
          injectNavLink();
        }
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  /**
   * Entry point: initialize the userscript.
   */
  function init() {
    try {
      console.log('[AmexDash] Initializing...');
      injectStyles();
      injectNavLink();
      setupRouting();
      watchHeader();

      // Retry button injection if body wasn't ready
      if (!document.getElementById('amex-dash-nav-link')) {
        var retryCount = 0;
        var retryInterval = setInterval(function() {
          retryCount++;
          injectNavLink();
          if (document.getElementById('amex-dash-nav-link') || retryCount > 20) {
            clearInterval(retryInterval);
          }
        }, 500);
      }

      console.log('[AmexDash] Ready');
    } catch(e) {
      console.error('[AmexDash] Init failed:', e);
    }
  }

  // Kick off — handle all possible document states
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    console.debug('[AmexDash] DOM already ready, calling init()');
    init();
  } else {
    console.debug('[AmexDash] Waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', function() {
      console.debug('[AmexDash] DOMContentLoaded fired');
      init();
    });
  }
})();
