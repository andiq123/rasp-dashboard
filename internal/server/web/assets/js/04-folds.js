  function countEnvKeys(text) {
    text = String(text || '').trim();
    if (!text) return 0;
    if (text.charAt(0) === '{') {
      try { return Object.keys(JSON.parse(text) || {}).length; } catch (e) {}
    }
    return text.split(/\r?\n/).filter(function(line){
      line = line.trim();
      if (!line || line.charAt(0) === '#') return false;
      return line.indexOf('=') > 0;
    }).length;
  }
  function envSummary(text) {
    var n = countEnvKeys(text);
    if (!n) return 'Empty';
    return n + ' variable' + (n === 1 ? '' : 's');
  }

  /** Page-level sections can stay open together; service settings accordion one-at-a-time. */
  function foldIsAccordion(key) {
    var scope = String(key || '').split(':')[0];
    if (!scope) return false;
    if (scope === 'manage' || scope === 'group' || scope === 'system' || scope === 'wiz') return false;
    return true;
  }

  function foldHTML(key, title, summary, bodyHtml) {
    var open = !!folds[key];
    return ''
      +'<div class="fold'+(open?' open':'')+'" data-fold-key="'+esc(key)+'">'
        +'<button type="button" class="fold-head" data-action="fold:'+esc(key)+'" aria-expanded="'+(open?'true':'false')+'">'
          +'<span class="fold-chevron" aria-hidden="true"></span>'
          +'<span class="fold-title">'+esc(title)+'</span>'
          +'<span class="fold-summary">'+esc(summary || '')+'</span>'
        +'</button>'
        +'<div class="fold-body"><div class="fold-inner">'+bodyHtml+'</div></div>'
      +'</div>';
  }

  function toggleFold(key) {
    var opening = !folds[key];
    if (foldIsAccordion(key)) {
      var scope = String(key).split(':')[0];
      Object.keys(folds).forEach(function(k){
        if (k.indexOf(scope + ':') === 0) folds[k] = false;
      });
    }
    folds[key] = opening;
  }

  /** Toggle fold open/closed in the DOM — no full remount (keeps animation smooth). */
  function applyFoldsDOM(changedKey) {
    var key = String(changedKey || '');
    var scope = key.split(':')[0];
    if (!scope) return;
    var accordion = foldIsAccordion(key);
    var roots = [
      document.getElementById('modal-root'),
      document.getElementById('app'),
      document.getElementById('drawer-root')
    ];
    roots.forEach(function(root){
      if (!root) return;
      root.querySelectorAll('[data-fold-key]').forEach(function(el){
        var k = el.getAttribute('data-fold-key') || '';
        if (accordion) {
          if (k.indexOf(scope + ':') !== 0) return;
        } else if (k !== key) {
          return;
        }
        var shouldOpen = !!folds[k];
        el.classList.toggle('open', shouldOpen);
        var btn = el.querySelector('.fold-head');
        if (btn) btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      });
    });
  }


  var DB_ENV_KEYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSLMODE', 'DATABASE_URL', 'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'];
  var BUCKET_ENV_KEYS = ['BUCKET', 'ENDPOINT', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'];
  var LEGACY_BUCKET_ENV_KEYS = ['REGION','FORCE_PATH_STYLE','BUCKET_URL','BUCKET_NAME','BUCKET_ENDPOINT','BUCKET_ACCESS_KEY_ID','BUCKET_SECRET_ACCESS_KEY','BUCKET_REGION','BUCKET_FORCE_PATH_STYLE','AWS_ENDPOINT_URL','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_REGION','AWS_S3_FORCE_PATH_STYLE'];

  function clearScopeFolds(scope) {
    if (!scope) return;
    Object.keys(folds).forEach(function(k){
      if (k.indexOf(scope + ':') === 0) delete folds[k];
    });
  }

  function clearServiceListFolds(list) {
    (list || []).forEach(function(s){
      if (s && s.slug) clearScopeFolds(s.slug);
    });
  }

  function parseEnvMapClient(text) {
    var out = {};
    var t = String(text || '').trim();
    if (t.charAt(0) === '{') {
      try {
        var obj = JSON.parse(t);
        Object.keys(obj || {}).forEach(function(k){ out[k] = String(obj[k] == null ? '' : obj[k]); });
        return out;
      } catch (e) {}
    }
    String(text || '').split(/\r?\n/).forEach(function(line){
      line = line.trim();
      if (!line || line.charAt(0) === '#') return;
      var i = line.indexOf('=');
      if (i < 0) return;
      var k = line.slice(0, i).trim();
      var v = line.slice(i + 1);
      if ((v.charAt(0) === '"' && v.charAt(v.length-1) === '"') || (v.charAt(0) === "'" && v.charAt(v.length-1) === "'")) {
        v = v.slice(1, -1);
      }
      if (k) out[k] = v;
    });
    return out;
  }

  function envMapToDotenv(map, keys) {
    keys = keys || Object.keys(map || {}).sort();
    return keys.filter(function(k){ return map[k] != null && String(map[k]) !== ''; })
      .map(function(k){ return k + '=' + String(map[k]); }).join('\n');
  }

  function envMapToJSON(map, keys) {
    keys = keys || Object.keys(map || {}).sort();
    var o = {};
    keys.forEach(function(k){
      if (map[k] == null || String(map[k]) === '') return;
      o[k] = String(map[k]);
    });
    return JSON.stringify(o, null, 2);
  }

  function maskEnvValue(v) {
    v = String(v || '');
    if (!v) return '—';
    return '••••••••';
  }

  function parsePostgresURLClient(raw) {
    raw = String(raw || '').trim();
    if (!raw) return null;
    try {
      var u = new URL(raw);
      var name = (u.pathname || '').replace(/^\//, '').split('/')[0] || '';
      return {
        DB_HOST: u.hostname || '127.0.0.1',
        DB_PORT: u.port || '5432',
        DB_NAME: name,
        DB_USER: decodeURIComponent(u.username || ''),
        DB_PASSWORD: decodeURIComponent(u.password || ''),
        DB_SSLMODE: u.searchParams.get('sslmode') || 'disable',
        DATABASE_URL: raw
      };
    } catch (e) { return null; }
  }

  function dbEnvMapForService(svc, envText) {
    var map = parseEnvMapClient(envText);
    var fromURL = parsePostgresURLClient(svc && svc.connection_url);
    DB_ENV_KEYS.forEach(function(k){
      if (!map[k] && fromURL && fromURL[k]) map[k] = fromURL[k];
    });
    return map;
  }



  function parseBucketURLClient(raw) {
    raw = String(raw || '').trim();
    if (!raw) return null;
    try {
      var u = new URL(raw);
      var name = (u.pathname || '').replace(/^\//, '').split('/')[0] || '';
      var endpoint = u.protocol + '//' + u.host;
      return {
        BUCKET: name,
        ENDPOINT: endpoint,
        ACCESS_KEY_ID: decodeURIComponent(u.username || ''),
        SECRET_ACCESS_KEY: decodeURIComponent(u.password || '')
      };
    } catch (e) {
      return null;
    }
  }

  function bucketEnvMapForService(svc, envText) {
    var map = parseEnvMapClient(envText);
    // Legacy FireWifi names → Railway names
    if (!map.BUCKET && map.BUCKET_NAME) map.BUCKET = map.BUCKET_NAME;
    if (!map.ENDPOINT && (map.BUCKET_ENDPOINT || map.AWS_ENDPOINT_URL)) map.ENDPOINT = map.BUCKET_ENDPOINT || map.AWS_ENDPOINT_URL;
    if (!map.ACCESS_KEY_ID && (map.BUCKET_ACCESS_KEY_ID || map.AWS_ACCESS_KEY_ID)) map.ACCESS_KEY_ID = map.BUCKET_ACCESS_KEY_ID || map.AWS_ACCESS_KEY_ID;
    if (!map.SECRET_ACCESS_KEY && (map.BUCKET_SECRET_ACCESS_KEY || map.AWS_SECRET_ACCESS_KEY)) map.SECRET_ACCESS_KEY = map.BUCKET_SECRET_ACCESS_KEY || map.AWS_SECRET_ACCESS_KEY;
    var fromURL = parseBucketURLClient((svc && (map.BUCKET_URL || svc.connection_url)) || '');
    BUCKET_ENV_KEYS.forEach(function(k){
      if (!map[k] && fromURL && fromURL[k]) map[k] = fromURL[k];
    });
    return map;
  }

  var RESERVED_DB_KEYS = DB_ENV_KEYS.slice();

  function envKeySet(text) {
    return Object.keys(parseEnvMapClient(text));
  }

  function stripReservedDBEnv(text) {
    var map = parseEnvMapClient(text);
    RESERVED_DB_KEYS.forEach(function(k){ delete map[k]; });
    BUCKET_ENV_KEYS.forEach(function(k){ delete map[k]; });
    LEGACY_BUCKET_ENV_KEYS.forEach(function(k){ delete map[k]; });
    // Also strip POSTGRES_* if pasted
    Object.keys(map).forEach(function(k){
      if (/^POSTGRES_/.test(k)) delete map[k];
    });
    var mode = (String(text || '').trim().charAt(0) === '{') ? 'json' : 'text';
    return mode === 'json' ? envMapToJSON(map) : envMapToDotenv(map);
  }

  function findDuplicateEnvKeys(text) {
    var seen = {};
    var dups = [];
    String(text || '').split(/\r?\n/).forEach(function(line, idx){
      line = line.trim();
      if (!line || line.charAt(0) === '#') return;
      var i = line.indexOf('=');
      if (i <= 0) return;
      var k = line.slice(0, i).trim();
      if (!k) return;
      if (seen[k] != null) dups.push({ key: k, line: idx + 1, first: seen[k] });
      else seen[k] = idx + 1;
    });
    // JSON mode: duplicates can't exist in object — skip
    if (String(text || '').trim().charAt(0) === '{') return [];
    return dups;
  }

  function findReservedEnvConflicts(text) {
    // Returns [{key, line}] for KEY=value mode; JSON returns [{key, line:0}].
    var hits = [];
    var raw = String(text || '');
    if (raw.trim().charAt(0) === '{') {
      var map = parseEnvMapClient(raw);
      RESERVED_DB_KEYS.forEach(function(k){
        if (map[k] != null && String(map[k]) !== '') hits.push({ key: k, line: 0 });
      });
      return hits;
    }
    raw.split(/\r?\n/).forEach(function(line, idx){
      line = line.trim();
      if (!line || line.charAt(0) === '#') return;
      var i = line.indexOf('=');
      if (i <= 0) return;
      var k = line.slice(0, i).trim();
      if (RESERVED_DB_KEYS.indexOf(k) >= 0) hits.push({ key: k, line: idx + 1 });
    });
    return hits;
  }

  function reservedConflictKeys(hits) {
    return (hits || []).map(function(h){ return h.key; });
  }

  function formatEnvConflictWarn(hits, dups, link) {
    if (hits && hits.length) {
      var parts = hits.slice(0, 3).map(function(h){
        return h.line ? (h.key + ' · line ' + h.line) : h.key;
      });
      var more = hits.length > 3 ? ' +' + (hits.length - 3) : '';
      return 'Already linked' + (link ? ' from ' + link : '') + ' · ' + parts.join(', ') + more;
    }
    if (dups && dups.length) {
      return 'Duplicate ' + dups[0].key + ' · lines ' + dups[0].first + ' & ' + dups[0].line;
    }
    return '';
  }

  function syncWizEnvConflictUI(text, link) {
    var ta = document.getElementById('wiz-env');
    var warnEl = document.getElementById('wiz-env-warn');
    if (!ta) return;
    var hits = link ? findReservedEnvConflicts(text) : [];
    var dups = findDuplicateEnvKeys(text);
    var msg = formatEnvConflictWarn(hits, dups, link);
    if (warnEl) {
      warnEl.textContent = msg;
      warnEl.hidden = !msg;
    }
    ta.classList.toggle('has-warn', !!msg);
    var keys = reservedConflictKeys(hits);
    document.querySelectorAll('.wiz-auto-row[data-env-key]').forEach(function(row){
      var k = row.getAttribute('data-env-key');
      row.classList.toggle('is-conflict', keys.indexOf(k) >= 0);
    });
  }


  function isSecretEnvKey(k) {
    k = String(k || '');
    return k === 'DB_PASSWORD' || k === 'DATABASE_URL' || k === 'BUCKET_URL' || k === 'SECRET_ACCESS_KEY' || k === 'BUCKET_SECRET_ACCESS_KEY' || k === 'AWS_SECRET_ACCESS_KEY' || /PASSWORD|SECRET|TOKEN|KEY$/i.test(k);
  }

  /** Split user env text into custom-only (no reserved DB keys). */
  function splitCustomEnv(text) {
    var map = parseEnvMapClient(text);
    var custom = {};
    Object.keys(map).forEach(function(k){
      if (RESERVED_DB_KEYS.indexOf(k) >= 0) return;
      if (BUCKET_ENV_KEYS.indexOf(k) >= 0) return;
      if (LEGACY_BUCKET_ENV_KEYS.indexOf(k) >= 0) return;
      if (/^POSTGRES_/.test(k)) return;
      custom[k] = map[k];
    });
    var mode = (String(text || '').trim().charAt(0) === '{') ? 'json' : 'text';
    return mode === 'json' ? envMapToJSON(custom) : envMapToDotenv(custom);
  }

  function linkedEnvMapFromSources(dbMap, envText) {
    var fromSrc = pickConcreteEnvKeys(dbMap || {}, RESERVED_DB_KEYS);
    if (RESERVED_DB_KEYS.some(function(k){ return fromSrc[k]; })) return fromSrc;
    return pickConcreteEnvKeys(parseEnvMapClient(envText || ''), RESERVED_DB_KEYS);
  }

  function mergeLinkedPreviewEnv(customText, linkedMap, keyList) {
    var keys = keyList || RESERVED_DB_KEYS;
    var custom = parseEnvMapClient(customText || '');
    keys.forEach(function(k){ delete custom[k]; });
    var linked = linkedMap || {};
    var merged = {};
    keys.forEach(function(k){
      if (linked[k] != null && String(linked[k]) !== '') merged[k] = String(linked[k]);
    });
    Object.keys(custom).forEach(function(k){ merged[k] = custom[k]; });
    return envMapToDotenv(merged);
  }

  function isEnvRefValue(v) {
    return /\$\{\{/.test(String(v == null ? '' : v));
  }

  /** Pick non-empty keys from a map; drop unresolved ${{refs}}. */
  function pickConcreteEnvKeys(src, keys) {
    var out = {};
    src = src || {};
    (keys || []).forEach(function(k){
      var v = src[k];
      if (v == null || String(v) === '' || isEnvRefValue(v)) return;
      out[k] = String(v);
    });
    return out;
  }

  /**
   * Shared link board: show concrete values copied (or about to copy) from a
   * group-scoped source service. Never display ${{slug.KEY}} as the value.
   */
  function linkBoardMap(keys, appEnvText, sourceEnv) {
    keys = keys || [];
    var fromApp = pickConcreteEnvKeys(parseEnvMapClient(appEnvText || ''), keys);
    if (keys.some(function(k){ return fromApp[k]; })) {
      return { map: fromApp, ready: true, preview: false };
    }
    var fromSrc = pickConcreteEnvKeys(sourceEnv || {}, keys);
    if (!keys.some(function(k){ return fromSrc[k]; })) {
      return { map: {}, ready: false, preview: false };
    }
    return { map: fromSrc, ready: true, preview: true };
  }

  function bucketLinkBoardMap(_bucketSlug, appEnvText, draftBucketEnv) {
    var src = draftBucketEnv || {};
    // Normalize legacy / alias shapes into the four app keys.
    if (!BUCKET_ENV_KEYS.some(function(k){ return src[k]; })) {
      src = bucketEnvMapForService(null, typeof src === 'string' ? src : '');
    }
    return linkBoardMap(BUCKET_ENV_KEYS, appEnvText, src);
  }

  function linkedBucketMapFromEnv(envText) {
    return pickConcreteEnvKeys(bucketEnvMapForService(null, envText || ''), BUCKET_ENV_KEYS);
  }

  /** Unified “From <service>” board for DB and bucket links. */
  function wizAutoLinkEnvHTML(link, envMap, keys, opts) {
    if (!link) return '';
    opts = opts || {};
    envMap = envMap || {};
    keys = keys || [];
    var conflictKeys = opts.conflictKeys || [];
    var ready = keys.some(function(k){ return envMap[k]; });
    if (!ready) {
      return '<div class="wiz-auto-env wiz-auto-pending"><div class="wiz-auto-head"><span>From '+esc(link)+'</span><span class="ghost">loading…</span></div><div class="ghost" style="font-size:11px">'+(opts.pendingHint || 'Fetching linked env…')+'</div></div>';
    }
    var reveal = !!opts.reveal;
    var showBtn = opts.showToggle !== false;
    var action = opts.revealAction || 'wizenvreveal';
    var rows = keys.map(function(k){
      var val = envMap[k];
      var empty = (val == null || val === '');
      var secret = isSecretEnvKey(k);
      var shown = empty ? '—' : ((secret && !reveal) ? maskEnvValue(val) : String(val));
      var clash = conflictKeys.indexOf(k) >= 0;
      return ''
        +'<div class="wiz-auto-row'+(clash?' is-conflict':'')+(empty?' is-empty':'')+'" data-env-key="'+esc(k)+'">'
          +'<span class="wiz-auto-key">'+esc(k)+'</span>'
          +'<span class="wiz-auto-val'+(secret && !reveal && !empty?' masked':'')+'" title="'+(reveal && !empty ? esc(String(val)) : '')+'">'+esc(shown)+'</span>'
        +'</div>';
    }).join('');
    var status = opts.preview
      ? 'Preview · save to copy'
      : ('Copied from '+link+(opts.group ? ' · group '+opts.group : ''));
    var tools = ''
      +'<span class="ghost" style="font-size:11px;margin-right:6px">'+esc(status)+'</span>'
      +(showBtn
        ? '<button type="button" class="btn btn-quiet btn-compact" data-action="'+esc(action)+'">'+(reveal?'Hide':'Show')+'</button>'
        : '');
    return ''
      +'<div class="wiz-auto-env'+(opts.preview?' is-preview':'')+'">'
        +'<div class="wiz-auto-head">'
          +'<span>From '+esc(link)+'</span>'
          +'<div class="wiz-auto-tools" data-stop="1">'+tools+'</div>'
        +'</div>'
        +'<div class="wiz-auto-list">'+rows+'</div>'
      +'</div>';
  }

  function wizAutoBucketEnvHTML(link, bucketMap, opts) {
    opts = opts || {};
    opts.pendingHint = opts.pendingHint || 'Fetching bucket credentials…';
    return wizAutoLinkEnvHTML(link, bucketMap, BUCKET_ENV_KEYS, opts);
  }

  function wizAutoDBEnvHTML(link, dbMap, conflictKeys, opts) {
    opts = opts || {};
    opts.conflictKeys = conflictKeys || [];
    opts.pendingHint = opts.pendingHint || 'Fetching database env…';
    return wizAutoLinkEnvHTML(link, dbMap, RESERVED_DB_KEYS, opts);
  }


  function upsertEnvClient(text, key, value) {
    var map = parseEnvMapClient(text || '');
    map[key] = String(value);
    var mode = (String(text || '').trim().charAt(0) === '{') ? 'json' : 'text';
    return mode === 'json' ? envMapToJSON(map) : envMapToDotenv(map);
  }
