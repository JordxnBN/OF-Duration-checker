(function () {
  'use strict';

  const MESSAGE_SOURCE = 'of-duration-viewer';
  const MAX_CACHE_ENTRIES = 500;
  const MAX_INDEX_ENTRIES = 2000;
  const MAX_SUMMARY_ENTRIES = 120;
  const MAX_VISIBLE_SUMMARIES = 20;
  const CLICK_UPDATE_WINDOW_MS = 8000;
  const CLICK_REQUEST_EPSILON_MS = 75;
  const HYBRID_FALLBACK_MIN_SCORE = 5;
  const HYBRID_FALLBACK_MIN_MARGIN = 2;
  const CLICK_LOADING_TEXT = 'Looking up...';
  const NO_MATCH_TEXT = 'No match for this item';
  const PASSIVE_DURATION_UPDATES = false;
  const USE_RAW_DURATION_EVENTS = false;
  const HOOK_MISSING_TEXT = 'Hook not ready';
  const DEBUG_STORAGE_KEY = 'ofDurationViewerDebug';
  const DEBUG_GLOBAL_FLAG = '__OF_DURATION_VIEWER_DEBUG__';

  const cache = new Map();
  const durationByMessageId = new Map();
  const durationByMediaId = new Map();
  const durationByPostId = new Map();
  const summaryByMessageId = new Map();
  const selectedSummaryByMessageId = new Map();

  let overlayEl = null;
  let durationValueEl = null;
  let summaryListEl = null;
  let activeClickSession = null;
  let clickSessionTimer = null;
  let lastResolvedMessageId = '';
  let hookReady = false;

  function isDebugEnabled() {
    try {
      if (typeof window !== 'undefined' && window[DEBUG_GLOBAL_FLAG] === true) return true;
    } catch (_) {}
    try {
      if (typeof localStorage !== 'undefined') {
        const value = localStorage.getItem(DEBUG_STORAGE_KEY);
        return value === '1' || value === 'true' || value === 'on';
      }
    } catch (_) {}
    return false;
  }

  function debugLog(...args) {
    if (!isDebugEnabled()) return;
    console.log('[of-duration-viewer]', ...args);
  }

  function normalizeIdCandidate(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^\d{4,}$/.test(trimmed)) return trimmed;
    if (/^[a-f0-9-]{8,}$/i.test(trimmed)) return trimmed.toLowerCase();
    if (/^(?=.*[a-z])(?=.*\d)[a-z0-9]{10,}$/i.test(trimmed)) return trimmed.toLowerCase();
    return '';
  }

  function formatDurationFromSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs
        .toString()
        .padStart(2, '0')}`;
    }
    if (mins > 0) return `${mins}:${secs.toString().padStart(2, '0')}`;
    return `${secs}s`;
  }

  function parseDurationTextToSeconds(value) {
    if (typeof value !== 'string') return 0;
    const text = value.trim();
    if (!text) return 0;

    if (/^\d+:\d{2}(:\d{2})?$/.test(text)) {
      const parts = text.split(':').map((part) => Number(part));
      if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    const unitMatch = text.match(
      /^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i
    );
    if (unitMatch) {
      const amount = Number(unitMatch[1]);
      if (!Number.isFinite(amount) || amount < 0) return 0;
      const unit = unitMatch[2].toLowerCase();
      const multiplier =
        unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1;
      return Math.floor(amount * multiplier);
    }

    const compactUnitRe =
      /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)/gi;
    let compactMatched = false;
    let compactSeconds = 0;
    let consumedUntil = 0;
    let compactMatch;
    while ((compactMatch = compactUnitRe.exec(text)) !== null) {
      const between = text.slice(consumedUntil, compactMatch.index);
      if (between.trim()) return 0;
      const amount = Number(compactMatch[1]);
      if (!Number.isFinite(amount) || amount < 0) return 0;
      const unit = compactMatch[2].toLowerCase();
      const multiplier =
        unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1;
      compactSeconds += amount * multiplier;
      compactMatched = true;
      consumedUntil = compactUnitRe.lastIndex;
    }
    if (compactMatched) {
      if (text.slice(consumedUntil).trim()) return 0;
      return Math.floor(compactSeconds);
    }

    const asNum = Number(text);
    if (Number.isFinite(asNum) && asNum > 0) return Math.floor(asNum);
    return 0;
  }

  function chooseBetterEntry(current, next) {
    if (!next) return current;
    if (!current) return next;
    const currentSeconds = Number(current.seconds) || 0;
    const nextSeconds = Number(next.seconds) || 0;
    if (nextSeconds > 0 && currentSeconds <= 0) return next;
    if (currentSeconds > 0 && nextSeconds <= 0) return current;
    if (nextSeconds > currentSeconds) return next;
    return current;
  }

  function ensureOverlay() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'of-duration-overlay';
    overlayEl.innerHTML = `
      <div class="of-duration-top">
        <div class="of-duration-main">
          <span class="of-duration-label">Duration:</span>
          <span class="of-duration-value">--</span>
        </div>
        <button class="of-duration-dismiss" title="Dismiss">&times;</button>
      </div>
      <div class="of-duration-list-wrap">
        <div class="of-duration-list-title">Messages</div>
        <div class="of-duration-list"></div>
      </div>
    `;

    durationValueEl = overlayEl.querySelector('.of-duration-value');
    summaryListEl = overlayEl.querySelector('.of-duration-list');
    overlayEl.querySelector('.of-duration-dismiss').onclick = () => {
      overlayEl.classList.add('of-duration-hidden');
    };

    document.documentElement.appendChild(overlayEl);
  }

  function showOverlay(text, isLoading) {
    ensureOverlay();
    if (durationValueEl) {
      durationValueEl.textContent = text || '--';
      durationValueEl.classList.toggle('of-duration-loading', Boolean(isLoading));
    }
    overlayEl.classList.remove('of-duration-hidden');
  }

  function showLoadingOverlay() {
    showOverlay(CLICK_LOADING_TEXT, true);
  }

  async function copyTextToClipboard(text) {
    const value = typeof text === 'string' ? text.trim() : '';
    if (!value) return false;

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {}

    try {
      const helper = document.createElement('textarea');
      helper.value = value;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      helper.style.pointerEvents = 'none';
      document.body.appendChild(helper);
      helper.select();
      const copied = document.execCommand('copy');
      helper.remove();
      return Boolean(copied);
    } catch (_) {
      return false;
    }
  }

  function normalizeIdSet(values) {
    const out = new Set();
    if (!values || typeof values[Symbol.iterator] !== 'function') return out;
    for (const value of values) {
      const normalized = normalizeIdCandidate(value);
      if (normalized) out.add(normalized);
    }
    return out;
  }

  function extractPriceCentsFromText(text) {
    if (typeof text !== 'string' || !text) return 0;
    const priceMatch = text.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
    if (!priceMatch || !priceMatch[1]) return 0;
    const amount = Number(priceMatch[1]);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    return Math.round(amount * 100);
  }

  function parseCountHintsFromText(text, priceCents) {
    if (typeof text !== 'string' || !text) return { imageCount: -1, videoCount: -1 };
    const bulletPair = text.match(/(?:^|\D)(\d{1,3})\s*[•|·:\/-]\s*(\d{1,3})(?:\D|$)/);
    if (bulletPair) {
      const left = Number(bulletPair[1]);
      const right = Number(bulletPair[2]);
      if (Number.isFinite(left) && Number.isFinite(right)) {
        return { imageCount: left, videoCount: right };
      }
    }
    void priceCents;
    return { imageCount: -1, videoCount: -1 };
  }

  function findClickCardRoot(target) {
    if (!(target instanceof Element)) return null;
    let node = target.closest('button, a, [role="button"], article, li, div');
    if (!node) return target;

    let best = node;
    let depth = 0;
    while (node && depth < 8) {
      const text = ((node.textContent || '').replace(/\s+/g, ' ').trim() || '').toLowerCase();
      if (text && (text.includes('unlock') || text.includes('locked') || text.includes('$'))) {
        best = node;
      }
      node = node.parentElement;
      depth += 1;
    }
    return best;
  }

  function extractClickFingerprint(target) {
    const root = findClickCardRoot(target);
    const text = root ? (root.textContent || '').replace(/\s+/g, ' ').trim() : '';
    const priceCents = extractPriceCentsFromText(text);
    const counts = parseCountHintsFromText(text, priceCents);
    return {
      priceCents,
      imageCount: counts.imageCount,
      videoCount: counts.videoCount,
      textSample: text.slice(0, 240),
    };
  }

  function clearClickSessionTimer() {
    if (!clickSessionTimer) return;
    window.clearTimeout(clickSessionTimer);
    clickSessionTimer = null;
  }

  function markActiveClickSessionResolved() {
    if (!activeClickSession) return;
    debugLog('session resolved', {
      startedAt: activeClickSession.startedAt,
      messageIds: Array.from(activeClickSession.messageIds),
    });
    activeClickSession.resolved = true;
    clearClickSessionTimer();
    activeClickSession = null;
  }

  function setActiveClickSession(messageIds, target, startedAt) {
    clearClickSessionTimer();
    const normalizedMessageIds = normalizeIdSet(messageIds);
    const clickFingerprint = extractClickFingerprint(target);
    activeClickSession = {
      startedAt,
      messageIds: normalizedMessageIds,
      expiresAt: startedAt + CLICK_UPDATE_WINDOW_MS,
      resolved: false,
      target: target instanceof Element ? target : null,
      clickFingerprint,
    };
    debugLog('session started', {
      startedAt,
      messageIds: Array.from(normalizedMessageIds),
      clickFingerprint,
    });

    clickSessionTimer = window.setTimeout(() => {
      if (!activeClickSession) return;
      if (activeClickSession.resolved) return;
      if (activeClickSession.startedAt !== startedAt) return;
      debugLog('session timeout -> no match', {
        startedAt,
        messageIds: Array.from(activeClickSession.messageIds),
        clickFingerprint: activeClickSession.clickFingerprint,
      });
      activeClickSession = null;
      showOverlay(NO_MATCH_TEXT, false);
    }, CLICK_UPDATE_WINDOW_MS + 25);
  }

  function getActiveClickSession(now) {
    if (!activeClickSession) return null;
    if (activeClickSession.resolved) return null;
    if (now > activeClickSession.expiresAt) return null;
    return activeClickSession;
  }

  function upsertDurationIndex(map, rawId, entry) {
    const id = normalizeIdCandidate(rawId);
    if (!id) return;
    const existing = map.get(id) || null;
    const chosen = chooseBetterEntry(existing, entry);
    if (!chosen) return;
    if (map.has(id)) map.delete(id);
    map.set(id, chosen);
    if (map.size > MAX_INDEX_ENTRIES) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
    }
  }

  function processDuration(duration, url, forceRefresh) {
    if (!duration) return;

    const key = url || 'latest';
    if (!forceRefresh && cache.get(key) === duration) return;

    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }

    cache.set(key, duration);
    showOverlay(duration, false);
  }

  function addCandidate(set, rawValue) {
    const normalized = normalizeIdCandidate(rawValue);
    if (normalized) set.add(normalized);
  }

  function collectIdsFromText(text, ids) {
    if (!text || typeof text !== 'string') return;
    const patterns = [
      { type: 'message', re: /message(?:_|-|\/)?id(?:=|:|\/|-)?([a-z0-9_-]{2,})/gi },
      { type: 'media', re: /media(?:_|-|\/)?id(?:=|:|\/|-)?([a-z0-9_-]{2,})/gi },
      { type: 'post', re: /post(?:_|-|\/)?id(?:=|:|\/|-)?([a-z0-9_-]{2,})/gi },
      { type: 'message', re: /\/messages?\/([a-z0-9_-]{2,})/gi },
      { type: 'media', re: /\/media\/([a-z0-9_-]{2,})/gi },
      { type: 'post', re: /\/posts?\/([a-z0-9_-]{2,})/gi },
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.re.exec(text)) !== null) {
        if (pattern.type === 'message') addCandidate(ids.messageIds, match[1]);
        if (pattern.type === 'media') addCandidate(ids.mediaIds, match[1]);
        if (pattern.type === 'post') addCandidate(ids.postIds, match[1]);
      }
    }
  }

  function collectIdsFromElement(start) {
    const ids = {
      messageIds: new Set(),
      mediaIds: new Set(),
      postIds: new Set(),
    };
    if (!(start instanceof Element)) return ids;

    let node = start;
    let depth = 0;
    while (node && depth < 10) {
      const attrNames = node.getAttributeNames();
      for (const attrName of attrNames) {
        const value = node.getAttribute(attrName) || '';
        const lowerName = attrName.toLowerCase();

        if (lowerName.includes('message')) addCandidate(ids.messageIds, value);
        if (lowerName.includes('media')) addCandidate(ids.mediaIds, value);
        if (lowerName.includes('post')) addCandidate(ids.postIds, value);

        collectIdsFromText(`${lowerName}=${value}`, ids);
      }

      const href = node.getAttribute('href');
      const src = node.getAttribute('src');
      if (href) collectIdsFromText(href, ids);
      if (src) collectIdsFromText(src, ids);

      const idAttr = node.getAttribute('id');
      if (idAttr) collectIdsFromText(idAttr, ids);

      node = node.parentElement;
      depth += 1;
    }

    return ids;
  }

  function getBestEntryFromMap(map, idSet) {
    let best = null;
    for (const id of idSet) {
      const entry = map.get(id);
      best = chooseBetterEntry(best, entry || null);
    }
    return best;
  }

  function findDurationForIds(ids, options) {
    const strictMessageOnly = Boolean(options && options.strictMessageOnly);
    const byMessage = getBestEntryFromMap(durationByMessageId, ids.messageIds);
    if (byMessage) return byMessage;
    if (strictMessageOnly) return null;

    const byMedia = getBestEntryFromMap(durationByMediaId, ids.mediaIds);
    if (byMedia) return byMedia;

    const byPost = getBestEntryFromMap(durationByPostId, ids.postIds);
    if (byPost) return byPost;

    return null;
  }

  function findBestSummaryForIds(ids) {
    let best = null;
    for (const messageId of ids.messageIds) {
      const summary = summaryByMessageId.get(messageId);
      if (!summary) continue;
      if (!best) {
        best = summary;
        continue;
      }
      const bestResolvedDuration = resolveSummaryDuration(best);
      const nextResolvedDuration = resolveSummaryDuration(summary);
      const bestSeconds =
        (bestResolvedDuration && Number(bestResolvedDuration.seconds)) ||
        Number(best.bestDurationSeconds) ||
        0;
      const nextSeconds =
        (nextResolvedDuration && Number(nextResolvedDuration.seconds)) ||
        Number(summary.bestDurationSeconds) ||
        0;
      if (nextSeconds > bestSeconds) {
        best = summary;
        continue;
      }
      if (nextSeconds === bestSeconds) {
        const bestTotal = Number(best.totalVideoSeconds) || 0;
        const nextTotal = Number(summary.totalVideoSeconds) || 0;
        if (nextTotal > bestTotal) best = summary;
      }
    }
    return best;
  }

  function getRequestStartedAt(data) {
    const startedAt = Number(data && data.requestStartedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return 0;
    return Math.floor(startedAt);
  }

  function isEventFromCurrentClick(data, session) {
    if (!session) return false;
    const startedAt = getRequestStartedAt(data);
    if (!startedAt) return false;
    return (
      startedAt + CLICK_REQUEST_EPSILON_MS >= session.startedAt &&
      startedAt <= session.expiresAt + CLICK_REQUEST_EPSILON_MS
    );
  }

  function collectMatchingMessageIds(rawSummaries, expectedMessageIds) {
    const matched = new Set();
    if (!Array.isArray(rawSummaries) || expectedMessageIds.size === 0) return matched;
    for (const summary of rawSummaries) {
      const messageId = normalizeIdCandidate(summary && summary.messageId);
      if (!messageId) continue;
      if (!expectedMessageIds.has(messageId)) continue;
      matched.add(messageId);
    }
    return matched;
  }

  function scoreSummaryByClickFingerprint(summary, clickFingerprint) {
    if (!summary || !clickFingerprint) return Number.NEGATIVE_INFINITY;
    const expectedImages = Number(clickFingerprint.imageCount);
    const expectedVideos = Number(clickFingerprint.videoCount);
    const expectedPriceCents = Math.max(0, Number(clickFingerprint.priceCents) || 0);
    const hasExpectedImages = Number.isFinite(expectedImages) && expectedImages >= 0;
    const hasExpectedVideos = Number.isFinite(expectedVideos) && expectedVideos >= 0;
    const hasExpectedPrice = expectedPriceCents > 0;
    if (!hasExpectedImages && !hasExpectedVideos && !hasExpectedPrice) {
      return Number.NEGATIVE_INFINITY;
    }

    const imageCount = Math.max(0, Number(summary.imageCount) || 0);
    const videoCount = Math.max(0, Number(summary.videoCount) || 0);
    const priceCents = Math.max(0, Number(summary.priceCents) || 0);
    const bestDurationSeconds = Math.max(0, Number(summary.bestDurationSeconds) || 0);
    const contentType = String(summary.contentType || '').toLowerCase();

    let score = 0;
    if (hasExpectedPrice) {
      if (priceCents > 0) {
        const diff = Math.abs(priceCents - expectedPriceCents);
        if (diff === 0) score += 12;
        else if (diff <= 50) score += 8;
        else if (diff <= 200) score += 3;
        else score -= 6;
      } else {
        score -= 2;
      }
    }
    if (hasExpectedImages) {
      const diff = Math.abs(imageCount - expectedImages);
      score += diff === 0 ? 6 : Math.max(0, 3 - diff);
    }
    if (hasExpectedVideos) {
      const diff = Math.abs(videoCount - expectedVideos);
      score += diff === 0 ? 6 : Math.max(0, 3 - diff);
    }
    if (hasExpectedImages && hasExpectedVideos && imageCount === expectedImages && videoCount === expectedVideos) {
      score += 8;
    }
    if (expectedImages > 0 && expectedVideos > 0 && contentType === 'mixed') score += 2;
    if (expectedVideos > 0 && expectedImages === 0 && contentType === 'video') score += 2;
    if (bestDurationSeconds > 0) score += 1;

    return score;
  }

  function chooseHybridFallbackSummary(rawSummaries, clickFingerprint) {
    if (!Array.isArray(rawSummaries) || rawSummaries.length === 0) return null;
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let secondScore = Number.NEGATIVE_INFINITY;
    const scored = [];

    for (const summary of rawSummaries) {
      const messageId = normalizeIdCandidate(summary && summary.messageId);
      if (!messageId) continue;
      const score = scoreSummaryByClickFingerprint(summary, clickFingerprint);
      if (!Number.isFinite(score)) continue;
      scored.push({
        summary,
        score,
        messageId,
        updatedAt: Number(summary && summary.updatedAt) || 0,
      });

      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        best = summary;
        continue;
      }
      if (score > secondScore) secondScore = score;
    }

    if (!best) return null;
    const margin = bestScore - secondScore;

    const topCandidates = scored
      .filter((row) => row.score === bestScore)
      .sort((a, b) => {
        if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
        return String(b.messageId).localeCompare(String(a.messageId));
      });

    let chosen = best;
    let tieBreakReason = '';
    if (topCandidates.length > 1) {
      const nonLastResolved = topCandidates.find(
        (row) => !lastResolvedMessageId || row.messageId !== lastResolvedMessageId
      );
      if (nonLastResolved) {
        chosen = nonLastResolved.summary;
        tieBreakReason = 'exclude_last_resolved';
      } else {
        chosen = topCandidates[0].summary;
        tieBreakReason = 'most_recent_updated';
      }
    }

    debugLog('hybrid fallback scoring', {
      bestScore,
      secondScore,
      margin,
      thresholdScore: HYBRID_FALLBACK_MIN_SCORE,
      thresholdMargin: HYBRID_FALLBACK_MIN_MARGIN,
      topCandidateCount: topCandidates.length,
      tieBreakReason,
      candidateMessageId: chosen && chosen.messageId,
      candidatePriceCents: chosen ? Number(chosen.priceCents) || 0 : 0,
      candidateImageCount: chosen ? Number(chosen.imageCount) || 0 : 0,
      candidateVideoCount: chosen ? Number(chosen.videoCount) || 0 : 0,
      candidateTotalVideoSeconds: chosen ? Number(chosen.totalVideoSeconds) || 0 : 0,
      candidateBestDuration: chosen ? String(chosen.bestDuration || '') : '',
    });
    if (bestScore < HYBRID_FALLBACK_MIN_SCORE) return null;
    if (margin < HYBRID_FALLBACK_MIN_MARGIN && topCandidates.length <= 1) return null;
    return chosen;
  }

  function chooseHybridFallbackSummaryFromRows(rows, clickFingerprint) {
    if (!rows || typeof rows[Symbol.iterator] !== 'function') return null;
    return chooseHybridFallbackSummary(Array.from(rows), clickFingerprint);
  }

  function pinSummariesForIdSet(messageIds, selectedAt) {
    let changed = false;
    for (const messageId of messageIds) {
      if (pinSummaryForMessageId(messageId, selectedAt)) changed = true;
    }
    if (changed) renderSummaryList();
    return changed;
  }

  function pinSummaryForMessageId(rawMessageId, selectedAt) {
    const messageId = normalizeIdCandidate(rawMessageId);
    if (!messageId) return false;
    const row = summaryByMessageId.get(messageId);
    if (!row) return false;

    const existing = selectedSummaryByMessageId.get(messageId);
    const nextRow = {
      ...row,
      selectedAt:
        (existing && Number(existing.selectedAt)) || Number(selectedAt) || Date.now(),
    };

    if (selectedSummaryByMessageId.has(messageId)) {
      selectedSummaryByMessageId.delete(messageId);
    }
    selectedSummaryByMessageId.set(messageId, nextRow);

    if (selectedSummaryByMessageId.size > MAX_VISIBLE_SUMMARIES) {
      const oldest = selectedSummaryByMessageId.keys().next().value;
      selectedSummaryByMessageId.delete(oldest);
    }
    return true;
  }

  function isLikelyMessageInteraction(target) {
    if (!(target instanceof Element)) return false;

    const probe = target.closest('button, a, [role="button"], article, li, div');
    if (!probe) return false;

    const blob = [
      probe.getAttribute('class') || '',
      probe.getAttribute('id') || '',
      probe.getAttribute('data-testid') || '',
      probe.getAttribute('aria-label') || '',
      probe.getAttribute('href') || '',
      target.getAttribute('class') || '',
      target.getAttribute('data-testid') || '',
      (probe.textContent || '').slice(0, 220),
    ]
      .join(' ')
      .toLowerCase();

    const keywordMatch = [
      'message',
      'chat',
      'locked',
      'unlock',
      'purchase',
      'pay',
      'ppv',
      'video',
      'media',
    ].some((token) => blob.includes(token));

    const inChatView = window.location.pathname.toLowerCase().includes('/chats');
    if (inChatView && keywordMatch) return true;

    return blob.includes('locked') || blob.includes('unlock') || blob.includes('ppv');
  }

  function truncateId(value) {
    const text = String(value || '');
    if (text.length <= 10) return text;
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
  }

  function extractMessageIdFromApiUrl(url) {
    if (typeof url !== 'string' || !url) return '';
    try {
      const parsed = new URL(url, window.location.origin);
      const candidates = [
        parsed.searchParams.get('id'),
        parsed.searchParams.get('message'),
        parsed.searchParams.get('messageId'),
        parsed.searchParams.get('message_id'),
      ];
      for (const candidate of candidates) {
        const normalized = normalizeIdCandidate(candidate);
        if (normalized) return normalized;
      }

      const pathPatterns = [/\/messages?\/([a-z0-9_-]{2,})(?:\/|$)/i, /\/ppv\/([a-z0-9_-]{2,})(?:\/|$)/i];
      for (const pattern of pathPatterns) {
        const match = parsed.pathname.match(pattern);
        if (!match || !match[1]) continue;
        const normalized = normalizeIdCandidate(match[1]);
        if (normalized) return normalized;
      }
    } catch (_) {}

    const regexes = [
      /[?&]id=([a-z0-9_-]{2,})/i,
      /[?&]message=([a-z0-9_-]{2,})/i,
      /[?&]messageId=([a-z0-9_-]{2,})/i,
      /[?&]message_id=([a-z0-9_-]{2,})/i,
      /\/messages?\/([a-z0-9_-]{2,})(?:\/|$)/i,
      /\/ppv\/([a-z0-9_-]{2,})(?:\/|$)/i,
    ];
    for (const pattern of regexes) {
      const match = String(url).match(pattern);
      if (!match || !match[1]) continue;
      const normalized = normalizeIdCandidate(match[1]);
      if (normalized) return normalized;
    }
    return '';
  }

  function buildMessageUrlFromApi(rawMessageId, rawUrl) {
    const messageId = normalizeIdCandidate(rawMessageId);
    if (!messageId) return '';
    let chatId = '';

    if (typeof rawUrl === 'string' && rawUrl) {
      const chatMatch = rawUrl.match(/\/(?:my\/)?chats(?:\/chat)?\/(\d+)/i);
      if (chatMatch && chatMatch[1]) chatId = chatMatch[1];
    }

    if (chatId) {
      return `https://onlyfans.com/my/chats/chat/${encodeURIComponent(
        chatId
      )}?message=${encodeURIComponent(messageId)}`;
    }
    return `https://onlyfans.com/my/chats?message=${encodeURIComponent(messageId)}`;
  }

  function buildSummaryMeta(summary) {
    const contentType = summary.contentType || 'unknown';
    const imageCount = Number(summary.imageCount) || 0;
    const videoCount = Number(summary.videoCount) || 0;
    const totalVideoDuration =
      typeof summary.totalVideoDuration === 'string' && summary.totalVideoDuration
        ? summary.totalVideoDuration
        : formatDurationFromSeconds(Number(summary.totalVideoSeconds) || 0) || '0s';
    return `${contentType} | ${imageCount} img | ${videoCount} vid | total ${totalVideoDuration}`;
  }

  function resolveSummaryDuration(summary) {
    if (!summary || typeof summary !== 'object') return null;

    const totalSeconds = Math.max(0, Number(summary.totalVideoSeconds) || 0);
    const totalDurationText =
      typeof summary.totalVideoDuration === 'string' ? summary.totalVideoDuration.trim() : '';
    if (totalSeconds > 0) {
      return {
        text: totalDurationText || formatDurationFromSeconds(totalSeconds),
        seconds: totalSeconds,
      };
    }

    const bestDurationText =
      typeof summary.bestDuration === 'string' ? summary.bestDuration.trim() : '';
    if (!bestDurationText) return null;
    const bestDurationSeconds =
      Math.max(0, Number(summary.bestDurationSeconds) || 0) ||
      parseDurationTextToSeconds(bestDurationText);
    return {
      text: bestDurationText,
      seconds: bestDurationSeconds,
    };
  }

  function renderSummaryList() {
    ensureOverlay();
    if (!summaryListEl) return;

    const rows = Array.from(selectedSummaryByMessageId.values())
      .sort((a, b) => (Number(b.selectedAt) || 0) - (Number(a.selectedAt) || 0))
      .slice(0, 10);

    summaryListEl.innerHTML = '';
    if (rows.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'of-summary-empty';
      emptyEl.textContent = 'Click a locked message to add it.';
      summaryListEl.appendChild(emptyEl);
      return;
    }

    for (const row of rows) {
      const itemEl = document.createElement('div');
      itemEl.className = 'of-summary-item';

      const linkEl = document.createElement('a');
      linkEl.className = 'of-summary-link';
      linkEl.href = row.messageUrl || row.url || '#';
      linkEl.target = '_blank';
      linkEl.rel = 'noopener noreferrer';
      linkEl.textContent = row.shortLink || `msg:${truncateId(row.messageId)}`;

      const durationEl = document.createElement('span');
      durationEl.className = 'of-summary-duration';
      const resolvedDuration = resolveSummaryDuration(row);
      durationEl.textContent = (resolvedDuration && resolvedDuration.text) || '--';

      const rightEl = document.createElement('div');
      rightEl.className = 'of-summary-right';
      rightEl.appendChild(durationEl);

      const pathUrl = typeof row.url === 'string' ? row.url.trim() : '';
      if (pathUrl) {
        const pathEl = document.createElement('button');
        pathEl.type = 'button';
        pathEl.className = 'of-summary-path-btn';
        pathEl.title = 'Copy API path';
        pathEl.textContent = 'Path';
        pathEl.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (pathEl.disabled) return;
          pathEl.disabled = true;

          void copyTextToClipboard(pathUrl).then((copied) => {
            pathEl.textContent = copied ? 'Copied' : 'Failed';
            window.setTimeout(() => {
              pathEl.textContent = 'Path';
              pathEl.disabled = false;
            }, 1100);
          });
        });
        rightEl.appendChild(pathEl);
      }

      const metaEl = document.createElement('div');
      metaEl.className = 'of-summary-meta';
      metaEl.textContent = buildSummaryMeta(row);

      itemEl.appendChild(linkEl);
      itemEl.appendChild(rightEl);
      itemEl.appendChild(metaEl);
      summaryListEl.appendChild(itemEl);
    }
  }

  function upsertSyntheticSummary(rawMessageId, duration, url) {
    const messageId = normalizeIdCandidate(rawMessageId);
    if (!messageId) return '';

    const durationText = String(duration || '').trim();
    const durationSeconds = parseDurationTextToSeconds(durationText);
    const existing = summaryByMessageId.get(messageId);
    const existingBest = Number(existing && existing.bestDurationSeconds) || 0;
    const keepExistingBest = existingBest > durationSeconds;

    const row = {
      messageId,
      shortLink:
        (existing && typeof existing.shortLink === 'string' && existing.shortLink) ||
        `msg:${truncateId(messageId)}`,
      messageUrl:
        (existing && typeof existing.messageUrl === 'string' && existing.messageUrl) ||
        buildMessageUrlFromApi(messageId, url),
      url: (existing && typeof existing.url === 'string' && existing.url) || url || '',
      priceCents: Math.max(0, Number(existing && existing.priceCents) || 0),
      contentType:
        (existing && typeof existing.contentType === 'string' && existing.contentType) ||
        'unknown',
      imageCount: Number(existing && existing.imageCount) || 0,
      videoCount: Number(existing && existing.videoCount) || 0,
      totalVideoSeconds:
        Number(existing && existing.totalVideoSeconds) ||
        (durationSeconds > 0 ? durationSeconds : 0),
      totalVideoDuration:
        (existing && typeof existing.totalVideoDuration === 'string' && existing.totalVideoDuration) ||
        (durationSeconds > 0 ? formatDurationFromSeconds(durationSeconds) : '0s'),
      bestDuration:
        keepExistingBest
          ? existing.bestDuration
          : durationText || (existing && existing.bestDuration) || '',
      bestDurationSeconds: keepExistingBest ? existingBest : durationSeconds,
      updatedAt: Date.now(),
    };

    if (summaryByMessageId.has(messageId)) summaryByMessageId.delete(messageId);
    summaryByMessageId.set(messageId, row);
    if (summaryByMessageId.size > MAX_SUMMARY_ENTRIES) {
      const oldest = summaryByMessageId.keys().next().value;
      summaryByMessageId.delete(oldest);
    }

    if (durationSeconds > 0) {
      upsertDurationIndex(durationByMessageId, messageId, {
        duration: durationText,
        seconds: durationSeconds,
        url: row.messageUrl || row.url || url || '',
      });
    }

    return messageId;
  }

  function ingestDurationEntries(entries) {
    if (!Array.isArray(entries)) return;
    for (const item of entries) {
      if (!item || typeof item.duration !== 'string') continue;
      const seconds = Number(item.seconds);
      if (!Number.isFinite(seconds) || seconds <= 0) continue;
      const entry = {
        duration: item.duration.trim(),
        seconds: Math.floor(seconds),
        url: typeof item.url === 'string' ? item.url : '',
      };
      if (!entry.duration) continue;
      upsertDurationIndex(durationByMessageId, item.messageId, entry);
      upsertDurationIndex(durationByMediaId, item.mediaId, entry);
      upsertDurationIndex(durationByPostId, item.postId, entry);
    }
  }

  function ingestMessageSummaries(summaries) {
    if (!Array.isArray(summaries)) return;
    const now = Date.now();
    let shouldRender = false;

    for (const summary of summaries) {
      if (!summary || !summary.messageId) continue;
      const messageId = normalizeIdCandidate(summary.messageId);
      if (!messageId) continue;

      const bestDuration =
        typeof summary.bestDuration === 'string' ? summary.bestDuration.trim() : '';
      const bestDurationSeconds = Number(summary.bestDurationSeconds) || 0;
      const messageUrl =
        typeof summary.messageUrl === 'string' && summary.messageUrl
          ? summary.messageUrl
          : typeof summary.url === 'string'
            ? summary.url
            : '';

      const row = {
        messageId,
        shortLink:
          typeof summary.shortLink === 'string' && summary.shortLink
            ? summary.shortLink
            : `msg:${truncateId(messageId)}`,
        messageUrl,
        url: typeof summary.url === 'string' ? summary.url : '',
        priceCents: Math.max(0, Number(summary.priceCents) || 0),
        contentType:
          typeof summary.contentType === 'string' && summary.contentType
            ? summary.contentType
            : 'unknown',
        imageCount: Number(summary.imageCount) || 0,
        videoCount: Number(summary.videoCount) || 0,
        totalVideoSeconds: Number(summary.totalVideoSeconds) || 0,
        totalVideoDuration:
          typeof summary.totalVideoDuration === 'string' ? summary.totalVideoDuration : '',
        bestDuration,
        bestDurationSeconds,
        updatedAt: Date.now(),
      };

      if (summaryByMessageId.has(messageId)) summaryByMessageId.delete(messageId);
      summaryByMessageId.set(messageId, row);
      if (summaryByMessageId.size > MAX_SUMMARY_ENTRIES) {
        const oldest = summaryByMessageId.keys().next().value;
        summaryByMessageId.delete(oldest);
      }

      const existingSelected = selectedSummaryByMessageId.get(messageId);
      if (existingSelected) {
        const updatedSelected = {
          ...row,
          selectedAt:
            (Number(existingSelected.selectedAt) || Number(existingSelected.updatedAt) || now),
        };
        selectedSummaryByMessageId.delete(messageId);
        selectedSummaryByMessageId.set(messageId, updatedSelected);
        shouldRender = true;
      }

      const resolvedDuration = resolveSummaryDuration(row);
      if (
        resolvedDuration &&
        typeof resolvedDuration.text === 'string' &&
        resolvedDuration.text &&
        resolvedDuration.seconds > 0
      ) {
        const entry = {
          duration: resolvedDuration.text,
          seconds: Math.floor(resolvedDuration.seconds),
          url: row.messageUrl || row.url || '',
        };
        upsertDurationIndex(durationByMessageId, messageId, entry);
      }
    }

    if (shouldRender) renderSummaryList();
  }

  function resolveActiveClickSession(duration, url, rawMessageId, selectedAt) {
    const normalizedMessageId = normalizeIdCandidate(rawMessageId);
    if (normalizedMessageId) lastResolvedMessageId = normalizedMessageId;
    if (rawMessageId && pinSummaryForMessageId(rawMessageId, selectedAt || Date.now())) {
      renderSummaryList();
    }
    processDuration(duration, url || 'clicked-item', true);
    debugLog('resolved duration', {
      duration,
      url: url || 'clicked-item',
      messageId: rawMessageId || '',
      selectedAt: selectedAt || Date.now(),
    });
    markActiveClickSessionResolved();
  }

  function onDocumentClick(event) {
    if (overlayEl && event.target instanceof Node && overlayEl.contains(event.target)) return;
    if (!isLikelyMessageInteraction(event.target)) return;

    const selectedAt = Date.now();
    const clickIds = collectIdsFromElement(event.target);
    setActiveClickSession(clickIds.messageIds, event.target, selectedAt);
    pinSummariesForIdSet(clickIds.messageIds, selectedAt);
    debugLog('document click', {
      selectedAt,
      messageIds: Array.from(clickIds.messageIds),
      mediaIds: Array.from(clickIds.mediaIds),
      postIds: Array.from(clickIds.postIds),
      summaryCacheSize: summaryByMessageId.size,
    });

    if (!hookReady) {
      showOverlay(HOOK_MISSING_TEXT, false);
    }

    const matched = findDurationForIds(clickIds, { strictMessageOnly: true });
    if (matched) {
      debugLog('resolved from local duration index');
      resolveActiveClickSession(matched.duration, matched.url || 'clicked-item', '', selectedAt);
      return;
    }

    const summaryMatch = findBestSummaryForIds(clickIds);
    const resolvedSummaryDuration = resolveSummaryDuration(summaryMatch);
    if (summaryMatch && resolvedSummaryDuration && resolvedSummaryDuration.text) {
      debugLog('resolved from cached summary match', { messageId: summaryMatch.messageId || '' });
      resolveActiveClickSession(
        resolvedSummaryDuration.text,
        summaryMatch.messageUrl || summaryMatch.url || 'clicked-item',
        summaryMatch.messageId || '',
        selectedAt
      );
      return;
    }

    if (clickIds.messageIds.size === 0) {
      const hybridFromCache = chooseHybridFallbackSummaryFromRows(
        summaryByMessageId.values(),
        activeClickSession && activeClickSession.clickFingerprint
      );
      if (hybridFromCache) {
        const cachedMessageId = normalizeIdCandidate(hybridFromCache.messageId);
        const cachedResolvedDuration = resolveSummaryDuration(hybridFromCache);
        const cachedDuration =
          cachedResolvedDuration && cachedResolvedDuration.text
            ? cachedResolvedDuration.text
            : '';
        if (cachedMessageId && cachedDuration) {
          debugLog('resolved from cached hybrid fallback', {
            messageId: cachedMessageId,
            imageCount: Number(hybridFromCache.imageCount) || 0,
            videoCount: Number(hybridFromCache.videoCount) || 0,
            totalVideoSeconds: Number(hybridFromCache.totalVideoSeconds) || 0,
          });
          resolveActiveClickSession(
            cachedDuration,
            hybridFromCache.messageUrl || hybridFromCache.url || 'clicked-item',
            cachedMessageId,
            selectedAt
          );
          return;
        }
      }
    }

    showLoadingOverlay();
  }

  function onPageDurationMessage(event) {
    if (event.source !== window) return;
    // Defense-in-depth: only accept messages from the current origin.
    // (The page itself can still spoof data.source, but this blocks cross-origin noise.)
    try {
      if (typeof event.origin === 'string' && event.origin && event.origin !== window.location.origin) {
        return;
      }
    } catch (_) {}

    const data = event.data;
    if (!data || data.source !== MESSAGE_SOURCE) return;

    if (data.type === 'hookReady') {
      hookReady = true;
      return;
    }

    if (data.type === 'durationEntries') {
      ingestDurationEntries(data.entries);
      return;
    }

    if (data.type === 'messageSummaries') {
      ingestMessageSummaries(data.summaries);
      const now = Date.now();
      const session = getActiveClickSession(now);
      if (!session) return;
      if (!isEventFromCurrentClick(data, session)) return;
      debugLog('messageSummaries received for active session', {
        startedAt: session.startedAt,
        summaryCount: Array.isArray(data.summaries) ? data.summaries.length : 0,
        requestStartedAt: getRequestStartedAt(data),
      });

      let matchedMessageIds = new Set();
      if (session.messageIds.size > 0) {
        matchedMessageIds = collectMatchingMessageIds(data.summaries, session.messageIds);
        debugLog('strict summary ID match result', {
          expected: Array.from(session.messageIds),
          matched: Array.from(matchedMessageIds),
        });
      } else {
        const hybridSummary = chooseHybridFallbackSummary(data.summaries, session.clickFingerprint);
        const hybridMessageId = normalizeIdCandidate(hybridSummary && hybridSummary.messageId);
        if (hybridMessageId) matchedMessageIds.add(hybridMessageId);
        debugLog('hybrid summary match result', {
          matched: Array.from(matchedMessageIds),
          clickFingerprint: session.clickFingerprint,
        });
      }

      if (matchedMessageIds.size > 0) {
        pinSummariesForIdSet(matchedMessageIds, now);

        const matched = getBestEntryFromMap(durationByMessageId, matchedMessageIds);
        if (matched && matched.duration) {
          resolveActiveClickSession(matched.duration, matched.url || 'clicked-item', '', now);
          return;
        }

        const matchedSummary = findBestSummaryForIds({
          messageIds: matchedMessageIds,
          mediaIds: new Set(),
          postIds: new Set(),
        });
        const matchedResolvedDuration = resolveSummaryDuration(matchedSummary);
        if (matchedSummary && matchedResolvedDuration && matchedResolvedDuration.text) {
          resolveActiveClickSession(
            matchedResolvedDuration.text,
            matchedSummary.messageUrl || matchedSummary.url || 'clicked-item',
            matchedSummary.messageId || '',
            now
          );
        }
      }
      return;
    }

    if (data.type !== 'duration') return;
    if (typeof data.duration !== 'string' || !data.duration.trim()) return;

    const now = Date.now();
    const session = getActiveClickSession(now);
    const url = typeof data.url === 'string' ? data.url : '';
    const durationText = data.duration.trim();

    if (!session) {
      if (!USE_RAW_DURATION_EVENTS) return;
      if (!PASSIVE_DURATION_UPDATES) return;
      debugLog('passive duration event accepted', { durationText, url });
      processDuration(durationText, url, false);
      return;
    }

    if (!isEventFromCurrentClick(data, session)) return;

    const messageIdFromUrl = extractMessageIdFromApiUrl(url);
    if (!messageIdFromUrl) return;
    if (session.messageIds.size === 0 || !session.messageIds.has(messageIdFromUrl)) return;
    debugLog('duration matched by URL message ID', {
      messageIdFromUrl,
      durationText,
      url,
    });

    upsertSyntheticSummary(messageIdFromUrl, durationText, url);
    resolveActiveClickSession(durationText, url || 'clicked-item', messageIdFromUrl, now);
  }

  function injectPageHook() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) return;

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-hook.js');
    script.async = false;
    script.onload = () => {
      script.remove();
    };
    script.onerror = () => {
      showOverlay(HOOK_MISSING_TEXT, false);
    };

    const root = document.documentElement || document.head || document.body;
    if (root) {
      root.appendChild(script);
      return;
    }

    document.addEventListener(
      'DOMContentLoaded',
      () => {
        const fallbackRoot = document.documentElement || document.head || document.body;
        if (fallbackRoot) fallbackRoot.appendChild(script);
      },
      { once: true }
    );
  }

  window.__OF_DURATION_VIEWER_SET_DEBUG__ = function (enabled) {
    const on = Boolean(enabled);
    try {
      window[DEBUG_GLOBAL_FLAG] = on;
    } catch (_) {}
    try {
      if (typeof localStorage !== 'undefined') {
        if (on) localStorage.setItem(DEBUG_STORAGE_KEY, '1');
        else localStorage.removeItem(DEBUG_STORAGE_KEY);
      }
    } catch (_) {}
    console.log(`[of-duration-viewer] debug ${on ? 'enabled' : 'disabled'}`);
  };

  if (isDebugEnabled()) {
    debugLog('debug mode is enabled');
  }

  window.addEventListener('click', onDocumentClick, true);
  window.addEventListener('message', onPageDurationMessage);
  injectPageHook();
})();
