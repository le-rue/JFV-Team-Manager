'use strict';

/* Team Manager PWA – Offline-first Supabase client
   - local-first writes
   - per-user local storage
   - durable mutation queue
   - optimistic concurrency via server-side version
   - conflict log with explicit restore option
*/

const CONFIG = window.TEAM_MANAGER_SUPABASE || {};
const SUPABASE_URL = CONFIG.url || '';
const SUPABASE_KEY = CONFIG.publishableKey || '';
const supabase = (SUPABASE_URL && SUPABASE_KEY && window.supabase && !SUPABASE_URL.includes('HIER_'))
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

const STORAGE_VERSION = 'v3';
const DATA_PREFIX = `team-manager-data-${STORAGE_VERSION}:`;
const QUEUE_PREFIX = `team-manager-queue-${STORAGE_VERSION}:`;
const CONFLICT_PREFIX = `team-manager-conflicts-${STORAGE_VERSION}:`;
const DEVICE_KEY = 'team-manager-device-id-v1';
const LEGACY_KEYS = ['team-manager-v2', 'team-manager-v1'];
const LEGACY_QUEUE_KEYS = ['team-manager-sync-queue-v1'];
const LEGACY_CONFLICT_KEYS = ['team-manager-sync-conflicts-v1'];

const initial = {
  teamName: 'Mein Fußballteam', season: '2026/27',
  league: ['Team 1','Team 2','Team 3','Team 4','Team 5','Team 6','Team 7','Team 8','Team 9','Team 10','Team 11','Team 12'],
  players: [], matches: [], teamIds: {}, meta: { players:{}, matches:{}, teams:{}, appearances:{}, goals:{} }
};

const clone = x => JSON.parse(JSON.stringify(x));
const deviceId = localStorage.getItem(DEVICE_KEY) || crypto.randomUUID();
localStorage.setItem(DEVICE_KEY, deviceId);
let currentUserId = null;
let currentUserEmail = '';
let ownerKey = 'guest';
let db;
let queue;
let conflicts;
let syncTimer = null;
let syncing = false;

function nsKey(prefix, owner=ownerKey){ return prefix + owner; }
function normalizeLocal(v){
  v.players = (v.players||[]).map(p=>({...p,id:p.id||crypto.randomUUID()}));
  v.matches = (v.matches||[]).map(m=>({...m,id:m.id||crypto.randomUUID(),events:(m.events||[]).map(e=>({...e,id:e.id||crypto.randomUUID()}))}));
  v.league = Array.isArray(v.league) ? v.league : clone(initial.league);
  v.teamIds = v.teamIds || {};
  v.meta = {...clone(initial.meta), ...(v.meta||{})};
  for(const t of Object.keys(initial.meta)) v.meta[t] = v.meta[t] || {};
  v.league.forEach(name=>{ if(!v.teamIds[name]) v.teamIds[name]=crypto.randomUUID(); });
}
function migrateLegacyGuest(){
  if(localStorage.getItem(nsKey(DATA_PREFIX,'guest'))) return;
  const dataRaw = LEGACY_KEYS.map(k=>localStorage.getItem(k)).find(Boolean);
  if(dataRaw) localStorage.setItem(nsKey(DATA_PREFIX,'guest'), dataRaw);
  const qRaw = LEGACY_QUEUE_KEYS.map(k=>localStorage.getItem(k)).find(Boolean);
  if(qRaw) localStorage.setItem(nsKey(QUEUE_PREFIX,'guest'), qRaw);
  const cRaw = LEGACY_CONFLICT_KEYS.map(k=>localStorage.getItem(k)).find(Boolean);
  if(cRaw) localStorage.setItem(nsKey(CONFLICT_PREFIX,'guest'), cRaw);
}
function loadNamespace(owner){
  ownerKey = owner || 'guest';
  migrateLegacyGuest();
  const raw = localStorage.getItem(nsKey(DATA_PREFIX));
  let v;
  try { v = raw ? JSON.parse(raw) : clone(initial); } catch { v = clone(initial); }
  v = {...clone(initial), ...v, meta:{...clone(initial.meta), ...(v.meta||{})}, teamIds:v.teamIds||{}};
  normalizeLocal(v);
  db = v;
  try { queue = JSON.parse(localStorage.getItem(nsKey(QUEUE_PREFIX))||'[]'); } catch { queue=[]; }
  try { conflicts = JSON.parse(localStorage.getItem(nsKey(CONFLICT_PREFIX))||'[]'); } catch { conflicts=[]; }
  // Convert queues made by the previous client to version-aware queue entries.
  queue = (queue||[]).map(q=>({...q, baseVersion:Number(q.baseVersion ?? 0)}));
  persist();
}
loadNamespace('guest');

function now(){return new Date().toISOString()}
function persist(){
  localStorage.setItem(nsKey(DATA_PREFIX),JSON.stringify(db));
  localStorage.setItem(nsKey(QUEUE_PREFIX),JSON.stringify(queue));
  localStorage.setItem(nsKey(CONFLICT_PREFIX),JSON.stringify(conflicts));
}
function setSyncStatus(text){const el=document.getElementById('syncStatus');if(el)el.textContent=text}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function initials(n){return String(n||'?').split(/\s+/).filter(Boolean).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
function hasMeaningfulData(v=db){return (v.players?.length||0)>0 || (v.matches?.length||0)>0 || (v.league||[]).some((n,i)=>n!==`Team ${i+1}`)}

function enqueue(table, action, recordId, payload=null){
  const meta = db.meta?.[table]?.[recordId] || {};
  const op = {id:crypto.randomUUID(),table,action,recordId,payload,baseVersion:Number(meta.version||0),clientUpdatedAt:now(),deviceId,attempts:0};
  const i = queue.findIndex(q=>q.table===table && q.recordId===recordId);
  if(i>=0){ op.baseVersion=Number(queue[i].baseVersion||0); queue.splice(i,1); }
  queue.push(op); persist(); scheduleSync();
}
function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncAll(),700)}

function teamRows(){return db.league.map((name,i)=>({id:db.teamIds[name]||(db.teamIds[name]=crypto.randomUUID()),name,short_name:name,sort_order:i}))}
function playerRow(p,i=0){return {id:p.id,name:p.name,number:p.number===''?null:+p.number,position:p.position||'',sort_order:i,active:true}}
function matchRow(m){return {id:m.id,opponent:m.opponent||'',match_date:m.date||null,match_type:m.type||'league',home_away:m.homeAway||'home',team_goals:m.goalsFor,opponent_goals:m.goalsAgainst}}
function eventRow(m,e){return {id:e.id,match_id:m.id,player_id:e.playerId}}

function save({render=true}={}){persist();if(render) window.render();}
function touchPlayer(p){enqueue('players','upsert',p.id,playerRow(p,db.players.indexOf(p)))}
function touchMatch(m){
  enqueue('matches','upsert',m.id,matchRow(m));
  (m.events||[]).forEach(e=>enqueue(e.type==='goal'?'goals':'appearances','upsert',e.id,eventRow(m,e)));
}
function touchAllTeams(){teamRows().forEach(r=>enqueue('teams','upsert',r.id,r))}

async function getSession(){if(!supabase)return null;const {data,error}=await supabase.auth.getSession();if(error)throw error;return data.session}
function withUser(payload,userId){const {updated_at,version,deleted_at,...clean}=payload||{};return {...clean,user_id:userId,device_id:deviceId,deleted_at:null}}
async function fetchRemoteRow(op,userId){
  const {data,error}=await supabase.from(op.table).select('*').eq('id',op.recordId).eq('user_id',userId).maybeSingle();
  if(error)throw error; return data;
}
function rememberMeta(table,row){db.meta[table]=db.meta[table]||{};db.meta[table][row.id]={version:Number(row.version||0),updated_at:row.updated_at||null,deleted_at:row.deleted_at||null,sort_order:row.sort_order??null}}
function recordConflict(op,remote,reason='version_mismatch'){
  conflicts.unshift({id:crypto.randomUUID(),at:now(),table:op.table,recordId:op.recordId,action:op.action,reason,baseVersion:Number(op.baseVersion||0),local:op.payload,remote});
  conflicts=conflicts.slice(0,100);persist();
}

async function applyRemoteToLocal(table,row){
  if(!row)return;
  rememberMeta(table,row);
  if(row.deleted_at){
    if(table==='players') db.players=db.players.filter(x=>x.id!==row.id);
    if(table==='matches') db.matches=db.matches.filter(x=>x.id!==row.id);
    if(table==='teams'){const old=Object.keys(db.teamIds).find(k=>db.teamIds[k]===row.id);if(old){db.league=db.league.filter(n=>n!==old);delete db.teamIds[old]}}
    if(table==='appearances'||table==='goals') db.matches.forEach(m=>m.events=(m.events||[]).filter(e=>e.id!==row.id));
    return;
  }
  if(table==='players'){
    const x={id:row.id,name:row.name,number:row.number??'',position:row.position||''}; const i=db.players.findIndex(p=>p.id===row.id); i>=0?db.players[i]=x:db.players.push(x);
  } else if(table==='matches'){
    const old=db.matches.find(m=>m.id===row.id); const x={id:row.id,date:row.match_date||'',type:row.match_type||'league',homeAway:row.home_away||'home',opponent:row.opponent||'',goalsFor:row.team_goals,goalsAgainst:row.opponent_goals,events:old?.events||[]};
    const i=db.matches.findIndex(m=>m.id===row.id); i>=0?db.matches[i]=x:db.matches.push(x);
  } else if(table==='teams'){
    const oldName=Object.keys(db.teamIds).find(k=>db.teamIds[k]===row.id); if(oldName && oldName!==row.name){db.league=db.league.map(n=>n===oldName?row.name:n);delete db.teamIds[oldName]}
    db.teamIds[row.name]=row.id;if(!db.league.includes(row.name))db.league.push(row.name);
    db.league.sort((a,b)=>(db.meta.teams[db.teamIds[a]]?.sort_order??999)-(db.meta.teams[db.teamIds[b]]?.sort_order??999));
  } else if(table==='appearances'||table==='goals'){
    const m=db.matches.find(x=>x.id===row.match_id); if(m){m.events=m.events||[];const type=table==='goals'?'goal':'app';const e={id:row.id,playerId:row.player_id,type};const i=m.events.findIndex(x=>x.id===row.id);i>=0?m.events[i]=e:m.events.push(e)}
  }
}

async function guardedUpdate(op,userId,changes,expectedVersion){
  let q=supabase.from(op.table).update(changes).eq('id',op.recordId).eq('user_id',userId);
  if(expectedVersion>0) q=q.eq('version',expectedVersion);
  const {data,error}=await q.select('*').maybeSingle();
  if(error)throw error;
  return data;
}

async function pushOperation(op,userId){
  const remote=await fetchRemoteRow(op,userId);
  const baseVersion=Number(op.baseVersion||0);
  const remoteVersion=Number(remote?.version||0);

  // Any changed server version since the local edit started is a real conflict.
  if(remote && remoteVersion!==baseVersion){
    recordConflict(op,remote,'version_mismatch');
    await applyRemoteToLocal(op.table,remote); // safe default: server wins, local copy remains in conflict log
    return 'drop';
  }
  if(!remote && baseVersion>0){
    recordConflict(op,null,'remote_missing');
    return 'drop';
  }

  if(op.action==='delete'){
    if(!remote) return 'drop';
    const written=await guardedUpdate(op,userId,{deleted_at:now(),device_id:deviceId},baseVersion);
    if(!written){
      const latest=await fetchRemoteRow(op,userId);recordConflict(op,latest,'race_during_delete');if(latest)await applyRemoteToLocal(op.table,latest);return 'drop';
    }
    await applyRemoteToLocal(op.table,written);return 'drop';
  }

  const row=withUser(op.payload,userId);
  if(!remote){
    const {data,error}=await supabase.from(op.table).insert(row).select('*').single();
    if(error){
      // A concurrent insert with the same id may have won between fetch and insert.
      const latest=await fetchRemoteRow(op,userId).catch(()=>null);
      if(latest){recordConflict(op,latest,'race_during_insert');await applyRemoteToLocal(op.table,latest);return 'drop';}
      throw error;
    }
    await applyRemoteToLocal(op.table,data);return 'drop';
  }

  const written=await guardedUpdate(op,userId,row,baseVersion);
  if(!written){
    const latest=await fetchRemoteRow(op,userId);recordConflict(op,latest,'race_during_update');if(latest)await applyRemoteToLocal(op.table,latest);return 'drop';
  }
  await applyRemoteToLocal(op.table,written);return 'drop';
}

async function pullTable(table,userId){
  const {data,error}=await supabase.from(table).select('*').eq('user_id',userId);
  if(error)throw error;
  for(const row of (data||[])){
    const pending=queue.find(q=>q.table===table&&q.recordId===row.id);
    const localVersion=Number(db.meta?.[table]?.[row.id]?.version||0);
    const remoteVersion=Number(row.version||0);
    if(pending){
      if(remoteVersion!==Number(pending.baseVersion||0)){
        recordConflict(pending,row,'pull_detected_conflict');
        queue=queue.filter(q=>q.id!==pending.id);
        await applyRemoteToLocal(table,row);
      }
    } else if(remoteVersion>localVersion || !db.meta?.[table]?.[row.id]) {
      await applyRemoteToLocal(table,row);
    }
  }
}

function queuePriority(op){
  const up={teams:10,players:20,matches:30,appearances:40,goals:40};
  const del={appearances:10,goals:10,matches:20,players:20,teams:30};
  return (op.action==='delete'?del:up)[op.table]||99;
}
async function syncAll(){
  if(syncing)return;
  if(!supabase){setSyncStatus('Supabase nicht konfiguriert');return}
  if(!navigator.onLine){setSyncStatus(`Offline · ${queue.length} Änderung${queue.length===1?'':'en'} wartet`);return}
  let session;try{session=await getSession()}catch(e){console.error(e);setSyncStatus('Verbindung fehlgeschlagen');return}
  if(!session){setSyncStatus('Bitte anmelden');return}
  if(ownerKey!==session.user.id) switchUserContext(session.user);
  syncing=true;setSyncStatus(`Synchronisiere · ${queue.length} offen`);
  try{
    queue.sort((a,b)=>queuePriority(a)-queuePriority(b));
    for(const op of [...queue]){
      try{await pushOperation(op,session.user.id);queue=queue.filter(q=>q.id!==op.id);persist()}
      catch(e){op.attempts=(op.attempts||0)+1;op.lastError=e.message;persist();throw e}
    }
    for(const table of ['teams','players','matches','appearances','goals']) await pullTable(table,session.user.id);
    persist();render();setSyncStatus(conflicts.length?`✓ Synchronisiert · ${conflicts.length} Konflikt${conflicts.length===1?'':'e'}`:'✓ Synchronisiert');
  }catch(e){console.error('sync',e);setSyncStatus(`Sync pausiert · ${queue.length} Änderung${queue.length===1?'':'en'} lokal`)}finally{syncing=false}
}

function switchUserContext(user){
  currentUserId=user?.id||null;currentUserEmail=user?.email||'';
  loadNamespace(currentUserId||'guest');
  render();
}
async function initialPull(){
  if(!supabase)return;
  let session=await getSession();
  if(!session){switchUserContext(null);setSyncStatus('Bitte anmelden');return}
  switchUserContext(session.user);
  setSyncStatus('Lade Teamdaten …');
  try{await syncAll()}catch(e){console.error(e);setSyncStatus('Offline · lokaler Stand aktiv')}
}

async function openLogin(){
  if(!supabase)return alert('Bitte zuerst supabase-config.js mit Project URL und Publishable Key ausfüllen.');
  const session=await getSession().catch(()=>null);
  if(session){
    openModal(`<h2>Angemeldet</h2><div class="card"><b>${esc(session.user.email||'Benutzer')}</b><div class="sub">Lokale Daten sind diesem Konto getrennt zugeordnet.</div></div><div class="actions"><button class="secondary" onclick="syncAll()">Jetzt synchronisieren</button><button class="danger" onclick="logout()">Abmelden</button><button onclick="closeModal()">Schließen</button></div>`);return;
  }
  openModal(`<h2>Anmelden</h2><label>E-Mail</label><input id="loginEmail" type="email" autocomplete="email"><label>Passwort</label><input id="loginPassword" type="password" autocomplete="current-password"><div class="actions" style="margin-top:15px"><button class="primary" onclick="login()">Anmelden</button><button class="secondary" onclick="signup()">Konto anlegen</button><button onclick="closeModal()">Abbrechen</button></div><div class="sub" style="margin-top:12px">Ohne Anmeldung bleibt die App lokal nutzbar. Gastdaten werden niemals automatisch einem anderen Konto zugeordnet.</div>`)
}
async function login(){
  const email=document.getElementById('loginEmail').value.trim(),password=document.getElementById('loginPassword').value;
  const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error)return alert(error.message);
  closeModal();switchUserContext(data.user);await syncAll();
}
async function signup(){
  const email=document.getElementById('loginEmail').value.trim(),password=document.getElementById('loginPassword').value;
  if(!email||password.length<6)return alert('Bitte E-Mail und ein Passwort mit mindestens 6 Zeichen eingeben.');
  const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:email.split('@')[0]}}});if(error)return alert(error.message);
  if(data.session){closeModal();switchUserContext(data.user);await syncAll()}else alert('Konto angelegt. Falls E-Mail-Bestätigung aktiviert ist, bestätige zuerst die Nachricht von Supabase und melde dich danach an.');
}
async function logout(){
  if(supabase) await supabase.auth.signOut();
  switchUserContext(null);setSyncStatus('Abgemeldet · Gastmodus');closeModal();
}
function importGuestData(){
  if(!currentUserId)return alert('Bitte zuerst anmelden.');
  const raw=localStorage.getItem(nsKey(DATA_PREFIX,'guest'));if(!raw)return alert('Keine Gastdaten gefunden.');
  let guest;try{guest=JSON.parse(raw)}catch{return alert('Gastdaten sind nicht lesbar.');}
  normalizeLocal(guest);if(!hasMeaningfulData(guest))return alert('Keine relevanten Gastdaten vorhanden.');
  if(!confirm('Gastdaten in dieses Konto übernehmen? Vorhandene lokale Kontodaten werden dabei ersetzt.'))return;
  db=guest;db.meta=clone(initial.meta);normalizeLocal(db);queue=[];conflicts=[];
  touchAllTeams();db.players.forEach(touchPlayer);db.matches.forEach(touchMatch);persist();render();scheduleSync();closeModal();
}
function restoreConflict(id){
  const c=conflicts.find(x=>x.id===id);if(!c)return;
  const remoteVersion=Number(c.remote?.version||0);
  db.meta[c.table]=db.meta[c.table]||{};db.meta[c.table][c.recordId]={version:remoteVersion,updated_at:c.remote?.updated_at||null};
  if(c.action==='delete') enqueue(c.table,'delete',c.recordId,null);
  else {applyPayloadToLocal(c.table,c.local);enqueue(c.table,'upsert',c.recordId,c.local)}
  conflicts=conflicts.filter(x=>x.id!==id);persist();render();scheduleSync();showConflicts();
}
function applyPayloadToLocal(table,p){
  if(!p)return;
  if(table==='players'){const x={id:p.id,name:p.name,number:p.number??'',position:p.position||''};const i=db.players.findIndex(v=>v.id===p.id);i>=0?db.players[i]=x:db.players.push(x)}
  else if(table==='matches'){const old=db.matches.find(v=>v.id===p.id);const x={id:p.id,date:p.match_date||'',type:p.match_type||'league',homeAway:p.home_away||'home',opponent:p.opponent||'',goalsFor:p.team_goals,goalsAgainst:p.opponent_goals,events:old?.events||[]};const i=db.matches.findIndex(v=>v.id===p.id);i>=0?db.matches[i]=x:db.matches.push(x)}
  else if(table==='teams'){const old=Object.keys(db.teamIds).find(k=>db.teamIds[k]===p.id);if(old&&old!==p.name){db.league=db.league.map(n=>n===old?p.name:n);delete db.teamIds[old]}db.teamIds[p.name]=p.id;if(!db.league.includes(p.name))db.league.push(p.name)}
  else if(table==='appearances'||table==='goals'){const m=db.matches.find(v=>v.id===p.match_id);if(m){m.events=m.events||[];const e={id:p.id,playerId:p.player_id,type:table==='goals'?'goal':'app'};const i=m.events.findIndex(v=>v.id===p.id);i>=0?m.events[i]=e:m.events.push(e)}}
}
window.addEventListener('online',()=>{setSyncStatus('Online · synchronisiere …');syncAll()});
window.addEventListener('offline',()=>setSyncStatus(`Offline · ${queue.length} Änderung${queue.length===1?'':'en'} wartet`));

function showPage(p){document.querySelectorAll('main>section').forEach(x=>x.classList.add('hidden'));const sec=document.getElementById(p);if(sec)sec.classList.remove('hidden');document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===p));render()}
function render(){document.getElementById('teamName').textContent=db.teamName;const s=document.getElementById('seasonText');s.firstChild.textContent='Saison '+db.season+' · ';renderDash();renderPlayers();renderMatches();renderLeague()}
function stats(){let apps=0,goals=0;db.matches.forEach(m=>(m.events||[]).forEach(e=>{if(e.type==='app')apps++;if(e.type==='goal')goals++}));return{apps,goals,players:db.players.length,matches:db.matches.length}}
function renderDash(){let s=stats(),recent=[...db.matches].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,4);document.getElementById('dashboard').innerHTML=`<h1>Übersicht</h1><div class="grid grid3"><div class="card"><div class="stat">${s.players}</div><div class="label">Spieler</div></div><div class="card"><div class="stat">${s.matches}</div><div class="label">Spiele</div></div><div class="card"><div class="stat">${s.goals}</div><div class="label">Tore</div></div></div><div class="card"><div class="row"><div><h2>Offline-First</h2><div class="sub">${queue.length} lokale Änderung${queue.length===1?'':'en'} in der Warteschlange.</div></div><button class="primary" onclick="openMatch()">+ Spiel</button></div></div><div class="card"><h2>Letzte Spiele</h2>${recent.length?'<div class="list">'+recent.map(matchHTML).join('')+'</div>':'<div class="empty">Noch keine Spiele erfasst.</div>'}</div>`}
function playerStats(p){let a=0,g=0;db.matches.forEach(m=>(m.events||[]).forEach(e=>{if(e.playerId===p.id){if(e.type==='app')a++;if(e.type==='goal')g++}}));return{a,g}}
function renderPlayers(){let rows=db.players.map(p=>({p,...playerStats(p)})).sort((x,y)=>(+x.p.number||999)-(+y.p.number||999)||x.p.name.localeCompare(y.p.name));document.getElementById('players').innerHTML=`<div class="row"><div><h1>Spieler</h1><div class="sub">${db.players.length} Kaderplätze</div></div><button class="primary" onclick="openPlayer()">+ Spieler</button></div><div class="card">${rows.length?'<div class="list">'+rows.map(x=>`<div class="item player"><div class="avatar">${initials(x.p.name)}</div><div class="grow"><b class="truncate">${esc(x.p.number||'–')} · ${esc(x.p.name)}</b><div class="sub">${esc(x.p.position||'Keine Position')}</div><div class="sub">${x.a} Einsätze · ${x.g} Tore</div></div><button class="secondary" onclick="openPlayer('${x.p.id}')">Bearbeiten</button></div>`).join('')+'</div>':'<div class="empty">Lege den ersten Spieler an.</div>'}</div>`}
function matchHTML(m){let result=m.goalsFor!=null&&m.goalsAgainst!=null?`${m.goalsFor}:${m.goalsAgainst}`:'–';let scorers=[];db.players.forEach(p=>{let n=(m.events||[]).filter(e=>e.type==='goal'&&e.playerId===p.id).length;if(n)scorers.push(`${p.name}${n>1?' ('+n+')':''}`)});return `<div class="item"><div class="row"><div class="grow"><div><b>${esc(m.opponent||'Unbekannt')}</b> <span class="pill" style="font-size:15px">${result}</span></div><div class="sub">${m.type==='league'?'Liga':m.type==='cup'?'Pokal':'Test'} · ${m.date?new Date(m.date+'T12:00').toLocaleDateString('de-DE'):'–'}</div><div class="sub">${scorers.length?'Tore: '+esc(scorers.join(', ')):'Keine Torschützen erfasst'}</div></div><button class="secondary" onclick="openMatch('${m.id}')">Details</button></div></div>`}
function renderMatches(){let types=['all','league','cup','test'],active=window.mt||'all',arr=[...db.matches].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).filter(m=>active==='all'||m.type===active);document.getElementById('matches').innerHTML=`<div class="row"><div><h1>Spiele</h1><div class="sub">Liga, Pokal und Tests</div></div><button class="primary" onclick="openMatch()">+ Spiel</button></div><div class="tabs">${types.map(t=>`<button class="${active===t?'on':''}" onclick="window.mt='${t}';renderMatches()">${t==='all'?'Alle':t==='league'?'Liga':t==='cup'?'Pokal':'Tests'}</button>`).join('')}</div><div class="card">${arr.length?'<div class="list">'+arr.map(matchHTML).join('')+'</div>':'<div class="empty">Keine Spiele in dieser Kategorie.</div>'}</div>`}
function leagueStats(){let t=db.league.map(name=>({name,sp:0,w:0,d:0,l:0,gf:0,ga:0,pts:0}));db.matches.filter(m=>m.type==='league'&&m.goalsFor!=null&&m.goalsAgainst!=null).forEach(m=>{let i=t.findIndex(x=>x.name===m.opponent);if(i<0)return;let gf=+m.goalsFor,ga=+m.goalsAgainst;t[i].sp++;t[i].gf+=ga;t[i].ga+=gf;if(gf<ga){t[i].w++;t[i].pts+=3}else if(gf===ga){t[i].d++;t[i].pts++}else t[i].l++});return t.sort((a,b)=>b.pts-a.pts||((b.gf-b.ga)-(a.gf-a.ga))||b.gf-a.gf)}
function renderLeague(){let tab=window.lt||'table';document.getElementById('league').innerHTML=`<h1>Liga</h1><div class="tabs"><button class="${tab==='table'?'on':''}" onclick="window.lt='table';renderLeague()">Tabelle</button><button class="${tab==='teams'?'on':''}" onclick="window.lt='teams';renderLeague()">Teams</button></div><div class="card">${tab==='table'?`<table><thead><tr><th>#</th><th>Team</th><th>Sp</th><th>+/-</th><th>Pkt</th></tr></thead><tbody>${leagueStats().map((x,i)=>`<tr><td>${i+1}</td><td><b>${esc(x.name)}</b></td><td>${x.sp}</td><td>${x.gf-x.ga}</td><td><b>${x.pts}</b></td></tr>`).join('')}</tbody></table>`:`<div class="list">${db.league.map((x,i)=>`<div class="item row"><b>${i+1}. ${esc(x)}</b><button class="secondary" onclick="editTeam(${i})">Bearbeiten</button></div>`).join('')}</div>`}</div>`}
function openModal(html){document.getElementById('sheet').innerHTML=html;document.getElementById('modal').classList.remove('hidden')}function closeModal(){document.getElementById('modal').classList.add('hidden')}
function openSettings(){
  let guestHas=false;try{const g=JSON.parse(localStorage.getItem(nsKey(DATA_PREFIX,'guest'))||'null');guestHas=g&&hasMeaningfulData(g)}catch{}
  const account=currentUserId?`<div class="card"><b>${esc(currentUserEmail||'Angemeldet')}</b><div class="sub">Lokaler Speicher: getrennt für dieses Konto</div></div>`:`<div class="card"><b>Gastmodus</b><div class="sub">Daten bleiben nur auf diesem Gerät, bis du dich anmeldest.</div></div>`;
  openModal(`<h2>Einstellungen</h2>${account}<label>Teamname</label><input id="sname" value="${esc(db.teamName)}"><label>Saison</label><input id="sseason" value="${esc(db.season)}"><div class="sub" style="margin-top:12px">Queue: ${queue.length} · Konflikte: ${conflicts.length} · Gerät: ${esc(deviceId.slice(0,8))}</div><div class="actions" style="margin-top:15px"><button class="primary" onclick="saveSettings()">Speichern</button><button class="secondary" onclick="syncAll()">Jetzt synchronisieren</button><button class="secondary" onclick="showConflicts()">Konflikte</button>${currentUserId&&guestHas?`<button class="secondary" onclick="importGuestData()">Gastdaten übernehmen</button>`:''}${currentUserId?`<button class="danger" onclick="logout()">Abmelden</button>`:`<button class="secondary" onclick="openLogin()">Anmelden</button>`}</div>`)
}
function saveSettings(){db.teamName=document.getElementById('sname').value||'Mein Fußballteam';db.season=document.getElementById('sseason').value||'';save();closeModal()}
function showConflicts(){
  openModal(`<h2>Synchronisationskonflikte</h2><div class="sub" style="margin-bottom:12px">Bei einem Versionskonflikt bleibt standardmäßig der Serverstand aktiv. Die verworfene lokale Änderung bleibt hier erhalten und kann bewusst erneut angewendet werden.</div>${conflicts.length?'<div class="list">'+conflicts.map(c=>`<div class="item"><b>${esc(c.table)} · Version ${c.baseVersion} → ${c.remote?.version??'–'}</b><div class="sub">${new Date(c.at).toLocaleString('de-DE')} · ${esc(c.reason||'Konflikt')}</div><div class="actions" style="margin-top:8px"><button class="secondary" onclick="restoreConflict('${c.id}')">Lokale Änderung erneut anwenden</button></div></div>`).join('')+'</div>':'<div class="empty">Keine Konflikte protokolliert.</div>'}<div class="actions" style="margin-top:15px"><button class="secondary" onclick="conflicts=[];persist();openSettings()">Protokoll leeren</button><button onclick="closeModal()">Schließen</button></div>`)
}
function openPlayer(id){let p=db.players.find(x=>x.id===id)||{id:crypto.randomUUID(),name:'',position:'',number:''};openModal(`<h2>${id?'Spieler bearbeiten':'Neuer Spieler'}</h2><label>Name</label><input id="pn" value="${esc(p.name)}" placeholder="Vor- und Nachname"><div class="formgrid"><div><label>Nummer</label><input id="pno" inputmode="numeric" value="${esc(p.number)}"></div><div><label>Position</label><select id="pp">${['Torwart','Abwehr','Mittelfeld','Angriff'].map(x=>`<option ${p.position===x?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="actions" style="margin-top:15px"><button class="primary" onclick="savePlayer('${p.id}')">Speichern</button>${id?`<button class="danger" onclick="deletePlayer('${p.id}')">Löschen</button>`:''}<button onclick="closeModal()">Abbrechen</button></div>`)}
function savePlayer(id){let name=document.getElementById('pn').value.trim();if(!name)return alert('Bitte einen Namen eingeben.');let p=db.players.find(x=>x.id===id);if(p){p.name=name;p.number=document.getElementById('pno').value;p.position=document.getElementById('pp').value}else{p={id,name,number:document.getElementById('pno').value,position:document.getElementById('pp').value};db.players.push(p)}touchPlayer(p);save();closeModal()}
function deletePlayer(id){if(!confirm('Spieler löschen?'))return;db.players=db.players.filter(p=>p.id!==id);db.matches.forEach(m=>{for(const e of (m.events||[]).filter(e=>e.playerId===id))enqueue(e.type==='goal'?'goals':'appearances','delete',e.id);m.events=(m.events||[]).filter(e=>e.playerId!==id)});enqueue('players','delete',id);save();closeModal()}
function openMatch(id){let m=db.matches.find(x=>x.id===id)||{id:crypto.randomUUID(),date:new Date().toISOString().slice(0,10),type:'league',opponent:'',goalsFor:'',goalsAgainst:'',events:[]};openModal(`<h2>${id?'Spiel bearbeiten':'Neues Spiel'}</h2><div class="formgrid"><div><label>Datum</label><input id="md" type="date" value="${m.date||''}"></div><div><label>Art</label><select id="mt"><option value="league" ${m.type==='league'?'selected':''}>Liga</option><option value="cup" ${m.type==='cup'?'selected':''}>Pokal</option><option value="test" ${m.type==='test'?'selected':''}>Test</option></select></div><div class="full"><label>Gegner</label><input id="mo" value="${esc(m.opponent)}"></div><div><label>Eigene Tore</label><input id="gf" type="number" min="0" inputmode="numeric" value="${m.goalsFor??''}"></div><div><label>Gegentore</label><input id="ga" type="number" min="0" inputmode="numeric" value="${m.goalsAgainst??''}"></div></div><label>Spieler-Einsätze und Tore</label><div class="list">${db.players.length?db.players.map(p=>{let apps=(m.events||[]).some(e=>e.playerId===p.id&&e.type==='app'),goals=(m.events||[]).filter(e=>e.playerId===p.id&&e.type==='goal').length;return `<div class="item row"><div class="grow"><b>${esc(p.name)}</b><div class="sub">${esc(p.position||'')}</div></div><button class="secondary" onclick="toggleEvent('${m.id}','${p.id}','app')">${apps?'✓ Einsatz':'+ Einsatz'}</button><button class="secondary" onclick="toggleEvent('${m.id}','${p.id}','goal')">${goals} ⚽</button><button class="secondary" onclick="resetGoals('${m.id}','${p.id}')">↺</button></div>`}).join(''):'<div class="empty">Erst Spieler anlegen.</div>'}</div><div class="actions" style="margin-top:15px"><button class="primary" onclick="saveMatch('${m.id}')">Speichern</button>${id?`<button class="danger" onclick="deleteMatch('${m.id}')">Löschen</button>`:''}<button onclick="closeModal()">Abbrechen</button></div>`)}
function ensureDraftMatch(mid){let m=db.matches.find(x=>x.id===mid);if(!m){m={id:mid,date:new Date().toISOString().slice(0,10),type:'league',homeAway:'home',opponent:'',goalsFor:null,goalsAgainst:null,events:[]};db.matches.push(m);enqueue('matches','upsert',m.id,matchRow(m))}return m}
function toggleEvent(mid,pid,type){let m=ensureDraftMatch(mid);m.events=m.events||[];if(type==='app'){let i=m.events.findIndex(e=>e.playerId===pid&&e.type==='app');if(i>=0){let [e]=m.events.splice(i,1);enqueue('appearances','delete',e.id)}else{let e={id:crypto.randomUUID(),playerId:pid,type};m.events.push(e);enqueue('appearances','upsert',e.id,eventRow(m,e))}}else{let e={id:crypto.randomUUID(),playerId:pid,type};m.events.push(e);enqueue('goals','upsert',e.id,eventRow(m,e))}save({render:false});openMatch(mid)}
function resetGoals(mid,pid){let m=ensureDraftMatch(mid);let gone=(m.events||[]).filter(e=>e.playerId===pid&&e.type==='goal');gone.forEach(e=>enqueue('goals','delete',e.id));m.events=(m.events||[]).filter(e=>!(e.playerId===pid&&e.type==='goal'));save({render:false});openMatch(mid)}
function saveMatch(id){let m=db.matches.find(x=>x.id===id);let data={id,date:document.getElementById('md').value,type:document.getElementById('mt').value,opponent:document.getElementById('mo').value.trim()||'Unbekannt',goalsFor:document.getElementById('gf').value===''?null:+document.getElementById('gf').value,goalsAgainst:document.getElementById('ga').value===''?null:+document.getElementById('ga').value,events:m?.events||[]};if(m)Object.assign(m,data);else{m=data;db.matches.push(m)}touchMatch(m);save();closeModal()}
function deleteMatch(id){if(!confirm('Spiel löschen?'))return;let m=db.matches.find(x=>x.id===id);(m?.events||[]).forEach(e=>enqueue(e.type==='goal'?'goals':'appearances','delete',e.id));db.matches=db.matches.filter(x=>x.id!==id);enqueue('matches','delete',id);save();closeModal()}
function editTeam(i){openModal(`<h2>Ligateam bearbeiten</h2><label>Teamname</label><input id="tn" value="${esc(db.league[i])}"><div class="actions" style="margin-top:15px"><button class="primary" onclick="saveTeam(${i})">Speichern</button><button onclick="closeModal()">Abbrechen</button></div>`)}
function saveTeam(i){const old=db.league[i],name=document.getElementById('tn').value.trim()||`Team ${i+1}`,id=db.teamIds[old]||crypto.randomUUID();db.league[i]=name;delete db.teamIds[old];db.teamIds[name]=id;enqueue('teams','upsert',id,{id,name,sort_order:i});save();closeModal()}

render();
(async()=>{
  if(!supabase){setSyncStatus('Supabase nicht konfiguriert');return}
  supabase.auth.onAuthStateChange((_event,session)=>{
    setTimeout(()=>{
      if(session){if(ownerKey!==session.user.id)switchUserContext(session.user);syncAll()}
      else {if(ownerKey!=='guest')switchUserContext(null);setSyncStatus('Bitte anmelden')}
    },0)
  });
  await initialPull();
})();
