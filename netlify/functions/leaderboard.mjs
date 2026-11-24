// Leaderboard API
//   GET  /api/leaderboard?board=all | daily-YYYY-MM-DD
//   POST /api/leaderboard {name, score, level, goals, season, daily?, like?}
// คะแนนทุกรอบเข้า "all" · ถ้าเป็นโหมด Daily จะเข้า "daily-วันที่" ด้วย · เก็บใน Netlify Blobs
import { getStore } from "@netlify/blobs";

const MAX_ENTRIES = 100;
// เพดานแต้ม: (20 ด่าน + ชีวิตพิเศษ) × 5 ลูก × 500 + โบนัสผ่านด่าน 200 × 20 + วงล้อ 300 × 19
const MAX_SCORE = 30 * 5 * 500 + 20 * 200 + 19 * 300;
const BOARD_RE = /^(all|hc|daily-\d{4}-\d{2}-\d{2})$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const todayBKK = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

export default async (req) => {
  const store = getStore("beat-the-20");
  const read = async (board) => (await store.get(board, { type: "json" })) || [];
  const write = async (board, list) => store.setJSON(board, list.slice(0, MAX_ENTRIES));

  if (req.method === "GET") {
    const board = new URL(req.url).searchParams.get("board") || "all";
    if (!BOARD_RE.test(board)) return json({ error: "bad board" }, 400);
    return json({ board, entries: (await read(board)).slice(0, 50) });
  }

  if (req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const name = String(b.name || "").replace(/[<>]/g, "").trim().slice(0, 16) || "ไม่ประสงค์ออกนาม";
    const score = Math.floor(Number(b.score));
    const level = Math.floor(Number(b.level));
    const goals = Math.floor(Number(b.goals));
    const isHc = b.mode === "hc";
    // Hardcore ยิงไม่รู้จบ: เพดานต่อประตู 100 + 200 + โบนัสติดกัน 200 = 500 · โบนัสวงล้อสูงสุด 300 ทุก 5 ลูก
    const cap = isHc ? goals * 560 + 1000 : MAX_SCORE;
    if (!Number.isFinite(score) || score < 0 || score > cap) return json({ error: "bad score" }, 400);
    if (isHc ? !(goals >= 0 && goals <= 5000) : (!(level >= 1 && level <= 20) || !(goals >= 0 && goals <= 105))) return json({ error: "bad level/goals" }, 400);
    const entry = {
      name, score, level, goals,
      like: String(b.like || "").replace(/[<>]/g, "").slice(0, 30),
      season: String(b.season || "").slice(0, 12),
      at: Date.now(),
    };
    const hc = b.mode === "hc";
    const boards = [hc ? "hc" : "all"];
    // รับเฉพาะ "วันนี้" (เวลาไทย) หรือเมื่อวาน (เผื่อเล่นข้ามเที่ยงคืน) · Hardcore มีกระดานแยก
    if (b.daily && !hc) {
      const d = String(b.daily);
      const y = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(Date.now() - 864e5));
      if (d === todayBKK() || d === y) boards.push(`daily-${d}`);
    }
    for (const board of boards) {
      const list = await read(board);
      list.push(entry);
      list.sort((a, c) => c.score - a.score || a.at - c.at);
      await write(board, list);
    }
    return json({ ok: true, boards });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/leaderboard" };
