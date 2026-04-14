import { useState, useEffect } from "react";
import { db } from "./firebase";
import { ref, set, onValue, push, update } from "firebase/database";

const WORDS = [
  "genghis khan", "dawaasuren bagsh", "2022 on", "нохой", "цас", "дэвтэр", "гутал", "машин",
  "тэнгэр", "талх", "сар", "гар", "8dugaar angi", "zunii amralt", "JESUS CHRIST", "USA",
  "MONGOLIA", "BOTANIK", "SHUNIIN DELGUUR", "baga angi", "1r angi", "гол", "godzilla", "чулуу",
];

function getMaxImposters(n) { return n <= 4 ? 1 : n <= 6 ? 2 : 3; }
function getMaxSeconds(n) { return n <= 4 ? 30 : n <= 6 ? 60 : 120; }
function getSecOptions(n) { return n <= 4 ? [60,120] : n <= 6 ? [60,120,180] : [60,90,120]; }

export default function App() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [joined, setJoined] = useState(false);
  const [players, setPlayers] = useState([]);
  const [myRoom, setMyRoom] = useState("");
  const [myId, setMyId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [gameState, setGameState] = useState(null);
  const [myWord, setMyWord] = useState("");
  const [myRole, setMyRole] = useState("");
  const [hasVoted, setHasVoted] = useState(false);
  const [voteResult, setVoteResult] = useState(null);
  const [selectedImposterCount, setSelectedImposterCount] = useState(1);
  const [selectedSeconds, setSelectedSeconds] = useState(30);
  const [timer, setTimer] = useState(null);
  const [discussTimer, setDiscussTimer] = useState(null);

  useEffect(() => {
    const mi = getMaxImposters(players.length);
    const ms = getMaxSeconds(players.length);
    if (selectedImposterCount > mi) setSelectedImposterCount(mi);
    if (selectedSeconds > ms) setSelectedSeconds(ms);
  }, [players.length]);

  useEffect(() => {
    if (gameState?.status === "voting" && gameState?.timerEnd) {
      const iv = setInterval(() => {
        const r = Math.ceil((gameState.timerEnd - Date.now()) / 1000);
        setTimer(r > 0 ? r : 0);
        if (r <= 0) clearInterval(iv);
      }, 500);
      return () => clearInterval(iv);
    }
    if (gameState?.status === "playing" && gameState?.discussEnd) {
      const iv = setInterval(() => {
        const r = Math.ceil((gameState.discussEnd - Date.now()) / 1000);
        setDiscussTimer(r > 0 ? r : 0);
        if (r <= 0) clearInterval(iv);
      }, 500);
      return () => clearInterval(iv);
    }
  }, [gameState?.status, gameState?.timerEnd, gameState?.discussEnd]);

  function createRoom() {
    if (!name.trim()) return alert("Нэрээ оруулна уу!");
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const playerRef = push(ref(db, `rooms/${code}/players`));
    set(playerRef, { name: name.trim(), ready: false, admin: true });
    setMyRoom(code); setMyId(playerRef.key); setIsAdmin(true); setJoined(true);
    listenRoom(code, playerRef.key);
  }

  function joinRoom() {
    if (!name.trim()) return alert("Нэрээ оруулна уу!");
    if (!roomCode.trim()) return alert("Room code оруулна уу!");
    const playerRef = push(ref(db, `rooms/${roomCode}/players`));
    set(playerRef, { name: name.trim(), ready: false, admin: false });
    setMyRoom(roomCode); setMyId(playerRef.key); setIsAdmin(false); setJoined(true);
    listenRoom(roomCode, playerRef.key);
  }

  function listenRoom(code, pid) {
    onValue(ref(db, `rooms/${code}`), (snap) => {
      const data = snap.val(); if (!data) return;
      if (data.players) setPlayers(Object.entries(data.players).map(([id, v]) => ({ id, ...v })));
      if (data.game) {
        setGameState(data.game);
        if (data.game.words?.[pid]) { setMyWord(data.game.words[pid].word); setMyRole(data.game.words[pid].role); }
        if (data.game.votes?.[pid]) setHasVoted(true);
        else if (data.game.status === "playing") setHasVoted(false);
        setVoteResult(data.game.voteResult || null);
      }
    });
  }

  function toggleReady() {
    const p = players.find(p => p.id === myId);
    if (p) set(ref(db, `rooms/${myRoom}/players/${myId}/ready`), !p.ready);
  }

  function kickPlayer(id) { set(ref(db, `rooms/${myRoom}/players/${id}`), null); }

  function startGame() {
    if (players.length < 3) return alert("Хамгийн багадаа 3 тоглогч хэрэгтэй!");
    const notReady = players.filter(p => !p.admin && !p.ready);
    if (notReady.length > 0) return alert(`${notReady.map(p => p.name).join(", ")} бэлэн болоогүй!`);
    if (selectedImposterCount >= players.length) return alert("Imposter тоо хэт их!");
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const imposters = shuffled.slice(0, selectedImposterCount).map(p => p.id);
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    const words = {};
    players.forEach(p => { words[p.id] = imposters.includes(p.id) ? { word: "", role: "imposter" } : { word, role: "crew" }; });
    const discussEnd = Date.now() + selectedSeconds * 1000;
    update(ref(db, `rooms/${myRoom}/game`), {
      status: "playing", words, imposters, imposterCount: selectedImposterCount,
      discussSeconds: selectedSeconds, discussEnd, round: 1, votes: {}, voteResult: null, eliminated: {},
    });
    setHasVoted(false); setVoteResult(null);
    setTimeout(() => autoStartVote(), selectedSeconds * 1000);
  }

  function autoStartVote() {
    onValue(ref(db, `rooms/${myRoom}/game`), (snap) => {
      const data = snap.val();
      if (!data || data.status !== "playing") return;
      const timerEnd = Date.now() + 30000;
      update(ref(db, `rooms/${myRoom}/game`), { status: "voting", votes: {}, timerEnd });
      setTimeout(() => resolveVoteAuto(), 30000);
    }, { onlyOnce: true });
  }

  function resolveVoteAuto() {
    onValue(ref(db, `rooms/${myRoom}/game`), (snap) => {
      const data = snap.val();
      if (!data || data.status !== "voting") return;
      const elim = data.eliminated || {};
      const active = Object.keys(data.words || {}).filter(id => !elim[id]);
      const votes = data.votes || {};
      const tally = {};
      active.forEach(id => { tally[id] = 0; });
      Object.values(votes).forEach(v => { tally[v] = (tally[v] || 0) + 1; });
      const maxV = Math.max(...Object.values(tally));
      const topId = Object.keys(tally).find(k => tally[k] === maxV);
      const topPlayer = players.find(p => p.id === topId);
      update(ref(db, `rooms/${myRoom}/game`), {
        status: "result",
        voteResult: { playerId: topId, playerName: topPlayer?.name || "Тоглогч", wasImposter: data.imposters?.includes(topId), voteCount: tally[topId] || 0 },
      });
    }, { onlyOnce: true });
  }

  function vote(targetId) {
    if (hasVoted) return;
    update(ref(db, `rooms/${myRoom}/game/votes`), { [myId]: targetId });
    setHasVoted(true);
  }

  function nextRound() {
    const elim = { ...(gameState?.eliminated || {}), [voteResult.playerId]: true };
    const remaining = players.filter(p => !elim[p.id]);
    const remImp = gameState.imposters.filter(id => !elim[id]);
    const remCrew = remaining.filter(p => !gameState.imposters.includes(p.id));
    if (remImp.length === 0) { update(ref(db, `rooms/${myRoom}/game`), { status: "crewWin", elim }); return; }
    if (remImp.length >= remCrew.length) { update(ref(db, `rooms/${myRoom}/game`), { status: "imposterWin", elim }); return; }
    const discussEnd = Date.now() + (gameState.discussSeconds || 30) * 1000;
    update(ref(db, `rooms/${myRoom}/game`), {
      status: "playing", votes: {}, voteResult: null, eliminated: elim, discussEnd, round: (gameState.round || 1) + 1,
    });
    setHasVoted(false); setVoteResult(null);
    setTimeout(() => autoStartVote(), (gameState.discussSeconds || 30) * 1000);
  }

  // ── LOBBY ──────────────────────────────────────────────
  if (!joined) return (
    <div style={s.page}>
      <div style={s.container}>
        <div style={s.hero}>
          <div style={s.heroIcon}>🕵️</div>
          <h1 style={s.heroTitle}>Монгол Imposter</h1>
          <p style={s.heroSub}>Найзуудтайгаа тоглоорой</p>
        </div>
        <div style={s.card}>
          <input style={s.input} placeholder="Нэрээ оруулна уу" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && createRoom()} />
          <button style={s.btnGreen} onClick={createRoom}>🏠 Өрөө үүсгэх</button>
          <div style={s.orRow}><div style={s.orLine}/><span style={s.orText}>эсвэл</span><div style={s.orLine}/></div>
          <input style={s.input} placeholder="Room code оруулна уу" value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && joinRoom()} />
          <button style={s.btnOutline} onClick={joinRoom}>🚪 Нэвтрэх</button>
        </div>
      </div>
    </div>
  );

  // ── WAITING ────────────────────────────────────────────
  if (!gameState || gameState.status === "waiting") {
    const allReady = players.every(p => p.admin || p.ready);
    const curMaxImp = getMaxImposters(players.length);
    const secOpts = getSecOptions(players.length);
    return (
      <div style={s.page}>
        <div style={s.container}>
          <div style={s.codeCard}>
            <p style={s.codeLabel}>ӨРӨӨНИЙ КОД</p>
            <p style={s.codeText}>{myRoom}</p>
            <p style={s.codeSub}>Найздаа явуулаарай</p>
          </div>
          <div style={s.card}>
            <p style={s.sectionLabel}>ТОГЛОГЧИД — {players.length}</p>
            {players.map(p => (
              <div key={p.id} style={s.playerRow}>
                <div style={s.ava}>{p.name[0].toUpperCase()}</div>
                <span style={s.playerRowName}>{p.name}{p.id === myId ? " (чи)" : ""}</span>
                <span style={s.badge}>{p.admin ? "👑" : p.ready ? "✅" : "⏳"}</span>
                {isAdmin && p.id !== myId && <button style={s.kickBtn} onClick={() => kickPlayer(p.id)}>✕</button>}
              </div>
            ))}
          </div>
          {isAdmin && (
            <>
              <div style={s.card}>
                <p style={s.sectionLabel}>IMPOSTER ТОО — max {curMaxImp}</p>
                <div style={s.btnRow}>
                  {Array.from({ length: curMaxImp }, (_, i) => i + 1).map(n => (
                    <button key={n} style={{ ...s.choiceBtn, ...(selectedImposterCount === n ? s.choiceBtnActive : {}) }} onClick={() => setSelectedImposterCount(n)}>{n}</button>
                  ))}
                </div>
              </div>
              <div style={s.card}>
                <p style={s.sectionLabel}>ХЭЛЭЛЦЭХ ХУГАЦАА</p>
                <div style={s.btnRow}>
                  {secOpts.map(n => (
                    <button key={n} style={{ ...s.choiceBtn, ...(selectedSeconds === n ? s.choiceBtnActive : {}) }} onClick={() => setSelectedSeconds(n)}>{n}с</button>
                  ))}
                </div>
              </div>
            </>
          )}
          {!isAdmin && <button style={s.btnGreen} onClick={toggleReady}>{players.find(p => p.id === myId)?.ready ? "❌ Болих" : "✅ Бэлэн!"}</button>}
          {isAdmin && <button style={{ ...s.btnGreen, opacity: allReady ? 1 : 0.4 }} onClick={startGame}>🚀 Тоглоом эхлүүлэх</button>}
        </div>
      </div>
    );
  }

  // ── RESULT ─────────────────────────────────────────────
  if (gameState.status === "result" && voteResult) return (
    <div style={s.page}><div style={s.container}>
      <p style={s.pageTitle}>📊 Дүн</p>
      <div style={voteResult.wasImposter ? s.cardGreen : s.cardOrange}>
        <div style={s.bigEmoji}>{voteResult.wasImposter ? "😈" : "😇"}</div>
        <p style={s.resultName}>{voteResult.playerName}</p>
        <p style={s.resultRole}>{voteResult.wasImposter ? "Imposter байсан!" : "Imposter биш байсан!"}</p>
        <p style={s.resultVotes}>{voteResult.voteCount} vote авсан</p>
      </div>
      {isAdmin && <button style={s.btnGreen} onClick={nextRound}>▶️ Үргэлжлүүлэх</button>}
      {!isAdmin && <p style={s.mutedText}>Admin үргэлжлүүлэхийг хүлээж байна...</p>}
    </div></div>
  );

  // ── END SCREENS ────────────────────────────────────────
  if (gameState.status === "crewWin") return (
    <div style={s.page}><div style={s.container}>
      <div style={s.cardGreen}>
        <div style={s.bigEmoji}>🎉</div>
        <p style={s.endTitle}>Crewmate нар ялалаа!</p>
        <p style={s.endSub}>Бүх imposter олдлоо!</p>
        {isAdmin && <button style={s.btnWhite} onClick={startGame}>🔄 Дахин тоглох</button>}
        {!isAdmin && <p style={s.mutedText}>Admin дахин эхлүүлэхийг хүлээж байна...</p>}
      </div>
    </div></div>
  );

  if (gameState.status === "imposterWin") return (
    <div style={s.page}><div style={s.container}>
      <div style={s.cardRed}>
        <div style={s.bigEmoji}>😈</div>
        <p style={s.endTitle}>Imposter нар ялалаа!</p>
        <p style={s.endSub}>Crewmate нар ялагдлаа!</p>
        {isAdmin && <button style={s.btnWhite} onClick={startGame}>🔄 Дахин тоглох</button>}
        {!isAdmin && <p style={s.mutedText}>Admin дахин эхлүүлэхийг хүлээж байна...</p>}
      </div>
    </div></div>
  );

  // ── VOTING ─────────────────────────────────────────────
  if (gameState.status === "voting") {
    const elim = gameState?.eliminated || {};
    const active = players.filter(p => !elim[p.id]);
    const curVotes = gameState.votes || {};
    const rem = timer !== null ? timer : 30;
    const tc = rem <= 10 ? "#FF4757" : rem <= 20 ? "#FFA502" : "#2ED573";
    return (
      <div style={s.page}><div style={s.container}>
        <p style={s.pageTitle}>🗳️ Vote хийх цаг!</p>
        <div style={{ ...s.timerCard, borderColor: tc }}>
          <p style={{ ...s.timerNum, color: tc }}>{rem}</p>
          <p style={s.timerSub}>секунд үлдлээ</p>
        </div>
        <div style={s.card}>
          {active.map(p => {
            const vc = Object.values(curVotes).filter(v => v === p.id).length;
            const iVoted = curVotes[myId] === p.id;
            return (
              <div key={p.id} style={{ ...s.playerRow, ...(iVoted ? s.playerRowVoted : {}) }}>
                <div style={s.ava}>{p.name[0].toUpperCase()}</div>
                <span style={s.playerRowName}>{p.name}{p.id === myId ? " (чи)" : ""}</span>
                {vc > 0 && <span style={s.voteBadge}>🗳️ {vc}</span>}
                {p.id !== myId && !hasVoted && <button style={s.voteBtn} onClick={() => vote(p.id)}>Vote</button>}
              </div>
            );
          })}
        </div>
        {hasVoted && <div style={s.waitCard}>✅ Vote өгсөн! ({Object.keys(curVotes).length}/{active.length})</div>}
      </div></div>
    );
  }

  // ── PLAYING ────────────────────────────────────────────
  const elim = gameState?.eliminated || {};
  const isElim = elim[myId];
  const dRem = discussTimer !== null ? discussTimer : gameState?.discussSeconds || 30;
  const dc = dRem <= 10 ? "#FF4757" : dRem <= 30 ? "#FFA502" : "#2ED573";

  return (
    <div style={s.page}><div style={s.container}>
      <div style={s.topBar}>
        <span style={s.roundPill}>Round {gameState.round}</span>
      </div>
      <div style={{ ...s.timerCard, borderColor: dc, marginBottom: 16 }}>
        <p style={{ ...s.timerNum, color: dc }}>{dRem}</p>
        <p style={s.timerSub}>секундын дараа vote эхэлнэ</p>
      </div>
      {isElim ? (
        <div style={s.cardDark}>
          <div style={s.bigEmoji}>💀</div>
          <p style={s.endTitle}>Чи хасагдсан!</p>
          <p style={s.endSub}>Тоглоомыг ажиглаж болно</p>
        </div>
      ) : (
        <div style={myRole === "imposter" ? s.cardRed : s.cardPurple}>
          <div style={s.bigEmoji}>{myRole === "imposter" ? "😈" : "🧑‍🚀"}</div>
          <p style={s.roleTitle}>{myRole === "imposter" ? "ЧИ IMPOSTER!" : "Чи Crewmate"}</p>
          {myRole !== "imposter" && (
            <div style={s.wordBox}>
              <p style={s.wordLabel}>ЧИНИЙ ҮГ</p>
              <p style={s.wordText}>{myWord}</p>
            </div>
          )}
          <p style={s.roleHint}>{myRole === "imposter" ? "Бусдыг мэхэл, илэрхгүй бай!" : "Imposter-ийг ол!"}</p>
        </div>
      )}
      <div style={s.card}>
        <p style={s.sectionLabel}>ТОГЛОГЧИД</p>
        {players.map(p => (
          <div key={p.id} style={{ ...s.playerRow, opacity: elim[p.id] ? 0.3 : 1 }}>
            <div style={{ ...s.ava, background: elim[p.id] ? "#555" : "#6C63FF" }}>{elim[p.id] ? "💀" : p.name[0].toUpperCase()}</div>
            <span style={s.playerRowName}>{p.name}{p.id === myId ? " (чи)" : ""}</span>
          </div>
        ))}
      </div>
    </div></div>
  );
}

const s = {
  page: { minHeight: "100vh", background: "#0D0D1A", padding: "1.5rem 0" },
  container: { maxWidth: 420, margin: "0 auto", padding: "0 1rem" },

  hero: { textAlign: "center", marginBottom: 24 },
  heroIcon: { fontSize: 72, lineHeight: 1, marginBottom: 8 },
  heroTitle: { fontSize: 30, fontWeight: 800, color: "#fff", margin: "0 0 6px", letterSpacing: -0.5 },
  heroSub: { fontSize: 14, color: "#555e7a", margin: 0 },

  card: { background: "#161625", border: "1px solid #1e1e35", borderRadius: 16, padding: "16px", marginBottom: 12 },
  cardRed: { background: "linear-gradient(145deg,#c0392b,#922b21)", borderRadius: 20, padding: "2rem", textAlign: "center", marginBottom: 16, color: "#fff" },
  cardGreen: { background: "linear-gradient(145deg,#1e8449,#145a32)", borderRadius: 20, padding: "2rem", textAlign: "center", marginBottom: 16, color: "#fff" },
  cardOrange: { background: "linear-gradient(145deg,#d35400,#a04000)", borderRadius: 20, padding: "2rem", textAlign: "center", marginBottom: 16, color: "#fff" },
  cardPurple: { background: "linear-gradient(145deg,#5b4fcf,#3b2fa0)", borderRadius: 20, padding: "2rem", textAlign: "center", marginBottom: 16, color: "#fff" },
  cardDark: { background: "#161625", border: "1px solid #1e1e35", borderRadius: 20, padding: "2rem", textAlign: "center", marginBottom: 16, color: "#fff" },

  codeCard: { background: "linear-gradient(145deg,#1a1a40,#12122e)", border: "2px solid #6C63FF", borderRadius: 20, padding: "20px", textAlign: "center", marginBottom: 12 },
  codeLabel: { fontSize: 11, color: "#6C63FF", letterSpacing: 2, margin: "0 0 4px", fontWeight: 700 },
  codeText: { fontSize: 44, fontWeight: 900, color: "#fff", letterSpacing: 8, margin: "0 0 4px" },
  codeSub: { fontSize: 12, color: "#555e7a", margin: 0 },

  input: { width: "100%", padding: "14px 16px", fontSize: 16, borderRadius: 12, border: "1.5px solid #1e1e35", background: "#0D0D1A", color: "#fff", marginBottom: 10, boxSizing: "border-box", outline: "none" },

  btnGreen: { width: "100%", padding: "15px", fontSize: 16, borderRadius: 12, background: "linear-gradient(135deg,#00b894,#00a381)", color: "#fff", border: "none", cursor: "pointer", marginBottom: 8, fontWeight: 700, letterSpacing: 0.3 },
  btnOutline: { width: "100%", padding: "15px", fontSize: 16, borderRadius: 12, background: "transparent", color: "#6C63FF", border: "2px solid #6C63FF", cursor: "pointer", fontWeight: 700 },
  btnWhite: { width: "100%", padding: "14px", fontSize: 16, borderRadius: 12, background: "rgba(255,255,255,0.15)", color: "#fff", border: "2px solid rgba(255,255,255,0.3)", cursor: "pointer", marginTop: 12, fontWeight: 700 },

  orRow: { display: "flex", alignItems: "center", gap: 8, margin: "12px 0" },
  orLine: { flex: 1, height: 1, background: "#1e1e35" },
  orText: { color: "#555e7a", fontSize: 12 },

  sectionLabel: { fontSize: 11, color: "#555e7a", letterSpacing: 2, fontWeight: 700, margin: "0 0 12px" },
  playerRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #1e1e35" },
  playerRowVoted: { background: "rgba(108,99,255,0.08)", borderRadius: 10, padding: "10px", borderBottom: "none", marginBottom: 4 },
  playerRowName: { flex: 1, color: "#fff", fontSize: 15, fontWeight: 500 },
  ava: { width: 38, height: 38, borderRadius: "50%", background: "#6C63FF", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 15, flexShrink: 0 },
  badge: { fontSize: 18 },
  kickBtn: { background: "#c0392b", color: "#fff", border: "none", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 12 },

  btnRow: { display: "flex", gap: 8 },
  choiceBtn: { flex: 1, padding: "12px 0", borderRadius: 10, background: "#0D0D1A", color: "#555e7a", border: "1px solid #1e1e35", cursor: "pointer", fontSize: 15, fontWeight: 700 },
  choiceBtnActive: { background: "#6C63FF", color: "#fff", border: "1px solid #6C63FF" },

  timerCard: { textAlign: "center", border: "3px solid #2ED573", borderRadius: 16, padding: "16px 0", background: "#161625" },
  timerNum: { fontSize: 56, fontWeight: 900, lineHeight: 1, margin: 0 },
  timerSub: { fontSize: 12, color: "#555e7a", margin: "4px 0 0" },

  topBar: { display: "flex", justifyContent: "center", marginBottom: 12 },
  roundPill: { background: "rgba(108,99,255,0.15)", color: "#6C63FF", borderRadius: 20, padding: "6px 20px", fontSize: 13, fontWeight: 700 },

  bigEmoji: { fontSize: 56, marginBottom: 12 },
  roleTitle: { fontSize: 22, fontWeight: 800, margin: "0 0 14px" },
  roleHint: { fontSize: 13, opacity: 0.75, margin: 0 },
  wordBox: { background: "rgba(255,255,255,0.12)", borderRadius: 12, padding: "12px 24px", display: "inline-block", marginBottom: 12 },
  wordLabel: { fontSize: 10, letterSpacing: 2, opacity: 0.7, margin: "0 0 4px", fontWeight: 700 },
  wordText: { fontSize: 30, fontWeight: 900, margin: 0 },

  pageTitle: { textAlign: "center", fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 16 },
  resultName: { fontSize: 26, fontWeight: 800, margin: "0 0 6px" },
  resultRole: { fontSize: 16, margin: "0 0 6px", opacity: 0.9 },
  resultVotes: { fontSize: 13, opacity: 0.7, margin: 0 },
  endTitle: { fontSize: 24, fontWeight: 800, margin: "0 0 6px" },
  endSub: { fontSize: 14, opacity: 0.8, margin: 0 },
  mutedText: { textAlign: "center", color: "#555e7a", fontSize: 13, marginTop: 12 },

  voteBtn: { background: "#6C63FF", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 14, fontWeight: 700 },
  voteBadge: { fontSize: 13, color: "#6C63FF", marginRight: 6 },
  waitCard: { background: "rgba(108,99,255,0.1)", border: "1px solid #6C63FF", borderRadius: 12, padding: "12px", textAlign: "center", color: "#6C63FF", fontSize: 14 },
};