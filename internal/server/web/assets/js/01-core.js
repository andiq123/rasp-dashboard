  var state = JSON.parse(document.getElementById('initial-state').textContent);
  var config = null;
  var busy = {};
  var formDirty = false;
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
  function metric(label, value, detail, percent, cls) {
    var p = clamp(percent).toFixed(0) + '%';
    return '<div class="metric"><div class="k">'+esc(label)+'</div><div class="v">'+esc(value)+'</div><div class="d">'+esc(detail)+'</div><div class="bar '+esc(cls||'')+'" style="--p:'+esc(p)+'"><span></span></div></div>';
  }
  function btn(label, id, cls, disabled) {
    return '<button type="button" class="btn '+(cls||'')+(busy[id]?' loading':'')+'" data-action="'+esc(id)+'" '+(disabled || busy[id] ? 'disabled' : '')+'><span class="spinner"></span><span>'+esc(label)+'</span></button>';
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
