/**
 * Runs the relay and Astro together, both bound to 0.0.0.0 — a game needs the
 * projector on one machine and a phone in every hand, and a localhost-only dev
 * server can't be reached by either.
 */
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { networkInterfaces } from "node:os"
import path from "node:path"

const require = createRequire(import.meta.url)
// Resolve through the package rather than guessing a path — the bin has moved before.
const astroBin = path.join(path.dirname(require.resolve("astro/package.json")), "bin/astro.mjs")

const children = []

function run(label, colour, cmd, args) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" })
  const tag = `\x1b[${colour}m[${label}]\x1b[0m `
  const pipe = (stream, to) => {
    let buf = ""
    stream.on("data", (chunk) => {
      buf += chunk.toString()
      const lines = buf.split("\n")
      buf = lines.pop() ?? ""
      for (const line of lines) to.write(tag + line + "\n")
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${tag}exited with code ${code}`)
      shutdown(code)
    }
  })
  children.push(child)
  return child
}

function shutdown(code = 0) {
  for (const c of children) if (!c.killed) c.kill("SIGTERM")
  process.exit(code)
}

process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))

run("relay", "35", process.execPath, ["server/index.js"])
run("astro", "33", process.execPath, [astroBin, "dev", "--host"])

const ip = Object.values(networkInterfaces())
  .flat()
  .find((a) => a && a.family === "IPv4" && !a.internal)?.address

const at = (p) => `http://${ip ?? "localhost"}:4331${p}`

setTimeout(() => {
  console.log("\n\x1b[33m  NOGGIN’ ready\x1b[0m")
  console.log(`  start here  : ${at("/")}`)
  console.log(`  host desk   : ${at("/host")}`)
  console.log(`  big screen  : ${at("/display")}`)
  console.log(`  players     : ${at("/play")}   (or scan the QR on either page)`)
  console.log("")
}, 1500).unref()
