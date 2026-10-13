/* KYC Body Merge Hotfix 2026-10-13. Place after the existing app script (before </body>). */
// KYC BODY_MERGE_V1 2026-10-13：補登身體數值只更新有填寫欄位，不可用空白覆蓋原紀錄。
const BODY_BACKUP_KEY='foodlog_body_backups_v1';
function readBodyBackups(){
  try{const v=JSON.parse(localStorage.getItem(BODY_BACKUP_KEY)||'[]');return Array.isArray(v)?v:[];}catch{return []}
}
function backupBodyBeforeChange(record,reason='修改前'){
  if(!record)return;
  try{
    const history=readBodyBackups();
    const original=JSON.parse(JSON.stringify(record));
    const newest=history[0];
    if(newest?.id===String(original.id)&&JSON.stringify(newest.record)===JSON.stringify(original))return;
    history.unshift({savedAt:new Date().toISOString(),reason,id:String(original.id||''),date:original.date,period:original.period||'',record:original});
    localStorage.setItem(BODY_BACKUP_KEY,JSON.stringify(history.slice(0,80)));
  }catch(err){console.warn('身體紀錄備份未能儲存',err)}
}
function bodyValueProvided(v){return v!==null&&v!==undefined&&String(v).trim()!==''}
function mergeBodyMissingFields(target,source){
  let changed=false;
  for(const field of ['weight','fat','systolic','diastolic','pulse']){
    if(!bodyValueProvided(target[field])&&bodyValueProvided(source[field])){
      target[field]=String(source[field]);changed=true;
    }
  }
  if(!bodyValueProvided(target.time)&&bodyValueProvided(source.time)){target.time=source.time;changed=true;}
  return changed;
}
function renderBodyBackups(){
  const el=document.getElementById('bodyBackupList');if(!el)return;
  const history=readBodyBackups();
  el.innerHTML=history.length?history.slice(0,35).map((x,i)=>
    `<div class="item"><div class="small">${esc(x.date||'')} ${esc(x.period||'')} ・備份 ${esc(new Date(x.savedAt).toLocaleString('zh-TW'))}</div>`+
    `<div>${bodyMeasureText(x.record||{})}</div>`+
    `<button class="secondary" type="button" onclick="restoreBodyBackup(${i})">補回缺少的數值</button></div>`
  ).join(''):'<div class="note" style="padding:10px 0">尚無舊版備份；新版本開始修改前會自動保留前一筆數值。</div>';
}
async function restoreBodyBackup(index){
  const old=readBodyBackups()[index];if(!old?.record)return;
  const source=old.record;
  let target=db.body.find(v=>String(v.id)===String(source.id))||db.body.find(v=>v.date===source.date&&(v.period||'')===(source.period||''));
  if(!confirm(`將 ${source.date} ${source.period||''} 備份中的數值補回目前空白欄位？已經有數值的欄位不會被覆蓋。`))return;
  if(!target){db.body.push({...source});}else{
    const before={...target};
    if(!mergeBodyMissingFields(target,source)){alert('目前已沒有空白欄位需要補回，沒有修改資料。');return;}
    backupBodyBeforeChange(before,'備份還原前');
  }
  save();await renderToday();renderHistory();renderStats();renderBodyBackups();
  alert('已補回備份內可恢復的空白數值。');
}
async function saveBody(){
  const date=document.getElementById('bDate').value;
  const period=document.getElementById('bPeriod').value;
  const time=document.getElementById('bTime').value.trim();
  const entries={weight:'bWeight',systolic:'bSystolic',diastolic:'bDiastolic',pulse:'bPulse',fat:'bFat'};
  const inputs=Object.fromEntries(Object.entries(entries).map(([field,id])=>[field,document.getElementById(id).value.trim()]));
  const {weight,systolic,diastolic,pulse,fat}=inputs;
  if(!date){alert('請先選擇日期');return;}
  if(!weight&&!systolic&&!diastolic&&!pulse&&!fat){alert('請至少輸入體重、血壓、脈搏或體脂其中一項');return;}
  // 只驗證本次輸入的完整性：單獨補體重時不用再次填寫原有血壓。
  if((systolic&&!diastolic)||(!systolic&&diastolic)){
    // 編輯既有紀錄時可沿用另一個原有血壓欄位。
    const original=editingBodyId?db.body.find(v=>String(v.id)===String(editingBodyId)):db.body.find(v=>v.date===date&&(v.period||'')===period);
    if(!((systolic&&bodyValueProvided(original?.diastolic))||(diastolic&&bodyValueProvided(original?.systolic)))){
      alert('新增血壓請同時輸入收縮壓和舒張壓');return;
    }
  }
  let record=editingBodyId?db.body.find(v=>String(v.id)===String(editingBodyId)):db.body.find(v=>v.date===date&&(v.period||'')===period);
  if(editingBodyId&&!record){alert('找不到原本要修改的紀錄，請重新查詢後再試。');return;}
  const other=db.body.find(v=>v!==record&&v.date===date&&(v.period||'')===period);
  if(other){alert('這一天與時段已有另一筆紀錄，請先合併或修改現有資料，以免產生重複。');return;}
  if(record){backupBodyBeforeChange(record,'修改前');}
  else {record={id:uid()};db.body.push(record);}
  record.date=date;
  record.period=period;
  // 修改既有紀錄沿用原測量時間；在「修改」模式下，使用者可手動變更時間。
  if(!bodyValueProvided(record.time)||(editingBodyId&&time))record.time=time;
  for(const [field,value] of Object.entries(inputs))if(bodyValueProvided(value))record[field]=value;
  // 未輸入欄位保留原有數值，不使用空白字串覆蓋。
  editingBodyId='';save();
  for(const id of Object.values(entries))document.getElementById(id).value='';
  document.getElementById('bPeriod').value='早上';
  document.getElementById('bTime').value=tn();
  document.querySelector('#bodyEntry > summary')?.replaceChildren(document.createTextNode('新增早晚體重／血壓'));
  document.getElementById('cancelBodyEditBtn').style.display='none';
  await renderToday();renderHistory();renderStats();renderBodyBackups();
  alert('體重、體脂與血壓已合併儲存（空白欄位不會刪除既有數值）');
  afterSaved('add');
}

// 同步前先合併雲端非空白身體數值，防止本機舊資料把雲端血壓覆寫為空白。
async function retainCloudBodyVitalsBeforeUpload(){
  if(!cloudSession?.user)return;
  let rows=[];
  try{rows=await cloudFetch('/rest/v1/body_logs?select=*');}
  catch(e){console.warn('同步前無法讀取雲端身體紀錄，保留本機資料並使用既有同步機制：',e);return;}
  let changed=false;
  for(const remote of (Array.isArray(rows)?rows:[])){
    const id=String(remote.legacy_id||remote.id||'');
    const period=remote.measurement_period||'';
    // 相同 id 最可靠；舊裝置同日同時段產生不同 id 時也可補回缺失數值。
    const local=db.body.find(v=>String(v.id)===id)||db.body.find(v=>v.date===remote.log_date&&(v.period||'')===period);
    if(!local)continue;
    const cloud=cloudLocalRow('body_logs',remote);
    if(mergeBodyMissingFields(local,cloud))changed=true;
  }
  if(changed)persistLocalOnly();
}

// Wrap the current application's cloud upload, preserving the remainder of the sync logic.
if (typeof uploadLocalCloud === 'function') {
  const previousUploadLocalCloud = uploadLocalCloud;
  uploadLocalCloud = async function(){
    await retainCloudBodyVitalsBeforeUpload();
    return previousUploadLocalCloud();
  };
}
if (typeof deleteBody === 'function') {
  const previousDeleteBody=deleteBody;
  deleteBody=async function(id){
    // A harmless pre-delete backup: keep it even if the user cancels the delete dialog.
    const found=db.body.find(v=>String(v.id)===String(id));
    if(found)backupBodyBeforeChange(found,'刪除前');
    const result=await previousDeleteBody(id);
    renderBodyBackups();
    return result;
  };
}
(function addBodyRecoveryUi(){
  if(document.getElementById('bodyBackupList'))return;
  const historyTarget=document.getElementById('bodyList');
  if(!historyTarget)return;
  historyTarget.insertAdjacentHTML('afterend', '<details class="fold" style="margin-top:12px" ontoggle="if(this.open)renderBodyBackups()">\n<summary>↶ 身體記錄備份與補回</summary>\n<div class="fold-body"><div class="note">修正後修改身體紀錄前會自動備份舊值。點選補回不會覆蓋已存在的體重、血壓或體脂。</div><div id="bodyBackupList" style="margin-top:10px"></div></div></details>');
})();
/* KYC DAILY_NOTE_V3 2026-10-13
   Append this portion to body-merge-hotfix.js. No change to index.html needed.
   Daily notes: exactly one dated note, local backup, optional Supabase table sync.
   Display order: weight → fat → blood pressure → pulse (form/home/history/print).
*/
(function kycDailyNotesAndVitalsOrder(){
  'use strict';
  if (window.__KYC_DAILY_NOTES_V3__) return;
  window.__KYC_DAILY_NOTES_V3__ = true;

  const NOTES_REVISION_KEY = 'foodlog_daily_note_revisions_v2';
  const NOTES_DRAFT_KEY = 'foodlog_daily_note_drafts_v3';
  const ID_NOTE_BOX = 'kycDailyNoteText';
  let noteDraftDirty = false;
  let noteIsComposing = false;
  let displayedSavedText = '';
  // No autosave timer while composing Chinese text; saving is explicit.
  let noteSaveTimer = null;

  function readNoteDrafts(){
    try{const drafts=JSON.parse(localStorage.getItem(NOTES_DRAFT_KEY)||'{}');
      return drafts && typeof drafts==='object' && !Array.isArray(drafts)?drafts:{};
    }catch(e){return {};}
  }
  function writeNoteDraft(date,text){
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
    try{
      const drafts=readNoteDrafts();
      drafts[date]=String(text);
      // Keep only 45 recent dates to avoid unbounded localStorage use.
      const trimmed=Object.fromEntries(Object.entries(drafts).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,45));
      localStorage.setItem(NOTES_DRAFT_KEY,JSON.stringify(trimmed));
    }catch(e){console.warn('每日備註草稿未儲存',e);}
  }
  function removeNoteDraft(date){
    try{
      const drafts=readNoteDrafts();
      if(Object.prototype.hasOwnProperty.call(drafts,date)){
        delete drafts[date];localStorage.setItem(NOTES_DRAFT_KEY,JSON.stringify(drafts));
      }
    }catch(e){console.warn('每日備註草稿清除未完成',e);}
  }
  let noteCloudState = 'local';
  let cloudNotesSyncRunning = false;

  function getNotes(){
    if (!db.dailyNotes || typeof db.dailyNotes !== 'object' || Array.isArray(db.dailyNotes)) db.dailyNotes = {};
    return db.dailyNotes;
  }
  function getDailyRecord(date){
    const rec = getNotes()[date];
    if (typeof rec === 'string') return {text:rec,updatedAt:'1970-01-01T00:00:00.000Z'};
    return {text:String(rec?.text ?? ''),updatedAt:rec?.updatedAt || '1970-01-01T00:00:00.000Z'};
  }
  function appendRevision(date,old){
    if (!old || !old.text) return;
    try {
      let history=JSON.parse(localStorage.getItem(NOTES_REVISION_KEY)||'[]');
      if (!Array.isArray(history)) history=[];
      history.unshift({date, text:old.text, updatedAt:old.updatedAt, archivedAt:new Date().toISOString()});
      localStorage.setItem(NOTES_REVISION_KEY,JSON.stringify(history.slice(0,80)));
    }catch(e){console.warn('每日備註舊版備份失敗',e);}
  }
  function setDailyRecord(date,text){
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const original=getDailyRecord(date);
    if (original.text===text) return false;
    appendRevision(date,original);
    getNotes()[date]={text,updatedAt:new Date().toISOString()};
    save(); // Existing app writes to its own backup JSON/localStorage and schedules cloud sync.
    return true;
  }
  function status(message){
    const el=document.getElementById('kycDailyNoteStatus');
    if (el) el.textContent=message;
  }
  function saveNoteFromInput(showMessage){
    const el=document.getElementById(ID_NOTE_BOX);
    if(!el)return;
    if(noteIsComposing){
      status('中文選字尚未完成，請先選定文字再按儲存');
      return;
    }
    const date=el.dataset.noteDate;
    if(!date)return;
    const text=el.value;
    const changed=setDailyRecord(date,text);
    const saved=getDailyRecord(date).text===text;
    if(!saved){status('儲存未完成，請再試一次');return;}
    noteDraftDirty=false;
    displayedSavedText=text;
    removeNoteDraft(date);
    const cloudText=noteCloudState==='ok'?'，待雲端同步':'，已存此裝置';
    if(showMessage)status((changed?'已儲存':'內容沒有變更')+`（${date}${cloudText}）`);
    else if(changed)status(`已儲存 ${date}${cloudText}`);
  }
  function noteInputChanged(){
    const input=document.getElementById(ID_NOTE_BOX);
    if(!input)return;
    noteDraftDirty=true;
    // Persist an independent local *draft*, but do not write the actual daily note,
    // schedule cloud sync or programmatically touch textarea.value during iOS IME input.
    writeNoteDraft(input.dataset.noteDate,input.value);
    status('尚未儲存（草稿已暫存於此裝置）・完成選字後請按「儲存每日備註」');
  }
  function noteCurrentDate(){
    return document.getElementById('homeDate')?.value || homeSelectedDate || dn();
  }
  function buildNoteUi(){
    if(document.getElementById('kycDailyNoteCard'))return;
    const vital=document.getElementById('homeVitals');
    const anchor=vital?.closest('.card');
    if(!anchor)return;
    const node=document.createElement('div');
    node.className='card';
    node.id='kycDailyNoteCard';
    node.innerHTML=`
      <details class="section-fold" id="kycDailyNoteFold" open>
        <summary class="itemtitle">📝 每日備註</summary>
        <div style="padding-top:12px">
          <div class="note" id="kycDailyNoteDate" style="margin:0 0 8px"></div>
          <label for="${ID_NOTE_BOX}">每天一筆備註，依上方查詢日期顯示；可隨時補充或修改</label>
          <textarea id="${ID_NOTE_BOX}" rows="4" maxlength="10000" placeholder="例如：看診、睡眠、飲食狀況、當天注意事項…" style="width:100%;resize:vertical;min-height:100px"></textarea>
          <div class="btnrow" style="align-items:center;margin-top:10px">
            <button class="primary" type="button" id="kycDailyNoteSave">儲存每日備註</button>
          </div>
          <div class="note" id="kycDailyNoteStatus" style="margin-top:8px" role="status" aria-live="polite"></div>
        </div>
      </details>`;
    anchor.insertAdjacentElement('afterend',node);
    const input=document.getElementById(ID_NOTE_BOX);
    input.addEventListener('compositionstart',()=>{noteIsComposing=true;});
    input.addEventListener('compositionend',()=>{noteIsComposing=false;noteInputChanged();});
    input.addEventListener('input',noteInputChanged);
    // Do not save or overwrite the field on blur: iOS IME can temporarily blur
    // the textarea while the user is choosing Traditional Chinese characters.
    document.getElementById('kycDailyNoteSave').addEventListener('click',()=>{
      if(noteIsComposing){
        input.blur();
        setTimeout(()=>saveNoteFromInput(true),180);
      }else saveNoteFromInput(true);
    });
  }
  function refreshNoteUi(){
    buildNoteUi();
    const input=document.getElementById(ID_NOTE_BOX);
    if(!input)return;
    const d=noteCurrentDate();
    if(input.dataset.noteDate!==d){
      // On changing dates, keep the current draft independently; never auto-commit it.
      if(input.dataset.noteDate && noteDraftDirty)
        writeNoteDraft(input.dataset.noteDate,input.value);
      input.dataset.noteDate=d;
      const saved=getDailyRecord(d).text;
      const drafts=readNoteDrafts();
      const hasDraft=Object.prototype.hasOwnProperty.call(drafts,d) && drafts[d]!==saved;
      // Only change textarea.value on an intentional date switch, not during editing.
      input.value=hasDraft?drafts[d]:saved;
      displayedSavedText=saved;
      noteDraftDirty=hasDraft;
      noteIsComposing=false;
      document.getElementById('kycDailyNoteDate').textContent=`日期：${d}（一天一筆）`;
      status(hasDraft?'已恢復未儲存草稿，請檢查後按儲存':saved?'已載入該日期備註':'該日期尚無備註');
    }else{
      // When cloud sync renders the page, update only if the field is completely
      // untouched since the last programmatic fill. Never erase an active draft.
      const saved=getDailyRecord(d).text;
      if(!noteDraftDirty && !noteIsComposing && document.activeElement!==input &&
         input.value===displayedSavedText && saved!==displayedSavedText){
        input.value=saved;
        displayedSavedText=saved;
        status('已載入此日期最新備註');
      }
    }
  }
  function safeNoteHTML(value){return esc(value).replace(/\r?\n/g,'<br>');}

  // Change common renderer used by home, historical search, statistics and body backups.
  if (typeof bodyMeasureText === 'function') {
    bodyMeasureText = function(v){
      const parts=[];
      if(v.weight!==null && v.weight!==undefined && String(v.weight)!=='') parts.push(`體重 ${esc(v.weight)} kg`);
      if(v.fat!==null && v.fat!==undefined && String(v.fat)!=='') parts.push(`體脂 ${esc(v.fat)} %`);
      if(v.systolic || v.diastolic) parts.push(`血壓 ${esc(v.systolic||'—')}/${esc(v.diastolic||'—')} mmHg`);
      if(v.pulse!==null && v.pulse!==undefined && String(v.pulse)!=='') parts.push(`脈搏 ${esc(v.pulse)} 次／分`);
      return parts.join('・')||'未輸入測量數值';
    };
  }
  // In the data-entry form, move "fat %" immediately after "weight kg".
  const fatBlock=document.getElementById('bFat')?.parentElement;
  const bloodBlock=document.getElementById('bSystolic')?.parentElement;
  if(fatBlock && bloodBlock && fatBlock.parentElement===bloodBlock.parentElement){
    bloodBlock.parentElement.insertBefore(fatBlock,bloodBlock);
  }

  if(typeof renderToday==='function'){
    const oldRenderToday=renderToday;
    renderToday=async function(...args){
      const result=await oldRenderToday.apply(this,args);
      refreshNoteUi();
      return result;
    };
  }
  if(typeof renderHistory==='function'){
    const oldRenderHistory=renderHistory;
    renderHistory=function(...args){
      const result=oldRenderHistory.apply(this,args);
      const list=document.getElementById('historyList');
      const start=document.getElementById('hStart')?.value||'';
      const end=document.getElementById('hEnd')?.value||'';
      const type=document.getElementById('hType')?.value||'all';
      if(!list || !start || !end || type!=='all')return result;
      const s=start<=end?start:end,e=start<=end?end:start;
      const notes=Object.entries(getNotes()).filter(([d,r])=>d>=s && d<=e && String(r?.text ?? r ?? '').trim());
      if(!notes.length)return result;
      const cards=new Map();
      list.querySelectorAll('.history-day').forEach(node=>{
        const d=node.querySelector('.history-day-title')?.textContent?.slice(0,10);
        if(d)cards.set(d,node);
      });
      for(const [d] of notes){
        const t=getDailyRecord(d).text;
        const noteHtml=`<div class="history-food"><b>📝 每日備註</b><div class="small" style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:6px">${safeNoteHTML(t)}</div></div>`;
        const card=cards.get(d);
        if(card){ card.querySelector('.history-day-body')?.insertAdjacentHTML('beforeend',noteHtml); }
        else {
          const weekday=typeof historyWeekday==='function'?historyWeekday(d):'';
          const el=document.createElement('details');
          el.className='history-day';
          el.innerHTML=`<summary><div class="history-day-main"><div class="history-day-title">${esc(d)}（${esc(weekday)}）</div><div class="history-day-meta">每日備註 1 筆</div></div><span class="history-day-arrow">⌄</span></summary><div class="history-day-body">${noteHtml}</div>`;
          list.appendChild(el);cards.set(d,el);
        }
      }
      for(const el of [...list.querySelectorAll(':scope > details.history-day')].sort((a,b)=>{
        const da=a.querySelector('.history-day-title')?.textContent?.slice(0,10)||'';
        const dbb=b.querySelector('.history-day-title')?.textContent?.slice(0,10)||'';
        return dbb.localeCompare(da);
      })) list.appendChild(el);
      const empty=list.querySelector(':scope > .empty');if(empty)empty.remove();
      return result;
    };
  }
  // Reorder print table columns; append the selected day's notes to printable A4 preview.
  if(typeof printHistory==='function'){
    const oldPrintHistory=printHistory;
    printHistory=function(...args){
      saveNoteFromInput(false);
      const result=oldPrintHistory.apply(this,args);
      const sheet=document.getElementById('printPreviewSheet');
      if(!sheet)return result;
      const start=document.getElementById('hStart')?.value||'';
      const end=document.getElementById('hEnd')?.value||'';
      if(!start||!end)return result;
      const s=start<=end?start:end,e=start<=end?end:start;
      const articles=[...sheet.querySelectorAll('.pp-day')];
      const existing=new Set();
      for(const article of articles){
        const date=article.querySelector('.pp-day-head h2')?.textContent?.slice(0,10);
        if(!date)continue;
        existing.add(date);
        // Table order: period/time/weight/fat/blood-pressure/pulse.
        article.querySelectorAll('.pp-group').forEach(section=>{
          const h=section.querySelector('h3')?.textContent||'';
          if(!h.startsWith('體重／血壓'))return;
          section.querySelectorAll('tr').forEach(tr=>{
            const cells=[...tr.children];
            if(cells.length!==6)return;
            [0,1,2,5,3,4].forEach(i=>tr.appendChild(cells[i]));
          });
        });
        const note=getDailyRecord(date).text;
        if(note.trim()){
          const section=document.createElement('section');section.className='pp-group kyc-daily-note-print';
          const h=document.createElement('h3');h.textContent='每日備註';
          const p=document.createElement('div');p.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;padding:6px 0';p.textContent=note;
          section.append(h,p);article.appendChild(section);
        }
      }
      // Include days that have only a daily note and no food/exercise/vital records.
      const notes=Object.keys(getNotes()).filter(d=>d>=s && d<=e && getDailyRecord(d).text.trim() && !existing.has(d));
      for(const d of notes.sort()){
        sheet.querySelector('.pp-empty')?.remove();
        if(sheet.querySelector('.pp-day')){
          const pagebreak=document.createElement('div');pagebreak.className='html2pdf__page-break pp-hard-break';
          sheet.appendChild(pagebreak);
        }
        const article=document.createElement('article');article.className='pp-day pp-day-next';
        const header=document.createElement('div');header.className='pp-day-head';
        const h=document.createElement('h2');h.textContent=d;
        header.appendChild(h);
        const section=document.createElement('section');section.className='pp-group kyc-daily-note-print';
        const title=document.createElement('h3');title.textContent='每日備註';
        const text=document.createElement('div');text.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;padding:6px 0';
        text.textContent=getDailyRecord(d).text;
        section.append(title,text);article.append(header,section);sheet.appendChild(article);
      }
      return result;
    };
  }

  // Sync only when the optional user-owned `daily_notes` table has been created.
  // If absent, don't touch existing food/weight/blood-pressure cloud tables.
  async function syncDailyNotesCloud(){
    if(cloudNotesSyncRunning || !cloudSession?.user?.id)return;
    cloudNotesSyncRunning=true;
    try{
      const userId=cloudSession.user.id;
      const rows=await cloudFetch(`/rest/v1/daily_notes?select=note_date,content,updated_at&user_id=eq.${encodeURIComponent(userId)}`);
      if(!Array.isArray(rows))throw new Error('每日備註同步回傳內容異常');
      let localUpdated=false;
      const remoteByDate=new Map();
      for(const row of rows){
        const date=row.note_date;remoteByDate.set(date,row);
        const remoteTime=Date.parse(row.updated_at)||0;
        const current=getDailyRecord(date);
        const localTime=Date.parse(current.updatedAt)||0;
        if(remoteTime>localTime){
          getNotes()[date]={text:String(row.content??''),updatedAt:row.updated_at};
          localUpdated=true;
        }
      }
      const uploads=[];
      for(const [d] of Object.entries(getNotes())){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(d))continue;
        const rec=getDailyRecord(d),remote=remoteByDate.get(d);
        const t=Date.parse(rec.updatedAt)||0;
        if(!remote || t>(Date.parse(remote.updated_at)||0))uploads.push({user_id:userId,note_date:d,content:rec.text,updated_at:rec.updatedAt});
      }
      if(uploads.length){
        await cloudFetch('/rest/v1/daily_notes?on_conflict=user_id,note_date',{
          method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(uploads)
        });
      }
      if(localUpdated){persistLocalOnly();refreshNoteUi();renderHistory();}
      noteCloudState='ok';
      const el=document.getElementById('kycDailyNoteCloudInfo');
      if(el)el.textContent='每日備註雲端同步已啟用';
    }catch(e){
      noteCloudState='local';
      const info=document.getElementById('kycDailyNoteCloudInfo');
      if(info)info.textContent='每日備註目前僅儲存在此裝置（如需跨裝置同步，請先執行 daily_notes_supabase.sql）';
      console.warn('每日備註雲端尚未同步，原本的飲食／身體資料不受影響',e);
    }finally{cloudNotesSyncRunning=false;}
  }
  if(typeof syncCloud==='function'){
    const oldSyncCloud=syncCloud;
    syncCloud=async function(...args){
      const result=await oldSyncCloud.apply(this,args);
      await syncDailyNotesCloud();
      return result;
    };
  }
  // Ensure note status stays explicit before SQL setup, with no false "synced" claim.
  buildNoteUi();
  const noteCard=document.getElementById('kycDailyNoteCard');
  if(noteCard){
    const info=document.createElement('div');info.id='kycDailyNoteCloudInfo';info.className='note';
    info.style.marginTop='4px';info.textContent='輸入時保留草稿，按儲存才正式寫入；已設定 Supabase 時可進行跨裝置同步';
    noteCard.querySelector('#kycDailyNoteStatus')?.insertAdjacentElement('afterend',info);
  }
  refreshNoteUi();
  if(document.getElementById('historyList'))renderHistory();
})();
