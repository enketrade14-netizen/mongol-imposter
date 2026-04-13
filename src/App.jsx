import { useState, useEffect } from "react";
import { db } from "./firebase";
import { ref, set, onValue, push, update } from "firebase/database";

const WORDS = [
  "нар", "ус", "мод", "нохой", "цас", "дэвтэр", "гутал", "машин",
  "тэнгэр", "талх", "сар", "гар", "ширээ", "цонх", "утас", "ном",
  "аяга", "хаалга", "морь", "цэцэг", "уул", "гол", "өвс", "чулуу",
];

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
  const [timer, setTimer] = useState(null);

  useEffect(() => {
    if (gameState?.status === "voting" && gameState?.timerEnd) {
      const interval = setInterval(() => {
        const remaining = Math.ceil((gameState.timerEnd - Date.now()) / 1000);
        setTimer(remaining > 0 ? remaining : 0);
        if (remaining <= 0) {
          clearInterval(interval);
        }
      }, 500);
      return () => clearInterval(interval);
    }
  }, [gameState?.status, gameState?.timerEnd]);

  function createRoom() {
    if (!name.trim()) return alert("Нэрээ оруулна уу!");
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const playerRef = push(ref(db, `rooms/${code}/players`));
    set(playerRef, { name: name.trim(), ready: false, admin: true });
    setMyRoom(code);
    setMyId(playerRef.key);
    setIsAdmin(true);
    setJoined(true);
    listenRoom(code, playerRef.key);
  }

  function joinRoom() {
    if (!name.trim()) return alert("Нэрээ оруулна уу!");
    if (!roomCode.trim()) return alert("Room code оруулна уу!");
    const playerRef = push(ref(db, `rooms/${roomCode}/players`));
    set(playerRef, { name: name.trim(), ready: false, admin: false });
    setMyRoom(roomCode);
    setMyId(playerRef.key);
    setIsAdmin(false);
    setJoined(true);
    listenRoom(roomCode, playerRef.key);
  }

  function listenRoom(code, myPlayerId) {
    onValue(ref(db, `rooms/${code}`), (snapshot) => {
      const data = snapshot.val();
      if (!data) return;
      if (data.players) {
        const list = Object.entries(data.players).map(([id, val]) => ({ id, ...val }));
        setPlayers(list);
      }
      if (data.game) {
        setGameState(data.game);
        if (data.game.words?.[myPlayerId]) {
          setMyWord(data.game.words[myPlayerId].word);
          setMyRole(data.game.words[myPlayerId].role);
        }
        if (data.game.votes?.[myPlayerId]) {
          setHasVoted(true);
        } else if (data.game.status === "playing") {
          setHasVoted(false);
        }
        if (data.game.voteResult) {
          setVoteResult(data.game.voteResult);
        } else {
          setVoteResult(null);
        }
      }
    });
  }

  function toggleReady() {
    const player = players.find((p) => p.id === myId);
    if (!player) return;
    set(ref(db, `rooms/${myRoom}/players/${myId}/ready`), !player.ready);
  }

  function kickPlayer(id) {
    set(ref(db, `rooms/${myRoom}/players/${id}`), null);
  }

  function startGame() {
    if (players.length < 3) return alert("Хамгийн багадаа 3 тоглогч хэрэгтэй!");
    const notReady = players.filter((p) => !p.admin && !p.ready);
    if (notReady.length > 0) return alert(`${notReady.map((p) => p.name).join(", ")} бэлэн болоогүй байна!`);
    if (selectedImposterCount >= players.length) return alert("Imposter тоо хэт их байна!");

    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const imposters = shuffled.slice(0, selectedImposterCount).map((p) => p.id);
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    const words = {};
    players.forEach((p) => {
      words[p.id] = imposters.includes(p.id)
        ? { word: "", role: "imposter" }
        : { word, role: "crew" };
    });
    update(ref(db, `rooms/${myRoom}/game`), {
      status: "playing",
      words,
      imposters,
      imposterCount: selectedImposterCount,
      round: 1,
      votes: {},
      voteResult: null,
      eliminated: {},
    });
    setHasVoted(false);
    setVoteResult(null);
  }

  function startVote() {
    const timerEnd = Date.now() + 30000;
    update(ref(db, `rooms/${myRoom}/game`), {
      status: "voting",
      votes: {},
      timerEnd,
    });

    setTimeout(() => {
      resolveVoteAuto();
    }, 30000);
  }

  function resolveVoteAuto() {
    const gameRef = ref(db, `rooms/${myRoom}/game`);
    onValue(gameRef, (snap) => {
      const data = snap.val();
      if (!data || data.status !== "voting") return;
      const eliminated = data.eliminated || {};
      const allPlayers = Object.entries(data.words || {}).map(([id, val]) => ({ id, ...val }));
      const activePlayers = allPlayers.filter((p) => !eliminated[p.id]);
      const votes = data.votes || {};

      const tally = {};
      activePlayers.forEach((p) => { tally[p.id] = 0; });
      Object.values(votes).forEach((v) => { tally[v] = (tally[v] || 0) + 1; });

      const maxVotes = Math.max(...Object.values(tally));
      const topId = Object.keys(tally).find((k) => tally[k] === maxVotes);
      const topPlayerData = players.find((p) => p.id === topId);
      const wasImposter = data.imposters?.includes(topId);

      update(gameRef, {
        status: "result",
        voteResult: {
          playerId: topId,
          playerName: topPlayerData?.name || "Тоглогч",
          wasImposter,
          voteCount: tally[topId] || 0,
        },
      });
    }, { onlyOnce: true });
  }

  function vote(targetId) {
    if (hasVoted) return;
    update(ref(db, `rooms/${myRoom}/game/votes`), { [myId]: targetId });
    setHasVoted(true);
  }

  function nextRound() {
    const eliminated = { ...(gameState?.eliminated || {}), [voteResult.playerId]: true };
    const remainingPlayers = players.filter((p) => !eliminated[p.id]);
    const remainingImposters = gameState.imposters.filter((id) => !eliminated[id]);
    const remainingCrew = remainingPlayers.filter((p) => !gameState.imposters.includes(p.id));
    if (remainingImposters.length === 0) {
      update(ref(db, `rooms/${myRoom}/game`), { status: "crewWin", eliminated });
      return;
    }
    if (remainingImposters.length >= remainingCrew.length) {
      update(ref(db, `rooms/${myRoom}/game`), { status: "imposterWin", eliminated });
      return;
    }
    update(ref(db, `rooms/${myRoom}/game`), {
      status: "playing",
      votes: {},
      voteResult: null,
      eliminated,
      round: (gameState.round || 1) + 1,
    });
    setHasVoted(false);
    setVoteResult(null);
  }

  // LOBBY
  if (!joined) {
    return (
      <div style={s.page}>
        <div style={s.container}>
          <div style={s.logo}>🕵️</div>
          <h1 style={s.logoTitle}>Монгол Imposter</h1>
          <p style={s.logoSub}>Найзуудтайгаа тоглоорой</p>
          <input style={s.input} placeholder="Нэрээ оруулна уу" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createRoom()} />
          <button style={s.btnPrimary} onClick={createRoom}>🏠 Өрөө үүсгэх</button>
          <div style={s.divider}><span style={s.dividerText}>эсвэл</span></div>
          <input style={s.input} placeholder="Room code оруулна уу" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && joinRoom()} />
          <button style={s.btnSecondary} onClick={joinRoom}>🚪 Нэвтрэх</button>
        </div>
      </div>
    );
  }

  // WAITING ROOM
  if (!gameState || gameState.status === "waiting") {
    const allReady = players.every((p) => p.admin || p.ready);
    return (
      <div style={s.page}>
        <div style={s.container}>
          <div style={s.roomCodeBox}>
            <div style={s.roomCodeLabel}>Өрөөний код</div>
            <div style={s.roomCode}>{myRoom}</div>
            <div style={s.roomCodeHint}>Найздаа явуул!</div>
          </div>
          <div style={s.playerList}>
            {players.map((p) => (
              <div key={p.id} style={s.playerCard}>
                <div style={s.avatar}>{p.name[0].toUpperCase()}</div>
                <span style={s.playerName}>{p.name} {p.id === myId ? "(чи)" : ""}</span>
                <span style={p.admin ? s.badgeAdmin : p.ready ? s.badgeReady : s.badgeWait}>
                  {p.admin ? "👑" : p.ready ? "✅" : "⏳"}
                </span>
                {isAdmin && p.id !== myId && (
                  <button style={s.kick} onClick={() => kickPlayer(p.id)}>✕</button>
                )}
              </div>
            ))}
          </div>
          {isAdmin && (
            <div style={s.imposterSelector}>
              <div style={s.imposterLabel}>Imposter тоо сонгох:</div>
              <div style={s.imposterBtns}>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    style={{ ...s.imposterBtn, ...(selectedImposterCount === n ? s.imposterBtnActive : {}) }}
                    onClick={() => setSelectedImposterCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!isAdmin && (
            <button style={s.btnPrimary} onClick={toggleReady}>
              {players.find((p) => p.id === myId)?.ready ? "❌ Болих" : "✅ Бэлэн!"}
            </button>
          )}
          {isAdmin && (
            <button style={{ ...s.btnStart, opacity: allReady ? 1 : 0.5 }} onClick={startGame}>
              🚀 Тоглоом эхлүүлэх {!allReady && "(бүгд бэлэн болоогүй)"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // RESULT
  if (gameState.status === "result" && voteResult) {
    return (
      <div style={s.page}>
        <div style={s.container}>
          <h2 style={s.title}>📊 Дүн</h2>
          <div style={voteResult.wasImposter ? s.successCard : s.failCard}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>{voteResult.wasImposter ? "😈" : "😇"}</div>
            <div style={s.resultName}>{voteResult.playerName}</div>
            <div style={s.resultRole}>{voteResult.wasImposter ? "Imposter байсан!" : "Imposter биш байсан!"}</div>
            <div style={s.resultVotes}>{voteResult.voteCount} vote авсан</div>
          </div>
          {isAdmin && <button style={s.btnStart} onClick={nextRound}>▶️ Үргэлжлүүлэх</button>}
          {!isAdmin && <p style={s.sub}>Admin үргэлжлүүлэхийг хүлээж байна...</p>}
        </div>
      </div>
    );
  }

  // CREW WIN
  if (gameState.status === "crewWin") {
    return (
      <div style={s.page}>
        <div style={s.container}>
          <div style={s.winCard}>
            <div style={{ fontSize: 64 }}>🎉</div>
            <h2 style={{ margin: "12px 0 8px" }}>Crewmate нар ялалаа!</h2>
            <p style={{ opacity: 0.9 }}>Бүх imposter олдлоо!</p>
            {isAdmin && <button style={s.btnWhite} onClick={startGame}>🔄 Дахин тоглох</button>}
            {!isAdmin && <p style={{ fontSize: 13, opacity: 0.8 }}>Admin дахин эхлүүлэхийг хүлээж байна...</p>}
          </div>
        </div>
      </div>
    );
  }

  // IMPOSTER WIN
  if (gameState.status === "imposterWin") {
    return (
      <div style={s.page}>
        <div style={s.container}>
          <div style={s.loseCard}>
            <div style={{ fontSize: 64 }}>😈</div>
            <h2 style={{ margin: "12px 0 8px" }}>Imposter нар ялалаа!</h2>
            <p style={{ opacity: 0.9 }}>Crewmate нар ялагдлаа!</p>
            {isAdmin && <button style={s.btnWhite} onClick={startGame}>🔄 Дахин тоглох</button>}
            {!isAdmin && <p style={{ fontSize: 13, opacity: 0.8 }}>Admin дахин эхлүүлэхийг хүлээж байна...</p>}
          </div>
        </div>
      </div>
    );
  }

  // VOTING
  if (gameState.status === "voting") {
    const eliminated = gameState?.eliminated || {};
    const activePlayers = players.filter((p) => !eliminated[p.id]);
    const currentVotes = gameState.votes || {};
    const remaining = timer !== null ? timer : 30;
    const timerColor = remaining <= 10 ? "#ff4d4d" : remaining <= 20 ? "#FFB300" : "#00C853";

    return (
      <div style={s.page}>
        <div style={s.container}>
          <h2 style={s.title}>🗳️ Vote хийх цаг!</h2>
          <div style={{ ...s.timerBox, borderColor: timerColor }}>
            <div style={{ ...s.timerText, color: timerColor }}>{remaining}</div>
            <div style={s.timerLabel}>секунд</div>
          </div>
          <p style={s.sub}>Сэжигтэй хүнд vote өг!</p>
          <div style={s.playerList}>
            {activePlayers.map((p) => {
              const voteCount = Object.values(currentVotes).filter((v) => v === p.id).length;
              const iVoted = currentVotes[myId] === p.id;
              return (
                <div key={p.id} style={{ ...s.playerCard, ...(iVoted ? s.votedCard : {}) }}>
                  <div style={s.avatar}>{p.name[0].toUpperCase()}</div>
                  <span style={s.playerName}>{p.name} {p.id === myId ? "(чи)" : ""}</span>
                  {voteCount > 0 && <span style={s.voteCount}>🗳️ {voteCount}</span>}
                  {p.id !== myId && !hasVoted && (
                    <button style={s.voteBtn} onClick={() => vote(p.id)}>Vote</button>
                  )}
                </div>
              );
            })}
          </div>
          {hasVoted && (
            <div style={s.waitBox}>
              ✅ Vote өгсөн! ({Object.keys(currentVotes).length}/{activePlayers.length})
            </div>
          )}
        </div>
      </div>
    );
  }

  // PLAYING
  const eliminated = gameState?.eliminated || {};
  const isEliminated = eliminated[myId];
  return (
    <div style={s.page}>
      <div style={s.container}>
        <div style={s.roundBadge}>Round {gameState.round}</div>
        {isEliminated ? (
          <div style={s.eliminatedCard}>
            <div style={{ fontSize: 48 }}>💀</div>
            <p style={{ fontWeight: "bold", fontSize: 18 }}>Чи хасагдсан!</p>
            <p style={{ fontSize: 13, opacity: 0.7 }}>Тоглоомыг ажиглаж болно</p>
          </div>
        ) : (
          <div style={myRole === "imposter" ? s.imposterCard : s.crewCard}>
            <div style={s.roleEmoji}>{myRole === "imposter" ? "😈" : "🧑‍🚀"}</div>
            <div style={s.roleLabel}>{myRole === "imposter" ? "ЧИ IMPOSTER!" : "Чи Crewmate"}</div>
            {myRole !== "imposter" && (
              <div style={s.wordBox}>
                <div style={s.wordLabel}>Чиний үг</div>
                <div style={s.wordText}>{myWord}</div>
              </div>
            )}
            <div style={s.hint}>
              {myRole === "imposter" ? "Бусдыг мэхэл, илэрхгүй бай!" : "Imposter-ийг ол!"}
            </div>
          </div>
        )}
        <div style={s.playerList}>
          <div style={s.sectionTitle}>Тоглогчид ({players.length})</div>
          {players.map((p) => (
            <div key={p.id} style={{ ...s.playerCard, opacity: eliminated[p.id] ? 0.35 : 1 }}>
              <div style={{ ...s.avatar, background: eliminated[p.id] ? "#999" : "#6C63FF" }}>
                {eliminated[p.id] ? "💀" : p.name[0].toUpperCase()}
              </div>
              <span style={s.playerName}>{p.name} {p.id === myId ? "(чи)" : ""}</span>
            </div>
          ))}
        </div>
        {isAdmin && (
          <button style={s.btnVote} onClick={startVote}>🗳️ Vote эхлүүлэх (30 сек)</button>
        )}
        {!isAdmin && <p style={s.sub}>Admin vote эхлүүлэхийг хүлээж байна...</p>}
      </div>
    </div>
  );
}

const s = {
  page: { minHeight: "100vh", background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)", padding: "1rem 0" },
  container: { maxWidth: 420, margin: "0 auto", padding: "1rem" },
  logo: { textAlign: "center", fontSize: 64, marginBottom: 8 },
  logoTitle: { textAlign: "center", fontSize: 28, fontWeight: "bold", color: "#fff", margin: "0 0 4px" },
  logoSub: { textAlign: "center", color: "#8892b0", marginBottom: 24, fontSize: 14 },
  input: { width: "100%", padding: "14px 16px", fontSize: 16, borderRadius: 12, border: "1.5px solid #2d3561", background: "#1a1a2e", color: "#fff", marginBottom: 10, boxSizing: "border-box", outline: "none" },
  btnPrimary: { width: "100%", padding: "14px", fontSize: 16, borderRadius: 12, background: "#6C63FF", color: "#fff", border: "none", cursor: "pointer", marginBottom: 8, fontWeight: "bold" },
  btnSecondary: { width: "100%", padding: "14px", fontSize: 16, borderRadius: 12, background: "transparent", color: "#6C63FF", border: "2px solid #6C63FF", cursor: "pointer", fontWeight: "bold" },
  btnStart: { width: "100%", padding: "14px", fontSize: 16, borderRadius: 12, background: "#00C853", color: "#fff", border: "none", cursor: "pointer", marginTop: 8, fontWeight: "bold" },
  btnVote: { width: "100%", padding: "14px", fontSize: 16, borderRadius: 12, background: "#FF6B35", color: "#fff", border: "none", cursor: "pointer", marginTop: 8, fontWeight: "bold" },
  btnWhite: { width: "100%", padding: "14px", fontSize: 16, borderRadius: 12, background: "rgba(255,255,255,0.2)", color: "#fff", border: "2px solid rgba(255,255,255,0.4)", cursor: "pointer", marginTop: 12, fontWeight: "bold" },
  divider: { display: "flex", alignItems: "center", margin: "12px 0" },
  dividerText: { color: "#8892b0", fontSize: 13, margin: "0 auto" },
  roomCodeBox: { background: "rgba(108,99,255,0.15)", border: "2px solid #6C63FF", borderRadius: 16, padding: "20px", textAlign: "center", marginBottom: 20 },
  roomCodeLabel: { color: "#8892b0", fontSize: 12, marginBottom: 4 },
  roomCode: { fontSize: 40, fontWeight: "bold", color: "#6C63FF", letterSpacing: 6 },
  roomCodeHint: { color: "#8892b0", fontSize: 12, marginTop: 4 },
  title: { textAlign: "center", fontSize: 22, fontWeight: "bold", color: "#fff", marginBottom: 8 },
  sub: { textAlign: "center", color: "#8892b0", marginBottom: 16, fontSize: 13 },
  sectionTitle: { fontSize: 12, color: "#8892b0", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 },
  playerList: { marginBottom: 16 },
  playerCard: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12, background: "rgba(255,255,255,0.05)", marginBottom: 8, border: "1px solid rgba(255,255,255,0.08)" },
  votedCard: { border: "2px solid #6C63FF", background: "rgba(108,99,255,0.15)" },
  avatar: { width: 36, height: 36, borderRadius: "50%", background: "#6C63FF", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: "bold", fontSize: 15, flexShrink: 0 },
  playerName: { fontWeight: "500", flex: 1, color: "#fff", fontSize: 15 },
  badgeAdmin: { fontSize: 18 },
  badgeReady: { fontSize: 18 },
  badgeWait: { fontSize: 18 },
  kick: { background: "#ff4d4d", color: "#fff", border: "none", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13 },
  voteBtn: { background: "#6C63FF", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 14, fontWeight: "bold" },
  voteCount: { fontSize: 13, color: "#6C63FF", marginRight: 4 },
  imposterSelector: { background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: "14px", marginBottom: 12 },
  imposterLabel: { color: "#8892b0", fontSize: 13, marginBottom: 10 },
  imposterBtns: { display: "flex", gap: 8 },
  imposterBtn: { flex: 1, padding: "10px", borderRadius: 10, background: "rgba(255,255,255,0.05)", color: "#8892b0", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", fontSize: 16, fontWeight: "bold" },
  imposterBtnActive: { background: "#6C63FF", color: "#fff", border: "1px solid #6C63FF" },
  timerBox: { textAlign: "center", border: "3px solid #00C853", borderRadius: 16, padding: "16px", marginBottom: 16, background: "rgba(0,0,0,0.2)" },
  timerText: { fontSize: 52, fontWeight: "bold", lineHeight: 1 },
  timerLabel: { fontSize: 13, color: "#8892b0", marginTop: 4 },
  roundBadge: { textAlign: "center", background: "rgba(108,99,255,0.2)", color: "#6C63FF", borderRadius: 20, padding: "6px 20px", display: "block", margin: "0 auto 16px", fontSize: 14, fontWeight: "bold", width: "fit-content" },
  imposterCard: { background: "linear-gradient(135deg, #ff4d4d, #c0392b)", borderRadius: 20, padding: "2rem", textAlign: "center", marginBottom: 20, color: "#fff" },
  crewCard: { background: "linear-gradient(135deg, #6C63FF, #4834d4)", borderRadius: 20, padding: "2rem", textAlign: "center", marginBottom: 20, color: "#fff" },
  eliminatedCard: { background: "rgba(255,255,255,0.05)", borderRadius: 20, padding: "2rem", textAlign: "center", marginBottom: 20, color: "#fff", border: "1px solid rgba(255,255,255,0.1)" },
  roleEmoji: { fontSize: 52, marginBottom: 8 },
  roleLabel: { fontSize: 20, fontWeight: "bold", marginBottom: 16 },
  wordBox: { background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: "12px 20px", marginBottom: 12, display: "inline-block" },
  wordLabel: { fontSize: 11, opacity: 0.8, marginBottom: 4 },
  wordText: { fontSize: 28, fontWeight: "bold" },
  hint: { fontSize: 13, opacity: 0.85 },
  successCard: { background: "linear-gradient(135deg, #00C853, #00897B)", borderRadius: 20, padding: "2rem", textAlign: "center", marginBottom: 20, color: "#fff" },
  failCard: { background: "linear-gradient(135deg, #FF6B35, #e55039)", borderRadius: 20, padding: "2rem", textAlign: "center", marginBottom: 20, color: "#fff" },
  winCard: { background: "linear-gradient(135deg, #00C853, #00897B)", borderRadius: 20, padding: "3rem 2rem", textAlign: "center", color: "#fff" },
  loseCard: { background: "linear-gradient(135deg, #ff4d4d, #c0392b)", borderRadius: 20, padding: "3rem 2rem", textAlign: "center", color: "#fff" },
  resultName: { fontSize: 26, fontWeight: "bold", marginBottom: 8 },
  resultRole: { fontSize: 16, marginBottom: 8, opacity: 0.9 },
  resultVotes: { fontSize: 13, opacity: 0.75 },
  waitBox: { background: "rgba(108,99,255,0.15)", border: "1px solid #6C63FF", borderRadius: 12, padding: "12px", textAlign: "center", color: "#6C63FF", fontSize: 14 },
};