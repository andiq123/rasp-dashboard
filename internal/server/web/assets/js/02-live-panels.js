  function monitoring(s) {
    var d = s.device_metrics || {};
    var cpu = d.cpu || {}, mem = d.memory || {}, thermal = d.thermal || {}, storage = d.storage || {}, net = d.network || {};
    var temp = Number(thermal.temperature_celsius || 0);
    return ''
      +'<section class="panel panel-live" id="panel-monitoring">'
          +'<div class="head"><h2>System</h2><span class="hint">Live</span></div>'
          +'<div class="metrics metrics-dense">'
            +metric('CPU', fmtPct(cpu.busy_percent), 'Idle ' + fmtPct(cpu.idle_percent), cpu.busy_percent, 'cpu')
            +metric('Memory', fmtPct(mem.used_percent), fmtBytes(mem.used_bytes), mem.used_percent, 'memory')
            +metric('Thermal', thermal.available ? temp.toFixed(0) + '°' : 'n/a', thermal.throttle_known ? (thermal.throttled ? 'Throttled' : 'OK') : 'Sensor', temp / 85 * 100, 'thermal')
            +metric('Disk', fmtPct(storage.used_percent), fmtBytes(storage.used_bytes), storage.used_percent, 'storage')
          +'</div>'
          +'<div class="net net-dense">'
            +'<div><span>↓ Down</span><strong>'+esc(fmtRate(net.down_bytes_per_sec))+'</strong></div>'
            +'<div><span>↑ Up</span><strong>'+esc(fmtRate(net.up_bytes_per_sec))+'</strong></div>'
          +'</div>'
        +'</section>';
  }
  function vpn(s, c) {
    var mode = s.mode || 'mullvad';
    var h = health(s);
    var dhcp = (s.dhcp_start && s.dhcp_end) ? s.dhcp_start + ' – ' + s.dhcp_end : 'Not set';
    return ''
      +'<section class="panel panel-live" id="panel-vpn">'
          +'<div class="vpn-top">'
            +'<div class="vpn-title">'
              +'<div class="big">'+esc(mode === 'residential' ? 'Residential' : 'Mullvad')+'</div>'
              +'<div class="route">'+esc(routeLabel(mode))+'</div>'
            +'</div>'
            +'<div class="pill '+esc(h.cls)+'"><span class="pulse '+(h.cls === 'off' ? 'off' : '')+'"></span>'+esc(h.text)+'</div>'
          +'</div>'
          +'<div class="seg">'
            +'<button type="button" data-action="mode:mullvad" class="'+(mode === 'mullvad' ? 'active' : '')+'" '+(busy['mode:mullvad'] || busy['mode:residential'] ? 'disabled' : '')+'>Mullvad</button>'
            +'<button type="button" data-action="mode:residential" class="'+(mode === 'residential' ? 'active' : '')+'" '+(busy['mode:mullvad'] || busy['mode:residential'] ? 'disabled' : '')+'>Residential</button>'
          +'</div>'
          +'<div class="actions">'
            +btn('Start', 'hotspot:start', 'primary', s.hotspot_running)
            +btn('Stop', 'hotspot:stop', '', !s.hotspot_running)
            +btn('Restart', 'hotspot:restart', '', false)
          +'</div>'
          +'<div class="rows">'
            +'<div class="row"><span>SSID</span><strong>'+esc(s.ssid || '—')+'</strong></div>'
            +'<div class="row"><span>Gateway</span><strong>'+esc(s.hotspot_ip || '—')+'</strong></div>'
            +'<div class="row"><span>DHCP</span><strong>'+esc(dhcp)+'</strong></div>'
          +'</div>'
          +'<details class="settings">'
            +'<summary>Edit hotspot settings</summary>'
            +'<form id="config-form">'
              +'<div class="fields">'
                +field('SSID', 'ssid', c.ssid || s.ssid || '')
                +field('Password', 'password', c.password || '')
                +field('Gateway IP', 'hotspot_ip', c.hotspot_ip || s.hotspot_ip || '')
                +field('DHCP start', 'dhcp_start', c.dhcp_start || s.dhcp_start || '')
                +field('DHCP end', 'dhcp_end', c.dhcp_end || s.dhcp_end || '')
              +'</div>'
              +'<div class="form-actions"><button type="submit" class="btn primary '+(busy.config?'loading':'')+'" '+(busy.config?'disabled':'')+'><span class="spinner"></span><span>Save</span></button></div>'
            +'</form>'
          +'</details>'
        +'</section>';
  }

