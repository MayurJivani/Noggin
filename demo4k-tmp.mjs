import { WebSocket } from "ws"
const ws = new WebSocket("ws://localhost:4332")
const send = (o) => ws.send(JSON.stringify(o))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const board = { id: "fourk", title: "Marble & Gold",
  rounds: [{ name: "Round 1", values: [200,400,600,800,1000],
    categories: ["STONE","METALS","GAME SHOWS","LATE NIGHT","ODDITIES"].map((title) => ({
      title, clues: [200,400,600,800,1000].map((value) => ({ value,
        prompt: `A ${value}-point clue in ${title}`, answer: `answer ${value}` })) })) }] }
ws.on("open", async () => {
  send({ type: "join", role: "host" }); await wait(300)
  send({ type: "board:set", board }); await wait(200)
  send({ type: "game:start" })
})
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.type === "joined") console.log("CODE", m.code) })
setTimeout(() => process.exit(0), 600_000)
