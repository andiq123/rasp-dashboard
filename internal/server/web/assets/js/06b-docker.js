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
