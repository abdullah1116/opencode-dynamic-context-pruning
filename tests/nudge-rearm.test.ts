import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const root = mkdtempSync(join(tmpdir(), "dcp-nudge-rearm-"))
const storageDir = join(root, "data", "opencode", "storage", "plugin", "dcp")
process.env.XDG_DATA_HOME = join(root, "data")
test.after(() => rmSync(root, { recursive: true, force: true }))

const { Logger } = await import("../lib/logger")
const { loadSessionState } = await import("../lib/state/persistence")
const { loadNudges } = await import("../lib/state/utils")

mkdirSync(storageDir, { recursive: true })

const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
} as unknown as Logger

function writeLegacyState(sessionID: string, nudges: Record<string, unknown>): void {
    writeFileSync(
        join(storageDir, `${sessionID}.json`),
        JSON.stringify({
            manualMode: false,
            prune: {
                tools: {},
                messages: {
                    byMessageId: {},
                    blocksById: {},
                    activeBlockIds: [],
                    activeByAnchorMessageId: {},
                    nextBlockId: 1,
                    nextRunId: 1,
                },
            },
            nudges,
            stats: { pruneTokenCounter: 0, totalPruneTokens: 0 },
            lastUpdated: new Date().toISOString(),
        }),
        "utf-8",
    )
}

test("legacy message-count nudge stamps load as never-fired token stamps", async () => {
    writeLegacyState("ses_legacy_nudges", { ceilingAt: 12, iterationAt: 7, windowAt: 4 })

    const state = await loadSessionState("ses_legacy_nudges", logger)

    assert.notEqual(state, null)
    assert.deepEqual(state?.nudges, { ceilingTokens: 0, iterationAt: 7, windowTokens: 0 })
})

test("invalid token stamps load as never fired", async () => {
    writeLegacyState("ses_broken_nudges", {
        ceilingTokens: -5,
        iterationAt: "3",
        windowTokens: null,
    })

    const state = await loadSessionState("ses_broken_nudges", logger)

    assert.notEqual(state, null)
    assert.deepEqual(state?.nudges, { ceilingTokens: 0, iterationAt: 0, windowTokens: 0 })
})

test("missing nudge fields default to never fired", () => {
    assert.deepEqual(loadNudges(undefined), {
        ceilingTokens: 0,
        iterationAt: 0,
        windowTokens: 0,
    })
})
