(function () {

  /* === 01-core.js === */
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

  /* === 02-live-panels.js === */
  function monitoring(s) {
    var d = s.device_metrics || {};
    var cpu = d.cpu || {}, mem = d.memory || {}, thermal = d.thermal || {}, storage = d.storage || {}, net = d.network || {};
    var temp = Number(thermal.temperature_celsius || 0);
    return ''
      +'<section class="panel panel-live" id="panel-monitoring">'
          +'<div class="head"><h2>System</h2><span class="hint">Live</span></div>'
          +'<div class="metrics metrics-dense">'
            +metric('CPU', fmtPct(cpu.busy_percent), 'Idle ' + fmtPct(cpu.idle_percent), cpu.busy_percent, 'cpu')
            +metric('Memory', fmtPct(mem.used_percent), fmtBytes(mem.used_bytes), mem.used_percent, 'memory')
            +metric('Thermal', thermal.available ? temp.toFixed(0) + '°' : 'n/a', thermal.throttle_known ? (thermal.throttled ? 'Throttled' : 'OK') : 'Sensor', temp / 85 * 100, 'thermal')
            +metric('Disk', fmtPct(storage.used_percent), fmtBytes(storage.used_bytes), storage.used_percent, 'storage')
          +'</div>'
          +'<div class="net net-dense">'
            +'<div><span>↓ Down</span><strong>'+esc(fmtRate(net.down_bytes_per_sec))+'</strong></div>'
            +'<div><span>↑ Up</span><strong>'+esc(fmtRate(net.up_bytes_per_sec))+'</strong></div>'
          +'</div>'
        +'</section>';
  }
  function vpn(s, c) {
    var mode = s.mode || 'mullvad';
    var h = health(s);
    var dhcp = (s.dhcp_start && s.dhcp_end) ? s.dhcp_start + ' – ' + s.dhcp_end : 'Not set';
    return ''
      +'<section class="panel panel-live" id="panel-vpn">'
          +'<div class="vpn-top">'
            +'<div class="vpn-title">'
              +'<div class="big">'+esc(mode === 'residential' ? 'Residential' : 'Mullvad')+'</div>'
              +'<div class="route">'+esc(routeLabel(mode))+'</div>'
            +'</div>'
            +'<div class="pill '+esc(h.cls)+'"><span class="pulse '+(h.cls === 'off' ? 'off' : '')+'"></span>'+esc(h.text)+'</div>'
          +'</div>'
          +'<div class="seg">'
            +'<button type="button" data-action="mode:mullvad" class="'+(mode === 'mullvad' ? 'active' : '')+'" '+(busy['mode:mullvad'] || busy['mode:residential'] ? 'disabled' : '')+'>Mullvad</button>'
            +'<button type="button" data-action="mode:residential" class="'+(mode === 'residential' ? 'active' : '')+'" '+(busy['mode:mullvad'] || busy['mode:residential'] ? 'disabled' : '')+'>Residential</button>'
          +'</div>'
          +'<div class="actions">'
            +btn('Start', 'hotspot:start', 'primary', s.hotspot_running)
            +btn('Stop', 'hotspot:stop', '', !s.hotspot_running)
            +btn('Restart', 'hotspot:restart', '', false)
          +'</div>'
          +'<div class="rows">'
            +'<div class="row"><span>SSID</span><strong>'+esc(s.ssid || '—')+'</strong></div>'
            +'<div class="row"><span>Gateway</span><strong>'+esc(s.hotspot_ip || '—')+'</strong></div>'
            +'<div class="row"><span>DHCP</span><strong>'+esc(dhcp)+'</strong></div>'
          +'</div>'
          +'<details class="settings">'
            +'<summary>Edit hotspot settings</summary>'
            +'<form id="config-form">'
              +'<div class="fields">'
                +field('SSID', 'ssid', c.ssid || s.ssid || '')
                +field('Password', 'password', c.password || '')
                +field('Gateway IP', 'hotspot_ip', c.hotspot_ip || s.hotspot_ip || '')
                +field('DHCP start', 'dhcp_start', c.dhcp_start || s.dhcp_start || '')
                +field('DHCP end', 'dhcp_end', c.dhcp_end || s.dhcp_end || '')
              +'</div>'
              +'<div class="form-actions"><button type="submit" class="btn primary '+(busy.config?'loading':'')+'" '+(busy.config?'disabled':'')+'><span class="spinner"></span><span>Save</span></button></div>'
            +'</form>'
          +'</details>'
        +'</section>';
  }


  /* === 02b-ui.js === */
  /** Shared compact UI primitives for wizard + settings. */

  function uiHint(text, allowHtml) {
    text = String(text || '').trim();
    if (!text) return '';
    return '<p class="ui-hint">'+(allowHtml ? text : esc(text))+'</p>';
  }

  function uiEmpty(opts) {
    opts = opts || {};
    var title = opts.title != null ? String(opts.title) : '';
    var body = opts.body != null ? String(opts.body) : '';
    if (!title && !body) return '';
    if (!title) return '<div class="ui-empty ui-empty-mini">'+body+'</div>';
    return ''
      +'<div class="ui-empty'+(opts.mini ? ' ui-empty-mini' : '')+'">'
        +(title ? '<strong>'+esc(title)+'</strong>' : '')
        +(body ? '<p>'+body+'</p>' : '')
      +'</div>';
  }

  /**
   * Compact labeled control.
   * uiField({label, meta, control, tip, tipHtml})
   * or legacy: uiField(label, meta, controlHtml, tip)
   */
  function uiField(a, b, c, d) {
    var label, meta, control, tip, tipHtml;
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      label = a.label || '';
      meta = a.meta || '';
      control = a.control || '';
      tip = a.tip || '';
      tipHtml = a.tipHtml || '';
    } else {
      label = a || '';
      meta = b || '';
      control = c || '';
      tip = d || '';
      tipHtml = '';
    }
    return ''
      +'<div class="ui-field wiz-field">'
        +'<div class="label-row">'
          +'<strong>'+esc(label)+'</strong>'
          +(meta ? '<span>'+esc(meta)+'</span>' : '')
        +'</div>'
        +control
        +(tipHtml ? uiHint(tipHtml, true) : (tip ? uiHint(tip, false) : ''))
      +'</div>';
  }

  /** Alias kept for call sites still using wizField(label, hint, control, tip). */
  function wizField(label, hint, controlHtml, tip) {
    return uiField({ label: label, meta: hint, control: controlHtml, tip: tip || '' });
  }

  function uiHead(opts) {
    opts = opts || {};
    var title = opts.title || '';
    var sub = '';
    if (opts.subHtml) sub = String(opts.subHtml);
    else if (opts.sub) sub = esc(opts.sub);
    var actions = opts.actions || '';
    return ''
      +'<div class="ui-head wiz-head">'
        +'<div>'
          +'<h3>'+esc(title)+'</h3>'
          +(sub ? '<p>'+sub+'</p>' : '')
        +'</div>'
        +(actions || '')
      +'</div>';
  }

  function uiActions(html) {
    if (!html) return '';
    return '<div class="ui-actions wizard-actions">'+html+'</div>';
  }

  function uiFooter(opts) {
    opts = opts || {};
    var left = opts.left || '';
    var right = opts.right || '';
    var hint = opts.hint || '';
    return ''
      +'<div class="ui-footer settings-footer">'
        +'<div class="footer-left" data-stop="1">'+left+'</div>'
        +'<div class="footer-right" data-stop="1">'+right+'</div>'
      +'</div>'
      +(hint ? '<p class="ui-hint footer-hint" data-stop="1">'+hint+'</p>' : '');
  }

  function uiInput(opts) {
    opts = opts || {};
    var name = opts.name || '';
    var id = opts.id || '';
    var value = opts.value != null ? opts.value : '';
    var placeholder = opts.placeholder || '';
    var type = opts.type || 'text';
    var attrs = '';
    if (id) attrs += ' id="'+esc(id)+'"';
    if (name) attrs += ' name="'+esc(name)+'"';
    if (placeholder) attrs += ' placeholder="'+esc(placeholder)+'"';
    if (opts.autofocus) attrs += ' autofocus';
    if (opts.spellcheck === false) attrs += ' spellcheck="false"';
    if (opts.className) attrs += ' class="'+esc(opts.className)+'"';
    attrs += ' autocomplete="'+(opts.autocomplete != null ? esc(opts.autocomplete) : 'off')+'"';
    return '<input type="'+esc(type)+'" value="'+esc(value)+'"'+attrs+'>';
  }

  /**
   * Slugify for previews — mirrors backend deploy.slugify (client-side).
   */
  function slugifyClient(s) {
    s = String(s || '').toLowerCase().trim();
    s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (s && /^[0-9]/.test(s)) s = 'app-' + s;
    return s.slice(0, 48);
  }

  /** Group prefix stamped onto physical Postgres names: find-vibe → find_vibe_ */
  function pgIdentPrefix(group) {
    group = String(group || '').trim();
    if (!group) return '';
    return group.replace(/-/g, '_') + '_';
  }

  /**
   * Physical DB name FireWifi creates: group_slug with dashes → underscores.
   * Keep in sync with Manager.createPostgres (group+"_"+slug, then - → _).
   */
  function pgPhysicalName(group, name) {
    var slug = slugifyClient(name);
    if (!group || !slug) return '';
    var raw = String(group) + '_' + slug;
    raw = raw.replace(/-/g, '_');
    if (raw.length > 60) raw = raw.slice(0, 60);
    return raw;
  }

  function containerNamePreview(group, nameOrRepo) {
    var slug = slugifyClient(nameOrRepo);
    if (!group || !slug) return '';
    return 'fw-' + group + '-' + slug;
  }

  /**
   * Input with a non-editable ghost prefix (shows what the backend will prepend).
   * opts: { prefix, previewHtml, compose, id, name, value, placeholder, autofocus }
   * compose: 'pg' enables live DB/role preview updates via onUiInput.
   */
  function uiPrefixedInput(opts) {
    opts = opts || {};
    var prefix = String(opts.prefix || '');
    var id = opts.id || '';
    var name = opts.name || '';
    var value = opts.value != null ? opts.value : '';
    var placeholder = opts.placeholder || '';
    var compose = opts.compose || '';
    var attrs = '';
    if (id) attrs += ' id="'+esc(id)+'"';
    if (name) attrs += ' name="'+esc(name)+'"';
    if (placeholder) attrs += ' placeholder="'+esc(placeholder)+'"';
    if (opts.autofocus) attrs += ' autofocus';
    if (opts.spellcheck === false) attrs += ' spellcheck="false"';
    attrs += ' autocomplete="'+(opts.autocomplete != null ? esc(opts.autocomplete) : 'off')+'"';
    if (compose) attrs += ' data-name-compose="'+esc(compose)+'"';
    var preview = opts.previewHtml || '';
    return ''
      +'<div class="ui-input-affix" data-name-compose-root="'+(compose ? esc(compose) : '')+'">'
        +(prefix
          ? '<span class="affix-ghost" title="Added automatically — do not type this">'+esc(prefix)+'</span>'
          : '')
        +'<input type="text" value="'+esc(value)+'"'+attrs+'>'
      +'</div>'
      +(compose ? '<p class="ui-name-preview">'+(preview || '')+'</p>' : (preview ? '<p class="ui-name-preview">'+preview+'</p>' : ''));
  }

  function uiPgNamePreview(group, name) {
    var db = pgPhysicalName(group, name);
    if (!db) {
      return '';
    }
    return 'Creates <code>'+esc(db)+'</code> · role <code>'+esc(db)+'_user</code>';
  }

  function syncNameComposePreview(input) {
    if (!input || !input.getAttribute) return;
    var kind = input.getAttribute('data-name-compose');
    if (!kind) return;
    var root = input.closest('[data-name-compose-root]');
    if (!root) return;
    var preview = root.parentNode && root.parentNode.querySelector
      ? root.parentNode.querySelector('.ui-name-preview')
      : null;
    // preview sits as sibling after affix inside ui-field
    if (!preview && root.nextElementSibling && root.nextElementSibling.classList.contains('ui-name-preview')) {
      preview = root.nextElementSibling;
    }
    if (!preview) {
      var field = input.closest('.ui-field');
      preview = field ? field.querySelector('.ui-name-preview') : null;
    }
    if (!preview) return;
    if (kind === 'pg') {
      preview.innerHTML = uiPgNamePreview(activeGroup, input.value);
    }
  }

  function fmtCPUPercent(p) {
    p = Number(p);
    if (!isFinite(p) || p < 0) return '0%';
    // Keep sub-1% live so idle Go services do not look frozen at 0%.
    if (p < 0.01) return '<0.01%';
    if (p < 1) return p.toFixed(2) + '%';
    if (p < 10) return p.toFixed(1) + '%';
    return Math.round(p) + '%';
  }

  function fmtMemMB(m) {
    m = Number(m);
    if (!isFinite(m) || m <= 0) return '0 MB';
    if (m < 1) return Math.max(1, Math.round(m * 1024)) + ' KB';
    if (m < 100) return m.toFixed(1) + ' MB';
    return Math.round(m) + ' MB';
  }

  function usageBarPct(value, limit, fallbackCap) {
    value = Number(value) || 0;
    limit = Number(limit) || 0;
    if (limit > 0) return Math.max(0, Math.min(100, (value / limit) * 100));
    fallbackCap = Number(fallbackCap) || 100;
    return Math.max(0, Math.min(100, (value / fallbackCap) * 100));
  }

  function serviceUsageTitle(svc) {
    if (!svc || !svc.stats) return '';
    var st = svc.stats;
    var parts = [];
    parts.push('CPU ' + fmtCPUPercent(st.cpu_percent) + (st.limit_cpus ? ' / ' + st.limit_cpus : ''));
    parts.push('RAM ' + fmtMemMB(st.memory_mb) + (st.limit_mb ? ' / ' + st.limit_mb + ' MB' : ''));
    if (st.shared) parts.push('shared');
    return parts.join(' · ');
  }

  /** Compact dual meters — updated in-place by patchServiceUsageDOM (no remount). */
  function serviceUsageHTML(svc) {
    if (!svc || !svc.running) return '';
    var st = svc.stats || {};
    var cpu = Number(st.cpu_percent) || 0;
    var mem = Number(st.memory_mb) || 0;
    var cpuBar = usageBarPct(cpu, (Number(st.limit_cpus) || 1) * 100, 100);
    var memBar = usageBarPct(mem, st.limit_mb, 512);
    var cpuPct = cpuBar.toFixed(1);
    var memPct = memBar.toFixed(1);
    function progClass(pct) {
      if (pct >= 85) return ' is-hot';
      if (pct >= 60) return ' is-warm';
      return '';
    }
    return ''
      +'<span class="svc-meters" role="group" aria-label="Live usage" title="'+esc(serviceUsageTitle(svc))+'" data-usage-slug="'+esc(svc.slug)+'">'
        +'<span class="svc-prog'+progClass(cpuBar)+'" data-kind="cpu">'
          +'<span class="svc-prog-meta">'
            +'<span class="svc-prog-label">CPU</span>'
            +'<span class="svc-prog-val">'+esc(fmtCPUPercent(cpu))+'</span>'
          +'</span>'
          +'<span class="svc-prog-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+cpuPct+'" aria-label="CPU">'
            +'<span class="svc-prog-fill" style="width:'+cpuPct+'%"></span>'
          +'</span>'
        +'</span>'
        +'<span class="svc-prog'+progClass(memBar)+'" data-kind="ram">'
          +'<span class="svc-prog-meta">'
            +'<span class="svc-prog-label">RAM</span>'
            +'<span class="svc-prog-val">'+esc(fmtMemMB(mem))+'</span>'
          +'</span>'
          +'<span class="svc-prog-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+memPct+'" aria-label="RAM">'
            +'<span class="svc-prog-fill" style="width:'+memPct+'%"></span>'
          +'</span>'
        +'</span>'
      +'</span>';
  }

  /** Resources fold: spacious stacked live monitor (separate from card header markup). */
  function serviceUsagePanelHTML(svc) {
    if (!svc || !svc.running) return '';
    var st = svc.stats || {};
    var cpu = Number(st.cpu_percent) || 0;
    var mem = Number(st.memory_mb) || 0;
    var cpuBar = usageBarPct(cpu, (Number(st.limit_cpus) || 1) * 100, 100);
    var memBar = usageBarPct(mem, st.limit_mb, 512);
    var cpuPct = cpuBar.toFixed(1);
    var memPct = memBar.toFixed(1);
    function progClass(pct) {
      if (pct >= 85) return ' is-hot';
      if (pct >= 60) return ' is-warm';
      return '';
    }
    function liveItem(kind, label, valText, pct, warmClass) {
      return ''
        +'<div class="svc-live-item'+warmClass+'" data-kind="'+kind+'">'
          +'<div class="svc-live-head">'
            +'<span class="svc-live-label">'+label+'</span>'
            +'<span class="svc-live-val">'+esc(valText)+'</span>'
          +'</div>'
          +'<div class="svc-live-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pct+'" aria-label="'+label+'">'
            +'<div class="svc-live-fill" style="width:'+pct+'%"></div>'
          +'</div>'
        +'</div>';
    }
    return ''
      +'<div class="svc-live" role="group" aria-label="Live usage" title="'+esc(serviceUsageTitle(svc))+'" data-usage-slug="'+esc(svc.slug)+'" data-usage-panel="1">'
        +liveItem('cpu', 'CPU', fmtCPUPercent(cpu), cpuPct, progClass(cpuBar))
        +liveItem('ram', 'RAM', fmtMemMB(mem), memPct, progClass(memBar))
      +'</div>';
  }

  function serviceUsageLabel(svc) {
    if (!svc || !svc.running || !svc.stats) return '';
    return fmtCPUPercent(svc.stats.cpu_percent) + ' · ' + fmtMemMB(svc.stats.memory_mb);
  }

  function patchUsageMetersInPlace(cur, neu) {
    if (!cur || !neu) return;
    cur.title = neu.title;
    var isPanel = cur.getAttribute('data-usage-panel') === '1';
    var itemSel = isPanel ? '.svc-live-item' : '.svc-prog';
    var fillSel = isPanel ? '.svc-live-fill' : '.svc-prog-fill';
    var trackSel = isPanel ? '.svc-live-track' : '.svc-prog-track';
    var valSel = isPanel ? '.svc-live-val' : '.svc-prog-val';
    ['cpu', 'ram'].forEach(function(kind) {
      var a = cur.querySelector(itemSel+'[data-kind="'+kind+'"]');
      var b = neu.querySelector(itemSel+'[data-kind="'+kind+'"]');
      if (!a || !b) return;
      a.classList.toggle('is-hot', b.classList.contains('is-hot'));
      a.classList.toggle('is-warm', b.classList.contains('is-warm'));
      var fill = a.querySelector(fillSel);
      var nFill = b.querySelector(fillSel);
      var track = a.querySelector(trackSel);
      var nTrack = b.querySelector(trackSel);
      var val = a.querySelector(valSel);
      var nVal = b.querySelector(valSel);
      if (fill && nFill) fill.style.width = nFill.style.width;
      if (track && nTrack) {
        var now = nTrack.getAttribute('aria-valuenow');
        if (now != null) track.setAttribute('aria-valuenow', now);
      }
      if (val && nVal && val.textContent !== nVal.textContent) {
        val.textContent = nVal.textContent;
      }
    });
  }

  function mountOrPatchUsageHost(host, htmlFn, svc) {
    if (!host) return;
    var next = htmlFn(svc);
    var cur = host.querySelector('[data-usage-slug]');
    if (!next) {
      if (cur) cur.remove();
      return;
    }
    if (!cur) {
      var where = host.classList && host.classList.contains('svc-usage-panel') ? 'afterbegin' : 'beforeend';
      host.insertAdjacentHTML(where, next);
      cur = host.querySelector('[data-usage-slug]');
      if (cur) cur.classList.add('enter');
      return;
    }
    var tmp = document.createElement('div');
    tmp.innerHTML = next;
    var neu = tmp.firstElementChild;
    if (!neu) return;
    patchUsageMetersInPlace(cur, neu);
  }

  function patchServiceUsageDOM() {
    var root = document.querySelector('.panel-group-detail .svc-list') || document;
    (deployed || []).forEach(function(svc) {
      if (!svc || !svc.slug) return;
      var card = root.querySelector('.svc-card[data-slug="'+svc.slug+'"]');
      if (!card) return;
      var meters = card.querySelector('.svc-widget-meters');
      if (meters) mountOrPatchUsageHost(meters, serviceUsageHTML, svc);
      else {
        var row = card.querySelector('.svc-title-row');
        if (row) mountOrPatchUsageHost(row, serviceUsageHTML, svc);
      }
      var panel = card.querySelector('.svc-usage-panel');
      if (panel) mountOrPatchUsageHost(panel, serviceUsagePanelHTML, svc);
      var drawer = document.querySelector('#drawer-root .svc-drawer[data-slug="'+svc.slug+'"]');
      if (drawer) {
        var dMeters = drawer.querySelector('.svc-widget-meters');
        if (dMeters) mountOrPatchUsageHost(dMeters, serviceUsageHTML, svc);
        var dPanel = drawer.querySelector('.svc-usage-panel');
        if (dPanel) mountOrPatchUsageHost(dPanel, serviceUsagePanelHTML, svc);
      }
    });
  }

  /* === 03-cselect.js === */
  function liveRenderOk() {
    if (picker) return false;
    if (wizard) return false;
    return true;
  }

  /** Options catalog for in-place filtering without remounting the modal. */
  var cselectCatalog = {};

  function placeOpenCselect() {
    var host = document.querySelector('.cselect.open');
    if (!host) return;
    var btn = host.querySelector('.cselect-btn');
    var menu = host.querySelector('.cselect-menu');
    if (!btn || !menu) return;
    var r = btn.getBoundingClientRect();
    var width = Math.max(r.width, 260);
    var maxH = Math.min(280, Math.floor(window.innerHeight * 0.45));
    var spaceBelow = window.innerHeight - r.bottom - 12;
    var spaceAbove = r.top - 12;
    var openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    menu.style.position = 'fixed';
    menu.style.left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8) + 'px';
    menu.style.width = width + 'px';
    menu.style.right = 'auto';
    menu.style.zIndex = '90';
    menu.style.maxHeight = maxH + 'px';
    if (openUp) {
      menu.style.top = 'auto';
      menu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      host.classList.add('drop-up');
    } else {
      menu.style.bottom = 'auto';
      menu.style.top = (r.bottom + 6) + 'px';
      host.classList.remove('drop-up');
    }
    var list = menu.querySelector('.cselect-list');
    if (list) {
      var searchH = menu.querySelector('.cselect-search-wrap');
      list.style.maxHeight = Math.max(120, maxH - (searchH ? searchH.offsetHeight : 0)) + 'px';
    }
  }

  function cselectItemsHTML(id, options, value, q, creatable) {
    options = options || [];
    q = String(q || '');
    var filtered = options;
    if (q) {
      var lq = q.toLowerCase();
      filtered = options.filter(function(o){
        return String(o.label || '').toLowerCase().indexOf(lq) >= 0
          || String(o.value || '').toLowerCase().indexOf(lq) >= 0
          || String(o.meta || '').toLowerCase().indexOf(lq) >= 0
          || String(o.name || '').toLowerCase().indexOf(lq) >= 0;
      });
    }
    var exact = false;
    if (q) {
      for (var ei = 0; ei < options.length; ei++) {
        if (String(options[ei].value).toLowerCase() === q.toLowerCase()) { exact = true; break; }
      }
    }
    var items = filtered.length
      ? filtered.map(function(o){
          var active = String(o.value) === String(value || '') ? ' active' : '';
          return '<button type="button" class="cselect-item'+active+'" data-action="cselect:pick:'+esc(id)+'" data-value="'+esc(o.value)+'" data-label="'+esc(o.label)+'"'
            + (o.branch ? ' data-branch="'+esc(o.branch)+'"' : '')
            + (o.name ? ' data-name="'+esc(o.name)+'"' : '')
            + '>'+esc(o.label)+(o.meta ? '<span class="meta">'+esc(o.meta)+'</span>' : '')+'</button>';
        }).join('')
      : '<div class="cselect-empty">'+(q ? 'No matches' : 'No options')+'</div>';
    if (creatable && q && !exact) {
      items += '<button type="button" class="cselect-item create" data-action="cselect:pick:'+esc(id)+'" data-value="'+esc(q)+'" data-label="'+esc(q)+'">Use “'+esc(q)+'”</button>';
    }
    return items;
  }

  /** Filter the open menu in place — keeps focus and avoids modal remount flicker. */
  function filterOpenCselect() {
    if (!picker) return;
    var id = picker.id;
    var cat = cselectCatalog[id];
    if (!cat) return;
    var host = document.querySelector('.cselect.open[data-cselect="'+id+'"]');
    if (!host) return;
    var list = host.querySelector('.cselect-list');
    if (!list) return;
    list.innerHTML = cselectItemsHTML(id, cat.options, cat.value, picker.query, cat.creatable);
    placeOpenCselect();
  }

  function cselectHTML(id, value, placeholder, options, disabled, conf) {
    options = options || [];
    conf = conf || {};
    var searchable = conf.searchable !== false && (conf.searchable || options.length > 6 || conf.creatable);
    if (conf.searchable === true) searchable = true;
    if (conf.searchable === false) searchable = false;
    var creatable = !!conf.creatable;
    var open = picker && picker.id === id;
    var q = (open && picker.query != null) ? String(picker.query) : '';
    cselectCatalog[id] = { options: options, creatable: creatable, value: value || '', searchable: searchable };

    var selected = null;
    for (var i = 0; i < options.length; i++) {
      if (String(options[i].value) === String(value || '')) { selected = options[i]; break; }
    }
    var label = selected ? selected.label : (value ? String(value) : '');
    var btnInner = label
      ? ('<span>'+esc(label)+'</span>' + (selected && selected.meta ? '<span class="btn-meta">'+esc(selected.meta)+'</span>' : ''))
      : ('<span class="ph">'+esc(placeholder || 'Select…')+'</span>');

    var items = cselectItemsHTML(id, options, value, q, creatable);
    var menu = ''
      +'<div class="cselect-menu" data-stop="1">'
        +(searchable
          ? '<div class="cselect-search-wrap"><input class="cselect-search" id="cselect-q-'+esc(id)+'" type="text" inputmode="search" placeholder="'+esc(conf.searchPlaceholder || 'Filter…')+'" value="'+esc(q)+'" autocomplete="off" spellcheck="false"></div>'
          : '')
        +'<div class="cselect-list">'+items+'</div>'
      +'</div>';
    return ''
      +'<div class="cselect'+(open?' open':'')+(disabled?' disabled':'')+'" data-cselect="'+esc(id)+'">'
        +'<button type="button" class="cselect-btn" data-action="cselect:toggle:'+esc(id)+'" '+(disabled?'disabled':'')+'>'+btnInner+'</button>'
        +(open ? menu : '')
      +'</div>';
  }

  /* === 04-folds.js === */
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
    return k === 'DB_PASSWORD' || k === 'DATABASE_URL' || /PASSWORD|SECRET|TOKEN|KEY$/i.test(k);
  }

  /** Split user env text into custom-only (no reserved DB keys). */
  function splitCustomEnv(text) {
    var map = parseEnvMapClient(text);
    var custom = {};
    Object.keys(map).forEach(function(k){
      if (RESERVED_DB_KEYS.indexOf(k) >= 0) return;
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

  /* === 05-resources.js === */
  var SYS_MEM_RESERVE_MB = 768;
  var SYS_CPU_RESERVE = 0.5;
  function piCapacity() {
    var d = (state && state.device_metrics) || {};
    var mem = d.memory || {};
    var cpu = d.cpu || {};
    var totalMB = Math.max(512, Math.round((mem.total_bytes || 0) / (1024 * 1024)));
    var cores = Math.max(1, Number(cpu.count || 1));
    var maxMem = Math.max(256, totalMB - SYS_MEM_RESERVE_MB);
    var maxCpu = Math.max(0.5, Math.round((cores - SYS_CPU_RESERVE) * 10) / 10);
    return { totalMB: totalMB, cores: cores, maxMem: maxMem, maxCpu: maxCpu, reserveMB: SYS_MEM_RESERVE_MB, reserveCpu: SYS_CPU_RESERVE };
  }
  function allocatedResources(excludeSlug) {
    var mem = 0, cpus = 0;
    (deployed || []).forEach(function(s){
      if (s.type !== 'go') return;
      if (excludeSlug && s.slug === excludeSlug) return;
      mem += Number(s.memory_mb || 0);
      cpus += Number(s.cpus || 0);
    });
    return { mem: mem, cpus: Math.round(cpus * 10) / 10 };
  }
  function rangeThumbPct(el) {
    if (!el) return 0;
    var min = parseFloat(el.min);
    var max = parseFloat(el.max);
    var val = parseFloat(el.value);
    if (!(max > min)) return 0;
    return Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  }
  function resourceControlsHTML(opts) {
    opts = opts || {};
    var cap = piCapacity();
    var other = allocatedResources(opts.excludeSlug || null);
    var mem = Number(opts.memory_mb || 512);
    var cpus = Number(opts.cpus || 1);
    if (mem < 64) mem = 64;
    if (mem > cap.maxMem) mem = cap.maxMem;
    if (cpus < 0.1) cpus = 0.1;
    if (cpus > cap.maxCpu) cpus = cap.maxCpu;
    mem = Math.round(mem / 64) * 64;
    cpus = Math.round(cpus * 10) / 10;
    var memName = opts.memName || 'memory_mb';
    var cpuName = opts.cpuName || 'cpus';
    var memId = opts.memId || '';
    var cpuId = opts.cpuId || '';
    var memPct = cap.totalMB ? Math.round(mem / cap.totalMB * 100) : 0;
    var cpuPct = cap.cores ? Math.round(cpus / cap.cores * 100) : 0;
    var memThumb = cap.maxMem > 64 ? ((mem - 64) / (cap.maxMem - 64)) * 100 : 0;
    var cpuThumb = cap.maxCpu > 0.1 ? ((cpus - 0.1) / (cap.maxCpu - 0.1)) * 100 : 0;
    function card(kind, label, valueHtml, unit, inputAttrs, thumb, meta) {
      return ''
        +'<div class="res-card" data-kind="'+esc(kind)+'">'
          +'<div class="res-head">'
            +'<span class="res-label">'+esc(label)+'</span>'
            +'<span class="res-value-pill">'
              +'<strong class="res-val res-val-'+esc(kind)+'">'+valueHtml+'</strong>'
              +(unit ? '<span class="res-unit">'+esc(unit)+'</span>' : '')
            +'</span>'
          +'</div>'
          +'<div class="res-slider" style="--thumb:'+esc(Math.round(thumb * 10) / 10)+'%" data-res-slider="1">'
            +'<div class="res-track" aria-hidden="true">'
              +'<span class="res-fill"></span>'
            +'</div>'
            +'<input type="range" '+inputAttrs+'>'
          +'</div>'
          +'<div class="res-meta"><span class="res-pct-'+esc(kind)+'">'+esc(meta)+'</span></div>'
        +'</div>';
    }
    var memMeta = memPct + '% of Pi' + (other.mem ? ' · others '+other.mem+' MB' : '');
    var cpuMeta = cpuPct + '% of '+cap.cores+' cores' + (other.cpus ? ' · others '+other.cpus : '');
    return ''
      +'<div class="res-panel" data-res-panel="1"'
        +' data-total-mb="'+esc(cap.totalMB)+'"'
        +' data-cores="'+esc(cap.cores)+'"'
        +' data-max-mem="'+esc(cap.maxMem)+'"'
        +' data-max-cpu="'+esc(cap.maxCpu)+'"'
        +' data-other-mem="'+esc(other.mem)+'"'
        +' data-other-cpu="'+esc(other.cpus)+'">'
        +'<div class="res-grid">'
          +card('mem', 'Memory', esc(mem), 'MB',
            (memId?'id="'+esc(memId)+'" ':'')+'name="'+esc(memName)+'" min="64" max="'+esc(cap.maxMem)+'" step="64" value="'+esc(mem)+'" data-res="mem"',
            memThumb, memMeta)
          +card('cpu', 'CPU', esc(cpus), 'cores',
            (cpuId?'id="'+esc(cpuId)+'" ':'')+'name="'+esc(cpuName)+'" min="0.1" max="'+esc(cap.maxCpu)+'" step="0.1" value="'+esc(cpus)+'" data-res="cpu"',
            cpuThumb, cpuMeta)
        +'</div>'
        +uiHint('Docker hard limits · leave Pi headroom')
        +'<p class="res-warn" hidden>Over safe headroom — lower limits or stop other apps.</p>'
      +'</div>';
  }
  function syncResLabels(panel) {
    if (!panel) return;
    var totalMB = parseInt(panel.getAttribute('data-total-mb'), 10) || 1;
    var cores = parseFloat(panel.getAttribute('data-cores')) || 1;
    var maxMem = parseInt(panel.getAttribute('data-max-mem'), 10) || totalMB;
    var maxCpu = parseFloat(panel.getAttribute('data-max-cpu')) || cores;
    var otherMem = parseInt(panel.getAttribute('data-other-mem'), 10) || 0;
    var otherCpu = parseFloat(panel.getAttribute('data-other-cpu')) || 0;

    var memEl = panel.querySelector('[data-res=mem]');
    var cpuEl = panel.querySelector('[data-res=cpu]');
    var mem = memEl ? (parseInt(memEl.value, 10) || 512) : 512;
    var cpus = cpuEl ? Math.round((parseFloat(cpuEl.value) || 1) * 10) / 10 : 1;
    var memPct = Math.round(mem / totalMB * 100);
    var cpuPct = Math.round(cpus / cores * 100);

    var memLab = panel.querySelector('.res-val-mem');
    var cpuLab = panel.querySelector('.res-val-cpu');
    var memPctEl = panel.querySelector('.res-pct-mem');
    var cpuPctEl = panel.querySelector('.res-pct-cpu');
    if (memLab) memLab.textContent = String(mem);
    if (cpuLab) cpuLab.textContent = String(cpus);
    if (memPctEl) memPctEl.textContent = memPct + '% of Pi' + (otherMem ? ' · others ' + otherMem + ' MB' : '');
    if (cpuPctEl) cpuPctEl.textContent = cpuPct + '% of ' + cores + ' cores' + (otherCpu ? ' · others ' + otherCpu : '');

    if (memEl) {
      var wrap = memEl.closest('.res-slider');
      if (wrap) wrap.style.setProperty('--thumb', rangeThumbPct(memEl).toFixed(2) + '%');
    }
    if (cpuEl) {
      var wrap2 = cpuEl.closest('.res-slider');
      if (wrap2) wrap2.style.setProperty('--thumb', rangeThumbPct(cpuEl).toFixed(2) + '%');
    }

    var over = (otherMem + mem) > maxMem || (otherCpu + cpus) > (maxCpu + 0.05);
    panel.classList.toggle('over', over);
    var warn = panel.querySelector('.res-warn');
    if (warn) warn.hidden = !over;
  }

  /* === 06-services.js === */
  function githubSettingsPanel(gh) {
    gh = gh || github || {};
    if (gh.connected) {
      return ''
        +'<div class="settings-gh">'
          +'<div class="gh-chip ok" title="GitHub connected">'
            +'<span class="gh-dot"></span>'
            +'<span class="gh-label">'+esc((gh.user && gh.user.login) || 'GitHub')+'</span>'
          +'</div>'
          +'<p class="ghost">Deploy Go apps from your repositories. Disconnect here to switch accounts.</p>'
          +'<div class="inline-actions">'
            +'<button type="button" class="btn btn-quiet" data-action="github:clear">Disconnect GitHub</button>'
          +'</div>'
        +'</div>';
    }
    return ''
      +'<div class="settings-gh ws-empty">'
        +'<strong>Connect GitHub</strong>'
        +'<p>Link your account to pick repositories when deploying apps.</p>'
        +'<button type="button" class="btn primary" data-action="wizard:github">Connect GitHub</button>'
      +'</div>';
  }

  function settingsSeg() {
    var tabs = [
      { id: 'github', label: 'GitHub' },
      { id: 'storage', label: 'Storage' }
    ];
    return ''
      +'<div class="ws-tabs" role="tablist" aria-label="Settings">'
        + tabs.map(function(t){
            return '<button type="button" role="tab" class="'+(settingsTab===t.id?'active':'')+'" data-action="settings:tab:'+t.id+'" aria-selected="'+(settingsTab===t.id?'true':'false')+'">'+esc(t.label)+'</button>';
          }).join('')
      +'</div>';
  }

  function settingsWorkspaceView(s) {
    var tab = settingsTab || 'github';
    var body = tab === 'storage' ? storagePanelBody(s) : githubSettingsPanel(github);
    return ''
      +'<div class="nav-page" data-view="settings">'
        +'<div class="rack">'
          +'<section class="panel panel-svc panel-manage panel-workspace panel-settings">'
            +'<header class="ws-head ws-head-settings">'
              +'<div class="ws-head-top">'
                +'<div class="ws-title-block"><h2>Settings</h2></div>'
                +(tab === 'storage'
                  ? ('<div class="ws-head-actions">'+btn('Refresh', 'docker:refresh', 'btn-quiet btn-compact', manageLoading || busy['docker:refresh'])+'</div>')
                  : '')
              +'</div>'
              +settingsSeg()
            +'</header>'
            +'<div class="ws-body settings-body">'+(body || '')+'</div>'
          +'</section>'
        +'</div>'
      +'</div>';
  }

  function activityMainView() {
    return ''
      +'<div class="nav-page" data-view="activity">'
        +'<div class="activity-main-placeholder page-hint">'
          +'<h2>Activity</h2>'
          +'<p class="ghost">Deploy and engine logs stream in the console at the bottom of the screen.</p>'
        +'</div>'
      +'</div>';
  }

  function services(s) {
    var gh = github || {};
    if (navView === 'settings') return settingsWorkspaceView(s);
    if (navView === 'activity') return activityMainView();
    if (navView !== 'projects') return '';
    if (manageTab === 'network') manageTab = 'services';
    return projectsWorkspaceView(s, gh);
  }

  function groupTileHTML(g, isActive) {
    var disk = g.disk_bytes ? fmtBytes(g.disk_bytes) : '';
    var count = g.service_count != null ? g.service_count : 0;
    var bits = [];
    if (count) bits.push(count + (count === 1 ? ' service' : ' services'));
    if (disk) bits.push(disk);
    return ''
      +'<button type="button" class="group-tile'+(isActive ? ' active' : '')+'" data-action="group:open:'+esc(g.slug)+'">'
        +'<div class="group-tile-main">'
          +'<div class="group-tile-title">'+esc(g.name || g.slug)+'</div>'
          +'<div class="group-tile-sub"><span class="mono">'+esc(g.slug)+'</span>'
            +(bits.length ? (' · ' + esc(bits.join(' · '))) : '')
          +'</div>'
        +'</div>'
        +'<span class="group-tile-chev" aria-hidden="true"></span>'
      +'</button>';
  }

  function groupsSidebarHTML() {
    var n = (groups || []).length;
    var cards = (groups || []).map(function(g){ return groupTileHTML(g, activeGroup === g.slug); }).join('');
    var errBlock = groupsError && !navLoading
      ? ('<div class="ws-empty ws-empty-compact" role="alert"><strong>Could not load groups</strong><p>'+esc(groupsError)+'</p><button type="button" class="btn primary btn-compact" data-action="projects:retry">Retry</button></div>')
      : '';
    var empty = ''
      +'<div class="ws-empty ws-empty-compact">'
        +'<strong>No groups yet</strong>'
        +'<p>Create a group with <strong>New group</strong> in the header to deploy databases and Go apps.</p>'
      +'</div>';
    var body = errBlock || (n ? cards : empty);
    return ''
      +'<div class="ws-col ws-col-groups">'
        +'<div class="ws-section-head">'
          +'<div class="ws-section-title"><h3>Groups</h3><span class="gd-count">'+String(n)+'</span></div>'
        +'</div>'
        +'<div class="group-tile-list group-tile-list-col">'+body+'</div>'
      +'</div>';
  }

  function projectsWelcomePane() {
    return ''
      +'<div class="ws-col ws-col-main projects-welcome">'
        +'<div class="projects-welcome-inner">'
          +'<div class="projects-welcome-icon" aria-hidden="true">'+ico('app')+'</div>'
          +'<h3>Select a group</h3>'
          +'<p class="ghost">Choose a project from the list. Use <strong>New group</strong> in the header to get started.</p>'
        +'</div>'
      +'</div>';
  }

  function projectsWorkspaceView(s, gh) {
    var mainPane = activeGroup ? groupDetailPane(s, gh) : projectsWelcomePane();
    return ''
      +'<div class="nav-page" data-view="projects">'
        +'<div class="rack">'
          +'<section class="panel panel-svc panel-manage panel-workspace panel-projects-crm">'
            +'<header class="ws-head">'
              +'<div class="ws-head-main">'
                +'<div class="ws-title-block"><h2>Projects</h2><p class="ghost">Groups &amp; services</p></div>'
              +'</div>'
              +'<div class="ws-head-actions">'
                +'<button type="button" class="btn primary btn-compact" data-action="wizard:group">New group</button>'
              +'</div>'
            +'</header>'
            +'<div class="ws-body projects-split">'
              + groupsSidebarHTML()
              + mainPane
            +'</div>'
          +'</section>'
        +'</div>'
      +'</div>';
  }

  function groupDetailPane(s, gh) {
    var g = (groups || []).filter(function(x){ return x.slug === activeGroup; })[0] || { slug: activeGroup, name: activeGroup };
    var list = deployed || [];
    var dbs = list.filter(function(x){ return x.type === 'postgres'; });
    var apps = list.filter(function(x){ return x.type !== 'postgres'; });
    var dbCards = dbs.map(function(svc){ return serviceCard(svc, dbs); }).join('');
    var appCards = apps.map(function(svc){ return serviceCard(svc, dbs); }).join('');
    var draftName = (groupDraft && groupDraft.name != null) ? groupDraft.name : (g.name || g.slug);
    var savedName = g.name || g.slug;
    var nameDirty = String(draftName).trim() !== String(savedName).trim();
    var empty = navLoading
      ? ('<div class="gd-empty gd-empty-loading"><div class="nav-spinner" aria-hidden="true"></div><p>Loading…</p></div>')
      : servicesError
      ? ('<div class="gd-empty" role="alert"><strong>Could not load services</strong><p>'+esc(servicesError)+'</p><button type="button" class="btn primary" data-action="projects:retry">Retry</button></div>')
      : (''
        +'<div class="gd-empty">'
          +'<div class="gd-empty-ill" aria-hidden="true">'+ico('plus')+'</div>'
          +'<strong>Nothing here yet</strong>'
          +'<p>Add a database first, then an app — link them so the app gets <code>DB_*</code> automatically.</p>'
          +'<button type="button" class="btn primary" data-action="wizard:open">'+ico('plus')+' Add service</button>'
        +'</div>');
    function lane(opts) {
      return ''
        +'<div class="svc-lane kind-'+opts.kind+'">'
          +'<div class="svc-lane-head">'
            +'<div class="svc-lane-title">'+ico(opts.ico)+'<h3>'+esc(opts.title)+'</h3><span class="gd-count">'+opts.count+'</span></div>'
            +(opts.action || '')
          +'</div>'
          +'<div class="svc-grid-canvas"><div class="svc-list svc-grid'+(navLoading?' is-loading':'')+'">'+(opts.body || '')+'</div></div>'
        +'</div>';
    }
    var canvasInner;
    if (!list.length) {
      canvasInner = empty;
    } else {
      canvasInner = ''
        +(dbs.length || true
          ? lane({ kind: 'db', ico: 'db', title: 'Databases', count: dbs.length,
              body: dbCards || '<div class="svc-lane-empty">No database — add one to store app data.</div>',
              action: '<button type="button" class="rw-add-btn" data-action="wizard:type:postgres">'+ico('plus')+' Database</button>' })
          : '')
        +lane({ kind: 'app', ico: 'app', title: 'Apps', count: apps.length,
            body: appCards || '<div class="svc-lane-empty">No app yet — deploy a Go service and link a database.</div>',
            action: '<button type="button" class="rw-add-btn rw-add-primary" data-action="wizard:type:go">'+ico('plus')+' App</button>' });
    }
    var body = ''
      +'<div class="rw-canvas'+(settingsSlug?' drawer-open':'')+'" data-canvas="1">'
        +'<svg class="rw-links" aria-hidden="true"><g class="rw-links-g"></g></svg>'
        +canvasInner
      +'</div>';
    return ''
      +'<div class="ws-col ws-col-main panel-group-detail">'
        +'<header class="gd-head">'
          +'<button type="button" class="btn btn-quiet btn-back btn-icon" data-action="group:back" title="Back to groups" aria-label="Back">'+ico('back')+'</button>'
          +'<div class="gd-identity">'
            +'<label class="gd-label" for="group-name">Group</label>'
            +'<div class="gd-name-row">'
              +uiInput({ name: 'group-name', id: 'group-name', value: draftName, placeholder: 'Name this group', className: 'gd-name-input' })
              +'<button type="button" class="btn primary btn-compact gd-save'+(nameDirty?' is-dirty':'')+(busy['group:save']?' loading':'')+'" data-action="group:save" data-baseline="'+esc(savedName)+'" '+(busy['group:save'] || !nameDirty?'disabled':'')+' title="Save name"><span class="spinner"></span><span>Save</span></button>'
            +'</div>'
            +'<div class="gd-meta"><span class="mono">'+esc(g.slug)+'</span></div>'
          +'</div>'
          +'<div class="gd-head-actions">'
            +'<button type="button" class="btn btn-quiet danger-soft btn-compact" data-action="group:delete:'+esc(g.slug)+'" title="Delete group">'+ico('trash')+' Delete</button>'
          +'</div>'
        +'</header>'
        +'<div class="gd-body rw-canvas-wrap">'
          + body
        +'</div>'
      +'</div>';
  }


  function systemSyncroxInner(s) {
    return ''
      +'<div class="system-row">'
        +'<div class="system-row-main">'
          +'<strong>Syncrox</strong>'
          +'<span class="ghost">'+(s.syncrox_running ? 'Running on :5090' : 'Stopped')+'</span>'
        +'</div>'
        +'<div class="inline-actions">'
          +btn(s.syncrox_running ? 'Stop' : 'Start', s.syncrox_running ? 'syncrox:stop' : 'syncrox:start', s.syncrox_running ? 'danger' : 'primary', false)
          +'<a class="btn" href="http://'+esc(publicHost())+':5090" target="_blank" rel="noopener">Open</a>'
        +'</div>'
      +'</div>';
  }
  function systemSyncrox(s) { return systemSyncroxInner(s); }


  /** Compact inline SVG icons — shared across service cards & actions. */
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
      close: '<path d="M18 6L6 18M6 6l12 12"/>'
    };
    return '<svg'+common+'>'+(paths[name] || '')+'</svg>';
  }

  function svcKindMeta(svc) {
    if (svc && svc.type === 'postgres') {
      return { kind: 'db', label: 'Database', ico: 'db' };
    }
    return { kind: 'app', label: 'App', ico: 'app' };
  }

  function statusMeta(svc, building, failed, isUp) {
    if (svc && svc.type === 'postgres') {
      return isUp
        ? { cls: 'ok', label: 'Ready' }
        : { cls: 'off', label: 'Offline' };
    }
    if (building) return { cls: 'build', label: 'Building' };
    if (failed) return { cls: 'fail', label: 'Failed' };
    if (isUp) return { cls: 'ok', label: 'Running' };
    return { cls: 'off', label: 'Stopped' };
  }

  function actionBtn(opts) {
    opts = opts || {};
    var cls = 'btn btn-compact svc-act' + (opts.cls ? (' ' + opts.cls) : '') + (opts.busy ? ' loading' : '');
    var dis = (opts.disabled || opts.busy) ? ' disabled' : '';
    var icon = opts.icon ? ico(opts.icon) : '';
    return '<button type="button" class="'+cls+'" data-action="'+esc(opts.action||'')+'" data-stop="1"'+dis
      +' title="'+(opts.title ? esc(opts.title) : esc(opts.label||''))+'">'
      +'<span class="spinner"></span>'+icon+'<span>'+esc(opts.label||'')+'</span></button>';
  }


  function accessURL(svc) {
    if (!svc) return '';
    if (svc.type === 'postgres') return rewriteHost(svc.connection_url || '');
    var raw = svc.url || (svc.port ? ('http://rasp.local:' + svc.port) : '');
    return rewriteHost(raw);
  }
  function accessLabel(svc) {
    return svc && svc.type === 'postgres' ? 'DATABASE_URL' : 'App URL';
  }
  function publicURL(svc) {
    return (svc && svc.public_url) ? String(svc.public_url) : '';
  }
  function accessSummary(svc) {
    if (!svc) return '—';
    if (svc.type === 'postgres') {
      return svc.database || accessHostSummary(accessURL(svc)) || '—';
    }
    var pub = publicURL(svc);
    if (pub) return String(pub).replace(/^https?:\/\//, '');
    var local = accessURL(svc);
    return local ? String(local).replace(/^https?:\/\//, '') : '—';
  }
  function accessBarHTML(svc) {
    var local = accessURL(svc);
    var pub = publicURL(svc);
    var primary = pub || local;
    if (!primary) {
      return '<div class="svc-foot empty"><span class="ghost">No endpoint yet</span></div>';
    }
    var isPg = svc.type === 'postgres';
    var label = pub ? 'Public' : (isPg ? 'Database URL' : 'App URL');
    var openBtn = isPg ? '' : (
      '<a class="btn btn-compact svc-act primary" href="'+esc(primary)+'" target="_blank" rel="noopener" data-stop="1" title="Open">'
        +ico('open')+'<span>Open</span></a>'
    );
    return ''
      +'<div class="svc-foot'+(pub?' is-public':'')+(isPg?' is-db':' is-app')+'" data-stop="1">'
        +'<div class="svc-foot-main">'
          +'<div class="svc-foot-label"><span>'+esc(label)+'</span></div>'
          +'<code class="svc-foot-url" id="access-'+esc(svc.slug)+'" data-copy="'+esc(primary)+'" title="'+esc(primary)+'">'+esc(primary)+'</code>'
        +'</div>'
        +'<div class="svc-foot-acts">'
          +'<button type="button" class="btn btn-compact svc-act" data-action="copy:access:'+esc(svc.slug)+'" title="Copy full URL">'
            +ico('copy')+'<span>Copy</span></button>'
          +openBtn
        +'</div>'
      +'</div>';
  }
  function accessFoldBody(svc) {
    var local = accessURL(svc);
    if (svc.type === 'postgres') {
      if (!local) return uiHint('No URL yet — start the engine');
      return ''
        +'<div class="copy-row">'
          +'<code id="access-cfg-'+esc(svc.slug)+'" data-copy="'+esc(local)+'">'+esc(local)+'</code>'
          +'<button type="button" class="btn" data-action="copy:access-cfg:'+esc(svc.slug)+'">Copy</button>'
        +'</div>'
        +uiHint('Paste into clients · linked apps get DB_* + DATABASE_URL');
    }
    if (!local) return uiHint('No URL yet — start or redeploy');
    var pub = publicURL(svc);
    var busyT = !!(busy['tunnel:'+svc.slug] || busy['tunnel-stop:'+svc.slug]);
    var localRow = ''
      +'<div class="access-block">'
        +'<div class="access-block-head"><span>Local</span><span class="ghost">:'+esc(String(svc.port||''))+'</span></div>'
        +'<div class="copy-row">'
          +'<code id="access-cfg-'+esc(svc.slug)+'" data-copy="'+esc(local)+'">'+esc(local)+'</code>'
          +'<button type="button" class="btn" data-action="copy:access-cfg:'+esc(svc.slug)+'">Copy</button>'
          +'<a class="btn" href="'+esc(local)+'" target="_blank" rel="noopener">Open</a>'
        +'</div>'
      +'</div>';
    var net;
    if (pub) {
      net = ''
        +'<div class="access-block is-public">'
          +'<div class="access-block-head"><span>Internet</span><span class="ghost">public link</span></div>'
          +'<div class="copy-row">'
            +'<code id="access-pub-'+esc(svc.slug)+'" data-copy="'+esc(pub)+'">'+esc(pub)+'</code>'
            +'<button type="button" class="btn" data-action="copy:access-pub:'+esc(svc.slug)+'">Copy</button>'
            +'<a class="btn primary" href="'+esc(pub)+'" target="_blank" rel="noopener">Open</a>'
            +'<button type="button" class="btn btn-quiet'+(busyT?' loading':'')+'" data-action="svc:tunnel-stop:'+esc(svc.slug)+'" '+(busyT?'disabled':'')+'>'
              +'<span class="spinner"></span><span>Unexpose</span></button>'
          +'</div>'
          +'<div class="access-note">Stays until reboot or Unexpose</div>'
        +'</div>';
    } else {
      net = ''
        +'<div class="access-block">'
          +'<div class="access-block-head"><span>Internet</span><span class="ghost">Cloudflare</span></div>'
          +'<div class="access-expose">'
            +'<button type="button" class="btn primary'+(busyT?' loading':'')+'" data-action="svc:tunnel:'+esc(svc.slug)+'" '
              +(busyT||!svc.running?'disabled':'')+'>'
              +'<span class="spinner"></span><span>Expose</span></button>'
            +'<span class="ghost">'+(svc.running ? 'Random public URL' : 'Start the app first')+'</span>'
          +'</div>'
        +'</div>';
    }
    return localRow + net;
  }

  function deployStatusLabel(st) {
    st = String(st || '');
    if (st === 'active') return 'Active';
    if (st === 'building' || st === 'queued') return 'Building';
    if (st === 'failed') return 'Failed';
    if (st === 'archived') return 'Archived';
    return st || 'Unknown';
  }

  function deploymentsFoldBody(svc) {
    var list = svc.deployments || [];
    if (!list.length) {
      return uiEmpty({ mini: true, body: 'No deploys yet — Redeploy to create history.' });
    }
    var liveId = activity && activity.deployment_id;
    var viewing = activity && activity.viewDeploy;
    return '<div class="deploy-list">' + list.map(function(d){
      var st = d.status || '';
      var live = !!(liveId && d.id === liveId && (st === 'building' || st === 'queued'));
      var selected = !!(viewing && d.id === viewing);
      var meta = [];
      if (d.commit) meta.push(d.commit);
      if (d.branch) meta.push(d.branch);
      if (d.id) meta.push(d.id);
      var err = d.error ? '<div class="deploy-err">'+esc(String(d.error).slice(0,120))+'</div>' : '';
      var phase = (st === 'building' || st === 'queued')
        ? '<div class="deploy-phase">Clone → Build → Start</div>'
        : '';
      return ''
        +'<button type="button" class="deploy-row '+esc(st)+(live?' live':'')+(selected?' selected':'')+'"'
          +' data-action="deploy:logs:'+esc(svc.slug)+':'+esc(d.id)+'"'
          +' data-deploy-id="'+esc(d.id)+'"'
          +' title="Open logs for this deployment">'
          +'<span class="deploy-pill '+esc(st)+'">'+esc(deployStatusLabel(st))+(live?' · live':'')+'</span>'
          +'<div class="deploy-main">'
            +'<div class="deploy-meta">'+esc(meta.join(' · ') || 'New deployment')+'</div>'
            +phase
            +err
          +'</div>'
        +'</button>';
    }).join('') + '</div>';
  }

  function deploymentsSummary(svc) {
    var list = svc.deployments || [];
    if (!list.length) return 'None';
    var building = list.filter(function(d){ return d.status === 'building' || d.status === 'queued'; }).length;
    var failed = list.filter(function(d){ return d.status === 'failed'; }).length;
    var active = list.filter(function(d){ return d.status === 'active' || d.active; })[0];
    if (building) return 'Building';
    if (active) return 'Active';
    if (failed) return failed + ' failed';
    return String(list.length);
  }

  function accessHostSummary(access) {
    if (!access) return '—';
    var s = String(access).replace(/^https?:\/\//, '');
    var host = s.split('/')[0] || s;
    if (host.length > 22) host = host.slice(0, 20) + '…';
    return host || 'URL';
  }



  function drawerToolbarHTML(svc) {
    var isPg = svc.type === 'postgres';
    var building = !isPg && (svc.status === 'building' || !!(svc.deployments || []).some(function(d){ return d.status === 'building' || d.status === 'queued'; }));
    var failed = !isPg && !building && (svc.status === 'failed' || !!svc.last_error);
    var isUp = !!svc.running && !failed && !building;
    var startStopBusy = !!(busy['svc:start:'+svc.slug] || busy['svc:stop:'+svc.slug]);
    var restartBusy = !!(busy['svc:restart:'+svc.slug]);
    var toolCls = 'drawer-tool-btn btn-compact';
    var acts = '';
    if (isPg) {
      if (isUp) {
        acts = btn('Stop', 'svc:stop:'+svc.slug, toolCls, startStopBusy)
          + btn('Restart', 'svc:restart:'+svc.slug, toolCls, restartBusy);
      } else {
        acts = btn('Start', 'svc:start:'+svc.slug, 'primary ' + toolCls, startStopBusy);
      }
    } else if (building) {
      acts = '<span class="drawer-tool-note ghost" role="status">Deploying…</span>';
    } else {
      if (isUp) {
        acts = btn('Stop', 'svc:stop:'+svc.slug, toolCls, startStopBusy);
      } else {
        acts = btn('Start', 'svc:start:'+svc.slug, 'primary ' + toolCls, startStopBusy);
      }
      acts += btn('Restart', 'svc:restart:'+svc.slug, toolCls, restartBusy || !isUp);
      acts += btn('Logs', 'svc:logs:'+svc.slug, toolCls, false);
    }
    return acts;
  }

  function pgVolumeHTML(svc) {
    var vol = (svc.volume && String(svc.volume).trim()) || 'infra_firewifi_pgdata';
    var sizeRaw = (svc.volume_size && String(svc.volume_size).trim()) || (svc.volume_bytes ? fmtBytes(svc.volume_bytes) : '');
    var size = sizeRaw || '—';
    var img = (svc.engine_image && String(svc.engine_image).trim()) || 'postgres:16-alpine';
    var host = '127.0.0.1:5432';
    return ''
      +'<section class="drawer-section drawer-section-card" aria-labelledby="pg-overview-'+esc(svc.slug)+'">'
        +'<header class="drawer-section-head">'
          +'<h3 id="pg-overview-'+esc(svc.slug)+'" class="drawer-section-title">Overview</h3>'
          +'<span class="drawer-section-meta ghost">Runtime</span>'
        +'</header>'
        +'<dl class="pg-meta pg-meta-grid">'
          +'<div class="pg-meta-row"><dt class="k">Volume</dt><dd class="v mono">'+esc(vol)+'</dd></div>'
          +'<div class="pg-meta-row"><dt class="k">Size</dt><dd class="v">'+esc(size)+' · shared engine</dd></div>'
          +'<div class="pg-meta-row"><dt class="k">Image</dt><dd class="v mono">'+esc(img)+'</dd></div>'
          +'<div class="pg-meta-row"><dt class="k">Host</dt><dd class="v mono">'+esc(host)+'</dd></div>'
        +'</dl>'
      +'</section>';
  }


  function sqlOutHTML(res) {
    if (!res) return '';
    if (res.error || res.cancelled) {
      return '<div class="sql-err">'+esc(res.error || 'Cancelled')+'</div>';
    }
    if (res.message && !(res.columns && res.columns.length)) {
      return '<div class="sql-ok">'+esc(res.message)
        +(res.duration_ms != null ? ' · '+esc(String(res.duration_ms))+' ms' : '')
        +'</div>';
    }
    if (res.columns && res.columns.length) {
      return ''
        +'<div class="sql-meta">'+esc(String(res.row_count||0))+' row'
          +((res.row_count===1)?'':'s')
          +(res.truncated ? ' · truncated' : '')
          +(res.duration_ms != null ? ' · '+esc(String(res.duration_ms))+' ms' : '')
        +'</div>'
        +'<div class="sql-table-wrap"><table class="sql-table"><thead><tr>'
        + res.columns.map(function(c){ return '<th>'+esc(c)+'</th>'; }).join('')
        +'</tr></thead><tbody>'
        + (res.rows||[]).map(function(row){
            return '<tr>'+row.map(function(cell){ return '<td>'+esc(cell == null ? '' : String(cell))+'</td>'; }).join('')+'</tr>';
          }).join('')
        +'</tbody></table></div>';
    }
    return '';
  }

  function pgSQLHTML(svc) {
    var draft = sqlDraft[svc.slug] != null ? sqlDraft[svc.slug] : 'SELECT now();\n';
    var res = sqlResult[svc.slug];
    var busyQ = !!busy[sqlBusyKey(svc.slug)];
    var engineDown = !svc.running;
    var presets = [
      { id: 'now', label: 'Now' },
      { id: 'tables', label: 'Tables' },
      { id: 'size', label: 'Size' },
      { id: 'activity', label: 'Activity' },
      { id: 'indexes', label: 'Indexes' },
      { id: 'clear', label: 'Clear' }
    ];
    return ''
      +'<section class="drawer-section drawer-section-card sql-box'+(busyQ?' is-running':'')+'" id="sql-box-'+esc(svc.slug)+'" data-sql-slug="'+esc(svc.slug)+'" aria-labelledby="pg-query-'+esc(svc.slug)+'">'
        +'<header class="sql-head drawer-section-head">'
          +'<div class="drawer-section-head-main">'
            +'<h3 id="pg-query-'+esc(svc.slug)+'" class="drawer-section-title">Query console</h3>'
            +'<span class="ghost drawer-section-sub">psql · '+esc(svc.database || svc.slug)+'</span>'
          +'</div>'
        +'</header>'
        +'<textarea class="sql-input" id="sql-'+esc(svc.slug)+'" spellcheck="false" placeholder="SELECT * FROM …" aria-label="SQL query">'+esc(draft)+'</textarea>'
        +'<div class="sql-actions" data-stop="1">'
          +'<div class="sql-actions-primary">'
            +'<button type="button" class="btn primary drawer-tool-btn'+(busyQ?' loading':'')+'" data-action="sql:run:'+esc(svc.slug)+'" data-engine-down="'+(engineDown?'1':'0')+'" '+(busyQ||engineDown?'disabled':'')+(busyQ?' hidden':'')+'>'
              +'<span class="spinner"></span><span>Run</span></button>'
            +'<button type="button" class="btn btn-quiet drawer-tool-btn" data-action="sql:cancel:'+esc(svc.slug)+'"'+(busyQ?'':' hidden')+'>Cancel</button>'
            +(engineDown ? '<span class="ghost sql-engine-hint">Start engine to query</span>' : '')
          +'</div>'
          +'<div class="sql-presets sql-chips" role="group" aria-label="Quick queries">'
            + presets.map(function(p){
                return '<button type="button" class="sql-chip" data-action="sql:preset:'+esc(svc.slug)+':'+esc(p.id)+'"'+(busyQ?' disabled':'')+'>'+esc(p.label)+'</button>';
              }).join('')
          +'</div>'
        +'</div>'
        +'<div class="sql-out" id="sql-out-'+esc(svc.slug)+'">'+sqlOutHTML(res)+'</div>'
      +'</section>';
  }

  function pgEnvBoardHTML(svc, envText) {
    var map = dbEnvMapForService(svc, envText);
    var reveal = !!envReveal[svc.slug];
    var rows = DB_ENV_KEYS.map(function(k){
      var val = map[k] || '';
      if (!val && k !== 'DATABASE_URL') return '';
      var shown = reveal ? val : maskEnvValue(val);
      return ''
        +'<div class="env-row" role="row">'
          +'<div class="env-key" role="cell">'+esc(k)+'</div>'
          +'<div class="env-val'+(reveal?'':' masked')+'" role="cell" title="'+(reveal?esc(val):'')+'">'+esc(shown || '—')+'</div>'
          +'<div class="env-actions" data-stop="1" role="cell">'
            +'<button type="button" class="btn btn-quiet btn-compact btn-icon env-copy" data-action="copy:env-key:'+esc(svc.slug)+':'+esc(k)+'" aria-label="Copy '+esc(k)+'" title="Copy" '+(val?'':'disabled')+'>'+ico('copy')+'</button>'
          +'</div>'
        +'</div>';
    }).join('');
    if (!rows.trim()) {
      rows = '<div class="empty dock-empty compact"><p>Connection vars appear after the database is ready</p></div>';
    }
    return ''
      +'<section class="drawer-section drawer-section-card env-board" aria-labelledby="pg-env-'+esc(svc.slug)+'">'
        +'<header class="env-board-head drawer-section-head">'
          +'<div class="drawer-section-head-main">'
            +'<h3 id="pg-env-'+esc(svc.slug)+'" class="drawer-section-title">Environment</h3>'
            +'<span class="ghost drawer-section-sub">For Go apps · os.Getenv / JSON</span>'
          +'</div>'
          +'<div class="env-board-tools" data-stop="1">'
            +'<button type="button" class="btn btn-quiet btn-compact drawer-tool-btn" data-action="envreveal:'+esc(svc.slug)+'">'+(reveal?'Hide':'Show')+'</button>'
            +'<button type="button" class="btn btn-quiet btn-compact drawer-tool-btn" data-action="copy:env-json:'+esc(svc.slug)+'">JSON</button>'
            +'<button type="button" class="btn btn-quiet btn-compact drawer-tool-btn" data-action="copy:env-dotenv:'+esc(svc.slug)+'">KEY=value</button>'
          +'</div>'
        +'</header>'
        +'<div class="env-table" role="table" aria-label="Environment variables">'
          +'<div class="env-row env-head" role="row"><div role="columnheader">Key</div><div role="columnheader">Value</div><div role="columnheader"><span class="sr-only">Actions</span></div></div>'
          +rows
        +'</div>'
        +uiHint('Linked Go apps receive these automatically. Copy JSON for local config.')
      +'</section>';
  }

  function serviceSettingsHTML(svc, dbs) {
    var draft = settingsDraft[svc.slug] || {};
    var isPg = svc.type === 'postgres';
    var building = !isPg && (svc.status === 'building' || !!(svc.deployments || []).some(function(d){ return d.status === 'building' || d.status === 'queued'; }));
    var failed = !isPg && !building && (svc.status === 'failed' || !!svc.last_error);
    var isUp = !!svc.running && !failed && !building;
    var usageLabel = serviceUsageLabel(svc);
    var mode = envMode[svc.slug] || 'text';
    var nameVal = draft.name != null ? draft.name : (svc.name || '');
    var branchVal = draft.branch != null ? draft.branch : (svc.branch || 'main');
    var rootVal = draft.root_dir != null ? draft.root_dir : (svc.root_dir || '');
    var buildVal = draft.build_cmd != null ? draft.build_cmd : (svc.build_cmd || '');
    var autoDeploy = draft.auto_deploy != null ? !!draft.auto_deploy : !!svc.auto_deploy;
    var memVal = draft.memory_mb != null ? draft.memory_mb : (svc.memory_mb || 512);
    var cpuVal = draft.cpus != null ? draft.cpus : (svc.cpus || 1);
    var linkVal = (draft.linked_database != null && String(draft.linked_database) !== '')
      ? draft.linked_database
      : (svc.linked_database || '');
    var envVal = (draft.env != null && String(draft.env).trim() !== '')
      ? draft.env
      : '';
    var linkedName = '';
    if (linkVal) {
      var linked = (dbs || []).filter(function(d){ return d.slug === linkVal; })[0];
      linkedName = linked ? (linked.name || linked.slug) : linkVal;
    }
    var scope = svc.slug;
    var customEnvVal = linkVal ? splitCustomEnv(envVal) : envVal;
    if (isPg) {
      return ''
        +'<div class="settings settings-drawer settings-pg">'
          +pgVolumeHTML(svc)
          +pgEnvBoardHTML(svc, envVal)
          +pgSQLHTML(svc)
          +'<section class="drawer-section drawer-section-card drawer-section-compact" aria-labelledby="pg-name-'+esc(svc.slug)+'">'
            +'<header class="drawer-section-head">'
              +'<h3 id="pg-name-'+esc(svc.slug)+'" class="drawer-section-title">Display name</h3>'
            +'</header>'
            +uiField({
              label: 'Display name',
              meta: 'label',
              control: uiInput({ name: 'name', value: nameVal })
            })
          +'</section>'
          +uiFooter({
            left: '<span class="ghost">Delete drops this database · volume kept</span>',
            right: '<button type="button" class="btn danger" data-action="svc:delete:'+esc(svc.slug)+'">Delete</button>'
              +'<button type="button" class="btn primary" data-action="svc:save:'+svc.slug+'">Save</button>'
          })
        +'</div>';
    }
    var linkLabel = linkedName || 'None';
    var generalSummary = (branchVal || 'main') + (rootVal ? ' · ' + String(rootVal).slice(0,12) : '');
    var linkedMap = linkVal ? linkedEnvMapFromSources(null, envVal) : {};
    var linkedReady = linkVal && RESERVED_DB_KEYS.some(function(k){ return linkedMap[k]; });
    var dbPicker = dbs.length
      ? cselectHTML('link', linkVal, 'No database', [{value:'',label:'No database'}].concat(dbs.map(function(d){ return {value:d.slug,label:d.name||d.slug,meta:'Postgres'}; })), false, {searchable: (dbs||[]).length > 4, searchPlaceholder:'Filter…'})
      : uiEmpty({ mini: true, body: 'No database in this group yet.' });
    var linkedBlock = !linkVal ? '' : (linkedReady
      ? wizAutoDBEnvHTML(linkLabel, linkedMap, [], { reveal: !!envReveal[svc.slug + ':env'], revealAction: 'envreveal:' + svc.slug + ':env' })
      : '<div class="wiz-auto-env wiz-auto-pending"><div class="wiz-auto-head"><span>From '+esc(linkLabel)+'</span><span class="ghost">linking…</span></div><div class="ghost" style="font-size:11px">DB_* + DATABASE_URL appear after save/deploy</div></div>');
    var envMergedBody = ''
      +'<div class="env-merge">'
        +'<div class="env-merge-block">'
          +'<div class="env-merge-label">Database</div>'
          +dbPicker
        +'</div>'
        +linkedBlock
        +'<div class="env-merge-block">'
          +'<div class="wiz-custom-head">'
            +'<span>'+(linkVal ? 'Your variables' : 'Variables')+'</span>'
            +'<div class="seg mini">'
              +'<button type="button" data-action="envmode:'+esc(svc.slug)+':text" class="'+(mode!=='json'?'active':'')+'">KEY=value</button>'
              +'<button type="button" data-action="envmode:'+esc(svc.slug)+':json" class="'+(mode==='json'?'active':'')+'">JSON</button>'
            +'</div>'
          +'</div>'
          +'<textarea class="env" name="env" placeholder="'+(mode==='json'?'{\n  \"PORT\": \"5100\"\n}':'KEY=value')+'">'+esc(customEnvVal)+'</textarea>'
        +'</div>'
      +'</div>';
    var envSummaryText = (linkVal ? (linkedName || linkVal) : 'No database')
      + ' · ' + envSummary(linkVal ? customEnvVal : envVal);
    return ''
      +'<div class="settings settings-drawer">'
        +'<div class="folds folds-drawer folds-compact">'
          +foldHTML(scope+':access', 'Access', accessSummary(svc), accessFoldBody(svc))
          +foldHTML(scope+':deploys', 'Deployments', deploymentsSummary(svc), deploymentsFoldBody(svc))
          +foldHTML(scope+':general', 'Service', generalSummary + (buildVal ? ' · build' : ''), ''
            +'<div class="fields fields-compact">'
              +uiField({
                label: 'Display name',
                meta: 'label',
                control: uiInput({ name: 'name', value: nameVal })
              })
              +uiField({
                label: 'Branch',
                meta: 'git',
                control: uiInput({ name: 'branch', value: branchVal })
              })
            +'</div>'
            +uiField({
              label: 'Root directory',
              meta: 'monorepo',
              control: uiInput({ name: 'root_dir', value: rootVal, placeholder: 'backend' })
            })
            +uiField({
              label: 'Build command',
              meta: 'optional',
              control: uiInput({ name: 'build_cmd', value: buildVal, placeholder: 'go build -o /out/app .' })
            })
            +'<label class="ui-check" style="display:flex;gap:8px;align-items:flex-start;margin-top:10px">'
              +'<input type="checkbox" name="auto_deploy" '+(autoDeploy?'checked ':'')+'/>'
              +'<span><strong>Auto-deploy</strong><span class="ghost" style="display:block;font-size:11px;margin-top:2px">Redeploy when this branch gets a new commit on GitHub</span></span>'
            +'</label>'
          )
          +foldHTML(scope+':env', 'Environment', envSummaryText, envMergedBody)
          +foldHTML(scope+':resources', 'Resources', (function(){
              var live = serviceUsageLabel(svc);
              var base = memVal + ' MB · ' + cpuVal + ' CPU';
              return live ? (live + ' now · limit ' + base) : base;
            })(), ''
            +resourceControlsHTML({memory_mb: memVal, cpus: cpuVal, excludeSlug: svc.slug})
            +(usageLabel ? '<div class="svc-usage-panel">'+serviceUsagePanelHTML(svc)+'<span class="svc-live-note ghost">Live vs limits</span></div>' : '')
          )
        +'</div>'
        +'</div>'
        +'<div class="svc-settings-foot" data-stop="1">'
          +'<div class="svc-settings-actions">'
            +(building
              ? '<button type="button" class="btn" disabled><span class="spinner"></span><span>Building…</span></button>'
              : (
                  btn('Save & restart', 'svc:save:'+svc.slug, 'primary', false)
                  + btn('Redeploy', 'svc:redeploy:'+svc.slug, 'btn-secondary', !!busy.deploy)
                  + (failed
                      ? btn('Start', 'svc:start:'+svc.slug, 'btn-secondary', !!(busy['svc:start:'+svc.slug]))
                      : btn(isUp ? 'Stop' : 'Start', isUp ? 'svc:stop:'+svc.slug : 'svc:start:'+svc.slug, isUp ? 'btn-stop' : 'btn-secondary', !!(busy['svc:start:'+svc.slug]||busy['svc:stop:'+svc.slug]))
                    )
                ))
            +'<button type="button" class="btn btn-danger-ghost" data-action="svc:delete:'+esc(svc.slug)+'" title="'+(building?'Stop build and remove':'Delete')+'">Delete</button>'
          +'</div>'
          +'<p class="svc-settings-hint">'
            +(building
              ? 'Watch Activity for clone · build · start'
              : (failed ? 'Fix the error, then Redeploy' : 'Save applies config · Redeploy rebuilds · Auto-deploy watches GitHub'))
          +'</p>'
        +'</div>'
      +'</div>';
  }

  function serviceDrawerHTML(svc, dbs) {
    var kind = svcKindMeta(svc);
    var isPg = svc.type === 'postgres';
    var building = !isPg && (svc.status === 'building' || !!(svc.deployments || []).some(function(d){ return d.status === 'building' || d.status === 'queued'; }));
    var failed = !isPg && !building && (svc.status === 'failed' || !!svc.last_error);
    var isUp = !!svc.running && !failed && !building;
    var st = statusMeta(svc, building, failed, isUp);
    var banner = '';
    if (!isPg && failed && svc.last_error) {
      banner = ''
        +'<div class="svc-banner fail" data-stop="1">'
          +'<div class="svc-banner-text">'+esc(String(svc.last_error).slice(0,200))+'</div>'
          +'<button type="button" class="btn btn-quiet btn-compact" data-action="svc:logs:'+esc(svc.slug)+'">Logs</button>'
        +'</div>';
    } else if (!isPg && building) {
      banner = ''
        +'<div class="svc-banner build" data-stop="1">'
          +'<div class="svc-build-track"><span class="svc-build-fill"></span></div>'
          +'<div class="svc-banner-text">Deploying — files appear in Activity as clone · build · start run</div>'
        +'</div>';
    }
    return ''
      +'<aside class="svc-drawer" role="dialog" aria-modal="true" aria-labelledby="svc-drawer-title-'+esc(svc.slug)+'" data-slug="'+esc(svc.slug)+'">'
        +'<header class="svc-drawer-head">'
          +'<span class="svc-drawer-icon kind-'+kind.kind+'" aria-hidden="true">'+ico(kind.ico)+'</span>'
          +'<div class="svc-drawer-titles">'
            +'<h2 id="svc-drawer-title-'+esc(svc.slug)+'" class="svc-drawer-name">'+esc(svc.name || svc.slug)+'</h2>'
            +'<div class="svc-drawer-status">'
              +'<span class="svc-status-dot '+st.cls+'" aria-hidden="true"></span>'
              +'<span class="svc-status-label">'+esc(st.label)+'</span>'
            +'</div>'
          +'</div>'
          +'<button type="button" class="btn btn-quiet btn-icon svc-drawer-close" data-action="svc:settings:close" aria-label="Close settings">'+ico('close')+'</button>'
        +'</header>'
        +'<div class="svc-drawer-toolbar" data-stop="1" role="toolbar" aria-label="Service actions">'+drawerToolbarHTML(svc)+'</div>'
        +banner
        +'<div class="svc-drawer-body">'+serviceSettingsHTML(svc, dbs)+'</div>'
      +'</aside>';
  }
  function serviceCard(svc, dbs) {
    var selected = settingsSlug === svc.slug;
    var draft = settingsDraft[svc.slug] || {};
    var isPg = svc.type === 'postgres';
    var building = !isPg && (svc.status === 'building' || !!(svc.deployments || []).some(function(d){ return d.status === 'building' || d.status === 'queued'; }));
    var failed = !isPg && !building && (svc.status === 'failed' || !!svc.last_error);
    var isUp = !!svc.running && !failed && !building;
    var diskLabel = svc.disk_bytes ? fmtBytes(svc.disk_bytes) : '';
    var kind = svcKindMeta(svc);
    var st = statusMeta(svc, building, failed, isUp);
    var metaBits = [];
    if (isPg) {
      if (svc.database) metaBits.push(svc.database);
      if (svc.volume_size) metaBits.push(svc.volume_size);
      else if (diskLabel) metaBits.push(diskLabel);
    } else {
      if (svc.repo) metaBits.push(svc.repo.split('/').pop() || svc.repo);
      if (svc.port) metaBits.push(':' + svc.port);
      if (publicURL(svc)) metaBits.push('public');
      else if (diskLabel) metaBits.push(diskLabel);
    }
    var sub = metaBits.join(' · ');
    var linkVal = (draft.linked_database != null && String(draft.linked_database) !== '')
      ? draft.linked_database
      : (svc.linked_database || '');
    var powerBusy = !!(busy['svc:start:'+svc.slug] || busy['svc:stop:'+svc.slug] || building);
    var pgPowerBusy = !!(busy['svc:start:'+svc.slug] || busy['svc:stop:'+svc.slug] || busy['svc:restart:'+svc.slug]);
    var quickActs = '';
    if (!selected) {
      if (isPg) {
        if (isUp) {
          quickActs = ''
            +actionBtn({ label: 'Restart', action: 'svc:restart:'+svc.slug, icon: 'refresh', busy: pgPowerBusy, title: 'Restart shared engine' })
            +actionBtn({ label: 'Stop', action: 'svc:stop:'+svc.slug, icon: 'stop', cls: 'danger-soft', busy: pgPowerBusy, title: 'Stop shared engine' });
        } else {
          quickActs = actionBtn({ label: 'Start', action: 'svc:start:'+svc.slug, icon: 'play', cls: 'primary', busy: pgPowerBusy, title: 'Start shared engine' });
        }
      } else if (building) {
        quickActs = '<span class="svc-building-pill">'+ico('refresh', 'spin')+' Building</span>';
      } else if (failed) {
        quickActs = ''
          +actionBtn({ label: 'Logs', action: 'svc:logs:'+svc.slug, icon: 'logs' })
          +actionBtn({ label: 'Redeploy', action: 'svc:redeploy:'+svc.slug, icon: 'refresh', cls: 'primary', busy: !!busy.deploy });
      } else if (isUp) {
        quickActs = ''
          +actionBtn({ label: 'Logs', action: 'svc:logs:'+svc.slug, icon: 'logs' })
          +actionBtn({ label: 'Stop', action: 'svc:stop:'+svc.slug, icon: 'stop', cls: 'danger-soft', busy: powerBusy });
      } else {
        quickActs = ''
          +actionBtn({ label: 'Logs', action: 'svc:logs:'+svc.slug, icon: 'logs' })
          +actionBtn({ label: 'Start', action: 'svc:start:'+svc.slug, icon: 'play', cls: 'primary', busy: powerBusy });
      }
    }
    var banner = '';
    if (!selected && !isPg && failed && svc.last_error) {
      banner = ''
        +'<div class="svc-banner fail" data-stop="1">'
          +'<div class="svc-banner-text">'+esc(String(svc.last_error).slice(0,120))+'</div>'
          +'<button type="button" class="btn btn-quiet btn-compact" data-action="svc:logs:'+esc(svc.slug)+'">Logs</button>'
        +'</div>';
    } else if (!selected && !isPg && building) {
      banner = ''
        +'<div class="svc-banner build" data-stop="1">'
          +'<div class="svc-build-track"><span class="svc-build-fill"></span></div>'
          +'<div class="svc-banner-text">Deploying…</div>'
        +'</div>';
    }
    var accessIcon = '';
    if (!selected && !failed && !building) {
      var primary = publicURL(svc) || accessURL(svc);
      if (primary && !isPg) {
        accessIcon = ''
          +'<a class="svc-node-link" href="'+esc(primary)+'" target="_blank" rel="noopener" data-stop="1" title="Open '+esc(primary)+'">'
            +ico('open')
          +'</a>';
      }
    }
    return ''
      +'<div class="svc-card svc-widget svc-node kind-'+kind.kind+(selected?' selected':'')+(building?' building':'')+(failed?' failed':'')+(isUp?' is-up':'')+'" data-slug="'+esc(svc.slug)+'" data-kind="'+kind.kind+'"'+(linkVal?' data-linked="'+esc(linkVal)+'"':'')+'>'
        +'<div class="svc-widget-face svc-row clickable" data-action="svc:settings:'+esc(svc.slug)+'" role="button" tabindex="0" aria-expanded="'+(selected?'true':'false')+'" aria-haspopup="dialog" title="Configure">'
          +'<div class="svc-widget-hover" data-stop="1">'+quickActs+'</div>'
          +accessIcon
          +'<div class="svc-widget-head">'
            +'<span class="svc-widget-icon kind-'+kind.kind+'" aria-hidden="true">'+ico(kind.ico)+'</span>'
            +'<div class="svc-widget-titles">'
              +'<div class="svc-title">'+esc(svc.name || svc.slug)+'</div>'
              +(sub ? '<div class="svc-sub">'+esc(sub)+'</div>' : '<div class="svc-sub ghost">&nbsp;</div>')
            +'</div>'
          +'</div>'
          +'<div class="svc-widget-status">'
            +'<span class="svc-status-dot '+st.cls+'" aria-hidden="true"></span>'
            +'<span class="svc-status-label">'+esc(st.label)+'</span>'
          +'</div>'
          +'<div class="svc-widget-divider" aria-hidden="true"></div>'
          +'<div class="svc-widget-meters">'+serviceUsageHTML(svc)+'</div>'
        +'</div>'
        +banner
      +'</div>';
  }

  /* === 06b-docker.js === */
  function refreshEngine() {
    return api('/api/engine').then(function(v){
      engineView = v;
      return v;
    }).catch(function(e){
      engineView = engineView || null;
      throw e;
    });
  }

  function runtimeOptions(list) {
    return (list || []).map(function(o){
      var meta = o.hint || o.image || '';
      if (o.current) meta = meta ? ('Current · ' + meta) : 'Current';
      return {
        value: o.id,
        label: o.label,
        meta: meta
      };
    });
  }

  function isPostgresEngineContainer(c) {
    if (!c) return false;
    var name = String(c.name || '').toLowerCase();
    var image = String(c.image || '').toLowerCase();
    if (name === 'firewifi-postgres' || name.indexOf('firewifi-postgres') === 0) return true;
    if (c.group === 'infra' && /postgres/.test(name + ' ' + image)) return true;
    // Shared engine: postgres image on local 5432 stack, not an app DB service container
    if (/^postgres(:|$)/.test(image) && (name === 'postgres' || name.indexOf('postgres') >= 0) && !c.service) {
      if (!c.group || c.group === 'infra') return true;
    }
    return false;
  }

  function manageSeg() {
    var tabs = [
      { id: 'services', label: 'Services' },
      { id: 'storage', label: 'Storage' }
    ];
    return ''
      +'<div class="ws-tabs" role="tablist" aria-label="Workspace">'
        + tabs.map(function(t){
            return '<button type="button" role="tab" class="'+(manageTab===t.id?'active':'')+'" data-action="manage:tab:'+t.id+'" aria-selected="'+(manageTab===t.id?'true':'false')+'">'+esc(t.label)+'</button>';
          }).join('')
      +'</div>';
  }

  function manageToolbar(title) {
    return ''
      +'<header class="ws-head">'
        +'<div class="ws-head-main">'
          +'<div class="ws-title-block">'
            +'<h2>'+esc(title)+'</h2>'
            +(manageLoading ? '<span class="ghost pulse-text">Refreshing…</span>' : '')
          +'</div>'
          +manageSeg()
        +'</div>'
        +'<div class="ws-head-actions">'
          +btn('Refresh', 'docker:refresh', 'btn-quiet btn-compact', manageLoading || busy['docker:refresh'])
        +'</div>'
      +'</header>';
  }

  function dockerDiskRow(type) {
    var disk = (manageOv && manageOv.docker && manageOv.docker.disk) || (dockerInv && dockerInv.disk) || [];
    for (var i = 0; i < disk.length; i++) {
      if (disk[i].type === type) return disk[i];
    }
    return null;
  }

  function onSettingsStoragePage() {
    return navView === 'settings' && settingsTab === 'storage' && !activeGroup;
  }

  function refreshManage(opts) {
    opts = opts || {};
    manageLoading = true;
    manageError = null;
    if (onSettingsStoragePage()) renderServices({ soft: !opts.animate, force: true });
    return Promise.all([
      api('/api/manage'),
      refreshEngine().catch(function(){ return null; })
    ]).then(function(pair){
      manageOv = pair[0];
      dockerInv = (pair[0] && pair[0].docker) || dockerInv;
      manageLoading = false;
      manageError = null;
      if (onSettingsStoragePage()) renderServices({ soft: true, force: true });
      return pair[0];
    }).catch(function(e){
      manageLoading = false;
      manageError = (e && e.message) || 'Could not load storage';
      if (onSettingsStoragePage()) renderServices({ soft: true, force: true });
      showToast(manageError);
      throw e;
    });
  }

  function refreshDocker(opts) { return refreshManage(opts); }

  function dockerAction(body, busyKey, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return Promise.resolve();
    busy[busyKey] = true;
    if (onSettingsStoragePage()) renderServices({ soft: true });
    return api('/api/docker', { method: 'POST', body: JSON.stringify(body) })
      .then(function(res){
        showToast((res && res.message) || 'Done');
        return refreshManage();
      })
      .catch(function(e){ showToast(e.message || 'Failed'); })
      .finally(function(){
        delete busy[busyKey];
        if (onSettingsStoragePage()) renderServices({ soft: true });
      });
  }

  function engineStatusLabel(ev) {
    if (!ev) return { text: 'Unknown', cls: 'off' };
    if (ev.postgres_running) return { text: 'Running', cls: 'on' };
    // Infer restarting/stopped from containers when engine reports down
    var ctrs = ((manageOv && manageOv.docker) || dockerInv || {}).containers || [];
    for (var i = 0; i < ctrs.length; i++) {
      var c = ctrs[i];
      if (!c || !/postgres|firewifi-postgres/i.test(c.name + ' ' + (c.image || ''))) continue;
      var st = String(c.state || '').toLowerCase();
      if (st === 'restarting') return { text: 'Restarting', cls: 'warn' };
      if (st === 'running') return { text: 'Running', cls: 'on' };
      return { text: 'Stopped', cls: 'off' };
    }
    return { text: 'Stopped', cls: 'off' };
  }

  function containerStatus(c) {
    var st = String((c && c.state) || '').toLowerCase();
    if (st === 'running' || c.running) return { text: 'Running', cls: 'on' };
    if (st === 'restarting') return { text: 'Restarting', cls: 'warn' };
    if (st === 'paused') return { text: 'Paused', cls: 'warn' };
    if (st === 'created') return { text: 'Created', cls: 'off' };
    if (st === 'exited' || st === 'dead' || st === 'removing') return { text: 'Stopped', cls: 'off' };
    return { text: c.status || c.state || 'Stopped', cls: 'off' };
  }

  function engineCard() {
    var ev = engineView || { settings: {}, postgres_options: [], go_options: [] };
    var s = ev.settings || {};
    var pg = (engineDraft && engineDraft.postgres_version) || s.postgres_version || '16';
    var go = (engineDraft && engineDraft.go_toolchain) || s.go_toolchain || 'auto';
    var st = engineStatusLabel(ev);
    var busyStart = !!busy['engine:start'];
    var busyStop = !!busy['engine:stop'];
    var busySave = !!busy['engine:save'];
    var busyEng = busyStart || busyStop || busySave;
    var on = !!ev.postgres_running || st.cls === 'on' || st.cls === 'warn';
    var powerLabel = busyStart ? 'Starting…' : (busyStop ? 'Stopping…' : (on ? 'Stop' : 'Start'));
    var powerAction = on ? 'engine:stop' : 'engine:start';
    var powerCls = on ? 'btn-quiet btn-compact' : 'primary btn-compact';
    return ''
      +'<div class="manage-block engine-card">'
        +'<div class="manage-block-head">'
          +'<div class="engine-title">'
            +'<span class="dock-state '+st.cls+'"></span>'
            +'<strong>Postgres engine</strong>'
            +'<span class="dock-badge '+st.cls+'">'+esc(st.text)+'</span>'
          +'</div>'
          +'<div class="engine-power" data-stop="1">'
            +btn(powerLabel, powerAction, powerCls, busyEng)
          +'</div>'
        +'</div>'
        +'<p class="engine-meta mono">Shared database host · '+esc(ev.postgres_image || 'postgres')+' · 127.0.0.1:5432</p>'
        +'<div class="runtime-grid">'
          +'<label class="runtime-field"><span>Postgres version</span>'
            +cselectHTML('engine-pg', pg, 'Version…', runtimeOptions(ev.postgres_options), busyEng, {searchable:false})
          +'</label>'
          +'<label class="runtime-field"><span>Go builds</span>'
            +cselectHTML('engine-go', go, 'Toolchain…', runtimeOptions(ev.go_options), busyEng, {searchable:false})
          +'</label>'
        +'</div>'
        +'<div class="manage-row-actions end">'
          +btn(busySave ? 'Applying…' : 'Apply', 'engine:save', 'btn-compact', busyEng)
        +'</div>'
      +'</div>';
  }

  function storagePanelBody(s) {
    var ov = manageOv || {};
    var inv = ov.docker || dockerInv || { images: [], containers: [], volumes: [], disk: [], reclaim_bytes: 0 };
    var imgs = inv.images || [];
    var allCtrs = inv.containers || [];
    var ctrs = allCtrs.filter(function(c){ return !isPostgresEngineContainer(c); }).slice().sort(function(a, b){
      var ar = a.running || String(a.state||'').toLowerCase()==='restarting' ? 1 : 0;
      var br = b.running || String(b.state||'').toLowerCase()==='restarting' ? 1 : 0;
      if (ar !== br) return br - ar;
      return String(a.name||'').localeCompare(String(b.name||''));
    });
    var vols = inv.volumes || [];
    var host = (s.device_metrics && s.device_metrics.storage) || {};
    var running = ctrs.filter(function(c){ return c.running; }).length;
    var restarting = ctrs.filter(function(c){ return String(c.state||'').toLowerCase()==='restarting'; }).length;
    var stopped = ctrs.length - running - restarting;
    if (stopped < 0) stopped = 0;
    var unusedImgs = imgs.filter(function(i){ return !i.in_use; }).length;
    var volBytes = vols.reduce(function(n, v){ return n + (v.size_bytes || 0); }, 0);
    var unusedVols = vols.filter(function(v){ return !v.in_use; }).length;
    var opt = dockerOpts || {};
    var pct = Math.min(100, Math.round(host.used_percent || 0));
    var ctrMeta = running + ' running'
      + (restarting ? ' · ' + restarting + ' restarting' : '')
      + (stopped ? ' · ' + stopped + ' stopped' : '');
    var volMeta = (volBytes ? fmtBytes(volBytes) : '—')
      + (unusedVols ? ' · ' + unusedVols + ' unused' : '');

    var loading = manageLoading && !manageOv && !manageError
      ? '<div class="empty empty-loading compact storage-state"><div class="nav-spinner" aria-hidden="true"></div><h3>Scanning…</h3><p class="ghost">Docker inventory and engine</p></div>'
      : '';
    var errBlock = manageError && !manageLoading
      ? '<div class="empty storage-state storage-error compact"><h3>Scan failed</h3><p>'+esc(manageError)+'</p><div class="inline-actions">'+btn('Retry', 'docker:refresh', 'btn-compact primary', busy['docker:refresh'])+'</div></div>'
      : '';
    var dockerWarn = (!manageError && ov.docker_error)
      ? '<div class="storage-state storage-warn compact"><p class="ghost">Docker inventory unavailable: '+esc(ov.docker_error)+'</p></div>'
      : '';

    var strip = ''
      +'<div class="stat-strip storage-strip">'
        +statCell('Disk', fmtBytes(host.used_bytes || 0), pct + '% of ' + fmtBytes(host.total_bytes || 0), pct)
        +statCell('Apps', fmtBytes(ov.group_bytes || 0), 'deploys')
        +statCell('Volumes', volBytes ? fmtBytes(volBytes) : (vols.length ? '0 B' : '—'), vols.length + ' named')
        +statCell('Freeable', fmtBytes(inv.reclaim_bytes || 0), unusedImgs ? unusedImgs + ' unused img' : 'docker', inv.reclaim_bytes ? 'warn' : '')
      +'</div>';

    var prune = ''
      +'<details class="manage-fold"'+( (opt._open) ? ' open' : '' )+'>'
        +'<summary><strong>Clean up</strong><span class="ghost">unused images · stopped · cache</span></summary>'
        +'<div class="manage-fold-body">'
          +'<div class="dock-checks compact">'
            +dockCheck('images', 'Unused images', !!opt.images)
            +dockCheck('all_unused', 'Tagged unused', !!opt.all_unused)
            +dockCheck('containers', 'Stopped containers', !!opt.containers)
            +dockCheck('volumes', 'Unused volumes', !!opt.volumes)
            +dockCheck('build_cache', 'Build cache', !!opt.build_cache)
          +'</div>'
          +'<div class="manage-row-actions end">'
            +btn('Stop managed', 'docker:stop-all', 'danger btn-quiet btn-compact', manageLoading || busy['docker:stop-all'])
            +btn('Clean', 'docker:prune', 'primary btn-compact', manageLoading || busy['docker:prune'])
          +'</div>'
        +'</div>'
      +'</details>';

    return errBlock || loading || (
      '<div class="storage-flow">'
        +dockerWarn
        +engineCard()
        +strip
        +manageSection('Volumes', vols.length, volMeta, vols.length ? vols.map(dockVolumeRow).join('') : manageEmpty('No volumes'))
        +prune
        +manageSection('Containers', ctrs.length, ctrMeta || 'app containers', ctrs.length ? ctrs.map(dockContainerRow).join('') : manageEmpty('No app containers'))
      +'</div>'
    );
  }

  function storageView(s) { return storagePanelBody(s); }

  function statCell(k, v, d, barPct, cls) {
    return ''
      +'<div class="stat-cell '+(cls||'')+'">'
        +'<div class="k">'+esc(k)+'</div>'
        +'<div class="v">'+esc(v)+'</div>'
        +(d ? '<div class="d">'+esc(d)+'</div>' : '')
        +(barPct != null ? '<div class="manage-bar tight"><span style="width:'+esc(String(barPct))+'%"></span></div>' : '')
      +'</div>';
  }

  function manageSection(title, count, meta, body) {
    return ''
      +'<div class="dock-section">'
        +'<div class="dock-section-head">'
          +'<strong>'+esc(title)+'</strong>'
          +'<span class="ghost">'+(meta ? esc(meta) : esc(String(count)))+'</span>'
        +'</div>'
        +'<div class="dock-list">'+body+'</div>'
      +'</div>';
  }

  function manageEmpty(text) {
    return '<div class="empty dock-empty compact"><p>'+esc(text)+'</p></div>';
  }

  function dockCheck(key, label, on) {
    return ''
      +'<label class="dock-check">'
        +'<input type="checkbox" data-dock-opt="'+esc(key)+'" '+(on?'checked':'')+'>'
        +'<span>'+esc(label)+'</span>'
      +'</label>';
  }

  function dockContainerRow(c) {
    var st = containerStatus(c);
    var actions = '';
    if (isPostgresEngineContainer(c)) {
      actions = '<span class="ghost">Managed by engine</span>';
    } else {
      if (c.running || String(c.state||'').toLowerCase() === 'restarting') {
        actions += btn('Stop', 'docker:stop:'+c.name, 'btn-quiet btn-compact', !!busy['docker:stop:'+c.name]);
      } else {
        actions += btn('Start', 'docker:start:'+c.name, 'primary btn-quiet btn-compact', !!busy['docker:start:'+c.name]);
      }
      actions += btn('Remove', 'docker:rm-ctr:'+c.name, 'danger btn-quiet btn-compact', !!busy['docker:rm-ctr:'+c.name]);
    }
    var size = (c.size || '—').split(' (')[0];
    return ''
      +'<div class="dock-row">'
        +'<div class="dock-main">'
          +'<div class="dock-title"><span class="dock-state '+st.cls+'"></span>'+esc(c.name)
            +'<span class="dock-badge '+st.cls+'">'+esc(st.text)+'</span>'
            +(c.managed ? '<span class="dock-badge muted">managed</span>' : '')
            +(c.group ? '<span class="dock-badge muted">'+esc(c.group)+(c.service?('/'+c.service):'')+'</span>' : '')
          +'</div>'
          +'<div class="dock-sub">'+esc(c.image)+' · '+esc(c.status || c.state || '')+'</div>'
        +'</div>'
        +'<div class="dock-meta"><span class="dock-size">'+esc(size)+'</span></div>'
        +'<div class="dock-actions" data-stop="1">'+actions+'</div>'
      +'</div>';
  }

  function dockImageRow(img) {
    var tag = img.in_use
      ? '<span class="dock-badge ok">in use</span>'
      : '<span class="dock-badge warn">unused</span>';
    var actions = img.in_use
      ? '<span class="ghost">—</span>'
      : btn('Remove', 'docker:rm-img:'+img.id, 'danger btn-quiet btn-compact', !!busy['docker:rm-img:'+img.id]);
    return ''
      +'<div class="dock-row">'
        +'<div class="dock-main">'
          +'<div class="dock-title">'+esc(img.ref)+tag+'</div>'
          +'<div class="dock-sub">'+esc(img.id.slice(0,12))+' · '+esc(img.created_since || '')+'</div>'
        +'</div>'
        +'<div class="dock-meta"><span class="dock-size">'+esc(img.size)+'</span></div>'
        +'<div class="dock-actions" data-stop="1">'+actions+'</div>'
      +'</div>';
  }

  function dockVolumeRow(v) {
    var tag = v.in_use
      ? '<span class="dock-badge ok">in use</span>'
      : '<span class="dock-badge warn">unused</span>';
    var actions = v.in_use
      ? '<span class="ghost">—</span>'
      : btn('Remove', 'docker:rm-vol:'+v.name, 'danger btn-quiet btn-compact', !!busy['docker:rm-vol:'+v.name]);
    var sizeLabel = v.size_bytes > 0 ? (v.size || fmtBytes(v.size_bytes)) : (v.size && v.size !== '0B' ? v.size : 'empty');
    return ''
      +'<div class="dock-row">'
        +'<div class="dock-main">'
          +'<div class="dock-title">'+esc(v.name)+tag+'</div>'
          +'<div class="dock-sub">'+esc(v.driver || 'local')+(v.mountpoint ? ' · '+esc(v.mountpoint) : '')+'</div>'
        +'</div>'
        +'<div class="dock-meta"><span class="dock-size">'+esc(sizeLabel)+'</span></div>'
        +'<div class="dock-actions" data-stop="1">'+actions+'</div>'
      +'</div>';
  }

  function dockerView(s) { return storageView(s); }

  /* === 07-wizard.js === */
  /** Shared modal chrome for Add Go / Add Postgres (and type picker). */
  function wizardShell(opts) {
    opts = opts || {};
    var back = opts.backAction || 'wizard:open';
    var cancel = opts.cancelAction || 'wizard:close';
    var submit = opts.submitAction || '';
    var submitLabel = opts.submitLabel || 'Create';
    var busyOn = !!opts.busy;
    var submitEnabled = opts.submitEnabled !== false;
    var actions = uiActions(
      '<button type="button" class="btn btn-quiet" data-action="'+esc(back)+'">Back</button>'
      +'<button type="button" class="btn" data-action="'+esc(cancel)+'">Cancel</button>'
      +(submit
        ? '<button type="button" class="btn primary '+(busyOn?'loading':'')+'" data-action="'+esc(submit)+'" '+((submitEnabled && !busyOn)?'':'disabled')+'><span class="spinner"></span><span>'+esc(submitLabel)+'</span></button>'
        : '')
    );
    return ''
      +uiHead({
        title: opts.title || 'Add service',
        subHtml: opts.subHtml || ('In <strong>'+esc(activeGroup || '')+'</strong>'),
        actions: actions
      })
      +(opts.body || '');
  }

  function wizardHTML() {
    if (!wizard) return '';
    var step = wizard.step || 'type';
    var body = '';
    if (step === 'github') {
      body = ''
        +uiHead({ title: 'Connect GitHub', sub: 'PAT with repo read — stored on this Pi only.' })
        +uiField({
          label: 'Personal access token',
          meta: 'github_pat_…',
          control: uiInput({ id: 'wiz-token', type: 'password', placeholder: 'github_pat_… or ghp_…', value: wizard.token || '' })
        })
        +uiActions(
          '<button type="button" class="btn" data-action="wizard:close">Cancel</button>'
          +'<button type="button" class="btn primary '+(busy['wizard:github-save']?'loading':'')+'" data-action="wizard:github-save" '+(busy['wizard:github-save']?'disabled':'')+'><span class="spinner"></span><span>Connect</span></button>'
        );
    } else if (step === 'group') {
      body = ''
        +uiHead({ title: 'New group', sub: 'Boundary for databases and Go apps.' })
        +uiField({
          label: 'Name',
          meta: 'slug',
          control: uiInput({ id: 'wiz-group-name', placeholder: 'my-api', value: wizard.name || '', autofocus: true })
        })
        +uiActions(
          '<button type="button" class="btn" data-action="wizard:close">Cancel</button>'
          +'<button type="button" class="btn primary '+(busy['wizard:group-create']?'loading':'')+'" data-action="wizard:group-create" '+(busy['wizard:group-create']?'disabled':'')+'><span class="spinner"></span><span>Create</span></button>'
        );
    } else if (step === 'type') {
      body = ''
        +uiHead({
          title: 'Add service',
          subHtml: 'In <strong>'+esc(activeGroup || '')+'</strong>',
          actions: '<button type="button" class="btn btn-quiet" data-action="wizard:close">Close</button>'
        })
        +'<div class="type-pick type-pick-clean">'
          +'<button type="button" class="type-opt" data-action="wizard:type:go">'
            +'<span class="type-icon go">Go</span>'
            +'<span class="type-copy"><strong>Go app</strong><span>Clone from GitHub, build, and run on this Pi</span></span>'
            +'<span class="type-chev" aria-hidden="true"></span>'
          +'</button>'
          +'<button type="button" class="type-opt" data-action="wizard:type:postgres">'
            +'<span class="type-icon pg">DB</span>'
            +'<span class="type-copy"><strong>Postgres</strong><span>Shared database — apps get DB_* + DATABASE_URL</span></span>'
            +'<span class="type-chev" aria-hidden="true"></span>'
          +'</button>'
        +'</div>';
    } else if (step === 'go') {
      var repoOptions = (repos || []).map(function(r){
        return {
          value: r.full_name,
          label: r.full_name,
          meta: (r.language ? r.language : 'repo') + (r.private ? ' · private' : ''),
          branch: r.default_branch || 'main',
          name: r.name || ''
        };
      });
      var branchOptions = [];
      if (wizard.repo) {
        if (wizard.loadingBranches) {
          branchOptions = [{value: '', label: 'Loading branches…'}];
        } else if ((wizard.branches || []).length) {
          branchOptions = (wizard.branches || []).map(function(b){
            var meta = (b.default ? 'default' : '') + (b.protected ? (b.default ? ' · protected' : 'protected') : '');
            return {value: b.name, label: b.name, meta: meta};
          });
        } else {
          branchOptions = [{value: wizard.branch || 'main', label: wizard.branch || 'main'}];
        }
      }
      var rootOptions = [{value: '', label: 'Repository root', meta: 'go.mod at root'}];
      if (wizard.loadingDirs) {
        rootOptions = [{value: wizard.root_dir || '', label: 'Loading folders…'}];
      } else {
        (wizard.dirs || []).forEach(function(d){
          rootOptions.push({value: d.path, label: d.path, meta: 'directory'});
        });
        if (wizard.root_dir) {
          var seen = rootOptions.some(function(o){ return String(o.value) === String(wizard.root_dir); });
          if (!seen) rootOptions.push({value: wizard.root_dir, label: wizard.root_dir, meta: 'custom'});
        }
      }
      var dbs = (deployed || []).filter(function(x){ return x.type === 'postgres'; });
      var autoDb = wizard.linked_database != null ? wizard.linked_database : (dbs.length === 1 ? dbs[0].slug : '');
      if (wizard.linked_database == null && dbs.length === 1) wizard.linked_database = autoDb;
      var dbOptions = [{value: '', label: 'No database', meta: 'attach later'}].concat(dbs.map(function(d){
        return {value: d.slug, label: d.name || d.slug, meta: 'Postgres'};
      }));
      var cap0 = piCapacity();
      var wizMem = wizard.memory_mb || Math.min(512, cap0.maxMem);
      var wizCpu = wizard.cpus || Math.min(1, cap0.maxCpu);
      wizard.memory_mb = wizMem; wizard.cpus = wizCpu;
      var evGo = engineView || { settings: {}, go_options: [] };
      var goTc = wizard.go_toolchain || (evGo.settings && evGo.settings.go_toolchain) || 'auto';
      wizard.go_toolchain = goTc;
      var goOpts = runtimeOptions(evGo.go_options, goTc);
      var advBody = ''
        +resourceControlsHTML({memory_mb: wizMem, cpus: wizCpu, memId: 'wiz-mem', cpuId: 'wiz-cpu', memName: 'memory_mb', cpuName: 'cpus'})
        +'<div class="res-build">'
          +uiField({
            label: 'Go toolchain',
            meta: 'auto follows go.mod',
            control: cselectHTML('wiz-go-tc', goTc, 'Toolchain…', goOpts, false, {searchable:false})
          })
          +uiField({
            label: 'Build command',
            meta: 'optional · /out/app',
            control: uiInput({ id: 'wiz-build', placeholder: 'CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -buildvcs=false -o /out/app .', value: wizard.build_cmd || '', spellcheck: false })
          })
        +'</div>';
      var advSummary = wizMem + ' MB · ' + wizCpu + ' CPU · go ' + goTc + (wizard.build_cmd ? ' · custom' : '');
      var mode = wizard.env_mode || 'text';
      var link = autoDb || '';
      var envText = wizard.env != null ? wizard.env : '';
      // PORT is auto-assigned — keep it out of the custom editor.
      if (envText && typeof stripReservedDBEnv === 'function') {
        var em = parseEnvMapClient(envText);
        if (em.PORT != null) {
          delete em.PORT;
          envText = (wizard.env_mode === 'json') ? envMapToJSON(em) : envMapToDotenv(em);
          wizard.env = envText;
        }
      }
      var envCount = countEnvKeys(envText);
      var envSummaryTxt = link
        ? ((envCount ? envCount + ' custom' : 'linked') + ' · ' + link)
        : (envCount ? (envCount + ' key' + (envCount === 1 ? '' : 's')) : 'Optional');
      var conflictHits = link ? findReservedEnvConflicts(envText) : [];
      var dups = findDuplicateEnvKeys(envText);
      var warnMsg = formatEnvConflictWarn(conflictHits, dups, link);
      var conflictKeys = reservedConflictKeys(conflictHits);
      var linkedMap = linkedEnvMapFromSources(wizard.db_env || {}, envText);
      var envBody = ''
        +(link ? wizAutoDBEnvHTML(link, linkedMap, conflictKeys, { reveal: !!wizEnvReveal, revealAction: 'wizenvreveal' }) : '')
        +'<div class="wiz-custom-env">'
          +'<div class="wiz-custom-head">'
            +'<span>Your variables</span>'
            +'<div class="seg mini">'
              +'<button type="button" data-action="wizenvmode:text" class="'+(mode!=='json'?'active':'')+'">KEY=value</button>'
              +'<button type="button" data-action="wizenvmode:json" class="'+(mode==='json'?'active':'')+'">JSON</button>'
            +'</div>'
          +'</div>'
          +'<textarea class="env wiz-env'+(warnMsg?' has-warn':'')+'" id="wiz-env" name="env" spellcheck="false" placeholder="'+(mode==='json'
            ? '{\n  \"LOG_LEVEL\": \"info\"\n}'
            : 'LOG_LEVEL=info')+'">'+esc(envText)+'</textarea>'
          +'<div class="wiz-env-warn" id="wiz-env-warn"'+(warnMsg?'':' hidden')+'>'+esc(warnMsg)+'</div>'
        +'</div>';
      body = wizardShell({
        title: 'Add Go app',
        submitAction: 'wizard:deploy',
        submitLabel: 'Deploy',
        busy: !!busy.deploy,
        submitEnabled: !!wizard.repo,
        body: '<div class="wiz-grid">'
          +uiField({
            label: 'Repository',
            meta: (repos && repos.length ? repos.length + ' available' : 'Loading…'),
            control: cselectHTML('repo', wizard.repo || '', 'Search repositories…', repoOptions, !(repos && repos.length), {searchable:true, searchPlaceholder:'Filter repositories…'})
          })
          +uiField({
            label: 'Branch',
            meta: 'From GitHub',
            control: cselectHTML('branch', wizard.branch || '', wizard.repo ? 'Select branch…' : 'Pick a repo first', branchOptions, !wizard.repo || !!wizard.loadingBranches, {searchable:true, searchPlaceholder:'Filter branches…'})
          })
          +uiField({
            label: 'Root',
            meta: 'Monorepo',
            control: cselectHTML('root', wizard.root_dir || '', wizard.repo ? 'Repo root or folder…' : 'Pick a repo first', rootOptions, !wizard.repo || !!wizard.loadingDirs, {searchable:true, creatable:true, searchPlaceholder:'Search or type a path…'})
          })
          +uiField({
            label: 'Database',
            meta: 'link',
            control: cselectHTML('db', autoDb || '', 'No database', dbOptions, false, {searchable: dbs.length > 4, searchPlaceholder:'Filter databases…'})
          })
          +uiField({
            label: 'Port',
            meta: (wizard.port_free != null ? (wizard.port_free + ' free') : 'auto'),
            control: '<div class="wiz-port">'
              +'<span class="wiz-port-num">'+(wizard.port ? esc(String(wizard.port)) : '…')+'</span>'
              +'<span class="ghost">'+(wizard.port ? 'assigned on deploy · free now' : 'auditing…')+'</span>'
              +'</div>'
          })
          +'<div class="wiz-span folds">'
            +foldHTML('wiz:env', 'Environment', envSummaryTxt, envBody)
            +foldHTML('wiz:advanced', 'Resources & build', advSummary, advBody)
          +'</div>'
        +'</div>'
        +(wizard.repo
          ? '<p class="deploy-summary">'+esc(wizard.repo)+(wizard.root_dir ? '/'+esc(wizard.root_dir) : '')+' @ '+esc(wizard.branch || '…')+(link ? ' · DB '+esc(link) : '')
              + (function(){
                  var cname = containerNamePreview(activeGroup, wizard.name || wizard.repo.split('/').pop());
                  return cname ? ' · <span class="ghost" title="Docker container name">'+esc(cname)+'</span>' : '';
                })()
            +'</p>'
          : '')
      });
        } else if (step === 'postgres') {
      var ev = engineView || { settings: {}, postgres_options: [] };
      var pgVer = wizard.pg_version || 'latest';
      wizard.pg_version = pgVer;
      var pgOpts = runtimeOptions(ev.postgres_options, pgVer);
      body = wizardShell({
        title: 'Add Postgres',
        submitAction: 'wizard:create-pg',
        submitLabel: 'Create',
        busy: !!busy.deploy,
        body: ''
          +uiField({
            label: 'Name',
            tip: 'Prefix is added automatically',
            control: (function(){
              var prefix = pgIdentPrefix(activeGroup);
              return uiPrefixedInput({
                id: 'wiz-pg-name',
                prefix: prefix,
                placeholder: 'api-db',
                value: wizard.name || '',
                autofocus: true,
                compose: 'pg',
                previewHtml: uiPgNamePreview(activeGroup, wizard.name || '')
              });
            })()
          })
          +uiField({
            label: 'Engine',
            control: cselectHTML('wiz-pg-ver', pgVer, 'Version…', pgOpts, false, {searchable:false})
          })
          +uiHint('Shared on this Pi')
      });
    }
    var size = (step === 'go') ? ' modal-md' : (step === 'type' ? ' modal-sm' : '');
    var submit = '';
    if (step === 'github') submit = 'wizard:github-save';
    else if (step === 'group') submit = 'wizard:group-create';
    else if (step === 'go') submit = 'wizard:deploy';
    else if (step === 'postgres') submit = 'wizard:create-pg';
    return '<div class="modal-backdrop" data-action="wizard:backdrop"><div class="modal'+size+'" data-stop="1"'+(submit ? ' data-submit-action="'+esc(submit)+'"' : '')+'>'+body+'</div></div>';
  }

  /* === 08-render.js === */

  var _envFetch = {};
  function loadServiceEnv(slug, opts) {
    opts = opts || {};
    if (!activeGroup || !slug) return Promise.resolve();
    if (_envFetch[slug] && !opts.force) return _envFetch[slug];
    var mode = envMode[slug] || 'text';
    _envFetch[slug] = api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(slug) + '/env')
      .then(function(r){
        if (!settingsDraft[slug]) settingsDraft[slug] = {};
        var next = mode === 'json' ? (r.env_json || '{}') : (r.env || '');
        if (String(next).trim() !== '') {
          settingsDraft[slug].env = next;
        }
        return next;
      })
      .catch(function(){ return null; })
      .finally(function(){ delete _envFetch[slug]; });
    return _envFetch[slug];
  }

  function captureSqlDrafts() {
    document.querySelectorAll('textarea.sql-input[id^=sql-]').forEach(function(el){
      var slug = el.id.slice(4);
      if (slug) sqlDraft[slug] = el.value;
    });
  }
  function captureWizardDraft() {
    if (!wizard) return;
    if (wizard.step === 'go') {
      var mem = document.getElementById('wiz-mem');
      var cpu = document.getElementById('wiz-cpu');
      var build = document.getElementById('wiz-build');
      var envEl = document.getElementById('wiz-env');
      if (mem) wizard.memory_mb = parseInt(mem.value, 10) || 512;
      if (cpu) wizard.cpus = parseFloat(cpu.value) || 1;
      if (build) wizard.build_cmd = build.value || '';
      if (envEl) wizard.env = envEl.value || '';
    }
  }
  function captureSettingsDrafts() {
    var gn = document.getElementById('group-name');
    if (gn) groupDraft = { name: gn.value };
    document.querySelectorAll('.svc-card .settings, #drawer-root .settings').forEach(function(box) {
      var card = box.closest('.svc-card');
      var drawer = box.closest('.svc-drawer');
      var slug = (card && card.dataset.slug) || (drawer && drawer.getAttribute('data-slug'));
      if (!slug) return;
      function val(sel){ var el = box.querySelector(sel); return el ? el.value : ''; }
      var prev = settingsDraft[slug] || {};
      var linked = prev.linked_database;
      if (linked == null) {
        var svcMatch = (deployed || []).filter(function(x){ return x.slug === slug; })[0];
        linked = svcMatch ? (svcMatch.linked_database || '') : '';
      }
      var envEl = box.querySelector('textarea[name=env]');
      var typedEnv = envEl ? envEl.value : '';
      var keepEnv = typedEnv;
      if (String(typedEnv).trim() === '' && prev.env && String(prev.env).trim() !== '') {
        keepEnv = prev.env;
      }
      var svcNow = (deployed || []).filter(function(x){ return x.slug === slug; })[0];
      if (!linked && svcNow && svcNow.linked_database) linked = svcNow.linked_database;
      // Textarea shows custom keys only when DB is linked — merge DB_* back in.
      if (linked) {
        var linkedSrc = linkedEnvMapFromSources(null, prev.env || '');
        if (!RESERVED_DB_KEYS.some(function(k){ return linkedSrc[k]; }) && svcNow) {
          linkedSrc = linkedEnvMapFromSources(null, keepEnv);
        }
        keepEnv = mergeLinkedPreviewEnv(keepEnv, linkedSrc);
      }
      settingsDraft[slug] = {
        name: val('input[name=name]'),
        branch: val('input[name=branch]'),
        linked_database: linked,
        root_dir: val('input[name=root_dir]'),
        env: keepEnv,
        build_cmd: val('input[name=build_cmd]'),
        memory_mb: val('input[name=memory_mb]'),
        cpus: val('input[name=cpus]'),
        auto_deploy: !!(box.querySelector('input[name=auto_deploy]') && box.querySelector('input[name=auto_deploy]').checked)
      };
    });
  }

  /** Open the live Activity console without remounting the page.
   *  Respects user collapse — never force-expands after they minimize. */
  function openActivityConsole(opts) {
    opts = opts || {};
    if (opts.reset || opts.clearPin || opts.forceExpand) {
      if (typeof resetActivityConsole === 'function') {
        resetActivityConsole({
          open: true,
          active: !!opts.active,
          title: opts.title || 'Activity',
          scope: opts.scope || '',
          deploymentId: opts.deploymentId || '',
          contextKey: opts.contextKey || ('pending:' + Date.now()),
          clearPin: true
        });
      } else if (typeof clearDeployLogView === 'function') {
        clearDeployLogView();
      }
    }
    activity.open = true;
    if (opts.expand && !activity.userCollapsed) activity.collapsed = false;
    if (opts.forceExpand) {
      activity.userCollapsed = false;
      activity.collapsed = false;
    }
    activity.follow = true;
    syncActivityPoll();
    // Do not call watchActivity() here — that would re-apply stale hub state
    // over the clean context we just prepared. SSE/poll will attach live lines.
    patchActivity();
  }


  /**
   * Shared deploy/create/redeploy flow:
   * close wizard → Activity console → optimistic UI → API → wait for job.
   */
  function closeWizardToActivity(opts) {
    opts = opts || {};
    wizard = null;
    picker = null;
    renderModal();
    activity.userCollapsed = false;
    openActivityConsole({
      forceExpand: true,
      clearPin: true,
      reset: true,
      active: true,
      title: opts.title || 'Activity',
      scope: opts.scope || '',
      contextKey: opts.contextKey || ('job:' + Date.now())
    });
  }

  function waitDeployBusy(pollTimer, timeoutMs) {
    var wait = setInterval(function(){
      if (activity.active) return;
      clearInterval(wait);
      if (pollTimer) clearInterval(pollTimer);
      delete busy.deploy;
      refreshServices({ soft: true });
    }, 500);
    setTimeout(function(){
      clearInterval(wait);
      if (pollTimer) clearInterval(pollTimer);
      delete busy.deploy;
      refreshServices({ soft: true });
    }, timeoutMs || (20 * 60 * 1000));
  }

  function runServiceJob(opts) {
    opts = opts || {};
    if (busy.deploy && !opts.allowParallel) return null;
    if (opts.closeWizard) {
      closeWizardToActivity({
        title: opts.consoleTitle || opts.toast || 'Activity',
        scope: opts.scope || '',
        contextKey: opts.contextKey || ('job:' + Date.now())
      });
    } else {
      activity.userCollapsed = false;
      openActivityConsole({
        forceExpand: true,
        clearPin: true,
        reset: true,
        active: true,
        title: opts.consoleTitle || opts.toast || 'Activity',
        scope: opts.scope || '',
        contextKey: opts.contextKey || ('job:' + Date.now())
      });
    }
    busy.deploy = true;
    if (opts.busyKey) busy[opts.busyKey] = true;
    if (opts.beforeRequest) opts.beforeRequest();
    if (opts.toast) showToast(opts.toast);
    var poll = null;
    if (opts.poll !== false) {
      poll = setInterval(function(){
        if (!busy.deploy) { clearInterval(poll); return; }
        refreshServices({ soft: true });
      }, 1200);
    }
    var req = opts.request;
    if (typeof req !== 'function') {
      delete busy.deploy;
      if (opts.busyKey) delete busy[opts.busyKey];
      return null;
    }
    return req()
      .then(function(res){
        if (opts.onSuccess) opts.onSuccess(res);
        return refreshServices({ soft: true, appear: !!opts.appear }).then(function(){ return res; });
      })
      .catch(function(err){
        showToast((err && err.message) || opts.failToast || 'Failed');
        return refreshServices({ soft: true });
      })
      .finally(function(){
        if (opts.busyKey) delete busy[opts.busyKey];
        if (opts.waitActivity === false) {
          if (poll) clearInterval(poll);
          delete busy.deploy;
          refreshServices({ soft: true });
          return;
        }
        waitDeployBusy(poll, opts.timeoutMs);
      });
  }


  /**
   * Toggle busy/spinner on action buttons without remounting the modal
   * (full remounts felt laggy and wiped input values).
   */
  function setActionBusy(id, on) {
    if (on) busy[id] = true;
    else delete busy[id];
    var roots = [
      document.getElementById('modal-root'),
      document.getElementById('app')
    ];
    roots.forEach(function(root){
      if (!root) return;
      root.querySelectorAll('[data-action="'+id+'"]').forEach(function(btn){
        btn.classList.toggle('loading', !!on);
        if (on) btn.setAttribute('disabled', '');
        else btn.removeAttribute('disabled');
      });
    });
  }

  function wizardSubmitAction() {
    if (!wizard) return '';
    switch (wizard.step) {
      case 'github': return 'wizard:github-save';
      case 'group': return 'wizard:group-create';
      case 'go': return 'wizard:deploy';
      case 'postgres': return 'wizard:create-pg';
      default: return '';
    }
  }

  var _motionTimer = null;
  var _prevWizard = null; // truthy while a wizard session is open
  var _prevSettings = null;
  var _prevNav = null;
  var _navDir = null; // 'forward' | 'back'
  var _modalEnterTimer = null;
  var _drawerEnterTimer = null;
  var _didBoot = false;
  var _routeSync = false;

  function routePath() {
    if (navView === 'overview') return '/overview';
    if (navView === 'activity') return '/activity';
    if (navView === 'settings') {
      return settingsTab === 'storage' ? '/settings/storage' : '/settings';
    }
    if (navView === 'projects') {
      if (activeGroup) {
        if (settingsSlug) {
          return '/projects/' + encodeURIComponent(activeGroup) + '/' + encodeURIComponent(settingsSlug);
        }
        return '/projects/' + encodeURIComponent(activeGroup);
      }
      return '/projects';
    }
    return '/overview';
  }

  function parseRoute(path) {
    var p = String(path || '/').replace(/\/+$/, '') || '/';
    if (p === '/' || p === '/overview') return { navView: 'overview' };
    if (p === '/activity') return { navView: 'activity' };
    if (p === '/settings') return { navView: 'settings', settingsTab: 'github' };
    if (p === '/settings/storage') return { navView: 'settings', settingsTab: 'storage' };
    if (p === '/projects') return { navView: 'projects' };
    var m = p.match(/^\/projects\/([^/]+)(?:\/([^/]+))?$/);
    if (m) {
      var out = { navView: 'projects', activeGroup: decodeURIComponent(m[1]) };
      if (m[2]) out.settingsSlug = decodeURIComponent(m[2]);
      return out;
    }
    return { navView: 'overview' };
  }

  function applyRoute(route, opts) {
    opts = opts || {};
    route = route || {};
    navView = route.navView || 'overview';
    if (route.navView === 'settings') {
      activeGroup = null;
      settingsSlug = null;
      settingsTab = route.settingsTab || 'github';
      dockerOpen = settingsTab === 'storage';
      manageTab = 'services';
    } else if (route.navView === 'projects') {
      activeGroup = route.activeGroup || null;
      settingsSlug = route.settingsSlug || null;
      if (!activeGroup) {
        deployed = [];
        navLoading = false;
      } else {
        navLoading = true;
        deployed = [];
      }
      manageTab = 'services';
      dockerOpen = false;
    } else if (navView === 'overview') {
      activeGroup = null;
      settingsSlug = null;
      manageTab = 'services';
      dockerOpen = false;
    } else if (navView === 'activity') {
      activeGroup = null;
      settingsSlug = null;
      manageTab = 'services';
      dockerOpen = false;
    }
    ensureStatsPoll();
    if (opts.render === false) return;
    if (navView === 'settings' && settingsTab === 'storage') {
      manageLoading = true;
      render(opts);
      refreshManage({ animate: true });
      return;
    }
    if (navView === 'projects') {
      render(opts);
      refreshServices({ soft: true });
      return;
    }
    render(opts);
    if (navView === 'activity') {
      activity.userCollapsed = false;
      openActivityConsole({ forceExpand: true });
    }
    if (navView === 'overview') refreshConfig(true);
  }

  function syncRouteFromState(replace) {
    if (_routeSync) return;
    var path = routePath();
    var cur = location.pathname.replace(/\/+$/, '') || '/';
    var next = path.replace(/\/+$/, '') || '/';
    if (cur === next) return;
    var st = { fw: 1, path: next };
    if (replace) history.replaceState(st, '', next);
    else history.pushState(st, '', next);
  }


  function navKey() {
    if (navView === 'overview') return 'overview';
    if (navView === 'activity') return 'activity';
    if (navView === 'settings') return 'settings:' + (settingsTab || 'github');
    if (activeGroup) return 'group:' + activeGroup;
    return 'projects';
  }

  /** Gate CSS enter animations. ms keeps motion on long enough for spring curves. */
  function setMotion(on, ms) {
    var html = document.documentElement;
    if (_motionTimer) clearTimeout(_motionTimer);
    if (!on) {
      html.dataset.motion = 'off';
      html.dataset.boot = 'off';
      return;
    }
    html.dataset.motion = 'on';
    _motionTimer = setTimeout(function(){
      html.dataset.motion = 'off';
      html.dataset.boot = 'off';
    }, ms || 200);
  }

  function playBoot() {
    if (_didBoot) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      _didBoot = true;
      return;
    }
    _didBoot = true;
    var html = document.documentElement;
    html.dataset.boot = 'on';
    var layout = document.querySelector('.layout');
    if (layout) layout.classList.add('boot-layout');
    setMotion(true, 200);
  }

  function pulseEnter(el) {
    if (!el) return;
    el.classList.remove('enter');
    void el.offsetWidth;
    el.classList.add('enter');
  }

  function openWizard(spec) {
    wizard = spec || {step: 'type'};
    renderModal();
  }

  function closeWizard() {
    if (!wizard) return;
    wizard = null;
    picker = null;
    renderModal();
  }

  /** Swap only the services nav-page — keeps VPN/monitoring mounted (fast). */
  function softServicesKey() {
    var bits = [navView || '', settingsTab || '', activeGroup || '', settingsSlug || '', manageTab || ''];
    try {
      bits.push('folds:' + Object.keys(folds || {}).filter(function(k){ return folds[k]; }).sort().join(','));
    } catch (e) {}
    (deployed || []).forEach(function(s){
      if (!s) return;
      var b = 0;
      (s.deployments || []).forEach(function(d){ if (d && (d.status === 'building' || d.status === 'queued')) b++; });
      bits.push([
        s.slug, s.status || '', s.running ? 1 : 0, s.linked_database || '', s.public_url || '',
        s.active_deploy_id || '', s.deploy_id || '', b,
        (settingsDraft[s.slug] && countEnvKeys(settingsDraft[s.slug].env || '')) || 0,
        envReveal[s.slug] ? 1 : 0,
        envReveal[s.slug + ':link'] ? 1 : 0,
        envReveal[s.slug + ':env'] ? 1 : 0
      ].join(':'));
    });
    bits.push('busy:' + Object.keys(busy || {}).sort().join(','));
    bits.push('err:' + String(servicesError || '') + ':' + String(groupsError || '') + ':' + (navLoading ? 1 : 0));
    if (navView === 'settings' && settingsTab === 'storage') {
      bits.push('stor:' + (manageLoading ? 1 : 0) + ':' + (manageOv ? 1 : 0) + ':' + String(manageError || ''));
    }
    try {
      Object.keys(sqlResult || {}).sort().forEach(function(slug){
        bits.push('sql:' + slug + ':' + sqlResultKey(slug));
      });
    } catch (e) {}
    return bits.join('|');
  }



  function railActiveView() {
    return navView || 'overview';
  }

  function shellRailHTML() {
    var active = railActiveView();
    function item(view, label, icon) {
      var on = active === view;
      return ''
        +'<button type="button" class="rail-item'+(on?' active':'')+'" data-action="nav:view:'+view+'" title="'+esc(label)+'"'+(on?' aria-current="page"':'')+'>'
          +'<span class="rail-ico" aria-hidden="true">'+icon+'</span>'
          +'<span class="rail-label">'+esc(label)+'</span>'
        +'</button>';
    }
    var icons = {
      overview: '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
      projects: '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
      activity: '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
      settings: '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
    };
    return ''
      +'<div class="rail-brand" title="FireWifi"><span class="rail-mark">FW</span><span class="rail-name">FireWifi</span></div>'
      +'<div class="rail-nav">'
        +item('overview', 'Overview', icons.overview)
        +item('projects', 'Projects', icons.projects)
        +item('activity', 'Activity', icons.activity)
        +item('settings', 'Settings', icons.settings)
      +'</div>';
  }

  function renderRail() {
    var rail = document.getElementById('app-rail');
    if (!rail) return;
    rail.innerHTML = shellRailHTML();
  }

  function setDrawerScrollLock(lock) {
    var html = document.documentElement;
    if (lock) {
      if (html.classList.contains('drawer-open')) return;
      var y = window.scrollY || window.pageYOffset || 0;
      html.dataset.drawerLockY = String(y);
      html.style.setProperty('--drawer-lock-y', '-' + y + 'px');
      html.classList.add('drawer-open');
      return;
    }
    if (!html.classList.contains('drawer-open')) return;
    var restore = parseInt(html.dataset.drawerLockY || '0', 10) || 0;
    html.classList.remove('drawer-open');
    html.style.removeProperty('--drawer-lock-y');
    delete html.dataset.drawerLockY;
    window.scrollTo(0, restore);
  }

  function setAppBodyInert(on) {
    var body = document.querySelector(".app-body");
    if (!body) return;
    if (on) body.setAttribute("inert", "");
    else body.removeAttribute("inert");
  }

  function setDrawerA11y(open) {
    var root = document.getElementById("drawer-root");
    if (open) {
      _drawerPrevFocus = document.activeElement;
      setAppBodyInert(true);
      var t = root && (root.querySelector(".svc-drawer-close") || root.querySelector(".svc-drawer"));
      if (t && t.focus) try { t.focus(); } catch (e) {}
    } else {
      setAppBodyInert(false);
      var prev = _drawerPrevFocus;
      _drawerPrevFocus = null;
      if (prev && prev.focus) try { prev.focus(); } catch (e) {}
    }
  }

  function trapDrawerFocus(e) {
    if (!settingsSlug || e.key !== "Tab") return;
    var root = document.getElementById("drawer-root");
    if (!root || root.hidden) return;
    var drawer = root.querySelector(".svc-drawer");
    if (!drawer) return;
    var nodes = drawer.querySelectorAll(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])"
    );
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onSvcCardKey(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var t = e.target && e.target.closest && e.target.closest(".svc-widget-face[role=\"button\"], [role=\"button\"][data-action^=\"svc:settings:\"]");
    if (!t) return;
    if (e.target !== t && e.target.closest && e.target.closest("button, a, input, select, textarea, [contenteditable=\"true\"]")) return;
    e.preventDefault();
    if (e.key === " ") e.stopPropagation();
    t.click();
  }

  function applyDrawerFolds(scope) {
    if (!scope) return;
    applyFoldsDOM(scope + ':access');
    Object.keys(folds).forEach(function(k){
      if (k.indexOf(scope + ':') === 0) applyFoldsDOM(k);
    });
  }

  function renderDrawerPortal(opts) {
    opts = opts || {};
    var root = document.getElementById('drawer-root');
    if (!root) return;
    var opening = !!settingsSlug && settingsSlug !== _prevSettings;
    if (!settingsSlug) {
      root.innerHTML = '';
      root.hidden = true;
      setDrawerScrollLock(false);
      setDrawerA11y(false);
      return;
    }
    var svc = (deployed || []).filter(function(s){ return s.slug === settingsSlug; })[0];
    if (!svc) {
      root.innerHTML = '';
      root.hidden = true;
      setDrawerScrollLock(false);
      setDrawerA11y(false);
      return;
    }
    var dbs = (deployed || []).filter(function(x){ return x.type === 'postgres'; });
    root.hidden = false;
    var existing = root.querySelector('.svc-drawer');
    var sameSlug = existing && existing.getAttribute('data-slug') === settingsSlug;
    if (opts.patchBody && sameSlug && !opts.forceRemount) {
      captureSettingsDrafts();
      var body = existing.querySelector('.svc-drawer-body');
      if (body) body.innerHTML = serviceSettingsHTML(svc, dbs);
      var toolbar = existing.querySelector('.svc-drawer-toolbar');
      if (toolbar) toolbar.innerHTML = drawerToolbarHTML(svc);
      applyDrawerFolds(settingsSlug);
      setDrawerScrollLock(true);
      document.querySelectorAll('[data-res-panel]').forEach(syncResLabels);
      placeOpenCselect();
      return;
    }
    root.innerHTML = ''
      + '<div class="svc-drawer-backdrop" data-action="svc:settings:close" aria-hidden="true"></div>'
      + serviceDrawerHTML(svc, dbs);
    setDrawerScrollLock(true);
    if (opening || !sameSlug) setDrawerA11y(true);
    var drawer = root.querySelector('.svc-drawer');
    if (drawer) {
      drawer.classList.remove('enter');
      if (opening) {
        drawer.classList.add('enter');
        if (_drawerEnterTimer) clearTimeout(_drawerEnterTimer);
        _drawerEnterTimer = setTimeout(function(){
          if (drawer) drawer.classList.remove('enter');
          _drawerEnterTimer = null;
        }, 240);
      }
    }
    applyDrawerFolds(settingsSlug);
    document.querySelectorAll('[data-res-panel]').forEach(syncResLabels);
    placeOpenCselect();
  }

  function mainContentHTML(s, c) {
    if (navView === 'overview') {
      return ''
        + '<div class="layout layout-overview">'
          + '<div class="rack rack-live">'
            + '<div class="rack-row">' + vpn(s, c) + monitoring(s) + '</div>'
          + '</div>'
        + '</div>';
    }
    if (navView === 'projects') {
      return '<div class="layout layout-main layout-projects">' + services(s) + '</div>';
    }
    if (navView === 'settings') {
      return '<div class="layout layout-main layout-settings">' + services(s) + '</div>';
    }
    if (navView === 'activity') {
      return '<div class="layout layout-main layout-activity">' + services(s) + '</div>';
    }
    return '<div class="layout layout-empty"></div>';
  }
  function closeSettingsDrawer(opts) {
    if (!settingsSlug) return;
    var prev = settingsSlug;
    settingsSlug = null;
    Object.keys(folds).forEach(function(k){ if (k.indexOf(prev+':')===0) delete folds[k]; });
    renderDrawerPortal();
    renderServices(opts || { animate: true });
    syncRouteFromState();
  }
  function drawRwLinks() {
    var canvas = document.querySelector('.panel-group-detail .rw-canvas');
    if (!canvas) return;
    var svg = canvas.querySelector('.rw-links-g');
    if (!svg) return;
    var reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    var cRect = canvas.getBoundingClientRect();
    var paths = [];
    canvas.querySelectorAll('.svc-node[data-linked]').forEach(function(appEl){
      var dbSlug = appEl.getAttribute('data-linked');
      if (!dbSlug) return;
      var dbEl = canvas.querySelector('.svc-node[data-slug="'+dbSlug+'"]');
      if (!dbEl) return;
      var a = appEl.getBoundingClientRect();
      var b = dbEl.getBoundingClientRect();
      var x1 = a.left + a.width / 2 - cRect.left;
      var y1 = a.top - cRect.top;
      var x2 = b.left + b.width / 2 - cRect.left;
      var y2 = b.bottom - cRect.top;
      var midY = (y1 + y2) / 2;
      paths.push('M'+x1+' '+y1+' L'+x1+' '+midY+' L'+x2+' '+midY+' L'+x2+' '+y2);
    });
    svg.innerHTML = paths.map(function(d){
      return '<path class="rw-link-path" d="'+d+'" fill="none" stroke="rgba(139,92,246,.45)" stroke-width="1.5" stroke-dasharray="5 4"/>';
    }).join('');
    var linksSvg = canvas.querySelector('.rw-links');
    if (linksSvg) {
      linksSvg.setAttribute('width', String(Math.max(canvas.scrollWidth, cRect.width)));
      linksSvg.setAttribute('height', String(Math.max(canvas.scrollHeight, cRect.height)));
    }
  }
  function renderServices(opts) {
    opts = opts || {};
    captureWizardDraft();
    captureSettingsDrafts();
    if (typeof captureSqlDrafts === 'function') captureSqlDrafts();
    if (settingsSlug && !opts._skipEnvSync) {
      var buildingSvc = (deployed || []).filter(function(s){ return s.slug === settingsSlug; })[0];
      var draftEnv = (settingsDraft[settingsSlug] && settingsDraft[settingsSlug].env) || '';
      var thin = countEnvKeys(draftEnv) < 2;
      if (buildingSvc && buildingSvc.status === 'building' && thin) {
        loadServiceEnv(settingsSlug).then(function(next){
          if (!next || !String(next).trim()) return;
          if (settingsSlug !== buildingSvc.slug) return;
          var mode = envMode[settingsSlug] || 'text';
          var formatted = mode === 'json' ? envMapToJSON(parseEnvMapClient(next)) : next;
          if ((settingsDraft[settingsSlug].env || '') === formatted) return;
          settingsDraft[settingsSlug].env = formatted;
          if (buildingSvc.linked_database) settingsDraft[settingsSlug].linked_database = buildingSvc.linked_database;
          renderServices({ soft: true, _skipEnvSync: true });
        });
      }
    }
    var host = document.querySelector('.nav-page');
    if (!host) {
      render(opts);
      return;
    }
    var prevSlugs = {};
    var prevDeploys = {};
    host.querySelectorAll('.svc-card[data-slug]').forEach(function(el){ prevSlugs[el.dataset.slug] = true; });
    host.querySelectorAll('.deploy-row[data-deploy-id]').forEach(function(el){ prevDeploys[el.getAttribute('data-deploy-id')] = true; });

    var s = state || {};
    var wrap = document.createElement('div');
    wrap.innerHTML = services(s);
    var next = wrap.firstChild;
    if (!next) return;

    var nav = navKey();
    var navChanged = _prevNav != null && nav !== _prevNav;
    var dir = opts.soft ? null : (opts.dir || _navDir || null);
    if (!opts.soft && navChanged && !dir) dir = 'forward';
    if (dir) next.classList.add(dir === 'back' ? 'nav-in-back' : 'nav-in');

    var appearAny = false;
    next.querySelectorAll('.svc-card[data-slug]').forEach(function(el){
      var slug = el.dataset.slug;
      if (!prevSlugs[slug]) {
        el.classList.add('svc-appear');
        appearAny = true;
      }
    });
    next.querySelectorAll('.deploy-row[data-deploy-id]').forEach(function(el){
      var id = el.getAttribute('data-deploy-id');
      if (id && !prevDeploys[id]) {
        el.classList.add('deploy-appear');
        appearAny = true;
      }
    });
    // opts.appear: only animate truly new cards (already tagged above). Never remount-animate everything.

    var softKey = softServicesKey();
    if (opts.soft && !opts.appear && !opts.force && host.getAttribute('data-soft') === softKey) {
      return; // identical — avoid remount thrash / animation restarts
    }
    next.setAttribute('data-soft', softKey);
    host.replaceWith(next);

    renderDrawerPortal({ patchBody: !!settingsSlug && settingsSlug === _prevSettings && !opts.forceDrawer });
    renderRail();
    if (dir || opts.animate) setMotion(true, dir ? 200 : 180);
    else if (appearAny) setMotion(true, 200);

    _prevSettings = settingsSlug;
    _prevNav = nav;
    _navDir = null;

    document.querySelectorAll('[data-res-panel]').forEach(syncResLabels);
    placeOpenCselect();
    drawRwLinks();
    if (settingsSlug) {
      var sel = document.querySelector('.svc-node[data-slug="'+settingsSlug+'"]');
      if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  function setModalScrollLock(lock) {
    var html = document.documentElement;
    if (lock) {
      if (html.classList.contains('modal-open')) return;
      var y = window.scrollY || window.pageYOffset || 0;
      html.dataset.scrollLockY = String(y);
      html.style.setProperty('--scroll-lock-y', '-' + y + 'px');
      html.classList.add('modal-open');
      return;
    }
    if (!html.classList.contains('modal-open')) return;
    var restore = parseInt(html.dataset.scrollLockY || '0', 10) || 0;
    html.classList.remove('modal-open');
    html.style.removeProperty('--scroll-lock-y');
    delete html.dataset.scrollLockY;
    window.scrollTo(0, restore);
  }

  /** Modal lives outside #app so page re-renders do not remount/re-animate it. */
  function renderModal() {
    var root = document.getElementById('modal-root');
    if (!root) return;
    var wasOpen = !!_prevWizard;
    var nowOpen = !!wizard;
    var opening = nowOpen && !wasOpen;
    root.innerHTML = wizardHTML();
    root.hidden = !nowOpen;
    setModalScrollLock(nowOpen);
    _prevWizard = wizard;
    if (_modalEnterTimer) {
      clearTimeout(_modalEnterTimer);
      _modalEnterTimer = null;
    }
    if (opening) {
      var back = root.querySelector('.modal-backdrop');
      var modal = root.querySelector('.modal');
      pulseEnter(back);
      pulseEnter(modal);
      setMotion(true, 200);
      _modalEnterTimer = setTimeout(function(){
        if (back) back.classList.remove('enter');
        if (modal) modal.classList.remove('enter');
      }, 240);
    }
  }

  function patchLive() {
    var draft = readFormDraft();
    var s = state || {};
    var c = draft || config || {};
    var mon = document.getElementById('panel-monitoring');
    var vpnEl = document.getElementById('panel-vpn');
    if (mon) {
      var wrap = document.createElement('div');
      wrap.innerHTML = monitoring(s);
      mon.replaceWith(wrap.firstChild);
    }
    var hotspotOpen = !!(vpnEl && vpnEl.querySelector('details[open]'));
    if (vpnEl && !(formDirty && hotspotOpen)) {
      var wrap2 = document.createElement('div');
      wrap2.innerHTML = vpn(s, formDirty ? c : (config || {}));
      vpnEl.replaceWith(wrap2.firstChild);
      if (!formDirty) formDirty = false;
    }
    setLive(true);
  }

  function render(opts) {
    opts = opts || {};
    captureWizardDraft();
    captureSettingsDrafts();
    var draft = readFormDraft();
    var s = state || {};
    var c = draft || config || {};
    var nav = navKey();
    var navChanged = _prevNav != null && nav !== _prevNav;
    var dir = opts.dir || _navDir || null;
    if (navChanged && !dir) dir = 'forward';
    var settingsChanged = settingsSlug && settingsSlug !== _prevSettings;
    // Page motion only — modal enter is handled exclusively in renderModal().
    var wantMotion = !!opts.animate || !!dir || settingsChanged;

    document.getElementById('app').innerHTML = mainContentHTML(s, c);
    renderRail();

    var page = document.querySelector('.nav-page');
    if (page && dir) {
      page.classList.add(dir === 'back' ? 'nav-in-back' : 'nav-in');
    }

    renderModal();
    renderDrawerPortal({ patchBody: !!settingsSlug && !settingsChanged });
    drawRwLinks();
    if (!_didBoot) {
      playBoot();
    } else if (wantMotion) {
      setMotion(true, dir ? 200 : 180);
    }

    _prevWizard = wizard;
    _prevSettings = settingsSlug;
    _prevNav = nav;
    _navDir = null;

    if (picker && picker.id) {
      var qel = document.getElementById('cselect-q-' + picker.id);
      if (qel) {
        qel.focus();
        var pos = picker.caret != null ? picker.caret : (qel.value || '').length;
        try { qel.setSelectionRange(pos, pos); } catch (err) {}
      }
    }
    document.querySelectorAll('[data-res-panel]').forEach(syncResLabels);
    placeOpenCselect();
  }

  function ensureStatsPoll() {
    clearInterval(statsPollTimer);
    statsPollTimer = null;
    if (!activeGroup) return;
    var tick = function(){
      if (!activeGroup || document.hidden) return;
      api('/api/groups/' + encodeURIComponent(activeGroup) + '/stats').then(function(r){
        var map = (r && r.stats) || {};
        var changed = false;
        (deployed || []).forEach(function(s){
          if (!s) return;
          var next = map[s.slug] || null;
          var prev = s.stats || null;
          if (!next && !prev) return;
          if (!next) { if (prev) { s.stats = null; changed = true; } return; }
          s.stats = next;
          changed = true;
        });
        if (changed) patchServiceUsageDOM();
      }).catch(function(){});
    };
    tick();
    statsPollTimer = setInterval(tick, 2500);
  }

  function refreshServices(opts) {
    opts = opts || {};
    // GitHub status is slow (remote) — never block page paint on it.
    api("/api/github/status").then(function(g){
      var prevOn = !!(github && github.connected);
      var prevUser = github && github.user && github.user.login;
      github = g;
      var on = !!(g && g.connected);
      var user = g && g.user && g.user.login;
      if (picker || wizard) return;
      if (on === prevOn && user === prevUser) return;
      renderServices({soft:true});
    }).catch(function(){
      var prevOn = !!(github && github.connected);
      github = {connected:false};
      if (picker || wizard || !prevOn) return;
      renderServices({soft:true});
    });
    return Promise.all([
      api("/api/groups").then(function(r){ groups = r.groups || []; groupsError = null; }).catch(function(e){ groupsError = (e && e.message) || "Could not load groups"; }),
      activeGroup
        ? api("/api/groups/" + encodeURIComponent(activeGroup) + "/services").then(function(r){ deployed = r.services || []; servicesError = null; }).catch(function(e){ servicesError = (e && e.message) || "Could not load services"; deployed = []; })
        : Promise.resolve().then(function(){ deployed = []; servicesError = null; })
    ]).then(function(){
      navLoading = false;
      ensureStatsPoll();
      if (activeGroup && !(groups || []).some(function(g){ return g.slug === activeGroup; })) {
        activeGroup = null;
        settingsSlug = null;
        syncRouteFromState(true);
      }
      if (settingsSlug && activeGroup) {
        var urlSvc = (deployed || []).filter(function(x){ return x.slug === settingsSlug; })[0];
        if (!urlSvc) {
          settingsSlug = null;
          syncRouteFromState(true);
        } else if (!settingsDraft[settingsSlug]) {
          Object.keys(folds).forEach(function(k){ if (k.indexOf(settingsSlug+':')===0) delete folds[k]; });
          var urlDeploys = !!(urlSvc.type !== 'postgres' && (
            (urlSvc.deployments && urlSvc.deployments.length) ||
            urlSvc.status === 'building' ||
            (urlSvc.deployments || []).some(function(d){ return d.status === 'building' || d.status === 'queued'; })
          ));
          folds[settingsSlug + (urlDeploys ? ':deploys' : ':access')] = true;
          settingsDraft[settingsSlug] = {
            name: urlSvc.name || '', branch: urlSvc.branch || 'main',
            linked_database: urlSvc.linked_database || '',
            root_dir: urlSvc.root_dir || '',
            env: '',
            build_cmd: urlSvc.build_cmd || '',
            memory_mb: urlSvc.memory_mb || 512,
            cpus: urlSvc.cpus || 1,
            auto_deploy: !!urlSvc.auto_deploy
          };
        }
      }
      if (picker) return;
      if (opts.full) render(opts);
      else renderServices(Object.assign({soft: !!(opts.soft || (!opts.animate && !opts.dir))}, opts));
    });
  }
  function loadRepos() {
    return api('/api/github/repos').then(function(r){ repos = r.repos || []; }).catch(function(e){ repos = []; showToast(e.message || 'Could not load repos'); });
  }


  function readFormDraft() {
    var form = document.getElementById("config-form");
    if (!formDirty || !form) return null;
    var fd = new FormData(form);
    return {
      ssid: fd.get("ssid") || "",
      password: fd.get("password") || "",
      hotspot_ip: fd.get("hotspot_ip") || "",
      dhcp_start: fd.get("dhcp_start") || "",
      dhcp_end: fd.get("dhcp_end") || ""
    };
  }
  function refreshConfig(force) {
    if (formDirty && !force) return Promise.resolve(config);
    return api('/api/config').then(function(c){ config = c; render(); return c; }).catch(function(e){ console.error(e); });
  }
  function fallbackPoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(function(){
      api('/api/state').then(function(s){ state = s; lastStateAt = Date.now(); setLive(true); patchLive(); }).catch(function(){ setLive(false); });
    }, 2500);
  }
  var _esRetry = null;
  function connectEvents() {
    if (!window.EventSource) { fallbackPoll(); return; }
    if (eventSource) {
      try { eventSource.close(); } catch (e) {}
      eventSource = null;
    }
    eventSource = new EventSource('/api/events');
    eventSource.addEventListener('state', function(e) {
      state = JSON.parse(e.data);
      lastStateAt = Date.now();
      setLive(true);
      patchLive();
    });
    eventSource.addEventListener('activity', function(e) {
      try { applyActivity(JSON.parse(e.data)); } catch (err) {}
    });
    eventSource.onerror = function() {
      setLive(false);
      try { eventSource.close(); } catch (e) {}
      eventSource = null;
      if (!pollTimer) fallbackPoll();
      if (_esRetry) clearTimeout(_esRetry);
      _esRetry = setTimeout(function(){
        clearInterval(pollTimer); pollTimer = null;
        connectEvents();
      }, 3000);
    };
  }
  function runAction(id, fn, doneMessage) {
    busy[id] = true; render();
    fn().then(function(){ showToast(doneMessage || 'Done'); return Promise.all([api('/api/state'), refreshConfig(true)]); })
      .then(function(a){ state = a[0]; lastStateAt = Date.now(); setLive(true); })
      .catch(function(e){ showToast(e.message || 'Action failed'); })
      .finally(function(){ delete busy[id]; renderServices({soft:true}); });
  }

  function onUiAction(e) {
    // Keep access Open/Copy usable; don't let parent row actions steal the click.
    var stop = e.target.closest('[data-stop]');
    if (stop && !e.target.closest('[data-stop] [data-action], [data-stop][data-action], a[href]')) {
      e.stopPropagation();
      return;
    }
    if (stop && e.target.closest('a[href]') && !e.target.closest('[data-action]')) {
      e.stopPropagation();
      return;
    }
    var el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    if (stop && !stop.contains(el) && el.closest('.svc-row')) {
      // action on row but click originated in stop zone
      return;
    }
    var id = el.dataset.action;

    if (id.indexOf('fold:') === 0) {
      e.stopPropagation();
      var foldKey = id.slice(5);
      toggleFold(foldKey);
      applyFoldsDOM(foldKey);
      if (settingsSlug && foldKey === settingsSlug + ':env' && folds[foldKey]) {
        var envDraft = (settingsDraft[settingsSlug] && settingsDraft[settingsSlug].env) || '';
        if (countEnvKeys(envDraft) < 2) {
          loadServiceEnv(settingsSlug).then(function(){
            if (settingsSlug !== foldKey.split(':')[0]) return;
            renderDrawerPortal({ patchBody: true });
            applyFoldsDOM(foldKey);
          });
        }
      }
      return;
    }
    if (id.indexOf('cselect:toggle:') === 0) {
      e.stopPropagation();
      var tid = id.split(':').slice(2).join(':');
      picker = (picker && picker.id === tid) ? null : {id: tid, query: '', caret: 0};
      if (wizard) renderModal();
      else renderServices({soft:true});
      return;
    }
    if (id.indexOf('cselect:pick:') === 0) {
      e.stopPropagation();
      var pid = id.split(':').slice(2).join(':');
      var val = el.dataset.value || '';
      picker = null;
      if (pid === 'repo' && wizard) {
        wizard.repo = val;
        wizard.name = el.dataset.name || (val.split('/')[1] || '');
        loadBranches(val, el.dataset.branch || '');
        return;
      }
      if (pid === 'branch' && wizard) { wizard.branch = val; wizard.root_dir = wizard.root_dir || ''; renderModal(); loadDirs(); return; }
      if (pid === 'db' && wizard) {
        captureWizardDraft();
        wizard.linked_database = val;
        wizard.db_env = null;
        if (val) {
          var beforeLink = wizard.env || '';
          var removed = findReservedEnvConflicts(beforeLink);
          if (removed.length) {
            wizard.env = stripReservedDBEnv(beforeLink);
            showToast('Moved to linked · ' + reservedConflictKeys(removed).join(', '));
          }
          wizEnvReveal = false;
      folds['wiz:env'] = true;
          renderModal();
          api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(val) + '/env')
            .then(function(r){
              if (!wizard || wizard.linked_database !== val) return;
              wizard.db_env = parseEnvMapClient(r.env || r.env_json || '');
              renderModal();
            })
            .catch(function(){ /* preview optional */ });
          return;
        }
        renderModal();
        return;
      }
      if (pid === 'root' && wizard) { wizard.root_dir = val; renderModal(); return; }
      if (pid === 'link' && settingsSlug) {
        if (!settingsDraft[settingsSlug]) settingsDraft[settingsSlug] = {};
        settingsDraft[settingsSlug].linked_database = val;
        renderServices({soft:true});
        return;
      }
      if (pid === 'engine-pg') {
        if (!engineDraft) engineDraft = {};
        engineDraft.postgres_version = val;
        if (engineView && engineView.settings) engineView.settings.postgres_version = val;
        var opt = ((engineView && engineView.postgres_options) || []).filter(function(o){ return o.id === val; })[0];
        if (opt && engineView) engineView.postgres_image = opt.image || engineView.postgres_image;
        renderServices({soft:true});
        return;
      }
      if (pid === 'engine-go') {
        if (!engineDraft) engineDraft = {};
        engineDraft.go_toolchain = val;
        if (engineView && engineView.settings) engineView.settings.go_toolchain = val;
        renderServices({soft:true});
        return;
      }
      if (pid === 'wiz-pg-ver' && wizard) {
        wizard.pg_version = val;
        renderModal();
        return;
      }
      if (pid === 'wiz-go-tc' && wizard) {
        wizard.go_toolchain = val;
        renderModal();
        return;
      }
      render();
      return;
    }
    if (id.indexOf('hotspot:') === 0) {
      var cmd = id.split(':')[1];
      runAction(id, function(){ return api('/api/hotspot/' + cmd, {method:'POST'}); }, 'Hotspot ' + cmd);
    } else if (id.indexOf('mode:') === 0) {
      var mode = id.split(':')[1];
      runAction(id, function(){ return api('/api/mode', {method:'POST', body:JSON.stringify({mode:mode})}); }, 'Mode updated');
    } else if (id.indexOf('syncrox:') === 0) {
      var appcmd = id.split(':')[1];
      runAction(id, function(){ return api('/api/syncrox/' + appcmd, {method:'POST'}); }, 'Syncrox ' + appcmd);
    } else if (id === 'wizard:close') { closeWizard(); }
    else if (id === 'wizard:backdrop') {
      if (e.target !== el) return; // ignore clicks that bubbled from modal content
      closeWizard();
    }
    else if (id === 'wizard:github') { openWizard({step:'github'}); }
    else if (id === 'wizard:group') { openWizard({step:'group'}); }
    else if (id === 'wizard:open') {
      if (!activeGroup) { openWizard({step:'group'}); return; }
      openWizard({step:'type'});
    } else if (id === 'wizard:github-save') {
      if (busy['wizard:github-save']) return;
      var tokenEl = document.getElementById('wiz-token');
      var token = tokenEl ? tokenEl.value : '';
      if (wizard) wizard.token = token;
      if (!String(token || '').trim()) { showToast('Token required'); return; }
      openActivityConsole();
      setActionBusy('wizard:github-save', true);
      api('/api/github/token', {method:'POST', body:JSON.stringify({token:token})})
        .then(function(){ showToast('GitHub connected'); wizard = null; picker = null; renderModal(); return refreshServices({soft:true}); })
        .catch(function(err){ showToast(err.message || 'GitHub failed'); })
        .finally(function(){ setActionBusy('wizard:github-save', false); if (wizard) renderModal(); });
    } else if (id === 'wizard:group-create') {
      if (busy['wizard:group-create']) return;
      var gn = document.getElementById('wiz-group-name');
      var name = gn ? gn.value.trim() : '';
      if (wizard) wizard.name = name;
      if (!name) { showToast('Name required'); return; }
      openActivityConsole();
      setActionBusy('wizard:group-create', true);
      api('/api/groups', {method:'POST', body:JSON.stringify({name:name})})
        .then(function(g){
          showToast('Group created');
          wizard = null; picker = null; renderModal();
          activeGroup = g.slug; deployed = []; navLoading = true; _navDir = 'forward';
          renderServices({animate:true, dir:'forward'});
          return refreshServices({soft:true});
        })
        .catch(function(err){ showToast(err.message || 'Failed'); })
        .finally(function(){ setActionBusy('wizard:group-create', false); if (wizard) renderModal(); });
    } else if (id === 'wizard:type:go') {
      wizEnvReveal = false;
      refreshEngine().catch(function(){});
      if (!activeGroup) { showToast('Open a group first'); return; }
      if (!(github && github.connected)) {
        if (wizard) { wizard = {step:'github'}; renderModal(); }
        else openWizard({step:'github'});
        return;
      }
      var dbs0 = (deployed || []).filter(function(x){ return x.type === 'postgres'; });
      var capW = piCapacity();
      var goSpec = {
        step:'go', repo:'', branch:'', name:'',
        linked_database: dbs0.length===1?dbs0[0].slug:'',
        branches:[], dirs:[], loadingBranches:false, loadingDirs:false,
        root_dir:'', memory_mb: Math.min(512, capW.maxMem), cpus: Math.min(1, capW.maxCpu), build_cmd:'',
        go_toolchain: (engineView && engineView.settings && engineView.settings.go_toolchain) || 'auto',
        env:'', env_mode:'text', port:0, port_free:null, port_used:[]
      };
      folds['wiz:advanced'] = false;
      folds['wiz:env'] = true;
      if (wizard) { wizard = goSpec; renderModal(); }
      else openWizard(goSpec);
      loadRepos().finally(function(){ renderModal(); });
      api('/api/ports').then(function(a){
        if (!wizard || wizard.step !== 'go') return;
        wizard.port = a && a.next ? a.next : 0;
        wizard.port_free = a && a.free != null ? a.free : null;
        wizard.port_used = (a && a.used) || [];
        renderModal();
      }).catch(function(){});
      if (goSpec.linked_database) {
        api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(goSpec.linked_database) + '/env')
          .then(function(r){
            if (!wizard || wizard.linked_database !== goSpec.linked_database) return;
            wizard.db_env = parseEnvMapClient(r.env || r.env_json || '');
            renderModal();
          })
          .catch(function(){});
      }
    } else if (id === 'wizard:type:postgres') {
      refreshEngine().catch(function(){});
      if (!activeGroup) { showToast('Open a group first'); return; }
      var pgSpec = {step:'postgres', name:'', pg_version:'latest'};
      if (wizard) { wizard = pgSpec; renderModal(); }
      else openWizard(pgSpec);
    } else if (id.indexOf('wizenvmode:') === 0) {
      captureWizardDraft();
      if (!wizard) return;
      var wm = id.split(':')[1];
      var raw = wizard.env || '';
      var reservedMode = wizard.linked_database ? findReservedEnvConflicts(raw) : [];
      if (reservedMode.length) {
        showToast(formatEnvConflictWarn(reservedMode, null, wizard.linked_database));
        folds['wiz:env'] = true;
        renderModal();
        return;
      }
      var dups = findDuplicateEnvKeys(raw);
      if (dups.length) {
        showToast(formatEnvConflictWarn(null, dups, ''));
        folds['wiz:env'] = true;
        renderModal();
        return;
      }
      var curMap = parseEnvMapClient(raw);
      wizard.env_mode = wm;
      wizard.env = wm === 'json' ? envMapToJSON(curMap) : envMapToDotenv(curMap);
      folds['wiz:env'] = true;
      renderModal();
    } else if (id === 'wizard:deploy') {
      if (!activeGroup) { showToast('Open a group first'); return; }
      if (busy.deploy) return;
      captureWizardDraft();
      if (wizard) {
        folds['wiz:env'] = true;
        var reservedHit = wizard.linked_database ? findReservedEnvConflicts(wizard.env || '') : [];
        if (reservedHit.length) {
          showToast(formatEnvConflictWarn(reservedHit, null, wizard.linked_database));
          renderModal();
          return;
        }
        var dupHit = findDuplicateEnvKeys(wizard.env || '');
        if (dupHit.length) {
          showToast(formatEnvConflictWarn(null, dupHit, ''));
          renderModal();
          return;
        }
      }
      var repoVal = (wizard && wizard.repo) || '';
      var payload = {
        type: 'go',
        repo: repoVal,
        branch: (wizard && wizard.branch) || 'main',
        name: (wizard && wizard.name) || (repoVal ? repoVal.split('/')[1] : ''),
        linked_database: (wizard && wizard.linked_database) || '',
        root_dir: (wizard && wizard.root_dir) || '',
        memory_mb: (wizard && wizard.memory_mb) || 512,
        cpus: (wizard && wizard.cpus) || 1,
        build_cmd: (wizard && wizard.build_cmd) || '',
        go_toolchain: (wizard && wizard.go_toolchain) || (engineView && engineView.settings && engineView.settings.go_toolchain) || 'auto',
        env: (wizard && wizard.env) || ''
      };
      if (!payload.repo) { showToast('Pick a repository'); return; }
      // PORT is server-assigned — never send a user PORT.
      if (payload.env) {
        var em0 = parseEnvMapClient(payload.env);
        if (em0.PORT != null) {
          delete em0.PORT;
          payload.env = (wizard && wizard.env_mode === 'json') ? envMapToJSON(em0) : envMapToDotenv(em0);
        }
      }
      var optSlug = slugifyClient(payload.name || payload.repo.split('/').pop());
      var prior = (deployed || []).filter(function(s){ return s.slug === optSlug; })[0];
      var reusing = !!(prior || (deployed || []).some(function(s){ return s.name === payload.name; }));
      var assignedPort = (prior && prior.port) ? prior.port : ((wizard && wizard.port) || 0);
      var linkedPreview = '';
      if (payload.linked_database) {
        linkedPreview = mergeLinkedPreviewEnv(payload.env || '', (wizard && wizard.db_env) || {});
      }
      if (assignedPort) {
        linkedPreview = upsertEnvClient(linkedPreview || payload.env || '', 'PORT', String(assignedPort));
      }
      runServiceJob({
        closeWizard: true,
        appear: true,
        consoleTitle: 'Deploy · ' + (payload.name || optSlug),
        scope: activeGroup + '/' + optSlug,
        contextKey: 'live:' + activeGroup + '/' + optSlug,
        toast: (reusing ? 'Reusing · rebuilding ' : 'Deploying ') + (payload.name || optSlug) + (assignedPort ? (' · :' + assignedPort) : ''),
        failToast: 'Deploy failed',
        beforeRequest: function(){
          var optimistic = {
            group: activeGroup, slug: optSlug, type: 'go',
            name: payload.name || optSlug, repo: payload.repo, branch: payload.branch,
            root_dir: payload.root_dir || '', status: 'building', running: false,
            memory_mb: payload.memory_mb, cpus: payload.cpus,
            port: assignedPort || 0,
            url: assignedPort ? ('http://rasp.local:' + assignedPort) : '',
            linked_database: payload.linked_database || '', has_clone: !!(prior && prior.has_clone),
            deploy_id: 'dpl_…',
            deployments: (prior && prior.deployments ? prior.deployments.slice() : []).filter(function(d){ return d.status !== 'building'; })
          };
          optimistic.deployments.unshift({ id: 'dpl_…', status: 'building', branch: payload.branch || 'main', created_at: new Date().toISOString() });
          folds[optSlug + ':deploys'] = true;
          folds[optSlug + ':env'] = true;
          folds[optSlug + ':connections'] = true;
          settingsDraft[optSlug] = {
            name: payload.name || optSlug,
            branch: payload.branch || 'main',
            linked_database: payload.linked_database || '',
            root_dir: payload.root_dir || '',
            env: linkedPreview || payload.env || '',
            build_cmd: payload.build_cmd || '',
            memory_mb: payload.memory_mb || 512,
            cpus: payload.cpus || 1
          };
          deployed = (deployed || []).filter(function(s){ return s.slug !== optSlug; }).concat([optimistic]);
          settingsSlug = optSlug;
          renderServices({ soft: true, appear: true, force: true });
        },
        request: function(){
          return api('/api/groups/' + encodeURIComponent(activeGroup) + '/services', {method:'POST', body:JSON.stringify(payload)});
        },
        onSuccess: function(svc){
          settingsSlug = (svc && svc.slug) || settingsSlug;
          var sslug = settingsSlug;
          if (sslug) {
            if (!settingsDraft[sslug]) settingsDraft[sslug] = {};
            if (svc && svc.linked_database) settingsDraft[sslug].linked_database = svc.linked_database;
            loadServiceEnv(sslug, { force: true }).then(function(){
              renderServices({ soft: true, _skipEnvSync: true });
              setTimeout(function(){
                loadServiceEnv(sslug, { force: true }).then(function(){
                  renderServices({ soft: true, _skipEnvSync: true });
                });
              }, 1200);
            });
          }
          showToast(((svc && svc.status === 'building') ? 'Building ' : 'Deployed ') + ((svc && (svc.name || svc.slug)) || optSlug));
        }
      });
    } else if (id === 'wizard:create-pg') {
      if (!activeGroup) { showToast('Open a group first'); return; }
      if (busy.deploy || busy['wizard:create-pg']) return;
      var pgName = document.getElementById('wiz-pg-name');
      var name = pgName ? pgName.value.trim() : ((wizard && wizard.name) || '');
      if (wizard) wizard.name = name;
      if (!name) { showToast('Name required'); return; }
      var pgVer = (wizard && wizard.pg_version) || 'latest';
      var optSlug = slugifyClient(name);
      runServiceJob({
        closeWizard: true,
        appear: true,
        busyKey: 'wizard:create-pg',
        consoleTitle: 'Create database · ' + name,
        scope: activeGroup + '/' + optSlug,
        contextKey: 'live:' + activeGroup + '/' + optSlug,
        toast: 'Creating database · ' + name,
        failToast: 'Create failed',
        waitActivity: true,
        beforeRequest: function(){
          // Keep the list stable — do not flash a temporary card that vanishes on failure.
        },
        request: function(){
          return api('/api/groups/' + encodeURIComponent(activeGroup) + '/services', {
            method:'POST',
            body: JSON.stringify({ type:'postgres', name: name, version: pgVer })
          });
        },
        onSuccess: function(svc){
          settingsSlug = (svc && svc.slug) || settingsSlug;
          showToast('Database ready · ' + ((svc && (svc.name || svc.slug)) || name));
        }
      });
    } else if (id.indexOf('nav:view:') === 0) {
      var view = id.slice('nav:view:'.length);
      if (view === 'activity') {
        if (settingsSlug) {
          clearScopeFolds(settingsSlug);
          settingsSlug = null;
          renderDrawerPortal();
        }
        var prevAct = navView;
        navView = 'activity';
        _navDir = (prevAct === 'activity') ? _navDir : 'forward';
        activity.userCollapsed = false;
        openActivityConsole({ forceExpand: true });
        render({ animate: true, dir: _navDir });
        syncRouteFromState();
        return;
      }
      if (view === navView) return;
      if (settingsSlug) {
        clearScopeFolds(settingsSlug);
        settingsSlug = null;
        renderDrawerPortal();
      }
      var prevView = navView;
      navView = view;
      _navDir = (prevView === 'overview' && view !== 'overview') ? 'forward'
        : (view === 'overview' ? 'back' : 'forward');
      if (view === 'overview') {
        manageTab = 'services';
        dockerOpen = false;
        render({ animate: true, dir: _navDir });
        syncRouteFromState();
        return;
      }
      if (view === 'projects') {
        manageTab = 'services';
        dockerOpen = false;
        render({ animate: true, dir: _navDir });
        if (!activeGroup) refreshServices({ soft: true });
        else renderServices({ animate: true, dir: _navDir });
        syncRouteFromState();
        return;
      }
      if (view === 'settings') {
        activeGroup = null;
        manageTab = 'services';
        if (!settingsTab) settingsTab = 'github';
        dockerOpen = (settingsTab === 'storage');
        render({ animate: true, dir: _navDir });
        if (settingsTab === 'storage') {
          manageLoading = true;
          refreshManage({ animate: true });
        }
        syncRouteFromState();
        return;
      }
    } else if (id.indexOf('group:open:') === 0) {
      activeGroup = id.split(':').slice(2).join(':');
      if (settingsSlug) { clearScopeFolds(settingsSlug); settingsSlug = null; }
      clearServiceListFolds(deployed);
      deployed = [];
      navLoading = true;
      ensureStatsPoll();
      navView = 'projects';
      _navDir = 'forward';
      // Paint instantly — don't wait on the network.
      renderServices({animate:true, dir:'forward'});
      refreshServices({soft:true});
      syncRouteFromState();
    } else if (id.indexOf('settings:tab:') === 0) {
      var stab = id.slice('settings:tab:'.length);
      if (stab !== 'github' && stab !== 'storage') return;
      if (navView !== 'settings') {
        activeGroup = null;
        settingsSlug = null;
        renderDrawerPortal();
        navView = 'settings';
        manageTab = 'services';
      }
      if (settingsTab === stab && navView === 'settings') return;
      settingsTab = stab;
      dockerOpen = (stab === 'storage');
      _navDir = 'forward';
      if (stab === 'storage') {
        manageLoading = true;
        render({ animate: true, dir: _navDir });
        refreshManage({ animate: true });
      } else {
        renderServices({ animate: true, dir: _navDir });
      }
      syncRouteFromState();
    } else if (id.indexOf('manage:tab:') === 0) {
      var legacyTab = id.slice('manage:tab:'.length);
      if (legacyTab === 'storage') {
        activeGroup = null;
        settingsSlug = null;
        renderDrawerPortal();
        navView = 'settings';
        settingsTab = 'storage';
        manageTab = 'services';
        dockerOpen = true;
        manageLoading = true;
        _navDir = 'forward';
        render({ animate: true, dir: _navDir });
        refreshManage({ animate: true });
        return;
      }
      if (legacyTab === 'services') {
        navView = 'projects';
        manageTab = 'services';
        dockerOpen = false;
        activeGroup = null;
        settingsSlug = null;
        renderDrawerPortal();
        _navDir = 'back';
        render({ animate: true, dir: 'back' });
        refreshServices({ soft: true });
      }
    } else if (id === 'docker:open') {
      navView = 'settings';
      settingsTab = 'storage';
      manageTab = 'services';
      dockerOpen = true;
      activeGroup = null;
      manageLoading = true;
      render({animate:true, dir:'forward'});
      refreshManage({animate:true});
    } else if (id === 'docker:back') {
      navView = 'projects';
      manageTab = 'services';
      dockerOpen = false;
      _navDir = 'back';
      render({ animate: true, dir: 'back' });
      refreshServices({ soft: true });
    } else if (id === 'docker:refresh') {
      busy['docker:refresh'] = true;
      renderServices({soft:true});
      refreshManage().finally(function(){ delete busy['docker:refresh']; if (onSettingsStoragePage()) renderServices({soft:true}); });
    } else if (id === 'docker:stop-all') {
      var nRun = ((dockerInv && dockerInv.containers) || []).filter(function(c){ return c.running && c.managed; }).length;
      dockerAction({action:'stop-all'}, 'docker:stop-all',
        'Stop '+nRun+' FireWifi-managed container(s)?\n\nOnly labeled fw-* / firewifi containers. Shared images stay. Start apps again from Groups.');
    } else if (id === 'engine:start' || id === 'engine:stop') {
      if (busy['engine:start'] || busy['engine:stop'] || busy.deploy) return;
      var start = id === 'engine:start';
      if (!start && !confirm('Stop the shared Postgres engine?\n\nApps using databases in this engine will fail until it is started again.')) return;
      busy[id] = true;
      activity.userCollapsed = false;
      openActivityConsole({
        forceExpand: true, clearPin: true, reset: true, active: true,
        title: start ? 'Start Postgres engine' : 'Stop Postgres engine',
        scope: 'engine/postgres',
        contextKey: 'live:engine/postgres'
      });
      if (onSettingsStoragePage()) renderServices({ soft: true });
      api('/api/engine', { method:'POST', body: JSON.stringify({ action: start ? 'start' : 'stop' }) })
        .then(function(v){
          engineView = v;
          showToast(start ? 'Postgres engine running' : 'Postgres engine stopped');
          return refreshManage();
        })
        .catch(function(e){ showToast(e.message || 'Engine action failed'); })
        .finally(function(){
          delete busy[id];
          if (onSettingsStoragePage()) renderServices({ soft: true });
        });
    } else if (id === 'engine:save') {
      var ev = engineView || { settings: {} };
      var nextPg = (engineDraft && engineDraft.postgres_version) || (ev.settings && ev.settings.postgres_version) || '16';
      var nextGo = (engineDraft && engineDraft.go_toolchain) || (ev.settings && ev.settings.go_toolchain) || 'auto';
      var warn = '';
      if (nextPg !== (ev.settings && ev.settings.postgres_version)) {
        warn = 'This will pull Postgres '+nextPg+' and recreate the engine container. Data volume is kept; major upgrades can break existing data.\n\n';
      }
      if (warn && !confirm(warn + 'Apply runtime changes?')) return;
      busy['engine:save'] = true;
      openActivityConsole();
      renderServices({soft:true});
      api('/api/engine', { method:'PUT', body: JSON.stringify({ postgres_version: nextPg, go_toolchain: nextGo }) })
        .then(function(v){
          engineView = v;
          showToast('Runtimes updated · ' + ((v.settings && v.settings.postgres_version) || '') + ' / go ' + ((v.settings && v.settings.go_toolchain) || ''));
          return refreshManage();
        })
        .catch(function(e){ showToast(e.message || 'Failed'); })
        .finally(function(){ delete busy['engine:save']; if (onSettingsStoragePage()) renderServices({soft:true}); });
    } else if (id === 'docker:prune') {

      var o = dockerOpts || {};
      var bits = [];
      if (o.images) bits.push(o.all_unused ? 'unused images' : 'dangling images');
      if (o.containers) bits.push('stopped containers');
      if (o.volumes) bits.push('UNUSED VOLUMES (data loss risk)');
      if (o.build_cache) bits.push('build cache');
      if (!bits.length) { showToast('Select something to clean'); return; }
      dockerAction({
        action:'prune', images:!!o.images, all_unused:!!o.all_unused,
        containers:!!o.containers, volumes:!!o.volumes, build_cache:!!o.build_cache
      }, 'docker:prune', 'Clean: '+bits.join(', ')+'?');
    } else if (id.indexOf('docker:start:') === 0) {
      var sname = id.slice('docker:start:'.length);
      dockerAction({action:'start', id:sname}, id);
    } else if (id.indexOf('docker:stop:') === 0) {
      var cname = id.slice('docker:stop:'.length);
      dockerAction({action:'stop', id:cname}, id, 'Stop container '+cname+'?');
    } else if (id.indexOf('docker:rm-ctr:') === 0) {
      var cname = id.slice('docker:rm-ctr:'.length);
      dockerAction({action:'rm-container', id:cname, force:true}, id,
        'Remove container '+cname+'?\n\nDoes not delete images or volumes.');
    } else if (id.indexOf('docker:rm-img:') === 0) {
      var iid = id.slice('docker:rm-img:'.length);
      dockerAction({action:'rm-image', id:iid, force:false}, id, 'Remove image '+iid+'?');
    } else if (id.indexOf('docker:rm-vol:') === 0) {
      var vname = id.slice('docker:rm-vol:'.length);
      dockerAction({action:'rm-volume', id:vname, force:false}, id,
        'Remove volume '+vname+'?\n\nData in this volume will be deleted.');
    } else if (id === 'projects:retry') {
      servicesError = null;
      groupsError = null;
      navLoading = true;
      renderServices({ soft: true });
      refreshServices({ soft: true });
    } else if (id === 'group:save') {
      if (!activeGroup) { showToast('Open a group first'); return; }
      if (busy['group:save']) return;
      var nameEl = document.getElementById('group-name');
      var name = nameEl ? nameEl.value.trim() : '';
      if (!name) { showToast('Name required'); return; }
      groupDraft = { name: name };
      var prevSlug = activeGroup;
      busy['group:save'] = true;
      openActivityConsole();
      renderServices({ soft: true });
      api('/api/groups/' + encodeURIComponent(prevSlug), {
        method: 'PUT',
        body: JSON.stringify({ name: name })
      }).then(function(g){
        if (g && g.slug && g.slug !== prevSlug) {
          activeGroup = g.slug;
          ensureStatsPoll();
          syncRouteFromState(true);
          showToast('Renamed · ' + prevSlug + ' → ' + g.slug);
        } else {
          showToast('Saved · ' + (g && g.name || name));
        }
        groupDraft = {};
        return refreshServices({ soft: true });
      }).catch(function(e){
        showToast(e.message || 'Rename failed');
      }).finally(function(){
        delete busy['group:save'];
        renderServices({ soft: true });
      });
    } else if (id === 'group:back') {
      if (settingsSlug) clearScopeFolds(settingsSlug);
      clearServiceListFolds(deployed);
      activeGroup = null; settingsSlug = null; deployed = []; groupDraft = {};
      manageTab = 'services'; dockerOpen = false;
      ensureStatsPoll();
      navView = 'projects';
      navLoading = false;
      renderDrawerPortal();
      _navDir = 'back';
      renderServices({animate:true, dir:'back'});
      refreshServices({soft:true});
      syncRouteFromState();
    } else if (id.indexOf('group:delete:') === 0) {
      var gs = id.split(':').slice(2).join(':');
      if (activeGroup !== gs) {
        showToast('Open the group to delete it');
        return;
      }
      var gmeta = (groups || []).filter(function(x){ return x.slug === gs; })[0];
      var gdisk = gmeta && gmeta.disk_bytes ? ('\n\nWill free ~' + fmtBytes(gmeta.disk_bytes) + ' on disk.') : '';
      if (!confirm('Delete group '+gs+'?\n\nStops containers, drops DBs, deletes clones/binaries/files.'+gdisk+'\n\nWatch Activity for each resource removed.')) return;
      busy[id] = true;
      openActivityConsole();
      manageTab = 'services'; dockerOpen = false;
      renderServices({soft:true});
      api('/api/groups/' + encodeURIComponent(gs), {method:'DELETE'})
        .then(function(){
          if (activeGroup === gs) activeGroup = null;
          showToast('Group removed · check Activity for freed disk');
          return refreshServices();
        })
        .catch(function(e){ showToast(e.message || 'Failed'); })
        .finally(function(){ delete busy[id]; renderServices({soft:true}); });
    } else if (id.indexOf('envmode:') === 0) {
      captureSettingsDrafts();
      var bits = id.split(':');
      var slug = bits[1]; var mode = bits[2];
      envMode[slug] = mode;
      api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(slug) + '/env').then(function(r){
        if (!settingsDraft[slug]) settingsDraft[slug] = {};
        settingsDraft[slug].env = mode === 'json' ? (r.env_json || '{}') : (r.env || '');
        renderServices({soft:true});
      });
    } else if (id === 'github:clear') {
      api('/api/github/token', {method:'DELETE'}).then(function(){ showToast('Disconnected'); repos=[]; return refreshServices(); });
    } else if (id.indexOf('envreveal:') === 0) {
      var rslug = id.slice('envreveal:'.length);
      envReveal[rslug] = !envReveal[rslug];
      renderServices({ soft: true });
    } else if (id === 'wizenvreveal') {
      wizEnvReveal = !wizEnvReveal;
      if (wizard) {
        folds['wiz:env'] = true;
        renderModal();
      }
    } else if (id.indexOf('copy:env-json:') === 0 || id.indexOf('copy:env-dotenv:') === 0 || id.indexOf('copy:env-key:') === 0) {
      var asJSON = id.indexOf('copy:env-json:') === 0;
      var asKey = id.indexOf('copy:env-key:') === 0;
      var parts = id.split(':');
      var eslug = asKey ? parts[2] : parts[2];
      var ekey = asKey ? parts.slice(3).join(':') : '';
      var svc0 = (deployed || []).filter(function(s){ return s.slug === eslug; })[0];
      var draftEnv = (settingsDraft[eslug] && settingsDraft[eslug].env) || '';
      var map0 = dbEnvMapForService(svc0 || { slug: eslug }, draftEnv);
      var text = '';
      if (asKey) text = map0[ekey] || '';
      else if (asJSON) text = envMapToJSON(map0, DB_ENV_KEYS);
      else text = envMapToDotenv(map0, DB_ENV_KEYS);
      if (!text) { showToast('Nothing to copy'); return; }
      copyText(text).then(function(){ showToast(asJSON ? 'JSON copied' : (asKey ? (ekey + ' copied') : 'Env copied')); }).catch(function(){ showToast('Copy failed'); });
    } else if (id.indexOf('copy:') === 0) {
      var ckey = id.slice(5); // done | access:slug | access-cfg:slug | access-pub:slug | slug
      var eid = (ckey === 'done') ? 'access-done'
        : (ckey.indexOf('access-pub:') === 0 ? 'access-pub-' + ckey.slice(11)
        : (ckey.indexOf('access-cfg:') === 0 ? 'access-cfg-' + ckey.slice(11)
        : (ckey.indexOf('access:') === 0 ? 'access-' + ckey.slice(7)
        : 'access-' + ckey)));
      var code = document.getElementById(eid) || document.getElementById('conn-done');
      // Prefer full URL from data-copy / service model — never truncated display text.
      var text = (code && code.getAttribute('data-copy')) || '';
      if (!text) {
        if (ckey.indexOf('access-pub:') === 0) {
          var pslug = ckey.slice(11);
          var psvc = (deployed || []).filter(function(s){ return s.slug === pslug; })[0];
          text = (psvc && psvc.public_url) || '';
        } else if (ckey.indexOf('access:') === 0 || ckey.indexOf('access-cfg:') === 0) {
          var aslug = ckey.indexOf('access-cfg:') === 0 ? ckey.slice(11) : ckey.slice(7);
          var asvc = (deployed || []).filter(function(s){ return s.slug === aslug; })[0];
          text = publicURL(asvc) || accessURL(asvc) || '';
        }
      }
      if (!text && code) text = code.textContent || '';
      if (!text) { showToast('Nothing to copy'); return; }
      copyText(String(text).trim()).then(function(){ showToast('Copied'); }).catch(function(){ showToast('Copy failed'); });
    } else if (id.indexOf('deploy:logs:') === 0) {
      e.stopPropagation();
      var parts = id.split(':');
      // deploy:logs:slug:dpl_xxx
      var dslug = parts[2] || '';
      var did = parts.slice(3).join(':');
      if (dslug && did) {
        if (settingsSlug !== dslug) {
          // Enter service first so Deployments context is visible
          settingsSlug = dslug;
          Object.keys(folds).forEach(function(k){ if (k.indexOf(dslug+':')===0) folds[k] = false; });
          folds[dslug + ':deploys'] = true;
          renderServices({animate:true});
        } else {
          folds[dslug + ':deploys'] = true;
          applyFoldsDOM(dslug + ':deploys');
        }
        openDeployLogs(activeGroup, dslug, did);
      }
      return;
    } else if (id.indexOf('svc:logs:') === 0) {
      e.stopPropagation();
      var logSlug = id.split(':').slice(2).join(':');
      if (logSlug) openServiceCrashLogs(activeGroup, logSlug);
      return;
    } else if (id === 'svc:settings:close') {
      e.stopPropagation();
      closeSettingsDrawer({ animate: true });
      return;
    } else if (id.indexOf('svc:settings:') === 0) {
      var sslug = id.split(':').slice(2).join(':');
      if (settingsSlug === sslug) {
        settingsSlug = null;
        Object.keys(folds).forEach(function(k){ if (k.indexOf(sslug+':')===0) delete folds[k]; });
        renderServices({animate:true});
        syncRouteFromState();
        return;
      }
      if (settingsSlug) {
        var prev = settingsSlug;
        Object.keys(folds).forEach(function(k){ if (k.indexOf(prev+':')===0) delete folds[k]; });
      }
      settingsSlug = sslug;
      var svc = (deployed || []).filter(function(x){ return x.slug === sslug; })[0];
      Object.keys(folds).forEach(function(k){ if (k.indexOf(sslug+':')===0) folds[k] = false; });
      var openDeploys = !!(svc && svc.type !== 'postgres' && (
        (svc.deployments && svc.deployments.length) ||
        svc.status === 'building' ||
        (svc.deployments || []).some(function(d){ return d.status === 'building' || d.status === 'queued'; })
      ));
      folds[sslug + (openDeploys ? ':deploys' : ':access')] = true;
      // Open panel immediately with known service fields; env fills in right after.
      settingsDraft[sslug] = {
        name: svc ? svc.name : '', branch: svc ? svc.branch : 'main',
        linked_database: svc ? (svc.linked_database || '') : '',
        root_dir: svc ? (svc.root_dir || '') : '',
        env: (settingsDraft[sslug] && settingsDraft[sslug].env) || '',
        build_cmd: svc ? (svc.build_cmd || '') : '',
        memory_mb: svc ? (svc.memory_mb || 512) : 512,
        cpus: svc ? (svc.cpus || 1) : 1,
        auto_deploy: !!(svc && svc.auto_deploy)
      };
      renderServices({ soft: true, force: true });
      syncRouteFromState();
    } else if (id.indexOf('svc:save:') === 0) {
      var saveslug = id.split(':').slice(2).join(':');
      captureSettingsDrafts();
      var d = settingsDraft[saveslug] || {};
      var saveSvc = (deployed || []).filter(function(s){ return s.slug === saveslug; })[0];
      var saveBody = (saveSvc && saveSvc.type === 'postgres')
        ? { name: d.name }
        : {
            name: d.name, branch: d.branch, linked_database: d.linked_database, root_dir: d.root_dir || '', env: d.env,
            build_cmd: d.build_cmd, memory_mb: parseInt(d.memory_mb, 10) || 512, cpus: parseFloat(d.cpus) || 1,
            auto_deploy: !!d.auto_deploy
          };
      api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(saveslug) + '/settings', {
        method:'PUT', body:JSON.stringify(saveBody)
      }).then(function(svc){ showToast((svc && svc.type === 'go') ? 'Saved · container restarted' : 'Saved'); return refreshServices(); })
        .catch(function(e){ showToast(e.message || 'Save failed'); });
    } else if (id.indexOf('sql:preset:') === 0) {
      var pp = id.split(':');
      var pslug = pp[2];
      var kind = pp[3];
      var el = document.getElementById('sql-'+pslug);
      var presets = {
        now: "SELECT now() AS ts, current_database() AS db, current_user AS role;\n",
        tables: "SELECT table_schema, table_name\nFROM information_schema.tables\nWHERE table_schema NOT IN ('pg_catalog','information_schema')\nORDER BY 1, 2;\n",
        size: "SELECT relname AS table,\n       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,\n       pg_size_pretty(pg_relation_size(c.oid)) AS data\nFROM pg_class c\nJOIN pg_namespace n ON n.oid = c.relnamespace\nWHERE c.relkind = 'r' AND n.nspname = 'public'\nORDER BY pg_total_relation_size(c.oid) DESC;\n",
        activity: "SELECT pid, usename, state, wait_event_type, left(query, 80) AS query\nFROM pg_stat_activity\nWHERE datname = current_database()\nORDER BY state, pid;\n",
        indexes: "SELECT tablename, indexname, indexdef\nFROM pg_indexes\nWHERE schemaname = 'public'\nORDER BY tablename, indexname;\n",
        clear: ""
      };
      sqlDraft[pslug] = presets[kind] != null ? presets[kind] : presets.now;
      if (kind === 'clear') sqlResult[pslug] = null;
      if (el) {
        el.value = sqlDraft[pslug];
        el.focus();
      } else {
        renderServices({ soft: true });
      }
    } else if (id.indexOf('sql:cancel:') === 0) {
      var cslug = id.slice('sql:cancel:'.length);
      if (sqlAbort[cslug]) {
        try { sqlAbort[cslug].abort(); } catch (e) {}
        sqlAbort[cslug] = null;
      }
      delete busy[sqlBusyKey(cslug)];
      sqlResult[cslug] = { cancelled: true, error: 'Cancelled' };
      if (!patchSqlChrome(cslug)) renderServices({ soft: true, force: true });
      showToast('Query cancelled');
    } else if (id.indexOf('sql:run:') === 0) {
      var qslug = id.slice('sql:run:'.length);
      if (busy[sqlBusyKey(qslug)]) return;
      var qel = document.getElementById('sql-'+qslug);
      var sql = qel ? qel.value : (sqlDraft[qslug] || '');
      sqlDraft[qslug] = sql;
      if (!String(sql).trim()) { showToast('Enter SQL'); return; }
      if (sqlAbort[qslug]) {
        try { sqlAbort[qslug].abort(); } catch (e) {}
      }
      var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      sqlAbort[qslug] = ac;
      var reqGen = (sqlAbort._gen = (sqlAbort._gen || 0) + 1);
      sqlAbort[qslug + ':gen'] = reqGen;
      busy[sqlBusyKey(qslug)] = true;
      if (!patchSqlChrome(qslug)) renderServices({ soft: true, force: true });
      api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(qslug) + '/query', {
        method: 'POST', body: JSON.stringify({ sql: sql }), signal: ac ? ac.signal : null
      }).then(function(res){
        if (sqlAbort[qslug + ':gen'] !== reqGen) return;
        sqlResult[qslug] = res || { ok: true, message: 'OK' };
      }).catch(function(e){
        if (sqlAbort[qslug + ':gen'] !== reqGen) return;
        var aborted = (e && (e.name === 'AbortError' || /abort|cancel/i.test(String(e.message || ''))));
        sqlResult[qslug] = aborted
          ? { cancelled: true, error: 'Cancelled' }
          : { error: (e && e.message) || 'Query failed' };
      }).finally(function(){
        if (sqlAbort[qslug + ':gen'] !== reqGen) return;
        delete busy[sqlBusyKey(qslug)];
        if (sqlAbort[qslug] === ac) sqlAbort[qslug] = null;
        if (!patchSqlChrome(qslug)) renderServices({ soft: true, force: true });
      });
    
    } else if (id.indexOf('svc:tunnel-stop:') === 0) {
      var tslug = id.slice('svc:tunnel-stop:'.length);
      if (busy['tunnel-stop:'+tslug]) return;
      busy['tunnel-stop:'+tslug] = true;
      renderServices({ soft: true, force: true });
      api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(tslug) + '/tunnel', { method: 'DELETE' })
        .then(function(svc){
          showToast('Tunnel closed');
          // merge into deployed
          deployed = (deployed || []).map(function(s){ return s.slug === tslug ? Object.assign({}, s, svc) : s; });
        })
        .catch(function(e){ showToast((e && e.message) || 'Unexpose failed'); })
        .finally(function(){ delete busy['tunnel-stop:'+tslug]; renderServices({ soft: true, force: true }); });
    } else if (id.indexOf('svc:tunnel:') === 0) {
      var eslug = id.slice('svc:tunnel:'.length);
      if (busy['tunnel:'+eslug]) return;
      busy['tunnel:'+eslug] = true;
      renderServices({ soft: true, force: true });
      showToast('Exposing via Cloudflare…');
      api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(eslug) + '/tunnel', { method: 'POST' })
        .then(function(svc){
          showToast(svc && svc.public_url ? ('Live · ' + String(svc.public_url).replace(/^https?:\/\//,'')) : 'Exposed');
          deployed = (deployed || []).map(function(s){ return s.slug === eslug ? Object.assign({}, s, svc) : s; });
          folds[eslug + ':access'] = true;
        })
        .catch(function(e){ showToast((e && e.message) || 'Expose failed'); })
        .finally(function(){ delete busy['tunnel:'+eslug]; renderServices({ soft: true, force: true }); });

} else if (id.indexOf('svc:') === 0) {
      var bits = id.split(':');
      var action = bits[1];
      var slug = bits.slice(2).join(':');
      if (action === 'stop' || action === 'restart') {
        var pwr = (deployed || []).filter(function(s){ return s.slug === slug; })[0];
        if (pwr && pwr.type === 'postgres') {
          var msg = action === 'stop'
            ? 'Stop the shared Postgres engine?\n\nAll databases on this Pi will go offline until you Start again.'
            : 'Restart the shared Postgres engine?\n\nBrief downtime for all databases.';
          if (!confirm(msg)) return;
        }
      }
      if (action === 'delete') {
        var delSvc = (deployed || []).filter(function(s){ return s.slug === slug; })[0];
        var buildingDel = !!(delSvc && (delSvc.status === 'building' || (delSvc.deployments || []).some(function(d){ return d.status === 'building' || d.status === 'queued'; })));
        var msg = buildingDel
          ? ('Delete '+slug+' while building?\n\nActive build will be stopped. Containers, clone, cache entry, and files will be removed.')
          : ('Delete '+slug+'?\n\nContainer stopped, files removed, disk freed.');
        if (!confirm(msg)) return;
      }
      if (!action) return;
      if (action === 'redeploy') {
        if (busy.deploy) return;
        runServiceJob({
          busyKey: id,
          consoleTitle: 'Redeploy · ' + slug,
          scope: activeGroup + '/' + slug,
          contextKey: 'live:' + activeGroup + '/' + slug,
          toast: 'Redeploying ' + slug,
          failToast: 'Redeploy failed',
          beforeRequest: function(){
            var cur = (deployed || []).filter(function(s){ return s.slug === slug; })[0];
            if (cur) {
              var optDeploys = (cur.deployments || []).slice();
              optDeploys.unshift({ id: 'dpl_…', status: 'building', branch: cur.branch || '', created_at: new Date().toISOString() });
              cur = Object.assign({}, cur, {
                status: 'building', running: false, last_error: '',
                deploy_id: 'dpl_…', deployments: optDeploys
              });
              deployed = (deployed || []).map(function(s){ return s.slug === slug ? cur : s; });
            }
            folds[slug + ':deploys'] = true;
            renderServices({ soft: true });
          },
          request: function(){
            return api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(slug) + '/redeploy', {method:'POST'});
          },
          onSuccess: function(svc){
            showToast(((svc && svc.status === 'building') ? 'Building ' : 'Redeployed ') + slug);
          }
        });
        return;
      }
      busy[id] = true;
      activity.userCollapsed = false;
      openActivityConsole({
        forceExpand: true, clearPin: true, reset: true, active: true,
        title: action.charAt(0).toUpperCase() + action.slice(1) + ' · ' + slug,
        scope: (activeGroup || '') + '/' + slug,
        contextKey: 'live:' + (activeGroup || '') + '/' + slug + ':' + action
      });
      renderServices({soft:true});
      var req = action === 'delete'
        ? api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(slug), {method:'DELETE'})
        : api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(slug) + '/' + action, {method:'POST'});
      req.then(function(){
          showToast(action === 'delete' ? ('Removed ' + slug + ' · disk freed') : (action + ' ' + slug));
          if (action === 'delete' && settingsSlug === slug) settingsSlug = null;
          return refreshServices();
        })
        .catch(function(e){ showToast(e.message || 'Failed'); })
        .finally(function(){ delete busy[id]; renderServices({soft:true}); });
    }
  }

  document.getElementById('app').addEventListener('click', onUiAction);
  var _modalRootEl = document.getElementById('modal-root');
  if (_modalRootEl) _modalRootEl.addEventListener('click', onUiAction);
  var _drawerRootEl = document.getElementById('drawer-root');
  if (_drawerRootEl) _drawerRootEl.addEventListener('click', onUiAction);
  var _railRootEl = document.getElementById('app-rail');
  if (_railRootEl) _railRootEl.addEventListener('click', onUiAction);

  function loadBranches(repo, preferred) {
    if (!wizard || !repo) return Promise.resolve();
    wizard.loadingBranches = true; wizard.loadingDirs = true; wizard.repo = repo; wizard.dirs = []; renderModal();
    return api('/api/github/branches?repo=' + encodeURIComponent(repo))
      .then(function(r){
        var list = r.branches || [];
        wizard.branches = list;
        var def = list.filter(function(b){ return b.default; })[0];
        wizard.branch = preferred || (def && def.name) || (list[0] && list[0].name) || 'main';
      })
      .catch(function(e){ wizard.branches = []; wizard.branch = preferred || 'main'; showToast(e.message || 'Branches failed'); })
      .finally(function(){
        wizard.loadingBranches = false; renderModal();
        return loadDirs();
      });
  }
  function loadDirs() {
    if (!wizard || !wizard.repo) return Promise.resolve();
    wizard.loadingDirs = true; renderModal();
    var q = '/api/github/dirs?repo=' + encodeURIComponent(wizard.repo) + '&branch=' + encodeURIComponent(wizard.branch || 'main');
    return api(q)
      .then(function(r){ wizard.dirs = r.dirs || []; })
      .catch(function(){ wizard.dirs = []; })
      .finally(function(){ wizard.loadingDirs = false; renderModal(); });
  }

  /* === 09-activity.js === */
  var _activityWasOpen = false;
  var _activityFreshLoad = true; // first snapshot after page load = clean boot
  var activity = {
    seq: 0, active: false, title: '', scope: '', ok: null, lines: [],
    progress: null, deployment_id: '',
    viewDeploy: '', viewGroup: '', viewSlug: '',
    open: false, collapsed: false, userCollapsed: false, follow: true
  };
  var activityPoll = null;
  var _actRendered = 0;
  var _actSeqRendered = -1;
  var _actScrollBound = false;
  var _apStepsKey = '';
  var _apPctShown = -1;
  var _apLabelShown = '';

  function activityLinesText() {
    return (activity.lines || []).map(function(line){
      var at = line && line.at ? String(line.at) : '';
      var tx = line && line.text != null ? String(line.text) : '';
      return at ? (at + '  ' + tx) : tx;
    }).join('\n');
  }

  function isSelectingIn(el) {
    if (!el) return false;
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    try {
      var node = sel.anchorNode;
      return !!(node && el.contains(node.nodeType === 1 ? node : node.parentNode));
    } catch (e) {
      return false;
    }
  }

  function nearBottom(log, px) {
    return log.scrollHeight - log.scrollTop - log.clientHeight < (px || 40);
  }

  function setActivityFollow(on) {
    activity.follow = !!on;
    var btn = document.getElementById('activity-follow');
    if (btn) btn.hidden = activity.follow;
    var root = document.getElementById('activity');
    if (root) root.classList.toggle('paused', !activity.follow);
  }

  function activityLogCanScroll(log) {
    return !!(log && log.scrollHeight > log.clientHeight + 1);
  }

  function activityLogAtTop(log) {
    return !log || log.scrollTop <= 0;
  }

  function activityLogAtBottom(log) {
    return !log || nearBottom(log, 2);
  }

  /** Keep wheel gestures inside the logger — never chain to the page. */
  function lockActivityWheel(e, log) {
    if (!log) return;
    // Never let the page see this wheel event.
    e.stopPropagation();
    // Scrolling up while following → pause auto-follow.
    if (e.deltaY < 0 && activity.follow) setActivityFollow(false);

    var canScroll = activityLogCanScroll(log);
    var up = e.deltaY < 0;
    var down = e.deltaY > 0;
    // No overflow, or hitting an edge: block default so the document does not scroll.
    if (!canScroll || (up && activityLogAtTop(log)) || (down && activityLogAtBottom(log))) {
      e.preventDefault();
    }
  }

  function bindActivityScroll() {
    if (_actScrollBound) return;
    var log = document.getElementById('activity-log');
    if (!log) return;
    _actScrollBound = true;
    var ticking = false;
    log.addEventListener('scroll', function(){
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function(){
        ticking = false;
        if (!document.getElementById('activity-log')) return;
        if (nearBottom(log, 48)) {
          if (!activity.follow) setActivityFollow(true);
        } else if (activity.follow) {
          setActivityFollow(false);
        }
      });
    }, {passive: true});
    // passive:false required so preventDefault can stop page scroll.
    log.addEventListener('wheel', function(e){
      lockActivityWheel(e, log);
    }, {passive: false});
    // Also trap wheel on the activity chrome (header/progress) so page doesn't jump.
    var root = document.getElementById('activity');
    if (root && !root._fwWheelLock) {
      root._fwWheelLock = true;
      root.addEventListener('wheel', function(e){
        if (e.target === log || (log && log.contains(e.target))) return; // handled above
        e.preventDefault();
        e.stopPropagation();
      }, {passive: false});
    }
  }

  function alogHTML(line) {
    return '<div class="alog '+esc(line.level || 'info')+'">'
      +'<span class="at">'+esc(line.at || '')+'</span>'
      +'<span class="tx">'+esc(line.text || '')+'</span>'
      +'</div>';
  }

  function renderActivityLines(log, force) {
    var lines = activity.lines || [];
    var selecting = !force && isSelectingIn(log);

    // New job / reset
    if (activity.seq !== _actSeqRendered || lines.length < _actRendered) {
      if (selecting) return false;
      if (!lines.length && activity.active) {
        log.innerHTML = '<div class="alog info"><span class="at"></span><span class="tx">Waiting for steps…</span></div>';
        _actRendered = 0;
      } else {
        log.innerHTML = lines.map(alogHTML).join('');
        _actRendered = lines.length;
      }
      _actSeqRendered = activity.seq;
      return true;
    }

    // Append only — preserves selection on earlier lines
    if (lines.length > _actRendered) {
      var html = '';
      for (var i = _actRendered; i < lines.length; i++) html += alogHTML(lines[i]);
      log.insertAdjacentHTML('beforeend', html);
      _actRendered = lines.length;
      return true;
    }

    if (!lines.length && activity.active && !_actRendered) {
      if (selecting) return false;
      log.innerHTML = '<div class="alog info"><span class="at"></span><span class="tx">Waiting for steps…</span></div>';
    }
    return true;
  }

  function progressStepsKey(p) {
    if (!p || !p.steps) return '';
    return (p.steps || []).map(function(s){ return (s.id || '') + ':' + (s.status || ''); }).join('|');
  }

  function patchActivityProgress() {
    var wrap = document.getElementById('activity-progress');
    if (!wrap) return;
    var p = activity.progress;
    var show = !!(p && p.steps && p.steps.length);
    wrap.hidden = !show;
    if (!show) {
      _apStepsKey = '';
      _apPctShown = -1;
      return;
    }

    var pct = Math.max(0, Math.min(100, Number(p.percent) || 0));
    if (!activity.active && (activity.ok === true || activity.ok === false)) pct = 100;
    var label = p.label || 'Working…';
    if (p.detail) label = label + ' · ' + p.detail;
    if (p.index > 0 && p.total > 0 && activity.active) {
      label = 'Step ' + p.index + ' of ' + p.total + ' · ' + (p.label || 'Working…');
      if (p.detail) label += ' · ' + p.detail;
    }

    var stepEl = document.getElementById('ap-step');
    var remainEl = document.getElementById('ap-remain');
    var pctEl = document.getElementById('ap-pct');
    var fill = document.getElementById('ap-fill');
    var bar = document.getElementById('ap-bar');
    var list = document.getElementById('ap-steps');

    function bump(el) {
      if (!el) return;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
    if (stepEl) {
      if (label !== _apLabelShown) {
        stepEl.textContent = label;
        bump(stepEl);
        _apLabelShown = label;
      }
    }
    if (remainEl) {
      remainEl.textContent = activity.active ? (p.remaining || '') : '';
      remainEl.hidden = !activity.active || !p.remaining;
    }
    if (pctEl && _apPctShown !== pct) {
      pctEl.textContent = pct + '%';
      bump(pctEl);
      _apPctShown = pct;
    }
    if (fill) fill.style.width = pct + '%';
    if (bar) bar.setAttribute('aria-valuenow', String(pct));

    var key = progressStepsKey(p);
    if (list && key !== _apStepsKey) {
      _apStepsKey = key;
      list.innerHTML = (p.steps || []).map(function(s){
        var st = s.status || 'pending';
        return '<li class="'+esc(st)+'" title="'+esc(s.label || '')+'">'
          +'<span class="dot" aria-hidden="true"></span>'
          +'<span>'+esc(s.label || s.id || '')+'</span>'
          +'</li>';
      }).join('');
      var activeLi = list.querySelector('li.active');
      bump(activeLi);
    }
  }

  /**
   * Wipe the console to a clean context. Call before every new job,
   * history view, or app-log view so stale lines never linger.
   */
  function resetActivityConsole(opts) {
    opts = opts || {};
    if (typeof clearDeployLogView === 'function' && opts.clearPin !== false) {
      // keep pin clear unless viewing history (caller sets viewDeploy after)
      if (!opts.keepPin) clearDeployLogView();
    }
    activity.lines = [];
    activity.progress = null;
    activity.active = !!opts.active;
    activity.ok = null;
    activity.title = opts.title != null ? opts.title : '';
    activity.scope = opts.scope != null ? opts.scope : '';
    activity.deployment_id = opts.deploymentId || '';
    activity.contextKey = opts.contextKey || '';
    activity.seq = (activity.seq || 0) + 1;
    activity.follow = true;
    if (opts.open) {
      activity.open = true;
      activity.userCollapsed = false;
      activity.collapsed = false;
    }
    _actRendered = 0;
    _actSeqRendered = -1;
    _apStepsKey = '';
    _apPctShown = -1;
    _apLabelShown = '';
    var log = document.getElementById('activity-log');
    if (log) log.innerHTML = '';
    var prog = document.getElementById('activity-progress');
    if (prog) prog.hidden = true;
    if (opts.patch !== false) patchActivity();
  }

  function applyActivity(snap, opts) {
    opts = opts || {};
    if (!snap) return;

    // First snapshot after full page load (GET or SSE) is always a clean boot.
    if (_activityFreshLoad) {
      opts = Object.assign({}, opts, { boot: true });
      _activityFreshLoad = false;
    }

    // Page boot / soft refresh: never reuse a finished job's console.
    // Only resume if a job is still actively running.
    if (opts.boot) {
      clearDeployLogView();
      if (!snap.active) {
        activity.open = false;
        activity.active = false;
        activity.lines = [];
        activity.progress = null;
        activity.title = '';
        activity.scope = '';
        activity.ok = null;
        activity.deployment_id = '';
        activity.contextKey = '';
        activity.seq = snap.seq || 0;
        _activityWasOpen = false;
        _actRendered = 0;
        _actSeqRendered = -1;
        var root = document.getElementById('activity');
        if (root) {
          root.hidden = true;
          root.className = 'activity';
          var log = document.getElementById('activity-log');
          if (log) log.innerHTML = '';
          var prog = document.getElementById('activity-progress');
          if (prog) prog.hidden = true;
        }
        try { sessionStorage.removeItem('fw.deployLogs'); } catch (e) {}
        patchActivity();
        syncActivityPoll();
        return;
      }
      // Live job in progress — take over that context cleanly.
      activity.contextKey = 'live:' + (snap.scope || snap.deployment_id || snap.title || 'job');
    }

    // Idle empty snapshot must not wipe a finished console still on screen.
    if (!opts.boot && !opts.fromHistory && !snap.active && !(snap.lines && snap.lines.length)) {
      if (activity.open && activity.lines && activity.lines.length) return;
      if (!activity.open) return;
    }

    // Pinned deploy history: only accept matching live stream.
    if (activity.viewDeploy && !opts.fromHistory) {
      var liveId = snap.deployment_id || '';
      if (liveId && liveId === activity.viewDeploy) {
        // same deploy — fall through
      } else if (snap.active && liveId && liveId !== activity.viewDeploy) {
        return; // different live job — keep pinned history
      } else if (!opts.forceOpen) {
        return;
      }
    }

    var prevSeq = activity.seq;
    var prevKey = activity.contextKey || '';
    var nextKey = activity.viewDeploy
      ? ('history:' + activity.viewDeploy)
      : (snap.active
          ? ('live:' + (snap.scope || snap.deployment_id || snap.title || 'job'))
          : (opts.fromHistory ? (activity.contextKey || '') : ''));

    // New live job (seq bump while active) → hard reset before applying lines.
    var newLiveJob = !opts.fromHistory && !!snap.active && (snap.seq || 0) !== prevSeq && !activity.viewDeploy;
    if (newLiveJob || (nextKey && prevKey && nextKey !== prevKey && snap.active && !opts.fromHistory)) {
      var logEl = document.getElementById('activity-log');
      if (logEl) logEl.innerHTML = '';
      _actRendered = 0;
      _actSeqRendered = -1;
      _apStepsKey = '';
      _apPctShown = -1;
      _apLabelShown = '';
      activity.follow = true;
    }

    activity.seq = snap.seq || 0;
    activity.active = !!snap.active;
    activity.title = snap.title || '';
    activity.scope = snap.scope || '';
    activity.ok = snap.ok;
    activity.lines = snap.lines || [];
    activity.progress = snap.progress || null;
    activity.deployment_id = snap.deployment_id || '';
    if (opts.fromHistory && opts.viewDeploy) {
      activity.viewDeploy = opts.viewDeploy;
      activity.viewGroup = opts.viewGroup || '';
      activity.viewSlug = opts.viewSlug || '';
      activity.contextKey = 'history:' + opts.viewDeploy;
    } else if (snap.active) {
      activity.contextKey = 'live:' + (snap.scope || snap.deployment_id || snap.title || 'job');
    }

    if (activity.seq !== prevSeq) {
      activity.follow = true;
      _actRendered = 0;
      _actSeqRendered = -1;
      _apStepsKey = '';
      _apPctShown = -1;
      _apLabelShown = '';
    }

    // Only auto-open for live work or explicit open (history / user action).
    // Never reopen a finished job just because lines still sit in the hub.
    if (snap.active || opts.forceOpen || opts.fromHistory) {
      activity.open = true;
      if (!activity.userCollapsed) activity.collapsed = false;
    }

    patchActivity();
    syncActivityPoll();
  }

  function clearDeployLogView() {
    activity.viewDeploy = '';
    activity.viewGroup = '';
    activity.viewSlug = '';
    try { sessionStorage.removeItem('fw.deployLogs'); } catch (e) {}
  }

  function persistDeployLogView(group, slug, id) {
    try {
      sessionStorage.setItem('fw.deployLogs', JSON.stringify({ group: group, slug: slug, id: id }));
    } catch (e) {}
  }

  /** Open Activity with durable logs for one deployment (explicit click only). */
  function openDeployLogs(group, slug, deployId, meta) {
    meta = meta || {};
    group = String(group || activeGroup || '');
    slug = String(slug || '');
    deployId = String(deployId || '');
    if (!group || !slug || !deployId) return;
    resetActivityConsole({
      open: true,
      keepPin: true,
      title: meta.title || ('Deploy · ' + deployId),
      scope: group + '/' + slug,
      deploymentId: deployId,
      contextKey: 'history:' + deployId,
      active: false
    });
    activity.viewDeploy = deployId;
    activity.viewGroup = group;
    activity.viewSlug = slug;
    // Do not persist across full page refresh — refresh stays clean.
    try { sessionStorage.removeItem('fw.deployLogs'); } catch (e) {}
    syncActivityPoll();
    var path = '/api/groups/' + encodeURIComponent(group)
      + '/services/' + encodeURIComponent(slug)
      + '/deployments/' + encodeURIComponent(deployId) + '/logs';
    api(path).then(function(r){
      var lines = (r && r.lines) || [];
      var liveSame = !!(activity.active && activity.deployment_id === deployId);
      // Prefer live ring if this deploy is currently building and has more lines.
      if (liveSame && activity.lines && activity.lines.length > lines.length) {
        lines = activity.lines;
      }
      applyActivity({
        seq: (activity.seq || 0) + 1,
        active: liveSame,
        title: 'Deploy · ' + deployId,
        scope: group + '/' + slug,
        deployment_id: deployId,
        ok: liveSame ? activity.ok : null,
        progress: liveSame ? activity.progress : null,
        lines: lines
      }, { fromHistory: true, forceOpen: true, viewDeploy: deployId, viewGroup: group, viewSlug: slug });
      // If live, refresh from /api/activity so SSE/poll keeps appending.
      if (liveSame) {
        api('/api/activity').then(function(s){
          if (s && s.deployment_id === deployId) applyActivity(s);
        }).catch(function(){});
      }
    }).catch(function(e){
      showToast((e && e.message) || 'Failed to load deploy logs');
    });
  }

  /** Map a raw log line to activity levels: step|info|cmd|out|ok|warn|err. Prefer slog/zerolog level= keys. */
  function classifyLogLine(text) {
    var s = String(text || '').trim();
    if (!s) return 'out';
    var low = s.toLowerCase();
    var m = low.match(/(?:^|\s)level\s*[=:]\s*([a-z]+)/);
    if (m) {
      var lv = m[1];
      if (lv === 'error' || lv === 'err' || lv === 'fatal' || lv === 'panic') return 'err';
      if (lv === 'warn' || lv === 'warning') return 'warn';
      if (lv === 'info' || lv === 'debug' || lv === 'trace') return 'info';
      return 'out';
    }
    if (/^(panic|fatal|error|err)\b/.test(low)) return 'err';
    if (/^(warning|warn)\b/.test(low)) return 'warn';
    if (/\bpanic:/.test(low) || /\bfatal error\b/.test(low)) return 'err';
    return 'out';
  }

  function linesFromText(text) {
    return String(text || '').split('\n').filter(function(l){ return l.trim(); }).map(function(l, i){
      return { seq: i + 1, at: '', level: classifyLogLine(l), text: l };
    });
  }

  function activityOkFromLines(lines) {
    var hasErr = false;
    var hasWarn = false;
    (lines || []).forEach(function(line){
      if (!line) return;
      if (line.level === 'err') hasErr = true;
      else if (line.level === 'warn') hasWarn = true;
    });
    if (hasErr) return false;
    if (hasWarn) return null;
    return null;
  }

  function openServiceCrashLogs(group, slug) {
    group = String(group || activeGroup || '');
    slug = String(slug || '');
    if (!group || !slug) return;
    resetActivityConsole({
      open: true,
      title: 'App logs · ' + slug,
      scope: group + '/' + slug,
      contextKey: 'logs:' + group + '/' + slug,
      active: false
    });
    activity.lines = [{ seq: 1, at: '', level: 'info', text: 'Fetching container logs…' }];
    patchActivity();
    var path = '/api/groups/' + encodeURIComponent(group)
      + '/services/' + encodeURIComponent(slug) + '/logs?lines=120';
    api(path).then(function(r){
      var text = (r && r.logs) || '';
      var lines = linesFromText(text);
      if (!lines.length) {
        lines = [{ seq: 1, at: '', level: 'warn', text: 'No container logs yet — Start/Redeploy to produce output.' }];
      }
      applyActivity({
        seq: (activity.seq || 0) + 1,
        active: false,
        title: 'App logs · ' + slug,
        scope: group + '/' + slug,
        ok: activityOkFromLines(lines),
        progress: null,
        lines: lines
      }, { fromHistory: true, forceOpen: true });
    }).catch(function(e){
      showToast((e && e.message) || 'Failed to load logs');
    });
  }

  function restoreDeployLogView() {
    // Intentionally empty: page refresh must start with a clean console.
    // Deploy logs open only via explicit click.
    try { sessionStorage.removeItem('fw.deployLogs'); } catch (e) {}
  }

  function anyServiceBuilding() {
    return (deployed || []).some(function(s){
      if (!s) return false;
      if (s.status === 'building') return true;
      return (s.deployments || []).some(function(d){ return d.status === 'building' || d.status === 'queued'; });
    });
  }

  var _svcSoftTick = 0;
  function syncActivityPoll() {
    var need = activity.active || busy.deploy || anyServiceBuilding() || Object.keys(busy).some(function(k){
      return k.indexOf('svc:') === 0 || k.indexOf('wizard:') === 0 || k.indexOf('group:') === 0 || k.indexOf('engine:') === 0 || k.indexOf('docker:') === 0;
    });
    if (need) {
      if (!activityPoll) {
        activityPoll = setInterval(function(){
          api('/api/activity').then(function(s){
            var wasActive = activity.active;
            applyActivity(s);
            // Job vanished (crash/restart) while UI still thinks a build is running.
            if (wasActive && !activity.active && (busy.deploy || anyServiceBuilding()) && typeof refreshServices === 'function') {
              delete busy.deploy;
              refreshServices({ soft: true });
            }
          }).catch(function(){});
          if (busy.deploy || activity.deployment_id || activity.active || anyServiceBuilding()) {
            _svcSoftTick++;
            if (_svcSoftTick % 2 === 0 && typeof refreshServices === 'function') {
              refreshServices({ soft: true });
            }
          }
        }, 450);
      }
    } else if (activityPoll) {
      clearInterval(activityPoll);
      activityPoll = null;
      _svcSoftTick = 0;
    }
  }

  function closeActivityAnimated() {
    var root = document.getElementById('activity');
    if (!activity.open) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!root || reduce || root.hidden) {
      activity.open = false;
      if (typeof clearDeployLogView === 'function') clearDeployLogView();
      activity.userCollapsed = false;
      _activityWasOpen = false;
      patchActivity();
      return;
    }
    if (root.classList.contains('closing')) return;
    root.classList.add('closing');
    setTimeout(function(){
      activity.open = false;
      if (typeof clearDeployLogView === 'function') clearDeployLogView();
      activity.userCollapsed = false;
      _activityWasOpen = false;
      root.classList.remove('closing');
      patchActivity();
    }, 360);
  }

  function patchActivity() {
    var root = document.getElementById('activity');
    if (!root) return;
    bindActivityScroll();
    var has = activity.lines && activity.lines.length;
    var hasProg = !!(activity.progress && activity.progress.steps && activity.progress.steps.length);
    var show = activity.open && (has || activity.active || hasProg);
    var wasClosing = root.classList.contains('closing');
    var revealing = show && !_activityWasOpen;
    var tone = '';
    if (activity.ok === true) tone = 'ok';
    else if (activity.ok === false) tone = 'err';
    else {
      var sawErr = false;
      var sawWarn = false;
      (activity.lines || []).forEach(function(line){
        if (!line) return;
        if (line.level === 'err') sawErr = true;
        else if (line.level === 'warn') sawWarn = true;
      });
      if (sawErr) tone = 'err';
      else if (sawWarn) tone = 'warn';
    }
    root.className = 'activity'
      + (show || wasClosing ? ' open' : '')
      + (wasClosing ? ' closing' : '')
      + (revealing ? ' reveal' : '')
      + (activity.collapsed ? ' collapsed' : '')
      + (activity.active ? ' running' : '')
      + (tone === 'ok' ? ' ok' : '')
      + (tone === 'err' ? ' err' : '')
      + (tone === 'warn' ? ' warn' : '')
      + (activity.follow ? '' : ' paused');
    if (!wasClosing) {
      root.hidden = !show;
    }
    if (revealing) {
      setTimeout(function(){ root.classList.remove('reveal'); }, 460);
    }
    _activityWasOpen = !!show;


    var title = document.getElementById('activity-title');
    var scope = document.getElementById('activity-scope');
    var status = document.getElementById('activity-status');
    var log = document.getElementById('activity-log');
    var followBtn = document.getElementById('activity-follow');
    if (title) title.textContent = activity.title || 'Activity';
    if (scope) {
      scope.textContent = activity.scope || '';
      scope.hidden = !activity.scope;
    }
    if (status) {
      status.classList.remove('pct');
      if (activity.active && activity.progress && typeof activity.progress.percent === 'number') {
        status.textContent = activity.progress.percent + '%';
        status.classList.add('pct');
      } else if (activity.active) status.textContent = 'Running';
      else if (activity.ok === true || tone === 'ok') status.textContent = 'Done';
      else if (activity.ok === false || tone === 'err') status.textContent = 'Failed';
      else if (tone === 'warn') status.textContent = 'Warnings';
      else status.textContent = '';
    }
    var tog = root.querySelector('[data-action="activity:toggle"]');
    if (tog) tog.textContent = activity.collapsed ? 'Expand' : 'Collapse';
    if (followBtn) followBtn.hidden = activity.follow;

    patchActivityProgress();

    if (log && !activity.collapsed) {
      var updated = renderActivityLines(log, false);
      if (updated !== false && activity.follow) {
        log.scrollTop = log.scrollHeight;
      }
    }
  }

  function watchActivity() {
    api('/api/activity').then(function(s){
      applyActivity(s, { boot: true });
    }).catch(function(){
      try { sessionStorage.removeItem('fw.deployLogs'); } catch (e) {}
    });
  }

  /* === 10-events.js === */
  document.getElementById('app').addEventListener('change', function(e) {
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-dock-opt')) {
      var key = e.target.getAttribute('data-dock-opt');
      if (!dockerOpts) dockerOpts = {};
      dockerOpts[key] = !!e.target.checked;
      return;
    }
    // custom selects handle their own picks
  });
  document.addEventListener('click', function(e) {
    if (!picker) return;
    if (e.target.closest && e.target.closest('.cselect')) return;
    var closing = picker;
    setTimeout(function(){
      if (picker !== closing) return;
      picker = null;
      if (wizard) renderModal();
      else renderServices({soft:true});
    }, 0);
  });
  function onUiInput(e) {
    if (e.target && e.target.classList && e.target.classList.contains('cselect-search')) {
      if (!picker) {
        var host = e.target.closest('.cselect');
        if (host && host.getAttribute('data-cselect')) {
          picker = { id: host.getAttribute('data-cselect'), query: '', caret: 0 };
        } else {
          return;
        }
      }
      picker.query = e.target.value || '';
      picker.caret = e.target.selectionStart;
      // In-place filter — do not remount modal (that broke search focus/filtering).
      filterOpenCselect();
      return;
    }
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-res')) {
      var panel = e.target.closest('[data-res-panel]');
      syncResLabels(panel);
      if (wizard && wizard.step === 'go') {
        if (e.target.id === 'wiz-mem' || e.target.name === 'memory_mb') wizard.memory_mb = parseInt(e.target.value, 10) || 512;
        if (e.target.id === 'wiz-cpu' || e.target.name === 'cpus') wizard.cpus = Math.round((parseFloat(e.target.value) || 1) * 10) / 10;
      }
      if (wizard && wizard.step === 'go') {
        var sum = document.querySelector('#modal-root .fold.open .fold-summary');
        if (sum) {
          var m = wizard.memory_mb || 512;
          var c = wizard.cpus || 1;
          sum.textContent = m + ' MB · ' + c + ' CPU' + (wizard.build_cmd ? ' · custom' : '');
        }
      }
      return;
    }
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-dock-opt')) {
      var key = e.target.getAttribute('data-dock-opt');
      if (!dockerOpts) dockerOpts = {};
      dockerOpts[key] = !!e.target.checked;
      return;
    }
    if (e.target && e.target.id === 'wiz-env' && wizard) {
      wizard.env = e.target.value || '';
      syncWizEnvConflictUI(wizard.env, wizard.linked_database || '');
      return;
    }
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-name-compose')) {
      if (wizard && e.target.id === 'wiz-pg-name') wizard.name = e.target.value || '';
      syncNameComposePreview(e.target);
      return;
    }
    if (e.target.closest && e.target.closest('#config-form')) formDirty = true;
  }
  document.getElementById('app').addEventListener('input', onUiInput);
  var _modalRootInput = document.getElementById('modal-root');
  if (_modalRootInput) _modalRootInput.addEventListener('input', onUiInput);
  var _drawerRootInput = document.getElementById('drawer-root');
  if (_drawerRootInput) _drawerRootInput.addEventListener('input', onUiInput);
  function onUiChange(e) {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('#drawer-root .settings') || e.target.closest('.svc-card .settings')) {
      captureSettingsDrafts();
    }
  }
  if (_drawerRootInput) _drawerRootInput.addEventListener('change', onUiChange);
  document.getElementById('app').addEventListener('change', onUiChange);
  document.getElementById("app").addEventListener("keydown", onSvcCardKey);
  if (_drawerRootInput) _drawerRootInput.addEventListener("keydown", onSvcCardKey);


  window.addEventListener('resize', function(){
    if (picker) placeOpenCselect();
    if (typeof drawRwLinks === 'function') drawRwLinks();
  });
  window.addEventListener('scroll', function(){ if (picker) placeOpenCselect(); }, true);
  document.addEventListener('keydown', function(e) {
    if (typeof trapDrawerFocus === 'function') trapDrawerFocus(e);
    if (e.key === 'Escape') {
      if (settingsSlug && !wizard && !picker) {
        closeSettingsDrawer({ animate: true });
        e.preventDefault();
        return;
      }
      if (picker) {
        picker = null;
        if (wizard) renderModal();
        else renderServices({soft:true});
        e.preventDefault();
        return;
      }
      if (wizard) {
        closeWizard();
        e.preventDefault();
      }
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (!t || !t.tagName) return;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'A') return;
    if (t.isContentEditable) return;
    if (t.classList && t.classList.contains('cselect-search')) return;

    // Wizard: Enter submits the primary action for this step
    if (wizard) {
      var modal = document.querySelector('#modal-root .modal');
      if (modal && modal.contains(t)) {
        var action = modal.getAttribute('data-submit-action') || '';
        var btn = action
          ? modal.querySelector('[data-action="'+action+'"]')
          : modal.querySelector('.ui-actions .btn.primary, .wizard-actions .btn.primary, .btn.primary');
        if (btn && !btn.disabled && !btn.classList.contains('loading')) {
          e.preventDefault();
          btn.click();
        }
        return;
      }
    }

    // Settings: Enter saves
    var settings = t.closest && t.closest('.settings');
    if (settings) {
      var save = settings.querySelector('.ui-footer .btn.primary, .settings-footer .btn.primary');
      if (save && !save.disabled && !save.classList.contains('loading')) {
        e.preventDefault();
        save.click();
      }
    }
  });
  function onCselectKey(e) {
    if (!e.target || !e.target.classList || !e.target.classList.contains('cselect-search')) return;
    if (e.key !== 'Enter' || !picker) return;
    e.preventDefault();
    var list = e.target.closest('.cselect');
    if (!list) return;
    var first = list.querySelector('.cselect-item');
    if (first) first.click();
  }
  document.getElementById('app').addEventListener('keydown', onCselectKey);
  if (_modalRootInput) _modalRootInput.addEventListener('keydown', onCselectKey);
  document.getElementById('app').addEventListener('submit', function(e) {
    var form = e.target;
    if (form.id !== 'config-form') return;
    e.preventDefault();
    var fd = new FormData(form);
    busy.config = true; render();
    api('/api/config', {method:'POST', body:JSON.stringify({
      ssid: fd.get('ssid'), password: fd.get('password'), hotspot_ip: fd.get('hotspot_ip'),
      dhcp_start: fd.get('dhcp_start'), dhcp_end: fd.get('dhcp_end')
    })}).then(function(){ formDirty = false; showToast('Settings saved'); return refreshConfig(true); })
      .catch(function(err){ showToast(err.message || 'Save failed'); })
      .finally(function(){ delete busy.config; render(); });
  });

  var actEl = document.getElementById('activity');
  if (actEl) {
    actEl.addEventListener('click', function(e) {
      var el = e.target.closest('[data-action]');
      if (!el) return;
      var id = el.dataset.action;
      if (id === 'activity:toggle') {
        activity.collapsed = !activity.collapsed;
        activity.userCollapsed = !!activity.collapsed;
        var btn = el;
        if (btn && btn.tagName === 'BUTTON') btn.textContent = activity.collapsed ? 'Expand' : 'Collapse';
        patchActivity();
      } else if (id === 'activity:copy') {
        var text = activityLinesText();
        if (!text) { showToast('No logs yet'); return; }
        copyText(text).then(function(){ showToast('Logs copied'); }).catch(function(){ showToast('Copy failed'); });
      } else if (id === 'activity:follow') {
        setActivityFollow(true);
        var logEl = document.getElementById('activity-log');
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
        patchActivity();
      } else if (id === 'activity:close') {
        closeActivityAnimated();
      }
    });
  }

  
  document.getElementById('app').addEventListener('toggle', function(e) {
    if (!e.target || e.target.tagName !== 'DETAILS') return;
    if (!e.target.open && e.target.closest('#panel-vpn')) {
      // Discard unsaved hotspot edits when collapsing
      formDirty = false;
      patchLive();
    }
  }, true);

  // Clean Activity on every full page load — never show a previous job.
  (function(){
    try { sessionStorage.removeItem('fw.deployLogs'); } catch (e) {}
    var root = document.getElementById('activity');
    if (root) {
      root.hidden = true;
      root.className = 'activity';
      var log = document.getElementById('activity-log');
      if (log) log.innerHTML = '';
    }
  })();

  document.documentElement.dataset.motion = 'off';
  document.documentElement.dataset.boot = 'off';
  _routeSync = true;
  applyRoute(parseRoute(location.pathname), { render: false });
  history.replaceState({ fw: 1, path: routePath() }, '', routePath());
  _routeSync = false;
  render({animate:true});
  if (navView === 'activity') {
    activity.userCollapsed = false;
    openActivityConsole({ forceExpand: true });
  }
  refreshConfig(true);
  refreshServices();
  connectEvents();
  watchActivity();
  document.querySelectorAll('[data-res-panel]').forEach(syncResLabels);
  setInterval(function(){ if (!wizard && !picker) refreshServices(); }, 8000);

  window.addEventListener('popstate', function() {
    _routeSync = true;
    applyRoute(parseRoute(location.pathname), { animate: true });
    _routeSync = false;
  });

  document.addEventListener('input', function(e) {
    var t = e.target;
    if (!t || t.id !== 'group-name') return;
    var save = document.querySelector('.gd-save');
    if (!save) return;
    var baseline = (save.dataset.baseline != null) ? save.dataset.baseline : '';
    var dirty = String(t.value || '').trim() !== String(baseline).trim();
    save.classList.toggle('is-dirty', dirty);
    save.disabled = !dirty || save.classList.contains('loading');
  });

})();
