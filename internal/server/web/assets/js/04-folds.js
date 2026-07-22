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


  var DB_ENV_KEYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSLMODE', 'DATABASE_URL'];
  var BUCKET_ENV_KEYS = ['BUCKET_URL'];
  var LEGACY_BUCKET_ENV_KEYS = ['BUCKET','BUCKET_NAME','BUCKET_ENDPOINT','BUCKET_ACCESS_KEY_ID','BUCKET_SECRET_ACCESS_KEY','BUCKET_REGION','BUCKET_FORCE_PATH_STYLE','AWS_ENDPOINT_URL','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_REGION','AWS_S3_FORCE_PATH_STYLE'];

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
    return k === 'DB_PASSWORD' || k === 'DATABASE_URL' || k === 'BUCKET_URL' || k === 'BUCKET_SECRET_ACCESS_KEY' || k === 'AWS_SECRET_ACCESS_KEY' || /PASSWORD|SECRET|TOKEN|KEY$/i.test(k);
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
    var out = {};
    var fromEnv = parseEnvMapClient(envText || '');
    RESERVED_DB_KEYS.forEach(function(k){
      if (dbMap && dbMap[k] != null && String(dbMap[k]) !== '') out[k] = String(dbMap[k]);
      else if (fromEnv[k] != null && String(fromEnv[k]) !== '') out[k] = String(fromEnv[k]);
    });
    return out;
  }

  function mergeLinkedPreviewEnv(customText, dbMap) {
    var custom = parseEnvMapClient(customText || '');
    RESERVED_DB_KEYS.forEach(function(k){ delete custom[k]; });
    var linked = dbMap || {};
    var merged = {};
    RESERVED_DB_KEYS.forEach(function(k){
      if (linked[k] != null && String(linked[k]) !== '') merged[k] = String(linked[k]);
    });
    Object.keys(custom).forEach(function(k){ merged[k] = custom[k]; });
    return envMapToDotenv(merged);
  }


  function wizAutoBucketEnvHTML(link, bucketMap, opts) {
    if (!link) return '';
    opts = opts || {};
    bucketMap = bucketMap || {};
    var keys = BUCKET_ENV_KEYS.filter(function(k){ return bucketMap[k]; });
    if (!keys.length) {
      return '<div class="wiz-auto-env wiz-auto-pending"><div class="wiz-auto-head"><span>From '+esc(link)+'</span><span class="ghost">linking…</span></div><div class="ghost" style="font-size:11px">BUCKET_URL appears after save/deploy</div></div>';
    }
    var reveal = !!opts.reveal;
    var rows = keys.map(function(k){
      var val = String(bucketMap[k] || '');
      var secret = (k === 'BUCKET_URL') || /SECRET|PASSWORD|TOKEN/i.test(k) || /_KEY$/i.test(k);
      var shown = (secret && !reveal) ? '••••••••' : val;
      return '<div class="wiz-auto-row"><code>'+esc(k)+'</code><span class="mono">'+esc(shown)+'</span></div>';
    }).join('');
    return ''
      +'<div class="wiz-auto-env">'
        +'<div class="wiz-auto-head"><span>From '+esc(link)+'</span>'
          +(opts.revealAction ? '<button type="button" class="btn btn-quiet btn-compact" data-action="'+esc(opts.revealAction)+'">'+(reveal?'Hide':'Reveal')+'</button>' : '')
        +'</div>'
        +rows
      +'</div>';
  }

  function linkedBucketMapFromEnv(envText) {
    var mp = parseEnvMapClient(envText || '');
    var out = {};
    BUCKET_ENV_KEYS.forEach(function(k){ if (mp[k]) out[k] = mp[k]; });
    return out;
  }

  function wizAutoDBEnvHTML(link, dbMap, conflictKeys, opts) {
    if (!link) return '';
    opts = opts || {};
    dbMap = dbMap || {};
    conflictKeys = conflictKeys || [];
    var reveal = !!opts.reveal;
    var showBtn = opts.showToggle !== false;
    var action = opts.revealAction || 'wizenvreveal';
    var rows = RESERVED_DB_KEYS.map(function(k){
      var val = dbMap[k];
      var empty = (val == null || val === '');
      var secret = isSecretEnvKey(k);
      var shown;
      if (empty) shown = '—';
      else if (secret && !reveal) shown = maskEnvValue(val);
      else shown = String(val);
      var clash = conflictKeys.indexOf(k) >= 0;
      return ''
        +'<div class="wiz-auto-row'+(clash?' is-conflict':'')+(empty?' is-empty':'')+'" data-env-key="'+esc(k)+'">'
          +'<span class="wiz-auto-key">'+esc(k)+'</span>'
          +'<span class="wiz-auto-val'+(secret && !reveal && !empty?' masked':'')+'" title="'+(reveal && !empty ? esc(String(val)) : '')+'">'+esc(shown)+'</span>'
        +'</div>';
    }).join('');
    var tools = showBtn
      ? ('<button type="button" class="btn btn-quiet btn-compact" data-action="'+esc(action)+'">'+(reveal?'Hide':'Show')+'</button>')
      : '<span class="ghost">linked</span>';
    return ''
      +'<div class="wiz-auto-env">'
        +'<div class="wiz-auto-head">'
          +'<span>From '+esc(link)+'</span>'
          +'<div class="wiz-auto-tools" data-stop="1">'+tools+'</div>'
        +'</div>'
        +'<div class="wiz-auto-list">'+rows+'</div>'
      +'</div>';
  }


  function upsertEnvClient(text, key, value) {
    var map = parseEnvMapClient(text || '');
    map[key] = String(value);
    var mode = (String(text || '').trim().charAt(0) === '{') ? 'json' : 'text';
    return mode === 'json' ? envMapToJSON(map) : envMapToDotenv(map);
  }
