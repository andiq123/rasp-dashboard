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
    if (p < 0.05) return '0%';
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
