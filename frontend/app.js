const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const API = (window.CIVICTRACK_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
let DEPTS = [
 ['Roads','🛣️','Road repairs, potholes, footpaths and traffic signs.',1],
 ['Water Supply','💧','Water leakage, supply interruptions and quality.',2],
 ['Sanitation','🧹','Waste collection, public cleanliness and litter.',3],
 ['Street Lighting','💡','Non-working streetlights and dark public areas.',4],
 ['Drainage','🌧️','Blocked drains, flooding and sewage concerns.',5],
 ['Electricity','⚡','Public electrical faults and damaged utility equipment.',6]
];
let CATEGORIES = [
 ['Potholes',1,'Roads'],['Road Damage',2,'Roads'],['Garbage',3,'Sanitation'],
 ['Water Supply',4,'Water Supply'],['Streetlight',5,'Street Lighting'],
 ['Drainage',6,'Drainage'],['Electricity',7,'Electricity']
];
let myIssues=[];
let user=null, token=localStorage.getItem('civictrack_token')||'', mode='login', adminMode=false, page='overview', issues=[], notifications=[], dashboard={};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nice=s=>String(s||'').toLowerCase().replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const toast=m=>{let t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000)};
const count=s=>issues.filter(i=>i.status===s).length;
async function api(path, options={}) {
  const headers={...(options.headers||{})};
  if(token) headers.Authorization=`Bearer ${token}`;
  const res=await fetch(API+path,{...options,headers});
  const raw=await res.text(); let data;
  try{data=raw?JSON.parse(raw):null}catch{data=raw}
  if(res.status===401 && token && path!=='/login'){ token=''; localStorage.removeItem('civictrack_token'); const hadUser=!!user; user=null; if(hadUser){showAuth();toast('Your session expired. Please sign in again.');} }
  if(!res.ok) throw new Error(data?.detail||data?.message||`API error ${res.status}`);
  return data;
}
function issueFromApi(x){
 const category=x.category_name||'Other';
 const dep=x.department_name||CATEGORIES.find(c=>c[0].toLowerCase()===category.toLowerCase())?.[2]||category;
 return {id:x.issue_id,code:x.issue_code,userId:x.user_id,title:x.title,description:x.description,location:x.location,
   latitude:x.latitude,longitude:x.longitude,category,department:dep,priority:nice(x.priority),status:x.status,
   created:x.created_at?new Date(x.created_at).toLocaleDateString():'',support:x.similar_reports||0,owner:'Citizen'};
}
async function loadReferenceData(){
 try{
  const [departments,categories]=await Promise.all([api('/departments'),api('/categories')]);
  const icons={'Roads':'🛣️','Water Supply':'💧','Sanitation':'🧹','Street Lighting':'💡','Drainage':'🌧️','Electricity':'⚡'};
  if(departments?.length)DEPTS=departments.map(d=>[d.department_name,icons[d.department_name]||'🏛️',d.description||'Civic department',d.department_id]);
  if(categories?.length)CATEGORIES=categories.map(c=>[c.category_name,c.category_id,c.department_name||'Other']);
 }catch(err){console.warn('Could not load department/category reference data',err)}
}
async function loadIssues(){ const data=await api('/issues'); issues=(data||[]).map(issueFromApi); }
async function loadMyIssues(){ const data=await api('/my/issues'); return (data||[]).map(issueFromApi); }
async function loadDashboard(){try{dashboard=await api('/dashboard')}catch{dashboard={}}}
async function loadNotifications(){
 if(!user?.id){notifications=[];return}
 try{notifications=await api(`/users/${user.id}/notifications`)}catch(e){notifications=[];console.warn(e)}
}
function showAuth(m='login',a=false){
 mode=m;adminMode=a;$('#authView').classList.remove('hidden');$('#appView').classList.add('hidden');
 $('#authTabs').classList.toggle('hidden',a);
 $('#adminEntry').textContent=a?'← Citizen sign in':'Administrator access ↗';
 $('#authEyebrow').textContent=a?'ADMINISTRATOR SIGN IN':'WELCOME TO CIVICTRACK';
 $('#authTitle').textContent=a?'Administrator sign in.':m==='register'?'Create your CivicTrack account.':'Make your community better.';
 $('#authSubtitle').textContent=a?'Use an existing authorized administrator account.':m==='register'?'Register with the details requested by the CivicTrack server.':'Sign in to report an issue or follow its progress.';
 $('#authSubmit').innerHTML=(m==='register'?'Create account':'Sign in')+' <span>→</span>';
 $('#registerFields').classList.toggle('hidden',m!=='register');
 ['full_name','phone','address'].forEach(n=>{const el=$(`[name="${n}"]`);if(el)el.required=(m==='register');});
 $('#authForm').reset();
 $$('[data-auth]').forEach(b=>b.classList.toggle('active',b.dataset.auth===m));
}
function enter(profile){
 user=profile;
 $('#authView').classList.add('hidden');$('#appView').classList.remove('hidden');
 $('#sideUserName').textContent=profile.name;$('#sideUserRole').textContent=profile.role==='ADMIN'?'Administrator':'Community member';
 $('#userAvatar').textContent=(profile.name||'U')[0].toUpperCase();$('#topAvatar').textContent=(profile.name||'U')[0].toUpperCase();
 $('#mainNav').innerHTML=nav();go(profile.role==='ADMIN'?'admin':'overview');
}
function nav(){
 let a=user.role==='ADMIN';
 let links=a?[['admin','⌂','Admin overview'],['admin-issues','▤','Manage complaints'],['unresolved','◷','Unresolved issues'],['departments','▦','Departments'],['notifications','♧','Notifications']]:
 [['overview','⌂','Overview'],['report','＋','Report an issue'],['explore','◉','Explore issues'],['unresolved','◷','Unresolved issues'],['my-issues','▤','My reports'],['departments','▦','Departments'],['notifications','♧','Notifications']];
 return links.map(([p,i,n])=>`<button class="nav-link ${page===p?'active':''}" data-page="${p}"><span>${i}</span>${n}${p==='unresolved'?`<i>${issues.filter(x=>!['RESOLVED','CLOSED','REJECTED'].includes(x.status)).length}</i>`:''}</button>`).join('');
}
function heading(title,sub,action=''){return `<div class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div>${action?`<div class="heading-actions">${action}</div>`:''}</div>`}
function stat(label,value,icon,foot){return `<div class="stat-card"><div class="stat-top">${label}<span class="stat-icon">${icon}</span></div><div class="stat-value">${value??'—'}</div><div class="stat-foot">${foot}</div></div>`}
function status(s){return `<span class="status ${String(s).toLowerCase()}">${nice(s)}</span>`}
function issueCard(i){return `<article class="issue-card" data-detail="${i.id}"><div class="issue-card-top"><span class="eyebrow">${esc(i.category)}</span>${status(i.status)}</div><h3>${esc(i.title)}</h3><p>${esc(i.description)}</p><div class="issue-meta"><span>⌖ ${esc(i.location)}</span><span>◷ ${esc(i.created)}</span></div><div class="issue-card-foot"><small>${i.code?`Complaint ${esc(i.code)}`:'Live complaint record'}</small><button class="support" data-detail="${i.id}">View details</button></div></article>`}
function overview(){
 let open=dashboard.unresolved??issues.filter(i=>!['RESOLVED','CLOSED','REJECTED'].includes(i.status)).length;
 return heading(`Good day, ${esc((user.name||'Citizen').split(' ')[0])} 👋`,'Here is what is happening in your community today.',`<button class="btn btn-primary" data-go="report">＋ Report an issue</button>`)
 +`<div class="stats-grid">${stat('Total community reports',dashboard.total_complaints??issues.length,'▤','Across all departments')}${stat('Awaiting attention',open,'◷','Issues still being addressed')}${stat('Resolved issues',dashboard.resolved??issues.filter(i=>['RESOLVED','CLOSED'].includes(i.status)).length,'✓','Marked as resolved')}${stat('In progress',dashboard.in_progress??count('IN_PROGRESS'),'↻','Being addressed')}</div>
 <div class="content-grid"><section class="panel"><div class="panel-head"><h3>Recent community reports</h3><button class="small-link" data-go="explore">View all →</button></div>${issues.slice(0,5).map(i=>`<div class="issue-row" data-detail="${i.id}"><div class="issue-symbol">${DEPTS.find(d=>d[0]===i.department)?.[1]||'📍'}</div><div class="issue-row-main"><b>${esc(i.title)}</b><small>${esc(i.location)}</small></div>${status(i.status)}</div>`).join('')||'<p class="muted">No complaints have been submitted yet.</p>'}</section>
 <section class="panel"><div class="panel-head"><h3>Quick actions</h3></div><div class="quick-actions"><button class="quick-action" data-go="report"><span class="qa-icon">＋</span><strong>Report an issue</strong><small>Tell us what needs attention</small></button><button class="quick-action" data-go="unresolved"><span class="qa-icon">◷</span><strong>Unresolved issues</strong><small>See what still needs action</small></button><button class="quick-action" data-go="departments"><span class="qa-icon">▦</span><strong>Departments</strong><small>Find the right civic team</small></button><button class="quick-action" data-go="my-issues"><span class="qa-icon">▤</span><strong>My reports</strong><small>View reports from the API</small></button></div></section></div>`;
}
function listing(title,sub,filter){
 let arr=filter(issues);
 return heading(title,sub)+`<div class="toolbar"><input id="searchIssues" placeholder="Search by issue or location…"><select id="filterDept"><option value="">All departments</option>${DEPTS.map(d=>`<option>${d[0]}</option>`).join('')}</select><select id="filterStatus"><option value="">All statuses</option>${['SUBMITTED','UNDER_REVIEW','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED','REJECTED'].map(s=>`<option value="${s}">${nice(s)}</option>`).join('')}</select></div><div class="issue-grid" id="issueGrid">${arr.map(issueCard).join('')||'<div class="empty">No issues match your filters.</div>'}</div>`;
}
function report(){
 return heading('Report a civic issue','Share the issue and confirm where it is happening.')
 +`<div class="form-layout"><form class="form-panel" id="reportForm"><h3>Issue details</h3><p>Fields marked with * are required.</p>
 <label>Issue title *<input name="title" required maxlength="200" placeholder="e.g. Pothole near the bus stop"></label>
 <div class="two-fields"><label>Category *<select name="category_id" required><option value="">Choose category</option>${CATEGORIES.map(c=>`<option value="${c[1]}">${c[0]} — ${c[2]}</option>`).join('')}</select></label>
 <label>Priority<select name="priority"><option value="MEDIUM">Medium</option><option value="LOW">Low</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label></div>
 <label>Location *<input id="reportLocation" name="location" required maxlength="255" placeholder="Street, landmark, ward or area"></label>
 <div class="location-tools"><button class="btn btn-secondary" type="button" id="useLocation">◎ Use my current location</button><span id="locationStatus" class="muted">You can also enter the address manually.</span></div>
 <input type="hidden" name="latitude"><input type="hidden" name="longitude"><details class="manual-coordinates"><summary>Adjust location pin manually</summary><div class="two-fields"><label>Latitude<input id="manualLatitude" type="number" step="any" min="-90" max="90" placeholder="e.g. 17.7"></label><label>Longitude<input id="manualLongitude" type="number" step="any" min="-180" max="180" placeholder="e.g. 83.3"></label></div><button class="btn btn-secondary" type="button" id="applyCoordinates">Update map pin</button></details><div id="locationMap" class="location-map hidden"></div>
 <label>Description *<textarea name="description" required minlength="12" placeholder="Tell us what happened and why it needs attention…"></textarea></label>
 <label>Attach a photo (optional)<div class="upload-box">Add a JPG, PNG or WebP photo (max 5 MB)<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></div></label>
 <button class="btn btn-primary">Submit report →</button></form>
 <aside><div class="tip-card"><b>What happens next?</b><p>Your report is sent to the responsible department for review and progress updates.</p></div><div class="tip-card"><b>Location accuracy</b><p>Allow location access to attach GPS coordinates. Check the detected address before submitting.</p></div></aside></div>`;
}
function departments(){
 return heading('Civic departments','Find the department responsible for different public services.')
 +`<div class="dept-grid">${DEPTS.map(d=>`<article class="dept-card"><div class="dept-icon">${d[1]}</div><h3>${d[0]}</h3><p>${d[2]}</p><button data-dept="${d[0]}">View related issues →</button></article>`).join('')}</div>`;
}
function admin(){
 return heading('Administration overview','Review reports and manage their progress.')
 +`<div class="stats-grid">${stat('Total reports',dashboard.total_complaints??issues.length,'▤','All submitted issues')}${stat('Awaiting action',dashboard.unresolved??'—','◷','Open or in progress')}${stat('Resolved',dashboard.resolved??'—','✓','Resolved reports')}${stat('In progress',dashboard.in_progress??'—','↻','Being addressed')}</div>
 <section class="panel"><div class="panel-head"><h3>Complaint management</h3><button class="small-link" data-go="admin-issues">Manage all →</button></div>${issues.slice(0,6).map(i=>`<div class="issue-row" data-detail="${i.id}"><div class="issue-row-main"><b>${esc(i.title)}</b><small>${esc(i.code||'')} · ${esc(i.department)}</small></div>${status(i.status)}</div>`).join('')||'<p class="muted">No complaints available.</p>'}</section>
 `;
}
function render(){
 let content='';
 if(page==='overview')content=overview();
 else if(page==='report')content=report();
 else if(page==='explore')content=listing('Explore community issues','Live complaints returned by the backend.',a=>a);
 else if(page==='unresolved')content=listing('Unresolved issues','Reports that still need attention.',a=>a.filter(i=>!['RESOLVED','CLOSED','REJECTED'].includes(i.status)));
 else if(page==='my-issues')content=heading('My reports','Complaints submitted from your account.')+`<div class="issue-grid">${myIssues.map(issueCard).join('')||'<div class="empty">You have not submitted any complaints yet.</div>'}</div>`;
 else if(page==='departments')content=departments();
 else if(page==='notifications')
    content=heading('Notifications','Updates returned by the backend.')
    + `<section class="panel">
        ${notifications.map(n=>`
            <div class="notification">
                <div class="notification-icon">♧</div>
                <div>
                    <b>${esc(n.message)}</b>
                    <p>Complaint ID: ${esc(n.issue_id??'—')}</p>
                    <small>
                        ${n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                        ${n.is_read ? '· Read' : '· Unread'}
                    </small>

                    ${!n.is_read ? `
                        <button class="btn btn-secondary"
                            data-mark-read="${n.notification_id}">
                            Mark as Read
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('') || '<p class="muted">No notifications returned for this account.</p>'}
    </section>`;
 else if(page==='admin')content=admin();
 else if(page==='admin-issues')content=heading('Manage complaints','Select a complaint to update its status or department.')+`<div class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Complaint</th><th>Category</th><th>Priority</th><th>Status</th><th>Action</th></tr></thead><tbody>${issues.map(i=>`<tr><td><b>${esc(i.title)}</b><br><small>${esc(i.code||i.id)}</small></td><td>${esc(i.category)}</td><td>${esc(i.priority)}</td><td>${status(i.status)}</td><td><button data-detail="${i.id}">Manage</button></td></tr>`).join('')}</tbody></table></div></div>`;
 $('#pageContent').innerHTML=content;
 $('#breadcrumb').textContent=({'overview':'Overview','report':'Report an issue','explore':'Explore issues','unresolved':'Unresolved issues','my-issues':'My reports','departments':'Departments','notifications':'Notifications','admin':'Admin overview','admin-issues':'Manage complaints'})[page]||page;
 $('#mainNav').innerHTML=nav();
}
async function refresh(){await loadReferenceData();await loadIssues();await loadDashboard();await loadNotifications();if(user?.role!=='ADMIN')myIssues=await loadMyIssues();render()}
function go(p){page=p;render();$('#sidebar').classList.remove('open');window.scrollTo(0,0)}
async function detail(id){
 let i=issues.find(x=>x.id===Number(id));if(!i)return;
 try {
  const full=await api(`/issues/${id}`);
  const proof=full.resolution_proof;
  const images=(full.images||[]).map(im=>`<a href="${API+im.image_url}" target="_blank" rel="noopener">Open report photo</a>`).join(' · ');
  const proofHtml=proof?`<div class="resolution-proof"><b>Completion photo</b><p>${esc(proof.resolution_description||'Work marked complete')}</p><a href="${API+proof.image_url}" target="_blank" rel="noopener"><img src="${API+proof.image_url}" alt="Completion photo" class="proof-image"></a></div>`:'';
  const isOwner=Number(full.user_id)===Number(user.id);
  const review=full.my_resolution_review;
  const citizenReview=isOwner&&full.status==='RESOLVED'&&proof&&!review?`<div class="review-panel"><h3>Is the issue actually resolved?</h3><p>Review the completion photo above and confirm the result.</p><button class="btn btn-primary" data-review="CONFIRMED" data-issue="${i.id}">Issue resolved</button><label>Reason if it is not resolved<textarea id="disputeReason" maxlength="500" placeholder="Explain what still needs attention"></textarea></label><button class="btn btn-secondary" data-review="DISPUTED" data-issue="${i.id}">Issue not resolved</button></div>`:review?`<p class="muted">Your response: ${nice(review.decision)}${review.reason?' — '+esc(review.reason):''}</p>`:'';
  const adminControls=user.role==='ADMIN'?`<label>Update status<select id="adminStatus">${['SUBMITTED','UNDER_REVIEW','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED','REJECTED'].map(s=>`<option ${i.status===s?'selected':''} value="${s}">${nice(s)}</option>`).join('')}</select></label><label>Assign department<select id="adminDept">${DEPTS.map(d=>`<option value="${d[3]}" ${i.department===d[0]?'selected':''}>${d[0]}</option>`).join('')}</select></label><div class="resolution-upload"><b>Completion photo (required to mark resolved)</b><label>Photo<input id="resolutionPhoto" type="file" accept="image/jpeg,image/png,image/webp"></label><label>Description<input id="resolutionDescription" maxlength="500" placeholder="Describe the completed work"></label></div><button class="btn btn-primary" data-save="${i.id}">Save status</button><button class="btn btn-secondary" data-assign="${i.id}">Assign department</button>`:'';
  let box=document.createElement('div');box.className='modal-backdrop';box.id='detailModal';
  box.innerHTML=`<div class="modal"><div class="modal-head"><h2>${esc(i.title)}</h2><button class="modal-close" data-dismiss>×</button></div><p>${esc(i.description)}</p><div class="issue-meta"><span>⌖ ${esc(i.location)}</span><span>Category: ${esc(i.category)}</span><span>Priority: ${esc(i.priority)}</span></div>${full.latitude!=null&&full.longitude!=null?`<p><a href="https://www.openstreetmap.org/?mlat=${full.latitude}&mlon=${full.longitude}#map=17/${full.latitude}/${full.longitude}" target="_blank" rel="noopener">View reported GPS location</a></p>`:''}<p>Complaint: <b>${esc(i.code||i.id)}</b></p><p>Current status: ${status(i.status)}</p><p>Similar reports: <b>${Number(full.similar_reports||0)}</b></p>${images?`<p>${images}</p>`:''}${proofHtml}${citizenReview}${adminControls}<div class="modal-actions"><button class="btn btn-outline" data-dismiss>Close</button></div></div>`;
  document.querySelector('#detailModal')?.remove();document.body.append(box);
 } catch(err){toast('Could not load complaint details: '+err.message)}
}
$('#authTabs').addEventListener('click',e=>{let b=e.target.closest('[data-auth]');if(b)showAuth(b.dataset.auth)});
$('#adminEntry').onclick=()=>showAuth('login',!adminMode);

$('#authForm').onsubmit=async e=>{
 e.preventDefault();let f=new FormData(e.target),button=$('#authSubmit');button.disabled=true;
 try{
  if(mode==='register'){
   const body={full_name:f.get('full_name'),email:f.get('email'),phone:f.get('phone'),password:f.get('password'),address:f.get('address')};
   const r=await api('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   toast(r.message||'Registration successful. You can now sign in.');showAuth('login');return;
  }
  const r=await api('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.get('email'),password:f.get('password')})});
  const role=String(r.role||'CITIZEN').toUpperCase();
  if(adminMode&&role!=='ADMIN')throw new Error('This account is not an administrator.');
  if(!adminMode&&role==='ADMIN')throw new Error('Please use Administrator access for this account.');
  token=r.token;localStorage.setItem('civictrack_token',token);
  user={id:r.user_id,role,name:r.full_name,email:r.email};
  await refresh();enter(user);toast('Signed in successfully');
 }catch(err){toast(err.message||'Request failed')}finally{button.disabled=false}
};
$('#mainNav').onclick=e=>{let b=e.target.closest('[data-page]');if(b)go(b.dataset.page)};
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-save],[data-assign],[data-dismiss],[data-review]');
 if(!b || !b.closest('#detailModal')) return;
 if(b.hasAttribute('data-dismiss')) { $('#detailModal')?.remove(); return; }
 if(b.dataset.review){
  try{
   const decision=b.dataset.review;const reason=$('#disputeReason')?.value||'';
   await api(`/issues/${b.dataset.issue}/resolution-review`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision,reason})});
   $('#detailModal')?.remove();await refresh();toast(decision==='CONFIRMED'?'Resolution confirmed':'Your dispute was sent to the administration');
  }catch(err){toast(err.message)}
  return;
 }
 if(b.dataset.save){
  try{
   const desired=$('#adminStatus').value;
   if(desired==='RESOLVED'){
    const file=$('#resolutionPhoto')?.files?.[0];
    if(!file)throw new Error('Upload the completion photo before marking this issue resolved.');
    const fd=new FormData();fd.append('file',file);fd.append('description',$('#resolutionDescription').value||'Work completed');
    await api(`/issues/${b.dataset.save}/resolution-proof`,{method:'POST',body:fd});
   }
   await api(`/issues/${b.dataset.save}/status?status=${encodeURIComponent(desired)}`,{method:'PATCH'});
   $('#detailModal')?.remove();await refresh();toast('Complaint status updated');
  }catch(err){toast('Update failed: '+err.message)}
 }
 if(b.dataset.assign){
  try{await api(`/issues/${b.dataset.assign}/department?department_id=${encodeURIComponent($('#adminDept').value)}`,{method:'PATCH'});$('#detailModal')?.remove();await refresh();toast('Department assignment saved')}
  catch(err){toast('Assignment failed: '+err.message)}
 }
});
$('#pageContent').onsubmit=async e=>{
 if(e.target.id!=='reportForm')return;e.preventDefault();
 let f=new FormData(e.target),file=f.get('photo');
 try{
  const payload={category_id:Number(f.get('category_id')),title:f.get('title'),description:f.get('description'),location:f.get('location'),latitude:f.get('latitude')?Number(f.get('latitude')):null,longitude:f.get('longitude')?Number(f.get('longitude')):null,priority:f.get('priority')};
  const result=await api('/issues',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(file&&file.size){const fd=new FormData();fd.append('file',file);await api(`/issues/${result.issue_id}/images`,{method:'POST',body:fd});}
  await refresh();toast(`Complaint submitted: ${result.complaint_id||''}`);go('my-issues');
 }catch(err){toast('Submission failed: '+err.message)}
};
$('#pageContent').onclick=async e=>{
 let b=e.target.closest('[data-go],[data-detail],[data-dept],[data-dismiss],[data-mark-read]');if(!b)return;
 if(b.dataset.markRead){try{await api(`/notifications/${b.dataset.markRead}/read`,{method:'PATCH'});await loadNotifications();render();toast('Notification marked as read')}catch(err){toast(err.message)}return;}
 if(b.dataset.go)go(b.dataset.go);
 if(b.dataset.detail)detail(b.dataset.detail);
 if(b.dataset.dept){go('explore');setTimeout(()=>{let s=$('#filterDept');if(s){s.value=b.dataset.dept;s.dispatchEvent(new Event('change'))}},0)}
 if(b.hasAttribute('data-dismiss'))$('#detailModal')?.remove();
};
$('#pageContent').oninput=e=>{if(e.target.id==='searchIssues')filterIssues()};
$('#pageContent').onchange=e=>{if(['filterDept','filterStatus'].includes(e.target.id))filterIssues()};
function filterIssues(){
 let q=($('#searchIssues')?.value||'').toLowerCase(),d=$('#filterDept')?.value||'',s=$('#filterStatus')?.value||'';
 let grid=$('#issueGrid');if(!grid)return;
 [...grid.querySelectorAll('.issue-card')].forEach(card=>{let i=issues.find(x=>x.id===Number(card.dataset.detail));card.style.display=(!q||`${i.title} ${i.location}`.toLowerCase().includes(q))&&(!d||i.department===d)&&(!s||i.status===s)?'':'none'});
}
$('#logoutButton').onclick=async()=>{try{await api('/logout',{method:'POST'})}catch{}token='';localStorage.removeItem('civictrack_token');user=null;myIssues=[];issues=[];notifications=[];showAuth()};
$('#menuButton').onclick=()=>$('#sidebar').classList.toggle('open');
$('#sidebarClose').onclick=()=>$('#sidebar').classList.remove('open');
$('#topNotifications').onclick=()=>go('notifications');
$('#profileButton').onclick=()=>toast(user?.email||'');

// Location is requested only after the citizen presses the button.
$('#pageContent').addEventListener('click', async e=>{
 if(e.target.id==='applyCoordinates'){
  const lat=Number($('#manualLatitude').value),lon=Number($('#manualLongitude').value);
  if($('#manualLatitude').value.trim()===''||$('#manualLongitude').value.trim()===''||!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat > 90||lon < -180||lon > 180){toast('Enter valid latitude and longitude values');return;}
  const form=$('#reportForm');form.elements.latitude.value=lat;form.elements.longitude.value=lon;
  $('#locationMap').classList.remove('hidden');const d=.004;
  $('#locationMap').innerHTML=`<iframe title="Confirm report location" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${lon-d}%2C${lat-d}%2C${lon+d}%2C${lat+d}&layer=mapnik&marker=${lat}%2C${lon}"></iframe><a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}" target="_blank" rel="noopener">Open map to check the pin</a>`;
  $('#locationStatus').textContent='Manual coordinates saved. Confirm the map pin and enter the readable address.';return;
 }
 if(e.target.id!=='useLocation')return;
 const status=$('#locationStatus');const button=e.target;
 if(!navigator.geolocation){status.textContent='Location is not supported by this browser. Enter the address manually.';return;}
 button.disabled=true;status.textContent='Getting your location…';
 navigator.geolocation.getCurrentPosition(async pos=>{
  const lat=pos.coords.latitude,lon=pos.coords.longitude;
  const form=$('#reportForm');form.elements.latitude.value=lat;form.elements.longitude.value=lon;$('#manualLatitude').value=lat;$('#manualLongitude').value=lon;
  status.textContent='GPS coordinates captured. Checking the address…';
  $('#locationMap').classList.remove('hidden');
  const delta=.004;$('#locationMap').innerHTML=`<iframe title="Confirm report location" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${lon-delta}%2C${lat-delta}%2C${lon+delta}%2C${lat+delta}&layer=mapnik&marker=${lat}%2C${lon}"></iframe><a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}" target="_blank" rel="noopener">Open map to check the pin</a>`;
  try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`);if(r.ok){const data=await r.json();if(data.display_name){$('#reportLocation').value=data.display_name.slice(0,255);status.textContent='Location found. Please verify the address and map pin before submitting.';}else status.textContent=`GPS saved (${lat.toFixed(5)}, ${lon.toFixed(5)}). Please enter a nearby address.`;}else throw new Error('reverse lookup failed');}
  catch{status.textContent=`GPS saved (${lat.toFixed(5)}, ${lon.toFixed(5)}). Please enter a nearby address.`;}
  button.disabled=false;
 },err=>{status.textContent=err.code===1?'Location permission was denied. You can enter the address manually.':'Could not detect location. Check your device settings or enter the address manually.';button.disabled=false;},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
});

// Restore a valid server-side session after a page refresh.
(async function restoreSession(){
 if(!token){showAuth();return;}
 try{const profile=await api('/me');user={id:profile.user_id,role:profile.role,name:profile.full_name,email:profile.email};await refresh();enter(user);}
 catch{token='';localStorage.removeItem('civictrack_token');showAuth();}
})();
