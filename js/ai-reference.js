import { blankPattern, barMs, slotAtMs, slotOffsetMs, totalSlots } from './patterns.js';
import { quantizeTake } from './rhythm-capture-model.js';

// Keep the whole song by splitting it into editable sections. Assign boundary
// hits to their nearest global grid position before quantizing each section.
export function candidateArrangement(candidate, id = null) {
  const clock=blankPattern({bpm:candidate.bpm,beats:candidate.meter?.beats ?? 4,beatUnit:candidate.meter?.beatUnit ?? 4,
    division:candidate.division===12?12:16,bars:8});
  const offset=Math.max(0,Number(candidate.offsetSeconds)||0),duration=Number(candidate.durationSeconds)-offset;
  if(!Number.isFinite(duration)||duration<=0)throw new Error('The first beat must be inside the song.');
  const bars=Math.ceil(duration*1000/barMs(clock)),count=Math.ceil(bars/8);
  if(count>128)throw new Error('The song exceeds 1,024 bars. Choose a shorter excerpt.');
  const groups=Array.from({length:count},()=>[]),sectionMs=barMs(clock)*8,slots=totalSlots(clock);
  for(const event of candidate.events || []){
    const time=(event.timeSeconds-offset)*1000;if(!Number.isFinite(time))continue;
    const position=slotAtMs(clock,time),nearest=[Math.floor(position),Math.ceil(position)]
      .sort((a,b)=>Math.abs(slotOffsetMs(clock,a)-time)-Math.abs(slotOffsetMs(clock,b)-time))[0];
    const index=Math.floor(nearest/slots);if(index<0||index>=count)continue;
    groups[index].push({inst:event.inst,vel:event.velocity,timeMs:time-index*sectionMs});
  }
  const name=String(candidate.fileName || 'AI drum reference').replace(/\.[^.]+$/,'');
  return {id,name,sections:groups.map((hits,index)=>{
    const sectionName=`${name} · ${index*8+1}–${Math.min(bars,index*8+8)}`;
    const result=quantizeTake(hits,{...clock,bars:Math.min(8,bars-index*8),name:sectionName,quantize:String(clock.division)});
    return {name:sectionName,pattern:result.pattern,bpm:clock.bpm,repeats:1};
  })};
}
