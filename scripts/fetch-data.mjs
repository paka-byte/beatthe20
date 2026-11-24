// ดึงข้อมูลจริงมาสร้าง data/keepers.json
//   - ประตูที่เสีย + จุดยิง + มุมในกรอบประตู + xGOT  ← FotMob shotmap (Premier League id 47)
//   - ชื่อโกล + รหัสรูปนักเตะ                            ← FPL API (bootstrap-static)
// วิธีใช้:  node scripts/fetch-data.mjs          (ต้องใช้ Node 18 ขึ้นไป)
// รันซ้ำได้ทุก GW: แมตช์ที่ดึงแล้วจะเก็บ cache ไว้ใน .cache/ ไม่ดึงซ้ำ

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ---------------- CONFIG ---------------- */
const LEAGUE_ID = 47;                 // FotMob Premier League
const SEASON = "";                    // ว่าง = ฤดูกาลปัจจุบัน หรือใส่ "2026/2027"
const SLEEP_MS = 400;                 // เว้นระยะระหว่างคำขอ อย่ายิงถี่
const FLIP_X = false;                 // ถ้าเปิดเกมแล้วเห็นว่ามุมซ้าย/ขวากลับด้าน ให้เปลี่ยนเป็น true
const FLIP_Y = false;                 // ถ้าสูง/ต่ำกลับด้าน ให้เปลี่ยนเป็น true
const FLIP_LAT = true;                // FotMob/Opta: y<34 คือฝั่งขวาของคนยิง จึงต้องกลับ (ถ้าซ้าย/ขวากรอบกลับด้าน ให้เปลี่ยนเป็น false)
// ถ้าจับคู่ชื่อทีม FotMob → FPL ผิด ให้ใส่เองตรงนี้ เช่น { "Wolverhampton Wanderers": "Wolves" }
const TEAM_OVERRIDES = {};
// ถ้าอยากเลือกโกลเอง (แทนคนที่ลงเล่นนาทีเยอะสุด) ใส่ชื่อทีม FPL: FPL element id เช่น { "Arsenal": 5 }
const KEEPER_OVERRIDES = {};

const GOAL_W = 7.32, GOAL_H = 2.44;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache");
const OUT = path.join(ROOT, "data", "keepers.json");
// ถ้า FotMob บล็อกการดึงจาก Node: ให้ดึงผ่านเบราว์เซอร์ด้วย scripts/fotmob-in-browser.js แล้ววางไฟล์ไว้ที่นี่ สคริปต์จะใช้ไฟล์นี้แทน
const RAW = path.join(ROOT, "data", "fotmob-raw.json");
let RAWDATA = null;
const IN_CI = !!process.env.CI;   // บน GitHub Actions: ถ้าดึงสดไม่ได้ให้ล้ม (จะได้รู้) แทนการใช้ไฟล์เก่า
const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", "accept-language": "en" };

/* ---------------- helpers ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ø/g, "o").replace(/[^a-z]/g, "");
const tokens = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !["fc", "afc", "and", "the"].includes(t));
const clamp01 = (v) => Math.max(0, Math.min(1, v));

async function get(url, asJson) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return asJson ? await r.json() : await r.text();
    } catch (e) {
      if (i === 1) throw new Error(`${url} → ${e.message}`);
      await sleep(1500);
    }
  }
}
async function tryJson(url) { try { return await get(url, true); } catch { return null; } }
async function nextData(url) {
  const html = await get(url, false);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`ไม่เจอ __NEXT_DATA__ ใน ${url}`);
  return JSON.parse(m[1]);
}
function deepFind(obj, pred, out = [], seen = new Set()) {
  if (!obj || typeof obj !== "object" || seen.has(obj)) return out;
  seen.add(obj);
  if (pred(obj)) out.push(obj);
  for (const v of Object.values(obj)) deepFind(v, pred, out, seen);
  return out;
}
async function cached(name, fn) {
  const f = path.join(CACHE, name);
  try { return JSON.parse(await fs.readFile(f, "utf8")); } catch {}
  const v = await fn();
  await fs.writeFile(f, JSON.stringify(v));
  return v;
}
function zoneOf(dx, lat, situation) {
  if (situation === "Penalty") return "pen";
  const a = Math.abs(lat);
  if (dx <= 5.5 && a <= 9.16) return "six";
  if (dx <= 16.5 && a <= 9.16) return "boxC";
  if (dx <= 16.5 && a <= 20.16) return lat < 0 ? "boxL" : "boxR";
  if (dx <= 25 && a <= 20.16) return "edge";
  return "long";
}

/* ---------------- 1) FPL ---------------- */
async function loadFpl() {
  console.log("• FPL bootstrap-static …");
  let j = null;
  try { j = await get("https://fantasy.premierleague.com/api/bootstrap-static/", true); } catch (e) {
    try { j = JSON.parse(await fs.readFile(path.join(ROOT, "data", "fpl-bootstrap.json"), "utf8")); console.log("  ดึง FPL ไม่ได้ ใช้ไฟล์ data/fpl-bootstrap.json แทน"); } catch { throw e; }
  }
  return { teams: j.teams, elements: j.elements };
}

/* ---------------- 2) FotMob fixtures ---------------- */
async function loadFixtures() {
  try { return await loadFixturesLive(); }
  catch (e) {
    if (IN_CI) throw e;
    try { RAWDATA = JSON.parse(await fs.readFile(RAW, "utf8")); } catch { throw e; }
    console.log(`  ⚠ ดึง FotMob ไม่ได้ (${e.message}) → ใช้ไฟล์ data/fotmob-raw.json (${RAWDATA.fixtures.length} นัด)`);
    return RAWDATA.fixtures;
  }
}
async function loadFixturesLive() {
  console.log("• FotMob fixtures …");
  const q = SEASON ? `&season=${encodeURIComponent(SEASON)}` : "";
  let src = await tryJson(`https://www.fotmob.com/api/data/leagues?id=${LEAGUE_ID}&ccode3=THA${q}`)
    || await tryJson(`https://www.fotmob.com/api/leagues?id=${LEAGUE_ID}&ccode3=THA${q}`);
  if (!src) {
    const s = SEASON ? `?season=${SEASON.replace("/", "-")}` : "";
    src = await nextData(`https://www.fotmob.com/leagues/${LEAGUE_ID}/fixtures/premier-league${s}`);
  }
  const ms = deepFind(src, (o) => o.pageUrl && o.home && o.away && o.status && o.id);
  const uniq = new Map();
  for (const m of ms) if (m.status.finished && !m.status.cancelled) uniq.set(String(m.id), m);
  console.log(`  แมตช์ที่แข่งจบแล้ว: ${uniq.size}`);
  return [...uniq.values()];
}

/* ---------------- 3) FotMob shotmap per match ---------------- */
async function loadMatch(m) {
  if (RAWDATA) { const r = RAWDATA.matches[String(m.id)]; if (!r) throw new Error("ไม่มีในไฟล์ raw"); return r; }
  return cached(`match-${m.id}.json`, async () => {
    await sleep(SLEEP_MS);
    let src = await tryJson(`https://www.fotmob.com/api/data/matchDetails?matchId=${m.id}`);
    if (!src || !deepFind(src, (o) => Array.isArray(o.shots)).length) src = await tryJson(`https://www.fotmob.com/api/matchDetails?matchId=${m.id}`);
    if (!src || !deepFind(src, (o) => Array.isArray(o.shots)).length) src = await nextData(`https://www.fotmob.com${m.pageUrl.split("#")[0]}`);
    const shotsHolder = deepFind(src, (o) => Array.isArray(o.shots) && o.shots.length && "eventType" in o.shots[0])[0];
    const colors = deepFind(src, (o) => o.teamColors)[0]?.teamColors || null;
    return { shots: shotsHolder ? shotsHolder.shots : [], colors };
  });
}

/* ---------------- 4) matching FotMob ↔ FPL ---------------- */
function matchTeam(fotName, fplTeams) {
  if (TEAM_OVERRIDES[fotName]) return fplTeams.find((t) => t.name === TEAM_OVERRIDES[fotName]);
  const ft = tokens(fotName);
  let best = null, bestS = 0;
  for (const t of fplTeams) {
    const tt = [...tokens(t.name), ...tokens(t.short_name)];
    let s = 0;
    for (const a of ft) for (const b of tt) if (a === b) s += 3; else if (a.startsWith(b) || b.startsWith(a)) s += 2;
    if (norm(fotName) === norm(t.name)) s += 10;
    const alias = { "manchester city": "man city", "manchester united": "man utd", "tottenham hotspur": "spurs", "nottingham forest": "nott'm forest", "wolverhampton wanderers": "wolves", "brighton & hove albion": "brighton", "newcastle united": "newcastle", "west ham united": "west ham", "leeds united": "leeds", "afc bournemouth": "bournemouth" }[fotName.toLowerCase()];
    if (alias && alias === t.name.toLowerCase()) s += 20;
    if (s > bestS) { bestS = s; best = t; }
  }
  return best;
}
function matchPlayer(shot, fplTeamId, elements) {
  const full = norm(shot.fullName || shot.playerName);
  const last = norm(shot.lastName || String(shot.playerName || "").split(" ").slice(-1)[0]);
  const first = norm(shot.firstName || String(shot.playerName || "").split(" ")[0]);
  const test = (pool) =>
    pool.find((e) => norm(e.first_name + e.second_name) === full) ||
    pool.find((e) => norm(e.web_name) === full || norm(e.web_name) === last) ||
    pool.find((e) => norm(e.second_name).includes(last) && last.length > 3 && norm(e.first_name)[0] === first[0]) ||
    pool.find((e) => full.endsWith(norm(e.web_name)) && norm(e.web_name).length > 3);
  return test(elements.filter((e) => e.team === fplTeamId)) || test(elements) || null;
}

/* ---------------- main ---------------- */
async function main() {
  await fs.mkdir(CACHE, { recursive: true });
  await fs.mkdir(path.dirname(OUT), { recursive: true });

  const fpl = await loadFpl();
  const fixtures = await loadFixtures();

  const teams = new Map(); // fotmob team id → aggregate
  const T = (id, name) => {
    if (!teams.has(id)) teams.set(id, { fotId: id, name, conceded: 0, goals: [], colors: null, ownGoalsAgainst: 0 });
    return teams.get(id);
  };

  let i = 0;
  for (const m of fixtures) {
    i++;
    process.stdout.write(`\r• shotmap ${i}/${fixtures.length}  `);
    const home = T(String(m.home.id), m.home.name), away = T(String(m.away.id), m.away.name);
    const hs = Number(m.home.score ?? String(m.status.scoreStr || "").split("-")[0]) || 0;
    const as = Number(m.away.score ?? String(m.status.scoreStr || "").split("-")[1]) || 0;
    home.conceded += as; away.conceded += hs;

    let md;
    try { md = await loadMatch(m); } catch (e) { console.warn(`\n  ⚠ ข้าม ${m.home.name}-${m.away.name}: ${e.message}`); continue; }
    const lc = md.colors?.lightMode || md.colors || {};
    if (!home.colors && typeof lc.home === "string") home.colors = lc.home;
    if (!away.colors && typeof lc.away === "string") away.colors = lc.away;

    const gw = Number(m.round ?? m.roundName) || null;
    for (const s of md.shots) {
      if (s.eventType !== "Goal") continue;
      const shooterTeam = String(s.teamId) === home.fotId ? home : away;
      const concTeam = shooterTeam === home ? away : home;
      if (s.isOwnGoal) { concTeam.ownGoalsAgainst++; continue; }
      const og = s.onGoalShot || {};
      let gx = og.x != null ? og.x / 2 : null;
      let gy = og.y != null ? og.y / (2 * GOAL_H / GOAL_W) : null;
      if (gx == null && s.goalCrossedY != null) { gx = (s.goalCrossedY - (34 - GOAL_W / 2)) / GOAL_W; gy = (s.goalCrossedZ ?? 0.5) / GOAL_H; }
      if (gx == null) continue;
      if (FLIP_X) gx = 1 - gx;
      if (FLIP_Y) gy = 1 - gy;
      const dx = 105 - Number(s.x ?? 94), lat = (Number(s.y ?? 34) - 34) * (FLIP_LAT ? -1 : 1);
      concTeam.goals.push({
        _shot: { fullName: s.fullName, playerName: s.playerName, firstName: s.firstName, lastName: s.lastName },
        _shooterFot: shooterTeam.name,
        shooter: s.playerName || s.fullName || "?",
        opponent: shooterTeam.name,
        gw, minute: s.min != null ? s.min + (s.minAdded ? Number(s.minAdded) : 0) : null,
        situation: s.situation || null,
        zone: zoneOf(dx, lat, s.situation),
        gx: +clamp01(gx).toFixed(3), gy: +clamp01(gy).toFixed(3),
        xgot: s.expectedGoalsOnTarget != null ? +Number(s.expectedGoalsOnTarget).toFixed(2) : null,
        xg: s.expectedGoals != null ? +Number(s.expectedGoals).toFixed(2) : null,
        foot: s.shotType || null,            // RightFoot / LeftFoot / Header
        dx: +dx.toFixed(1), lat: +lat.toFixed(1),   // จุดยิง: ระยะจากเส้นประตู / ระยะจากกึ่งกลาง (เมตร)
      });
    }
  }
  console.log("");

  // map → FPL + keeper
  const keepers = [];
  for (const t of teams.values()) {
    const ft = matchTeam(t.name, fpl.teams);
    if (!ft) { console.warn(`  ⚠ จับคู่ทีม FPL ไม่ได้: ${t.name} (ใส่ TEAM_OVERRIDES)`); continue; }
    const gks = fpl.elements.filter((e) => e.team === ft.id && e.element_type === 1).sort((a, b) => b.minutes - a.minutes);
    const gk = KEEPER_OVERRIDES[ft.name] ? fpl.elements.find((e) => e.id === KEEPER_OVERRIDES[ft.name]) : gks[0];
    let unmatched = 0;
    const goals = t.goals.map((g) => {
      const shooterFpl = matchTeam(g._shooterFot, fpl.teams);
      const p = matchPlayer(g._shot, shooterFpl?.id, fpl.elements);
      if (!p) unmatched++;
      const { _shot, _shooterFot, ...rest } = g;
      return { ...rest, shooter: p ? p.web_name : g.shooter, shooterCode: p ? p.code : null, opponent: shooterFpl ? shooterFpl.name : g.opponent };
    });
    const col = t.colors;
    keepers.push({
      team: ft.name, teamShort: ft.short_name,
      color: typeof col === "string" ? col : "#d7263d", color2: "#ffffff",
      keeper: { name: gk ? gk.web_name : `${ft.name} GK`, code: gk ? gk.code : null },
      conceded: t.conceded,
      goals,
    });
    console.log(`  ${ft.short_name.padEnd(4)} ${String(t.conceded).padStart(3)} เสีย · ${goals.length} ลูกในเกม · OG ${t.ownGoalsAgainst} · โกล ${gk?.web_name}${unmatched ? ` · หารูปคนยิงไม่เจอ ${unmatched}` : ""}`);
  }

  keepers.sort((a, b) => b.conceded - a.conceded);
  const out = { season: SEASON || "current", updatedAt: new Date().toISOString(), source: "FotMob shotmap + FPL", keepers };
  await fs.writeFile(OUT, JSON.stringify(out, null, 1));
  console.log(`\n✅ เขียน ${path.relative(ROOT, OUT)} แล้ว (${keepers.length} ทีม, ${keepers.reduce((s, k) => s + k.goals.length, 0)} ประตู)`);
}

main().catch((e) => { console.error("\n❌", e.message); process.exit(1); });
