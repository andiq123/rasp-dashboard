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

