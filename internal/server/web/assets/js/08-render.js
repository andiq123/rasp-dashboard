
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
      var linkedBucket = prev.linked_bucket;
      if (linkedBucket == null) {
        var svcMatchB = (deployed || []).filter(function(x){ return x.slug === slug; })[0];
        linkedBucket = svcMatchB ? (svcMatchB.linked_bucket || '') : '';
      }
      var envEl = box.querySelector('textarea[name=env]');
      var typedEnv = envEl ? envEl.value : '';
      var keepEnv = typedEnv;
      if (String(typedEnv).trim() === '' && prev.env && String(prev.env).trim() !== '') {
        keepEnv = prev.env;
      }
      var svcNow = (deployed || []).filter(function(x){ return x.slug === slug; })[0];
      if (!linked && svcNow && svcNow.linked_database) linked = svcNow.linked_database;
      if (!linkedBucket && svcNow && svcNow.linked_bucket) linkedBucket = svcNow.linked_bucket;
      // Textarea shows custom keys only when DB is linked — merge DB_* back in.
      if (linked) {
        var linkedSrc = linkedEnvMapFromSources(null, prev.env || '');
        if (!RESERVED_DB_KEYS.some(function(k){ return linkedSrc[k]; }) && svcNow) {
          linkedSrc = linkedEnvMapFromSources(null, keepEnv);
        }
        keepEnv = mergeLinkedPreviewEnv(keepEnv, linkedSrc);
      }
      if (linkedBucket) {
        var bucketSrc = linkedBucketMapFromEnv(prev.env || '');
        if (!BUCKET_ENV_KEYS.some(function(k){ return bucketSrc[k]; })) {
          bucketSrc = linkedBucketMapFromEnv(keepEnv);
        }
        if (!BUCKET_ENV_KEYS.some(function(k){ return bucketSrc[k]; }) && prev.bucket_env) {
          bucketSrc = prev.bucket_env;
        }
        keepEnv = mergeLinkedPreviewEnv(keepEnv, bucketSrc, BUCKET_ENV_KEYS);
      }
      settingsDraft[slug] = {
        name: val('input[name=name]'),
        branch: val('input[name=branch]'),
        linked_database: linked,
        linked_bucket: linkedBucket,
        bucket_env: prev.bucket_env || null,
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
  var _drawerLeaving = false;
  var _drawerLeaveTimer = null;
  var _modalLeaving = false;
  var _modalLeaveTimer = null;
  var _didBoot = false;
  var _routeSync = false;

  function routePath() {
    if (navView === 'overview') return '/overview';
    if (navView === 'files' || navView === 'activity') {
      var home = (typeof FILES_HOME !== 'undefined' ? FILES_HOME : '/home/andiq');
      var fp = filesPath || home;
      if (fp === home) return '/files';
      return '/files' + fp.split('/').map(function(p){ return p ? encodeURIComponent(p) : ''; }).join('/');
    }
    if (navView === 'settings') {
      return '/settings';
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
    if (p === '/activity' || p === '/files' || p.indexOf('/files/') === 0) {
      var home = (typeof FILES_HOME !== 'undefined' ? FILES_HOME : '/home/andiq');
      var fp = home;
      if (p.indexOf('/files/') === 0) {
        try { fp = decodeURIComponent(p.slice('/files'.length)) || home; } catch (e) { fp = home; }
        if (fp.charAt(0) !== '/') fp = '/' + fp;
      }
      return { navView: 'files', filesPath: fp };
    }
    if (p === '/settings' || p === '/settings/storage') return { navView: 'settings', settingsTab: 'storage', settingsFocus: (p === '/settings/storage' ? 'storage' : 'github') };
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
    if (route.navView === 'files' || route.navView === 'activity') {
      navView = 'files';
      if (route.filesPath) filesPath = route.filesPath;
    }
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
    } else if (navView === 'files' || navView === 'activity') {
      activeGroup = null;
      settingsSlug = null;
      manageTab = 'services';
      dockerOpen = false;
    }
    ensureStatsPoll();
    if (navView === 'settings') {
      // Always load engine + Docker inventory on Settings (boot uses render:false).
      manageLoading = true;
      dockerOpen = true;
      settingsTab = 'storage';
      if (opts.render !== false) render(opts);
      refreshManage({ animate: opts.animate !== false });
      return;
    }
    if (opts.render === false) return;
    if (navView === 'projects') {
      render(opts);
      refreshServices({ soft: true });
      return;
    }
    render(opts);
    if (navView === 'files') {
      loadFiles(filesPath || (typeof FILES_HOME !== 'undefined' ? FILES_HOME : '/home/andiq'), { render: true });
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
    if (navView === 'files' || navView === 'activity') return 'files:' + (filesPath || '/');
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

  function closeWizard(opts) {
    opts = opts || {};
    if (!wizard || _modalLeaving) return;
    var root = document.getElementById('modal-root');
    var modal = root && root.querySelector('.modal');
    var back = root && root.querySelector('.modal-backdrop');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var animate = opts.animate !== false && !reduce && modal && !root.hidden;

    function finish() {
      _modalLeaving = false;
      if (_modalLeaveTimer) { clearTimeout(_modalLeaveTimer); _modalLeaveTimer = null; }
      wizard = null;
      picker = null;
      renderModal();
    }

    if (!animate) {
      finish();
      return;
    }
    _modalLeaving = true;
    if (modal) {
      modal.classList.remove('enter');
      modal.classList.add('leaving');
    }
    if (back) {
      back.classList.remove('enter');
      back.classList.add('leaving');
    }
    if (_modalLeaveTimer) clearTimeout(_modalLeaveTimer);
    _modalLeaveTimer = setTimeout(finish, 220);
  }

  /** Swap only the services nav-page — keeps VPN/monitoring mounted (fast). */
  function softServicesKey() {
    var bits = [navView || '', settingsTab || '', activeGroup || '', settingsSlug || '', manageTab || '', 'z:' + (canvasZoom || 1)];
    try {
      bits.push('folds:' + Object.keys(folds || {}).filter(function(k){ return folds[k]; }).sort().join(','));
    } catch (e) {}
    (deployed || []).forEach(function(s){
      if (!s) return;
      var b = 0;
      (s.deployments || []).forEach(function(d){ if (d && (d.status === 'building' || d.status === 'queued')) b++; });
      bits.push([
        s.slug, s.status || '', s.running ? 1 : 0, s.linked_database || '', s.linked_bucket || '', s.public_url || '',
        s.active_deploy_id || '', s.deploy_id || '', b,
        (settingsDraft[s.slug] && countEnvKeys(settingsDraft[s.slug].env || '')) || 0,
        envReveal[s.slug] ? 1 : 0,
        envReveal[s.slug + ':link'] ? 1 : 0,
        envReveal[s.slug + ':env'] ? 1 : 0
      ].join(':'));
    });
    bits.push('busy:' + Object.keys(busy || {}).sort().join(','));
    bits.push('err:' + String(servicesError || '') + ':' + String(groupsError || '') + ':' + (navLoading ? 1 : 0));
    if (navView === 'files') {
      bits.push('files:' + (filesPath || '/') + ':' + (filesLoading ? 1 : 0) + ':' + ((filesListing && filesListing.summary && filesListing.summary.entry_count) || 0) + ':' + (filesShowHidden ? 1 : 0) + '|' + String(filesQuery || ''));
    }
    if (navView === 'settings') {
      var engRun = (engineView && engineView.postgres_running) ? 1 : 0;
      var engBusy = (busy['engine:start'] || busy['engine:stop'] || busy['engine:save']) ? 1 : 0;
      var daemonRun = (manageOv && manageOv.daemon && manageOv.daemon.running) ? 1 : 0;
      var daemonBusy = (busy['docker:daemon-start'] || busy['docker:daemon-stop']) ? 1 : 0;
      var dockN = 0;
      try {
        dockN = ((((manageOv && manageOv.docker) || dockerInv || {}).containers) || []).length;
      } catch (e) {}
      bits.push('stor:' + (manageLoading ? 1 : 0) + ':' + (manageOv ? 1 : 0) + ':' + String(manageError || '')
        + ':e' + engRun + ':b' + engBusy + ':d' + daemonRun + ':db' + daemonBusy + ':c' + dockN);
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
      files: '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M3 11h18"/></svg>',
      settings: '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
    };
    return ''
      +'<div class="rail-brand" title="FireWifi"><span class="rail-mark">FW</span><span class="rail-name">FireWifi</span></div>'
      +'<div class="rail-nav">'
        +item('overview', 'Overview', icons.overview)
        +item('projects', 'Projects', icons.projects)
        +item('files', 'Files', icons.files)
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
    var backdrop = root.querySelector('.svc-drawer-backdrop');
    if (drawer) {
      drawer.classList.remove('enter', 'leaving');
      if (backdrop) backdrop.classList.remove('leaving');
      if (opening) {
        if (backdrop) {
          backdrop.classList.remove('enter');
          void backdrop.offsetWidth;
          backdrop.classList.add('enter');
        }
        drawer.classList.add('enter');
        if (_drawerEnterTimer) clearTimeout(_drawerEnterTimer);
        _drawerEnterTimer = setTimeout(function(){
          if (drawer) drawer.classList.remove('enter');
          if (backdrop) backdrop.classList.remove('enter');
          _drawerEnterTimer = null;
        }, 320);
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
    if (navView === 'files' || navView === 'activity') {
      return '<div class="layout layout-main layout-files">' + services(s) + '</div>';
    }
    return '<div class="layout layout-empty"></div>';
  }

  function openServiceSettings(sslug) {
    if (!sslug) return;
    if (settingsSlug === sslug) {
      closeSettingsDrawer({ animate: true });
      return;
    }
    if (_drawerLeaving) {
      // Interrupt leave so a new open can proceed immediately.
      if (_drawerLeaveTimer) { clearTimeout(_drawerLeaveTimer); _drawerLeaveTimer = null; }
      _drawerLeaving = false;
      var prevLeave = settingsSlug;
      settingsSlug = null;
      if (prevLeave) {
        Object.keys(folds).forEach(function(k){ if (k.indexOf(prevLeave+':')===0) delete folds[k]; });
      }
      renderDrawerPortal();
    }
    if (settingsSlug) {
      var prev = settingsSlug;
      Object.keys(folds).forEach(function(k){ if (k.indexOf(prev+':')===0) delete folds[k]; });
    }
    settingsSlug = sslug;
    var svc = (deployed || []).filter(function(x){ return x.slug === sslug; })[0];
    Object.keys(folds).forEach(function(k){ if (k.indexOf(sslug+':')===0) folds[k] = false; });
    var openDeploys = !!(svc && svc.type === 'go' && (
      (svc.deployments && svc.deployments.length) ||
      svc.status === 'building' ||
      (svc.deployments || []).some(function(d){ return d.status === 'building' || d.status === 'queued'; })
    ));
    folds[sslug + (openDeploys ? ':deploys' : ':access')] = true;
    settingsDraft[sslug] = {
      name: svc ? svc.name : '', branch: svc ? svc.branch : 'main',
      linked_database: svc ? (svc.linked_database || '') : '',
      linked_bucket: svc ? (svc.linked_bucket || '') : '',
      bucket_env: (settingsDraft[sslug] && settingsDraft[sslug].bucket_env) || null,
      root_dir: svc ? (svc.root_dir || '') : '',
      env: (settingsDraft[sslug] && settingsDraft[sslug].env) || '',
      build_cmd: svc ? (svc.build_cmd || '') : '',
      memory_mb: svc ? (svc.memory_mb || 512) : 512,
      cpus: svc ? (svc.cpus || 1) : 1,
      auto_deploy: !!(svc && svc.auto_deploy)
    };
    // Prefetch bucket credentials so the board is not stuck on "linking…"
    if (svc && svc.type === 'go' && settingsDraft[sslug].linked_bucket && !settingsDraft[sslug].bucket_env) {
      (function(appSlug, bSlug){
        api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(bSlug) + '/env')
          .then(function(r){
            if (!settingsDraft[appSlug] || settingsDraft[appSlug].linked_bucket !== bSlug) return;
            settingsDraft[appSlug].bucket_env = bucketEnvMapForService(
              (deployed || []).filter(function(x){ return x.slug === bSlug; })[0],
              r.env || r.env_json || ''
            );
            if (settingsSlug === appSlug) {
              renderDrawerPortal({ patchBody: true });
            }
          })
          .catch(function(){});
      })(sslug, settingsDraft[sslug].linked_bucket);
    }
    renderServices({ soft: true, force: true });
    syncRouteFromState();
    if (svc && svc.type === 'go') {
      loadServiceEnv(sslug).then(function(next){
        if (!next || settingsSlug !== sslug) return;
        if (!settingsDraft[sslug]) settingsDraft[sslug] = {};
        settingsDraft[sslug].env = next;
        renderServices({ soft: true, force: true, _skipEnvSync: true });
      }).catch(function(){});
    } else if (svc && (svc.type === 'postgres' || svc.type === 'bucket')) {
      loadServiceEnv(sslug).then(function(next){
        if (!next || settingsSlug !== sslug) return;
        if (!settingsDraft[sslug]) settingsDraft[sslug] = {};
        settingsDraft[sslug].env = next;
        renderServices({ soft: true, force: true, _skipEnvSync: true });
      }).catch(function(){});
    }
  }

  function closeSettingsDrawer(opts) {
    opts = opts || {};
    if (!settingsSlug || _drawerLeaving) return;
    var root = document.getElementById('drawer-root');
    var drawer = root && root.querySelector('.svc-drawer');
    var back = root && root.querySelector('.svc-drawer-backdrop');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var animate = opts.animate !== false && !reduce && drawer && root && !root.hidden;

    function finish() {
      _drawerLeaving = false;
      if (_drawerLeaveTimer) { clearTimeout(_drawerLeaveTimer); _drawerLeaveTimer = null; }
      var prev = settingsSlug;
      settingsSlug = null;
      if (prev) {
        Object.keys(folds).forEach(function(k){ if (k.indexOf(prev+':')===0) delete folds[k]; });
      }
      renderDrawerPortal();
      renderServices(opts.renderOpts || { animate: true });
      syncRouteFromState();
    }

    if (!animate) {
      finish();
      return;
    }
    _drawerLeaving = true;
    if (drawer) {
      drawer.classList.remove('enter');
      drawer.classList.add('leaving');
    }
    if (back) back.classList.add('leaving');
    setDrawerA11y(false);
    if (_drawerLeaveTimer) clearTimeout(_drawerLeaveTimer);
    _drawerLeaveTimer = setTimeout(finish, 250);
  }
  var CANVAS_CARD_W = 236;
  var CANVAS_CARD_H = 148;
  var CANVAS_GAP_X = 48;
  var CANVAS_GAP_Y = 36;
  var CANVAS_PAD = 28;
  var _layoutSaveTimer = null;

  function ensureCanvasPositions(list) {
    if (!canvasLayout) canvasLayout = { nodes: {} };
    if (!canvasLayout.nodes) canvasLayout.nodes = {};
    var missing = [];
    (list || []).forEach(function(svc){
      if (!svc || !svc.slug) return;
      var n = canvasLayout.nodes[svc.slug];
      if (!n || n.x == null || n.y == null) missing.push(svc);
    });
    if (!missing.length) return;
    var arranged = autoArrangePositions(list);
    missing.forEach(function(svc){
      if (arranged[svc.slug]) canvasLayout.nodes[svc.slug] = arranged[svc.slug];
    });
    saveCanvasLayout(false);
  }

  function autoArrangePositions(list) {
    // Simple 2-column grid: storage (DB/bucket) left, apps right.
    var storage = [], apps = [], other = [];
    (list || []).forEach(function(s){
      if (!s || !s.slug) return;
      if (s.type === 'postgres' || s.type === 'bucket') storage.push(s);
      else if (s.type === 'go') apps.push(s);
      else other.push(s);
    });
    function byName(a, b){ return String(a.name||a.slug).localeCompare(String(b.name||b.slug)); }
    storage.sort(byName); apps.sort(byName); other.sort(byName);
    var nodes = {};
    function place(items, col) {
      items.forEach(function(svc, i){
        nodes[svc.slug] = {
          x: CANVAS_PAD + col * (CANVAS_CARD_W + CANVAS_GAP_X),
          y: CANVAS_PAD + i * (CANVAS_CARD_H + CANVAS_GAP_Y)
        };
      });
    }
    place(storage, 0);
    place(apps.concat(other), 1);
    return nodes;
  }


  function clampCanvasZoom(z) {
    z = Number(z) || 1;
    if (z < 0.5) z = 0.5;
    if (z > 1.5) z = 1.5;
    return Math.round(z * 100) / 100;
  }
  function setCanvasZoom(next, opts) {
    opts = opts || {};
    canvasZoom = clampCanvasZoom(next);
    var canvas = document.querySelector('.panel-group-detail .rw-canvas.is-free');
    var scale = document.querySelector('.panel-group-detail .rw-board-scale');
    if (scale) scale.style.transform = 'scale(' + canvasZoom + ')';
    if (canvas) canvas.style.setProperty('--rw-grid', (24 * canvasZoom) + 'px');
    var pct = document.querySelector('.panel-group-detail .rw-zoom-pct');
    if (pct) pct.textContent = Math.round(canvasZoom * 100) + '%';
    drawRwLinks();
    if (!opts.soft) renderServices({ soft: true, force: true });
  }

  function applyAutoArrange() {
    if (!activeGroup) return;
    var nodes = autoArrangePositions(deployed || []);
    canvasLayout = { nodes: nodes };
    applyCanvasPositionsDOM();
    drawRwLinks();
    saveCanvasLayout(true);
    showToast('Canvas arranged');
  }

  function applyCanvasPositionsDOM() {
    var board = document.querySelector('.panel-group-detail .rw-board');
    if (!board || !canvasLayout || !canvasLayout.nodes) return;
    var maxX = 0, maxY = 0;
    board.querySelectorAll('.rw-node-wrap[data-node]').forEach(function(wrap){
      var slug = wrap.getAttribute('data-node');
      var n = canvasLayout.nodes[slug];
      if (!n) return;
      wrap.style.left = Math.round(n.x) + 'px';
      wrap.style.top = Math.round(n.y) + 'px';
      maxX = Math.max(maxX, n.x + CANVAS_CARD_W);
      maxY = Math.max(maxY, n.y + CANVAS_CARD_H);
    });
    board.style.minWidth = Math.max(640, Math.round(maxX + CANVAS_PAD)) + 'px';
    board.style.minHeight = Math.max(360, Math.round(maxY + CANVAS_PAD)) + 'px';
  }

  function saveCanvasLayout(immediate) {
    if (!activeGroup || !canvasLayout) return;
    var run = function(){
      api('/api/groups/' + encodeURIComponent(activeGroup) + '/layout', {
        method: 'PUT',
        body: JSON.stringify({ nodes: canvasLayout.nodes || {} })
      }).catch(function(){});
    };
    if (immediate) {
      if (_layoutSaveTimer) clearTimeout(_layoutSaveTimer);
      _layoutSaveTimer = null;
      run();
      return;
    }
    if (_layoutSaveTimer) clearTimeout(_layoutSaveTimer);
    _layoutSaveTimer = setTimeout(run, 280);
  }

  function loadCanvasLayout() {
    if (!activeGroup) {
      canvasLayout = { nodes: {} };
      return Promise.resolve();
    }
    return api('/api/groups/' + encodeURIComponent(activeGroup) + '/layout')
      .then(function(lay){
        canvasLayout = { nodes: (lay && lay.nodes) || {} };
      })
      .catch(function(){
        canvasLayout = canvasLayout || { nodes: {} };
      });
  }

  function bindCanvasDrag() {
    var canvas = document.querySelector('.panel-group-detail .rw-canvas.is-free');
    if (!canvas || canvas._dragBound) return;
    canvas._dragBound = true;

    canvas.addEventListener('wheel', function(e){
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      var step = e.deltaY > 0 ? -0.08 : 0.08;
      setCanvasZoom((canvasZoom || 1) + step, { soft: true });
      var scale = canvas.querySelector('.rw-board-scale');
      if (scale) scale.style.transform = 'scale(' + canvasZoom + ')';
      canvas.style.setProperty('--rw-grid', (24 * canvasZoom) + 'px');
      var pct = document.querySelector('.panel-group-detail .rw-zoom-pct');
      if (pct) pct.textContent = Math.round(canvasZoom * 100) + '%';
      drawRwLinks();
    }, { passive: false });

    function nodeFromEvent(e) {
      var t = e.target;
      if (!t || !t.closest) return null;
      if (t.closest('[data-stop], button, a, input, textarea, select, .cselect')) return null;
      return t.closest('.rw-node-wrap[data-node]');
    }

    canvas.addEventListener('pointerdown', function(e){
      if (e.button != null && e.button !== 0) return;
      var wrap = nodeFromEvent(e);
      if (!wrap) return;
      var slug = wrap.getAttribute('data-node');
      if (!slug) return;
      if (!canvasLayout.nodes) canvasLayout.nodes = {};
      _canvasDrag = {
        slug: slug,
        wrap: wrap,
        startX: e.clientX,
        startY: e.clientY,
        origX: (canvasLayout.nodes[slug] && canvasLayout.nodes[slug].x) || 0,
        origY: (canvasLayout.nodes[slug] && canvasLayout.nodes[slug].y) || 0,
        moved: false,
        captured: false,
        pointerId: e.pointerId
      };
      // Do not capture yet — a plain click must open settings.
    });

    canvas.addEventListener('pointermove', function(e){
      if (!_canvasDrag || _canvasDrag.pointerId !== e.pointerId) return;
      var dx = e.clientX - _canvasDrag.startX;
      var dy = e.clientY - _canvasDrag.startY;
      if (!_canvasDrag.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        _canvasDrag.moved = true;
        if (!_canvasDrag.captured) {
          _canvasDrag.captured = true;
          try { _canvasDrag.wrap.setPointerCapture(e.pointerId); } catch (err) {}
          _canvasDrag.wrap.classList.add('is-dragging');
          canvas.classList.add('is-dragging');
        }
      }
      if (!_canvasDrag.moved) return;
      e.preventDefault();
      var z = canvasZoom || 1;
      var nx = Math.max(0, _canvasDrag.origX + dx / z);
      var ny = Math.max(0, _canvasDrag.origY + dy / z);
      canvasLayout.nodes[_canvasDrag.slug] = { x: nx, y: ny };
      _canvasDrag.wrap.style.left = Math.round(nx) + 'px';
      _canvasDrag.wrap.style.top = Math.round(ny) + 'px';
      drawRwLinks();
    });

    function endDrag(e) {
      if (!_canvasDrag || (e && _canvasDrag.pointerId !== e.pointerId)) return;
      var d = _canvasDrag;
      _canvasDrag = null;
      d.wrap.classList.remove('is-dragging');
      canvas.classList.remove('is-dragging');
      if (d.captured) {
        try { d.wrap.releasePointerCapture(d.pointerId); } catch (err) {}
      }
      if (d.moved) {
        d.wrap.setAttribute('data-skip-click', '1');
        setTimeout(function(){ d.wrap.removeAttribute('data-skip-click'); }, 0);
        applyCanvasPositionsDOM();
        saveCanvasLayout(false);
        return;
      }
      // Click (no drag) → open configuration. Suppress the follow-up DOM click
      // so data-action=svc:settings does not toggle the drawer closed again.
      d.wrap.setAttribute('data-skip-click', '1');
      setTimeout(function(){ d.wrap.removeAttribute('data-skip-click'); }, 50);
      openServiceSettings(d.slug);
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  function drawRwLinks() {
    var canvas = document.querySelector('.panel-group-detail .rw-canvas');
    if (!canvas) return;
    var svg = canvas.querySelector('.rw-links-g');
    if (!svg) return;
    var cRect = canvas.getBoundingClientRect();
    var paths = [];
    function addLink(fromEl, toSlug, cls) {
      if (!toSlug) return;
      var toEl = canvas.querySelector('.svc-node[data-slug="'+toSlug+'"]');
      if (!toEl) return;
      var a = fromEl.getBoundingClientRect();
      var b = toEl.getBoundingClientRect();
      var x1 = a.left + a.width / 2 - cRect.left + canvas.scrollLeft;
      var y1 = a.top + a.height / 2 - cRect.top + canvas.scrollTop;
      var x2 = b.left + b.width / 2 - cRect.left + canvas.scrollLeft;
      var y2 = b.top + b.height / 2 - cRect.top + canvas.scrollTop;
      var dx = Math.max(40, Math.abs(x2 - x1) * 0.35);
      var c1x = x1 - dx, c2x = x2 + dx;
      if (x2 > x1) { c1x = x1 + dx; c2x = x2 - dx; }
      paths.push({ d: 'M'+x1+' '+y1+' C'+c1x+' '+y1+' '+c2x+' '+y2+' '+x2+' '+y2, cls: cls || 'rw-link-db' });
    }
    canvas.querySelectorAll('.svc-node[data-linked]').forEach(function(el){
      addLink(el, el.getAttribute('data-linked'), 'rw-link-db');
    });
    canvas.querySelectorAll('.svc-node[data-linked-bucket]').forEach(function(el){
      addLink(el, el.getAttribute('data-linked-bucket'), 'rw-link-bucket');
    });
    svg.innerHTML = paths.map(function(p){
      return '<path class="rw-link-path '+p.cls+'" d="'+p.d+'" fill="none"/>';
    }).join('');
    var linksSvg = canvas.querySelector('.rw-links');
    var board = canvas.querySelector('.rw-board');
    var w = Math.max(canvas.scrollWidth, cRect.width, board ? board.scrollWidth : 0);
    var h = Math.max(canvas.scrollHeight, cRect.height, board ? board.scrollHeight : 0);
    if (linksSvg) {
      linksSvg.setAttribute('width', String(w));
      linksSvg.setAttribute('height', String(h));
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
    applyCanvasPositionsDOM(); bindCanvasDrag(); drawRwLinks();
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

  function patchMetricEl(el, value, detail, percent) {
    if (!el) return;
    var p = clamp(percent).toFixed(0) + '%';
    var v = el.querySelector('.v');
    var d = el.querySelector('.d');
    var bar = el.querySelector('.bar');
    var span = bar && bar.querySelector('span');
    if (v && v.textContent !== String(value)) v.textContent = value;
    if (d && d.textContent !== String(detail)) d.textContent = detail;
    if (bar) bar.style.setProperty('--p', p);
    if (span && span.style.width !== p) {
      requestAnimationFrame(function(){ span.style.width = p; });
    }
  }

  function patchMonitoringLive(s) {
    var mon = document.getElementById('panel-monitoring');
    if (!mon) return;
    var d = (s && s.device_metrics) || {};
    var cpu = d.cpu || {}, mem = d.memory || {}, thermal = d.thermal || {}, storage = d.storage || {}, net = d.network || {};
    var temp = Number(thermal.temperature_celsius || 0);
    var thermalDetail = thermal.throttle_known ? (thermal.throttled ? 'Throttled' : 'OK') : 'Sensor';
    var thermalVal = thermal.available ? (temp.toFixed(0) + '°') : 'n/a';
    patchMetricEl(mon.querySelector('[data-metric="cpu"]'), fmtPct(cpu.busy_percent), 'Idle ' + fmtPct(cpu.idle_percent), cpu.busy_percent);
    patchMetricEl(mon.querySelector('[data-metric="memory"]'), fmtPct(mem.used_percent), fmtBytes(mem.used_bytes), mem.used_percent);
    patchMetricEl(mon.querySelector('[data-metric="thermal"]'), thermalVal, thermalDetail, temp / 85 * 100);
    patchMetricEl(mon.querySelector('[data-metric="storage"]'), fmtPct(storage.used_percent), fmtBytes(storage.used_bytes), storage.used_percent);
    var nets = mon.querySelectorAll('.net-dense strong');
    if (nets[0]) nets[0].textContent = fmtRate(net.down_bytes_per_sec);
    if (nets[1]) nets[1].textContent = fmtRate(net.up_bytes_per_sec);
  }

  function patchVpnChrome(vpnEl, s) {
    if (!vpnEl || !s) return;
    var mode = s.mode || 'mullvad';
    var h = health(s);
    var dhcp = (s.dhcp_start && s.dhcp_end) ? s.dhcp_start + ' – ' + s.dhcp_end : 'Not set';
    var big = vpnEl.querySelector('.vpn-title .big');
    if (big) {
      var label = mode === 'residential' ? 'Residential' : 'Mullvad';
      // keep shield icon, replace text node after svg
      var svg = big.querySelector('svg');
      big.innerHTML = '';
      if (svg) big.appendChild(svg);
      else big.insertAdjacentHTML('afterbegin', ico('shield'));
      big.appendChild(document.createTextNode(' ' + label));
    }
    var route = vpnEl.querySelector('.vpn-title .route');
    if (route) route.textContent = routeLabel(mode);
    var pill = vpnEl.querySelector('.pill');
    if (pill) {
      pill.className = 'pill ' + h.cls;
      var pulse = pill.querySelector('.pulse');
      if (pulse) pulse.className = 'pulse' + (h.cls === 'off' ? ' off' : '');
      // text after pulse
      var nodes = [].slice.call(pill.childNodes);
      nodes.forEach(function(n){ if (n.nodeType === 3) pill.removeChild(n); });
      pill.appendChild(document.createTextNode(h.text));
    }
    var seg = vpnEl.querySelectorAll('.seg button');
    if (seg[0]) {
      seg[0].classList.toggle('active', mode === 'mullvad');
      seg[0].disabled = !!(busy['mode:mullvad'] || busy['mode:residential']);
    }
    if (seg[1]) {
      seg[1].classList.toggle('active', mode === 'residential');
      seg[1].disabled = !!(busy['mode:mullvad'] || busy['mode:residential']);
    }
    // rows
    var rows = vpnEl.querySelectorAll('.rows .row strong');
    if (rows[0]) rows[0].textContent = s.ssid || '—';
    if (rows[1]) rows[1].textContent = s.hotspot_ip || '—';
    if (rows[2]) rows[2].textContent = dhcp;
    // action buttons: rebuild actions row only
    var actions = vpnEl.querySelector('.actions');
    if (actions) {
      actions.innerHTML = ''
        + btn('Start', 'hotspot:start', 'primary', s.hotspot_running, 'play')
        + btn('Stop', 'hotspot:stop', 'danger-soft', !s.hotspot_running, 'stop')
        + btn('Restart', 'hotspot:restart', 'btn-quiet', false, 'refresh');
    }
  }

  function patchLive() {
    var s = state || {};
    // Prefer live DOM open state; keep flag in sync
    var vpnEl = document.getElementById('panel-vpn');
    var detailsOpen = !!(vpnEl && vpnEl.querySelector('details.settings[open]'));
    if (detailsOpen) hotspotSettingsOpen = true;

    patchMonitoringLive(s);

    if (vpnEl) {
      if (hotspotSettingsOpen || detailsOpen) {
        patchVpnChrome(vpnEl, s);
      } else {
        var draft = readFormDraft();
        var c = draft || config || {};
        var wrap2 = document.createElement('div');
        wrap2.innerHTML = vpn(s, formDirty ? c : (config || {}));
        vpnEl.replaceWith(wrap2.firstChild);
      }
    }
    setLive(true);
  }

  function render(opts) {
    opts = opts || {};
    captureWizardDraft();
    captureSettingsDrafts();
    // Preserve hotspot settings expand across full re-renders
    var det = document.querySelector('#panel-vpn details.settings');
    if (det) hotspotSettingsOpen = !!det.open;
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
        ? Promise.all([
            api("/api/groups/" + encodeURIComponent(activeGroup) + "/services"),
            loadCanvasLayout()
          ]).then(function(pair){
            var r = pair[0] || {};
            var prevStats = {};
            (deployed || []).forEach(function(s){ if (s && s.slug && s.stats) prevStats[s.slug] = s.stats; });
            deployed = r.services || [];
            (deployed || []).forEach(function(s){
              if (!s || !s.slug) return;
              if (prevStats[s.slug] && (!s.stats || s.type === "go")) s.stats = prevStats[s.slug];
            });
            servicesError = null;
          }).catch(function(e){ servicesError = (e && e.message) || "Could not load services"; deployed = []; })
        : Promise.resolve().then(function(){ deployed = []; servicesError = null; canvasLayout = { nodes: {} }; })
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
            linked_bucket: urlSvc.linked_bucket || '',
            bucket_env: null,
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
    return api('/api/config').then(function(c){
      config = c;
      var editing = hotspotSettingsOpen || !!(document.querySelector('#panel-vpn details.settings[open]'));
      if (editing && !force) {
        // Keep the open form intact; live chrome is patched via patchLive/SSE.
        return c;
      }
      render();
      return c;
    }).catch(function(e){ console.error(e); });
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
      if (pid === 'branch' && wizard) {
        wizard.branch = val;
        wizard.root_dir_locked = false;
        wizard.root_dir = '';
        wizard.root_hint = '';
        renderModal();
        loadDirs();
        return;
      }
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
      if (pid === 'root' && wizard) {
        wizard.root_dir = val;
        wizard.root_dir_locked = true;
        wizard.root_hint = rootHintForSelection(val);
        renderModal();
        return;
      }
      if (pid === 'bucket' && wizard) {
        captureWizardDraft();
        wizard.linked_bucket = val;
        wizard.bucket_env = null;
        folds['wiz:env'] = true;
        renderModal();
        if (val) {
          api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(val) + '/env')
            .then(function(r){
              if (!wizard || wizard.linked_bucket !== val) return;
              var bSvc = (deployed || []).filter(function(x){ return x.slug === val; })[0];
              wizard.bucket_env = bucketEnvMapForService(bSvc, r.env || r.env_json || '');
              renderModal();
            })
            .catch(function(){});
        }
        return;
      }
      if (pid === 'link' && settingsSlug) {
        if (!settingsDraft[settingsSlug]) settingsDraft[settingsSlug] = {};
        settingsDraft[settingsSlug].linked_database = val;
        renderServices({soft:true});
        return;
      }
      if (pid === 'link-bucket' && settingsSlug) {
        if (!settingsDraft[settingsSlug]) settingsDraft[settingsSlug] = {};
        settingsDraft[settingsSlug].linked_bucket = val;
        settingsDraft[settingsSlug].bucket_env = null;
        folds[settingsSlug + ':env'] = true;
        renderServices({soft:true, force:true});
        if (val) {
          api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(val) + '/env')
            .then(function(r){
              if (!settingsSlug || !settingsDraft[settingsSlug]) return;
              if (settingsDraft[settingsSlug].linked_bucket !== val) return;
              settingsDraft[settingsSlug].bucket_env = bucketEnvMapForService(
                (deployed || []).filter(function(x){ return x.slug === val; })[0],
                r.env || r.env_json || ''
              );
              renderDrawerPortal({ patchBody: true, forceRemount: false });
              renderServices({ soft: true, force: true });
            })
            .catch(function(){});
        }
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
    
    if (id === 'files:go') {
      var pth = el.getAttribute('data-path') || (typeof FILES_HOME !== 'undefined' ? FILES_HOME : '/home/andiq');
      closeFilesPreview();
      loadFiles(pth, { render: true });
      return;
    }
    if (id === 'files:up') {
      var home = (typeof FILES_HOME !== 'undefined' ? FILES_HOME : '/home/andiq');
      var cur = (filesListing && filesListing.parent != null && filesListing.parent !== '')
        ? filesListing.parent
        : filesParentOf(filesPath || home);
      if (!filesCanUp(filesPath || home)) return;
      if (filesIsUnder(filesPath || home, home) && !filesIsUnder(cur, home) && cur !== home) {
        cur = home;
      }
      closeFilesPreview();
      loadFiles(cur || home, { render: true });
      return;
    }
    if (id === 'files:refresh') {
      loadFiles(filesPath || (typeof FILES_HOME !== 'undefined' ? FILES_HOME : '/home/andiq'), { render: true });
      return;
    }
    if (id === 'files:preview') {
      openFilesPreview(el.getAttribute('data-path') || '');
      return;
    }
    if (id === 'files:preview-close') {
      closeFilesPreview();
      return;
    }
    if (id === 'files:copy' || id === 'files:cut') {
      filesClip = {
        op: id === 'files:cut' ? 'cut' : 'copy',
        path: el.getAttribute('data-path') || '',
        name: el.getAttribute('data-name') || '',
        type: el.getAttribute('data-type') || ''
      };
      showToast((filesClip.op === 'cut' ? 'Cut' : 'Copied') + ' · ' + filesClip.name);
      render({ animate: false });
      return;
    }
    if (id === 'files:clip-clear') {
      filesClip = null;
      render({ animate: false });
      return;
    }
    if (id === 'files:paste') {
      if (!filesClip || !filesClip.path) return;
      var destDir = filesPath || (typeof FILES_HOME !== 'undefined' ? FILES_HOME : '/home/andiq');
      var op = filesClip.op === 'cut' ? 'move' : 'copy';
      setActionBusy(id, true);
      filesOp({ op: op, path: filesClip.path, to: destDir })
        .then(function(){
          showToast((op === 'move' ? 'Moved' : 'Copied') + ' · ' + filesClip.name);
          if (op === 'move') filesClip = null;
          return loadFiles(destDir, { render: true });
        })
        .catch(function(e){ showToast((e && e.message) || 'Paste failed'); })
        .finally(function(){ setActionBusy(id, false); });
      return;
    }
    if (id === 'files:rename') {
      var from = el.getAttribute('data-path') || '';
      var oldName = el.getAttribute('data-name') || '';
      var next = window.prompt('Rename to', oldName);
      if (next == null) return;
      next = String(next).trim();
      if (!next || next === oldName) return;
      setActionBusy(id, true);
      filesOp({ op: 'rename', path: from, name: next })
        .then(function(){
          showToast('Renamed · ' + next);
          if (filesPreview && filesPreview.path === from) closeFilesPreview();
          return loadFiles(filesPath, { render: true });
        })
        .catch(function(e){ showToast((e && e.message) || 'Rename failed'); })
        .finally(function(){ setActionBusy(id, false); });
      return;
    }
    if (id === 'files:delete') {
      var delPath = el.getAttribute('data-path') || '';
      var delName = el.getAttribute('data-name') || delPath;
      if (!window.confirm('Delete “' + delName + '”?\n\nThis cannot be undone.')) return;
      setActionBusy(id, true);
      filesOp({ op: 'delete', path: delPath })
        .then(function(){
          showToast('Deleted · ' + delName);
          if (filesPreview && filesPreview.path === delPath) closeFilesPreview();
          if (filesClip && filesClip.path === delPath) filesClip = null;
          return loadFiles(filesPath, { render: true });
        })
        .catch(function(e){ showToast((e && e.message) || 'Delete failed'); })
        .finally(function(){ setActionBusy(id, false); });
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
    else if (id === 'canvas:zoom-in') {
      setCanvasZoom((canvasZoom || 1) + 0.1);
      return;
    } else if (id === 'canvas:zoom-out') {
      setCanvasZoom((canvasZoom || 1) - 0.1);
      return;
    } else if (id === 'canvas:zoom-reset') {
      setCanvasZoom(1);
      return;
    } else if (id === 'canvas:arrange') {
      applyAutoArrange();
      return;
    } else if (id === 'wizard:open') {
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
      var buckets0 = (deployed || []).filter(function(x){ return x.type === 'bucket'; });
      var capW = piCapacity();
      var goSpec = {
        step:'go', repo:'', branch:'', name:'',
        linked_database: dbs0.length===1?dbs0[0].slug:'',
        linked_bucket: buckets0.length===1?buckets0[0].slug:'',
        db_env: null,
        bucket_env: null,
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
      // Prefetch linked service credentials so env boards never sit on "linking…"
      if (goSpec.linked_database) {
        api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(goSpec.linked_database) + '/env')
          .then(function(r){
            if (!wizard || wizard.linked_database !== goSpec.linked_database) return;
            wizard.db_env = parseEnvMapClient(r.env || r.env_json || '');
            renderModal();
          })
          .catch(function(){});
      }
      if (goSpec.linked_bucket) {
        api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(goSpec.linked_bucket) + '/env')
          .then(function(r){
            if (!wizard || wizard.linked_bucket !== goSpec.linked_bucket) return;
            var bSvc = (deployed || []).filter(function(x){ return x.slug === goSpec.linked_bucket; })[0];
            wizard.bucket_env = bucketEnvMapForService(bSvc, r.env || r.env_json || '');
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
    } else if (id === 'wizard:type:bucket') {
      if (!activeGroup) { showToast('Open a group first'); return; }
      var bSpec = {step:'bucket', name:''};
      if (wizard) { wizard = bSpec; renderModal(); }
      else openWizard(bSpec);
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
        linked_bucket: (wizard && wizard.linked_bucket) || '',
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
      var linkedPreview = payload.env || '';
      if (payload.linked_database) {
        linkedPreview = mergeLinkedPreviewEnv(linkedPreview, (wizard && wizard.db_env) || {}, RESERVED_DB_KEYS);
      }
      if (payload.linked_bucket) {
        linkedPreview = mergeLinkedPreviewEnv(linkedPreview, (wizard && wizard.bucket_env) || {}, BUCKET_ENV_KEYS);
      }
      if (assignedPort) {
        linkedPreview = upsertEnvClient(linkedPreview || '', 'PORT', String(assignedPort));
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
            linked_database: payload.linked_database || '', linked_bucket: payload.linked_bucket || '', has_clone: !!(prior && prior.has_clone),
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
            linked_bucket: payload.linked_bucket || '',
            bucket_env: (wizard && wizard.bucket_env) || null,
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
            if (svc) {
              settingsDraft[sslug].linked_database = svc.linked_database || '';
              settingsDraft[sslug].linked_bucket = svc.linked_bucket || '';
            }
            loadServiceEnv(sslug, { force: true }).then(function(next){
              if (next != null && String(next).trim() !== '' && settingsDraft[sslug]) {
                settingsDraft[sslug].env = next;
              }
              // App env now has injected refs — drop preview cache when ready.
              if (settingsDraft[sslug] && settingsDraft[sslug].linked_bucket) {
                var board = bucketLinkBoardMap(
                  settingsDraft[sslug].linked_bucket,
                  settingsDraft[sslug].env || '',
                  settingsDraft[sslug].bucket_env
                );
                if (board.ready && !board.preview) settingsDraft[sslug].bucket_env = null;
              }
              renderServices({ soft: true, force: true, _skipEnvSync: true });
              if (settingsSlug === sslug) renderDrawerPortal({ patchBody: true });
              setTimeout(function(){
                loadServiceEnv(sslug, { force: true }).then(function(next2){
                  if (next2 != null && String(next2).trim() !== '' && settingsDraft[sslug]) {
                    settingsDraft[sslug].env = next2;
                  }
                  renderServices({ soft: true, force: true, _skipEnvSync: true });
                  if (settingsSlug === sslug) renderDrawerPortal({ patchBody: true });
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
    } else if (id === 'wizard:create-bucket') {
      if (!activeGroup) { showToast('Open a group first'); return; }
      if (busy.deploy || busy['wizard:create-bucket']) return;
      var bNameEl = document.getElementById('wiz-bucket-name');
      var bname = bNameEl ? bNameEl.value.trim() : ((wizard && wizard.name) || '');
      if (wizard) wizard.name = bname;
      if (!bname) { showToast('Name required'); return; }
      var bSlug = slugifyClient(bname);
      runServiceJob({
        closeWizard: true,
        appear: true,
        busyKey: 'wizard:create-bucket',
        consoleTitle: 'Create bucket · ' + bname,
        scope: activeGroup + '/' + bSlug,
        contextKey: 'live:' + activeGroup + '/' + bSlug,
        toast: 'Creating bucket · ' + bname,
        failToast: 'Create failed',
        waitActivity: true,
        beforeRequest: function(){},
        request: function(){
          return api('/api/groups/' + encodeURIComponent(activeGroup) + '/services', {
            method:'POST',
            body: JSON.stringify({ type:'bucket', name: bname })
          });
        },
        onSuccess: function(svc){
          settingsSlug = (svc && svc.slug) || settingsSlug;
          showToast('Bucket ready · ' + ((svc && (svc.name || svc.slug)) || bname));
        }
      });
    } else if (id.indexOf('nav:view:') === 0) {
      var view = id.slice('nav:view:'.length);
      if (view === 'files' || view === 'activity') {
        if (settingsSlug) {
          clearScopeFolds(settingsSlug);
          settingsSlug = null;
          renderDrawerPortal();
        }
        var prevAct = navView;
        navView = 'files';
        _navDir = (prevAct === 'files') ? _navDir : 'forward';
        render({ animate: true, dir: _navDir });
        syncRouteFromState();
        loadFiles(filesPath || (typeof FILES_HOME !== 'undefined' ? FILES_HOME : '/home/andiq'), { render: true });
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
        settingsTab = 'storage';
        dockerOpen = true;
        manageLoading = true;
        render({ animate: true, dir: _navDir });
        refreshManage({ animate: true });
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
        settingsTab = 'storage';
        dockerOpen = true;
        manageLoading = true;
        _navDir = 'forward';
        render({ animate: true, dir: _navDir });
        refreshManage({ animate: true });
        syncRouteFromState();
      }
      requestAnimationFrame(function(){
        var el = document.getElementById('settings-' + stab);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
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
      refreshManage().finally(function(){ delete busy['docker:refresh']; if (onSettingsStoragePage()) renderServices({soft:true, force:true}); });
    } else if (id === 'docker:stop-all') {
      var nRun = ((dockerInv && dockerInv.containers) || []).filter(function(c){ return c.running && c.managed; }).length;
      dockerAction({action:'stop-all'}, 'docker:stop-all',
        'Stop '+nRun+' FireWifi-managed container(s)?\n\nOnly labeled fw-* / firewifi containers. Shared images stay. Start apps again from Groups.');
    } else if (id === 'docker:daemon-start' || id === 'docker:daemon-stop') {
      if (busy['docker:daemon-start'] || busy['docker:daemon-stop'] || busy.deploy) return;
      var dStart = id === 'docker:daemon-start';
      if (!dStart && !confirm('Stop the Docker daemon?\n\nEvery container on this Pi will stop (Go apps, Postgres engine, databases) until you Start Docker again.\n\nThe FireWifi dashboard itself keeps running.')) return;
      busy[id] = true;
      activity.userCollapsed = false;
      openActivityConsole({
        forceExpand: true, clearPin: true, reset: true, active: true,
        title: dStart ? 'Start Docker daemon' : 'Stop Docker daemon',
        scope: 'engine/docker',
        contextKey: 'live:engine/docker'
      });
      if (onSettingsStoragePage()) renderServices({ soft: true, force: true });
      api('/api/docker', { method:'POST', body: JSON.stringify({ action: dStart ? 'daemon_start' : 'daemon_stop' }) })
        .then(function(res){
          showToast((res && res.message) || (dStart ? 'Docker daemon running' : 'Docker daemon stopped'));
          return refreshManage();
        })
        .catch(function(e){ showToast(e.message || 'Docker daemon action failed'); })
        .finally(function(){
          delete busy[id];
          if (onSettingsStoragePage()) renderServices({ soft: true, force: true });
        });
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
    } else if (id === 'minio:start' || id === 'minio:stop') {
      if (busy['minio:start'] || busy['minio:stop'] || busy.deploy) return;
      var mStart = id === 'minio:start';
      if (!mStart && !confirm('Stop the shared MinIO engine?\n\nApps using buckets will fail until it is started again.')) return;
      busy[id] = true;
      activity.userCollapsed = false;
      openActivityConsole({
        forceExpand: true, clearPin: true, reset: true, active: true,
        title: mStart ? 'Start MinIO engine' : 'Stop MinIO engine',
        scope: 'engine/minio',
        contextKey: 'live:engine/minio'
      });
      if (onSettingsStoragePage()) renderServices({ soft: true });
      api('/api/engine', { method:'POST', body: JSON.stringify({ action: mStart ? 'minio_start' : 'minio_stop' }) })
        .then(function(v){
          engineView = v;
          showToast(mStart ? 'MinIO engine running' : 'MinIO engine stopped');
          return refreshManage();
        })
        .catch(function(e){ showToast(e.message || 'MinIO action failed'); })
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
      activeGroup = null; settingsSlug = null; deployed = []; canvasLayout = { nodes: {} }; groupDraft = {};
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
      var skipNode = e.target && e.target.closest && e.target.closest('.rw-node-wrap[data-skip-click]');
      if (skipNode) return;
      e.stopPropagation();
      openServiceSettings(id.split(':').slice(2).join(':'));
    } else if (id.indexOf('svc:save:') === 0) {
      var saveslug = id.split(':').slice(2).join(':');
      captureSettingsDrafts();
      var d = settingsDraft[saveslug] || {};
      var saveSvc = (deployed || []).filter(function(s){ return s.slug === saveslug; })[0];
      var saveBody = (saveSvc && saveSvc.type === 'postgres')
        ? { name: d.name }
        : {
            name: d.name, branch: d.branch, linked_database: d.linked_database, linked_bucket: d.linked_bucket, root_dir: d.root_dir || '', env: d.env,
            build_cmd: d.build_cmd, memory_mb: parseInt(d.memory_mb, 10) || 512, cpus: parseFloat(d.cpus) || 1,
            auto_deploy: !!d.auto_deploy
          };
      api('/api/groups/' + encodeURIComponent(activeGroup) + '/services/' + encodeURIComponent(saveslug) + '/settings', {
        method:'PUT', body:JSON.stringify(saveBody)
      }).then(function(svc){
          showToast((svc && svc.type === 'go') ? 'Saved · container restarted' : 'Saved');
          if (svc && settingsDraft[saveslug]) {
            settingsDraft[saveslug].linked_database = svc.linked_database || '';
            settingsDraft[saveslug].linked_bucket = svc.linked_bucket || '';
          }
          return refreshServices({ soft: true }).then(function(){
            if (!(svc && svc.type === 'go')) return;
            return loadServiceEnv(saveslug, { force: true }).then(function(next){
              if (!settingsDraft[saveslug]) return;
              if (next != null && String(next).trim() !== '') settingsDraft[saveslug].env = next;
              // Once applied, drop preview — board reads refs from app env.
              if (svc.linked_bucket) {
                /* keep bucket_env as fallback until env has keys */
                var board = bucketLinkBoardMap(svc.linked_bucket, settingsDraft[saveslug].env || '', settingsDraft[saveslug].bucket_env);
                if (board.ready && !board.preview) settingsDraft[saveslug].bucket_env = null;
              } else {
                settingsDraft[saveslug].bucket_env = null;
              }
              if (settingsSlug === saveslug) {
                renderDrawerPortal({ patchBody: true });
                renderServices({ soft: true, force: true });
              }
            });
          });
        })
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
    wizard.loadingBranches = true; wizard.loadingDirs = true; wizard.repo = repo;
    wizard.dirs = []; wizard.go_modules = []; wizard.root_dir = ''; wizard.root_dir_locked = false;
    wizard.root_has_go_mod = false; wizard.suggested_root = ''; wizard.root_hint = 'Scanning for go.mod…';
    renderModal();
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
      .then(function(r){
        wizard.dirs = r.dirs || [];
        wizard.go_modules = r.go_modules || [];
        wizard.root_has_go_mod = !!r.root_has_go_mod;
        wizard.suggested_root = (r.suggested_root != null) ? r.suggested_root : '';
        wizard.root_hint = r.suggest_reason || '';
        // Autoselect detected module unless the user already overrode Root.
        if (!wizard.root_dir_locked) {
          wizard.root_dir = wizard.suggested_root || '';
        }
        wizard.root_hint = rootHintForSelection(wizard.root_dir);
      })
      .catch(function(){
        wizard.dirs = [];
        wizard.go_modules = [];
        wizard.root_has_go_mod = false;
        wizard.suggested_root = '';
        wizard.root_hint = 'Could not scan repo for go.mod';
      })
      .finally(function(){ wizard.loadingDirs = false; renderModal(); });
  }

  function rootHasGoModAt(path) {
    path = String(path || '');
    if (path === '') return !!wizard.root_has_go_mod;
    return (wizard.go_modules || []).some(function(m){ return m && m.has_go_mod && String(m.path) === path; });
  }

  function rootHintForSelection(path) {
    path = String(path || '');
    if (!wizard || !wizard.repo) return '';
    if (wizard.loadingDirs) return 'Scanning for go.mod…';
    if (path === '') {
      return wizard.root_has_go_mod
        ? 'Using repository root · go.mod found'
        : (wizard.root_hint && wizard.root_hint.indexOf('Detected') === 0
            ? wizard.root_hint
            : 'No go.mod at repository root — pick a folder that has one');
    }
    if (rootHasGoModAt(path)) return 'Using '+path+'/ · go.mod found';
    return 'Using '+path+'/ · no go.mod detected here (override OK if you know the path)';
  }
