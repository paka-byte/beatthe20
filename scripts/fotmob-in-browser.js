// ใช้เมื่อ `npm run fetch` ดึง FotMob ไม่ได้ (โดนบล็อก)
// 1) เปิด https://www.fotmob.com/leagues/47/fixtures/premier-league ใน Chrome
// 2) กด F12 → แท็บ Console → วางโค้ดทั้งหมดนี้ แล้วกด Enter (รอประมาณ 1 นาที)
// 3) จะได้ไฟล์ fotmob-raw.json ในโฟลเดอร์ Downloads → ย้ายไปไว้ที่ beat-the-20\data\fotmob-raw.json
// 4) รัน `npm run fetch` อีกครั้ง สคริปต์จะใช้ไฟล์นี้แทนการดึงจาก FotMob
(async()=>{
  const find=(o,p,d=0)=>{ if(!o||typeof o!=='object'||d>9) return null; if(p(o)) return o; for(const v of Object.values(o)){ const r=find(v,p,d+1); if(r) return r;} return null; };
  const lj=await (await fetch('/api/data/leagues?id=47')).json();
  const ms=(lj.fixtures?.allMatches||[]).filter(m=>m.status?.finished && !m.status?.cancelled);
  const R={source:'fotmob-browser', fetchedAt:new Date().toISOString(), fixtures:[], matches:{}};
  for(const [i,m0] of ms.entries()){
    const m={id:String(m0.id),round:m0.round,pageUrl:m0.pageUrl,home:{id:String(m0.home.id),name:m0.home.name},away:{id:String(m0.away.id),name:m0.away.name},status:{finished:true,scoreStr:m0.status.scoreStr}};
    const j=await (await fetch(`/api/data/matchDetails?matchId=${m.id}`)).json();
    const sm=find(j,o=>Array.isArray(o.shots)&&o.shots.length&&'eventType' in o.shots[0]);
    const hs=j.header?.teams||[]; m.home.score=hs[0]?.score; m.away.score=hs[1]?.score;
    R.fixtures.push(m);
    R.matches[m.id]={colors:j.general?.teamColors||null, shots:(sm?sm.shots:[]).filter(s=>s.eventType==='Goal').map(s=>({teamId:s.teamId,playerName:s.playerName,fullName:s.fullName,firstName:s.firstName,lastName:s.lastName,x:s.x,y:s.y,min:s.min,minAdded:s.minAdded,situation:s.situation,shotType:s.shotType,isOwnGoal:s.isOwnGoal,expectedGoals:s.expectedGoals,expectedGoalsOnTarget:s.expectedGoalsOnTarget,onGoalShot:s.onGoalShot,goalCrossedY:s.goalCrossedY,goalCrossedZ:s.goalCrossedZ,eventType:'Goal'}))};
    console.log(`${i+1}/${ms.length} ${m.home.name} ${m.home.score}-${m.away.score} ${m.away.name}`);
    await new Promise(r=>setTimeout(r,250));
  }
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(R)],{type:'application/json'})); a.download='fotmob-raw.json'; a.click();
  console.log('✅ ดาวน์โหลด fotmob-raw.json แล้ว');
})();
