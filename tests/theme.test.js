import test from "node:test"
import assert from "node:assert/strict"
import { normaliseHex, shade, metalFrom, paletteColors, PALETTES } from "../src/lib/theme.js"

test("a hex is taken the way a person types one", () => {
  for (const [input, want] of [
    ["#0d3b66", "#0d3b66"],
    ["0d3b66", "#0d3b66"],
    ["  #0D3B66 ", "#0d3b66"],
    ["#abc", "#aabbcc"],
    ["abc", "#aabbcc"],
    ["#12345678", "#12345678"],
  ]) assert.equal(normaliseHex(input), want, input)

  for (const bad of ["", "#", "#12", "#12345", "nope", "#gggggg", null, 42, "rgb(1,2,3)"]) {
    assert.equal(normaliseHex(bad), null, JSON.stringify(bad))
  }
})

test("shading keeps the hue and moves towards an endpoint", () => {
  assert.equal(shade("#808080", -1), "#000000", "all the way down is black")
  assert.equal(shade("#808080", 1), "#ffffff", "all the way up is white")
  assert.equal(shade("#808080", 0), "#808080")
  // The bug worth guarding: scaling channels leaves a dark colour black.
  assert.notEqual(shade("#101010", 0.5), "#101010", "a dark colour still lightens")
})

test("three metals from one, and they get darker in order", () => {
  const m = metalFrom("#f2c96b")
  assert.equal(m.gold, "#f2c96b")
  const lum = (h) => [1, 3, 5].reduce((n, i) => n + parseInt(h.slice(i, i + 2), 16), 0)
  assert.ok(lum(m.gold) > lum(m["gold-deep"]), "deep is darker than gold")
  assert.ok(lum(m["gold-deep"]) > lum(m["gold-dim"]), "dim is darker than deep")
  assert.equal(metalFrom("not a colour"), null)
})

test("every palette produces colours the relay will accept", () => {
  const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/
  for (const p of PALETTES) {
    const c = paletteColors(p)
    assert.deepEqual(Object.keys(c).sort(), ["gold", "gold-deep", "gold-dim", "live", "royal"], p.id)
    for (const [k, v] of Object.entries(c)) assert.match(v, HEX, `${p.id}.${k}`)
  }
})
