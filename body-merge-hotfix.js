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
