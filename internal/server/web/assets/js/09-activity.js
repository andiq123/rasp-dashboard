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
  var _svcScrollSlug = '';
  var _apStepsKey = '';
  var _apPctShown = -1;
  var _apLabelShown = '';
  var _hydratedConsoleSlug = '';
  var svcConsoleCollapsed = false;
  var svcConsoleMode = 'deploy'; // 'deploy' | 'runtime'

  function openServiceScope() {
    if (!settingsSlug || !activeGroup) return '';
    return String(activeGroup) + '/' + String(settingsSlug);
  }

  function activityDisplayScope() {
    if (activity.viewGroup && activity.viewSlug) {
      return String(activity.viewGroup) + '/' + String(activity.viewSlug);
    }
    return activity.scope || '';
  }

  function embeddedConsoleRoot() {
    if (!settingsSlug) return null;
    var root = document.getElementById('drawer-root');
    if (!root) return null;
    return root.querySelector('.svc-console[data-slug="' + settingsSlug + '"]');
  }

  function expandSvcConsoleForLive() {
    if (!svcConsoleCollapsed) return;
    var openScope = openServiceScope();
    if (!openScope || activityDisplayScope() !== openScope) return;
    if (activity.active && svcConsoleMode === 'deploy') setSvcConsoleCollapsed(false);
  }

  function parseScopeSlug(scope) {
    scope = String(scope || '');
    var i = scope.indexOf('/');
    if (i < 1) return '';
    var group = scope.slice(0, i);
    var slug = scope.slice(i + 1);
    if (!slug || (activeGroup && group !== activeGroup)) return '';
    if (slug.indexOf('engine/') === 0 || group === 'engine') return '';
    return slug;
  }

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
    var emb = embeddedConsoleRoot();
    if (emb) {
      emb.classList.toggle('paused', !activity.follow);
      var ebtn = emb.querySelector('.svc-console-follow');
      if (ebtn) ebtn.hidden = activity.follow || svcConsoleCollapsed;
    }
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

  function bindLogScroll(log, root) {
    if (!log || log._fwScrollBound) return;
    log._fwScrollBound = true;
    var ticking = false;
    log.addEventListener('scroll', function(){
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function(){
        ticking = false;
        if (!log.isConnected) return;
        if (nearBottom(log, 48)) {
          if (!activity.follow) setActivityFollow(true);
        } else if (activity.follow) {
          setActivityFollow(false);
        }
      });
    }, {passive: true});
    log.addEventListener('wheel', function(e){
      lockActivityWheel(e, log);
    }, {passive: false});
    if (root && !root._fwWheelLock) {
      root._fwWheelLock = true;
      root.addEventListener('wheel', function(e){
        if (e.target === log || (log && log.contains(e.target))) return;
        e.preventDefault();
        e.stopPropagation();
      }, {passive: false});
    }
  }

  function bindActivityScroll() {
    if (_actScrollBound) return;
    var log = document.getElementById('activity-log');
    if (!log) return;
    _actScrollBound = true;
    bindLogScroll(log, document.getElementById('activity'));
  }

  function bindSvcConsoleScroll(emb) {
    if (!emb) return;
    var slug = emb.getAttribute('data-slug') || '';
    if (_svcScrollSlug === slug && emb._fwConsoleBound) return;
    _svcScrollSlug = slug;
    emb._fwConsoleBound = true;
    bindLogScroll(emb.querySelector('.svc-console-log'), emb);
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

  function patchProgressInto(els) {
    if (!els || !els.wrap) return;
    var p = activity.progress;
    var show = !!(p && p.steps && p.steps.length);
    els.wrap.hidden = !show;
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

    function bump(el) {
      if (!el) return;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
    if (els.step) {
      if (label !== _apLabelShown) {
        els.step.textContent = label;
        bump(els.step);
        _apLabelShown = label;
      }
    }
    if (els.remain) {
      els.remain.textContent = activity.active ? (p.remaining || '') : '';
      els.remain.hidden = !activity.active || !p.remaining;
    }
    if (els.pct && _apPctShown !== pct) {
      els.pct.textContent = pct + '%';
      bump(els.pct);
      _apPctShown = pct;
    }
    if (els.fill) els.fill.style.width = pct + '%';
    if (els.bar) els.bar.setAttribute('aria-valuenow', String(pct));

    var key = progressStepsKey(p);
    if (els.list && key !== _apStepsKey) {
      _apStepsKey = key;
      els.list.innerHTML = (p.steps || []).map(function(s){
        var st = s.status || 'pending';
        return '<li class="'+esc(st)+'" title="'+esc(s.label || '')+'">'
          +'<span class="dot" aria-hidden="true"></span>'
          +'<span>'+esc(s.label || s.id || '')+'</span>'
          +'</li>';
      }).join('');
      bump(els.list.querySelector('li.active'));
    }
  }

  function patchActivityProgress() {
    patchProgressInto({
      wrap: document.getElementById('activity-progress'),
      step: document.getElementById('ap-step'),
      remain: document.getElementById('ap-remain'),
      pct: document.getElementById('ap-pct'),
      fill: document.getElementById('ap-fill'),
      bar: document.getElementById('ap-bar'),
      list: document.getElementById('ap-steps')
    });
  }

  function activityTone() {
    if (activity.ok === true) return 'ok';
    if (activity.ok === false) return 'err';
    var sawErr = false;
    var sawWarn = false;
    (activity.lines || []).forEach(function(line){
      if (!line) return;
      if (line.level === 'err') sawErr = true;
      else if (line.level === 'warn') sawWarn = true;
    });
    if (sawErr) return 'err';
    if (sawWarn) return 'warn';
    return '';
  }

  function setSvcConsoleCollapsed(on) {
    svcConsoleCollapsed = !!on;
    var emb = embeddedConsoleRoot();
    var drawer = document.querySelector('#drawer-root .svc-drawer');
    if (emb) {
      emb.classList.toggle('is-collapsed', svcConsoleCollapsed);
      var tog = emb.querySelector('.svc-console-toggle');
      if (tog) {
        tog.setAttribute('aria-expanded', svcConsoleCollapsed ? 'false' : 'true');
        tog.title = svcConsoleCollapsed ? 'Expand console' : 'Collapse console';
      }
    }
    if (drawer) drawer.classList.toggle('console-collapsed', svcConsoleCollapsed);
  }

  function setSvcConsoleMode(mode, opts) {
    opts = opts || {};
    mode = mode === 'runtime' ? 'runtime' : 'deploy';
    if (svcConsoleMode === mode && !opts.force) return;
    svcConsoleMode = mode;
    var slug = settingsSlug || activity.viewSlug || '';
    var group = activeGroup || activity.viewGroup || '';
    if (!slug || !group) {
      patchActivity();
      return;
    }
    setSvcConsoleCollapsed(false);
    if (mode === 'runtime') {
      openServiceCrashLogs(group, slug);
      return;
    }
    var svc = (deployed || []).filter(function(s){ return s.slug === slug; })[0];
    var building = svc && (svc.deployments || []).filter(function(d){
      return d.status === 'building' || d.status === 'queued';
    })[0];
    var latest = building
      || (svc && (svc.deployments || []).filter(function(d){ return d.status === 'active' || d.active; })[0])
      || (svc && (svc.deployments || [])[0]);
    if (latest && latest.id) {
      openDeployLogs(group, slug, latest.id, {
        title: (latest.commit ? latest.commit + ' · ' : '') + (latest.message || latest.id)
      });
      return;
    }
    if (activity.active && activity.scope === group + '/' + slug) {
      activity.viewDeploy = activity.deployment_id || '';
      activity.viewGroup = group;
      activity.viewSlug = slug;
      patchActivity();
      return;
    }
    resetActivityConsole({
      open: true,
      title: 'Deploy',
      scope: group + '/' + slug,
      contextKey: 'deploy:' + group + '/' + slug,
      active: false
    });
    activity.viewGroup = group;
    activity.viewSlug = slug;
    activity.lines = [{
      seq: 1, at: '', level: 'info',
      text: 'No deployments yet — Redeploy to build history.'
    }];
    patchActivity();
  }

  function patchEmbeddedConsole(emb) {
    if (!emb) return;
    bindSvcConsoleScroll(emb);
    var tone = activityTone();
    emb.className = 'svc-console'
      + (svcConsoleCollapsed ? ' is-collapsed' : '')
      + (activity.active && svcConsoleMode === 'deploy' ? ' running' : '')
      + (tone === 'ok' ? ' ok' : '')
      + (tone === 'err' ? ' err' : '')
      + (tone === 'warn' ? ' warn' : '')
      + (activity.follow ? '' : ' paused');
    emb.setAttribute('data-mode', svcConsoleMode);
    var drawer = emb.closest('.svc-drawer');
    if (drawer) drawer.classList.toggle('console-collapsed', svcConsoleCollapsed);

    var title = emb.querySelector('.svc-console-title');
    var status = emb.querySelector('.svc-console-pill');
    var log = emb.querySelector('.svc-console-log');
    var followBtn = emb.querySelector('.svc-console-follow');
    var tog = emb.querySelector('.svc-console-toggle');
    var openScope = openServiceScope();
    var disp = activityDisplayScope();
    var belongs = !disp || disp === openScope;

    if (title) {
      if (!belongs) title.textContent = 'Console';
      else if (svcConsoleMode === 'runtime') title.textContent = 'Runtime';
      else if (activity.active) title.textContent = activity.title || 'Deploy';
      else title.textContent = activity.title || 'Deploy';
    }
    emb.querySelectorAll('.svc-console-mode-btn').forEach(function(btn){
      var isDeploy = (btn.getAttribute('data-action') || '').indexOf(':mode:deploy:') > 0;
      var active = svcConsoleMode === (isDeploy ? 'deploy' : 'runtime');
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (status) {
      status.classList.remove('pct');
      if (!belongs || svcConsoleMode === 'runtime') status.textContent = '';
      else if (activity.active && activity.progress && typeof activity.progress.percent === 'number') {
        status.textContent = activity.progress.percent + '%';
        status.classList.add('pct');
      } else if (activity.active) status.textContent = 'Live';
      else if (activity.ok === true || tone === 'ok') status.textContent = 'Done';
      else if (activity.ok === false || tone === 'err') status.textContent = 'Failed';
      else if (tone === 'warn') status.textContent = 'Warn';
      else status.textContent = '';
    }
    if (followBtn) followBtn.hidden = activity.follow || svcConsoleCollapsed;
    if (tog) {
      tog.setAttribute('aria-expanded', svcConsoleCollapsed ? 'false' : 'true');
      tog.title = svcConsoleCollapsed ? 'Expand console' : 'Collapse console';
    }

    if (belongs && !svcConsoleCollapsed) {
      if (svcConsoleMode === 'deploy') {
        patchProgressInto({
          wrap: emb.querySelector('.svc-console-progress'),
          step: emb.querySelector('.svc-console-step'),
          remain: emb.querySelector('.svc-console-remain'),
          pct: emb.querySelector('.svc-console-pct'),
          fill: emb.querySelector('.svc-console-fill'),
          bar: emb.querySelector('.svc-console-bar'),
          list: emb.querySelector('.svc-console-steps')
        });
      } else {
        var prog = emb.querySelector('.svc-console-progress');
        if (prog) prog.hidden = true;
      }
      if (log) {
        var updated = renderActivityLines(log, false);
        if (updated !== false && activity.follow) {
          log.scrollTop = log.scrollHeight;
        }
      }
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
    var emb = embeddedConsoleRoot();
    if (emb) {
      var elog = emb.querySelector('.svc-console-log');
      if (elog) elog.innerHTML = '';
      var eprog = emb.querySelector('.svc-console-progress');
      if (eprog) eprog.hidden = true;
    }
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
        try { sessionStorage.removeItem('fw.deployLogs'); } catch (e) {}
        syncActivityPoll();
        return;
      }
      // Live job in progress — open its service console when possible.
      activity.contextKey = 'live:' + (snap.scope || snap.deployment_id || snap.title || 'job');
      svcConsoleMode = 'deploy';
      var bootSlug = parseScopeSlug(snap.scope || '');
      if (bootSlug && typeof openServiceSettings === 'function') {
        openServiceSettings(bootSlug, { force: true });
      }
    }

    // Idle empty snapshot must not wipe a finished console still on screen.
    if (!opts.boot && !opts.fromHistory && !snap.active && !(snap.lines && snap.lines.length)) {
      if (activity.open && activity.lines && activity.lines.length) return;
      if (!activity.open) return;
    }

    // Drawer focus isolates the console: ignore hub updates for other services.
    var openScope = openServiceScope();
    var snapScope = (opts.viewGroup && opts.viewSlug)
      ? (String(opts.viewGroup) + '/' + String(opts.viewSlug))
      : (snap.scope || '');
    if (openScope && !opts.boot && !opts.fromHistory) {
      if (snapScope && snapScope !== openScope) return;
      if (!snap.active && !snapScope && activityDisplayScope() === openScope) return;
      // Runtime tab owns the buffer — don't let a deploy stream clobber it.
      if (svcConsoleMode === 'runtime') return;
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
    if (opts.fromHistory && (opts.viewDeploy || opts.viewSlug)) {
      activity.viewDeploy = opts.viewDeploy || '';
      activity.viewGroup = opts.viewGroup || '';
      activity.viewSlug = opts.viewSlug || '';
      activity.contextKey = opts.viewDeploy
        ? ('history:' + opts.viewDeploy)
        : ('logs:' + (opts.viewGroup || '') + '/' + (opts.viewSlug || ''));
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
      if (snap.active) svcConsoleMode = 'deploy';
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

  /** Open durable logs for one deployment into that service’s console. */
  function openDeployLogs(group, slug, deployId, meta) {
    meta = meta || {};
    group = String(group || activeGroup || '');
    slug = String(slug || '');
    deployId = String(deployId || '');
    if (!group || !slug || !deployId) return;
    svcConsoleMode = 'deploy';
    _hydratedConsoleSlug = slug;
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
    try { sessionStorage.removeItem('fw.deployLogs'); } catch (e) {}
    syncActivityPoll();
    var path = '/api/groups/' + encodeURIComponent(group)
      + '/services/' + encodeURIComponent(slug)
      + '/deployments/' + encodeURIComponent(deployId) + '/logs';
    api(path).then(function(r){
      var lines = (r && r.lines) || [];
      var liveSame = !!(activity.deployment_id === deployId && activity.active);
      if (liveSame && activity.lines && activity.lines.length > lines.length) {
        lines = activity.lines;
      }
      applyActivity({
        seq: (activity.seq || 0) + 1,
        active: liveSame,
        title: meta.title || ('Deploy · ' + deployId),
        scope: group + '/' + slug,
        deployment_id: deployId,
        ok: liveSame ? activity.ok : null,
        progress: liveSame ? activity.progress : null,
        lines: lines
      }, { fromHistory: true, forceOpen: true, viewDeploy: deployId, viewGroup: group, viewSlug: slug });
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
    svcConsoleMode = 'runtime';
    _hydratedConsoleSlug = slug;
    resetActivityConsole({
      open: true,
      title: 'Runtime',
      scope: group + '/' + slug,
      contextKey: 'logs:' + group + '/' + slug,
      active: false
    });
    activity.viewDeploy = '';
    activity.viewGroup = group;
    activity.viewSlug = slug;
    activity.lines = [{ seq: 1, at: '', level: 'info', text: 'Fetching container logs…' }];
    patchActivity();
    var path = '/api/groups/' + encodeURIComponent(group)
      + '/services/' + encodeURIComponent(slug) + '/logs?lines=200';
    api(path).then(function(r){
      if (svcConsoleMode !== 'runtime' || settingsSlug !== slug) return;
      var text = (r && r.logs) || '';
      var lines = linesFromText(text);
      if (!lines.length) {
        lines = [{ seq: 1, at: '', level: 'warn', text: 'No container logs yet — Start/Redeploy to produce output.' }];
      }
      applyActivity({
        seq: (activity.seq || 0) + 1,
        active: false,
        title: 'Runtime',
        scope: group + '/' + slug,
        ok: activityOkFromLines(lines),
        progress: null,
        lines: lines
      }, { fromHistory: true, forceOpen: true, viewGroup: group, viewSlug: slug });
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
          if (document.hidden) return;
          api('/api/activity').then(function(s){
            var wasActive = activity.active;
            applyActivity(s);
            // Job vanished (crash/restart) while UI still thinks a build is running.
            if (wasActive && !activity.active && (busy.deploy || anyServiceBuilding()) && typeof refreshServices === 'function') {
              delete busy.deploy;
              refreshServices({ soft: true });
            }
          }).catch(function(){});
          if (busy.deploy || activity.active || anyServiceBuilding()) {
            _svcSoftTick++;
            // ~ every 8s while a job runs (4 * 2s)
            if (_svcSoftTick % 4 === 0 && typeof refreshServices === 'function') {
              refreshServices({ soft: true });
            }
          }
        }, 2000);
      }
    } else if (activityPoll) {
      clearInterval(activityPoll);
      activityPoll = null;
      _svcSoftTick = 0;
    }
  }

  function closeActivityAnimated() {
    // Global panel removed — collapse the service console instead.
    if (embeddedConsoleRoot()) {
      setSvcConsoleCollapsed(true);
      return;
    }
    activity.open = false;
    if (typeof clearDeployLogView === 'function') clearDeployLogView();
  }

  function patchActivity() {
    var emb = embeddedConsoleRoot();
    if (!emb) {
      _activityWasOpen = false;
      return;
    }
    var openScope = openServiceScope();
    var disp = activityDisplayScope();
    // Only paint when this drawer owns the current console context (or idle).
    if (disp && openScope && disp !== openScope) return;
    expandSvcConsoleForLive();
    patchEmbeddedConsole(emb);
    _activityWasOpen = true;
  }

  /** Load this service’s console when the drawer opens (isolated from other services). */
  function hydrateServiceConsole(svc, opts) {
    opts = opts || {};
    if (!svc || !svc.slug || !activeGroup) return;
    var scope = activeGroup + '/' + svc.slug;
    var emb = embeddedConsoleRoot();
    if (!emb) return;
    bindSvcConsoleScroll(emb);

    if (!opts.force && _hydratedConsoleSlug === svc.slug
        && activityDisplayScope() === scope
        && ((activity.lines && activity.lines.length) || activity.active)) {
      activity.open = true;
      patchActivity();
      return;
    }
    _hydratedConsoleSlug = svc.slug;

    if (activity.active && activity.scope === scope) {
      svcConsoleMode = 'deploy';
      activity.open = true;
      patchActivity();
      return;
    }
    if (svcConsoleMode === 'runtime' && activity.viewSlug === svc.slug) {
      activity.open = true;
      patchActivity();
      return;
    }
    if (activity.viewDeploy && activity.viewSlug === svc.slug && activity.viewGroup === activeGroup) {
      svcConsoleMode = 'deploy';
      activity.open = true;
      patchActivity();
      return;
    }

    if (svc.type !== 'go') {
      svcConsoleMode = 'deploy';
      resetActivityConsole({
        open: true,
        title: 'Console',
        scope: scope,
        contextKey: 'idle:' + scope,
        active: false
      });
      activity.viewGroup = activeGroup;
      activity.viewSlug = svc.slug;
      activity.lines = [{
        seq: 1, at: '', level: 'info',
        text: 'Engine events for this service appear here.'
      }];
      patchActivity();
      return;
    }

    // Go apps default to Deploy logs (Railway-like).
    svcConsoleMode = 'deploy';
    var building = (svc.deployments || []).filter(function(d){
      return d.status === 'building' || d.status === 'queued';
    })[0];
    if (building) {
      openDeployLogs(activeGroup, svc.slug, building.id, { title: 'Deploy · ' + building.id });
      return;
    }
    var latest = (svc.deployments || []).filter(function(d){ return d.status === 'active' || d.active; })[0]
      || (svc.deployments || [])[0];
    if (latest && latest.id) {
      openDeployLogs(activeGroup, svc.slug, latest.id, {
        title: (latest.commit ? latest.commit + ' · ' : '') + (latest.message || latest.id)
      });
      return;
    }
    resetActivityConsole({
      open: true,
      title: 'Deploy',
      scope: scope,
      contextKey: 'deploy:' + scope,
      active: false
    });
    activity.viewGroup = activeGroup;
    activity.viewSlug = svc.slug;
    activity.lines = [{
      seq: 1, at: '', level: 'info',
      text: 'No deployments yet — Redeploy to build, or switch to Runtime.'
    }];
    patchActivity();
  }

  function watchActivity() {
    api('/api/activity').then(function(s){
      applyActivity(s, { boot: true });
    }).catch(function(){
      try { sessionStorage.removeItem('fw.deployLogs'); } catch (e) {}
    });
  }
