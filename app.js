'use strict';

/* Team Manager PWA – Offline-first Supabase client
   - local-first writes
   - shared team workspace for authenticated users
   - durable mutation queue
   - optimistic concurrency via server-side version
   - conflict log with explicit restore option
*/

const CONFIG = window.TEAM_MANAGER_SUPABASE || {};
const SUPABASE_URL = CONFIG.url || '';
const SUPABASE_KEY = CONFIG.publishableKey || '';
const supabaseClient = (SUPABASE_URL && SUPABASE_KEY && window.supabase && !SUPABASE_URL.includes('HIER_'))
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

const TEAMS=['BSG Chemie Leipzig','Chemnitzer FC U16','FC Eilenburg','FC Erzgebirge Aue U16','FC Grimma','FSV Budissa Bautzen','FSV Zwickau II','JFV Neuseenland','SC Borea Dresden','Soccer for Kids Dresden','VFC Plauen','VfB Auerbach'];
const FIXTURES=[
['2026-08-29','FSV Budissa Bautzen',false,1],['2026-09-06','VFC Plauen',true,2],['2026-09-12','BSG Chemie Leipzig',false,3],['2026-09-19','FSV Zwickau II',true,4],['2026-09-26','Soccer for Kids Dresden',false,5],['2026-10-31','FC Grimma',true,6],['2026-11-07','FC Eilenburg',false,7],['2026-11-14','VfB Auerbach',true,8],['2026-11-21','FC Erzgebirge Aue U16',false,9],['2026-11-28','Chemnitzer FC U16',false,10],['2026-12-05','SC Borea Dresden',true,11],['2027-02-27','FSV Budissa Bautzen',true,12],['2027-03-06','VFC Plauen',false,13],['2027-03-13','BSG Chemie Leipzig',true,14],['2027-04-10','FSV Zwickau II',false,15],['2027-04-17','Soccer for Kids Dresden',true,16],['2027-04-24','FC Grimma',false,17],['2027-05-01','FC Eilenburg',true,18],['2027-05-22','VfB Auerbach',false,19],['2027-05-29','FC Erzgebirge Aue U16',true,20],['2027-06-05','Chemnitzer FC U16',true,21],['2027-06-12','SC Borea Dresden',false,22]
 ];
const FIRST_HALF_ROUNDS=[
[['BSG Chemie Leipzig','VfB Auerbach'],['FSV Zwickau II','FC Eilenburg'],['VFC Plauen','FC Erzgebirge Aue U16'],['FSV Budissa Bautzen','JFV Neuseenland'],['Soccer for Kids Dresden','FC Grimma'],['Chemnitzer FC U16','SC Borea Dresden']],
[['FC Erzgebirge Aue U16','BSG Chemie Leipzig'],['VfB Auerbach','FSV Zwickau II'],['FC Eilenburg','Soccer for Kids Dresden'],['FC Grimma','Chemnitzer FC U16'],['JFV Neuseenland','VFC Plauen'],['FSV Budissa Bautzen','SC Borea Dresden']],
[['BSG Chemie Leipzig','JFV Neuseenland'],['VFC Plauen','SC Borea Dresden'],['FC Grimma','FC Eilenburg'],['Soccer for Kids Dresden','VfB Auerbach'],['FSV Zwickau II','FC Erzgebirge Aue U16'],['Chemnitzer FC U16','FSV Budissa Bautzen']],
[['JFV Neuseenland','FSV Zwickau II'],['FC Erzgebirge Aue U16','Soccer for Kids Dresden'],['VfB Auerbach','FC Grimma'],['FC Eilenburg','Chemnitzer FC U16'],['FSV Budissa Bautzen','VFC Plauen'],['SC Borea Dresden','BSG Chemie Leipzig']],
[['Chemnitzer FC U16','VFC Plauen'],['BSG Chemie Leipzig','FSV Budissa Bautzen'],['FSV Zwickau II','SC Borea Dresden'],['FC Eilenburg','VfB Auerbach'],['FC Grimma','FC Erzgebirge Aue U16'],['Soccer for Kids Dresden','JFV Neuseenland']],
[['JFV Neuseenland','FC Grimma'],['FC Erzgebirge Aue U16','FC Eilenburg'],['VfB Auerbach','Chemnitzer FC U16'],['VFC Plauen','BSG Chemie Leipzig'],['FSV Budissa Bautzen','FSV Zwickau II'],['SC Borea Dresden','Soccer for Kids Dresden']],
[['FSV Zwickau II','VFC Plauen'],['VfB Auerbach','FC Erzgebirge Aue U16'],['FC Eilenburg','JFV Neuseenland'],['FC Grimma','SC Borea Dresden'],['Soccer for Kids Dresden','FSV Budissa Bautzen'],['Chemnitzer FC U16','BSG Chemie Leipzig']],
[['BSG Chemie Leipzig','FSV Zwickau II'],['JFV Neuseenland','VfB Auerbach'],['FC Erzgebirge Aue U16','Chemnitzer FC U16'],['VFC Plauen','Soccer for Kids Dresden'],['FSV Budissa Bautzen','FC Grimma'],['SC Borea Dresden','FC Eilenburg']],
[['FC Erzgebirge Aue U16','JFV Neuseenland'],['VfB Auerbach','SC Borea Dresden'],['FC Grimma','VFC Plauen'],['Soccer for Kids Dresden','BSG Chemie Leipzig'],['FC Eilenburg','FSV Budissa Bautzen'],['Chemnitzer FC U16','FSV Zwickau II']],
[['BSG Chemie Leipzig','FC Grimma'],['SC Borea Dresden','FC Erzgebirge Aue U16'],['FSV Zwickau II','Soccer for Kids Dresden'],['VFC Plauen','FC Eilenburg'],['FSV Budissa Bautzen','VfB Auerbach'],['Chemnitzer FC U16','JFV Neuseenland']],
[['JFV Neuseenland','SC Borea Dresden'],['FC Erzgebirge Aue U16','FSV Budissa Bautzen'],['VfB Auerbach','VFC Plauen'],['FC Eilenburg','BSG Chemie Leipzig'],['FC Grimma','FSV Zwickau II'],['Soccer for Kids Dresden','Chemnitzer FC U16']]
];
const LEAGUE_ROUNDS=[...FIRST_HALF_ROUNDS,...FIRST_HALF_ROUNDS.map(r=>r.map(([h,a])=>[a,h]))];
function makeLeagueGames(){return LEAGUE_ROUNDS.flatMap((r,ri)=>r.map(([home,away],gi)=>({id:crypto.randomUUID(),fixtureKey:`L${ri+1}-${gi+1}`,matchday:ri+1,date:FIXTURES.find(x=>x[3]===ri+1)?.[0]||'',home,away,homeGoals:null,awayGoals:null})))}


const initial = {
  teamName: 'JFV Neuseenland', season: '2026/27',
  league: [...TEAMS],
  players: [], matches: [], leagueGames: [], teamIds: {},
  meta: { players:{}, matches:{}, teams:{}, appearances:{}, goals:{}, league_games:{} }
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
  v.matches = (v.matches||[]).map(m=>({...m,id:pureUuid(m.id),homeAway:m.homeAway||(m.home===false?'away':'home'),events:(m.events||[]).map(e=>({...e,id:pureUuid(e.id)}))}));
  const looksPlaceholder = !Array.isArray(v.league) || v.league.length!==12 || v.league.every((n,i)=>n===`Team ${i+1}`);
  if(looksPlaceholder) v.league=[...TEAMS];
  v.leagueGames = Array.isArray(v.leagueGames) ? v.leagueGames.map(g=>({...g,fixtureKey:g.fixtureKey||(/^L\d+-\d+$/.test(String(g.id||''))?g.id:null),id:pureUuid(g.id)})) : [];
  v.teamIds = v.teamIds || {};
  v.meta = {...clone(initial.meta), ...(v.meta||{})};
  for(const t of Object.keys(initial.meta)) v.meta[t] = v.meta[t] || {};
  v.league.forEach(name=>{ if(!v.teamIds[name]) v.teamIds[name]=crypto.randomUUID(); });
  v.teamName = v.teamName && v.teamName!=='Mein Fußballteam' ? v.teamName : 'JFV Neuseenland';
  v.season = v.season || '2026/27';
}
function pureUuid(id){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id||''))?id:crypto.randomUUID()}
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
function hasMeaningfulData(v=db){return (v.players?.length||0)>0 || (v.matches||[]).some(m=>!m.imported || m.goalsFor!=null || m.goalsAgainst!=null || (m.events||[]).length)}

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
function matchRow(m){return {id:m.id,opponent:m.opponent||'',match_date:m.date||null,match_type:m.type||'league',home_away:m.homeAway||'home',team_goals:m.goalsFor,opponent_goals:m.goalsAgainst,matchday:m.matchday??null,imported:!!m.imported}}
function eventRow(m,e){return {id:e.id,match_id:m.id,player_id:e.playerId}}
function leagueGameRow(g){return {id:g.id,fixture_key:g.fixtureKey,matchday:g.matchday,match_date:g.date||null,home_team:g.home,away_team:g.away,home_goals:g.homeGoals,away_goals:g.awayGoals}}

function save({render=true}={}){persist();if(render) window.render();}
function touchPlayer(p){enqueue('players','upsert',p.id,playerRow(p,db.players.indexOf(p)))}
function touchMatch(m){
  enqueue('matches','upsert',m.id,matchRow(m));
  (m.events||[]).forEach(e=>enqueue(e.type==='goal'?'goals':'appearances','upsert',e.id,eventRow(m,e)));
}
function touchAllTeams(){teamRows().forEach(r=>enqueue('teams','upsert',r.id,r))}
function touchLeagueGame(g){enqueue('league_games','upsert',g.id,leagueGameRow(g))}
function ensureLeagueData(queueMissing=false){
  if(db.league.length!==TEAMS.length || TEAMS.some(t=>!db.league.includes(t))) db.league=[...TEAMS];
  db.league.forEach(name=>{if(!db.teamIds[name])db.teamIds[name]=crypto.randomUUID()});
  const byKey=new Map((db.leagueGames||[]).filter(g=>g.fixtureKey).map(g=>[g.fixtureKey,g]));
  for(const seed of makeLeagueGames()){
    if(!byKey.has(seed.fixtureKey)){
      db.leagueGames.push(seed);
      if(queueMissing && currentUserId) touchLeagueGame(seed);
    }
  }
  const validKeys=new Set(LEAGUE_ROUNDS.flatMap((r,ri)=>r.map((_,gi)=>`L${ri+1}-${gi+1}`)));
  db.leagueGames=db.leagueGames.filter(g=>validKeys.has(g.fixtureKey));
  FIXTURES.forEach(([date,opponent,home,matchday])=>{
    let m=db.matches.find(x=>x.type==='league'&&x.matchday===matchday);
    if(!m){
      m={id:crypto.randomUUID(),date,type:'league',opponent,homeAway:home?'home':'away',matchday,goalsFor:null,goalsAgainst:null,events:[],imported:true};
      db.matches.push(m);
      if(queueMissing && currentUserId) touchMatch(m);
    }else{
      m.date=m.date||date;m.opponent=m.opponent||opponent;m.homeAway=m.homeAway||(home?'home':'away');m.imported=true;
    }
  });
  if(queueMissing && currentUserId){
    for(const r of teamRows()){
      if(!db.meta.teams?.[r.id] && !queue.some(q=>q.table==='teams'&&q.recordId===r.id)) enqueue('teams','upsert',r.id,r);
    }
  }
  // Older per-user versions could have generated duplicate league seeds. Keep one
  // canonical local row per fixture/matchday, preferring pending edits, results and server-known rows.
  const prefer=(a,b,table)=>{
    const score=x=>(queue.some(q=>q.table===table&&q.recordId===x.id)?1000:0)+((x.homeGoals!=null||x.goalsFor!=null)?100:0)+((x.events||[]).length*10)+(db.meta?.[table]?.[x.id]?.version||0);
    return score(a)>=score(b)?a:b;
  };
  const lg=new Map();for(const g of db.leagueGames||[]){if(!g.fixtureKey)continue;lg.set(g.fixtureKey,lg.has(g.fixtureKey)?prefer(lg.get(g.fixtureKey),g,'league_games'):g)}
  db.leagueGames=[...lg.values()];
  const otherMatches=db.matches.filter(m=>!(m.type==='league'&&m.matchday));
  const lm=new Map();for(const m of db.matches.filter(m=>m.type==='league'&&m.matchday)){lm.set(m.matchday,lm.has(m.matchday)?prefer(lm.get(m.matchday),m,'matches'):m)}
  db.matches=[...otherMatches,...lm.values()];
  reconcileJfvResults();
  persist();
}
function reconcileJfvResults(){
  for(const m of db.matches.filter(x=>x.type==='league'&&x.matchday)){
    const g=(db.leagueGames||[]).find(x=>x.matchday===m.matchday&&(x.home==='JFV Neuseenland'||x.away==='JFV Neuseenland'));
    if(!g)continue;
    if(m.goalsFor!=null&&m.goalsAgainst!=null){
      if(g.home==='JFV Neuseenland'){g.homeGoals=m.goalsFor;g.awayGoals=m.goalsAgainst}
      else{g.homeGoals=m.goalsAgainst;g.awayGoals=m.goalsFor}
    } else if(g.homeGoals!=null&&g.awayGoals!=null){
      if(g.home==='JFV Neuseenland'){m.goalsFor=g.homeGoals;m.goalsAgainst=g.awayGoals}
      else{m.goalsFor=g.awayGoals;m.goalsAgainst=g.homeGoals}
    }
  }
}

async function getSession(){if(!supabaseClient)return null;const {data,error}=await supabaseClient.auth.getSession();if(error)throw error;return data.session}
function withUser(payload,userId){const {updated_at,version,deleted_at,...clean}=payload||{};return {...clean,user_id:userId,device_id:deviceId,deleted_at:null}}
async function fetchRemoteRow(op,userId){
  const {data,error}=await supabaseClient.from(op.table).select('*').eq('id',op.recordId).maybeSingle();
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
    if(table==='league_games') db.leagueGames=(db.leagueGames||[]).filter(g=>g.id!==row.id);
    return;
  }
  if(table==='players'){
    const x={id:row.id,name:row.name,number:row.number??'',position:row.position||''}; const i=db.players.findIndex(p=>p.id===row.id); i>=0?db.players[i]=x:db.players.push(x);
  } else if(table==='matches'){
    const old=db.matches.find(m=>m.id===row.id); const x={id:row.id,date:row.match_date||'',type:row.match_type||'league',homeAway:row.home_away||'home',opponent:row.opponent||'',goalsFor:row.team_goals,goalsAgainst:row.opponent_goals,matchday:row.matchday??old?.matchday??null,imported:row.imported??old?.imported??false,events:old?.events||[]};
    const i=db.matches.findIndex(m=>m.id===row.id); i>=0?db.matches[i]=x:db.matches.push(x);
  } else if(table==='teams'){
    const oldName=Object.keys(db.teamIds).find(k=>db.teamIds[k]===row.id); if(oldName && oldName!==row.name){db.league=db.league.map(n=>n===oldName?row.name:n);delete db.teamIds[oldName]}
    db.teamIds[row.name]=row.id;if(!db.league.includes(row.name))db.league.push(row.name);
    db.league.sort((a,b)=>(db.meta.teams[db.teamIds[a]]?.sort_order??999)-(db.meta.teams[db.teamIds[b]]?.sort_order??999));
  } else if(table==='appearances'||table==='goals'){
    const m=db.matches.find(x=>x.id===row.match_id); if(m){m.events=m.events||[];const type=table==='goals'?'goal':'app';const e={id:row.id,playerId:row.player_id,type};const i=m.events.findIndex(x=>x.id===row.id);i>=0?m.events[i]=e:m.events.push(e)}
  } else if(table==='league_games'){
    const x={id:row.id,fixtureKey:row.fixture_key,matchday:row.matchday,date:row.match_date||'',home:row.home_team,away:row.away_team,homeGoals:row.home_goals,awayGoals:row.away_goals};
    const byId=db.leagueGames.findIndex(g=>g.id===row.id),byKey=db.leagueGames.findIndex(g=>g.fixtureKey===row.fixture_key);
    if(byId>=0)db.leagueGames[byId]=x;else if(byKey>=0)db.leagueGames[byKey]=x;else db.leagueGames.push(x);
    reconcileJfvResults();
  }
}

async function guardedUpdate(op,userId,changes,expectedVersion){
  let q=supabaseClient.from(op.table).update(changes).eq('id',op.recordId);
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
    const {data,error}=await supabaseClient.from(op.table).insert(row).select('*').single();
    if(error){
      // A concurrent insert with the same id may have won between fetch and insert.
      const latest=await fetchRemoteRow(op,userId).catch(()=>null);
      if(latest){recordConflict(op,latest,'race_during_insert');await applyRemoteToLocal(op.table,latest);return 'drop';}
      throw error;
    }
    await applyRemoteToLocal(op.table,data);return 'drop';
  }

  const {user_id,...updateRow}=row;
  const written=await guardedUpdate(op,userId,updateRow,baseVersion);
  if(!written){
    const latest=await fetchRemoteRow(op,userId);recordConflict(op,latest,'race_during_update');if(latest)await applyRemoteToLocal(op.table,latest);return 'drop';
  }
  await applyRemoteToLocal(op.table,written);return 'drop';
}

async function pullTable(table,userId){
  const {data,error}=await supabaseClient.from(table).select('*');
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
  const up={teams:10,players:20,matches:30,league_games:35,appearances:40,goals:40};
  const del={appearances:10,goals:10,league_games:15,matches:20,players:20,teams:30};
  return (op.action==='delete'?del:up)[op.table]||99;
}
async function syncAll(){
  if(syncing)return;
  if(!supabaseClient){setSyncStatus('Supabase nicht konfiguriert');return}
  if(!navigator.onLine){setSyncStatus(`Offline · ${queue.length} Änderung${queue.length===1?'':'en'} wartet`);return}
  let session;try{session=await getSession()}catch(e){console.error(e);setSyncStatus('Verbindung fehlgeschlagen');return}
  if(!session){setSyncStatus('Bitte anmelden');return}
  if(ownerKey!=='shared') switchUserContext(session.user);
  syncing=true;setSyncStatus(`Synchronisiere · ${queue.length} offen`);
  try{
    queue.sort((a,b)=>queuePriority(a)-queuePriority(b));
    for(const op of [...queue]){
      try{await pushOperation(op,session.user.id);queue=queue.filter(q=>q.id!==op.id);persist()}
      catch(e){op.attempts=(op.attempts||0)+1;op.lastError=e.message;persist();throw e}
    }
    for(const table of ['teams','players','matches','league_games','appearances','goals']) await pullTable(table,session.user.id);
    ensureLeagueData(true);
    persist();render();setSyncStatus(conflicts.length?`✓ Synchronisiert · ${conflicts.length} Konflikt${conflicts.length===1?'':'e'}`:'✓ Synchronisiert');
  }catch(e){console.error('sync',e);setSyncStatus(`Sync pausiert · ${queue.length} Änderung${queue.length===1?'':'en'} lokal`)}finally{syncing=false}
}

function switchUserContext(user){
  currentUserId=user?.id||null;currentUserEmail=user?.email||'';
  if(currentUserId){
    // All authenticated team members work on one shared local cache. On first use,
    // carry over this account's previous per-user cache so an update loses nothing.
    const sharedKey=nsKey(DATA_PREFIX,'shared');
    const oldUserKey=nsKey(DATA_PREFIX,currentUserId);
    if(!localStorage.getItem(sharedKey) && localStorage.getItem(oldUserKey)){
      localStorage.setItem(sharedKey,localStorage.getItem(oldUserKey));
      const oq=localStorage.getItem(nsKey(QUEUE_PREFIX,currentUserId));if(oq)localStorage.setItem(nsKey(QUEUE_PREFIX,'shared'),oq);
      const oc=localStorage.getItem(nsKey(CONFLICT_PREFIX,currentUserId));if(oc)localStorage.setItem(nsKey(CONFLICT_PREFIX,'shared'),oc);
    }
    loadNamespace('shared');
  } else loadNamespace('guest');
  render();
}
async function initialPull(){
  if(!supabaseClient)return;
  let session=await getSession();
  if(!session){switchUserContext(null);ensureLeagueData(false);setSyncStatus('Bitte anmelden');render();return}
  switchUserContext(session.user);
  setSyncStatus('Lade Teamdaten …');
  try{
    for(const table of ['teams','players','matches','league_games','appearances','goals']) await pullTable(table,session.user.id);
    ensureLeagueData(true);
    await syncAll();
  }catch(e){console.error(e);ensureLeagueData(false);setSyncStatus('Offline · lokaler Stand aktiv');render()}
}

async function openLogin(){
  if(!supabaseClient)return alert('Bitte zuerst supabase-config.js mit Project URL und Publishable Key ausfüllen.');
  const session=await getSession().catch(()=>null);
  if(session){
    openModal(`<h2>Angemeldet</h2><div class="card"><b>${esc(session.user.email||'Benutzer')}</b><div class="sub">Du arbeitest am gemeinsamen JFV-Teamdatenbestand.</div></div><div class="actions"><button class="secondary" onclick="syncAll()">Jetzt synchronisieren</button><button class="danger" onclick="logout()">Abmelden</button><button onclick="closeModal()">Schließen</button></div>`);return;
  }
  openModal(`<h2>Anmelden</h2><label>E-Mail</label><input id="loginEmail" type="email" autocomplete="email"><label>Passwort</label><input id="loginPassword" type="password" autocomplete="current-password"><div class="actions" style="margin-top:15px"><button class="primary" onclick="login()">Anmelden</button><button onclick="closeModal()">Abbrechen</button></div><div class="sub" style="margin-top:12px">Teamkonten werden zentral angelegt. Ohne Anmeldung bleibt die App nur lokal nutzbar.</div>`)
}
async function login(){
  const email=document.getElementById('loginEmail').value.trim(),password=document.getElementById('loginPassword').value;
  const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});if(error)return alert(error.message);
  closeModal();switchUserContext(data.user);await syncAll();
}
async function signup(){
  const email=document.getElementById('loginEmail').value.trim(),password=document.getElementById('loginPassword').value;
  if(!email||password.length<6)return alert('Bitte E-Mail und ein Passwort mit mindestens 6 Zeichen eingeben.');
  const {data,error}=await supabaseClient.auth.signUp({email,password,options:{data:{display_name:email.split('@')[0]}}});if(error)return alert(error.message);
  if(data.session){closeModal();switchUserContext(data.user);await syncAll()}else alert('Konto angelegt. Falls E-Mail-Bestätigung aktiviert ist, bestätige zuerst die Nachricht von Supabase und melde dich danach an.');
}
async function logout(){
  if(supabaseClient) await supabaseClient.auth.signOut();
  switchUserContext(null);setSyncStatus('Abgemeldet · Gastmodus');closeModal();
}
function importGuestData(){
  if(!currentUserId)return alert('Bitte zuerst anmelden.');
  const raw=localStorage.getItem(nsKey(DATA_PREFIX,'guest'));if(!raw)return alert('Keine Gastdaten gefunden.');
  let guest;try{guest=JSON.parse(raw)}catch{return alert('Gastdaten sind nicht lesbar.');}
  normalizeLocal(guest);if(!hasMeaningfulData(guest))return alert('Keine relevanten Gastdaten vorhanden.');
  if(!confirm('Gastdaten in den gemeinsamen Teamdatenbestand übernehmen? Der lokale Stand wird dabei als Änderungen synchronisiert.'))return;
  db=guest;db.meta=clone(initial.meta);normalizeLocal(db);queue=[];conflicts=[];
  touchAllTeams();db.players.forEach(touchPlayer);db.matches.forEach(touchMatch);(db.leagueGames||[]).forEach(touchLeagueGame);persist();render();scheduleSync();closeModal();
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
  else if(table==='matches'){const old=db.matches.find(v=>v.id===p.id);const x={id:p.id,date:p.match_date||'',type:p.match_type||'league',homeAway:p.home_away||'home',opponent:p.opponent||'',goalsFor:p.team_goals,goalsAgainst:p.opponent_goals,matchday:p.matchday??old?.matchday??null,imported:p.imported??old?.imported??false,events:old?.events||[]};const i=db.matches.findIndex(v=>v.id===p.id);i>=0?db.matches[i]=x:db.matches.push(x)}
  else if(table==='teams'){const old=Object.keys(db.teamIds).find(k=>db.teamIds[k]===p.id);if(old&&old!==p.name){db.league=db.league.map(n=>n===old?p.name:n);delete db.teamIds[old]}db.teamIds[p.name]=p.id;if(!db.league.includes(p.name))db.league.push(p.name)}
  else if(table==='appearances'||table==='goals'){const m=db.matches.find(v=>v.id===p.match_id);if(m){m.events=m.events||[];const e={id:p.id,playerId:p.player_id,type:table==='goals'?'goal':'app'};const i=m.events.findIndex(v=>v.id===p.id);i>=0?m.events[i]=e:m.events.push(e)}}
  else if(table==='league_games'){const x={id:p.id,fixtureKey:p.fixture_key,matchday:p.matchday,date:p.match_date||'',home:p.home_team,away:p.away_team,homeGoals:p.home_goals,awayGoals:p.away_goals};const i=db.leagueGames.findIndex(v=>v.id===p.id||v.fixtureKey===p.fixture_key);i>=0?db.leagueGames[i]=x:db.leagueGames.push(x);reconcileJfvResults()}
}
window.addEventListener('online',()=>{setSyncStatus('Online · synchronisiere …');syncAll()});
window.addEventListener('offline',()=>setSyncStatus(`Offline · ${queue.length} Änderung${queue.length===1?'':'en'} wartet`));

function showPage(p){document.querySelectorAll('main>section').forEach(x=>x.classList.add('hidden'));const sec=document.getElementById(p);if(sec)sec.classList.remove('hidden');document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===p));render()}
function dateDE(d){return d?new Date(d+'T12:00').toLocaleDateString('de-DE'):'–'}
function typeName(t){return t==='league'?'Liga':t==='cup'?'Pokal':'Test'}
function render(){document.getElementById('teamName').textContent=db.teamName;const s=document.getElementById('seasonText');s.firstChild.textContent='Saison '+db.season+' · ';renderDash();renderPlayers();renderMatches();renderScorers();renderLeague()}
function stats(){let goals=0;db.matches.forEach(m=>(m.events||[]).forEach(e=>{if(e.type==='goal')goals++}));return{players:db.players.length,matches:db.matches.filter(m=>m.goalsFor!=null&&m.goalsAgainst!=null).length,goals}}
function renderDash(){
  let s=stats(),today=new Date().toISOString().slice(0,10);
  let upcoming=[...db.matches].filter(m=>(m.date||'')>=today&&(m.goalsFor==null||m.goalsAgainst==null)).sort((a,b)=>(a.date||'').localeCompare(b.date||''))[0];
  let recent=[...db.matches].filter(m=>m.goalsFor!=null&&m.goalsAgainst!=null).sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,4);
  const nextHtml=upcoming?`<div class="item"><div class="match-title"><span>${esc(upcoming.opponent||'Unbekannt')}</span><span class="pill">${upcoming.homeAway==='away'?'Auswärts':'Heim'}</span></div><div class="fixture-meta"><span>${typeName(upcoming.type)}${upcoming.matchday?' · '+upcoming.matchday+'. Spieltag':''}</span><span>· ${dateDE(upcoming.date)}</span></div><div class="actions" style="margin-top:8px;justify-content:flex-end"><button class="secondary" onclick="openMatch('${upcoming.id}')">Details</button></div></div>`:'<div class="empty">Kein weiteres Spiel geplant.</div>';
  document.getElementById('dashboard').innerHTML=`<h1>Übersicht</h1><div class="grid grid3"><div class="card"><div class="stat">${s.players}</div><div class="label">Spieler</div></div><div class="card"><div class="stat">${s.matches}</div><div class="label">gespielt</div></div><div class="card"><div class="stat">${s.goals}</div><div class="label">Tore</div></div></div><div class="card"><div class="row"><div><h2>Offline-First</h2><div class="sub">${queue.length} lokale Änderung${queue.length===1?'':'en'} in der Warteschlange.</div></div><button class="primary" onclick="openMatch()">+ Spiel</button></div></div><div class="card"><h2>Nächstes Spiel</h2>${nextHtml}</div><div class="card"><h2>Letzte Spiele</h2>${recent.length?'<div class="list">'+recent.map(matchHTML).join('')+'</div>':'<div class="empty">Noch kein Ergebnis eingetragen.</div>'}</div>`;
}
function playerStats(p){let a=0,g=0;db.matches.forEach(m=>{const ev=m.events||[];if(ev.some(e=>e.playerId===p.id&&e.type==='app'))a++;g+=ev.filter(e=>e.playerId===p.id&&e.type==='goal').length});return{a,g}}
function renderPlayers(){let rows=db.players.map(p=>({p,...playerStats(p)})).sort((x,y)=>(parseInt(x.p.number)||999)-(parseInt(y.p.number)||999)||x.p.name.localeCompare(y.p.name,'de'));document.getElementById('players').innerHTML=`<div class="row"><div><h1>Spieler</h1><div class="sub">${db.players.length} Kaderplätze · nach Rückennummer sortiert</div></div><button class="primary" onclick="openPlayer()">+ Spieler</button></div><div class="card">${rows.length?'<div class="list">'+rows.map(x=>`<div class="item player"><div class="numberball">${esc(x.p.number||'–')}</div><div class="grow"><b class="truncate">${esc(x.p.number||'–')} · ${esc(x.p.name)}</b><div class="sub">${esc(x.p.position||'Keine Position')}</div><div class="sub">${x.a} Einsätze · ${x.g} Tore</div></div><button class="secondary" onclick="openPlayer('${x.p.id}')">Bearbeiten</button></div>`).join('')+'</div>':'<div class="empty">Lege den ersten Spieler an.</div>'}</div>`}
function matchHTML(m){let result=m.goalsFor!=null&&m.goalsAgainst!=null?`${m.goalsFor}:${m.goalsAgainst}`:'–';let scorers=[];db.players.forEach(p=>{let n=(m.events||[]).filter(e=>e.type==='goal'&&e.playerId===p.id).length;if(n)scorers.push(`${p.name}${n>1?' ('+n+')':''}`)});return `<div class="item"><div class="match-title"><span>${esc(m.opponent||'Unbekannt')}</span><span class="score">${result}</span></div><div class="fixture-meta"><span>${typeName(m.type)}${m.matchday?' · '+m.matchday+'. Spieltag':''}</span><span>· ${dateDE(m.date)}</span>${m.type==='league'?`<span>· ${m.homeAway==='away'?'Auswärts':'Heim'}</span>`:''}</div><div class="scorers">${scorers.length?'Tore JFV: '+esc(scorers.join(', ')):'Keine Torschützen erfasst'}</div><div class="actions" style="margin-top:8px;justify-content:flex-end"><button class="secondary" onclick="openMatch('${m.id}')">Details</button></div></div>`}
function renderMatches(){let types=['all','league','cup','test'],active=window.mtfilter||'all',arr=[...db.matches].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).filter(m=>active==='all'||m.type===active);document.getElementById('matches').innerHTML=`<div class="row"><div><h1>Spiele</h1><div class="sub">Liga, Pokal und Tests</div></div><button class="primary" onclick="openMatch()">+ Spiel</button></div><div class="tabs">${types.map(t=>`<button class="${active===t?'on':''}" onclick="window.mtfilter='${t}';renderMatches()">${t==='all'?'Alle':t==='league'?'Liga':t==='cup'?'Pokal':'Tests'}</button>`).join('')}</div><div class="card">${arr.length?'<div class="list">'+arr.map(matchHTML).join('')+'</div>':'<div class="empty">Keine Spiele in dieser Kategorie.</div>'}</div>`}
function renderScorers(){let rows=db.players.map(p=>({p,...playerStats(p)})).filter(x=>x.g>0).sort((x,y)=>y.g-x.g||x.a-y.a||(parseInt(x.p.number)||999)-(parseInt(y.p.number)||999));document.getElementById('scorers').innerHTML=`<h1>Torschützen</h1><div class="sub" style="margin:-10px 0 14px">Bei gleicher Torzahl steht der Spieler mit weniger Einsätzen weiter oben.</div><div class="card">${rows.length?'<div class="list">'+rows.map((x,i)=>`<div class="item player"><div class="rank">${i+1}.</div><div class="numberball">${esc(x.p.number||'–')}</div><div class="grow"><b>${esc(x.p.name)}</b><div class="sub">${x.a} Einsätze</div></div><div class="score">${x.g} ⚽</div></div>`).join('')+'</div>':'<div class="empty">Noch keine Torschützen erfasst.</div>'}</div>`}
function leagueStandings(){let rows=TEAMS.map(team=>({team,sp:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0})),by=Object.fromEntries(rows.map(r=>[r.team,r]));(db.leagueGames||[]).filter(g=>g.homeGoals!=null&&g.awayGoals!=null).forEach(g=>{let h=by[g.home],a=by[g.away];if(!h||!a)return;let hg=+g.homeGoals,ag=+g.awayGoals;h.sp++;a.sp++;h.gf+=hg;h.ga+=ag;a.gf+=ag;a.ga+=hg;if(hg>ag){h.w++;a.l++;h.pts+=3}else if(hg<ag){a.w++;h.l++;a.pts+=3}else{h.d++;a.d++;h.pts++;a.pts++}});rows.forEach(r=>r.gd=r.gf-r.ga);return rows.sort((a,b)=>b.pts-a.pts||b.gd-a.gd||b.gf-a.gf||a.team.localeCompare(b.team,'de'))}
function saveLeagueResult(id){let g=db.leagueGames.find(x=>x.id===id);if(!g)return;let hi=document.getElementById('lh'+id),ai=document.getElementById('la'+id);g.homeGoals=hi.value===''?null:+hi.value;g.awayGoals=ai.value===''?null:+ai.value;touchLeagueGame(g);const isJfv=g.home==='JFV Neuseenland'||g.away==='JFV Neuseenland';if(isJfv){let m=db.matches.find(x=>x.type==='league'&&x.matchday===g.matchday);if(m){if(g.home==='JFV Neuseenland'){m.goalsFor=g.homeGoals;m.goalsAgainst=g.awayGoals}else{m.goalsFor=g.awayGoals;m.goalsAgainst=g.homeGoals}touchMatch(m)}}save()}
function clearLeagueResult(id){let g=db.leagueGames.find(x=>x.id===id);if(!g)return;g.homeGoals=null;g.awayGoals=null;touchLeagueGame(g);if(g.home==='JFV Neuseenland'||g.away==='JFV Neuseenland'){let m=db.matches.find(x=>x.type==='league'&&x.matchday===g.matchday);if(m){m.goalsFor=null;m.goalsAgainst=null;touchMatch(m)}}save()}
function renderLeague(){let tab=window.lt||'table';let md=window.lmd||1;let standings=leagueStandings(),games=(db.leagueGames||[]).filter(g=>g.matchday===md);let tableHtml=`<div class="league-table-wrap"><table class="league-table"><thead><tr><th>Pl.</th><th>Mannschaft</th><th>Sp.</th><th>Tore</th><th>Diff.</th><th>Pkt.</th></tr></thead><tbody>${standings.map((r,i)=>`<tr class="${r.team==='JFV Neuseenland'?'mine':''}"><td>${i+1}</td><td>${esc(r.team)}</td><td>${r.sp}</td><td>${r.gf}:${r.ga}</td><td>${r.gd>0?'+':''}${r.gd}</td><td><b>${r.pts}</b></td></tr>`).join('')}</tbody></table></div><div class="sub" style="margin-top:10px">Sortierung: Punkte, Tordifferenz, erzielte Tore.</div>`;let scheduleHtml=`<div class="tabs league-round-tabs">${Array.from({length:22},(_,i)=>`<button class="${md===i+1?'on':''}" onclick="window.lmd=${i+1};renderLeague()">${i+1}.</button>`).join('')}</div><div class="round-head">${md}. Spieltag · ${dateDE(FIXTURES.find(x=>x[3]===md)?.[0]||'')}</div><div class="list">${games.map(g=>`<div class="item"><div class="league-score"><div class="teams"><b>${esc(g.home)} – ${esc(g.away)}</b></div><input id="lh${g.id}" type="number" min="0" inputmode="numeric" value="${g.homeGoals??''}" aria-label="Tore ${esc(g.home)}"><span class="score-dash">:</span><input id="la${g.id}" type="number" min="0" inputmode="numeric" value="${g.awayGoals??''}" aria-label="Tore ${esc(g.away)}"></div><div class="actions" style="margin-top:8px;justify-content:flex-end"><button class="secondary" onclick="saveLeagueResult('${g.id}')">Ergebnis speichern</button>${g.homeGoals!=null||g.awayGoals!=null?`<button class="danger" onclick="clearLeagueResult('${g.id}')">Löschen</button>`:''}</div></div>`).join('')}</div>`;document.getElementById('league').innerHTML=`<h1>Liga</h1><div class="tabs"><button class="${tab==='table'?'on':''}" onclick="window.lt='table';renderLeague()">Tabelle</button><button class="${tab==='schedule'?'on':''}" onclick="window.lt='schedule';renderLeague()">Spieltage</button><button class="${tab==='teams'?'on':''}" onclick="window.lt='teams';renderLeague()">Teams</button></div><div class="card">${tab==='table'?tableHtml:tab==='schedule'?scheduleHtml:`<div class="list">${TEAMS.map((x,i)=>`<div class="item"><b>${i+1}. ${esc(x)}</b></div>`).join('')}</div>`}</div><div class="sub">Spielplanbasis: FUSSBALL.DE · Sachsenliga B-Junioren 2026/27.</div>`}

function openModal(html){document.getElementById('sheet').innerHTML=html;document.getElementById('modal').classList.remove('hidden')}function closeModal(){document.getElementById('modal').classList.add('hidden')}
function openSettings(){
  let guestHas=false;try{const g=JSON.parse(localStorage.getItem(nsKey(DATA_PREFIX,'guest'))||'null');guestHas=g&&hasMeaningfulData(g)}catch{}
  const account=currentUserId?`<div class="card"><b>${esc(currentUserEmail||'Angemeldet')}</b><div class="sub">Gemeinsamer Teamdatenbestand · individuelles Konto</div></div>`:`<div class="card"><b>Gastmodus</b><div class="sub">Daten bleiben nur auf diesem Gerät, bis du dich anmeldest.</div></div>`;
  openModal(`<h2>Einstellungen</h2>${account}<label>Teamname</label><input id="sname" value="${esc(db.teamName)}"><label>Saison</label><input id="sseason" value="${esc(db.season)}"><div class="sub" style="margin-top:12px">Queue: ${queue.length} · Konflikte: ${conflicts.length} · Gerät: ${esc(deviceId.slice(0,8))}</div><div class="actions" style="margin-top:15px"><button class="primary" onclick="saveSettings()">Speichern</button><button class="secondary" onclick="syncAll()">Jetzt synchronisieren</button><button class="secondary" onclick="showConflicts()">Konflikte</button>${currentUserId&&guestHas?`<button class="secondary" onclick="importGuestData()">Gastdaten übernehmen</button>`:''}${currentUserId?`<button class="danger" onclick="logout()">Abmelden</button>`:`<button class="secondary" onclick="openLogin()">Anmelden</button>`}</div>`)
}
function saveSettings(){db.teamName=document.getElementById('sname').value||'JFV Neuseenland';db.season=document.getElementById('sseason').value||'';save();closeModal()}
function showConflicts(){
  openModal(`<h2>Synchronisationskonflikte</h2><div class="sub" style="margin-bottom:12px">Bei einem Versionskonflikt bleibt standardmäßig der Serverstand aktiv. Die verworfene lokale Änderung bleibt hier erhalten und kann bewusst erneut angewendet werden.</div>${conflicts.length?'<div class="list">'+conflicts.map(c=>`<div class="item"><b>${esc(c.table)} · Version ${c.baseVersion} → ${c.remote?.version??'–'}</b><div class="sub">${new Date(c.at).toLocaleString('de-DE')} · ${esc(c.reason||'Konflikt')}</div><div class="actions" style="margin-top:8px"><button class="secondary" onclick="restoreConflict('${c.id}')">Lokale Änderung erneut anwenden</button></div></div>`).join('')+'</div>':'<div class="empty">Keine Konflikte protokolliert.</div>'}<div class="actions" style="margin-top:15px"><button class="secondary" onclick="conflicts=[];persist();openSettings()">Protokoll leeren</button><button onclick="closeModal()">Schließen</button></div>`)
}
function openPlayer(id){let p=db.players.find(x=>x.id===id)||{id:crypto.randomUUID(),name:'',position:'',number:''};openModal(`<h2>${id?'Spieler bearbeiten':'Neuer Spieler'}</h2><label>Name</label><input id="pn" value="${esc(p.name)}" placeholder="Vor- und Nachname"><div class="formgrid"><div><label>Nummer</label><input id="pno" inputmode="numeric" value="${esc(p.number)}"></div><div><label>Position</label><select id="pp">${['Torwart','Abwehr','Mittelfeld','Angriff'].map(x=>`<option ${p.position===x?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="actions" style="margin-top:15px"><button class="primary" onclick="savePlayer('${p.id}')">Speichern</button>${id?`<button class="danger" onclick="deletePlayer('${p.id}')">Löschen</button>`:''}<button onclick="closeModal()">Abbrechen</button></div>`)}
function savePlayer(id){let name=document.getElementById('pn').value.trim();if(!name)return alert('Bitte einen Namen eingeben.');let p=db.players.find(x=>x.id===id);if(p){p.name=name;p.number=document.getElementById('pno').value;p.position=document.getElementById('pp').value}else{p={id,name,number:document.getElementById('pno').value,position:document.getElementById('pp').value};db.players.push(p)}touchPlayer(p);save();closeModal()}
function deletePlayer(id){if(!confirm('Spieler löschen?'))return;db.players=db.players.filter(p=>p.id!==id);db.matches.forEach(m=>{for(const e of (m.events||[]).filter(e=>e.playerId===id))enqueue(e.type==='goal'?'goals':'appearances','delete',e.id);m.events=(m.events||[]).filter(e=>e.playerId!==id)});enqueue('players','delete',id);save();closeModal()}
let draftEvents=null;
function openMatch(id){
  let existing=db.matches.find(x=>x.id===id);
  let m=existing||{id:crypto.randomUUID(),date:new Date().toISOString().slice(0,10),type:'test',opponent:'',homeAway:'home',matchday:null,goalsFor:null,goalsAgainst:null,events:[],imported:false};
  draftEvents=clone(m.events||[]);
  const sorted=[...db.players].sort((a,b)=>(parseInt(a.number)||999)-(parseInt(b.number)||999)||a.name.localeCompare(b.name,'de'));
  openModal(`<h2>${id?'Spiel bearbeiten':'Neues Spiel'}</h2><div class="formgrid"><div><label>Datum</label><input id="md" type="date" value="${m.date||''}"></div><div><label>Art</label><select id="mtype"><option value="league" ${m.type==='league'?'selected':''}>Liga</option><option value="cup" ${m.type==='cup'?'selected':''}>Pokal</option><option value="test" ${m.type==='test'?'selected':''}>Test</option></select></div><div class="full"><label>Gegner</label><input id="mo" value="${esc(m.opponent)}"></div><div><label>Eigene Tore</label><input id="gf" type="number" min="0" inputmode="numeric" value="${m.goalsFor??''}"></div><div><label>Gegentore</label><input id="ga" type="number" min="0" inputmode="numeric" value="${m.goalsAgainst??''}"></div><div class="full"><label>Spielort</label><select id="mhome"><option value="home" ${m.homeAway!=='away'?'selected':''}>Heim</option><option value="away" ${m.homeAway==='away'?'selected':''}>Auswärts</option></select></div></div><label>Spieler-Einsätze und Tore</label><div class="list" id="eventList">${sorted.length?sorted.map(p=>playerEventRow(p)).join(''):'<div class="empty">Erst Spieler anlegen.</div>'}</div><div class="actions" style="margin-top:15px"><button class="primary" onclick="saveMatch('${m.id}',${!!existing},${m.matchday??'null'},${!!m.imported})">Speichern</button>${existing&&!m.imported?`<button class="danger" onclick="deleteMatch('${m.id}')">Löschen</button>`:''}<button onclick="closeModal()">Abbrechen</button></div>`)
}
function playerEventRow(p){let app=(draftEvents||[]).some(e=>e.playerId===p.id&&e.type==='app'),goals=(draftEvents||[]).filter(e=>e.playerId===p.id&&e.type==='goal').length;return `<div class="item row"><div class="grow"><b>${esc(p.number||'–')} · ${esc(p.name)}</b><div class="sub">${esc(p.position||'')}</div></div><button class="secondary" onclick="toggleDraftApp('${p.id}')">${app?'✓ Einsatz':'+ Einsatz'}</button><div class="goal-controls"><button class="secondary" onclick="addDraftGoal('${p.id}')">+ ⚽</button><span class="goal-count">${goals}</span>${goals?`<button class="danger" onclick="resetDraftGoals('${p.id}')">↺</button>`:''}</div></div>`}
function refreshEventRows(){const el=document.getElementById('eventList');if(el)el.innerHTML=[...db.players].sort((a,b)=>(parseInt(a.number)||999)-(parseInt(b.number)||999)||a.name.localeCompare(b.name,'de')).map(p=>playerEventRow(p)).join('')||'<div class="empty">Erst Spieler anlegen.</div>'}
function toggleDraftApp(pid){let i=draftEvents.findIndex(e=>e.playerId===pid&&e.type==='app');i>=0?draftEvents.splice(i,1):draftEvents.push({id:crypto.randomUUID(),playerId:pid,type:'app'});refreshEventRows()}
function addDraftGoal(pid){if(!draftEvents.some(e=>e.playerId===pid&&e.type==='app'))draftEvents.push({id:crypto.randomUUID(),playerId:pid,type:'app'});draftEvents.push({id:crypto.randomUUID(),playerId:pid,type:'goal'});refreshEventRows()}
function resetDraftGoals(pid){draftEvents=draftEvents.filter(e=>!(e.playerId===pid&&e.type==='goal'));refreshEventRows()}
function saveMatch(id,exists,matchday,imported){
  let m=db.matches.find(x=>x.id===id);
  const oldEvents=clone(m?.events||[]);
  let data={id,date:document.getElementById('md').value,type:document.getElementById('mtype').value,opponent:document.getElementById('mo').value.trim()||'Unbekannt',homeAway:document.getElementById('mhome').value,matchday,imported,goalsFor:document.getElementById('gf').value===''?null:+document.getElementById('gf').value,goalsAgainst:document.getElementById('ga').value===''?null:+document.getElementById('ga').value,events:draftEvents||[]};
  if(m)Object.assign(m,data);else{m=data;db.matches.push(m)}
  const newIds=new Set((m.events||[]).map(e=>e.id));oldEvents.filter(e=>!newIds.has(e.id)).forEach(e=>enqueue(e.type==='goal'?'goals':'appearances','delete',e.id));
  touchMatch(m);
  if(data.type==='league'&&data.matchday){
    let g=db.leagueGames.find(x=>x.matchday===data.matchday&&(x.home==='JFV Neuseenland'||x.away==='JFV Neuseenland'));
    if(g){if(g.home==='JFV Neuseenland'){g.homeGoals=data.goalsFor;g.awayGoals=data.goalsAgainst}else{g.homeGoals=data.goalsAgainst;g.awayGoals=data.goalsFor}touchLeagueGame(g)}
  }
  save();closeModal()
}
function deleteMatch(id){if(!confirm('Spiel löschen?'))return;let m=db.matches.find(x=>x.id===id);(m?.events||[]).forEach(e=>enqueue(e.type==='goal'?'goals':'appearances','delete',e.id));db.matches=db.matches.filter(x=>x.id!==id);enqueue('matches','delete',id);save();closeModal()}

function editTeam(i){openModal(`<h2>Ligateam bearbeiten</h2><label>Teamname</label><input id="tn" value="${esc(db.league[i])}"><div class="actions" style="margin-top:15px"><button class="primary" onclick="saveTeam(${i})">Speichern</button><button onclick="closeModal()">Abbrechen</button></div>`)}
function saveTeam(i){const old=db.league[i],name=document.getElementById('tn').value.trim()||`Team ${i+1}`,id=db.teamIds[old]||crypto.randomUUID();db.league[i]=name;delete db.teamIds[old];db.teamIds[name]=id;enqueue('teams','upsert',id,{id,name,sort_order:i});save();closeModal()}

ensureLeagueData(false);
render();
(async()=>{
  if(!supabaseClient){setSyncStatus('Supabase nicht konfiguriert');return}
  supabaseClient.auth.onAuthStateChange((_event,session)=>{
    setTimeout(()=>{
      if(session){if(ownerKey!=='shared')switchUserContext(session.user);syncAll()}
      else {if(ownerKey!=='guest')switchUserContext(null);ensureLeagueData(false);setSyncStatus('Bitte anmelden');render()}
    },0)
  });
  await initialPull();
})();
