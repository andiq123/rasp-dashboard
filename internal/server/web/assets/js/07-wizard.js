  /** Shared modal chrome for Add Go / Add Postgres (and type picker). */
  function wizardShell(opts) {
    opts = opts || {};
    var back = opts.backAction || 'wizard:open';
    var cancel = opts.cancelAction || 'wizard:close';
    var submit = opts.submitAction || '';
    var submitLabel = opts.submitLabel || 'Create';
    var busyOn = !!opts.busy;
    var submitEnabled = opts.submitEnabled !== false;
    var actions = uiActions(
      '<button type="button" class="btn btn-quiet" data-action="'+esc(back)+'">Back</button>'
      +'<button type="button" class="btn" data-action="'+esc(cancel)+'">Cancel</button>'
      +(submit
        ? '<button type="button" class="btn primary '+(busyOn?'loading':'')+'" data-action="'+esc(submit)+'" '+((submitEnabled && !busyOn)?'':'disabled')+'><span class="spinner"></span><span>'+esc(submitLabel)+'</span></button>'
        : '')
    );
    return ''
      +uiHead({
        title: opts.title || 'Add service',
        subHtml: opts.subHtml || ('In <strong>'+esc(activeGroup || '')+'</strong>'),
        actions: actions
      })
      +(opts.body || '');
  }

  function wizardHTML() {
    if (!wizard) return '';
    var step = wizard.step || 'type';
    var body = '';
    if (step === 'github') {
      body = ''
        +uiHead({ title: 'Connect GitHub', sub: 'PAT with repo read — stored on this Pi only.' })
        +uiField({
          label: 'Personal access token',
          meta: 'github_pat_…',
          control: uiInput({ id: 'wiz-token', type: 'password', placeholder: 'github_pat_… or ghp_…', value: wizard.token || '' })
        })
        +uiActions(
          '<button type="button" class="btn" data-action="wizard:close">Cancel</button>'
          +'<button type="button" class="btn primary '+(busy['wizard:github-save']?'loading':'')+'" data-action="wizard:github-save" '+(busy['wizard:github-save']?'disabled':'')+'><span class="spinner"></span><span>Connect</span></button>'
        );
    } else if (step === 'group') {
      body = ''
        +uiHead({ title: 'New group', sub: 'Boundary for databases and Go apps.' })
        +uiField({
          label: 'Name',
          meta: 'slug',
          control: uiInput({ id: 'wiz-group-name', placeholder: 'my-api', value: wizard.name || '', autofocus: true })
        })
        +uiActions(
          '<button type="button" class="btn" data-action="wizard:close">Cancel</button>'
          +'<button type="button" class="btn primary '+(busy['wizard:group-create']?'loading':'')+'" data-action="wizard:group-create" '+(busy['wizard:group-create']?'disabled':'')+'><span class="spinner"></span><span>Create</span></button>'
        );
    } else if (step === 'type') {
      body = ''
        +uiHead({
          title: 'Add service',
          subHtml: 'In <strong>'+esc(activeGroup || '')+'</strong>',
          actions: '<button type="button" class="btn btn-quiet" data-action="wizard:close">Close</button>'
        })
        +'<div class="type-pick type-pick-clean">'
          +'<button type="button" class="type-opt" data-action="wizard:type:go">'
            +'<span class="type-icon go">Go</span>'
            +'<span class="type-copy"><strong>Go app</strong><span>Clone from GitHub, build, and run on this Pi</span></span>'
            +'<span class="type-chev" aria-hidden="true"></span>'
          +'</button>'
          +'<button type="button" class="type-opt" data-action="wizard:type:postgres">'
            +'<span class="type-icon pg">DB</span>'
            +'<span class="type-copy"><strong>Postgres</strong><span>Shared database — apps get DB_* + DATABASE_URL</span></span>'
            +'<span class="type-chev" aria-hidden="true"></span>'
          +'</button>'
          +'<button type="button" class="type-opt" data-action="wizard:type:bucket">'
            +'<span class="type-icon go">S3</span>'
            +'<span class="type-copy"><strong>Bucket</strong><span>Object storage on SD — apps get BUCKET_URL</span></span>'
            +'<span class="type-chev" aria-hidden="true"></span>'
          +'</button>'
        +'</div>';
    } else if (step === 'go') {
      var repoOptions = (repos || []).map(function(r){
        return {
          value: r.full_name,
          label: r.full_name,
          meta: (r.language ? r.language : 'repo') + (r.private ? ' · private' : ''),
          branch: r.default_branch || 'main',
          name: r.name || ''
        };
      });
      var branchOptions = [];
      if (wizard.repo) {
        if (wizard.loadingBranches) {
          branchOptions = [{value: '', label: 'Loading branches…'}];
        } else if ((wizard.branches || []).length) {
          branchOptions = (wizard.branches || []).map(function(b){
            var meta = (b.default ? 'default' : '') + (b.protected ? (b.default ? ' · protected' : 'protected') : '');
            return {value: b.name, label: b.name, meta: meta};
          });
        } else {
          branchOptions = [{value: wizard.branch || 'main', label: wizard.branch || 'main'}];
        }
      }
      var rootOptions = [{value: '', label: 'Repository root', meta: 'go.mod at root'}];
      if (wizard.loadingDirs) {
        rootOptions = [{value: wizard.root_dir || '', label: 'Loading folders…'}];
      } else {
        (wizard.dirs || []).forEach(function(d){
          rootOptions.push({value: d.path, label: d.path, meta: 'directory'});
        });
        if (wizard.root_dir) {
          var seen = rootOptions.some(function(o){ return String(o.value) === String(wizard.root_dir); });
          if (!seen) rootOptions.push({value: wizard.root_dir, label: wizard.root_dir, meta: 'custom'});
        }
      }
      var dbs = (deployed || []).filter(function(x){ return x.type === 'postgres'; });
      var buckets = (deployed || []).filter(function(x){ return x.type === 'bucket'; });
      var autoDb = wizard.linked_database != null ? wizard.linked_database : (dbs.length === 1 ? dbs[0].slug : '');
      if (wizard.linked_database == null && dbs.length === 1) wizard.linked_database = autoDb;
      var autoBucket = wizard.linked_bucket != null ? wizard.linked_bucket : (buckets.length === 1 ? buckets[0].slug : '');
      if (wizard.linked_bucket == null && buckets.length === 1) wizard.linked_bucket = autoBucket;
      var dbOptions = [{value: '', label: 'No database', meta: 'attach later'}].concat(dbs.map(function(d){
        return {value: d.slug, label: d.name || d.slug, meta: 'Postgres'};
      }));
      var bucketOptions = [{value: '', label: 'No bucket', meta: 'attach later'}].concat(buckets.map(function(d){
        return {value: d.slug, label: d.name || d.slug, meta: 'Bucket'};
      }));
      var cap0 = piCapacity();
      var wizMem = wizard.memory_mb || Math.min(512, cap0.maxMem);
      var wizCpu = wizard.cpus || Math.min(1, cap0.maxCpu);
      wizard.memory_mb = wizMem; wizard.cpus = wizCpu;
      var evGo = engineView || { settings: {}, go_options: [] };
      var goTc = wizard.go_toolchain || (evGo.settings && evGo.settings.go_toolchain) || 'auto';
      wizard.go_toolchain = goTc;
      var goOpts = runtimeOptions(evGo.go_options, goTc);
      var advBody = ''
        +resourceControlsHTML({memory_mb: wizMem, cpus: wizCpu, memId: 'wiz-mem', cpuId: 'wiz-cpu', memName: 'memory_mb', cpuName: 'cpus'})
        +'<div class="res-build">'
          +uiField({
            label: 'Go toolchain',
            meta: 'auto follows go.mod',
            control: cselectHTML('wiz-go-tc', goTc, 'Toolchain…', goOpts, false, {searchable:false})
          })
          +uiField({
            label: 'Build command',
            meta: 'optional · /out/app',
            control: uiInput({ id: 'wiz-build', placeholder: 'CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -buildvcs=false -o /out/app .', value: wizard.build_cmd || '', spellcheck: false })
          })
        +'</div>';
      var advSummary = wizMem + ' MB · ' + wizCpu + ' CPU · go ' + goTc + (wizard.build_cmd ? ' · custom' : '');
      var mode = wizard.env_mode || 'text';
      var link = autoDb || '';
      var blink = autoBucket || '';
      var envText = wizard.env != null ? wizard.env : '';
      // PORT is auto-assigned — keep it out of the custom editor.
      if (envText && typeof stripReservedDBEnv === 'function') {
        var em = parseEnvMapClient(envText);
        if (em.PORT != null) {
          delete em.PORT;
          envText = (wizard.env_mode === 'json') ? envMapToJSON(em) : envMapToDotenv(em);
          wizard.env = envText;
        }
      }
      var envCount = countEnvKeys(envText);
      var envSummaryTxt = (link || blink)
        ? ((envCount ? envCount + ' custom' : 'linked') + (link ? (' · DB ' + link) : '') + (blink ? (' · bucket ' + blink) : ''))
        : (envCount ? (envCount + ' key' + (envCount === 1 ? '' : 's')) : 'Optional');
      var conflictHits = link ? findReservedEnvConflicts(envText) : [];
      var dups = findDuplicateEnvKeys(envText);
      var warnMsg = formatEnvConflictWarn(conflictHits, dups, link);
      var conflictKeys = reservedConflictKeys(conflictHits);
      var linkedMap = linkedEnvMapFromSources(wizard.db_env || {}, envText);
      var bucketMap = linkedBucketMapFromEnv(envText);
      if (wizard.bucket_env) {
        BUCKET_ENV_KEYS.forEach(function(k){ if (wizard.bucket_env[k]) bucketMap[k] = wizard.bucket_env[k]; });
      }
      var envBody = ''
        +(link ? wizAutoDBEnvHTML(link, linkedMap, conflictKeys, { reveal: !!wizEnvReveal, revealAction: 'wizenvreveal' }) : '')
        +(blink ? wizAutoBucketEnvHTML(blink, bucketMap, { reveal: !!wizEnvReveal, revealAction: 'wizenvreveal' }) : '')
        +'<div class="wiz-custom-env">'
          +'<div class="wiz-custom-head">'
            +'<span>Your variables</span>'
            +'<div class="seg mini">'
              +'<button type="button" data-action="wizenvmode:text" class="'+(mode!=='json'?'active':'')+'">KEY=value</button>'
              +'<button type="button" data-action="wizenvmode:json" class="'+(mode==='json'?'active':'')+'">JSON</button>'
            +'</div>'
          +'</div>'
          +'<textarea class="env wiz-env'+(warnMsg?' has-warn':'')+'" id="wiz-env" name="env" spellcheck="false" placeholder="'+(mode==='json'
            ? '{\n  \"LOG_LEVEL\": \"info\"\n}'
            : 'LOG_LEVEL=info')+'">'+esc(envText)+'</textarea>'
          +'<div class="wiz-env-warn" id="wiz-env-warn"'+(warnMsg?'':' hidden')+'>'+esc(warnMsg)+'</div>'
        +'</div>';
      body = wizardShell({
        title: 'Add Go app',
        submitAction: 'wizard:deploy',
        submitLabel: 'Deploy',
        busy: !!busy.deploy,
        submitEnabled: !!wizard.repo,
        body: '<div class="wiz-grid">'
          +uiField({
            label: 'Repository',
            meta: (repos && repos.length ? repos.length + ' available' : 'Loading…'),
            control: cselectHTML('repo', wizard.repo || '', 'Search repositories…', repoOptions, !(repos && repos.length), {searchable:true, searchPlaceholder:'Filter repositories…'})
          })
          +uiField({
            label: 'Branch',
            meta: 'From GitHub',
            control: cselectHTML('branch', wizard.branch || '', wizard.repo ? 'Select branch…' : 'Pick a repo first', branchOptions, !wizard.repo || !!wizard.loadingBranches, {searchable:true, searchPlaceholder:'Filter branches…'})
          })
          +uiField({
            label: 'Root',
            meta: 'Monorepo',
            control: cselectHTML('root', wizard.root_dir || '', wizard.repo ? 'Repo root or folder…' : 'Pick a repo first', rootOptions, !wizard.repo || !!wizard.loadingDirs, {searchable:true, creatable:true, searchPlaceholder:'Search or type a path…'})
          })
          +uiField({
            label: 'Database',
            meta: 'link',
            control: cselectHTML('db', autoDb || '', 'No database', dbOptions, false, {searchable: dbs.length > 4, searchPlaceholder:'Filter databases…'})
          })
          +uiField({
            label: 'Bucket',
            meta: 'link',
            control: cselectHTML('bucket', autoBucket || '', 'No bucket', bucketOptions, false, {searchable: buckets.length > 4, searchPlaceholder:'Filter buckets…'})
          })
          +uiField({
            label: 'Port',
            meta: (wizard.port_free != null ? (wizard.port_free + ' free') : 'auto'),
            control: '<div class="wiz-port">'
              +'<span class="wiz-port-num">'+(wizard.port ? esc(String(wizard.port)) : '…')+'</span>'
              +'<span class="ghost">'+(wizard.port ? 'assigned on deploy · free now' : 'auditing…')+'</span>'
              +'</div>'
          })
          +'<div class="wiz-span folds">'
            +foldHTML('wiz:env', 'Environment', envSummaryTxt, envBody)
            +foldHTML('wiz:advanced', 'Resources & build', advSummary, advBody)
          +'</div>'
        +'</div>'
        +(wizard.repo
          ? '<p class="deploy-summary">'+esc(wizard.repo)+(wizard.root_dir ? '/'+esc(wizard.root_dir) : '')+' @ '+esc(wizard.branch || '…')+(link ? ' · DB '+esc(link) : '')
              + (function(){
                  var cname = containerNamePreview(activeGroup, wizard.name || wizard.repo.split('/').pop());
                  return cname ? ' · <span class="ghost" title="Docker container name">'+esc(cname)+'</span>' : '';
                })()
            +'</p>'
          : '')
      });
        } else if (step === 'postgres') {
      var ev = engineView || { settings: {}, postgres_options: [] };
      var pgVer = wizard.pg_version || 'latest';
      wizard.pg_version = pgVer;
      var pgOpts = runtimeOptions(ev.postgres_options, pgVer);
      body = wizardShell({
        title: 'Add Postgres',
        submitAction: 'wizard:create-pg',
        submitLabel: 'Create',
        busy: !!busy.deploy,
        body: ''
          +uiField({
            label: 'Name',
            tip: 'Prefix is added automatically',
            control: (function(){
              var prefix = pgIdentPrefix(activeGroup);
              return uiPrefixedInput({
                id: 'wiz-pg-name',
                prefix: prefix,
                placeholder: 'api-db',
                value: wizard.name || '',
                autofocus: true,
                compose: 'pg',
                previewHtml: uiPgNamePreview(activeGroup, wizard.name || '')
              });
            })()
          })
          +uiField({
            label: 'Engine',
            control: cselectHTML('wiz-pg-ver', pgVer, 'Version…', pgOpts, false, {searchable:false})
          })
          +uiHint('Shared on this Pi')
      });
    } else if (step === 'bucket') {
      body = wizardShell({
        title: 'Add Bucket',
        submitAction: 'wizard:create-bucket',
        submitLabel: 'Create',
        busy: !!busy.deploy,
        body: ''
          +uiField({
            label: 'Name',
            tip: 'S3 bucket on this Pi',
            control: uiInput({ id: 'wiz-bucket-name', placeholder: 'uploads', value: wizard.name || '', autofocus: true })
          })
          +uiHint('Stored on this Pi · link a Go app for BUCKET_URL')
      });
    }
    var size = (step === 'go') ? ' modal-md' : (step === 'type' ? ' modal-sm' : '');
    var submit = '';
    if (step === 'github') submit = 'wizard:github-save';
    else if (step === 'group') submit = 'wizard:group-create';
    else if (step === 'go') submit = 'wizard:deploy';
    else if (step === 'postgres') submit = 'wizard:create-pg';
    else if (step === 'bucket') submit = 'wizard:create-bucket';
    return '<div class="modal-backdrop" data-action="wizard:backdrop"><div class="modal'+size+'" data-stop="1"'+(submit ? ' data-submit-action="'+esc(submit)+'"' : '')+'>'+body+'</div></div>';
  }
