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
