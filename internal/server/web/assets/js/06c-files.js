  /* Files explorer — home-rooted browser with preview + clipboard ops. */
  var FILES_HOME = '/home/andiq';
  var filesPath = FILES_HOME;
  var filesListing = null;
  var filesLoading = false;
  var filesError = null;
  var filesReq = 0;
  var filesShowHidden = false;
  var filesQuery = '';
  var filesSelected = null;
  var filesClip = null; // { op:'copy'|'cut', path, name, type }
  var filesPreview = null; // { path, name, text, ... } | loading | error
  var filesPreviewLoading = false;

  function filesIsUnder(path, root) {
    path = path || '';
    root = root || FILES_HOME;
    if (path === root) return true;
    return path.indexOf(root + '/') === 0;
  }

  function filesParentOf(path) {
    if (!path || path === '/') return '';
    var p = path.replace(/\/+$/, '');
    var i = p.lastIndexOf('/');
    if (i <= 0) return '/';
    return p.slice(0, i) || '/';
  }

  function filesCanUp(path) {
    path = path || FILES_HOME;
    if (path === '/') return false;
    // Stay inside home by default; only leave via System shortcut.
    if (filesIsUnder(path, FILES_HOME) && path !== FILES_HOME) return true;
    if (!filesIsUnder(path, FILES_HOME) && path !== '/') return true;
    return false;
  }

  function filesFmtWhen(ms) {
    if (!ms) return '—';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '—';
    var now = new Date();
    var pad = function(n){ return n < 10 ? ('0'+n) : String(n); };
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    var t = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (sameDay) return 'Today, ' + t;
    var y = d.getFullYear() === now.getFullYear();
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + (y ? '' : (', ' + d.getFullYear())) + ', ' + t;
  }

  function filesFmtBytes(n) {
    n = Number(n) || 0;
    if (n < 0) return '—';
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var v = n / 1024;
    var i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    if (v >= 100) return Math.round(v) + ' ' + units[i];
    if (v >= 10) return v.toFixed(1) + ' ' + units[i];
    return v.toFixed(2) + ' ' + units[i];
  }

  function filesRowIco(ent) {
    if (ent.type === 'dir') {
      return '<svg class="ico fe-ico fe-ico-dir" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';
    }
    if (ent.type === 'symlink') {
      return '<svg class="ico fe-ico fe-ico-link" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l2.1-2.1a5 5 0 0 0-7.1-7.1L10.9 5"/><path d="M14 11a5 5 0 0 0-7.1 0L4.8 13.1a5 5 0 0 0 7.1 7.1L13.1 19"/></svg>';
    }
    var ext = ent.ext || '';
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp' || ext === 'svg') {
      return '<svg class="ico fe-ico fe-ico-img" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-4 4-2-2-5 5"/></svg>';
    }
    return '<svg class="ico fe-ico fe-ico-file" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>';
  }

  function filesActIco(kind) {
    if (kind === 'preview') return ico('logs');
    if (kind === 'rename') return ico('settings');
    if (kind === 'copy') return ico('copy');
    if (kind === 'cut') return ico('open');
    if (kind === 'delete') return ico('trash');
    return '';
  }

  function filesBreadcrumbs(path) {
    path = path || FILES_HOME;
    var under = filesIsUnder(path, FILES_HOME);
    var html = '';
    if (under) {
      html += '<button type="button" class="fe-crumb'+(path===FILES_HOME?' is-current':'')+'" data-action="files:go" data-path="'+esc(FILES_HOME)+'" title="'+esc(FILES_HOME)+'">'
        +'<span class="fe-crumb-ico" aria-hidden="true"><svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z"/></svg></span>'
        +'<span>Home</span>'
      +'</button>';
      var rest = path === FILES_HOME ? [] : path.slice(FILES_HOME.length).replace(/^\/+/, '').split('/').filter(Boolean);
      var acc = FILES_HOME;
      for (var i = 0; i < rest.length; i++) {
        acc += '/' + rest[i];
        var cur = i === rest.length - 1;
        html += '<span class="fe-crumb-sep" aria-hidden="true">/</span>'
          +'<button type="button" class="fe-crumb'+(cur?' is-current':'')+'" data-action="files:go" data-path="'+esc(acc)+'" title="'+esc(acc)+'">'
            +'<span>'+esc(rest[i])+'</span>'
          +'</button>';
      }
      return html;
    }
    html += '<button type="button" class="fe-crumb'+(path==='/'?' is-current':'')+'" data-action="files:go" data-path="/" title="/">'
      +'<span class="fe-crumb-ico" aria-hidden="true"><svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg></span>'
      +'<span>System</span>'
    +'</button>';
    var parts = path === '/' ? [] : path.replace(/^\/+/, '').split('/').filter(Boolean);
    var a = '';
    for (var j = 0; j < parts.length; j++) {
      a += '/' + parts[j];
      var c = j === parts.length - 1;
      html += '<span class="fe-crumb-sep" aria-hidden="true">/</span>'
        +'<button type="button" class="fe-crumb'+(c?' is-current':'')+'" data-action="files:go" data-path="'+esc(a)+'" title="'+esc(a)+'">'
          +'<span>'+esc(parts[j])+'</span>'
        +'</button>';
    }
    return html;
  }

  function filesVisibleEntries(list) {
    var ents = (list && list.entries) || [];
    var q = String(filesQuery || '').trim().toLowerCase();
    var out = [];
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i];
      if (!filesShowHidden && e.name && e.name.charAt(0) === '.') continue;
      if (q) {
        var hay = (e.name + ' ' + (e.ext||'') + ' ' + (e.kind||'')).toLowerCase();
        if (hay.indexOf(q) < 0) continue;
      }
      out.push(e);
    }
    return out;
  }

  function filesVisibleBytes(rows) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].type === 'file') n += Number(rows[i].size) || 0;
    }
    return n;
  }

  function filesSummaryHTML(list, visible) {
    var s = (list && list.summary) || {};
    var rows = visible || [];
    var n = rows.length;
    var dirs = 0, files = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].type === 'dir') dirs++;
      else if (rows[i].type === 'file') files++;
    }
    var bits = [];
    bits.push(n + (n === 1 ? ' item' : ' items'));
    if (dirs) bits.push(dirs + (dirs === 1 ? ' folder' : ' folders'));
    if (files) bits.push(files + (files === 1 ? ' file' : ' files'));
    if (s.truncated) bits.push('truncated');
    if (s.hidden && !filesShowHidden) bits.push(s.hidden + ' hidden');
    var sizeLabel = files ? filesFmtBytes(filesVisibleBytes(rows)) : '—';
    return ''
      +'<div class="fe-summary" role="status">'
        +'<div class="fe-sum-pill"><span class="fe-sum-k">Location</span><span class="fe-sum-v mono">'+esc((list && list.path) || FILES_HOME)+'</span></div>'
        +'<div class="fe-sum-pill"><span class="fe-sum-k">Contents</span><span class="fe-sum-v">'+esc(bits.slice(0,3).join(' · '))+'</span></div>'
        +'<div class="fe-sum-pill"><span class="fe-sum-k">Files size</span><span class="fe-sum-v">'+esc(sizeLabel)+'</span></div>'
      +'</div>';
  }

  function filesRowActions(e) {
    var canPreview = e.type === 'file' && (e.textual || isTextExtClient(e.ext, e.name));
    return ''
      +'<span class="fe-c-actions" role="group" aria-label="Actions">'
        +(canPreview
          ? '<button type="button" class="fe-act" data-action="files:preview" data-path="'+esc(e.path)+'" title="Preview">'+filesActIco('preview')+'</button>'
          : '<span class="fe-act fe-act-spacer" aria-hidden="true"></span>')
        +'<button type="button" class="fe-act" data-action="files:rename" data-path="'+esc(e.path)+'" data-name="'+esc(e.name)+'" title="Rename">'+filesActIco('rename')+'</button>'
        +'<button type="button" class="fe-act" data-action="files:copy" data-path="'+esc(e.path)+'" data-name="'+esc(e.name)+'" data-type="'+esc(e.type||'')+'" title="Copy">'+filesActIco('copy')+'</button>'
        +'<button type="button" class="fe-act" data-action="files:cut" data-path="'+esc(e.path)+'" data-name="'+esc(e.name)+'" data-type="'+esc(e.type||'')+'" title="Cut">'+filesActIco('cut')+'</button>'
        +'<button type="button" class="fe-act fe-act-danger" data-action="files:delete" data-path="'+esc(e.path)+'" data-name="'+esc(e.name)+'" title="Delete">'+filesActIco('delete')+'</button>'
      +'</span>';
  }

  function isTextExtClient(ext, name) {
    ext = (ext || '').toLowerCase();
    name = (name || '').toLowerCase();
    var text = {
      txt:1, md:1, rst:1, log:1, csv:1, tsv:1, json:1, yml:1, yaml:1, toml:1, xml:1,
      ini:1, conf:1, cfg:1, env:1, go:1, js:1, ts:1, tsx:1, jsx:1, py:1, rs:1, c:1, h:1,
      cpp:1, hpp:1, java:1, sh:1, bash:1, zsh:1, html:1, css:1, scss:1, sass:1, sql:1,
      mod:1, sum:1, service:1, gitignore:1, dockerignore:1, editorconfig:1
    };
    if (text[ext]) return true;
    return !ext && /^(dockerfile|makefile|readme|license|changelog|gemfile|procfile)$/.test(name);
  }

  function filesTableHTML(list) {
    var visible = filesVisibleEntries(list);
    if (filesLoading && !list) {
      return '<div class="fe-empty" role="status"><div class="nav-spinner" aria-hidden="true"></div><p>Loading…</p></div>';
    }
    if (filesError) {
      return '<div class="fe-empty" role="alert"><strong>Could not open folder</strong><p>'+esc(filesError)+'</p>'
        +'<button type="button" class="btn primary btn-compact has-ico" data-action="files:refresh">'+ico('refresh')+'<span>Retry</span></button></div>';
    }
    if (list && list.error && !(list.entries && list.entries.length)) {
      return '<div class="fe-empty" role="alert"><strong>Unavailable</strong><p>'+esc(list.error)+'</p></div>';
    }
    if (!visible.length) {
      return '<div class="fe-empty"><strong>Empty folder</strong><p class="ghost">No items to show'+(filesQuery?' for this filter':'')+'.</p></div>';
    }
    var rows = visible.map(function(e) {
      var isDir = e.type === 'dir';
      var sel = filesSelected === e.path ? ' is-selected' : '';
      var cut = (filesClip && filesClip.op === 'cut' && filesClip.path === e.path) ? ' is-cut' : '';
      var typeCls = 'fe-type-' + esc(e.type || 'other');
      return ''
        +'<div class="fe-row '+typeCls+sel+cut+'" role="row" tabindex="0"'
          +' data-fe-path="'+esc(e.path)+'"'
          +' data-fe-type="'+esc(e.type||'')+'"'
          +(isDir ? ' data-fe-dir="1"' : '')
          +(e.textual || isTextExtClient(e.ext, e.name) ? ' data-fe-text="1"' : '')
          +' title="'+esc(e.path)+'">'
          +'<span class="fe-c-name">'
            +'<span class="fe-name-ico" aria-hidden="true">'+filesRowIco(e)+'</span>'
            +'<span class="fe-name-text">'+esc(e.name)+'</span>'
            +(e.link_target ? ('<span class="fe-alias ghost">→ '+esc(e.link_target)+'</span>') : '')
          +'</span>'
          +'<span class="fe-c-kind">'+esc(e.kind||'—')+'</span>'
          +'<span class="fe-c-ext mono">'+(e.ext ? esc(e.ext) : '—')+'</span>'
          +'<span class="fe-c-size mono">'+(e.type==='file' ? esc(filesFmtBytes(e.size)) : '—')+'</span>'
          +'<span class="fe-c-date">'+esc(filesFmtWhen(e.modified_ms))+'</span>'
          +filesRowActions(e)
        +'</div>';
    }).join('');
    return ''
      +'<div class="fe-table" role="table" aria-label="Folder contents">'
        +'<div class="fe-thead" role="row">'
          +'<span class="fe-c-name" role="columnheader">Name</span>'
          +'<span class="fe-c-kind" role="columnheader">Kind</span>'
          +'<span class="fe-c-ext" role="columnheader">Ext</span>'
          +'<span class="fe-c-size" role="columnheader">Size</span>'
          +'<span class="fe-c-date" role="columnheader">Date Modified</span>'
          +'<span class="fe-c-actions" role="columnheader">Actions</span>'
        +'</div>'
        +'<div class="fe-tbody" role="rowgroup">'+rows+'</div>'
      +'</div>';
  }

  function filesPreviewHTML() {
    if (!filesPreview && !filesPreviewLoading) return '';
    var body = '';
    if (filesPreviewLoading) {
      body = '<div class="fe-preview-empty"><div class="nav-spinner" aria-hidden="true"></div><p>Loading preview…</p></div>';
    } else if (filesPreview && filesPreview.error && !filesPreview.text) {
      body = '<div class="fe-preview-empty"><strong>'+esc(filesPreview.binary ? 'Binary file' : 'Preview unavailable')+'</strong><p class="ghost">'+esc(filesPreview.error)+'</p></div>';
    } else if (filesPreview) {
      body = ''
        +'<pre class="fe-preview-code">'+esc(filesPreview.text || '')+'</pre>'
        +(filesPreview.truncated ? '<div class="fe-preview-note">Preview truncated</div>' : '');
    }
    var title = (filesPreview && filesPreview.name) || 'Preview';
    var meta = (filesPreview && filesPreview.size_human) ? filesPreview.size_human : '';
    return ''
      +'<aside class="fe-preview" aria-label="File preview">'
        +'<header class="fe-preview-head">'
          +'<div class="fe-preview-title">'
            +'<strong>'+esc(title)+'</strong>'
            +(meta ? '<span class="ghost">'+esc(meta)+'</span>' : '')
          +'</div>'
          +'<button type="button" class="btn btn-quiet btn-compact btn-icon" data-action="files:preview-close" title="Close" aria-label="Close preview">'+ico('close')+'</button>'
        +'</header>'
        +'<div class="fe-preview-body">'+body+'</div>'
      +'</aside>';
  }

  function filesExplorerView() {
    var list = filesListing;
    var path = (list && list.path) || filesPath || FILES_HOME;
    var canUp = filesCanUp(path);
    var clipLabel = filesClip ? ((filesClip.op === 'cut' ? 'Move' : 'Paste') + ' “' + filesClip.name + '”') : '';
    return ''
      +'<div class="nav-page" data-view="files">'
        +'<div class="rack">'
          +'<section class="panel panel-files'+(filesPreview || filesPreviewLoading ? ' has-preview' : '')+'">'
            +'<div class="fe-main">'
              +'<header class="fe-head">'
                +'<div class="fe-title-block">'
                  +'<h2><span class="ws-title-ico" aria-hidden="true">'+filesRowIco({type:'dir'})+'</span> Files</h2>'
                  +'<p class="ghost">Home starts at '+esc(FILES_HOME)+'</p>'
                +'</div>'
                +'<div class="fe-toolbar">'
                  +'<div class="fe-nav-btns">'
                    +'<button type="button" class="btn btn-quiet btn-compact btn-icon" data-action="files:up" '+(canUp?'':'disabled')+' title="Enclosing folder" aria-label="Up">'+ico('back')+'</button>'
                    +'<button type="button" class="btn btn-quiet btn-compact" data-action="files:go" data-path="'+esc(FILES_HOME)+'" title="'+esc(FILES_HOME)+'">Home</button>'
                    +'<button type="button" class="btn btn-quiet btn-compact" data-action="files:go" data-path="/" title="/">System</button>'
                    +'<button type="button" class="btn btn-quiet btn-compact has-ico" data-action="files:refresh" '+(filesLoading?'disabled':'')+'>'+ico('refresh')+'<span>Refresh</span></button>'
                    +(filesClip
                      ? '<button type="button" class="btn primary btn-compact" data-action="files:paste" title="'+esc(clipLabel)+'">Paste</button>'
                        +'<button type="button" class="btn btn-quiet btn-compact" data-action="files:clip-clear" title="Clear clipboard">Clear</button>'
                      : '')
                  +'</div>'
                  +'<label class="fe-search">'
                    +'<span class="fe-search-ico" aria-hidden="true">'+ico('spark')+'</span>'
                    +'<input type="search" name="files-q" value="'+esc(filesQuery)+'" placeholder="Filter" autocomplete="off" spellcheck="false">'
                  +'</label>'
                  +'<label class="fe-check"><input type="checkbox" data-files-hidden '+(filesShowHidden?'checked':'')+'> Hidden</label>'
                +'</div>'
              +'</header>'
              +'<div class="fe-pathbar" aria-label="Path">'+filesBreadcrumbs(path)+'</div>'
              +filesSummaryHTML(list, filesVisibleEntries(list))
              +'<div class="fe-body'+(filesLoading?' is-loading':'')+'">'
                +filesTableHTML(list)
              +'</div>'
            +'</div>'
            +filesPreviewHTML()
          +'</section>'
        +'</div>'
      +'</div>';
  }

  function loadFiles(path, opts) {
    opts = opts || {};
    path = path || filesPath || FILES_HOME;
    filesPath = path;
    filesSelected = null;
    var id = ++filesReq;
    filesLoading = true;
    filesError = null;
    if (opts.render !== false) render({ animate: false });
    return api('/api/files?path=' + encodeURIComponent(path))
      .then(function(data){
        if (id !== filesReq) return;
        filesListing = data;
        filesPath = (data && data.path) || path;
        filesLoading = false;
        filesError = null;
        render({ animate: false });
        syncRouteFromState(true);
      })
      .catch(function(e){
        if (id !== filesReq) return;
        filesLoading = false;
        filesError = (e && e.message) || 'Failed to list folder';
        render({ animate: false });
      });
  }

  function filesOp(body) {
    return api('/api/files', { method: 'POST', body: JSON.stringify(body) });
  }

  function openFilesPreview(path) {
    filesPreviewLoading = true;
    filesPreview = { path: path, name: path.split('/').pop() };
    render({ animate: false });
    return api('/api/files/preview?path=' + encodeURIComponent(path))
      .then(function(data){
        filesPreviewLoading = false;
        filesPreview = data;
        render({ animate: false });
      })
      .catch(function(e){
        filesPreviewLoading = false;
        filesPreview = { path: path, name: path.split('/').pop(), error: (e && e.message) || 'Preview failed' };
        render({ animate: false });
      });
  }

  function closeFilesPreview() {
    filesPreview = null;
    filesPreviewLoading = false;
    render({ animate: false });
  }
