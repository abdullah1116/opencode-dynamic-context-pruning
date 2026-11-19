import assert from "node:assert/strict"
import test from "node:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdirSync } from "node:fs"
import { createCompressRangeTool } from "../lib/compress/range"
import { createSessionState, type SessionState, type WithParts } from "../lib/state"
import type { PluginConfig } from "../lib/config"
import { Logger } from "../lib/logger"

const testDataHome = join(tmpdir(), `opencode-dcp-absorb-tests-${process.pid}`)
const testConfigHome = join(tmpdir(), `opencode-dcp-absorb-config-tests-${process.pid}`)

process.env.XDG_DATA_HOME = testDataHome
process.env.XDG_CONFIG_HOME = testConfigHome

mkdirSync(testDataHome, { recursive: true })
mkdirSync(testConfigHome, { recursive: true })

function buildConfig(absorbBlocks: boolean): PluginConfig {
    return {
        enabled: true,
        debug: false,
        pruneNotification: "off",
        pruneNotificationType: "chat",
        commands: {
            enabled: true,
            protectedTools: [],
        },
        manualMode: {
            enabled: false,
            automaticStrategies: true,
        },
        turnProtection: {
            enabled: false,
            turns: 4,
        },
        experimental: {
            allowSubAgents: true,
            customPrompts: false,
        },
        protectedFilePatterns: [],
        compress: {
            mode: "range",
            permission: "allow",
            showCompression: false,
            summaryBuffer: true,
            absorbBlocks,
            maxContextLimit: 150000,
            minContextLimit: 50000,
            nudgeFrequency: 5,
            iterationNudgeThreshold: 15,
            nudgeForce: "soft",
            protectedTools: [],
            protectTags: false,
            protectUserMessages: false,
        },
        strategies: {
            deduplication: {
                enabled: true,
                protectedTools: [],
            },
            purgeErrors: {
                enabled: true,
                turns: 4,
                protectedTools: [],
            },
        },
    }
}

function textPart(messageID: string, sessionID: string, id: string, text: string) {
    return {
        id,
        messageID,
        sessionID,
        type: "text" as const,
        text,
    }
}

function buildMessages(sessionID: string): WithParts[] {
    return [1, 2].map((index) => ({
        info: {
            id: `msg-assistant-${index}`,
            role: "assistant",
            sessionID,
            agent: "assistant",
            time: { created: index },
        } as WithParts["info"],
        parts: [
            textPart(
                `msg-assistant-${index}`,
                sessionID,
                `part-assistant-${index}`,
                `Assistant body ${index}`,
            ),
        ],
    }))
}

function createTool(state: SessionState, config: PluginConfig, rawMessages: WithParts[]) {
    return createCompressRangeTool({
        client: {
            session: {
                messages: async () => ({ data: rawMessages }),
                get: async () => ({ data: { parentID: null } }),
            },
        },
        state,
        logger: new Logger(false),
        config,
        prompts: {
            reload() {},
            getRuntimePrompts() {
                return { compressRange: "", compressMessage: "" }
            },
        },
    } as any)
}

async function compressRange(
    state: SessionState,
    config: PluginConfig,
    rawMessages: WithParts[],
    startId: string,
    endId: string,
    summary: string,
    messageID: string,
): Promise<void> {
    const tool = createTool(state, config, rawMessages)
    await tool.execute(
        {
            topic: messageID,
            content: [{ startId, endId, summary }],
        },
        {
            ask: async () => {},
            metadata: () => {},
            sessionID: rawMessages[0]?.info.sessionID,
            messageID,
        },
    )
}

async function runNestedCompression(absorbBlocks: boolean) {
    const sessionID = `ses_range_absorb_${absorbBlocks}_${Date.now()}`
    const rawMessages = buildMessages(sessionID)
    const state = createSessionState()
    const config = buildConfig(absorbBlocks)

    await compressRange(
        state,
        config,
        rawMessages,
        "m0001",
        "m0001",
        "First block stored text",
        "msg-compress-1",
    )
    await compressRange(
        state,
        config,
        rawMessages,
        "m0002",
        "m0002",
        "Second block stored text",
        "msg-compress-2",
    )
    await compressRange(
        state,
        config,
        rawMessages,
        "m0001",
        "m0002",
        "Consolidated nested summary",
        "msg-compress-3",
    )

    const first = state.prune.messages.blocksById.get(1)
    const second = state.prune.messages.blocksById.get(2)
    const nested = state.prune.messages.blocksById.get(3)
    assert.ok(first, "block 1 missing")
    assert.ok(second, "block 2 missing")
    assert.ok(nested, "nested block missing")

    return { state, first, second, nested }
}

test("compress range absorbBlocks drops consumed block text while deactivating them", async () => {
    const absorbed = await runNestedCompression(true)

    assert.doesNotMatch(absorbed.nested.summary, /First block stored text/)
    assert.doesNotMatch(absorbed.nested.summary, /Second block stored text/)
    assert.match(absorbed.nested.summary, /Consolidated nested summary/)
    assert.deepEqual(absorbed.nested.consumedBlockIds, [1, 2])

    assert.equal(absorbed.first.active, false)
    assert.equal(absorbed.second.active, false)
    assert.deepEqual(absorbed.first.parentBlockIds, [3])
    assert.deepEqual(absorbed.second.parentBlockIds, [3])
    assert.equal(absorbed.state.prune.messages.activeBlockIds.has(1), false)
    assert.equal(absorbed.state.prune.messages.activeBlockIds.has(2), false)
    assert.equal(absorbed.state.prune.messages.activeBlockIds.has(3), true)

    const inlined = await runNestedCompression(false)

    assert.match(inlined.nested.summary, /First block stored text/)
    assert.match(inlined.nested.summary, /Second block stored text/)
    assert.match(inlined.nested.summary, /Consolidated nested summary/)
    assert.equal(inlined.first.active, false)
    assert.equal(inlined.second.active, false)
    assert.deepEqual(inlined.first.parentBlockIds, [3])
    assert.deepEqual(inlined.second.parentBlockIds, [3])
})
