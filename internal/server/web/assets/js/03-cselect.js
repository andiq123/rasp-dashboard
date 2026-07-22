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
