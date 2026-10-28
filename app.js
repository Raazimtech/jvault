'use strict';
(() => {
  const SUPABASE_URL = 'https://dpiwdhtbhwjgatvcfkcb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_PSZnTEo74jObih_6TTpXVQ_tJwzTnXY';
  const FUNCTION_URL = SUPABASE_URL + '/functions/v1/jvault';
  const BUCKET = 'jvault-private';
  const MAX_FILE = 50 * 1024 * 1024;
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const $ = id => document.getElementById(id);
  let user = null, profile = null, files = [], view = 'all', toastTimer, loading = false;
  const selectedImages = new Set();
  $('year').textContent = new Date().getFullYear();

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function bytes(value) {
    const n = Number(value) || 0;
    if (n < 1) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    return (n / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + units[i];
  }
  function note(message, type = 'error') {
    const el = $('notice'); el.textContent = message; el.className = 'notice show' + (type === 'success' ? ' success' : '');
  }
  function clearNote() { $('notice').textContent = ''; $('notice').className = 'notice'; }
  function toast(message, bad = false) {
    const el = $('toast'); el.textContent = message; el.className = 'toast' + (bad ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  }
  function usernameEmail(name) { return name.toLowerCase() + '@jvault.invalid'; }
  async function getSetupStatus() {
    const response = await fetch(FUNCTION_URL + '/bootstrap-status', { cache: 'no-store' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Setup service is unavailable.');
    return result;
  }
  function setAuthMode(setup) {
    clearNote();
    $('authhead').innerHTML = setup
      ? '<h2>Create your vault</h2><p>Set up the one and only owner account for JVault.</p>'
      : '<h2>Welcome back</h2><p>Sign in to access your private documents.</p>';
    $('login').classList.toggle('hidden', setup);
    $('setup').classList.toggle('hidden', !setup);
  }
  async function init() {
    try {
      const { data: { session } } = await db.auth.getSession();
      if (session) {
        const { data: p, error } = await db.from('jvault_profiles').select('username').eq('user_id', session.user.id).maybeSingle();
        if (!error && p) { user = session.user; profile = p; await showApp(); return; }
        await db.auth.signOut();
      }
      const status = await getSetupStatus();
      setAuthMode(!status.claimed);
    } catch (error) {
      setAuthMode(false);
      note('JVault could not reach its setup service. Check the deployment and refresh. ' + error.message);
    }
  }

  $('setup').addEventListener('submit', async event => {
    event.preventDefault(); clearNote();
    const username = $('su').value.trim().toLowerCase();
    const password = $('sp').value;
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return note('Use 3–24 letters, numbers, or underscores for your username.');
    if (password.length < 12) return note('Use a password with at least 12 characters.');
    if (password !== $('sc').value) return note('Those passwords do not match.');
    $('sb').disabled = true; $('sb').innerHTML = 'Creating vault…';
    try {
      const response = await fetch(FUNCTION_URL + '/bootstrap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, bootstrapCode: $('sbc').value.trim() })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not create the owner account.');
      $('setup').reset(); setAuthMode(false);
      $('lu').value = username; $('lp').focus();
      note('Your vault owner account is ready. Sign in to continue.', 'success');
    } catch (error) {
      note(error.message);
      try { const status = await getSetupStatus(); setAuthMode(!status.claimed); if (status.claimed) note('One-time setup has already been used. Sign in with the existing owner account.'); } catch (_) {}
    } finally { $('sb').disabled = false; $('sb').innerHTML = 'Create vault owner <span>↗</span>'; }
  });

  $('login').addEventListener('submit', async event => {
    event.preventDefault(); clearNote();
    const username = $('lu').value.trim().toLowerCase(), password = $('lp').value;
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return note('Enter a valid username.');
    $('lb').disabled = true; $('lb').innerHTML = 'Unlocking…';
    try {
      const { data, error } = await db.auth.signInWithPassword({ email: usernameEmail(username), password });
      if (error) throw error;
      const { data: p, error: profileError } = await db.from('jvault_profiles').select('username').eq('user_id', data.user.id).maybeSingle();
      if (profileError || !p) { await db.auth.signOut(); throw new Error('This account is not registered as the JVault owner.'); }
      user = data.user; profile = p; await showApp();
    } catch (error) {
      note(error.message === 'Invalid login credentials' ? 'Incorrect username or password.' : error.message);
    } finally { $('lb').disabled = false; $('lb').innerHTML = 'Unlock vault <span>↗</span>'; }
  });

  async function showApp() {
    $('auth').classList.add('hidden'); $('app').classList.remove('hidden');
    $('uname').innerHTML = escapeHTML(profile.username) + '<br><small class="muted">Vault owner</small>';
    $('avatar').textContent = profile.username.charAt(0).toUpperCase();
    $('today').textContent = new Intl.DateTimeFormat(undefined, { weekday:'long', month:'long', day:'numeric' }).format(new Date()).toUpperCase();
    await loadFiles();
  }
  async function loadFiles() {
    if (!user || loading) return;
    loading = true; $('list').classList.add('loading');
    try {
      const { data, error } = await db.from('jvault_files').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      files = data || [];
      const validIds = new Set(files.filter(isImage).map(f => f.id));
      selectedImages.forEach(id => { if (!validIds.has(id)) selectedImages.delete(id); });
      renderFiles();
    } catch (error) { toast('Could not load files: ' + error.message, true); }
    finally { loading = false; $('list').classList.remove('loading'); }
  }
  function isImage(file) { return /^image\//i.test(file.mime_type || '') || /\.(apng|avif|bmp|gif|jpe?g|png|svg|tiff?|webp|heic|heif)$/i.test(file.name || ''); }

  function renderFiles() {
    const query = $('search').value.trim().toLowerCase();
    const previousCategory = $('filter').value;
    const categories = [...new Set(files.map(f => f.category || 'Uncategorized'))].sort((a,b) => a.localeCompare(b));
    $('filter').innerHTML = '<option value="">All categories</option>' + categories.map(c => '<option value="' + escapeHTML(c) + '">' + escapeHTML(c) + '</option>').join('');
    if (categories.includes(previousCategory)) $('filter').value = previousCategory;
    const used = files.reduce((sum, f) => sum + Number(f.size_bytes || 0), 0);
    $('sf').textContent = files.length; $('ss').textContent = bytes(used); $('statDocs').textContent = files.length;
    $('statSpace').textContent = bytes(used); $('scat').textContent = categories.length;
    $('usageText').textContent = bytes(used) + ' used';
    $('prog').style.width = Math.min(100, used / (1024 ** 3) * 100) + '%';
    let items = files.filter(f => (!query || f.name.toLowerCase().includes(query) || String(f.category).toLowerCase().includes(query)) && (!$('filter').value || f.category === $('filter').value));
    if (view === 'recent') items = items.slice(0, 8);
    if ($('sort').value === 'old') items.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    if ($('sort').value === 'name') items.sort((a,b) => a.name.localeCompare(b.name));
    if ($('sort').value === 'size') items.sort((a,b) => Number(b.size_bytes) - Number(a.size_bytes));
    $('filesTitle').textContent = view === 'recent' ? 'Recently added' : view === 'categories' ? 'Browse by category' : 'Your documents';
    if (view === 'categories') {
      if (!items.length) { renderEmpty(items); updateBulkUI(); return; }
      const groups = categories.map(category => ({ category, rows: items.filter(f => (f.category || 'Uncategorized') === category) })).filter(g => g.rows.length);
      $('list').innerHTML = groups.map(group => '<div class="category-group"><div class="category-group-heading">' + escapeHTML(group.category) + '<span>' + group.rows.length + '</span></div>' + group.rows.map(fileRow).join('') + '</div>').join('');
    } else {
      if (!items.length) { renderEmpty(items); updateBulkUI(); return; }
      $('list').innerHTML = '<div class="thead"><span>Document</span><span>Category</span><span>Added</span><span style="text-align:right">Actions</span></div>' + items.map(fileRow).join('');
    }
    updateBulkUI();
  }
  function updateBulkUI() {
    const visibleImages = [...document.querySelectorAll('[data-image-select]')];
    const selectedVisible = visibleImages.filter(el => selectedImages.has(el.dataset.imageSelect)).length;
    $('selectedCount').textContent = selectedImages.size + ' image' + (selectedImages.size === 1 ? '' : 's') + ' selected';
    const totalImages = files.filter(isImage).length;
    $('bulkBar').classList.toggle('hidden', totalImages === 0);
    $('downloadSelected').disabled = selectedImages.size === 0;
    $('deleteSelected').disabled = selectedImages.size === 0;
    $('selectVisible').checked = visibleImages.length > 0 && selectedVisible === visibleImages.length;
    $('selectVisible').disabled = visibleImages.length === 0;
    $('deleteAll').disabled = files.length === 0;
  }
  function renderEmpty(items) {
    $('list').innerHTML = '<div class="empty"><strong>' + (files.length ? 'No matching documents' : 'Your vault is ready') + '</strong><p>' + (files.length ? 'Try another search or filter.' : 'Upload your first document to get started.') + '</p></div>';
  }
  function fileRow(file) {
    const ext = (file.name.split('.').pop() || 'FILE').slice(0,4).toUpperCase();
    const date = new Date(file.created_at).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
    const cats = ['Uncategorized','Documents','Work','Personal','Finance','Education','Images','Other', ...files.map(f => f.category || 'Uncategorized')].filter((v,i,a) => a.indexOf(v) === i).sort();
    return '<div class="row"><div class="filename">' + (isImage(file) ? '<input class="image-select" type="checkbox" data-image-select="' + file.id + '" aria-label="Select image ' + escapeHTML(file.name) + '" ' + (selectedImages.has(file.id) ? 'checked' : '') + '>' : '') + '<div class="ext">' + escapeHTML(ext) + '</div><div style="min-width:0"><strong title="' + escapeHTML(file.name) + '">' + escapeHTML(file.name) + '</strong><small>' + bytes(file.size_bytes) + '</small></div></div><div class="catcol"><select class="category" data-cat="' + file.id + '" aria-label="Category for ' + escapeHTML(file.name) + '">' + cats.map(c => '<option ' + (c === (file.category || 'Uncategorized') ? 'selected' : '') + ' value="' + escapeHTML(c) + '">' + escapeHTML(c) + '</option>').join('') + '</select></div><div class="datecol muted">' + date + '</div><div class="actions"><button class="iconbtn" data-act="download" data-id="' + file.id + '" title="Download" aria-label="Download ' + escapeHTML(file.name) + '">↓</button><button class="iconbtn" data-act="rename" data-id="' + file.id + '" title="Rename" aria-label="Rename ' + escapeHTML(file.name) + '">✎</button><button class="iconbtn" data-act="delete" data-id="' + file.id + '" title="Delete" aria-label="Delete ' + escapeHTML(file.name) + '">×</button></div></div>';
  }

  function setUploadProgress(visible, status = '', detail = '', percent = 0) {
    const panel = $('uploadProgress');
    panel.classList.toggle('hidden', !visible);
    $('uploadStatus').textContent = status;
    $('uploadDetail').textContent = detail;
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    $('uploadPercent').textContent = Math.round(safePercent) + '%';
    $('uploadProgressFill').style.width = safePercent + '%';
    $('upload').disabled = visible;
    $('browse').disabled = visible;
  }

  async function uploadFiles(fileList) {
    if (!user) return;
    const selected = [...fileList];
    if (!selected.length) return;
    const valid = selected.filter(file => file.size <= MAX_FILE);
    const oversized = selected.length - valid.length;
    if (oversized) toast(oversized + ' file' + (oversized === 1 ? ' was' : 's were') + ' skipped because the limit is 50 MB per file.', true);
    if (!valid.length) { $('picker').value = ''; return; }

    let completed = 0, succeeded = 0, failed = 0;
    setUploadProgress(true, 'Uploading your files…', 'Starting upload 1 of ' + valid.length, 0);
    $('drop').classList.add('uploading');
    try {
      for (let index = 0; index < valid.length; index++) {
        const file = valid[index];
        const base = index / valid.length * 100;
        setUploadProgress(true, 'Uploading your files…', 'File ' + (index + 1) + ' of ' + valid.length + ': ' + file.name, base);
        const clean = file.name.normalize('NFKC').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, '_').slice(0,180) || 'document';
        const path = user.id + '/' + crypto.randomUUID() + '-' + clean;
        try {
          const { error: uploadError } = await db.storage.from(BUCKET).upload(path, file, { cacheControl:'3600', upsert:false, contentType:file.type || 'application/octet-stream' });
          if (uploadError) throw uploadError;
          const { error: insertError } = await db.from('jvault_files').insert({ owner_id:user.id, name:file.name, storage_path:path, size_bytes:file.size, mime_type:file.type || 'application/octet-stream', category:'Uncategorized' });
          if (insertError) { await db.storage.from(BUCKET).remove([path]); throw insertError; }
          succeeded++;
        } catch (error) {
          failed++;
          toast('Upload failed for ' + file.name + ': ' + error.message, true);
        }
        completed++;
        setUploadProgress(true, failed ? 'Uploading files…' : 'Uploading your files…', completed + ' of ' + valid.length + ' processed', completed / valid.length * 100);
      }
      setUploadProgress(true, 'Finishing up…', 'Refreshing your vault', 100);
      await loadFiles();
      if (succeeded && !failed) toast(succeeded + ' file' + (succeeded === 1 ? '' : 's') + ' uploaded successfully.');
      else if (succeeded && failed) toast(succeeded + ' uploaded, ' + failed + ' failed.', true);
      else if (!succeeded) toast('No files were uploaded successfully.', true);
    } finally {
      $('picker').value = '';
      $('drop').classList.remove('uploading');
      setUploadProgress(false);
    }
  }
  $('upload').addEventListener('click', () => $('picker').click());
  $('browse').addEventListener('click', () => $('picker').click());
  $('picker').addEventListener('change', e => uploadFiles(e.target.files));
  ['search','filter','sort'].forEach(id => $(id).addEventListener(id === 'search' ? 'input' : 'change', renderFiles));
  const drop = $('drop');
  ['dragenter','dragover'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.style.background = '#e7efd9'; }));
  ['dragleave','drop'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.style.background = ''; }));
  drop.addEventListener('drop', e => uploadFiles(e.dataTransfer.files));

  $('list').addEventListener('change', async event => {
    const select = event.target.closest('select[data-cat]'); if (!select || !user) return;
    const file = files.find(f => f.id === select.dataset.cat); if (!file) return;
    select.disabled = true;
    try {
      const { error } = await db.from('jvault_files').update({ category:select.value, updated_at:new Date().toISOString() }).eq('id', file.id).eq('owner_id', user.id);
      if (error) throw error;
      file.category = select.value; toast('Category updated.'); renderFiles();
    } catch (error) { toast('Category update failed: ' + error.message, true); }
    finally { select.disabled = false; }
  });
  $('list').addEventListener('click', async event => {
    const button = event.target.closest('button[data-act]'); if (!button || !user) return;
    const file = files.find(f => f.id === button.dataset.id); if (!file) return;
    button.disabled = true;
    try {
      if (button.dataset.act === 'download') {
        const { data, error } = await db.storage.from(BUCKET).createSignedUrl(file.storage_path, 60, { download:file.name });
        if (error) throw error;
        const link = document.createElement('a'); link.href = data.signedUrl; link.download = file.name; link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove();
        toast('Secure download started.');
      } else if (button.dataset.act === 'rename') {
        let name = prompt('Rename document', file.name);
        if (name === null) return;
        name = name.trim(); if (!name || name.length > 255) throw new Error('Name must be 1–255 characters.');
        const { error } = await db.from('jvault_files').update({ name, updated_at:new Date().toISOString() }).eq('id', file.id).eq('owner_id', user.id);
        if (error) throw error;
        toast('Document renamed.'); await loadFiles();
      } else if (button.dataset.act === 'delete') {
        if (!confirm('Permanently delete “' + file.name + '”? This cannot be undone.')) return;
        const { error: removeError } = await db.storage.from(BUCKET).remove([file.storage_path]);
        if (removeError) throw removeError;
        const { error: deleteError } = await db.from('jvault_files').delete().eq('id', file.id).eq('owner_id', user.id);
        if (deleteError) throw deleteError;
        toast('Document permanently deleted.'); await loadFiles();
      }
    } catch (error) { toast(error.message || 'Action failed.', true); }
    finally { button.disabled = false; }
  });


  async function deleteFilesBatch(targetFiles, doubleConfirm = false) {
    if (!targetFiles.length || !user) return;
    if (doubleConfirm) {
      if (!confirm('DELETE ALL ' + targetFiles.length + ' FILES? This will permanently remove every file in your vault.')) return;
      if (!confirm('FINAL WARNING: this cannot be undone. Permanently delete all ' + targetFiles.length + ' files now?')) return;
    } else if (!confirm('Permanently delete ' + targetFiles.length + ' selected image(s)? This cannot be undone.')) return;
    const button = doubleConfirm ? $('deleteAll') : $('deleteSelected');
    button.disabled = true;
    try {
      const paths = targetFiles.map(f => f.storage_path);
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await db.storage.from(BUCKET).remove(paths.slice(i, i + 100));
        if (error) throw error;
      }
      const ids = targetFiles.map(f => f.id);
      const { error: dbError } = await db.from('jvault_files').delete().eq('owner_id', user.id).in('id', ids);
      if (dbError) throw dbError;
      ids.forEach(id => selectedImages.delete(id));
      toast(doubleConfirm ? 'All vault files deleted.' : 'Selected images deleted.');
      await loadFiles();
    } catch (error) {
      toast('Delete failed: ' + (error.message || 'Please try again.'), true);
      await loadFiles();
    } finally { button.disabled = false; updateBulkUI(); }
  }

  $('selectAllImages').addEventListener('click', () => {
    files.filter(isImage).forEach(file => selectedImages.add(file.id));
    renderFiles();
    toast('Selected all ' + files.filter(isImage).length + ' images.');
  });
  $('selectVisible').addEventListener('change', () => {
    document.querySelectorAll('[data-image-select]').forEach(el => {
      if ($('selectVisible').checked) selectedImages.add(el.dataset.imageSelect);
      else selectedImages.delete(el.dataset.imageSelect);
      el.checked = $('selectVisible').checked;
    });
    updateBulkUI();
  });
  $('clearSelected').addEventListener('click', () => {
    selectedImages.clear(); renderFiles();
  });
  $('deleteSelected').addEventListener('click', () => {
    const targets = files.filter(f => selectedImages.has(f.id) && isImage(f));
    deleteFilesBatch(targets);
  });
  $('deleteAll').addEventListener('click', () => deleteFilesBatch([...files], true));
  $('downloadSelected').addEventListener('click', async () => {
    const targets = files.filter(f => selectedImages.has(f.id) && isImage(f));
    if (!targets.length || !user) return;
    const button = $('downloadSelected');
    button.disabled = true; button.textContent = 'Preparing ZIP…';
    try {
      if (!window.JSZip) throw new Error('ZIP download library did not load. Refresh and try again.');
      const zip = new window.JSZip();
      for (const file of targets) {
        const { data, error } = await db.storage.from(BUCKET).createSignedUrl(file.storage_path, 120);
        if (error) throw error;
        const response = await fetch(data.signedUrl);
        if (!response.ok) throw new Error('Could not download ' + file.name);
        let name = file.name, suffix = 2;
        while (zip.file(name)) {
          const dot = name.lastIndexOf('.');
          name = dot > 0 ? file.name.slice(0, dot) + ' (' + suffix++ + ')' + file.name.slice(dot) : file.name + ' (' + suffix++ + ')';
        }
        zip.file(name, await response.blob());
      }
      const blob = await zip.generateAsync({ type:'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'jvault-images-' + new Date().toISOString().slice(0,10) + '.zip';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast('ZIP download started.');
    } catch (error) { toast('Could not prepare ZIP: ' + (error.message || 'Please try again.'), true); }
    finally { button.textContent = 'Download selected'; button.disabled = false; }
  });

  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item === button));
    view = button.dataset.view; renderFiles();
  }));
  async function signOutOfVault() {
    const buttons = [$('logout'), $('logoutTop')].filter(Boolean);
    buttons.forEach(button => { button.disabled = true; button.setAttribute('aria-busy', 'true'); });
    try {
      const { error } = await db.auth.signOut({ scope: 'local' });
      if (error) throw error;
      user = null; profile = null; files = [];
      $('app').classList.add('hidden');
      $('auth').classList.remove('hidden');
      try {
        const status = await getSetupStatus();
        setAuthMode(!status.claimed);
      } catch (_) {
        setAuthMode(false);
      }
      toast('You have been securely signed out.');
    } catch (error) {
      toast('Could not sign out: ' + (error.message || 'Please try again.'), true);
    } finally {
      buttons.forEach(button => { button.disabled = false; button.removeAttribute('aria-busy'); });
    }
  }
  $('logout').addEventListener('click', signOutOfVault);
  $('logoutTop').addEventListener('click', signOutOfVault);
  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && user) {
      user = null; profile = null; files = [];
      $('app').classList.add('hidden'); $('auth').classList.remove('hidden');
    }
  });
  init();
})();