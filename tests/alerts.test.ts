import assert from "node:assert/strict"
import test from "node:test"
import { buildCeilingAlert, buildIterationAlert, buildWindowAlert } from "../lib/prompts/alerts"

const windowInput = {
    tokens: 187432,
    max: 200000,
    min: 160000,
    headroom: 12568,
    blockCount: 3,
    blockRefs: ["b1", "b4", "b6"],
}

test("window alert renders the exact banner frame", () => {
    const message = buildWindowAlert(windowInput)

    assert.ok(
        message.startsWith(
            "╔═══════════════════════════════════════════════════════════════╗\n" +
                "║   ▲▲▲   CONTEXT WINDOW ALERT   ▲▲▲   ACTION REQUIRED          ║\n" +
                "╚═══════════════════════════════════════════════════════════════╝",
        ),
    )
    assert.ok(
        message.endsWith(
            "╔═══════════════════════════════════════════════════════════════╗\n" +
                "║  ⚑   DO NOT LET THE CEILING ARRIVE UNNOTICED                  ║\n" +
                "╚═══════════════════════════════════════════════════════════════╝",
        ),
    )
    assert.match(message, /\n  ⚠  CONTEXT  :  187,432 \/ 200,000 tokens   \(94%\)\n/)
    assert.match(message, /\n  ⚠  WINDOW   :  160,000 – 200,000\n/)
    assert.match(message, /\n  ⚠  HEADROOM :  12,568 tokens before the hard ceiling\n/)
    assert.match(message, /\n  ▣  COMPRESSED BLOCKS IN SESSION: 3 \(b1, b4, b6\)\n/)
    assert.match(message, /call `compress` on them NOW/)
})

test("window alert falls back to no refs for an empty block list", () => {
    const message = buildWindowAlert({ ...windowInput, blockCount: 0, blockRefs: [] })

    assert.match(message, /COMPRESSED BLOCKS IN SESSION: 0 \(none\)/)
})

test("ceiling alert renders the exact banner frame", () => {
    const message = buildCeilingAlert({ tokens: 214900, max: 200000, over: 14900, pct: 107.45 })
    const bar = "█".repeat(65)

    assert.ok(
        message.startsWith(`${bar}\n█   ⛔⛔⛔   !! CONTEXT CEILING EXCEEDED !!   ⛔⛔⛔\n${bar}`),
    )
    assert.ok(message.endsWith(bar))
    assert.match(
        message,
        /\n  ⛔  CONTEXT :  214,900 \/ 200,000 tokens   \(107%\)\n  ⛔  OVER BY :  14,900 tokens\n/,
    )
    assert.match(message, /!!!   YOU MUST CALL `compress` NOW/)
    assert.match(message, /SELECTION : oldest resolved history first/)
})

test("iteration alert renders the exact banner frame", () => {
    const message = buildIterationAlert({ iterations: 12, tokens: 187432, max: 200000 })

    assert.ok(message.startsWith("◇ ⚠ ITERATION CHECKPOINT ⚠ ◇\n"))
    assert.match(
        message,
        /\n12 tool calls since the last user message · context 187,432 \/ 200,000 \(94%\)\n/,
    )
    assert.match(message, /Closed work compressed early costs nothing later\.$/)
})

test("percentages round to a whole number", () => {
    const down = buildWindowAlert({ ...windowInput, tokens: 186400, max: 200000 })
    const up = buildIterationAlert({ iterations: 1, tokens: 187600, max: 200000 })
    const whole = buildCeilingAlert({ tokens: 200000, max: 200000, over: 0, pct: 100 })

    assert.match(down, /tokens   \(93%\)/)
    assert.match(up, /\(94%\)/)
    assert.match(whole, /tokens   \(100%\)/)
})

test("thousands separators apply to every rendered count", () => {
    const message = buildWindowAlert({
        tokens: 1234567,
        max: 2000000,
        min: 1000000,
        headroom: 765433,
        blockCount: 1000,
        blockRefs: [],
    })

    assert.match(message, /1,234,567 \/ 2,000,000 tokens/)
    assert.match(message, /1,000,000 – 2,000,000/)
    assert.match(message, /765,433 tokens/)
    assert.match(message, /IN SESSION: 1,000 \(none\)/)
})

test("escalation glyphs are exclusive to one builder each", () => {
    const windowAlert = buildWindowAlert(windowInput)
    const ceilingAlert = buildCeilingAlert({ tokens: 214900, max: 200000, over: 14900, pct: 107 })
    const iterationAlert = buildIterationAlert({ iterations: 12, tokens: 187432, max: 200000 })

    assert.ok(windowAlert.includes("▲"))
    assert.ok(!ceilingAlert.includes("▲"))
    assert.ok(!iterationAlert.includes("▲"))

    assert.ok(ceilingAlert.includes("⛔"))
    assert.ok(!windowAlert.includes("⛔"))
    assert.ok(!iterationAlert.includes("⛔"))

    assert.ok(iterationAlert.includes("◇"))
    assert.ok(!windowAlert.includes("◇"))
    assert.ok(!ceilingAlert.includes("◇"))
})
