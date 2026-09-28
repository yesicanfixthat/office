/* Fix That Office: hosted bridge.
   Gives the Office the same storage calls it uses inside Claude, backed by Supabase:
   login by emailed link, database tables, live updates, private file storage, downloads. */
(function(){
  const SUPABASE_URL="https://yhcinsqiqernsqussjgb.supabase.co";
  const SUPABASE_KEY="sb_publishable_CGRtG8cY_M8vEnnJOSX_Cg_z3jUVkCD";
  const BUCKET="office-files";
  const TABLES=["customers","leads","quotes","jobs","expenses","settings","meta"];

  const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:"pkce"}});
  window.__sb=sb;

  /* ---------- Login ---------- */
  let resolveAuth;const authReady=new Promise(r=>resolveAuth=r);
  const gate=document.createElement("div");gate.id="authGate";
  gate.innerHTML=`<div class="ag-box"><img src="logo.png" alt="Yes, I Can Fix That" class="ag-logo"><h1>Office sign in</h1>
    <p class="ag-p">Enter your email and we'll send you a sign-in link.</p>
    <form id="agForm"><input type="email" id="agEmail" required placeholder="you@example.com" autocomplete="email"><button type="submit" class="btn primary block">Email me a sign-in link</button></form>
    <p id="agMsg" class="ag-msg" role="status"></p></div>`;
  const css=document.createElement("style");css.textContent=`#authGate{position:fixed;inset:0;z-index:9999;background:var(--bg,#F2F4F8);display:flex;align-items:center;justify-content:center;padding:16px}
  #authGate[hidden]{display:none!important}.ag-box{background:var(--surface,#fff);border:1px solid var(--line,#DCE2EA);border-radius:12px;padding:28px;max-width:380px;width:100%;text-align:center}
  .ag-logo{width:220px;max-width:80%;height:auto;margin:0 auto 12px;display:block}.ag-box h1{font-family:"Barlow Condensed",sans-serif;text-transform:uppercase;font-size:30px;margin:0 0 6px;color:var(--ink,#15233A)}
  .ag-p{color:var(--muted,#5A6576);margin:0 0 14px}.ag-box input{width:100%;margin-bottom:10px;padding:10px;border:1px solid var(--line,#DCE2EA);border-radius:6px;font-size:16px}
  .ag-msg{margin-top:12px;font-weight:600;color:var(--navy,#1F4575)}.ag-msg.bad{color:#B42318}
  .signout{display:block;margin:10px auto 0;background:none;border:0;color:#cfd8e6;font-size:12px;text-decoration:underline;cursor:pointer}`;
  document.head.appendChild(css);
  function showGate(msg,bad){document.body.appendChild(gate);gate.hidden=false;const m=gate.querySelector("#agMsg");m.textContent=msg||"";m.className="ag-msg"+(bad?" bad":"")}
  gate.addEventListener("submit",async e=>{e.preventDefault();const email=gate.querySelector("#agEmail").value.trim().toLowerCase();if(!email)return;
    const btn=gate.querySelector("button");btn.disabled=true;
    const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
    btn.disabled=false;
    if(error)showGate(/rate|seconds/i.test(error.message)?"Too many sign-in emails. Wait a few minutes and try again.":"Couldn't send the link: "+error.message,true);
    else showGate("Check your email for the sign-in link. Open it on this same device.",false)});

  async function checkStaff(){const {data,error}=await sb.rpc("is_staff");return !error&&data===true}
  (async()=>{
    const {data:{session}}=await sb.auth.getSession();
    if(session){if(await checkStaff()){gate.hidden=true;resolveAuth(session)}else{showGate(`${session.user.email} isn't on the staff list. Ask Shauna to add you.`,true);addSignOut(gate.querySelector(".ag-box"))}}
    else showGate();
  })();
  sb.auth.onAuthStateChange(async(ev,session)=>{if(ev==="SIGNED_IN"&&session){if(await checkStaff()){gate.hidden=true;resolveAuth(session)}else showGate(`${session.user.email} isn't on the staff list. Ask Shauna to add you.`,true)}if(ev==="SIGNED_OUT")location.reload()});
  function addSignOut(where){if(!where||where.querySelector(".signout"))return;const b=document.createElement("button");b.className="signout";b.type="button";b.textContent="Sign out";b.onclick=()=>sb.auth.signOut();where.appendChild(b)}
  authReady.then(s=>{const side=document.querySelector(".side");if(side){const who=document.createElement("div");who.className="brand-sub";who.style.marginTop="12px";who.textContent=s.user.email;side.appendChild(who);addSignOut(side)}});

  /* ---------- Database (same calls the Office already uses) ---------- */
  const errOf=e=>{const c=e&&(e.code||"");const m=(e&&e.message)||"";return {code:/42501|permission|row-level/i.test(c+m)?"invalid_argument":/JWT|auth/i.test(m)?"revoked":"unavailable",message:m}};
  const split=p=>{const i=p.indexOf("/");return [p.slice(0,i),p.slice(i+1)]};
  function tableWatch(table,onRows,onErr){
    const map=new Map();let ready=false;
    const emit=()=>onRows(map);
    sb.from(table).select("id,data").then(({data,error})=>{if(error){onErr&&onErr(errOf(error));return}(data||[]).forEach(r=>map.set(r.id,r.data));ready=true;emit()});
    sb.channel("rt-"+table).on("postgres_changes",{event:"*",schema:"public",table},p=>{
      if(p.eventType==="DELETE"){map.delete(p.old&&p.old.id)}else if(p.new){map.set(p.new.id,p.new.data)}if(ready)emit()}).subscribe();
  }
  const watchers={};
  function watch(table){if(!watchers[table]){const w={subs:[],map:new Map(),loaded:false};watchers[table]=w;tableWatch(table,m=>{w.map=m;w.loaded=true;w.subs.forEach(s=>s.ok(m))},e=>w.subs.forEach(s=>s.err&&s.err(e)))}return watchers[table]}
  const db={
    collection(name){return {onSnapshot(ok,err){const w=watch(name);const f=m=>ok({docs:[...m.entries()].map(([id,d])=>({id,data:()=>d}))});const s={ok:f,err};w.subs.push(s);if(w.loaded)f(w.map);return ()=>{w.subs=w.subs.filter(x=>x!==s)}}}},
    doc(path){const [t,id]=split(path);return {
      async set(data){const {error}=await sb.from(t).upsert({id,data},{onConflict:"id"});if(error)throw errOf(error)},
      async delete(){const {error}=await sb.from(t).delete().eq("id",id);if(error)throw errOf(error)},
      async get(){const {data,error}=await sb.from(t).select("data").eq("id",id).maybeSingle();if(error)throw errOf(error);return {exists:!!data,data:()=>data&&data.data}},
      onSnapshot(ok,err){const w=watch(t);const f=m=>ok({exists:m.has(id),data:()=>m.get(id)});const s={ok:f,err};w.subs.push(s);if(w.loaded)f(w.map);return ()=>{w.subs=w.subs.filter(x=>x!==s)}}}}
  };

  /* ---------- Files (photos and receipts) ---------- */
  const EXT={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","application/pdf":"pdf"};
  const assets={
    async upload(blob,opt){const type=(opt&&opt.type)||blob.type;const id="files/"+(crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random().toString(36).slice(2))+"."+(EXT[type]||"bin");
      const {error}=await sb.storage.from(BUCKET).upload(id,blob,{contentType:type,upsert:false});
      if(error)throw {code:/size|large/i.test(error.message)?"too_large":/mime|type/i.test(error.message)?"unsupported_type":"upstream_error",message:error.message};
      const url=await signOne(id);return {id,url,contentType:type,sizeBytes:blob.size}},
    async delete(id){const {error}=await sb.storage.from(BUCKET).remove([id]);if(error)throw {code:"upstream_error",message:error.message};return {deleted:true}},
    async list(){return {assets:[],usage:{}}}
  };
  const SIGNED={},pending=new Set();let tmr=null;
  async function signOne(id){const {data}=await sb.storage.from(BUCKET).createSignedUrl(id,60*60*8);if(data&&data.signedUrl)SIGNED[id]=data.signedUrl;return SIGNED[id]||""}
  function flushSign(){const ids=[...pending];pending.clear();tmr=null;if(!ids.length)return;
    sb.storage.from(BUCKET).createSignedUrls(ids,60*60*8).then(({data})=>{(data||[]).forEach(x=>{if(x.signedUrl)SIGNED[x.path]=x.signedUrl});if(typeof window.__officeRender==="function")window.__officeRender()})}
  window.__fileUrl=id=>{if(SIGNED[id])return SIGNED[id];pending.add(id);if(!tmr)tmr=setTimeout(flushSign,60);return "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="};

  /* ---------- Downloads ---------- */
  const downloads={async save({filename,data}){const blob=data instanceof Blob?data:new Blob([data]);const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500);return {status:"saved"}}};

  window.claude={use:async name=>{await authReady;if(name==="db")return db;if(name==="assets")return assets;if(name==="downloads")return downloads;return null}};
})();
