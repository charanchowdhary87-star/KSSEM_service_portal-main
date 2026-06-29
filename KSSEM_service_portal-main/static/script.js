/* static/script.js - frontend glue for KSSEM Service Portal */

/* API base: change if backend runs elsewhere */
const API_BASE = location.hostname === 'localhost' ? 'http://localhost:5000' : (location.protocol + '//' + location.hostname + ':5000');

/* small helpers */
function qp(name) { return new URLSearchParams(window.location.search).get(name); }
function el(id) { return document.getElementById(id); }
function genRef(){ return 'KSSEM-' + Date.now().toString(36).toUpperCase().slice(-6); }
function escapeHtml(s){ if (!s) return ''; return s.replace(/[&<>"']/g, (m)=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]); }

// Global status to color mapping used by complaints list and admin dashboard
function getStatusColor(status) {
  if (!status) return '#95a5a6';
  switch(status.toLowerCase()) {
    case 'queued': return '#FFA500';
    case 'in progress': return '#3498db';
    case 'solved': return '#2ecc71';
    case 'rejected': return '#e74c3c';
    default: return '#95a5a6';
  }
}
/* ---------- offline queue using localStorage ---------- */
const QUEUE_KEY = 'kssem_offline_queue';
function enqueue(obj){ const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); q.push(obj); localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
async function flushQueue(){
  const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  if (!q.length) return;
  for (const item of q.slice()) {
    try {
      const form = new FormData();
      form.append('title', item.title);
      form.append('description', item.description);
      form.append('category', item.category);
      form.append('subcategory', item.subcategory || '');
      form.append('location', item.location || '');
      form.append('contact', item.contact || '');
      if (item.image_base64) form.append('image_base64', item.image_base64);
      const res = await fetch(`${API_BASE}/api/complaints`, { method:'POST', body: form });
      if (res.ok){
        const arr = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
        arr.shift();
        localStorage.setItem(QUEUE_KEY, JSON.stringify(arr));
      } else { break; }
    } catch(e){ break; }
  }
}

window.addEventListener('online', ()=>flushQueue());
if (navigator.onLine) flushQueue();

/* ---------- global detail modal (used by both complaints and admin pages) ---------- */
let currentComplaintId = null;

function showDetailModal(complaint) {
  currentComplaintId = complaint.id;
  
  // Set all detail fields
  const trackingEl = document.getElementById('detailTrackingId');
  if (trackingEl) trackingEl.textContent = complaint.tracking_id;
  
  const categoryEl = document.getElementById('detailCategory');
  if (categoryEl) categoryEl.textContent = complaint.category + (complaint.subcategory ? ' › ' + complaint.subcategory : '');
  
  const locationEl = document.getElementById('detailLocation');
  if (locationEl) locationEl.textContent = complaint.location || 'Not provided';
  
  const contactEl = document.getElementById('detailContact');
  if (contactEl) contactEl.textContent = complaint.contact || 'Not provided';
  
  const titleEl = document.getElementById('detailComplaintTitle');
  if (titleEl) titleEl.textContent = complaint.title;
  
  const descEl = document.getElementById('detailDescription');
  if (descEl) descEl.textContent = complaint.description;
  
  const createdEl = document.getElementById('detailCreatedAt');
  if (createdEl) {
    createdEl.textContent = new Date(complaint.created_at).toLocaleString();
    // small top margin so the created date is clearly visible and not clipped
    createdEl.style.marginTop = '6px';
    createdEl.style.display = 'block';
  }
  
  // set status select only if present (admin modal)
  const statusSelect = document.getElementById('detailStatusSelect');
  if (statusSelect) statusSelect.value = complaint.status;
  
  // show IP if present
  const ipEl = document.getElementById('detailIp');
  if (ipEl) ipEl.textContent = complaint.ip || 'Not recorded';
  
  // Handle image
  const imageContainer = document.getElementById('imageContainer');
  if (imageContainer) {
    if (complaint.image_url) {
      const img = document.getElementById('detailImage');
      if (img) img.src = API_BASE + complaint.image_url;
      imageContainer.style.display = 'block';
    } else {
      imageContainer.style.display = 'none';
    }
  }
  
  // wire block IP button (admin only)
  const blockBtn = document.getElementById('blockIpBtn');
  if (blockBtn) {
    blockBtn.onclick = async () => {
      const ip = complaint.ip;
      if (!ip) { alert('No IP available to block'); return; }
      if (!confirm('Block IP: ' + ip + '?')) return;
      try {
        const res = await fetch(`${API_BASE}/api/admin/block_ip`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ip}) });
        if (res.ok) {
          alert('IP blocked: ' + ip);
          closeDetailModal();
          const loadListFn = window.loadList || (typeof loadList !== 'undefined' ? loadList : null);
          if (loadListFn) loadListFn();
        } else {
          const txt = await res.text();
          alert('Failed to block IP: ' + txt);
        }
      } catch(e) { alert('Failed to block IP: ' + e.message); }
    };
  }

  // Show modal
  const modal = document.getElementById('detailModal');
  if (modal) modal.style.display = 'block';

  // Fetch and render timeline (if container exists)
  const timelineContainer = document.getElementById('timelineContainer');
  if (timelineContainer) {
    timelineContainer.innerHTML = '<div style="padding:12px;color:#666">Loading timeline...</div>';
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/complaints/${complaint.id}/history`);
        if (!res.ok) {
          timelineContainer.innerHTML = '<div style="color: red; padding: 8px;">Failed to load timeline</div>';
          return;
        }
        const events = await res.json();
        if (!events || events.length === 0) {
          timelineContainer.innerHTML = '<div style="padding:8px;color:#666">No timeline available</div>';
          return;
        }

        // Render horizontal timeline with branched lines and circles at branch ends
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.paddingTop = '80px';
        wrapper.style.paddingBottom = '80px';
        wrapper.style.paddingLeft = '20px';
        wrapper.style.paddingRight = '20px';

        // CUSTOMIZATION: Horizontal line style
        const lineColor = '#a7a7a7ff';
        const lineThickness = '2px';
        const stepSpacing = '80px';
        const branchLength = '30px';
        const circleSize = '18px';

        // Create the horizontal line (center backbone)
        const horizontalLine = document.createElement('div');
        horizontalLine.style.position = 'absolute';
        horizontalLine.style.top = '50%';
        horizontalLine.style.left = '0';
        horizontalLine.style.right = '0';
        horizontalLine.style.height = lineThickness;
        horizontalLine.style.backgroundColor = lineColor;
        horizontalLine.style.transform = 'translateY(-50%)';
        wrapper.appendChild(horizontalLine);

        // Container for steps
        const stepsContainer = document.createElement('div');
        stepsContainer.style.position = 'relative';
        stepsContainer.style.display = 'flex';
        stepsContainer.style.justifyContent = 'flex-start';
        // center steps vertically so 50% calculations align with the horizontal backbone
        stepsContainer.style.alignItems = 'center';
        stepsContainer.style.gap = stepSpacing;
        stepsContainer.style.zIndex = '1';

        events.forEach((ev, idx) => {
          // parse numeric values for CSS calculations
          const bl = parseInt(branchLength, 10) || 30;
          const cs = parseInt(circleSize, 10) || 18;
          const isAbove = idx % 2 === 0; // Alternate above/below

          const step = document.createElement('div');
          step.style.position = 'relative';
          step.style.display = 'flex';
          step.style.flexDirection = 'column';
          step.style.alignItems = 'center';
          step.style.minWidth = circleSize;
          // ensure steps have enough vertical space for above/below placement
          step.style.paddingTop = (bl + cs) + 'px';
          step.style.paddingBottom = (bl + cs) + 'px';

          // Branch line: place so one end aligns exactly with backbone (50% of step)
          const branchLine = document.createElement('div');
          branchLine.style.position = 'absolute';
          branchLine.style.left = '50%';
          branchLine.style.width = lineThickness;
          branchLine.style.height = bl + 'px';
          branchLine.style.backgroundColor = lineColor;
          branchLine.style.transform = 'translateX(-50%)';
          if (isAbove) {
            // top positioned so bottom of branch equals step 50% (backbone)
            branchLine.style.top = `calc(50% - ${bl}px)`;
          } else {
            // top positioned so top of branch equals step 50% (backbone)
            branchLine.style.top = '50%';
          }
          step.appendChild(branchLine);

          // Node circle at the end of branch line (centered on branch end)
          const circle = document.createElement('div');
          circle.style.position = 'absolute';
          circle.style.left = '50%';
          if (isAbove) {
            // center of circle sits at (50% - bl)
            circle.style.top = `calc(50% - ${bl}px - ${cs/2}px)`;
          } else {
            // center of circle sits at (50% + bl)
            circle.style.top = `calc(50% + ${bl}px - ${cs/2}px)`;
          }
          circle.style.transform = 'translateX(-50%)';
          circle.style.width = circleSize;
          circle.style.height = circleSize;
          circle.style.borderRadius = '50%';
          circle.style.border = '2px solid white';
          circle.style.zIndex = '10';
          circle.style.boxShadow = '0 0 0 2px ' + lineColor;
          const color = (ev.status && ev.status.toLowerCase() === 'created') ? '#95a5a6' : getStatusColor(ev.status);
          circle.style.backgroundColor = color;
          step.appendChild(circle);

          // Content (label + timestamp) above or below the circle
          const content = document.createElement('div');
          content.style.position = 'absolute';
          content.style.left = '50%';
          content.style.transform = 'translateX(-50%)';
          if (isAbove) {
            // move content further above the circle so it does not overlap
            content.style.top = `calc(50% - ${bl}px - ${cs}px - 50px)`;
          } else {
            content.style.top = `calc(50% + ${bl}px + ${cs}px + 8px)`;
          }
          // bring labels above circles when they get close
          content.style.zIndex = '20';
          content.style.textAlign = 'center';
          content.style.whiteSpace = 'nowrap';

          const title = document.createElement('div');
          title.style.fontWeight = '700';
          title.style.fontSize = '0.95em';
          title.style.color = '#333';
          title.textContent = ev.status;

          const ts = document.createElement('div');
          ts.style.fontSize = '0.85em';
          ts.style.color = '#666';
          ts.style.marginTop = '2px';
          try { ts.textContent = new Date(ev.changed_at).toLocaleString(); } catch(e){ ts.textContent = ev.changed_at || ''; }

          content.appendChild(title);
          content.appendChild(ts);
          step.appendChild(content);

          // Nudge the first content slightly to the right so it doesn't overlap modal padding
          if (idx === 0) {
            content.style.transform += ' translateX(15px)';
          }

          stepsContainer.appendChild(step);
        });

        wrapper.appendChild(stepsContainer);
        timelineContainer.innerHTML = '';
        timelineContainer.appendChild(wrapper);
      } catch (err) {
        timelineContainer.innerHTML = '<div style="color: red; padding: 8px;">Error loading timeline</div>';
      }
    })();
  }
}

function closeDetailModal() {
  const modal = document.getElementById('detailModal');
  if (modal) modal.style.display = 'none';
  currentComplaintId = null;
}

// Modal close buttons - set up globally
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn1 = document.getElementById('closeDetailBtn');
  if (closeBtn1) closeBtn1.addEventListener('click', closeDetailModal);
  
  const closeBtn2 = document.getElementById('closeDetailBtn2');
  if (closeBtn2) closeBtn2.addEventListener('click', closeDetailModal);
  
  const modal = document.getElementById('detailModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'detailModal') {
        closeDetailModal();
      }
    });
  }
});

/* ---------- complaint form page ---------- */
if (el('complaintForm')) {
  let lastBase64 = null;
  // Get category from hidden input or query params
  const category = el('category')?.value || qp('category') || 'General';
  const sub = qp('sub') || '';
  // Optional form title/sub updates if elements exist
  if (el('formTitle')) el('formTitle').textContent = sub ? `${category} › ${sub}` : category;
  if (el('formSub')) el('formSub').textContent = 'Raise Complaint';
  const fileInput = el('imageFile');
  const preview = el('imgPreview');
  fileInput.addEventListener('change', (e)=>{
    const f = e.target.files[0];
    if (!f){ preview.style.display='none'; lastBase64=null; return; }
    const reader = new FileReader();
    reader.onload = function(ev){ preview.src = ev.target.result; preview.style.display='block'; lastBase64 = ev.target.result; };
    reader.readAsDataURL(f);
  });

  el('complaintForm').addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const title = el('compTitle').value.trim();
    const description = el('description').value.trim();
    const location = el('location').value.trim();
    const contact = el('contact').value.trim();
    if (!title || !description){ alert('Title & Description required'); return; }

  // generate a local temporary reference so user always gets an ID
  const localTrackingId = genRef();
  const payload = { title, description, category, subcategory: sub, location, contact, image_base64: lastBase64, tracking_id: localTrackingId, status: 'Queued' };

    // try send to server
    try {
      const form = new FormData();
      form.append('title', title);
      form.append('description', description);
      form.append('category', category);
      form.append('subcategory', sub);
      form.append('location', location);
      form.append('contact', contact);
      if (lastBase64) form.append('image_base64', lastBase64);

      const res = await fetch(`${API_BASE}/api/complaints`, { method:'POST', body: form });
      if (res.ok) {
        const data = await res.json();
        // show official server tracking id
        el('ref').textContent = data.tracking_id || localTrackingId;
        el('complaintForm').style.display='none';
        el('success').style.display='block';
      } else {
        // server rejected (campus-only or other): queue locally and show the temporary ID
        const serverText = await res.text();
        enqueue(payload);
        el('offlineMsg').style.display='block';
        // show success UI with local tracking id so user has a reference to track locally
        el('ref').textContent = localTrackingId;
        el('complaintForm').style.display='none';
        el('success').style.display='block';
  // show local tracking id clearly to the user along with server response for context
  try { alert('Saved locally (will sync when online).\nReference ID: ' + localTrackingId + "\n\nServer response: " + serverText); } catch(e){}
      }
    } catch(e) {
      // network error: queue and show local tracking id
      enqueue(payload);
      el('offlineMsg').style.display='block';
      el('ref').textContent = localTrackingId;
      el('complaintForm').style.display='none';
      el('success').style.display='block';
      try { alert('No connection — saved locally and will sync when online.\nReference ID: ' + localTrackingId); } catch(err){}
    }
  });
}

/* ---------- complaints page (search) ---------- */
if (el('complaintSearchBtn')) {
  el('complaintSearchBtn').addEventListener('click', async ()=>{
    const q = el('searchInput').value.trim();
    const list = el('complaintsList');
    list.innerHTML = '';
    
    try {
      // First, fetch complaints from the server database
      const url = new URL(`${API_BASE}/api/user/complaints`);
      if (q) url.searchParams.set('q', q);
      
      let serverComplaints = [];
      try {
        const res = await fetch(url.toString());
        if (res.ok) {
          serverComplaints = await res.json();
        }
      } catch(e) {
        console.log('Could not fetch from server, will show local queue');
      }
      
      // Get locally queued complaints (not yet synced)
      const local = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      
      // If searching, filter both server and local
      if (q) {
        const searchLower = q.toLowerCase();
        serverComplaints = serverComplaints.filter(c => 
          c.tracking_id.toLowerCase().includes(searchLower) || 
          c.title.toLowerCase().includes(searchLower)
        );
        const foundLocal = local.filter(x => 
          (x.tracking_id && x.tracking_id.toLowerCase().includes(searchLower)) ||
          (x.title && x.title.toLowerCase().includes(searchLower))
        );
        
        if (serverComplaints.length === 0 && foundLocal.length === 0) {
          list.innerHTML = '<tr><td colspan="4" style="padding: 20px; text-align: center;">No matching complaints found</td></tr>';
          return;
        }
        
        // Show server complaints first
        serverComplaints.forEach(renderServer);
        // Then show local queued ones
        foundLocal.forEach(renderLocal);
      } else {
        // Show all: server complaints first, then local queue
        if (serverComplaints.length === 0 && local.length === 0) {
          list.innerHTML = '<tr><td colspan="4" style="padding: 20px; text-align: center;">No complaints submitted yet</td></tr>';
          return;
        }
        
        // Sort by date - newer first
        serverComplaints.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        serverComplaints.forEach(renderServer);
        local.slice().reverse().forEach(renderLocal);
      }
    } catch(e) {
      console.error('Error loading complaints:', e);
      list.innerHTML = '<tr><td colspan="4" style="padding: 20px; text-align: center; color: red;">Error loading complaints</td></tr>';
    }
  });

  // uses global getStatusColor()

  function renderServer(c) {
    const tr = document.createElement('tr');
    /* CUSTOMIZE: Row border color (#666) for darker lines between complaints */
    tr.style.borderBottom = '1px solid #666';
    tr.style.cursor = 'pointer';
    tr.innerHTML = `
      <td style="padding: 12px; border-right: 1px solid #666;">${escapeHtml(c.tracking_id)}</td>
      <td style="padding: 12px; border-right: 1px solid #666;">${escapeHtml(c.title)}</td>
      <td style="padding: 12px; border-right: 1px solid #666;">${escapeHtml(c.category)}${c.subcategory?(' › '+escapeHtml(c.subcategory)):''}</td>
      <td style="padding: 12px;"><span class="status-badge" style="background-color: ${getStatusColor(c.status)}; padding: 5px 8px; border-radius: 3px; color: white; font-size: 0.9em;">${escapeHtml(c.status)}</span></td>
    `;
    // Make row clickable to show details
    tr.onclick = () => {
      showDetailModal(c);
    };
    el('complaintsList').appendChild(tr);
  }

  function renderLocal(c){
    const tr = document.createElement('tr');
    /* CUSTOMIZE: Row border color (#666) for darker lines between complaints */
    tr.style.borderBottom = '1px solid #666';
    tr.style.cursor = 'pointer';
    const status = c.status || 'Queued';
    tr.innerHTML = `
      <td style="padding: 12px; border-right: 1px solid #666;">${escapeHtml(c.tracking_id || 'TBD')}</td>
      <td style="padding: 12px; border-right: 1px solid #666;">${escapeHtml(c.title)}</td>
      <td style="padding: 12px; border-right: 1px solid #666;">${escapeHtml(c.category)}${c.subcategory?(' › '+escapeHtml(c.subcategory)):''}</td>
      <td style="padding: 12px;"><span class="status-badge" style="background-color: ${getStatusColor(status)}; padding: 5px 8px; border-radius: 3px; color: white; font-size: 0.9em;">${escapeHtml(status)}</span></td>
    `;
    // Make local row clickable
    tr.onclick = () => {
      showDetailModal(c);
    };
    el('complaintsList').appendChild(tr);
  }

  // Load all complaints when page loads
  setTimeout(() => {
    const searchBtn = el('complaintSearchBtn');
    if (searchBtn) {
      searchBtn.click();
    }
  }, 100);
}

/* ---------- admin login ---------- */
if (el('adminLoginForm')){
  el('adminLoginForm').addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const selection = el('adminSelection').value.trim();
    const email = el('adminEmail').value.trim();
    const password = el('adminPassword').value;
    const remember = !!el('rememberMe').checked;
    // Basic client-side validation
    if (!selection || !email || !password) {
      el('adminMsg').style.display = 'block';
      el('adminMsg').textContent = 'Category, email and password are required';
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/admin/login`, { method:'POST', credentials: 'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({selection, password, email, remember}) });
      if (res.ok){
        const data = await res.json();
        // store local hints so frontend can show admin-specific UI
        if (data.selection) localStorage.setItem('kssem_admin_selection', data.selection);
        if (data.email) localStorage.setItem('kssem_admin_email', data.email);
        // If confirmation email wasn't actually sent, warn the user (server may have logged it)
        if (data.email_sent === false) {
          try { alert('Confirmation email could not be sent. A copy was logged on the server. Configure SMTP to enable delivery.'); } catch(e) {}
        }
        // allow admin to browse all pages; redirect to admin dashboard
        window.location.href = `/admin-dashboard`;
      } else {
        let txt = 'Invalid credentials';
        try { const j = await res.json(); txt = j.error || txt; } catch(e){}
        el('adminMsg').style.display='block';
        el('adminMsg').textContent = txt;
      }
    } catch(e) {
      el('adminMsg').style.display='block';
      el('adminMsg').textContent = 'Could not contact server';
    }
  });
}

/* ---------- admin dashboard ---------- */
if (el('adminTable')){
  // Try to detect logged-in admin from server session, fallback to localStorage hint
  (async function(){
    let admin = '';
    try {
      const who = await fetch(`${API_BASE}/api/admin/whoami`, { credentials: 'include' });
      if (who.ok) {
        const info = await who.json();
        // prefer selection (category) as admin identifier; keep email as optional hint
        admin = info.selection || info.email || '';
        if (info.selection) localStorage.setItem('kssem_admin_selection', info.selection);
        if (info.email) localStorage.setItem('kssem_admin_email', info.email);
      }
    } catch(e) {
      // ignore
    }
    if (!admin) admin = qp('admin') || localStorage.getItem('kssem_admin_selection') || localStorage.getItem('kssem_admin_email') || '';
    const displayAdmin = admin && admin.includes('::') ? admin.replace('::', ' › ') : admin;
    el('adminTitle').textContent = displayAdmin ? `${displayAdmin} — Admin Dashboard` : 'Admin Dashboard';

    // Expose admin variable to rest of this block by attaching to element (small hack)
    // expose admin selection to rest of this block; prefer server-rendered selection if present
    const serverSel = el('adminTable').dataset.selection || '';
    if (serverSel) {
      el('adminTable').dataset.kssemAdmin = serverSel;
    } else {
      el('adminTable').dataset.kssemAdmin = admin;
    }
    // After detection, call loadList to populate
    if (typeof loadList === 'function') loadList();
  })();
  // admin variable will be read from dataset when needed

  // --- Global admin header / logout handling ---
  async function updateAdminHeaderState(){
    try{
      const res = await fetch(`${API_BASE}/api/admin/whoami`, { credentials: 'include' });
      if (res.ok){
        const info = await res.json();
        const selection = info.selection || '';
        const email = info.email || '';
        const display = email || selection;
        const els = document.querySelectorAll('#adminEmailDisplay');
        els.forEach(e=>{ e.textContent = display; e.style.display = display ? 'block' : 'none'; });
        const btns = document.querySelectorAll('#logoutBtn');
        btns.forEach(b=> b.style.display = display ? 'inline-block' : 'none');
        if (selection) localStorage.setItem('kssem_admin_selection', selection);
        if (email) localStorage.setItem('kssem_admin_email', email);
        return;
      }
    }catch(e){ /* ignore */ }
    // not logged in
    document.querySelectorAll('#adminEmailDisplay').forEach(e=> e.style.display='none');
    document.querySelectorAll('#logoutBtn').forEach(b=> b.style.display='none');
  }

  // attach click handler for logout buttons
  document.addEventListener('click', async (e)=>{
    if (!e.target) return;
    if (e.target.id === 'logoutBtn'){
      if (!confirm('Logout from admin account?')) return;
      try{
        const res = await fetch(`${API_BASE}/api/admin/logout`, { method: 'POST', credentials: 'include' });
        if (res.ok){
          localStorage.removeItem('kssem_admin_email');
          localStorage.removeItem('kssem_admin_selection');
          // hide buttons and redirect to home
          await updateAdminHeaderState();
          window.location.href = '/';
        } else {
          alert('Logout failed');
        }
      }catch(err){
        alert('Logout failed: ' + err.message);
      }
    }
  });

  // run header state update on load
  updateAdminHeaderState();
  // Update status filter options
  const statusFilter = el('statusFilter');
  statusFilter.innerHTML = `
    <option value="">All Status</option>
    <option value="Queued">Queued</option>
    <option value="In Progress">In Progress</option>
    <option value="Solved">Solved</option>
    <option value="Rejected">Rejected</option>
  `;

  // Update status from detail modal (only in admin dashboard)
  const updateBtn = document.getElementById('updateDetailBtn');
  if (updateBtn) {
    updateBtn.addEventListener('click', async () => {
      if (!currentComplaintId) return;
      const newStatus = document.getElementById('detailStatusSelect').value;
      
      const res = await fetch(`${API_BASE}/api/admin/complaints/${currentComplaintId}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include',
        body: JSON.stringify({status: newStatus})
      });
      
      if (res.ok) {
        closeDetailModal();
        loadList();
        alert('Status updated successfully to: ' + newStatus);
      } else {
        alert('Failed to update status');
      }
    });
  }

  // Delete from detail modal (only in admin dashboard)
  const deleteBtn = document.getElementById('deleteDetailBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!currentComplaintId) return;
      if (!confirm('Are you sure you want to delete this complaint?')) return;
      
      const res = await fetch(`${API_BASE}/api/admin/complaints/${currentComplaintId}`, { 
        method:'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        closeDetailModal();
        loadList();
        alert('Complaint deleted successfully');
      } else {
        alert('Failed to delete complaint');
      }
    });
  }

  async function loadList(){
    const q = el('q').value.trim();
    const status = el('statusFilter').value;
    const sort = el('sort').value;
    const url = new URL(`${API_BASE}/api/admin/complaints`);
    const adminSel = el('adminTable').dataset.selection || '';
    
    url.searchParams.set('selection', adminSel);
    if (q) url.searchParams.set('q', q);
    if (status) url.searchParams.set('status', status);
    if (sort) url.searchParams.set('sort', sort);
    
    try {
      const res = await fetch(url.toString());
      if (!res.ok) { 
        const errText = await res.text();
        console.error('Failed to load complaints:', res.status, errText);
        alert('Failed to load complaints: ' + errText); 
        return; 
      }
      const list = await res.json();
      const tbody = document.querySelector('#adminTable tbody');
      tbody.innerHTML = '';
      
      if (list.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="5" style="padding: 20px; text-align: center;">No complaints found for this category</td>';
        tbody.appendChild(tr);
        return;
      }
      
      for (const c of list) {
        const tr = document.createElement('tr');
        /* CUSTOMIZE: Admin table row border color (#666) for 1px inner lines */
        tr.style.borderBottom = '1px solid #666';
        tr.style.cursor = 'pointer';
        tr.style.transition = 'background-color 0.2s';
        tr.onmouseover = () => tr.style.backgroundColor = '#f9f9f9';
        tr.onmouseout = () => tr.style.backgroundColor = 'transparent';
        
        tr.innerHTML = `
          <td style="padding: 12px; border-right: 1px solid #666;">${escapeHtml(c.tracking_id)}</td>
          <td style="padding: 12px; border-right: 1px solid #666;">${escapeHtml(c.title)}</td>
          <td style="padding: 12px; border-right: 1px solid #666;">${escapeHtml(c.category)}${c.subcategory?(' › '+escapeHtml(c.subcategory)) : ''}</td>
          <td style="padding: 12px; border-right: 1px solid #666;">
            <span class="status-badge" style="background-color: ${getStatusColor(c.status)}; padding: 5px 10px; border-radius: 4px; color: white; font-weight: bold;">${escapeHtml(c.status)}</span>
          </td>
          <td style="padding: 12px;">
            <button class="small-btn primary" data-id="${c.id}" data-action="view">View Details</button>
            <button class="small-btn" data-id="${c.id}" data-action="delete" style="margin-left: 5px;">Delete</button>
          </td>
        `;
        
        // Make entire row clickable for detail view
        tr.onclick = (e) => {
          if (!e.target.closest('button')) {
            showDetailModal(c);
          }
        };
        
        tbody.appendChild(tr);
      }
    } catch(e) { 
      console.error('Exception loading complaints:', e);
      alert('Failed to fetch complaints list: ' + e.message); 
    }
  }

  // Search button and input events
  if (el('adminSearchBtn')) {
    el('adminSearchBtn').addEventListener('click', (e) => {
      e.preventDefault();
      loadList();
    });
  }
  
  // Enter key to trigger search
  if (el('q')) {
    el('q').addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        loadList();
      }
    });
  }
  
  // Filter dropdowns - trigger loadList on change
  if (el('statusFilter')) {
    el('statusFilter').addEventListener('change', loadList);
  }
  if (el('sort')) {
    el('sort').addEventListener('change', loadList);
  }
  
  if (el('refresh')) {
    el('refresh').addEventListener('click', loadList);
  }

  document.querySelector('#adminTable tbody').addEventListener('click', async (ev)=>{
    const btn = ev.target.closest('button');
    if (!btn) return;
    
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    
    if (action === 'view') {
      // Get the complaint data from the table row
      const row = btn.closest('tr');
      // We need to fetch the full details
      const url = new URL(`${API_BASE}/api/admin/complaints`);
      const adminSel = el('adminTable').dataset.selection || el('adminTable').dataset.kssemAdmin || '';
      url.searchParams.set('selection', adminSel);
      const res = await fetch(url.toString());
      if (res.ok) {
        const list = await res.json();
        const complaint = list.find(c => c.id === parseInt(id));
        if (complaint) {
          showDetailModal(complaint);
        }
      }
      return;
    }
    
    if (action === 'delete') {
      if (!confirm('Are you sure you want to delete this complaint?')) return;
      const res = await fetch(`${API_BASE}/api/admin/complaints/${id}`, { method:'DELETE' });
      if (res.ok) {
        loadList();
        alert('Complaint deleted successfully');
      } else {
        alert('Failed to delete complaint');
      }
    }
  });

  el('exportCsv').addEventListener('click', ()=> {
    const url = new URL(`${API_BASE}/api/admin/export.csv`);
    const adminSel = el('adminTable').dataset.selection || el('adminTable').dataset.kssemAdmin || '';
    url.searchParams.set('selection', adminSel);
    window.open(url.toString(), '_blank');
  });

  // Load complaints list immediately
  loadList();
}