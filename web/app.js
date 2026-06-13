(() => {
  const DEFAULT_FPS = 24;
  const DEFAULT_TOTAL = 360;
  const LANE_COUNT = 5;
  const DEFAULT_LANE_H = 74;
  const LEFT_PAD = 150;
  const SNAP_STEP = 8;
  const state = {
    project:null, media:[], selectedClipId:null, selectedClipIds:[], currentFrame:0, pxPerFrame:4,
    snap:true, loop:false, mute:false, previewMode:'single', range:{start:null,end:null}, mediaView:'grid', mediaThumb:104, drag:null, fonts:[],
    totalFrames:DEFAULT_TOTAL, audioMonitor:'auto', monitorVolume:1.0, scrubAudio:false, lockedLanes:{}, hiddenLanes:{}, playing:false, laneHeight:DEFAULT_LANE_H
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clamp = (v,min,max) => Math.max(min, Math.min(max, Number(v)||0));
  const trunc = (s,n) => String(s||'').length>n ? String(s).slice(0,n-1)+'…' : String(s||'');
  const status = msg => { const el=$('status'); if(el) el.textContent=msg; };
  const fps = () => Number(state.project?.settings?.fps || DEFAULT_FPS) || DEFAULT_FPS;
  const totalFrames = () => Math.max(1, Number(state.project?.settings?.total_frames || state.totalFrames || DEFAULT_TOTAL));
  const frameToSec = frame => frame / fps();
  const fmtTime = frame => { const sec=Math.max(0, frameToSec(frame)); const m=Math.floor(sec/60); const s=Math.floor(sec%60); const ms=Math.round((sec-Math.floor(sec))*1000); return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`; };
  const maxFrame = () => Math.max(totalFrames(), ...((state.project?.clips||[]).map(c=>c.start+c.length)), Math.round(fps()*15));
  const findClip = id => (state.project?.clips||[]).find(c=>c.id===id);
  const isSelected = id => state.selectedClipIds.includes(id);
  const selectedClip = () => findClip(state.selectedClipId);
  const selectedClips = () => (state.project?.clips||[]).filter(c=>isSelected(c.id));
  const mediaFor = clip => clip ? state.media.find(m=>m.id===clip.media_id) : null;
  const monitorMediaFor = clip => mediaFor(clip) || clip;
  const audioCapable = c => c && ['video','audio'].includes(c.kind);
  const fileUrl = item => !item ? '' : item.url ? item.url : item.path ? `/itda/api/file?path=${encodeURIComponent(item.path)}&project=${encodeURIComponent(state.project?.name || 'itda-project-1')}` : '';
  const snapFrame = f => state.snap ? Math.round(f / SNAP_STEP) * SNAP_STEP : Math.round(f);
  // Trimming must stay frame-accurate. Snap is for moving/placing clips only.
  const trimFrame = f => Math.round(f);
  const clipEnd = c => c.start + c.length;
  const laneH = () => Number(state.laneHeight || DEFAULT_LANE_H);
  function sourceTotalFrames(c){
    if(!c) return 1;
    const m = mediaFor(c);
    return Math.max(1, Math.round(Number(m?.total_frames || c.source_total_frames || c.source_frames || c.source_out || c.length || 1)));
  }
  function isTimeBoundClip(c){ return c && ['video','audio'].includes(c.kind); }
  function maxClipLength(c, srcIn=null){
    if(!isTimeBoundClip(c)) return Number.MAX_SAFE_INTEGER;
    const total = sourceTotalFrames(c);
    const input = srcIn == null ? Number(c.source_in || 0) : Number(srcIn || 0);
    return Math.max(1, total - Math.max(0, Math.min(total - 1, input)));
  }
  function normalizeClipBounds(c){
    if(!c) return c;
    if(!isTimeBoundClip(c)){
      c.length = Math.max(1, Math.round(Number(c.length || 1)));
      c.source_in = Math.max(0, Math.round(Number(c.source_in || 0)));
      c.source_out = Math.max(c.source_in + 1, Math.round(Number(c.source_out || (c.source_in + c.length))));
      return c;
    }
    const total = sourceTotalFrames(c);
    c.source_total_frames = total;
    c.source_in = Math.max(0, Math.min(total - 1, Math.round(Number(c.source_in || 0))));
    c.length = Math.max(1, Math.min(Math.round(Number(c.length || 1)), total - c.source_in));
    c.source_out = Math.max(c.source_in + 1, Math.min(total, c.source_in + c.length));
    return c;
  }

  function hexToRgba(hex, alpha=1){
    const h=String(hex||'#000000').replace('#','');
    const full=h.length===3 ? h.split('').map(x=>x+x).join('') : h.padEnd(6,'0').slice(0,6);
    const n=parseInt(full,16);
    const r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    return `rgba(${r},${g},${b},${Math.max(0,Math.min(1,Number(alpha)||0))})`;
  }

  async function api(path, opts={}) { const res=await fetch(path, opts); if(!res.ok){ let txt=''; try{txt=await res.text();}catch{} throw new Error(`${res.status} ${res.statusText}${txt?': '+txt:''}`); } return await res.json(); }

  function normalizeProject(p){
    p.settings = {...{fps:24,total_frames:360,snap:true,loop:false,mute:false,preview_mode:'single',scrub_audio:false}, ...(p.settings||{})};
    p.range = p.range || {start:null,end:null}; p.media = p.media || []; p.clips = p.clips || [];
    const oldLanes = Array.isArray(p.lanes) ? p.lanes : [];
    p.lanes = Array.from({length:LANE_COUNT}, (_,i)=>{
      const old = oldLanes.find(l=>Number(l.index)===i) || oldLanes[i] || {};
      const locked = !!old.locked;
      const visible = old.visible !== false;
      state.lockedLanes[i] = locked;
      state.hiddenLanes[i] = !visible;
      return {id:`lane_${i}`,index:i,locked,visible};
    });
    return p;
  }
  async function initProject(nameOverride=null){
    const name=nameOverride || state.project?.name || $('projectName').value || 'itda-project-1';
    const data=await api('/itda/api/init',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:name})});
    state.project=normalizeProject(data.project); state.range=state.project.range; state.snap=state.project.settings.snap!==false; state.loop=!!state.project.settings.loop; state.mute=!!state.project.settings.mute; state.previewMode=state.project.settings.preview_mode||'single'; state.scrubAudio=!!state.project.settings.scrub_audio; state.totalFrames=state.project.settings.total_frames||DEFAULT_TOTAL;
    $('projectName').value=state.project.name || 'itda-project-1'; await loadFonts(); await scanMedia(); renderAll(); status(`Loaded ${state.project.name}`);
  }
  async function saveProject(){
    if(!state.project) return; state.project.name=state.project.name || $('projectName').value || 'itda-project-1'; state.project.range=state.range; state.project.media=state.media.filter(m=>!m.local); state.project.settings={...state.project.settings,fps:fps(),total_frames:totalFrames(),snap:state.snap,loop:state.loop,mute:state.mute,preview_mode:state.previewMode,scrub_audio:state.scrubAudio};
    await api(`/itda/api/project/${encodeURIComponent(state.project.name)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state.project)});
    showModal('Save', `<p><b>${esc(state.project.name)}</b> 저장 완료.</p><p class="muted">ComfyUI/input/ITDA/projects/${esc(state.project.name)}.itda.json</p>`); status('Saved');
  }
  async function scanMedia(){
    if(!state.project) return; try{ const data=await api(`/itda/api/media/${encodeURIComponent(state.project.name)}`); const local=state.media.filter(m=>m.local); state.media=[...(data.items||[]),...local]; }catch(e){ status(`Media scan failed: ${e.message}`); }
  }

  async function loadFonts(){
    try{
      const data = await api('/itda/api/fonts');
      state.fonts = data.items || [];
      let style = document.getElementById('itda-font-face-style');
      if(!style){ style = document.createElement('style'); style.id='itda-font-face-style'; document.head.appendChild(style); }
      style.textContent = state.fonts.map(f=>`@font-face{font-family:'${String(f.family).replace(/'/g,"\\'")}';src:url('${f.url}') format('${f.format||'truetype'}');font-display:swap;}`).join('\n');
    }catch(e){ state.fonts=[]; status(`Font scan failed: ${e.message}`); }
  }

  function renderAll(){ autoLanes(); renderMedia(); renderTimeline(); updateControls(); updateProps(); updatePreview(); }

  function renderMedia(){
    state.media.forEach(m=>ensureWaveform(m));
    const list=$('mediaList'); list.innerHTML=''; list.classList.toggle('list-view', state.mediaView==='list'); list.style.setProperty('--thumb', `${state.mediaThumb || 104}px`);
    const items=state.media; $('mediaCount').textContent=`${items.length} item${items.length===1?'':'s'}`;
    if(!items.length){ list.innerHTML='<div class="empty">ComfyUI/input/ITDA 에 미디어를 넣거나 + 버튼으로 세션 미디어를 추가하세요.</div>'; return; }
    for(const item of items){
      const div=document.createElement('div'); div.className='media-item'; div.draggable=true; div.title=`${item.name}\n${item.fps?Number(item.fps).toFixed(3)+' fps':''} ${item.total_frames||''} frames`;
      const src=fileUrl(item); let thumb='';
      if(item.kind==='video') thumb=item.thumb_url ? `<img src="${item.thumb_url}" loading="lazy">` : `<video src="${src}#t=0.001" muted preload="metadata"></video>`; else if(item.kind==='image') thumb=`<img src="${src}" loading="lazy">`; else if(item.kind==='text') thumb=`<div class="icon">T</div>`; else thumb=`<div class="icon">♪</div>`;
      div.innerHTML=`<button class="media-delete" title="Remove">×</button><div class="thumb">${thumb}</div><div><div class="media-name">${esc(item.name)}</div><div class="media-meta">${item.kind}${item.fps?` · ${Number(item.fps).toFixed(2)}fps`:''}${item.total_frames?` · ${item.total_frames}f`:''}</div></div>`;
      div.querySelector('.media-delete').onclick=e=>{e.stopPropagation(); removeMedia(item.id);};
      div.addEventListener('dragstart', e=>e.dataTransfer.setData('application/itda-media', JSON.stringify(item)));
      div.addEventListener('dblclick', ()=>mediaPreview(item));
      list.appendChild(div);
    }
  }
  async function removeMedia(id){
    const item=state.media.find(m=>m.id===id);
    if(!item) return;
    if(!confirm(`Media Bin에서 삭제하면 라이브러리 파일도 영구 삭제됩니다.

${item.name}

삭제할까요?`)) return;
    if(item.path && !item.local){
      try{ await api('/itda/api/media/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:state.project?.name||'itda-project-1',path:item.path})}); }catch(e){ status(`Media delete failed: ${e.message}`); return; }
    }
    state.media=state.media.filter(m=>m.id!==id);
    if(state.project) state.project.clips=(state.project.clips||[]).filter(c=>c.media_id!==id);
    setSelection(null); renderAll(); status('Media deleted from library');
  }
  function mediaPreview(item){ const temp={id:'preview',media_id:item.id,name:item.name,kind:item.kind,start:0,length:item.total_frames||Math.round((item.duration||5)*fps()),source_in:0,lane:0,path:item.path,url:item.url||null,text:item.text||'',font_family:item.font_family||'system',shadow_enabled:false,shadow_color:'#000000',shadow_opacity:0.6,fps:item.fps||fps()}; const v=$('previewVideo'); const vb=$('previewVideoB'); if(v){ v.controls = item.kind==='video' || item.kind==='audio'; v.muted=false; v.volume=state.monitorVolume; } if(vb){ vb.controls=false; } loadPreviewForClip(temp,v,$('previewImage'),$('textOverlay')); if(item.kind==='audio'){ const src=fileUrl(item); if(v){ v.pause(); v.src=src; v.dataset.src=src; v.controls=true; v.load(); } } status('Media preview loaded. Use native controls, Space, or click preview to play.'); }
  async function addLocalFiles(files, kindHint=null){
    if(!state.project) return;
    const fd=new FormData(); [...files].forEach(f=>fd.append('files',f)); fd.append('project', state.project.name || $('projectName').value || 'itda-project-1');
    try{
      const data=await fetch('/itda/api/media/upload',{method:'POST',body:fd}).then(r=>{if(!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json();});
      await scanMedia(); renderAll(); status(`Imported ${(data.items||[]).length} file(s) to input/ITDA/media/${state.project.name}`);
    }catch(err){
      [...files].forEach(file=>{ const kind=file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':file.type.startsWith('image/')?'image':kindHint; if(!kind) return; const item={id:`local:${Date.now()}:${Math.random().toString(16).slice(2)}`,name:file.name,kind,path:null,url:URL.createObjectURL(file),local:true,fps:fps(),total_frames:Math.round(fps()*5),duration:5,width:null,height:null}; if(kind==='video') loadVideoMeta(item); state.media.push(item); });
      renderMedia(); status(`Upload failed, using temporary session media: ${err.message}`);
    }
  }
  function loadVideoMeta(item){ const v=document.createElement('video'); v.preload='metadata'; v.src=item.url; v.onloadedmetadata=()=>{ item.duration=v.duration||item.duration||5; item.width=v.videoWidth; item.height=v.videoHeight; item.original_fps=item.fps||fps(); item.fps=fps(); item.total_frames=Math.round(item.duration*fps()); renderAll(); }; }
  function addTextMedia(){ const item={id:`text:${Date.now()}`,name:'Text Clip',kind:'text',local:true,text:'Subtitle Text',fps:fps(),total_frames:Math.round(fps()*3),duration:3}; state.media.push(item); renderMedia(); addClipFromMedia(item,state.currentFrame); }
  function addClipFromMedia(media,startFrame){ const length=media.total_frames||Math.round((media.duration||5)*fps())||120; const clip={id:`clip_${Date.now()}_${Math.random().toString(16).slice(2)}`,media_id:media.id,name:media.name,kind:media.kind,path:media.path,url:media.url||null,fps:fps(),width:media.width||null,height:media.height||null,start:Math.max(0,snapFrame(startFrame)),length,source_in:0,source_out:length,source_total_frames:media.total_frames||length,lane:0,group_id:null,audio_detached:false,text:media.text||'',x:50,y:88,size:42,opacity:1,color:'#ffffff',font_family:'system',shadow_enabled:false,shadow_color:'#000000',shadow_opacity:0.6}; normalizeClipBounds(clip); state.project.clips.push(clip); setSelection(clip.id); renderAll(); }

  function setSelection(id,additive=false){
    if(!id){state.selectedClipId=null;state.selectedClipIds=[];return;}
    const c=findClip(id);
    const groupIds = c?.group_id ? (state.project?.clips||[]).filter(x=>x.group_id===c.group_id).map(x=>x.id) : [id];
    if(additive){
      const allSelected=groupIds.every(x=>isSelected(x));
      state.selectedClipIds = allSelected ? state.selectedClipIds.filter(x=>!groupIds.includes(x)) : [...new Set([...state.selectedClipIds, ...groupIds])];
      state.selectedClipId=state.selectedClipIds[state.selectedClipIds.length-1]||null;
    } else {
      state.selectedClipId=id;
      state.selectedClipIds=groupIds;
    }
  }
  function autoLanes(){ if(!state.project) return; for(const c of state.project.clips||[]) c.lane=clamp(c.lane??0,0,LANE_COUNT-1); state.project.lanes=Array.from({length:LANE_COUNT},(_,i)=>({id:`lane_${i}`,index:i,locked:!!state.lockedLanes[i],visible:!state.hiddenLanes[i]})); }
  function setLaneState(index, patch){
    if(!state.project) return;
    const i=Number(index);
    if(patch.locked !== undefined) state.lockedLanes[i]=!!patch.locked;
    if(patch.visible !== undefined) state.hiddenLanes[i]=!patch.visible;
    autoLanes();
    const row=document.querySelector(`.lane[data-lane="${i}"]`);
    if(row){ row.classList.add('state-refresh'); setTimeout(()=>row.classList.remove('state-refresh'),140); }
    renderTimeline();
    updatePreview();
    updateProps();
    updateControls();
  }

  function resamplePeaks(peaks, count){
    if(!Array.isArray(peaks) || !peaks.length) return [];
    count = Math.max(16, Math.min(640, Math.round(count || 160)));
    if(peaks.length === count) return peaks;
    const out=[];
    for(let i=0;i<count;i++){
      const a=Math.floor(i*peaks.length/count);
      const b=Math.max(a+1, Math.floor((i+1)*peaks.length/count));
      let peak=0;
      for(let j=a;j<b && j<peaks.length;j++) peak=Math.max(peak, Math.abs(Number(peaks[j])||0));
      out.push(Math.max(0, Math.min(1, peak)));
    }
    return out;
  }
  function visibleWaveformPeaks(c){
    const m=mediaFor(c) || c;
    const peaks=m.waveform || c.waveform;
    if(!Array.isArray(peaks) || !peaks.length) return [];

    // Source-frame aligned waveform.
    // Render one visual bar per source frame so a trimmed clip and the original clip
    // show the exact same waveform at the same source-frame position.
    // This avoids the micro drift caused by flex gap / per-clip resampling.
    const sourceTotal=Math.max(1, Number(m.total_frames || c.source_total_frames || c.source_out || c.length || peaks.length));
    const srcIn=Math.max(0, Math.min(sourceTotal-1, Math.round(Number(c.source_in || 0))));
    const length=Math.max(1, Math.min(Math.round(Number(c.length || 1)), sourceTotal-srcIn));
    const out=[];
    for(let i=0;i<length;i++){
      const frameA = srcIn + i;
      const frameB = srcIn + i + 1;
      const a=Math.max(0, Math.min(peaks.length-1, Math.floor(frameA / sourceTotal * peaks.length)));
      const b=Math.max(a+1, Math.min(peaks.length, Math.ceil(frameB / sourceTotal * peaks.length)));
      let peak=0;
      for(let j=a;j<b;j++) peak=Math.max(peak, Math.abs(Number(peaks[j])||0));
      out.push({v:Math.max(0, Math.min(1, peak)), i});
    }
    return out;
  }
  function waveformMarkup(c){
    if(!audioCapable(c)) return '';
    const peaks=visibleWaveformPeaks(c);
    const len=Math.max(1, Math.round(Number(c.length||peaks.length||1)));
    if(peaks.length){
      return `<div class="waveform real source-aligned">${peaks.map(p=>{
        const v = typeof p === 'object' ? p.v : p;
        const i = typeof p === 'object' ? p.i : peaks.indexOf(p);
        const h = Math.max(2,Math.round(Math.max(0,Math.min(1,Number(v)||0))*100));
        const left = (i / len) * 100;
        const w = Math.max(0.18, Math.min(1.2, (1 / len) * 72));
        return `<i style="left:${left}%;width:${w}%;height:${h}%"></i>`;
      }).join('')}</div>`;
    }
    return '<div class="waveform waveform-loading" title="Real waveform cache pending"></div>';
  }
  async function ensureWaveform(item){
    if(!item || item.waveform || item.waveformLoading || !['video','audio'].includes(item.kind) || !item.path) return;
    item.waveformLoading = true;
    try{
      const bars = Math.max(240, Math.min(1200, Math.round((item.total_frames || totalFrames()) * 2))); // dense source-aligned peak cache
      const data = await api('/itda/api/waveform', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({project:state.project?.name||'itda-project-1', path:item.path, bars})
      });
      item.waveformLoading = false;
      if(data && data.ok && Array.isArray(data.peaks)){
        item.waveform = data.peaks;
        item.waveform_cache_path = data.cache_path || null;
        renderTimeline();
        renderMedia();
      } else {
        item.waveform = [];
        status(`Waveform unavailable: ${item.name}`);
      }
    }catch(e){
      item.waveformLoading = false;
      item.waveform = [];
      status(`Waveform failed: ${item.name} · ${e.message}`);
    }
  }
  function renderRuler(){ const ruler=$('ruler'); ruler.innerHTML=''; const total=maxFrame(); ruler.style.width=`${LEFT_PAD+total*state.pxPerFrame+500}px`; const major=Math.max(1,Math.round(fps())); const minor=Math.max(1,Math.round(major/4)); for(let f=0; f<=total; f+=minor){ const tick=document.createElement('div'); const isMajor=f%major===0; tick.className=isMajor?'tick':'tick minor'; tick.style.left=`${LEFT_PAD+f*state.pxPerFrame}px`; if(isMajor) tick.innerHTML=`${fmtTime(f).slice(0,5)}<span class="sub">${Math.round(f)}f</span>`; ruler.appendChild(tick); } const projectEnd=document.createElement('div'); projectEnd.className='total-frame-marker'; projectEnd.style.left=`${LEFT_PAD+totalFrames()*state.pxPerFrame}px`; projectEnd.innerHTML='<span>END</span>'; ruler.appendChild(projectEnd); }
  function renderTimeline(){ if(!state.project) return; autoLanes(); renderRuler(); const lanes=$('lanes'); lanes.innerHTML=''; lanes.style.width=$('ruler').style.width; lanes.style.height=`${LANE_COUNT*laneH()}px`; $('rangeLayer').style.height=`${LANE_COUNT*laneH()}px`;
    for(const lane of state.project.lanes){
      const row=document.createElement('div');
      row.className=`lane ${lane.locked?'locked':''} ${!lane.visible?'hidden-lane preview-off':''}`;
      row.dataset.lane=lane.index;
      row.style.height=`${laneH()}px`;
      const visIcon = lane.visible ? '👁' : '◌';
      const lockIcon = lane.locked ? '🔒' : '🔓';
      const visTitle = lane.visible ? 'Preview ON - click to disable' : 'Preview OFF - click to enable';
      const lockTitle = lane.locked ? 'Track Locked - click to unlock' : 'Track Unlocked - click to lock';
      row.innerHTML=`<div class="lane-label"><div class="lane-name">T${lane.index+1}</div><span class="tools"><button class="lane-tool vis ${lane.visible?'on':'off'}" data-vis="${lane.index}" title="${visTitle}" aria-pressed="${lane.visible?'true':'false'}">${visIcon}</button><button class="lane-tool lock ${lane.locked?'on':'off'}" data-lock="${lane.index}" title="${lockTitle}" aria-pressed="${lane.locked?'true':'false'}">${lockIcon}</button></span></div>`;
      lanes.appendChild(row);
    }
    lanes.querySelectorAll('[data-lock]').forEach(b=>b.onclick=e=>{e.preventDefault(); e.stopPropagation(); const i=Number(b.dataset.lock); setLaneState(i,{locked:!state.lockedLanes[i]}); status(`T${i+1} ${state.lockedLanes[i]?'locked':'unlocked'}`);});
    lanes.querySelectorAll('[data-vis]').forEach(b=>b.onclick=e=>{e.preventDefault(); e.stopPropagation(); const i=Number(b.dataset.vis); setLaneState(i,{visible:!!state.hiddenLanes[i]}); status(`T${i+1} preview ${state.hiddenLanes[i]?'OFF':'ON'}`);});
    const hasSel=state.selectedClipIds.length>0;
    for(const c of state.project.clips||[]){ normalizeClipBounds(c); const row=lanes.children[c.lane]; if(!row) continue; const el=document.createElement('div'); const stitched=!!(c.kind==='stitched'||c.children); el.className=`clip ${c.kind||'video'} ${c.group_id?'grouped':''} ${stitched?'stitched':''} ${isSelected(c.id)?'selected':''} ${hasSel&&!isSelected(c.id)?'dimmed':''}`; el.dataset.clipId=c.id; el.style.left=`${LEFT_PAD+c.start*state.pxPerFrame}px`; el.style.width=`${Math.max(32,c.length*state.pxPerFrame)}px`; el.style.height=`${Math.max(34,laneH()-19)}px`; el.title=`${c.name}
Trim ${c.source_in||0}f–${c.source_out||c.length}f
Timeline ${c.start}f–${c.start+c.length}f`; const icon=stitched?'◆':c.kind==='audio'?'♫':c.kind==='image'?'▧':c.kind==='text'?'T':'▣'; el.innerHTML=`<div class="clip-title">${icon} ${esc(trunc(c.name,34))}</div><div class="clip-trim">${c.source_in||0}f / ${fmtTime(c.length)}</div><div class="clip-bars">${waveformMarkup(c)}</div><div class="clip-handle left" data-trim="left"></div><div class="clip-handle right" data-trim="right"></div>`; el.addEventListener('pointerdown', startClipPointer); row.appendChild(el); }
    renderRange(); updatePlayhead(); }
  function renderRange(){ const layer=$('rangeLayer'); layer.innerHTML=''; if(state.range.start==null || state.range.end==null) return; const a=Math.min(state.range.start,state.range.end), b=Math.max(state.range.start,state.range.end); const box=document.createElement('div'); box.className='range-box'; box.style.left=`${LEFT_PAD+a*state.pxPerFrame}px`; box.style.width=`${Math.max(1,(b-a)*state.pxPerFrame)}px`; layer.appendChild(box); }
  function updatePlayhead(){
    const ph=$('playhead');
    ph.style.left=`${LEFT_PAD+state.currentFrame*state.pxPerFrame}px`;
    ph.style.height=`${48 + LANE_COUNT * laneH()}px`;
    $('frameLabel').textContent=`Frame ${Math.round(state.currentFrame)}`;
    $('timeLabel').textContent=fmtTime(state.currentFrame);
    updatePreview(); updatePlaybackAudio(); scheduleAudioScrub();
  }

  function startClipPointer(e){
    e.preventDefault(); e.stopPropagation();
    const el=e.currentTarget; const c=findClip(el.dataset.clipId); if(!c || state.lockedLanes[c.lane]) return;
    const trim=e.target?.dataset?.trim;
    const additive=e.ctrlKey||e.metaKey;
    if(additive) setSelection(c.id,true);
    else if(!isSelected(c.id)) setSelection(c.id,false);
    const dragClips = selectedClips();
    state.drag={
      clipId:c.id,startX:e.clientX,startY:e.clientY,origStart:c.start,origLen:c.length,origSourceIn:c.source_in||0,origLane:c.lane,trim,moved:false,
      items:dragClips.map(x=>({id:x.id,start:x.start,lane:x.lane,length:x.length,source_in:x.source_in||0,source_out:x.source_out||x.length}))
    };
    renderTimeline(); updateProps(); updateControls(); updatePreview();
    document.addEventListener('pointermove', onClipPointer, {passive:false});
    document.addEventListener('pointerup', endClipPointer, {once:true});
  }
  function wouldOverlap(id,lane,start,length, extra=[]){
    const end=start+length;
    const clips=[...(state.project?.clips||[]), ...extra];
    return clips.some(o=>o.id!==id && o.lane===lane && start<clipEnd(o) && end>o.start);
  }
  function fitSingleMove(c, proposedStart, proposedLane, dxFrames){
    let ns=Math.max(0, proposedStart), lane=clamp(proposedLane,0,LANE_COUNT-1);
    if(!wouldOverlap(c.id,lane,ns,c.length)) return {start:ns,lane};
    const others=(state.project?.clips||[]).filter(o=>o.id!==c.id && o.lane===lane).sort((a,b)=>a.start-b.start);
    if(dxFrames>=0){
      for(const o of others){ if(ns < clipEnd(o) && ns+c.length > o.start) ns=clipEnd(o); }
    }else{
      for(const o of [...others].reverse()){ if(ns < clipEnd(o) && ns+c.length > o.start) ns=o.start-c.length; }
    }
    ns=Math.max(0,ns);
    return wouldOverlap(c.id,lane,ns,c.length) ? {start:c.start,lane:c.lane} : {start:ns,lane};
  }
  function canPlaceGroup(proposals){
    const ids=new Set(proposals.map(p=>p.id));
    for(const p of proposals){ if(p.start<0 || p.lane<0 || p.lane>=LANE_COUNT || state.lockedLanes[p.lane]) return false; }
    for(let i=0;i<proposals.length;i++) for(let j=i+1;j<proposals.length;j++){
      const a=proposals[i], b=proposals[j]; if(a.lane===b.lane && a.start < b.start+b.length && a.start+a.length > b.start) return false;
    }
    for(const p of proposals){
      if((state.project?.clips||[]).some(o=>!ids.has(o.id) && o.lane===p.lane && p.start < clipEnd(o) && p.start+p.length > o.start)) return false;
    }
    return true;
  }
  function onClipPointer(e){
    if(!state.drag) return; e.preventDefault();
    const c=findClip(state.drag.clipId); if(!c) return;
    const dxFrames=Math.round((e.clientX-state.drag.startX)/state.pxPerFrame);
    if(Math.abs(e.clientX-state.drag.startX)>2 || Math.abs(e.clientY-state.drag.startY)>2) state.drag.moved=true;
    if(state.drag.trim==='left'){
      const oldEnd=state.drag.origStart+state.drag.origLen;
      let ns=clamp(trimFrame(state.drag.origStart+dxFrames),0,oldEnd-1);
      let diff=ns-state.drag.origStart;
      let srcIn=Math.max(0,Math.round(state.drag.origSourceIn+diff));
      if(isTimeBoundClip(c)) srcIn=Math.min(sourceTotalFrames(c)-1,srcIn);
      let newLen=Math.max(1,oldEnd-ns);
      const maxLen=maxClipLength(c,srcIn);
      if(newLen>maxLen){ newLen=maxLen; ns=oldEnd-newLen; diff=ns-state.drag.origStart; srcIn=Math.max(0,Math.round(state.drag.origSourceIn+diff)); if(isTimeBoundClip(c)) srcIn=Math.min(sourceTotalFrames(c)-1,srcIn); }
      if(!wouldOverlap(c.id,c.lane,ns,newLen)){ c.start=ns; c.length=newLen; c.source_in=srcIn; c.source_out=c.source_in+c.length; normalizeClipBounds(c); }
    } else if(state.drag.trim==='right'){
      let newLen=Math.max(1,trimFrame(state.drag.origLen+dxFrames));
      newLen=Math.min(newLen,maxClipLength(c,c.source_in||0));
      if(!wouldOverlap(c.id,c.lane,c.start,newLen)){ c.length=newLen; c.source_out=(c.source_in||0)+c.length; normalizeClipBounds(c); }
    } else {
      const targetLane=laneFromClientY(e.clientY);
      const laneDelta=targetLane-state.drag.origLane;
      const movingSelected=state.drag.items.length>1 && isSelected(c.id);
      if(movingSelected){
        const proposals=state.drag.items.map(it=>({id:it.id,start:snapFrame(it.start+dxFrames),lane:clamp(it.lane+laneDelta,0,LANE_COUNT-1),length:it.length}));
        if(canPlaceGroup(proposals)) proposals.forEach(p=>{ const clip=findClip(p.id); if(clip){clip.start=p.start; clip.lane=p.lane;} });
      } else {
        const fitted=fitSingleMove(c,snapFrame(state.drag.origStart+dxFrames),targetLane,dxFrames);
        c.start=fitted.start; c.lane=fitted.lane;
      }
    }
    renderTimeline(); updateProps(); updatePlayhead();
  }
  function endClipPointer(e){ document.removeEventListener('pointermove',onClipPointer); state.drag=null; renderAll(); }
  function frameFromTimelineEvent(e){ const rect=$('timeline').getBoundingClientRect(); return clamp(Math.round((e.clientX-rect.left+$('timeline').scrollLeft-LEFT_PAD)/state.pxPerFrame),0,maxFrame()); }
  function laneFromClientY(y){ const rect=$('lanes').getBoundingClientRect(); return clamp(Math.floor((y-rect.top+$('timeline').scrollTop)/laneH()),0,LANE_COUNT-1); }
  function laneFromTimelineEvent(e){ return laneFromClientY(e.clientY); }

  function childClipAtFrame(stitched, frame, kinds=null){
    if(!stitched?.children) return null;
    const local=frame-stitched.start;
    const child=(stitched.children||[]).filter(ch=>local>=ch.rel_start && local<ch.rel_start+ch.length && (!kinds || kinds.includes(ch.kind))).sort((a,b)=>(a.lane??0)-(b.lane??0))[0];
    if(!child) return null;
    return {...child,id:`${stitched.id}:${child.id}`,start:stitched.start+child.rel_start,media_id:child.media_id,path:child.path,url:child.url};
  }
  function activeClipsAtFrame(frame){ return (state.project?.clips||[]).filter(c=>frame>=c.start && frame<clipEnd(c) && !state.hiddenLanes[c.lane]).sort((a,b)=>a.lane-b.lane); }
  function topVisualClip(frame){
    const base = topBaseVisualClip(frame);
    return base || topTextClip(frame);
  }
  function topBaseVisualClip(frame){
    for(const c of activeClipsAtFrame(frame)){
      if(c.kind==='stitched'||c.children){ const ch=childClipAtFrame(c,frame,['video','image']); if(ch) return ch; }
      if(['video','image'].includes(c.kind)) return c;
    }
    return null;
  }
  function topTextClip(frame){
    for(const c of activeClipsAtFrame(frame)){
      if(c.kind==='stitched'||c.children){ const ch=childClipAtFrame(c,frame,['text']); if(ch) return ch; }
      if(c.kind==='text') return c;
    }
    return null;
  }
  function topAudioClip(frame){
    for(const c of activeClipsAtFrame(frame)){
      if(c.kind==='stitched'||c.children){ const ch=childClipAtFrame(c,frame,['video','audio']); if(ch) return ch; }
      if(['video','audio'].includes(c.kind)) return c;
    }
    return null;
  }
  function updatePreview(){ const pv=$('previewVideo'), pvb=$('previewVideoB'); if(pv && document.activeElement!==pv) pv.controls=false; if(pvb) pvb.controls=false;
    const stage=$('previewStage'); const v=$('previewVideo'), vB=$('previewVideoB'), img=$('previewImage'), imgB=$('previewImageB'), t=$('textOverlay'), tB=$('textOverlayB');
    stage.className='preview-stage'; [v,vB,img,imgB].forEach(el=>{el.style.display='';}); clearTextOverlay(t); clearTextOverlay(tB);
    let primary=null, secondary=null, overlayText=null; const sel=selectedClips();
    if((state.previewMode==='compare'||state.previewMode==='overlay') && sel.length===2){ [primary,secondary]=sel; }
    else {
      // Normal Preview = layer renderer, not selected-clip renderer.
      // Text clips are transparent overlays over the highest video/image layer below them.
      primary=topBaseVisualClip(state.currentFrame);
      overlayText=topTextClip(state.currentFrame);
      secondary=null;
    }
    if(!primary){ [v,vB].forEach(x=>{x.pause(); x.removeAttribute('src'); x.dataset.src=''; x.load();}); [img,imgB].forEach(x=>x.removeAttribute('src')); }
    else loadPreviewForClip(primary,v,img,t);
    if(overlayText){ loadTextOverlay(overlayText,t); stage.classList.add('has-text'); }
    if(secondary) loadPreviewForClip(secondary,vB,imgB,tB,true);
    if(primary || overlayText) stage.classList.add('has-content');
    if(primary?.kind==='video') stage.classList.add('has-primary-video'); if(primary?.kind==='image') stage.classList.add('has-primary-image');
    if(secondary?.kind==='video') stage.classList.add('has-secondary-video'); if(secondary?.kind==='image') stage.classList.add('has-secondary-image'); if(secondary?.kind==='text') stage.classList.add('has-text-b');
    if(state.previewMode==='compare' && secondary) stage.classList.add('compare'); if(state.previewMode==='overlay' && secondary) stage.classList.add('overlay');
    updateAudioMonitor();
  }
  function clearTextOverlay(textEl){
    if(!textEl) return;
    textEl.textContent='';
    textEl.style.display='';
  }
  function loadTextOverlay(c, textEl){
    if(!textEl || !c) return;
    textEl.textContent=c.text||c.name||'Text';
    textEl.style.left=`${c.x??50}%`;
    textEl.style.bottom=`${100-(c.y??88)}%`;
    textEl.style.fontSize=`${c.size||42}px`;
    textEl.style.opacity=c.opacity??1;
    textEl.style.color=c.color||'#ffffff';
    textEl.style.fontFamily=(c.font_family && c.font_family !== 'system') ? `'${String(c.font_family).replace(/'/g,"\'")}', sans-serif` : 'Inter, Segoe UI, Arial, sans-serif';
    textEl.style.background='transparent';
    if(c.shadow_enabled){
      const alpha = Math.max(0, Math.min(1, Number(c.shadow_opacity ?? 0.6)));
      const hex = c.shadow_color || '#000000';
      textEl.style.textShadow = `0 2px 4px ${hex}${Math.round(alpha*255).toString(16).padStart(2,'0')}, 0 0 8px ${hex}${Math.round(alpha*210).toString(16).padStart(2,'0')}`;
    }else{
      textEl.style.textShadow = 'none';
    }
  }
  function loadPreviewForClip(c, videoEl, imgEl, textEl, secondary=false){
    if(c.kind==='stitched'||c.children){ const ch=childClipAtFrame(c,state.currentFrame,['video','image','text']); if(ch) return loadPreviewForClip(ch,videoEl,imgEl,textEl,secondary); }
    const m=mediaFor(c) || c; const src=fileUrl(m);
    clearTextOverlay(textEl);
    if(c.kind==='video'){
      if(imgEl) imgEl.removeAttribute('src');
      if(videoEl.dataset.src!==src){ videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load(); videoEl.src=src; videoEl.dataset.src=src; videoEl.onerror=()=>status('Preview video load failed'); }
      videoEl.volume = state.monitorVolume; videoEl.muted = secondary || state.mute || audioMutedForClip(c); seekElementToFrame(videoEl,c,state.currentFrame);
    } else if(c.kind==='image'){
      if(videoEl){ videoEl.pause(); videoEl.removeAttribute('src'); videoEl.dataset.src=''; videoEl.load(); }
      if(imgEl.src!==src) imgEl.src=src;
    } else if(c.kind==='text'){
      if(videoEl){ videoEl.pause(); videoEl.removeAttribute('src'); videoEl.dataset.src=''; videoEl.load(); }
      if(imgEl) imgEl.removeAttribute('src');
      loadTextOverlay(c,textEl);
    }
  }
  function seekElementToFrame(video,c,frame){ if(!video.src) return; const local=Math.max(0,(frame-c.start+(c.source_in||0))/(c.fps||fps())); if(Number.isFinite(local) && Math.abs((video.currentTime||0)-local)>.08){ try{ video.currentTime=local; }catch{} } }
  function audioMutedForClip(c){ const sel=selectedClips(); if(state.mute) return true; if(sel.length===0){ const top=topAudioClip(state.currentFrame); return !top || top.id!==c.id; } if(sel.length===1) return sel[0].id!==c.id; if(sel.length===2) return !sel.some(x=>x.id===c.id); return true; }
  function clipAudibleAtFrame(c, frame=state.currentFrame){
    if(!c || !audioCapable(c)) return false;
    if(state.hiddenLanes[c.lane]) return false;
    const local = frame - c.start;
    if(local < 0 || local >= c.length) return false;
    const srcIn = Number(c.source_in || 0);
    const srcOut = Number(c.source_out || (srcIn + c.length));
    return srcIn + local < srcOut;
  }
  function monitoredAudioClips(){
    if(state.mute) return [];
    const selAll=selectedClips().filter(c=>['video','audio'].includes(c.kind));
    if(selAll.length===1) return selAll.filter(c=>clipAudibleAtFrame(c));
    if(selAll.length===2) return selAll.filter(c=>clipAudibleAtFrame(c));
    if(selAll.length>=3) return [];
    const top=topAudioClip(state.currentFrame);
    return top && clipAudibleAtFrame(top) ? [top] : [];
  }
  function updateAudioMonitor(){
    const v=$('previewVideo'), vB=$('previewVideoB');
    [v,vB].forEach(x=>{ if(x){ x.volume=state.monitorVolume; x.muted=true; }});
    updatePlaybackAudio();
  }
  function ensurePlaybackAudioElements(){
    if(state.monitorAudios) return state.monitorAudios;
    state.monitorAudios=[new Audio(),new Audio()];
    state.monitorAudios.forEach(a=>{a.preload='auto'; a.volume=state.monitorVolume;});
    return state.monitorAudios;
  }
  function syncAudioElement(a,c,autoplay){
    if(!c || !clipAudibleAtFrame(c)){ a.pause(); if(!c){ a.removeAttribute('src'); a.dataset.src=''; } return; }
    const m=monitorMediaFor(c), src=fileUrl(m); if(!src){ a.pause(); return; }
    if(a.dataset.src!==src){ a.pause(); a.src=src; a.dataset.src=src; a.load(); }
    const sec=Math.max(0,(state.currentFrame-c.start+(c.source_in||0))/(c.fps||fps()));
    if(Number.isFinite(sec) && Math.abs((a.currentTime||0)-sec)>.12){ try{ a.currentTime=sec; }catch{} }
    a.volume=state.monitorVolume; a.muted=state.mute || state.monitorVolume<=0;
    if(autoplay && !a.muted){ a.play().catch(()=>{}); } else if(!autoplay){ a.pause(); }
  }
  function updatePlaybackAudio(){
    const els=ensurePlaybackAudioElements();
    const clips=monitoredAudioClips().slice(0,2);
    els.forEach((a,i)=>syncAudioElement(a,clips[i],state.playing));
  }

  function startPlaybackClock(){
    state.playStartFrame=state.currentFrame;
    state.playStartedAt=performance.now();
    cancelAnimationFrame(state.playRaf);
    const tick=()=>{
      if(!state.playing) return;
      const elapsed=(performance.now()-state.playStartedAt)/1000;
      let next=state.playStartFrame + Math.floor(elapsed*fps());
      if(state.loop && state.range.start!=null && state.range.end!=null){
        const a=Math.min(state.range.start,state.range.end), b=Math.max(state.range.start,state.range.end);
        if(b>a && next>=b){
          const span=b-a;
          next=a + ((next-a) % span);
          state.playStartFrame=next;
          state.playStartedAt=performance.now();
        }
      }
      if(next>=maxFrame()){
        state.currentFrame=maxFrame();
        stopPlaybackClock();
        updatePlayhead();
        return;
      }
      if(next!==state.currentFrame){ state.currentFrame=next; updatePlayhead(); }
      state.playRaf=requestAnimationFrame(tick);
    };
    state.playRaf=requestAnimationFrame(tick);
  }
  function stopPlaybackClock(){
    state.playing=false;
    cancelAnimationFrame(state.playRaf);
    $('playPause').textContent='▶';
    $('previewVideo').pause(); $('previewVideoB').pause(); (state.monitorAudios||[]).forEach(a=>a.pause());
  }
  function togglePlay(){
    const v=$('previewVideo'), vB=$('previewVideoB');
    if(!state.playing){
      if(v && !v.muted) v.play().catch(()=>{});
      if(state.previewMode!=='single' && vB && !vB.muted) vB.play().catch(()=>{});
      updatePlaybackAudio();
      state.playing=true;
      $('playPause').textContent='❚❚';
      startPlaybackClock();
    } else {
      stopPlaybackClock();
    }
  }
  function ensureScrubAudioElements(){ if(state.scrubAudios) return state.scrubAudios; state.scrubAudios=[new Audio(),new Audio()]; state.scrubAudios.forEach(a=>{a.preload='auto'; a.volume=state.monitorVolume;}); return state.scrubAudios; }
  function scheduleAudioScrub(){ if(state.playing || state.mute || !state.scrubAudio) return; clearTimeout(state.audioScrubTimer); state.audioScrubTimer=setTimeout(playAudioScrub,35); }
  function playAudioScrub(){
    if(state.playing || state.mute || !state.scrubAudio) return;
    const clips=monitoredAudioClips().slice(0,2); const els=ensureScrubAudioElements();
    els.forEach((a,i)=>{
      const c=clips[i];
      if(!c){ a.pause(); return; }
      const m=monitorMediaFor(c), src=fileUrl(m); if(!src){ a.pause(); return; }
      if(a.dataset.src!==src){ a.pause(); a.src=src; a.dataset.src=src; }
      const sec=Math.max(0,(state.currentFrame-c.start+(c.source_in||0))/(c.fps||fps()));
      try{ a.currentTime=sec; a.volume=state.monitorVolume; a.muted=false; a.play().then(()=>setTimeout(()=>{ if(!state.playing) a.pause(); },180)).catch(()=>{}); }catch{}
    });
  }
  function stepFrame(delta){ if(delta==='first') state.currentFrame=0; else if(delta==='last') state.currentFrame=maxFrame(); else state.currentFrame=clamp(state.currentFrame+Number(delta),0,maxFrame()); updatePlayhead(); }
  function gotoSelectedStart(){ const c=selectedClip(); if(!c) return; state.currentFrame=c.start; updatePlayhead(); }
  function gotoSelectedEnd(){ const c=selectedClip(); if(!c) return; state.currentFrame=clipEnd(c)-1; updatePlayhead(); }
  function playSelectedFromStart(){ const c=selectedClip(); if(c){ state.currentFrame=c.start; updatePlayhead(); } togglePlay(); }

  function splitSelected(){
    const c=selectedClip();
    if(!c || c.kind==='stitched' || state.currentFrame<=c.start || state.currentFrame>=clipEnd(c)) return;
    const leftLen=state.currentFrame-c.start, rightLen=clipEnd(c)-state.currentFrame;
    const left=normalizeClipBounds({...c,id:`clip_${Date.now()}_L`,length:leftLen,source_out:(c.source_in||0)+leftLen,group_id:null,stitch_id:null});
    const right=normalizeClipBounds({...c,id:`clip_${Date.now()}_R`,start:state.currentFrame,length:rightLen,source_in:(c.source_in||0)+leftLen,source_out:(c.source_in||0)+leftLen+rightLen,group_id:null,stitch_id:null});
    state.project.clips=(state.project.clips||[]).filter(x=>x.id!==c.id).concat([left,right]);
    setSelection(right.id); renderAll(); status('Split');
  }
  function stitchSelected(){
    const cs=selectedClips().filter(c=>c.kind!=='stitched').sort((a,b)=>a.start-b.start || a.lane-b.lane);
    if(cs.length<2) return;
    const minStart=Math.min(...cs.map(c=>c.start));
    const maxEnd=Math.max(...cs.map(c=>clipEnd(c)));
    const lane=Math.min(...cs.map(c=>c.lane));
    const children=cs.map(c=>({...c,rel_start:c.start-minStart,orig_start:c.start,orig_lane:c.lane,group_id:null,stitch_id:null}));
    const stitched={id:`stitched_${Date.now()}`,name:`Stitched Clip (${cs.length})`,kind:'stitched',media_id:null,start:minStart,length:maxEnd-minStart,lane,source_in:0,source_out:maxEnd-minStart,children,stitch_id:`stitch_${Date.now()}`};
    state.project.clips=(state.project.clips||[]).filter(c=>!cs.some(x=>x.id===c.id));
    state.project.clips.push(stitched); setSelection(stitched.id); renderAll(); status('Stitched as layer container');
  }
  function unstitchSelected(){
    const cs=selectedClips().filter(c=>c.kind==='stitched'||c.children);
    if(!cs.length) return;
    const restored=[];
    for(const m of cs){
      (m.children||[]).forEach(ch=>{ const c={...ch,id:`clip_${Date.now()}_${Math.random().toString(16).slice(2)}`,start:m.start+(ch.rel_start||0),lane:(ch.orig_lane ?? ch.lane ?? m.lane),group_id:null,stitch_id:null}; delete c.rel_start; delete c.orig_start; restored.push(c); });
    }
    state.project.clips=(state.project.clips||[]).filter(c=>!cs.some(m=>m.id===c.id)).concat(restored);
    setSelection(restored[0]?.id||null); renderAll(); status('UnStitched');
  }
  function deleteSelected(){ if(!state.selectedClipIds.length) return; state.project.clips=state.project.clips.filter(c=>!isSelected(c.id)); setSelection(null); renderAll(); status('Deleted selected clips'); }
  function groupSelected(){ const cs=selectedClips(); if(cs.length){ const gid=`group_${Date.now()}`; cs.forEach(c=>c.group_id=gid); renderAll(); status('Grouped'); } }
  function ungroupSelected(){ selectedClips().forEach(c=>c.group_id=null); renderAll(); status('Ungrouped'); }
  function detachAudio(){ const c=selectedClip(); if(c && c.kind==='video'){ const audio={...c,id:`clip_${Date.now()}_audio`,kind:'audio',name:`${c.name} (Audio)`,lane:clamp(c.lane+1,0,4),audio_detached:true}; state.project.clips.push(audio); setSelection(audio.id); renderAll(); } }

  function updateProps(){
    const body=$('clipProps');
    const c=selectedClip();
    if(!c){ body.innerHTML='No clip selected.'; return; }
    const fontOptions = [`<option value="system">System Default</option>`].concat((state.fonts||[]).map(f=>`<option value="${esc(f.family)}">${esc(f.family)}</option>`)).join('');
    body.innerHTML=`<div class="props-grid">
    <div class="props-section">Clip</div><label>Name</label><input data-prop="name" value="${esc(c.name)}"><label>Type</label><select data-prop="kind"><option>video</option><option>audio</option><option>image</option><option>text</option></select><label>Lane</label><input data-prop="lane" type="number" min="1" max="5" value="${c.lane+1}">
    <div class="props-section">Timing</div><label>Start</label><input data-prop="start" type="number" min="0" value="${c.start}"><label>Length</label><input data-prop="length" type="number" min="1" value="${c.length}"><label>Trim In</label><input data-prop="source_in" type="number" min="0" value="${c.source_in||0}"><label>Trim Out</label><input data-prop="source_out" type="number" min="1" value="${c.source_out||c.length}">
    <div class="props-section">Text / Overlay</div><textarea data-prop="text">${esc(c.text||'')}</textarea><label>Font</label><select data-prop="font_family">${fontOptions}</select><label>X %</label><input data-prop="x" type="number" min="0" max="100" value="${c.x??50}"><label>Y %</label><input data-prop="y" type="number" min="0" max="100" value="${c.y??88}"><label>Size</label><input data-prop="size" type="number" min="8" max="220" value="${c.size||42}"><label>Opacity</label><input data-prop="opacity" type="number" min="0" max="1" step="0.05" value="${c.opacity??1}"><label>Text Color</label><input data-prop="color" type="color" value="${esc(c.color||'#ffffff')}"><label>Shadow</label><label class="inline-check"><input data-prop="shadow_enabled" type="checkbox" ${c.shadow_enabled?'checked':''}> On / Off</label><label>Shadow Color</label><input data-prop="shadow_color" type="color" value="${esc(c.shadow_color||'#000000')}"><label>Shadow Opacity</label><input data-prop="shadow_opacity" type="number" min="0" max="1" step="0.05" value="${c.shadow_opacity??0.6}">
  </div>`;
    const kind=body.querySelector('[data-prop="kind"]'); if(kind) kind.value=c.kind||'video';
    const font=body.querySelector('[data-prop="font_family"]'); if(font) font.value=c.font_family||'system';
    body.addEventListener('mousedown', e=>e.stopPropagation(), true);
    body.addEventListener('pointerdown', e=>e.stopPropagation(), true);
    body.addEventListener('keydown', e=>e.stopPropagation(), true);
    body.querySelectorAll('[data-prop]').forEach(input=>{
      const readValue=()=>{
        const p=input.dataset.prop;
        let v=input.type==='checkbox' ? input.checked : input.value;
        if(['start','length','source_in','source_out','x','y','size','opacity','shadow_opacity'].includes(p)) v=Number(v);
        return {p,v};
      };
      const applyModelOnly=()=>{
        const {p,v}=readValue();
        if(p==='lane') c.lane=clamp(Number(v)-1,0,4);
        else c[p]=v;
        if(p==='kind') c.kind=v;
        normalizeClipBounds(c);
      };
      const commit=()=>{
        applyModelOnly();
        renderAll();
      };

      // IMPORTANT: never render timeline/preview on every keystroke.
      // Rendering while input/textarea is focused replaces DOM and drops the caret after one key.
      input.oninput=()=>{
        applyModelOnly();
        // Live-update only the visible text overlay without rebuilding Clip Properties.
        if(input.dataset.prop==='text' || input.dataset.prop==='color' || input.dataset.prop==='opacity' || input.dataset.prop==='size' || input.dataset.prop==='x' || input.dataset.prop==='y' || input.dataset.prop==='shadow_enabled' || input.dataset.prop==='shadow_color' || input.dataset.prop==='shadow_opacity' || input.dataset.prop==='font_family'){
          updatePreviewTextOnly();
        }
      };
      input.onchange=commit;
      input.onblur=commit;
    });
  }
  function updatePreviewTextOnly(){
    const frame = state.currentFrame;
    const txt = topTextClip(frame);
    const t = $('textOverlay');
    if(!t) return;
    if(!txt){ t.textContent=''; return; }
    t.textContent = txt.text || txt.name || '';
    t.style.left = `${txt.x ?? 50}%`;
    t.style.top = `${txt.y ?? 88}%`;
    t.style.fontSize = `${txt.size || 42}px`;
    t.style.opacity = txt.opacity ?? 1;
    t.style.color = txt.color || '#ffffff';
    t.style.fontFamily = txt.font_family && txt.font_family !== 'system' ? txt.font_family : 'system-ui, sans-serif';
    const so = txt.shadow_enabled ? (txt.shadow_opacity ?? 0.6) : 0;
    t.style.textShadow = txt.shadow_enabled ? `0 2px 8px ${hexToRgba(txt.shadow_color || '#000000', so)}` : 'none';
  }

  function updateControls(){ const two=selectedClips().length===2; $('compareTop').disabled=!two; $('overlayTop').disabled=!two; if(!two && state.previewMode!=='single') state.previewMode='single'; $('previewMode').classList.toggle('active',state.previewMode==='single'); $('compareTop').classList.toggle('active',state.previewMode==='compare'); $('overlayTop').classList.toggle('active',state.previewMode==='overlay'); $('snapToggle').classList.toggle('active',state.snap); $('loopToggle').classList.toggle('active',state.loop); $('muteToggle').classList.toggle('active',state.mute); const sab=$('scrubAudioToggle'); if(sab) sab.classList.toggle('active',state.scrubAudio); $('snapStatus').textContent=state.snap?'ON':'OFF'; $('statusbarFps').textContent=`Project FPS: ${fps().toFixed(3)}`; $('totalStatus').textContent=`Total: ${totalFrames()}f / ${fmtTime(totalFrames())}`; $('projectFpsStatus').textContent=`FPS ${fps().toFixed(3)} · Total ${totalFrames()}f`; }

  function showModal(title,html,footer=''){ $('modalTitle').textContent=title; $('modalBody').innerHTML=html; $('modalFooter').innerHTML=footer||'<button id="modalOk">OK</button>'; $('modal').classList.remove('hidden'); const ok=$('modalOk'); if(ok) ok.onclick=closeModal; }
  function closeModal(){ $('modal').classList.add('hidden'); }
  async function showProjectPopup(){
    showModal('Project Library', `<p class="muted">프로젝트는 ComfyUI/input/ITDA/projects 에 저장됩니다.</p><div id="projectLibraryList" class="project-list"><div class="muted">Loading...</div></div>`, `<button id="projectNew">+ New Project</button><button id="projectOpen">Open</button><button id="projectDuplicate">Duplicate</button><button id="projectRename">Rename</button><button id="projectDelete">Delete</button><button id="modalOk">Close</button>`);
    let selected = state.project?.name || 'itda-project-1';
    const listEl = $('projectLibraryList');
    async function refreshList(){
      try{
        const data=await api('/itda/api/projects');
        const items=data.items||[];
        if(!items.length){ listEl.innerHTML='<div class="muted">No projects yet.</div>'; return; }
        listEl.innerHTML=items.map(it=>`<div class="project-row ${it.name===selected?'active':''}" data-project="${esc(it.name)}">${esc(it.name)}</div>`).join('');
        listEl.querySelectorAll('.project-row').forEach(row=>row.onclick=()=>{selected=row.dataset.project; refreshList();});
      }catch(e){ listEl.innerHTML=`<div class="muted">Project list failed: ${esc(e.message)}</div>`; }
    }
    await refreshList();
    $('projectNew').onclick=async()=>{ const base=prompt('New Project Name','itda-project-1'); if(!base) return; const data=await api('/itda/api/project/new',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:base})}); closeModal(); await initProject(data.project?.name || base); };
    $('projectOpen').onclick=()=>{ if(!selected) return; closeModal(); initProject(selected); };
    $('projectDuplicate').onclick=async()=>{ if(!selected) return; const target=prompt('Duplicate Project Name', `${selected}-copy`); if(!target) return; const data=await api('/itda/api/project/duplicate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:selected,target})}); selected=data.project||target; await refreshList(); status(`Duplicated: ${selected}`); };
    $('projectRename').onclick=async()=>{ if(!selected) return; const target=prompt('Rename Project', selected); if(!target || target===selected) return; try{ const data=await api('/itda/api/project/rename',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:selected,target})}); const renamed=data.project||target; if(state.project?.name===selected){ closeModal(); await initProject(renamed); } else { selected=renamed; await refreshList(); } }catch(e){ alert(`Rename failed: ${e.message}`); } };
    $('projectDelete').onclick=async()=>{ if(!selected) return; if(!confirm(`Delete Project?\n\n${selected}\n\nProject file, media folder, and cache folder will be deleted.`)) return; try{ await api('/itda/api/project/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:selected})}); if(state.project?.name===selected){ closeModal(); await initProject('itda-project-1'); } else { selected=state.project?.name||'itda-project-1'; await refreshList(); } }catch(e){ alert(`Delete failed: ${e.message}`); } };
    $('modalOk').onclick=closeModal;
  }
  function showSettingsPopup(){ showModal('Project Settings', `<div class="modal-grid"><label>Project FPS</label><input id="settingsFps" type="number" min="16" max="120" step="0.001" value="${fps()}"><label>Total Frames</label><input id="settingsTotal" type="number" min="1" value="${totalFrames()}"><label>Frame Policy</label><select id="framePolicy"><option value="normalize">Normalize to Project FPS</option><option value="drop">Frame Drop</option><option value="interpolate">Interpolation</option></select></div><p class="muted">16fps 미만 금지. 60fps 이상은 경고 기준입니다. 설정 변경 시 타임라인 ruler와 클립 프레임 스케일을 동기화합니다.</p>`, `<button id="settingsApply">Apply</button><button id="modalOk">Cancel</button>`); $('settingsApply').onclick=()=>{ const oldFps=fps(); let nf=Number($('settingsFps').value||24); if(nf<16){nf=16;status('16fps 이하 금지: 16fps로 보정');} if(nf>=60) status('60fps 이상 경고'); const total=Number($('settingsTotal').value||DEFAULT_TOTAL); const ratio=nf/oldFps; state.project.settings={...state.project.settings,fps:nf,total_frames:Math.max(1,Math.round(total))}; state.totalFrames=state.project.settings.total_frames; (state.project.clips||[]).forEach(c=>{ c.start=Math.round(c.start*ratio); c.length=Math.max(1,Math.round(c.length*ratio)); c.source_in=Math.round((c.source_in||0)*ratio); c.source_out=Math.round((c.source_out||c.length)*ratio); c.fps=nf; normalizeClipBounds(c); }); closeModal(); renderAll(); }; $('modalOk').onclick=closeModal; }
  function snapshotClipCandidate(){
    const sel=selectedClips();
    let c=sel.find(x=>state.currentFrame>=x.start && state.currentFrame<clipEnd(x) && ['video','image','stitched'].includes(x.kind));
    if(!c) c=topVisualClip(state.currentFrame);
    if(c && (c.kind==='stitched'||c.children)){
      const ch=childClipAtFrame(c,state.currentFrame,['video','image']);
      if(ch) c=ch;
    }
    return c;
  }
  function sourceFrameForClip(c, timelineFrame=state.currentFrame){
    return Math.max(0, Math.round((c.source_in||0) + (timelineFrame - c.start)));
  }
  async function snapshot(){
    const c=snapshotClipCandidate();
    if(c && c.path && (c.kind==='video'||c.kind==='image')){
      try{
        const payload={project:state.project?.name||'itda-project-1',path:c.path,kind:c.kind,source_frame:sourceFrameForClip(c),source_fps:c.original_fps||c.fps||fps()};
        await api('/itda/api/snapshot_frame',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const toast=$('snapshotToast'); toast.textContent=`Snapshot saved · F${payload.source_frame}`; toast.classList.remove('hidden'); setTimeout(()=>toast.classList.add('hidden'),1600); status(`Snapshot saved: source frame ${payload.source_frame}`); return;
      }catch(e){ status(`Original frame snapshot failed, fallback viewport: ${e.message}`); }
    }
    const stage=$('previewStage'); const rect=stage.getBoundingClientRect(); const canvas=document.createElement('canvas'); canvas.width=Math.max(2,Math.round(rect.width)); canvas.height=Math.max(2,Math.round(rect.height)); const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height);
    const drawContain=(el)=>{ if(!el || getComputedStyle(el).display==='none') return; const vw=el.videoWidth||el.naturalWidth, vh=el.videoHeight||el.naturalHeight; if(!vw||!vh) return; const scale=Math.min(canvas.width/vw, canvas.height/vh); const w=vw*scale,h=vh*scale,x=(canvas.width-w)/2,y=(canvas.height-h)/2; try{ctx.drawImage(el,x,y,w,h);}catch{} };
    drawContain($('previewVideo')); drawContain($('previewImage')); drawContain($('previewVideoB')); drawContain($('previewImageB'));
    const text=$('textOverlay'); if(text.textContent){ ctx.font=`${parseInt(text.style.fontSize||42,10)}px sans-serif`; ctx.fillStyle=(state.selectedClipId && findClip(state.selectedClipId)?.color) || '#fff'; ctx.textAlign='center'; ctx.shadowColor='transparent'; ctx.shadowBlur=0; ctx.fillText(text.textContent, canvas.width/2, canvas.height*.82); }
    const blob=await new Promise(res=>canvas.toBlob(res,'image/png'));
    try{ const fd=new FormData(); fd.append('project',state.project?.name||'itda-project-1'); fd.append('image',blob,'snapshot.png'); await fetch('/itda/api/snapshot',{method:'POST',body:fd}).then(r=>{if(!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json();}); const toast=$('snapshotToast'); toast.textContent='Snapshot saved'; toast.classList.remove('hidden'); setTimeout(()=>toast.classList.add('hidden'),1600); status('Snapshot saved to input/ITDA-SNAPSHOT'); }catch(e){ status(`Snapshot failed: ${e.message}`); }
  }

  function applyTooltips(){
    const tips={settingsTop:'Settings (Ctrl+,)',projectMenu:'Project Library (Ctrl+P)',saveProject:'Save Project (Ctrl+S)',exportProject:'Export (Ctrl+E)',sendComfy:'Send To ComfyUI (Ctrl+Enter)',previewMode:'Single Preview (1)',compareTop:'Compare Preview (2) - requires 2 selected clips',overlayTop:'Overlay Preview (3) - requires 2 selected clips',snapshotTop:'Snapshot (P)',fullscreenTop:'Fullscreen (F)',gotoClipStart:'Selected Clip Start',gotoClipEnd:'Selected Clip End',loopToggle:'Loop Range (L)',muteToggle:'Mute Monitor (M)',markIn:'Mark In (I)',markOut:'Mark Out (O)',clearRange:'Clear Range (Alt+X)',snapToggle:'Snap Toggle (S)',splitClip:'Split / Cut (C)',stitchClip:'Stitch selected clips (Shift+M)',unstitchClip:'UnStitch selected clips (Shift+U)',groupClip:'Group selected clips (G)',ungroupClip:'Ungroup selected clips (Shift+G)',detachAudio:'Detach Audio (D)',prerender:'Pre-render selected range (R)',hZoom:'Horizontal Timeline Zoom',vZoom:'Vertical Track Zoom'};
    Object.entries(tips).forEach(([id,t])=>{const el=$(id); if(el) el.title=t;});
  }
  function bind(){
    applyTooltips();
    document.addEventListener('pointerup', e=>{ if(e.target.closest('button,input[type="range"]')) requestAnimationFrame(()=>document.activeElement?.blur?.()); }, true);
    $('saveProject').onclick=saveProject; $('projectMenu').onclick=showProjectPopup; $('settingsTop').onclick=showSettingsPopup; $('exportProject').onclick=()=>showModal('Export','<p>Export engine은 v0.6에서 FFmpeg 렌더 파이프라인과 연결됩니다.</p>'); $('sendComfy').onclick=()=>showModal('Send To ComfyUI','<p>전용 Video Combine 노드 API 전송은 v0.6에서 연결됩니다.</p>');
    $('clearMedia').onclick=()=>{state.media=[]; if(state.project){state.project.media=[];state.project.clips=[];} setSelection(null); renderAll();};
    $('addVideo').onclick=()=>{const fp=$('filePicker'); fp.accept='video/*'; fp.dataset.kind='video'; fp.click();}; $('addAudio').onclick=()=>{const fp=$('filePicker'); fp.accept='audio/*'; fp.dataset.kind='audio'; fp.click();}; $('addImage').onclick=()=>{const fp=$('filePicker'); fp.accept='image/*'; fp.dataset.kind='image'; fp.click();}; $('addText').onclick=addTextMedia; $('filePicker').onchange=e=>{addLocalFiles(e.target.files,e.target.dataset.kind); e.target.value='';};
    $('gridView').onclick=()=>{state.mediaView='grid'; $('gridView').classList.add('active'); $('listView').classList.remove('active'); renderMedia();}; $('listView').onclick=()=>{state.mediaView='list'; $('listView').classList.add('active'); $('gridView').classList.remove('active'); renderMedia();}; $('thumbScale').oninput=e=>{state.mediaThumb=Number(e.target.value)||104; renderMedia();};
    const mediaBin=document.querySelector('.media-bin');
    if(mediaBin){
      mediaBin.addEventListener('dragover',e=>{ if(e.dataTransfer?.types?.includes('Files')){ e.preventDefault(); mediaBin.classList.add('drag-over'); }});
      mediaBin.addEventListener('dragleave',()=>mediaBin.classList.remove('drag-over'));
      mediaBin.addEventListener('drop',e=>{ if(e.dataTransfer?.files?.length){ e.preventDefault(); mediaBin.classList.remove('drag-over'); addLocalFiles(e.dataTransfer.files,null); }});
    }
    $('playPause').onclick=playSelectedFromStart; $('previewStage').onclick=e=>{ if(e.target.id!=='snapshotToast') togglePlay(); }; $('gotoClipStart').onclick=gotoSelectedStart; $('gotoClipEnd').onclick=gotoSelectedEnd; $('compareTop').onclick=()=>{ if(selectedClips().length===2){state.previewMode=state.previewMode==='compare'?'single':'compare'; renderAll();} }; $('overlayTop').onclick=()=>{ if(selectedClips().length===2){state.previewMode=state.previewMode==='overlay'?'single':'overlay'; renderAll();} }; $('previewMode').onclick=()=>{state.previewMode='single'; renderAll();}; $('snapshotTop').onclick=snapshot; $('fullscreenTop').onclick=()=>{ const el=$('previewStage'); if(document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.(); };
    document.querySelectorAll('[data-step]').forEach(btn=>btn.onclick=()=>stepFrame(btn.dataset.step)); $('snapToggle').onclick=()=>{state.snap=!state.snap; updateControls();}; $('loopToggle').onclick=()=>{state.loop=!state.loop; updateControls();}; $('muteToggle').onclick=()=>{state.mute=!state.mute; updateControls(); updatePreview();}; $('scrubAudioToggle').onclick=()=>{state.scrubAudio=!state.scrubAudio; updateControls(); if(!state.scrubAudio)(state.scrubAudios||[]).forEach(a=>a.pause());}; $('monitorVolume').oninput=e=>{const v=Math.min(100,Math.max(0,Number(e.target.value)||0)); e.target.value=v; state.monitorVolume=v/100; $('volumeLabel').textContent=`${v}%`; [$('previewVideo'),$('previewVideoB'),...(state.scrubAudios||[]),...(state.monitorAudios||[])].forEach(a=>{ if(a){ a.volume=state.monitorVolume; if(v>0 && !state.mute) a.muted=false; }});}; $('markIn').onclick=()=>{state.range.start=state.currentFrame; renderRange();}; $('markOut').onclick=()=>{state.range.end=state.currentFrame; renderRange();}; $('clearRange').onclick=()=>{state.range={start:null,end:null}; renderRange();};
    $('splitClip').onclick=splitSelected; $('stitchClip').onclick=stitchSelected; $('unstitchClip').onclick=unstitchSelected; $('groupClip').onclick=groupSelected; $('ungroupClip').onclick=ungroupSelected; $('detachAudio').onclick=detachAudio; $('prerender').onclick=async()=>{await api('/itda/api/prerender',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:state.project?.name,range:state.range})}); status('Pre-render stub called');}; const hz=$('hZoom'); if(hz) hz.oninput=e=>{state.pxPerFrame=Number(e.target.value)||state.pxPerFrame; renderTimeline();}; const vz=$('vZoom'); if(vz) vz.oninput=e=>{state.laneHeight=Number(e.target.value)||DEFAULT_LANE_H; renderTimeline();};
    const timeline=$('timeline'), ruler=$('ruler'); let scrubbing=false; const scrub=e=>{state.currentFrame=frameFromTimelineEvent(e); if(state.playing){state.playStartFrame=state.currentFrame; state.playStartedAt=performance.now();} updatePlayhead();}; ruler.addEventListener('mousedown',e=>{e.preventDefault(); e.stopPropagation(); scrubbing=true; scrub(e);}); document.addEventListener('mousemove',e=>{if(scrubbing){e.preventDefault(); scrub(e);}}); document.addEventListener('mouseup',e=>{ if(scrubbing){ e.preventDefault?.(); e.stopPropagation?.(); } scrubbing=false;});
    timeline.addEventListener('mousedown',e=>{ if(e.target.closest('.clip')||e.target.closest('.lane-label')||e.target.closest('#ruler')) return; e.preventDefault(); setSelection(null); state.currentFrame=frameFromTimelineEvent(e); renderAll(); });
    timeline.addEventListener('dragover',e=>{e.preventDefault();}); timeline.addEventListener('drop',e=>{e.preventDefault(); const raw=e.dataTransfer.getData('application/itda-media'); if(!raw) return; const item=JSON.parse(raw); addClipFromMedia(item,frameFromTimelineEvent(e)); const c=selectedClip(); if(c){ const lane=laneFromTimelineEvent(e); if(!state.lockedLanes[lane]){ const fitted=fitSingleMove(c,c.start,lane,1); c.lane=fitted.lane; c.start=fitted.start; } renderAll(); }});
    timeline.addEventListener('wheel',e=>{ if(!e.ctrlKey) return; e.preventDefault(); const old=state.pxPerFrame; state.pxPerFrame=Math.max(.5,Math.min(20,state.pxPerFrame+(e.deltaY<0?.5:-.5))); timeline.scrollLeft=timeline.scrollLeft*(state.pxPerFrame/old); renderTimeline(); },{passive:false});
    function isShortcutBlockedByTextInput(e){
      if(e.isComposing) return true;
      const editableTypes = new Set(['text','number','search','url','email','password','tel','color','date','datetime-local','month','week','time']);
      const nodes = [];
      if(e.target) nodes.push(e.target);
      if(document.activeElement) nodes.push(document.activeElement);
      if(typeof e.composedPath === 'function') nodes.push(...e.composedPath());
      return nodes.some(el=>{
        if(!el || el === window || el === document || !el.tagName) return false;
        const tag = el.tagName.toUpperCase();
        if(el.isContentEditable) return true;
        if(tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if(tag === 'INPUT'){
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          return editableTypes.has(type);
        }
        return false;
      });
    }
    document.addEventListener('keydown',e=>{
      if(isShortcutBlockedByTextInput(e)) return;
      const k=e.key.toLowerCase();
      if((e.ctrlKey||e.metaKey) && k===','){e.preventDefault(); showSettingsPopup(); return;}
      if((e.ctrlKey||e.metaKey) && k==='p'){e.preventDefault(); showProjectPopup(); return;}
      if((e.ctrlKey||e.metaKey) && k==='s'){e.preventDefault(); saveProject(); return;}
      if((e.ctrlKey||e.metaKey) && k==='e'){e.preventDefault(); $('exportProject').click(); return;}
      if((e.ctrlKey||e.metaKey) && e.key==='Enter'){e.preventDefault(); $('sendComfy').click(); return;}
      if(e.code==='Space'){e.preventDefault(); togglePlay();}
      else if(e.key==='Escape'){setSelection(null); renderAll();}
      else if(e.key==='Delete'||e.key==='Backspace') deleteSelected();
      else if(e.key==='ArrowLeft'&&e.altKey) stepFrame('first');
      else if(e.key==='ArrowRight'&&e.altKey) stepFrame('last');
      else if(e.key==='ArrowLeft'&&e.shiftKey) stepFrame(-5);
      else if(e.key==='ArrowRight'&&e.shiftKey) stepFrame(5);
      else if(e.key==='ArrowLeft') stepFrame(-1);
      else if(e.key==='ArrowRight') stepFrame(1);
      else if(k==='s' && !e.ctrlKey && !e.metaKey){state.snap=!state.snap; updateControls();}
      else if(k==='i'){state.range.start=state.currentFrame; renderRange();}
      else if(k==='o'){state.range.end=state.currentFrame; renderRange();}
      else if(k==='x'&&e.altKey){state.range={start:null,end:null}; renderRange();}
      else if(k==='l'){state.loop=!state.loop; updateControls();}
      else if(k==='m'&&e.shiftKey){stitchSelected();}
      else if(k==='u'&&e.shiftKey){unstitchSelected();}
      else if(k==='c'){splitSelected();}
      else if(k==='g'&&e.shiftKey){ungroupSelected();}
      else if(k==='g'){groupSelected();}
      else if(k==='d'&&!e.ctrlKey&&!e.metaKey){detachAudio();}
      else if(k==='r'){ $('prerender').click();}
      else if(k==='m'){state.mute=!state.mute; updateControls(); updatePreview();}
      else if(k==='a'){state.scrubAudio=!state.scrubAudio; updateControls(); if(!state.scrubAudio)(state.scrubAudios||[]).forEach(x=>x.pause());}
      else if(k==='f'){$('fullscreenTop').click();}
      else if(k==='1'){state.previewMode='single'; renderAll();}
      else if(k==='2'){if(selectedClips().length===2){state.previewMode=state.previewMode==='compare'?'single':'compare'; renderAll();}}
      else if(k==='3'){if(selectedClips().length===2){state.previewMode=state.previewMode==='overlay'?'single':'overlay'; renderAll();}}
      else if(k==='p') snapshot();
      else if(e.key==='='||e.key==='+'){state.pxPerFrame=Math.min(20,state.pxPerFrame+.5); if($('hZoom')) $('hZoom').value=state.pxPerFrame; renderTimeline();}
      else if(e.key==='-'){state.pxPerFrame=Math.max(.5,state.pxPerFrame-.5); if($('hZoom')) $('hZoom').value=state.pxPerFrame; renderTimeline();}
    });
    $('previewVideo').addEventListener('timeupdate',()=>{ /* playhead is driven by frame clock, not video end events */ });
    let resizing=false; $('resizeHandle').addEventListener('mousedown',()=>resizing=true); document.addEventListener('mousemove',e=>{ if(!resizing) return; const y=e.clientY-46,h=window.innerHeight-46,upper=Math.max(250,Math.min(h-210,y)); $('upperPane').style.height=`${upper}px`; document.querySelector('.lower').style.height=`${h-upper-5}px`; }); document.addEventListener('mouseup',()=>resizing=false); $('modalClose').onclick=closeModal; $('modal').addEventListener('click',e=>{if(e.target.id==='modal') closeModal();});
  }
  bind(); initProject().catch(e=>status(`Init failed: ${e.message}`));
})();
