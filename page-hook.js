(function () {
  'use strict';

  if (window.__OF_DURATION_VIEWER_HOOKED__) return;
  window.__OF_DURATION_VIEWER_HOOKED__ = true;

  const MESSAGE_SOURCE = 'of-duration-viewer';
  const DEBUG_STORAGE_KEY = 'ofDurationViewerDebug';
  const DEBUG_GLOBAL_FLAG = '__OF_DURATION_VIEWER_DEBUG__';
  const TARGET_ORIGIN =
    typeof window.location === 'object' &&
    typeof window.location.origin === 'string' &&
    window.location.origin &&
    window.location.origin !== 'null'
      ? window.location.origin
      : '*';

  window.__OF_DURATION_VIEWER_SET_DEBUG__ = function (enabled) {
    const on = Boolean(enabled);
    try {
      window[DEBUG_GLOBAL_FLAG] = on;
    } catch (_) {}
    try {
      if (on) window.localStorage.setItem(DEBUG_STORAGE_KEY, '1');
      else window.localStorage.removeItem(DEBUG_STORAGE_KEY);
    } catch (_) {}
    console.log(`[of-duration-viewer] debug ${on ? 'enabled' : 'disabled'}`);
  };

  function isDebugEnabled() {
    try {
      if (window[DEBUG_GLOBAL_FLAG] === true) return true;
    } catch (_) {}
    try {
      const value = window.localStorage.getItem(DEBUG_STORAGE_KEY);
      return value === '1' || value === 'true' || value === 'on';
    } catch (_) {}
    return false;
  }

  function debugLog(...args) {
    if (!isDebugEnabled()) return;
    console.log('[of-duration-viewer:hook]', ...args);
  }

  function buildSummaryDebugPreview(summaries) {
    if (!Array.isArray(summaries) || summaries.length === 0) return [];
    return summaries.slice(0, 3).map((item) => ({
      messageId: item && item.messageId ? String(item.messageId) : '',
      priceCents: Math.max(0, Number(item && item.priceCents) || 0),
      imageCount: Math.max(0, Number(item && item.imageCount) || 0),
      videoCount: Math.max(0, Number(item && item.videoCount) || 0),
      bestDuration: item && typeof item.bestDuration === 'string' ? item.bestDuration : '',
      totalVideoDuration:
        item && typeof item.totalVideoDuration === 'string'
          ? item.totalVideoDuration
          : '',
      totalVideoSeconds: Math.max(0, Number(item && item.totalVideoSeconds) || 0),
    }));
  }

  function buildSummaryDebugLine(summaries) {
    const preview = buildSummaryDebugPreview(summaries);
    if (preview.length === 0) return 'none';
    return preview
      .map((item) => {
        const idText = item.messageId ? truncateId(item.messageId) : 'unknown';
        const priceText = item.priceCents > 0 ? `$${(item.priceCents / 100).toFixed(2)}` : '$?';
        const totalText =
          (item.totalVideoDuration && item.totalVideoDuration.trim()) ||
          formatDuration(item.totalVideoSeconds) ||
          '0s';
        const bestText = item.bestDuration || '--';
        return `${idText} price:${priceText} img:${item.imageCount} vid:${item.videoCount} best:${bestText} total:${totalText}`;
      })
      .join(' || ');
  }

  window.postMessage(
    {
      source: MESSAGE_SOURCE,
      type: 'hookReady',
    },
    TARGET_ORIGIN
  );

  const DURATION_KEYS = new Set([
    'duration',
    'video_duration',
    'media_duration',
    'file_duration',
    'content_duration',
    'post_duration',
    'stream_duration',
    'video_length',
    'media_length',
    'file_length',
  ]);
  const MESSAGE_ID_KEYS = new Set([
    'message_id',
    'messageid',
    'chat_message_id',
    'chatmessageid',
    'conversation_message_id',
    'conversationmessageid',
    'msg_id',
    'msgid',
  ]);
  const MEDIA_ID_KEYS = new Set([
    'media_id',
    'mediaid',
    'video_id',
    'videoid',
    'file_id',
    'fileid',
    'asset_id',
    'assetid',
  ]);
  const POST_ID_KEYS = new Set(['post_id', 'postid', 'publication_id', 'publicationid']);
  const CHAT_ID_KEYS = new Set([
    'chat_id',
    'chatid',
    'conversation_id',
    'conversationid',
    'dialog_id',
    'dialogid',
  ]);
  const IMAGE_COUNT_TOKENS = new Set(['image', 'images', 'img', 'photo', 'photos', 'picture', 'pictures']);
  const VIDEO_COUNT_TOKENS = new Set(['video', 'videos', 'vid', 'vids']);
  const SOURCE_KEY_HINTS = new Set([
    'src',
    'url',
    'source',
    'preview',
    'preview_url',
    'thumb',
    'thumbnail',
    'poster',
    'stream',
    'stream_url',
    'video_url',
    'video_source',
    'file_url',
    'file_source',
  ]);
  const PRICE_KEY_HINTS = new Set([
    'price',
    'unlock_price',
    'locked_price',
    'ppv_price',
    'cost',
    'amount',
  ]);

  function formatDuration(value) {
    if (!Number.isFinite(value) || value < 0) return null;
    const totalSeconds = Math.floor(value);
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

  function parseClockTextToSeconds(text) {
    const parts = text.split(':').map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }

  function parseDurationString(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text) return null;
    if (/^\d+:\d{2}(:\d{2})?$/.test(text)) {
      const seconds = parseClockTextToSeconds(text);
      if (!Number.isFinite(seconds) || seconds < 0) return null;
      return { display: text, seconds };
    }

    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return { display: formatDuration(numeric), seconds: Math.floor(numeric) };
    }

    const unitMatch = text.match(
      /^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i
    );
    if (unitMatch) {
      const amount = Number(unitMatch[1]);
      const unit = unitMatch[2].toLowerCase();
      const multiplier =
        unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1;
      const seconds = Math.floor(amount * multiplier);
      if (seconds < 0) return null;
      return { display: text, seconds };
    }

    const compactUnitRe =
      /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)/gi;
    let compactMatched = false;
    let compactSeconds = 0;
    let consumedUntil = 0;
    let compactMatch;
    while ((compactMatch = compactUnitRe.exec(text)) !== null) {
      const between = text.slice(consumedUntil, compactMatch.index);
      if (between.trim()) return null;
      const amount = Number(compactMatch[1]);
      if (!Number.isFinite(amount) || amount < 0) return null;
      const unit = compactMatch[2].toLowerCase();
      const multiplier =
        unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1;
      compactSeconds += amount * multiplier;
      compactMatched = true;
      consumedUntil = compactUnitRe.lastIndex;
    }
    if (compactMatched) {
      if (text.slice(consumedUntil).trim()) return null;
      return { display: formatDuration(compactSeconds), seconds: Math.floor(compactSeconds) };
    }
    return null;
  }

  function parseDurationValue(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) return null;
      return { display: formatDuration(value), seconds: Math.floor(value) };
    }
    if (typeof value === 'string') return parseDurationString(value);
    return null;
  }

  function chooseBetterCandidate(current, next) {
    if (!next) return current;
    if (!current) return next;

    const currentPositive = current.seconds > 0;
    const nextPositive = next.seconds > 0;
    if (nextPositive && !currentPositive) return next;
    if (!nextPositive && currentPositive) return current;
    if (next.seconds > current.seconds) return next;
    return current;
  }

  function chooseBestEntry(entries) {
    let best = null;
    for (const entry of entries) {
      if (!entry || typeof entry.seconds !== 'number') continue;
      best = chooseBetterCandidate(best, entry);
    }
    return best;
  }

  function normalizeKey(key) {
    return String(key)
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function toSafeId(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^\d{4,}$/.test(trimmed)) return trimmed;
    if (/^[a-f0-9-]{8,}$/i.test(trimmed)) return trimmed.toLowerCase();
    if (/^(?=.*[a-z])(?=.*\d)[a-z0-9]{10,}$/i.test(trimmed)) return trimmed.toLowerCase();
    return '';
  }

  function toNonNegativeInt(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) return null;
      return Math.floor(value);
    }
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return null;
      const numeric = Number(text);
      if (!Number.isFinite(numeric) || numeric < 0) return null;
      return Math.floor(numeric);
    }
    return null;
  }

  function parsePriceCents(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) return 0;
      if (value <= 300) return Math.round(value * 100);
      return Math.round(value);
    }
    if (typeof value !== 'string') return 0;
    const text = value.trim();
    if (!text) return 0;
    const match = text.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
    if (!match || !match[1]) return 0;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount < 0) return 0;
    return Math.round(amount * 100);
  }

  function isPriceKey(normalizedKey) {
    if (!normalizedKey) return false;
    if (PRICE_KEY_HINTS.has(normalizedKey)) return true;
    return normalizedKey.endsWith('_price') || normalizedKey.startsWith('price_');
  }

  function hasDeterministicCountKey(normalizedKey, tokenSet) {
    if (!normalizedKey || !normalizedKey.includes('count')) return false;
    const tokens = normalizedKey.split('_').filter(Boolean);
    if (tokens.length === 0) return false;
    if (!tokens.includes('count')) return false;
    return tokens.some((token) => tokenSet.has(token));
  }

  function isImageCountKey(normalizedKey) {
    return hasDeterministicCountKey(normalizedKey, IMAGE_COUNT_TOKENS);
  }

  function isVideoCountKey(normalizedKey) {
    return hasDeterministicCountKey(normalizedKey, VIDEO_COUNT_TOKENS);
  }

  function isLikelyMediaSourceKey(normalizedKey) {
    if (SOURCE_KEY_HINTS.has(normalizedKey)) return true;
    return (
      normalizedKey.endsWith('_url') ||
      normalizedKey.endsWith('_src') ||
      normalizedKey.endsWith('_source') ||
      normalizedKey.endsWith('_path') ||
      normalizedKey.includes('preview') ||
      normalizedKey.includes('thumb') ||
      normalizedKey.includes('poster')
    );
  }

  function normalizeMediaSource(rawValue) {
    if (typeof rawValue !== 'string') return '';
    const text = rawValue.trim();
    if (!text || text.startsWith('data:')) return '';

    try {
      const parsed = new URL(text, window.location.origin);
      parsed.search = '';
      parsed.hash = '';
      return `${parsed.origin}${parsed.pathname}`.toLowerCase();
    } catch (_) {
      return text.split('?')[0].split('#')[0].trim().toLowerCase();
    }
  }

  function getCanonicalMediaSource(node) {
    if (!node || typeof node !== 'object') return '';
    for (const key of Object.keys(node)) {
      const normalized = normalizeKey(key);
      if (!isLikelyMediaSourceKey(normalized)) continue;
      const normalizedSource = normalizeMediaSource(node[key]);
      if (normalizedSource) return normalizedSource;
    }
    return '';
  }

  function isMediaItemNode(context, mediaType, canonicalSource) {
    if (context && context.mediaId) return true;
    return Boolean(mediaType && canonicalSource);
  }

  function shouldInspectUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl) return false;
    let parsed;
    try {
      parsed = new URL(rawUrl, window.location.origin);
    } catch (_) {
      return false;
    }

    const host = parsed.hostname.toLowerCase();
    const isOnlyFansHost = host === 'onlyfans.com' || host.endsWith('.onlyfans.com');
    if (!isOnlyFansHost) return false;

    const path = parsed.pathname.toLowerCase();
    if (!path.includes('/api')) return false;

    // Messages-only mode: only inspect chat/message-like API paths.
    // This reduces false positives from posts/feed/subscriptions endpoints.
    const messageApiHints = [
      '/chats',
      '/chat',
      '/messages',
      '/message',
      '/ppv',
      '/dialog',
      '/conversation',
    ];
    for (const hint of messageApiHints) {
      if (path.includes(hint)) return true;
    }
    return false;
  }

  function deriveContext(node, parentContext) {
    const next = {
      messageId: parentContext.messageId,
      mediaId: parentContext.mediaId,
      postId: parentContext.postId,
      chatId: parentContext.chatId,
    };

    for (const key of Object.keys(node)) {
      const normalized = normalizeKey(key);
      const id = toSafeId(node[key]);
      if (!id) continue;

      if (!next.messageId && MESSAGE_ID_KEYS.has(normalized)) next.messageId = id;
      if (!next.mediaId && MEDIA_ID_KEYS.has(normalized)) next.mediaId = id;
      if (!next.postId && POST_ID_KEYS.has(normalized)) next.postId = id;
      if (!next.chatId && CHAT_ID_KEYS.has(normalized)) next.chatId = id;

      if (normalized !== 'id') continue;
      if (
        !next.messageId &&
        (Object.prototype.hasOwnProperty.call(node, 'text') ||
          Object.prototype.hasOwnProperty.call(node, 'media') ||
          Object.prototype.hasOwnProperty.call(node, 'files') ||
          Object.prototype.hasOwnProperty.call(node, 'canViewMedia'))
      ) {
        next.messageId = id;
      }
      if (
        !next.mediaId &&
        (Object.prototype.hasOwnProperty.call(node, 'type') ||
          Object.prototype.hasOwnProperty.call(node, 'source') ||
          Object.prototype.hasOwnProperty.call(node, 'videoSources'))
      ) {
        next.mediaId = id;
      }
    }

    return next;
  }

  function isDurationKey(key) {
    const normalized = normalizeKey(key);
    if (!normalized) return false;
    if (DURATION_KEYS.has(normalized)) return true;
    if (normalized.endsWith('_duration')) return true;
    return (
      normalized.endsWith('_duration_seconds') ||
      normalized.endsWith('_duration_secs') ||
      normalized.endsWith('_duration_sec')
    );
  }

  function detectMediaType(node) {
    if (!node || typeof node !== 'object') return '';
    if (node.isVideo === true || node.is_video === true) return 'video';
    if (node.isImage === true || node.is_image === true) return 'image';

    const candidates = [
      node.type,
      node.mediaType,
      node.media_type,
      node.mimeType,
      node.mime_type,
      node.mimetype,
      node.kind,
      node.fileType,
      node.file_type,
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const lower = candidate.toLowerCase();
      if (lower.includes('video')) return 'video';
      if (lower.includes('image') || lower.includes('photo') || lower.includes('picture')) {
        return 'image';
      }
      if (lower.includes('audio')) return 'audio';
    }

    return '';
  }

  function extractDurationsFromNode(node) {
    const parsed = [];
    for (const key of Object.keys(node)) {
      if (!isDurationKey(key)) continue;
      const value = parseDurationValue(node[key]);
      if (value) parsed.push(value);
    }
    return parsed;
  }

  function contentTypeLabel(imageCount, videoCount) {
    if (videoCount > 0 && imageCount > 0) return 'mixed';
    if (videoCount > 0) return 'video';
    if (imageCount > 0) return 'image';
    return 'unknown';
  }

  function truncateId(value) {
    const text = String(value || '');
    if (text.length <= 10) return text;
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
  }

  function extractChatIdFromUrl(url) {
    if (typeof url !== 'string' || !url) return '';
    const patterns = [/\/chats\/(\d+)/i, /\/my\/chats\/chat\/(\d+)/i, /chat(?:_|-|\/)?id[=/:-]?(\d+)/i];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) return match[1];
    }
    return '';
  }

  function buildMessageLink(messageId, chatId, sourceUrl) {
    const safeMessageId = encodeURIComponent(messageId);
    const resolvedChatId = chatId || extractChatIdFromUrl(sourceUrl);
    if (resolvedChatId) {
      return `https://onlyfans.com/my/chats/chat/${encodeURIComponent(
        resolvedChatId
      )}?message=${safeMessageId}`;
    }
    return `https://onlyfans.com/my/chats?message=${safeMessageId}`;
  }

  function collectDurationEntries(root, url) {
    const entries = [];
    const seen = new WeakSet();

    function walk(node, context) {
      if (!node || typeof node !== 'object') return;
      if (seen.has(node)) return;
      seen.add(node);

      const localContext = deriveContext(node, context);
      const keys = Object.keys(node);

      for (const key of keys) {
        if (!isDurationKey(key)) continue;
        const parsed = parseDurationValue(node[key]);
        if (!parsed) continue;
        entries.push({
          duration: parsed.display,
          display: parsed.display,
          seconds: parsed.seconds,
          url: url || '',
          messageId: localContext.messageId || '',
          mediaId: localContext.mediaId || '',
          postId: localContext.postId || '',
        });
      }

      for (const key of keys) {
        const value = node[key];
        if (!value || typeof value !== 'object') continue;
        if (Array.isArray(value)) {
          for (const item of value) walk(item, localContext);
        } else {
          walk(value, localContext);
        }
      }
    }

    walk(root, { messageId: '', mediaId: '', postId: '', chatId: '' });
    return entries;
  }

  function collectMessageSummaries(root, sourceUrl) {
    const summaries = new Map();
    const seen = new WeakSet();
    const objectTokens = new WeakMap();
    let tokenCounter = 1;

    function getObjectToken(node) {
      if (!objectTokens.has(node)) objectTokens.set(node, `obj-${tokenCounter++}`);
      return objectTokens.get(node);
    }

    function ensureSummary(context) {
      if (!context.messageId) return null;
      if (!summaries.has(context.messageId)) {
        summaries.set(context.messageId, {
          messageId: context.messageId,
          postId: context.postId || '',
          chatId: context.chatId || '',
          url: sourceUrl || '',
          priceCents: 0,
          imageCount: 0,
          videoCount: 0,
          bestDuration: '',
          bestDurationSeconds: 0,
          _hasExplicitImageCount: false,
          _hasExplicitVideoCount: false,
          _seenImages: new Set(),
          _seenVideos: new Set(),
          _durationByToken: new Map(),
        });
      }

      const summary = summaries.get(context.messageId);
      if (!summary.chatId && context.chatId) summary.chatId = context.chatId;
      if (!summary.postId && context.postId) summary.postId = context.postId;
      return summary;
    }

    function walk(node, context) {
      if (!node || typeof node !== 'object') return;
      if (seen.has(node)) return;
      seen.add(node);

      const localContext = deriveContext(node, context);
      const summary = ensureSummary(localContext);

      const mediaType = detectMediaType(node);
      const durationCandidates = extractDurationsFromNode(node);
      const bestNodeDuration = chooseBestEntry(durationCandidates);
      const canonicalSource = getCanonicalMediaSource(node);
      const mediaItem = isMediaItemNode(localContext, mediaType, canonicalSource);
      const mediaToken = mediaItem
        ? localContext.mediaId || canonicalSource || getObjectToken(node)
        : '';

      if (summary) {
        for (const key of Object.keys(node)) {
          const normalized = normalizeKey(key);
          if (isPriceKey(normalized)) {
            const cents = parsePriceCents(node[key]);
            if (cents > 0 && (summary.priceCents <= 0 || cents < summary.priceCents)) {
              summary.priceCents = cents;
            }
          }
          const count = toNonNegativeInt(node[key]);
          if (count === null) continue;
          if (isImageCountKey(normalized) && count > summary.imageCount) {
            summary.imageCount = count;
            summary._hasExplicitImageCount = true;
          }
          if (isVideoCountKey(normalized) && count > summary.videoCount) {
            summary.videoCount = count;
            summary._hasExplicitVideoCount = true;
          }
        }
      }

      if (summary && mediaItem && mediaToken) {
        if (
          mediaType === 'image' &&
          !summary._hasExplicitImageCount &&
          !summary._seenImages.has(mediaToken)
        ) {
          summary._seenImages.add(mediaToken);
          summary.imageCount += 1;
        }

        if (
          !summary._hasExplicitVideoCount &&
          mediaType === 'video' &&
          !summary._seenVideos.has(mediaToken)
        ) {
          summary._seenVideos.add(mediaToken);
          summary.videoCount += 1;
        }
      }

      if (summary && bestNodeDuration) {
        if (bestNodeDuration.seconds > summary.bestDurationSeconds) {
          summary.bestDurationSeconds = bestNodeDuration.seconds;
          summary.bestDuration = bestNodeDuration.display;
        }
        if (
          bestNodeDuration.seconds > 0 &&
          mediaItem &&
          mediaToken &&
          mediaType === 'video'
        ) {
          const previousBest = Number(summary._durationByToken.get(mediaToken)) || 0;
          if (bestNodeDuration.seconds > previousBest) {
            summary._durationByToken.set(mediaToken, bestNodeDuration.seconds);
          }
        }
      }

      for (const key of Object.keys(node)) {
        const value = node[key];
        if (!value || typeof value !== 'object') continue;
        if (Array.isArray(value)) {
          for (const item of value) walk(item, localContext);
        } else {
          walk(value, localContext);
        }
      }
    }

    walk(root, { messageId: '', mediaId: '', postId: '', chatId: '' });

    const out = [];
    for (const summary of summaries.values()) {
      let totalVideoSeconds = 0;
      for (const seconds of summary._durationByToken.values()) {
        totalVideoSeconds += Number(seconds) || 0;
      }
      const totalVideoDuration = formatDuration(totalVideoSeconds) || '0s';
      const bestDuration =
        summary.bestDuration ||
        (totalVideoSeconds > 0 ? totalVideoDuration : '');
      out.push({
        messageId: summary.messageId,
        postId: summary.postId,
        chatId: summary.chatId,
        url: summary.url,
        messageUrl: buildMessageLink(summary.messageId, summary.chatId, summary.url),
        shortLink: `msg:${truncateId(summary.messageId)}`,
        contentType: contentTypeLabel(summary.imageCount, summary.videoCount),
        priceCents: summary.priceCents,
        imageCount: summary.imageCount,
        videoCount: summary.videoCount,
        totalVideoSeconds,
        totalVideoDuration,
        bestDuration,
        bestDurationSeconds: summary.bestDurationSeconds,
      });
    }

    return out;
  }

  function findDurationInObj(obj, seen) {
    if (!obj || typeof obj !== 'object') return null;
    if (seen.has(obj)) return null;
    seen.add(obj);

    let bestCandidate = null;
    const keys = Object.keys(obj);
    for (const key of keys) {
      if (!isDurationKey(key)) continue;
      bestCandidate = chooseBetterCandidate(bestCandidate, parseDurationValue(obj[key]));
    }

    for (const key of keys) {
      const value = obj[key];
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (!item || typeof item !== 'object') continue;
          bestCandidate = chooseBetterCandidate(bestCandidate, findDurationInObj(item, seen));
        }
      } else {
        bestCandidate = chooseBetterCandidate(bestCandidate, findDurationInObj(value, seen));
      }
    }
    return bestCandidate;
  }

  function resolveRequestStartedAt(rawValue) {
    const startedAt = Number(rawValue);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return Date.now();
    return Math.floor(startedAt);
  }

  function emitDuration(duration, url, requestStartedAt) {
    if (!duration) return;
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: 'duration',
        duration,
        url: url || '',
        requestStartedAt: resolveRequestStartedAt(requestStartedAt),
      },
      TARGET_ORIGIN
    );
  }

  function emitDurationEntries(entries, url, requestStartedAt) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const unique = [];
    const dedupe = new Set();

    for (const entry of entries) {
      if (!entry || !entry.duration) continue;
      const dedupeKey = [
        entry.messageId || '-',
        entry.mediaId || '-',
        entry.postId || '-',
        entry.duration,
      ].join('|');
      if (dedupe.has(dedupeKey)) continue;
      dedupe.add(dedupeKey);
      unique.push(entry);
      if (unique.length >= 160) break;
    }

    if (unique.length === 0) return;
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: 'durationEntries',
        entries: unique,
        url: url || '',
        requestStartedAt: resolveRequestStartedAt(requestStartedAt),
      },
      TARGET_ORIGIN
    );
  }

  function emitMessageSummaries(summaries, url, requestStartedAt) {
    if (!Array.isArray(summaries) || summaries.length === 0) return;
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: 'messageSummaries',
        summaries: summaries.slice(0, 120),
        url: url || '',
        requestStartedAt: resolveRequestStartedAt(requestStartedAt),
      },
      TARGET_ORIGIN
    );
  }

  async function processFetchResponse(response, url, requestStartedAt) {
    if (!shouldInspectUrl(url)) return;
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.toLowerCase().includes('json');
    if (!isJson) return;

    try {
      const data = await response.clone().json();
      const entries = collectDurationEntries(data, url);
      const messageEntries = entries.filter((entry) => entry && entry.messageId);
      if (messageEntries.length > 0) {
        emitDurationEntries(messageEntries, url, requestStartedAt);
      }

      const summaries = collectMessageSummaries(data, url);
      if (summaries.length > 0) emitMessageSummaries(summaries, url, requestStartedAt);
      debugLog('fetch processed', {
        url,
        entries: messageEntries.length,
        summaries: summaries.length,
        summaryPreview: buildSummaryDebugPreview(summaries),
        summaryTop: buildSummaryDebugLine(summaries),
      });

      const bodyDuration =
        messageEntries.length > 0
          ? chooseBestEntry(messageEntries)
          : null;
      if (bodyDuration && bodyDuration.seconds > 0) {
        emitDuration(bodyDuration.display, url, requestStartedAt);
      }
    } catch (error) {
      debugLog('fetch parse skipped', { url, error: String(error && error.message ? error.message : error) });
    }
  }

  function processXhrBody(xhr, url, requestStartedAt) {
    if (!shouldInspectUrl(url)) return;
    let data = null;
    const responseType = xhr.responseType || '';
    if ((responseType === '' || responseType === 'text') && xhr.responseText) {
      const contentType = xhr.getResponseHeader('content-type') || '';
      if (contentType.toLowerCase().includes('json')) {
        try {
          data = JSON.parse(xhr.responseText);
        } catch (_) {}
      }
    } else if (responseType === 'json' && xhr.response) {
      data = xhr.response;
    }

    if (!data) return;

    const entries = collectDurationEntries(data, url);
    const messageEntries = entries.filter((entry) => entry && entry.messageId);
    if (messageEntries.length > 0) {
      emitDurationEntries(messageEntries, url, requestStartedAt);
    }

    const summaries = collectMessageSummaries(data, url);
    if (summaries.length > 0) emitMessageSummaries(summaries, url, requestStartedAt);
    debugLog('xhr processed', {
      url,
      entries: messageEntries.length,
      summaries: summaries.length,
      summaryPreview: buildSummaryDebugPreview(summaries),
      summaryTop: buildSummaryDebugLine(summaries),
    });

    const bodyDuration =
      messageEntries.length > 0
        ? chooseBestEntry(messageEntries)
        : null;
    if (bodyDuration && bodyDuration.seconds > 0) {
      emitDuration(bodyDuration.display, url, requestStartedAt);
    }
  }

  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    const input = args[0];
    const requestStartedAt = Date.now();
    const url =
      typeof input === 'string'
        ? input
        : input && typeof input.url === 'string'
          ? input.url
          : '';

    return nativeFetch.apply(this, args).then((response) => {
      void processFetchResponse(response, url, requestStartedAt);
      return response;
    });
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._ofUrl = typeof url === 'string' ? url : String(url || '');
    return nativeOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    const xhr = this;
    const url = xhr._ofUrl;
    const requestStartedAt = Date.now();

    xhr.addEventListener(
      'loadend',
      function () {
        if (xhr.readyState !== 4) return;
        processXhrBody(xhr, url, requestStartedAt);
      },
      { once: true }
    );

    return nativeSend.apply(this, arguments);
  };
})();
