  var SYS_MEM_RESERVE_MB = 768;
  var SYS_CPU_RESERVE = 0.5;
  function piCapacity() {
    var d = (state && state.device_metrics) || {};
    var mem = d.memory || {};
    var cpu = d.cpu || {};
    var totalMB = Math.max(512, Math.round((mem.total_bytes || 0) / (1024 * 1024)));
    var cores = Math.max(1, Number(cpu.count || 1));
    var maxMem = Math.max(256, totalMB - SYS_MEM_RESERVE_MB);
    var maxCpu = Math.max(0.5, Math.round((cores - SYS_CPU_RESERVE) * 10) / 10);
    return { totalMB: totalMB, cores: cores, maxMem: maxMem, maxCpu: maxCpu, reserveMB: SYS_MEM_RESERVE_MB, reserveCpu: SYS_CPU_RESERVE };
  }
  function allocatedResources(excludeSlug) {
    var mem = 0, cpus = 0;
    (deployed || []).forEach(function(s){
      if (s.type !== 'go') return;
      if (excludeSlug && s.slug === excludeSlug) return;
      mem += Number(s.memory_mb || 0);
      cpus += Number(s.cpus || 0);
    });
    return { mem: mem, cpus: Math.round(cpus * 10) / 10 };
  }
  function rangeThumbPct(el) {
    if (!el) return 0;
    var min = parseFloat(el.min);
    var max = parseFloat(el.max);
    var val = parseFloat(el.value);
    if (!(max > min)) return 0;
    return Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  }
  function resourceControlsHTML(opts) {
    opts = opts || {};
    var cap = piCapacity();
    var other = allocatedResources(opts.excludeSlug || null);
    var mem = Number(opts.memory_mb || 512);
    var cpus = Number(opts.cpus || 1);
    if (mem < 64) mem = 64;
    if (mem > cap.maxMem) mem = cap.maxMem;
    if (cpus < 0.1) cpus = 0.1;
    if (cpus > cap.maxCpu) cpus = cap.maxCpu;
    mem = Math.round(mem / 64) * 64;
    cpus = Math.round(cpus * 10) / 10;
    var memName = opts.memName || 'memory_mb';
    var cpuName = opts.cpuName || 'cpus';
    var memId = opts.memId || '';
    var cpuId = opts.cpuId || '';
    var memPct = cap.totalMB ? Math.round(mem / cap.totalMB * 100) : 0;
    var cpuPct = cap.cores ? Math.round(cpus / cap.cores * 100) : 0;
    var memThumb = cap.maxMem > 64 ? ((mem - 64) / (cap.maxMem - 64)) * 100 : 0;
    var cpuThumb = cap.maxCpu > 0.1 ? ((cpus - 0.1) / (cap.maxCpu - 0.1)) * 100 : 0;
    function card(kind, label, valueHtml, unit, inputAttrs, thumb, meta) {
      return ''
        +'<div class="res-card" data-kind="'+esc(kind)+'">'
          +'<div class="res-head">'
            +'<span class="res-label">'+esc(label)+'</span>'
            +'<span class="res-value-pill">'
              +'<strong class="res-val res-val-'+esc(kind)+'">'+valueHtml+'</strong>'
              +(unit ? '<span class="res-unit">'+esc(unit)+'</span>' : '')
            +'</span>'
          +'</div>'
          +'<div class="res-slider" style="--thumb:'+esc(Math.round(thumb * 10) / 10)+'%" data-res-slider="1">'
            +'<div class="res-track" aria-hidden="true">'
              +'<span class="res-fill"></span>'
            +'</div>'
            +'<input type="range" '+inputAttrs+'>'
          +'</div>'
          +'<div class="res-meta"><span class="res-pct-'+esc(kind)+'">'+esc(meta)+'</span></div>'
        +'</div>';
    }
    var memMeta = memPct + '% of Pi' + (other.mem ? ' · others '+other.mem+' MB' : '');
    var cpuMeta = cpuPct + '% of '+cap.cores+' cores' + (other.cpus ? ' · others '+other.cpus : '');
    return ''
      +'<div class="res-panel" data-res-panel="1"'
        +' data-total-mb="'+esc(cap.totalMB)+'"'
        +' data-cores="'+esc(cap.cores)+'"'
        +' data-max-mem="'+esc(cap.maxMem)+'"'
        +' data-max-cpu="'+esc(cap.maxCpu)+'"'
        +' data-other-mem="'+esc(other.mem)+'"'
        +' data-other-cpu="'+esc(other.cpus)+'">'
        +'<div class="res-grid">'
          +card('mem', 'Memory', esc(mem), 'MB',
            (memId?'id="'+esc(memId)+'" ':'')+'name="'+esc(memName)+'" min="64" max="'+esc(cap.maxMem)+'" step="64" value="'+esc(mem)+'" data-res="mem"',
            memThumb, memMeta)
          +card('cpu', 'CPU', esc(cpus), 'cores',
            (cpuId?'id="'+esc(cpuId)+'" ':'')+'name="'+esc(cpuName)+'" min="0.1" max="'+esc(cap.maxCpu)+'" step="0.1" value="'+esc(cpus)+'" data-res="cpu"',
            cpuThumb, cpuMeta)
        +'</div>'
        +uiHint('Docker hard limits · leave Pi headroom')
        +'<p class="res-warn" hidden>Over safe headroom — lower limits or stop other apps.</p>'
      +'</div>';
  }
  function syncResLabels(panel) {
    if (!panel) return;
    var totalMB = parseInt(panel.getAttribute('data-total-mb'), 10) || 1;
    var cores = parseFloat(panel.getAttribute('data-cores')) || 1;
    var maxMem = parseInt(panel.getAttribute('data-max-mem'), 10) || totalMB;
    var maxCpu = parseFloat(panel.getAttribute('data-max-cpu')) || cores;
    var otherMem = parseInt(panel.getAttribute('data-other-mem'), 10) || 0;
    var otherCpu = parseFloat(panel.getAttribute('data-other-cpu')) || 0;

    var memEl = panel.querySelector('[data-res=mem]');
    var cpuEl = panel.querySelector('[data-res=cpu]');
    var mem = memEl ? (parseInt(memEl.value, 10) || 512) : 512;
    var cpus = cpuEl ? Math.round((parseFloat(cpuEl.value) || 1) * 10) / 10 : 1;
    var memPct = Math.round(mem / totalMB * 100);
    var cpuPct = Math.round(cpus / cores * 100);

    var memLab = panel.querySelector('.res-val-mem');
    var cpuLab = panel.querySelector('.res-val-cpu');
    var memPctEl = panel.querySelector('.res-pct-mem');
    var cpuPctEl = panel.querySelector('.res-pct-cpu');
    if (memLab) memLab.textContent = String(mem);
    if (cpuLab) cpuLab.textContent = String(cpus);
    if (memPctEl) memPctEl.textContent = memPct + '% of Pi' + (otherMem ? ' · others ' + otherMem + ' MB' : '');
    if (cpuPctEl) cpuPctEl.textContent = cpuPct + '% of ' + cores + ' cores' + (otherCpu ? ' · others ' + otherCpu : '');

    if (memEl) {
      var wrap = memEl.closest('.res-slider');
      if (wrap) wrap.style.setProperty('--thumb', rangeThumbPct(memEl).toFixed(2) + '%');
    }
    if (cpuEl) {
      var wrap2 = cpuEl.closest('.res-slider');
      if (wrap2) wrap2.style.setProperty('--thumb', rangeThumbPct(cpuEl).toFixed(2) + '%');
    }

    var over = (otherMem + mem) > maxMem || (otherCpu + cpus) > (maxCpu + 0.05);
    panel.classList.toggle('over', over);
    var warn = panel.querySelector('.res-warn');
    if (warn) warn.hidden = !over;
  }
