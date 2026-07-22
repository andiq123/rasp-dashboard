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
    // Storage lives on the single Settings page (no separate tab).
    return navView === 'settings' && !activeGroup;
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

  function findPostgresEngineContainer() {
    var ctrs = ((manageOv && manageOv.docker) || dockerInv || {}).containers || [];
    for (var i = 0; i < ctrs.length; i++) {
      if (isPostgresEngineContainer(ctrs[i])) return ctrs[i];
    }
    for (var j = 0; j < ctrs.length; j++) {
      var c = ctrs[j];
      if (c && /firewifi-postgres|\bpostgres\b/i.test(String(c.name || '') + ' ' + String(c.image || ''))) return c;
    }
    return null;
  }

  function findMinIOEngineContainer() {
    var inv = (manageOv && manageOv.docker) || dockerInv || { containers: [] };
    var list = inv.containers || [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var n = String((c && c.name) || '').replace(/^\/+/, '');
      if (n === 'firewifi-minio' || n.indexOf('firewifi-minio') === 0) return c;
    }
    return null;
  }
  function isMinIOEngineContainer(c) {
    if (!c) return false;
    var n = String(c.name || '').replace(/^\/+/, '');
    return n === 'firewifi-minio' || n.indexOf('firewifi-minio') === 0;
  }
  function minioEngineStatusLabel(ev) {
    if (manageLoading && !(ev && ev.minio_running) && !findMinIOEngineContainer()) {
      return { cls: 'wait', text: 'Checking…' };
    }
    if (ev && ev.minio_running) return { cls: 'on', text: 'Running' };
    var c = findMinIOEngineContainer();
    if (c && (c.running || String(c.state||'').toLowerCase()==='restarting')) {
      return { cls: 'warn', text: c.running ? 'Starting…' : 'Restarting' };
    }
    return { cls: 'off', text: 'Stopped' };
  }

  function engineStatusLabel(ev) {
    if (manageLoading && !(ev && ev.postgres_running) && !findPostgresEngineContainer()) {
      return { text: 'Checking…', cls: 'wait' };
    }
    if (ev && ev.postgres_running) return { text: 'Running', cls: 'on' };
    var c = findPostgresEngineContainer();
    if (c) {
      var st = String(c.state || '').toLowerCase();
      if (st === 'restarting' || String(c.status || '').toLowerCase().indexOf('health: starting') >= 0) {
        return { text: 'Starting…', cls: 'warn' };
      }
      if (c.running || st === 'running') return { text: 'Running', cls: 'on' };
      return { text: 'Stopped', cls: 'off' };
    }
    // Published DB services imply the shared engine must be up.
    var pubs = (manageOv && manageOv.published) || [];
    for (var i = 0; i < pubs.length; i++) {
      if (pubs[i] && pubs[i].kind === 'postgres' && pubs[i].running) {
        return { text: 'Running', cls: 'on' };
      }
    }
    if (!ev && !manageOv && !manageError) return { text: 'Checking…', cls: 'wait' };
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

  function dockerDaemonStatus() {
    var ov = manageOv || {};
    var d = ov.daemon || {};
    if (manageLoading && !manageOv) return { text: 'Checking…', cls: 'wait', running: false, checking: true };
    if (d.running) return { text: 'Running', cls: 'on', running: true, checking: false, version: d.version || '', active: d.active || 'active' };
    if (d.active === 'activating' || d.active === 'reloading') {
      return { text: 'Starting…', cls: 'warn', running: false, checking: false, active: d.active };
    }
    if (d.active === 'deactivating') {
      return { text: 'Stopping…', cls: 'warn', running: false, checking: false, active: d.active };
    }
    if (d.error && !d.active) return { text: 'Unknown', cls: 'off', running: false, checking: false, error: d.error };
    return { text: 'Stopped', cls: 'off', running: false, checking: false, active: d.active || 'inactive' };
  }

  function dockerDaemonCard() {
    var st = dockerDaemonStatus();
    var busyStart = !!busy['docker:daemon-start'];
    var busyStop = !!busy['docker:daemon-stop'];
    var busyD = busyStart || busyStop;
    var on = !!st.running;
    var powerLabel = busyStart ? 'Starting…' : (busyStop ? 'Stopping…' : (st.checking ? '…' : (on ? 'Stop' : 'Start')));
    var powerAction = on ? 'docker:daemon-stop' : 'docker:daemon-start';
    var powerCls = on ? 'btn-quiet btn-compact danger-soft' : 'primary btn-compact';
    var meta = [];
    if (st.version) meta.push('v' + st.version);
    if (st.active) meta.push(st.active);
    meta.push('systemctl docker.service');
    var ctrs = ((((manageOv && manageOv.docker) || dockerInv || {}).containers) || []);
    var runningN = ctrs.filter(function(c){ return c && c.running; }).length;
    var depend = runningN === 1
      ? '1 container depends on this runtime'
      : (runningN + ' containers depend on this runtime');
    return ''
      +'<div class="manage-block engine-card daemon-card">'
        +'<div class="manage-block-head">'
          +'<div class="engine-title">'
            +'<span class="engine-ico" aria-hidden="true">'+ico('docker')+'</span>'
            +'<span class="dock-state '+st.cls+'"></span>'
            +'<strong>Docker daemon</strong>'
            +'<span class="dock-badge '+st.cls+'">'+esc(st.text)+'</span>'
          +'</div>'
          +'<div class="engine-power" data-stop="1">'
            +btn(powerLabel, powerAction, powerCls, busyD || st.checking, on ? 'stop' : 'play')
          +'</div>'
        +'</div>'
        +'<p class="engine-help">Host container runtime (dockerd). Go apps, Postgres, and MinIO engines need this running.</p>'
        +'<p class="engine-meta mono">'+esc(meta.join(' · '))+'</p>'
        +'<p class="engine-depend ghost">'+esc(depend)+'</p>'
      +'</div>';
  }

  function engineCard() {
    var ev = engineView || { settings: {}, postgres_options: [], go_options: [] };
    var s = ev.settings || {};
    var pg = (engineDraft && engineDraft.postgres_version) || s.postgres_version || 'latest';
    var go = (engineDraft && engineDraft.go_toolchain) || s.go_toolchain || 'auto';
    var st = engineStatusLabel(ev);
    var busyStart = !!busy['engine:start'];
    var busyStop = !!busy['engine:stop'];
    var busySave = !!busy['engine:save'];
    var busyEng = busyStart || busyStop || busySave;
    var checking = st.cls === 'wait';
    var on = !checking && (!!ev.postgres_running || st.cls === 'on' || st.cls === 'warn');
    var powerLabel = busyStart ? 'Starting…' : (busyStop ? 'Stopping…' : (checking ? '…' : (on ? 'Stop' : 'Start')));
    var powerAction = on ? 'engine:stop' : 'engine:start';
    var powerCls = on ? 'btn-quiet btn-compact danger-soft' : 'primary btn-compact';
    var ctr = findPostgresEngineContainer();
    var pubs = (manageOv && manageOv.published) || [];
    var dbN = 0;
    for (var i = 0; i < pubs.length; i++) {
      if (pubs[i] && pubs[i].kind === 'postgres') dbN++;
    }
    var depend = dbN === 1 ? '1 database uses this engine' : (dbN + ' databases use this engine');
    var hostLine = 'firewifi-postgres · ' + esc(ev.postgres_image || (ctr && ctr.image) || 'postgres') + ' · 127.0.0.1:5432';
    return ''
      +'<div class="manage-block engine-card">'
        +'<div class="manage-block-head">'
          +'<div class="engine-title">'
            +'<span class="engine-ico" aria-hidden="true">'+ico('db')+'</span>'
            +'<span class="dock-state '+st.cls+'"></span>'
            +'<strong>Shared Postgres engine</strong>'
            +'<span class="dock-badge '+st.cls+'">'+esc(st.text)+'</span>'
          +'</div>'
          +'<div class="engine-power" data-stop="1">'
            +btn(powerLabel, powerAction, powerCls, busyEng || checking, on ? 'stop' : 'play')
          +'</div>'
        +'</div>'
        +'<p class="engine-help">Powers project databases on this Pi. Go apps run as their own Docker containers — this is not the Docker daemon.</p>'
        +'<p class="engine-meta mono">'+hostLine+'</p>'
        +'<p class="engine-depend ghost">'+esc(depend)+'</p>'
        +'<div class="runtime-grid">'
          +'<label class="runtime-field"><span>Postgres version</span>'
            +cselectHTML('engine-pg', pg, 'Version…', runtimeOptions(ev.postgres_options), busyEng || checking, {searchable:false})
          +'</label>'
          +'<label class="runtime-field"><span>Go builds</span>'
            +cselectHTML('engine-go', go, 'Toolchain…', runtimeOptions(ev.go_options), busyEng || checking, {searchable:false})
          +'</label>'
        +'</div>'
        +'<div class="manage-row-actions end">'
          +btn(busySave ? 'Applying…' : 'Apply', 'engine:save', 'primary btn-compact', busyEng || checking, 'spark')
        +'</div>'
      +'</div>';
  }

  function minioEngineCard() {
    var ev = engineView || {};
    var st = minioEngineStatusLabel(ev);
    var busyStart = !!busy['minio:start'];
    var busyStop = !!busy['minio:stop'];
    var busyEng = busyStart || busyStop;
    var checking = st.cls === 'wait';
    var on = !checking && (!!ev.minio_running || st.cls === 'on' || st.cls === 'warn');
    var powerLabel = busyStart ? 'Starting…' : (busyStop ? 'Stopping…' : (checking ? '…' : (on ? 'Stop' : 'Start')));
    var powerAction = on ? 'minio:stop' : 'minio:start';
    var powerCls = on ? 'btn-quiet btn-compact danger-soft' : 'primary btn-compact';
    var pubs = (manageOv && manageOv.published) || [];
    var bN = 0;
    for (var i = 0; i < pubs.length; i++) {
      if (pubs[i] && pubs[i].kind === 'bucket') bN++;
    }
    // Fallback: count bucket services from deployed list if manage overview lacks kind.
    if (!bN && typeof deployed !== 'undefined' && deployed) {
      for (var j = 0; j < deployed.length; j++) {
        if (deployed[j] && deployed[j].type === 'bucket') bN++;
      }
    }
    var depend = bN === 1 ? '1 bucket uses this engine' : (bN + ' buckets use this engine');
    var hostLine = 'firewifi-minio · ' + esc(ev.minio_image || 'minio/minio') + ' · ' + esc(ev.minio_endpoint || 'http://127.0.0.1:9000');
    return ''
      +'<div class="manage-block engine-card">'
        +'<div class="manage-block-head">'
          +'<div class="engine-title">'
            +'<span class="engine-ico" aria-hidden="true">'+ico('storage')+'</span>'
            +'<span class="dock-state '+st.cls+'"></span>'
            +'<strong>Shared MinIO engine</strong>'
            +'<span class="dock-badge '+st.cls+'">'+esc(st.text)+'</span>'
          +'</div>'
          +'<div class="engine-power" data-stop="1">'
            +btn(powerLabel, powerAction, powerCls, busyEng || checking, on ? 'stop' : 'play')
          +'</div>'
        +'</div>'
        +'<p class="engine-help">Object storage on this Pi’s SD card. Link a Go app for BUCKET / ENDPOINT / keys.</p>'
        +'<p class="engine-meta mono">'+hostLine+'</p>'
        +'<p class="engine-depend ghost">'+esc(depend)+'</p>'
      +'</div>';
  }

  function storagePanelBody(s) {
    var ov = manageOv || {};
    var inv = ov.docker || dockerInv || { images: [], containers: [], volumes: [], disk: [], reclaim_bytes: 0 };
    var imgs = inv.images || [];
    var allCtrs = inv.containers || [];
    var ctrs = allCtrs.filter(function(c){ return !isPostgresEngineContainer(c) && !isMinIOEngineContainer(c); }).slice().sort(function(a, b){
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
      ? '<div class="storage-state storage-scanning compact"><div class="nav-spinner" aria-hidden="true"></div><p>Scanning Docker inventory…</p></div>'
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
            +btn('Stop managed', 'docker:stop-all', 'danger btn-quiet btn-compact', manageLoading || busy['docker:stop-all'], 'stop')
            +btn('Clean', 'docker:prune', 'primary btn-compact', manageLoading || busy['docker:prune'], 'spark')
          +'</div>'
        +'</div>'
      +'</details>';

    if (errBlock && !manageOv) return errBlock;
    return (
      '<div class="storage-flow">'
        +loading
        +dockerWarn
        +dockerDaemonCard()
        +engineCard()
        +minioEngineCard()
        +strip
        +manageSection('Volumes', vols.length, volMeta, vols.length ? vols.map(dockVolumeRow).join('') : manageEmpty(manageLoading ? 'Scanning volumes…' : 'No volumes'))
        +prune
        +manageSection('Containers', ctrs.length, ctrMeta || 'app containers', ctrs.length ? ctrs.map(dockContainerRow).join('') : manageEmpty(manageLoading ? 'Scanning containers…' : 'No app containers'))
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
    var icons = { Volumes: 'disk', Containers: 'docker', Images: 'storage' };
    var ic = icons[title] ? ('<span class="dock-sec-ico" aria-hidden="true">'+ico(icons[title])+'</span>') : '';
    return ''
      +'<div class="dock-section">'
        +'<div class="dock-section-head">'
          +'<strong>'+ic+esc(title)+'</strong>'
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
        actions += btn('Stop', 'docker:stop:'+c.name, 'btn-quiet btn-compact danger-soft', !!busy['docker:stop:'+c.name], 'stop');
      } else {
        actions += btn('Start', 'docker:start:'+c.name, 'primary btn-quiet btn-compact', !!busy['docker:start:'+c.name], 'play');
      }
      actions += btn('Remove', 'docker:rm-ctr:'+c.name, 'danger btn-quiet btn-compact', !!busy['docker:rm-ctr:'+c.name], 'trash');
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
