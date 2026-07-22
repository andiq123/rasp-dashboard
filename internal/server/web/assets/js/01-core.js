  var state = JSON.parse(document.getElementById('initial-state').textContent);
  var config = null;
  var busy = {};
  var formDirty = false;
  var hotspotSettingsOpen = false;
  var github = null;
  var groups = [];
  var activeGroup = null;
  var deployed = [];
  var repos = [];
  var wizard = null;
  var settingsSlug = null;
  var settingsDraft = {};
  var groupDraft = {};
  var envMode = {};
  var envReveal = {};
  var wizEnvReveal = false;
  var sqlDraft = {};
  var sqlResult = {};
  var sqlAbort = {};
  var picker = null;
  var folds = {};
  var manageTab = 'services';
  var navView = 'overview';
  var settingsTab = 'github';
  var manageOv = null;
  var manageLoading = false;
  var manageError = null;
  var engineView = null;
  var engineDraft = null;
  var dockerOpen = false; // legacy: true when storage/network tab
  var dockerInv = null;
  var dockerLoading = false;
  var dockerOpts = { images: true, all_unused: true, containers: true, volumes: false, build_cache: true };
  var navLoading = false;
  var servicesError = null;
  var groupsError = null;
  var _drawerPrevFocus = null;
  var eventSource = null;
  var pollTimer = null;
  var statsPollTimer = null;
  var lastStateAt = 0;
  var toastTimer = null;

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: {'Content-Type':'application/json'}, body: opts.body };
    if (opts.signal) init.signal = opts.signal;
    return fetch(path, init)
      .then(function(r) {
        if (!r.ok) return r.text().then(function(t){ throw new Error((t || r.statusText).trim()); });
        return r.json().catch(function(){ return {}; });
      });
  }

  function sqlBusyKey(slug) { return 'sql:' + slug; }

  function sqlResultKey(slug) {
    var r = sqlResult[slug];
    if (!r) return '0';
    if (r.error || r.cancelled) return 'e:' + String(r.error || 'cancelled').slice(0, 40);
    return 'ok:' + (r.row_count || 0) + ':' + (r.duration_ms || 0) + ':' + (r.message || '').slice(0, 24);
  }

  function patchSqlChrome(slug) {
    var root = document.getElementById('sql-box-' + slug);
    if (!root) return false;
    var busyQ = !!busy[sqlBusyKey(slug)];
    var run = root.querySelector('[data-action="sql:run:' + slug + '"]');
    var cancel = root.querySelector('[data-action="sql:cancel:' + slug + '"]');
    if (run) {
      run.classList.toggle('loading', busyQ);
      run.disabled = busyQ || run.getAttribute('data-engine-down') === '1';
      run.hidden = !!busyQ;
    }
    if (cancel) {
      cancel.hidden = !busyQ;
      cancel.disabled = false;
    }
    root.classList.toggle('is-running', busyQ);
    var out = document.getElementById('sql-out-' + slug);
    if (out && typeof sqlOutHTML === 'function') {
      out.innerHTML = sqlOutHTML(sqlResult[slug]);
    }
    return true;
  }
  function esc(s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }
  function routeLabel(mode) {
    return mode === 'residential' ? 'Hotspot → residential proxy' : 'Hotspot → Mullvad WireGuard';
  }
  function health(s) {
    if (!s.hotspot_running) return {text:'Stopped', cls:'off'};
    if (s.mode === 'residential') return s.proxy_running ? {text:'Online', cls:''} : {text:'Check proxy', cls:'warn'};
    return s.wg_up ? {text:'Online', cls:''} : {text:'Check VPN', cls:'warn'};
  }
  function fmtPct(n) { return Math.round(Number(n || 0)) + '%'; }
  function fmtBytes(n) {
    n = Number(n || 0);
    if (n < 1024) return Math.round(n) + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(1) + ' GB';
  }
  function fmtRate(n) { return fmtBytes(n) + '/s'; }
  function clamp(n) { n = Number(n || 0); return Math.max(0, Math.min(100, n)); }

  function ico(name, cls) {
    var c = 'ico' + (cls ? (' ' + cls) : '');
    var common = ' class="'+c+'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    var paths = {
      db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
      app: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6M9 13h6M9 17h4"/>',
      play: '<polygon points="8,5 19,12 8,19" fill="currentColor" stroke="none"/>',
      stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
      refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.2"/><polyline points="21,3 21,9 15,9"/>',
      logs: '<path d="M8 6h12M8 12h12M8 18h8"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/>',
      open: '<path d="M14 4h6v6"/><path d="M10 14L20 4"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/>',
      copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
      globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
      chev: '<path d="M9 6l6 6-6 6"/>',
      back: '<path d="M15 6l-6 6 6 6"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/>',
      link: '<path d="M10 13a5 5 0 0 0 7.1 0l2.1-2.1a5 5 0 0 0-7.1-7.1L10.9 5"/><path d="M14 11a5 5 0 0 0-7.1 0L4.8 13.1a5 5 0 0 0 7.1 7.1L13.1 19"/>',
      close: '<path d="M18 6L6 18M6 6l12 12"/>',
      github: '<path d="M9 19c-4.3 1.4-4.3-2.1-6-2.1"/><path d="M15 22v-3.9a3.4 3.4 0 0 0-1-2.4c3.2-.4 6.6-1.6 6.6-7.1A5.4 5.4 0 0 0 19.5 5a5 5 0 0 0-.1-3.7S18.2 1 15.8 2.7a9.4 9.4 0 0 0-6.6 0C6.8 1 5.6 1.3 5.6 1.3A5 5 0 0 0 5.5 5 5.4 5.4 0 0 0 4 9.6c0 5.5 3.4 6.7 6.6 7.1a3.4 3.4 0 0 0-1 2.4V22"/>',
      docker: '<path d="M4 15h2v2H4zM7 15h2v2H7zM10 15h2v2h-2zM13 15h2v2h-2zM7 12h2v2H7zM10 12h2v2h-2zM13 12h2v2h-2zM10 9h2v2h-2z"/><path d="M3 18h13.5a4.5 4.5 0 0 0 1.2-8.8 5.5 5.5 0 0 0-10.3-1.6A4 4 0 0 0 3 14.5"/>',
      cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3"/>',
      memory: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 7v10M12 7v10M17 7v10"/>',
      thermal: '<path d="M12 3a3 3 0 0 1 3 3v7.1a4 4 0 1 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M12 14v3"/>',
      disk: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
      download: '<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
      upload: '<path d="M12 20V8"/><path d="M7 13l5-5 5 5"/><path d="M5 4h14"/>',
      shield: '<path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z"/>',
      settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.86 1.01 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
      storage: '<path d="M4 7h16v4H4zM4 13h16v4H4z"/><circle cx="8" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="15" r="1" fill="currentColor" stroke="none"/>',
      spark: '<path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/>'
    };
    return '<svg'+common+'>'+(paths[name] || '')+'</svg>';
  }

  function metric(label, value, detail, percent, cls, icon) {
    var p = clamp(percent).toFixed(0) + '%';
    var key = cls || String(label || '').toLowerCase();
    var ic = icon ? ('<span class="metric-ico" aria-hidden="true">'+ico(icon)+'</span>') : '';
    return '<div class="metric'+(icon?' has-ico':'')+'" data-metric="'+esc(key)+'">'+ic+'<div class="metric-body"><div class="k">'+esc(label)+'</div><div class="v">'+esc(value)+'</div><div class="d">'+esc(detail)+'</div><div class="bar '+esc(cls||'')+'" style="--p:'+esc(p)+'"><span style="width:'+esc(p)+'"></span></div></div></div>';
  }
  function btn(label, id, cls, disabled, icon) {
    var ic = icon ? ico(icon) : '';
    return '<button type="button" class="btn '+(cls||'')+(busy[id]?' loading':'')+(icon?' has-ico':'')+'" data-action="'+esc(id)+'" '+(disabled || busy[id] ? 'disabled' : '')+'><span class="spinner"></span>'+ic+'<span>'+esc(label)+'</span></button>';
  }
  function field(label, name, value, type) {
    return '<label>'+esc(label)+'<input type="'+esc(type||'text')+'" name="'+esc(name)+'" value="'+esc(value)+'" autocomplete="off"></label>';
  }
  function publicHost() {
    try {
      var h = (location && location.hostname) || '';
      if (h && h !== 'localhost' && h !== '127.0.0.1') return h;
    } catch (e) {}
    return 'rasp.local';
  }
  function rewriteHost(url) {
    url = String(url || '');
    if (!url) return '';
    return url.replace(/^(https?:\/\/)(rasp\.local|localhost|127\.0\.0\.1)(:|\/|$)/i, '$1' + publicHost() + '$3');
  }
  function copyText(text) {
    text = String(text || '');
    if (!text) return Promise.reject(new Error('Nothing to copy'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function(){ return copyFallback(text); });
    }
    return copyFallback(text);
  }
  function copyFallback(text) {
    return new Promise(function(resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        if (!document.execCommand('copy')) throw new Error('copy failed');
        resolve();
      } catch (e) { reject(e); }
      finally { document.body.removeChild(ta); }
    });
  }
  function showToast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2200);
  }
  function setLive(ok) {
    document.getElementById('live-dot').className = ok ? 'pulse' : 'pulse off';
    document.getElementById('live-text').textContent = ok
      ? 'Live ' + new Date(lastStateAt || Date.now()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})
      : 'Reconnecting';
  }
