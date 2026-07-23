  function githubSettingsPanel(gh) {
    gh = gh || github || {};
    if (gh.connected) {
      return ''
        +'<div class="settings-gh">'
          +'<div class="gh-chip ok" title="GitHub connected">'
            +'<span class="gh-dot"></span>'
            +'<span class="gh-label">'+esc((gh.user && gh.user.login) || 'GitHub')+'</span>'
          +'</div>'
          +'<p class="ghost">Connected. Disconnect to switch accounts.</p>'
          +'<div class="inline-actions">'
            +'<button type="button" class="btn btn-quiet danger-soft has-ico" data-action="github:clear">'+ico('close')+'<span>Disconnect</span></button>'
          +'</div>'
        +'</div>';
    }
    return ''
      +'<div class="settings-gh settings-gh-empty">'
        +'<p>Link your account to pick repositories when deploying apps.</p>'
        +'<button type="button" class="btn primary has-ico" data-action="wizard:github">'+ico('github')+'<span>Connect GitHub</span></button>'
      +'</div>';
  }

  function settingsSection(opts) {
    opts = opts || {};
    return ''
      +'<section class="settings-section'+(opts.cls ? (' '+opts.cls) : '')+'"'+(opts.id ? (' id="'+esc(opts.id)+'"') : '')+'>'
        +'<header class="settings-section-head">'
          +(opts.icon ? ('<span class="settings-section-ico" aria-hidden="true">'+ico(opts.icon)+'</span>') : '')
          +'<div class="settings-section-titles">'
            +'<h3>'+esc(opts.title || '')+'</h3>'
            +(opts.sub ? ('<p class="ghost">'+opts.sub+'</p>') : '')
          +'</div>'
          +(opts.action || '')
        +'</header>'
        +'<div class="settings-section-body">'+(opts.body || '')+'</div>'
      +'</section>';
  }

  function settingsWorkspaceView(s) {
    var ghBody = githubSettingsPanel(github);
    var storageBody = storagePanelBody(s);
    var refreshAct = ''
      +'<div class="settings-section-actions">'
        +btn('Refresh', 'docker:refresh', 'btn-quiet btn-compact', manageLoading || busy['docker:refresh'], 'refresh')
      +'</div>';
    return ''
      +'<div class="nav-page" data-view="settings">'
        +'<div class="rack">'
          +'<section class="panel panel-svc panel-manage panel-workspace panel-settings">'
            +'<header class="ws-head ws-head-settings">'
              +'<div class="ws-head-top">'
                +'<div class="ws-title-block">'
                  +'<h2><span class="ws-title-ico" aria-hidden="true">'+ico('settings')+'</span> Settings</h2>'
                  +'<p class="ghost">Account and host storage</p>'
                +'</div>'
              +'</div>'
            +'</header>'
            +'<div class="ws-body settings-body settings-stack">'
              +settingsSection({
                id: 'settings-github',
                icon: 'github',
                title: 'GitHub',
                sub: 'Deploy Go apps from your repositories.',
                body: ghBody
              })
              +settingsSection({
                id: 'settings-storage',
                icon: 'storage',
                title: 'Storage',
                sub: 'Disk, Docker inventory, and the shared Postgres engine.',
                action: refreshAct,
                body: storageBody
              })
            +'</div>'
          +'</section>'
        +'</div>'
      +'</div>';
  }

  function activityMainView() {
    // Legacy stub — Activity page is now Files explorer.
    return filesExplorerView();
  }

  function services(s) {
    var gh = github || {};
    if (navView === 'settings') return settingsWorkspaceView(s);
    if (navView === 'files' || navView === 'activity') return filesExplorerView();
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
        +'<span class="group-tile-ico" aria-hidden="true">'+ico('app')+'</span>'
        +'<div class="group-tile-main">'
          +'<div class="group-tile-title">'+esc(g.name || g.slug)+'</div>'
          +'<div class="group-tile-sub"><span class="mono">'+esc(g.slug)+'</span>'
            +(bits.length ? (' · ' + esc(bits.join(' · '))) : '')
          +'</div>'
        +'</div>'
        +'<span class="group-tile-chev" aria-hidden="true">'+ico('chev')+'</span>'
      +'</button>';
  }

  function groupsSidebarHTML() {
    var n = (groups || []).length;
    var cards = (groups || []).map(function(g){ return groupTileHTML(g, activeGroup === g.slug); }).join('');
    var errBlock = groupsError && !navLoading
      ? ('<div class="ws-empty ws-empty-compact" role="alert"><strong>Could not load groups</strong><p>'+esc(groupsError)+'</p><button type="button" class="btn primary btn-compact has-ico" data-action="projects:retry">'+ico('refresh')+'<span>Retry</span></button></div>')
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
          +'<div class="ws-section-title"><h3>'+ico('app')+' Groups</h3><span class="gd-count">'+String(n)+'</span></div>'
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
                +'<div class="ws-title-block"><h2><span class="ws-title-ico" aria-hidden="true">'+ico('app')+'</span> Projects</h2><p class="ghost">Groups &amp; services</p></div>'
              +'</div>'
              +'<div class="ws-head-actions">'
                +'<button type="button" class="btn primary btn-compact has-ico" data-action="wizard:group">'+ico('plus')+'<span>New group</span></button>'
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
    var draftName = (groupDraft && groupDraft.name != null) ? groupDraft.name : (g.name || g.slug);
    var savedName = g.name || g.slug;
    var nameDirty = String(draftName).trim() !== String(savedName).trim();
    var empty = navLoading
      ? ('<div class="gd-empty gd-empty-loading" role="status" aria-live="polite"><div class="nav-spinner" aria-hidden="true"></div><p>Loading services…</p></div>')
      : servicesError
      ? ('<div class="gd-empty" role="alert"><strong>Could not load services</strong><p>'+esc(servicesError)+'</p><button type="button" class="btn primary" data-action="projects:retry">Retry</button></div>')
      : (''
        +'<div class="gd-empty">'
          +'<div class="gd-empty-ill" aria-hidden="true">'+ico('plus')+'</div>'
          +'<strong>Nothing here yet</strong>'
          +'<p>Add a service — Go app, Postgres, or Bucket — then link them in settings.</p>'
        +'</div>');
    var nodes = (canvasLayout && canvasLayout.nodes) || {};
    var board = '';
    if (list.length) {
      ensureCanvasPositions(list);
      nodes = (canvasLayout && canvasLayout.nodes) || {};
      board = list.map(function(svc){
        var pos = nodes[svc.slug] || { x: 24, y: 24 };
        return ''
          +'<div class="rw-node-wrap" data-node="'+esc(svc.slug)+'" style="left:'+Math.round(pos.x)+'px;top:'+Math.round(pos.y)+'px">'
            + serviceCard(svc, dbs)
          +'</div>';
      }).join('');
    }
    var z = canvasZoom || 1;
    var zPct = Math.round(z * 100);
    var canvasInner = list.length
      ? ('<div class="rw-board-scale" style="transform:scale('+z+')"><div class="rw-board" data-board="1">'+board+'</div></div>')
      : empty;
    var toolbar = ''
      +'<div class="rw-canvas-toolbar" data-stop="1">'
        +'<span class="rw-canvas-count ghost">'+esc(String(list.length))+' service'+(list.length===1?'':'s')+'</span>'
        +'<div class="rw-canvas-tools">'
          +(list.length ? (''
            +'<div class="rw-zoom" role="group" aria-label="Zoom">'
              +'<button type="button" class="btn btn-quiet btn-compact btn-icon" data-action="canvas:zoom-out" title="Zoom out">'+ico('zoomout')+'</button>'
              +'<button type="button" class="btn btn-quiet btn-compact rw-zoom-pct" data-action="canvas:zoom-reset" title="Reset zoom">'+esc(String(zPct))+'%</button>'
              +'<button type="button" class="btn btn-quiet btn-compact btn-icon" data-action="canvas:zoom-in" title="Zoom in">'+ico('zoomin')+'</button>'
            +'</div>'
            +'<button type="button" class="btn btn-quiet btn-compact has-ico" data-action="canvas:arrange" title="Auto arrange">'+ico('arrange')+'<span>Auto arrange</span></button>'
          ) : '')
          +'<button type="button" class="btn primary btn-compact has-ico" data-action="wizard:open">'+ico('plus')+'<span>Add service</span></button>'
        +'</div>'
      +'</div>';
    var body = ''
      + toolbar
      +'<div class="rw-canvas is-free'+(settingsSlug?' drawer-open':'')+(!list.length?' is-empty':'')+(navLoading?' is-loading':'')+'" data-canvas="1" style="--rw-grid:'+(24*z)+'px">'
        +'<div class="rw-canvas-grid" aria-hidden="true"></div>'
        +'<svg class="rw-links" aria-hidden="true"><g class="rw-links-g"></g></svg>'
        +canvasInner
      +'</div>';
    return ''
      +'<div class="ws-col ws-col-main panel-group-detail">'
        +'<header class="gd-head">'
          +'<button type="button" class="btn btn-quiet btn-back btn-icon" data-action="group:back" title="Back to groups" aria-label="Back">'+ico('back')+'</button>'
          +'<div class="gd-identity">'
            +'<div class="gd-name-row">'
              +uiInput({ name: 'group-name', id: 'group-name', value: draftName, placeholder: 'Name this group', className: 'gd-name-input', ariaLabel: 'Group name' })
              +'<button type="button" class="btn primary btn-compact has-ico gd-save'+(nameDirty?' is-dirty':'')+(busy['group:save']?' loading':'')+'" data-action="group:save" data-baseline="'+esc(savedName)+'" '+(busy['group:save'] || !nameDirty?'disabled':'')+' title="Save name"><span class="spinner"></span>'+ico('spark')+'<span>Save</span></button>'
            +'</div>'
            +'<div class="gd-meta"><span class="mono">'+esc(g.slug)+'</span></div>'
          +'</div>'
          +'<div class="gd-head-actions">'
            +'<button type="button" class="btn btn-quiet danger-soft btn-compact has-ico" data-action="group:delete:'+esc(g.slug)+'" title="Delete group">'+ico('trash')+'<span>Delete</span></button>'
          +'</div>'
        +'</header>'
        +'<div class="gd-body gd-workarea rw-canvas-wrap'+(navLoading?' is-loading':'')+'">'
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
          +btn(s.syncrox_running ? 'Stop' : 'Start', s.syncrox_running ? 'syncrox:stop' : 'syncrox:start', s.syncrox_running ? 'danger-soft' : 'primary', false, s.syncrox_running ? 'stop' : 'play')
          +'<a class="btn has-ico" href="http://'+esc(publicHost())+':5090" target="_blank" rel="noopener">'+ico('open')+'<span>Open</span></a>'
        +'</div>'
      +'</div>';
  }
  function systemSyncrox(s) { return systemSyncroxInner(s); }


  /** Compact inline SVG icons — shared across service cards & actions. */
  function svcKindMeta(svc) {
    if (svc && svc.type === 'postgres') {
      return { kind: 'db', label: 'Database', ico: 'db' };
    }
    if (svc && svc.type === 'bucket') {
      return { kind: 'db', label: 'Bucket', ico: 'storage' };
    }
    return { kind: 'app', label: 'App', ico: 'app' };
  }

  function statusMeta(svc, building, failed, isUp) {
    if (svc && (svc.type === 'postgres' || svc.type === 'bucket')) {
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


  function maskBucketURLDisplay(raw) {
    raw = String(raw || '');
    if (!raw) return '';
    try {
      var u = new URL(raw);
      if (u.username || u.password) {
        u.username = '••••';
        u.password = '';
      }
      return u.toString().replace(/••••:@/, '••••@').replace(/\/@/, '/');
    } catch (e) {
      return raw.replace(/:\/\/[^@\s]+@/, '://••••@');
    }
  }
  function accessURL(svc) {
    if (!svc) return '';
    if (svc.type === 'postgres' || svc.type === 'bucket') return rewriteHost(svc.connection_url || '');
    var raw = svc.url || (svc.port ? ('http://rasp.local:' + svc.port) : '');
    return rewriteHost(raw);
  }
  function accessLabel(svc) {
    if (svc && svc.type === 'postgres') return 'DATABASE_URL';
    if (svc && svc.type === 'bucket') return 'BUCKET';
    return 'App URL';
  }
  function publicURL(svc) {
    return (svc && svc.public_url) ? String(svc.public_url) : '';
  }
  function publicPath(svc) {
    var p = svc && svc.public_path ? String(svc.public_path) : '';
    if (!p || p === '/') return '';
    return p.charAt(0) === '/' ? p : ('/' + p);
  }
  function publicOpenURL(svc) {
    var base = publicURL(svc);
    if (!base) return '';
    var p = publicPath(svc);
    return p ? (base.replace(/\/$/, '') + p) : base;
  }
  // Browser DNS check for public tunnel host (Pi may resolve while LAN DNS does not).
  function verifyPublicReachable(svc) {
    var url = publicOpenURL(svc) || publicURL(svc);
    if (!url || typeof fetch !== 'function') return Promise.resolve(null);
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function(){ try { if (ctrl) ctrl.abort(); } catch (e) {} }, 6000);
    return fetch(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function(){
      clearTimeout(timer);
      return true; // resolved + connected; HTTP status irrelevant
    }).catch(function(){
      clearTimeout(timer);
      return false; // DNS/network failure from this device
    });
  }
  function accessSummary(svc) {
    if (!svc) return '—';
    if (svc.type === 'postgres') {
      return svc.database || accessHostSummary(accessURL(svc)) || '—';
    }
    if (svc.type === 'bucket') {
      return svc.bucket || accessHostSummary(accessURL(svc)) || '—';
    }
    var pub = publicURL(svc);
    if (pub) return String(pub).replace(/^https?:\/\//, '');
    var local = accessURL(svc);
    return local ? String(local).replace(/^https?:\/\//, '') : '—';
  }
  function accessBarHTML(svc) {
    var local = accessURL(svc);
    var pub = publicURL(svc);
    var primary = pub ? (publicOpenURL(svc) || pub) : local;
    if (!primary) {
      return '<div class="svc-foot empty"><span class="ghost">No endpoint yet</span></div>';
    }
    var isPg = svc.type === 'postgres' || svc.type === 'bucket';
    var label = pub ? 'Public' : (svc.type === 'postgres' ? 'Database URL' : (svc.type === 'bucket' ? 'Bucket URL' : 'App URL'));
    var openBtn = isPg ? '' : (
      '<a class="btn btn-compact svc-act primary" href="'+esc(primary)+'" target="_blank" rel="noopener" data-stop="1" title="Open">'
        +ico('open')+'<span>Open</span></a>'
    );
    return ''
      +'<div class="svc-foot'+(pub?' is-public':'')+(isPg?' is-db':' is-app')+'" data-stop="1">'
        +'<div class="svc-foot-main">'
          +'<div class="svc-foot-label"><span>'+esc(label)+'</span></div>'
          +'<code class="svc-foot-url" id="access-'+esc(svc.slug)+'" data-copy="'+esc(primary)+'" title="'+esc(primary)+'">'+esc(svc.type==='bucket' ? maskBucketURLDisplay(primary) : primary)+'</code>'
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
    if (svc.type === 'bucket') {
      if (!local) return uiHint('No endpoint yet — start the MinIO engine');
      return ''
        +'<div class="copy-row">'
          +'<code id="access-cfg-'+esc(svc.slug)+'" data-copy="'+esc(local)+'">'+esc(maskBucketURLDisplay(local))+'</code>'
          +'<button type="button" class="btn" data-action="copy:access-cfg:'+esc(svc.slug)+'">Copy</button>'
        +'</div>'
        +uiHint('Apps get BUCKET / ENDPOINT / key refs when linked');
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
      var open = publicOpenURL(svc) || pub;
      var path = publicPath(svc);
      var note = path
        ? ('Opens at '+path+' · root / may 404 on APIs · stays until Unexpose')
        : 'Stays until reboot or Unexpose · if Open fails, try DNS 1.1.1.1 (LAN DNS often blocks trycloudflare.com)';
      net = ''
        +'<div class="access-block is-public">'
          +'<div class="access-block-head"><span>Internet</span><span class="ghost">'+(path ? ('open '+path) : 'public link')+'</span></div>'
          +'<div class="copy-row">'
            +'<code id="access-pub-'+esc(svc.slug)+'" data-copy="'+esc(open)+'">'+esc(open)+'</code>'
            +'<button type="button" class="btn" data-action="copy:access-pub:'+esc(svc.slug)+'">Copy</button>'
            +'<a class="btn primary" href="'+esc(open)+'" target="_blank" rel="noopener">Open</a>'
            +'<button type="button" class="btn btn-quiet'+(busyT?' loading':'')+'" data-action="svc:tunnel-stop:'+esc(svc.slug)+'" '+(busyT?'disabled':'')+'>'
              +'<span class="spinner"></span><span>Unexpose</span></button>'
          +'</div>'
          +'<div class="access-note">'+esc(note)+'</div>'
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
    var isBucket = svc.type === 'bucket';
    var building = !isPg && !isBucket && (svc.status === 'building' || !!(svc.deployments || []).some(function(d){ return d.status === 'building' || d.status === 'queued'; }));
    var failed = !isPg && !isBucket && !building && (svc.status === 'failed' || !!svc.last_error);
    var isUp = !!svc.running && !failed && !building;
    var startStopBusy = !!(busy['svc:start:'+svc.slug] || busy['svc:stop:'+svc.slug]);
    var restartBusy = !!(busy['svc:restart:'+svc.slug]);
    var toolCls = 'drawer-tool-btn btn-compact';
    var acts = '';
    if (isPg || isBucket) {
      if (isUp) {
        acts = btn('Stop', 'svc:stop:'+svc.slug, toolCls + ' danger-soft', startStopBusy, 'stop')
          + btn('Restart', 'svc:restart:'+svc.slug, toolCls, restartBusy, 'refresh');
      } else {
        acts = btn('Start', 'svc:start:'+svc.slug, 'primary ' + toolCls, startStopBusy, 'play');
      }
    } else if (building) {
      acts = '<span class="drawer-tool-note ghost" role="status">'+ico('refresh', 'spin')+' Deploying…</span>';
    } else {
      if (isUp) {
        acts = btn('Stop', 'svc:stop:'+svc.slug, toolCls + ' danger-soft', startStopBusy, 'stop');
      } else {
        acts = btn('Start', 'svc:start:'+svc.slug, 'primary ' + toolCls, startStopBusy, 'play');
      }
      acts += btn('Restart', 'svc:restart:'+svc.slug, toolCls, restartBusy || !isUp, 'refresh');
      acts += btn('Logs', 'svc:logs:'+svc.slug, toolCls, false, 'logs');
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


  function bucketOverviewHTML(svc) {
    var name = (svc.bucket && String(svc.bucket).trim()) || svc.slug || '—';
    var sizeRaw = (svc.volume_size && String(svc.volume_size).trim()) || (svc.volume_bytes ? fmtBytes(svc.volume_bytes) : '');
    var size = sizeRaw || '—';
    return ''
      +'<section class="drawer-section drawer-section-card" aria-labelledby="bucket-overview-'+esc(svc.slug)+'">'
        +'<header class="drawer-section-head">'
          +'<h3 id="bucket-overview-'+esc(svc.slug)+'" class="drawer-section-title">Overview</h3>'
          +'<span class="drawer-section-meta ghost">Object storage</span>'
        +'</header>'
        +'<dl class="pg-meta pg-meta-grid">'
          +'<div class="pg-meta-row"><dt class="k">Bucket</dt><dd class="v mono">'+esc(name)+'</dd></div>'
          +'<div class="pg-meta-row"><dt class="k">Size</dt><dd class="v">'+esc(size)+' · object storage</dd></div>'
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
    var isBucket = svc && svc.type === 'bucket';
    var keys = isBucket ? BUCKET_ENV_KEYS : DB_ENV_KEYS;
    var map = isBucket ? bucketEnvMapForService(svc, envText) : dbEnvMapForService(svc, envText);
    var reveal = !!envReveal[svc.slug];
    var primaryKey = isBucket ? 'BUCKET' : 'DATABASE_URL';
    var rows = keys.map(function(k){
      var val = map[k] || '';
      if (!val && k !== primaryKey) return '';
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
      rows = '<div class="empty dock-empty compact"><p>Connection vars appear after the '+(isBucket?'bucket':'database')+' is ready</p></div>';
    }
    return ''
      +'<section class="drawer-section drawer-section-card env-board" aria-labelledby="pg-env-'+esc(svc.slug)+'">'
        +'<header class="env-board-head drawer-section-head">'
          +'<div class="drawer-section-head-main">'
            +'<h3 id="pg-env-'+esc(svc.slug)+'" class="drawer-section-title">Environment</h3>'
            +'<span class="ghost drawer-section-sub">'+(isBucket ? 'MinIO on this Pi' : 'For Go apps · os.Getenv / JSON')+'</span>'
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

  function serviceSettingsHTML(svc, dbs, buckets) {
    buckets = buckets || (deployed || []).filter(function(x){ return x.type === 'bucket'; });
    var draft = settingsDraft[svc.slug] || {};
    var isPg = svc.type === 'postgres';
    var isBucket = svc.type === 'bucket';
    var building = !isPg && !isBucket && (svc.status === 'building' || !!(svc.deployments || []).some(function(d){ return d.status === 'building' || d.status === 'queued'; }));
    var failed = !isPg && !isBucket && !building && (svc.status === 'failed' || !!svc.last_error);
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
    var linkVal = Object.prototype.hasOwnProperty.call(draft, 'linked_database')
      ? (draft.linked_database || '')
      : (svc.linked_database || '');
    var bucketVal = Object.prototype.hasOwnProperty.call(draft, 'linked_bucket')
      ? (draft.linked_bucket || '')
      : (svc.linked_bucket || '');
    var envVal = (draft.env != null && String(draft.env).trim() !== '')
      ? draft.env
      : '';
    var linkedName = '';
    if (linkVal) {
      var linked = (dbs || []).filter(function(d){ return d.slug === linkVal; })[0];
      linkedName = linked ? (linked.name || linked.slug) : linkVal;
    }
    var linkedBucketName = '';
    if (bucketVal) {
      var lb = (buckets || []).filter(function(d){ return d.slug === bucketVal; })[0];
      linkedBucketName = lb ? (lb.name || lb.slug) : bucketVal;
    }
    var scope = svc.slug;
    var customEnvVal = (linkVal || bucketVal) ? splitCustomEnv(envVal) : envVal;
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
    if (isBucket) {
      return ''
        +'<div class="settings settings-drawer settings-pg">'
          +bucketOverviewHTML(svc)
          +pgEnvBoardHTML(svc, envVal)
          +'<section class="drawer-section drawer-section-card drawer-section-compact">'
            +uiField({
              label: 'Display name',
              meta: 'label',
              control: uiInput({ name: 'name', value: nameVal })
            })
            +uiHint('Bucket · '+esc(svc.bucket || svc.slug)+' · '+esc(svc.connection_url || 'http://127.0.0.1:9000'))
          +'</section>'
          +uiFooter({
            left: '<span class="ghost">Delete removes this bucket and objects</span>',
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
      ? wizAutoDBEnvHTML(linkLabel, linkedMap, [], { reveal: !!envReveal[svc.slug + ':env'], revealAction: 'envreveal:' + svc.slug + ':env', group: activeGroup || svc.group || '' })
      : '<div class="wiz-auto-env wiz-auto-pending"><div class="wiz-auto-head"><span>From '+esc(linkLabel)+'</span><span class="ghost">linking…</span></div><div class="ghost" style="font-size:11px">DB_* / POSTGRES_* / DATABASE_URL copy on save</div></div>');
    var bucketPicker = buckets.length
      ? cselectHTML('link-bucket', bucketVal, 'No bucket', [{value:'',label:'No bucket'}].concat(buckets.map(function(d){ return {value:d.slug,label:d.name||d.slug,meta:'Bucket'}; })), false, {searchable: (buckets||[]).length > 4, searchPlaceholder:'Filter…'})
      : uiEmpty({ mini: true, body: 'No bucket in this group yet.' });
    var bucketBoard = bucketVal
      ? bucketLinkBoardMap(bucketVal, envVal, (draft && draft.bucket_env) || null)
      : { map: {}, ready: false, preview: false };
    var bucketMap = bucketBoard.map || {};
    var bucketReady = !!(bucketVal && bucketBoard.ready);
    var bucketBlock = !bucketVal ? '' : (bucketReady
      ? wizAutoBucketEnvHTML(linkedBucketName || bucketVal, bucketMap, {
          reveal: !!envReveal[svc.slug + ':bucket'],
          revealAction: 'envreveal:' + svc.slug + ':bucket',
          preview: !!bucketBoard.preview,
          group: activeGroup || svc.group || ''
        })
      : '<div class="wiz-auto-env wiz-auto-pending"><div class="wiz-auto-head"><span>From '+esc(linkedBucketName || bucketVal)+'</span><span class="ghost">loading…</span></div><div class="ghost" style="font-size:11px">Fetching BUCKET · ENDPOINT · keys</div></div>');
    var envMergedBody = ''
      +'<div class="env-merge">'
        +'<div class="env-merge-block">'
          +'<div class="env-merge-label">Database</div>'
          +dbPicker
        +'</div>'
        +linkedBlock
        +'<div class="env-merge-block">'
          +'<div class="env-merge-label">Bucket</div>'
          +bucketPicker
        +'</div>'
        +bucketBlock
        +'<div class="env-merge-block">'
          +'<div class="wiz-custom-head">'
            +'<span>'+(linkVal || bucketVal ? 'Your variables' : 'Variables')+'</span>'
            +'<div class="seg mini">'
              +'<button type="button" data-action="envmode:'+esc(svc.slug)+':text" class="'+(mode!=='json'?'active':'')+'">KEY=value</button>'
              +'<button type="button" data-action="envmode:'+esc(svc.slug)+':json" class="'+(mode==='json'?'active':'')+'">JSON</button>'
            +'</div>'
          +'</div>'
          +'<textarea class="env" name="env" placeholder="'+(mode==='json'?'{\n  \"PORT\": \"5100\"\n}':'KEY=value')+'">'+esc(customEnvVal)+'</textarea>'
        +'</div>'
      +'</div>';
    var envSummaryText = (linkVal ? (linkedName || linkVal) : 'No database')
      + ' · ' + (bucketVal ? (linkedBucketName || bucketVal) : 'No bucket')
      + ' · ' + envSummary((linkVal || bucketVal) ? customEnvVal : envVal);
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
          +'<button type="button" class="btn btn-quiet btn-compact has-ico" data-action="svc:logs:'+esc(svc.slug)+'">'+ico('logs')+'<span>Logs</span></button>'
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
    var isBucket = svc.type === 'bucket';
    var isEngine = isPg || isBucket;
    var building = !isEngine && (svc.status === 'building' || !!(svc.deployments || []).some(function(d){ return d.status === 'building' || d.status === 'queued'; }));
    var failed = !isEngine && !building && (svc.status === 'failed' || !!svc.last_error);
    var isUp = !!svc.running && !failed && !building;
    var diskLabel = svc.disk_bytes ? fmtBytes(svc.disk_bytes) : '';
    var kind = svcKindMeta(svc);
    var st = statusMeta(svc, building, failed, isUp);
    var metaBits = [];
    if (isPg) {
      if (svc.database) metaBits.push(svc.database);
      if (svc.volume_size) metaBits.push(svc.volume_size);
      else if (diskLabel) metaBits.push(diskLabel);
    } else if (isBucket) {
      if (svc.bucket) metaBits.push(svc.bucket);
      if (svc.volume_size) metaBits.push(svc.volume_size);
      else if (diskLabel) metaBits.push(diskLabel);
    } else {
      if (svc.repo) metaBits.push(svc.repo.split('/').pop() || svc.repo);
      if (svc.port) metaBits.push(':' + svc.port);
      if (publicURL(svc)) metaBits.push('public');
      else if (diskLabel) metaBits.push(diskLabel);
    }
    var sub = metaBits.join(' · ');
    var linkVal = Object.prototype.hasOwnProperty.call(draft, 'linked_database')
      ? (draft.linked_database || '')
      : (svc.linked_database || '');
    var bucketVal = Object.prototype.hasOwnProperty.call(draft, 'linked_bucket')
      ? (draft.linked_bucket || '')
      : (svc.linked_bucket || '');
    var powerBusy = !!(busy['svc:start:'+svc.slug] || busy['svc:stop:'+svc.slug] || building);
    var pgPowerBusy = !!(busy['svc:start:'+svc.slug] || busy['svc:stop:'+svc.slug] || busy['svc:restart:'+svc.slug]);
    var quickActs = '';
    if (!selected) {
      if (isEngine) {
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
    if (!selected && !isEngine && failed && svc.last_error) {
      banner = ''
        +'<div class="svc-banner fail" data-stop="1">'
          +'<div class="svc-banner-text">'+esc(String(svc.last_error).slice(0,120))+'</div>'
          +'<button type="button" class="btn btn-quiet btn-compact" data-action="svc:logs:'+esc(svc.slug)+'">Logs</button>'
        +'</div>';
    } else if (!selected && !isEngine && building) {
      banner = ''
        +'<div class="svc-banner build" data-stop="1">'
          +'<div class="svc-build-track"><span class="svc-build-fill"></span></div>'
          +'<div class="svc-banner-text">Deploying…</div>'
        +'</div>';
    }
    var accessIcon = '';
    if (!selected && !failed && !building) {
      var primary = publicURL(svc) || accessURL(svc);
      if (primary && !isEngine) {
        accessIcon = ''
          +'<a class="svc-node-link" href="'+esc(primary)+'" target="_blank" rel="noopener" data-stop="1" title="Open '+esc(primary)+'">'
            +ico('open')
          +'</a>';
      }
    }
    return ''
      +'<div class="svc-card svc-widget svc-node kind-'+kind.kind+(selected?' selected':'')+(building?' building':'')+(failed?' failed':'')+(isUp?' is-up':'')+'" data-slug="'+esc(svc.slug)+'" data-kind="'+kind.kind+'"'+(linkVal?' data-linked="'+esc(linkVal)+'"':'')+(bucketVal?' data-linked-bucket="'+esc(bucketVal)+'"':'')+'>'
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
