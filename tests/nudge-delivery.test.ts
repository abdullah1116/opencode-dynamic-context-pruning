import assert from "node:assert/strict"
import test from "node:test"
import type { PluginConfig } from "../lib/config"
import type { Logger } from "../lib/logger"
import { injectCompressNudges } from "../lib/messages/inject/inject"
import { buildCeilingAlert } from "../lib/prompts/alerts"
import { createSessionState, type SessionState, type WithParts } from "../lib/state"

const sessionID = "ses_nudge_transient"

function buildConfig(compress: Partial<PluginConfig["compress"]> = {}): PluginConfig {
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
            allowSubAgents: false,
            customPrompts: false,
        },
        protectedFilePatterns: [],
        compress: {
            mode: "range",
            permission: "allow",
            showCompression: false,
            maxContextLimit: 1000,
            minContextLimit: 100,
            nudgeFrequency: 1,
            iterationNudgeThreshold: 1,
            nudgeForce: "soft",
            protectedTools: ["task"],
            protectTags: false,
            protectUserMessages: false,
            ...compress,
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

function buildUserMessage(id: string, created: number): WithParts {
    return {
        info: {
            id,
            role: "user",
            sessionID,
            agent: "assistant",
            model: {
                providerID: "anthropic",
                modelID: "claude-test",
            },
            time: { created },
        } as WithParts["info"],
        parts: [
            {
                id: `${id}-part`,
                messageID: id,
                sessionID,
                type: "text" as const,
                text: "Continue.",
            },
        ],
    }
}

function buildAssistantMessage(id: string, created: number, input: number): WithParts {
    return {
        info: {
            id,
            role: "assistant",
            sessionID,
            agent: "assistant",
            time: { created },
            tokens: {
                input,
                output: 10,
                reasoning: 0,
                cache: { read: 0, write: 0 },
            },
        } as WithParts["info"],
        parts: [
            {
                id: `${id}-part`,
                messageID: id,
                sessionID,
                type: "text" as const,
                text: "Working on it.",
            },
        ],
    }
}

function buildLogger(onWarn: (message: string) => void): Logger {
    return { warn: (message: string) => onWarn(message) } as unknown as Logger
}

function getEphemeralNudges(messages: WithParts[]): WithParts[] {
    return messages.filter(
        (message) => message.info.role === "user" && message.info.id.startsWith("msg_nudge_ephemeral_"),
    )
}

function assertNudgeMessage(nudge: WithParts, text: string): void {
    assert.match(nudge.info.id, /^msg_nudge_ephemeral_[0-9a-f]{16}$/)
    assert.equal(nudge.info.role, "user")
    assert.equal(nudge.info.sessionID, sessionID)
    assert.equal((nudge.info as WithParts["info"] & { agent?: string }).agent, "assistant")
    assert.deepEqual((nudge.info as WithParts["info"] & { model?: object }).model, {
        providerID: "anthropic",
        modelID: "claude-test",
    })
    assert.equal(typeof (nudge.info as WithParts["info"] & { time?: { created: number } }).time?.created, "number")
    assert.equal(nudge.parts.length, 1)
    const part = nudge.parts[0]
    assert.match(part.id, /^prt_nudge_ephemeral_[0-9a-f]{16}$/)
    assert.equal(part.sessionID, sessionID)
    assert.equal(part.messageID, nudge.info.id)
    assert.equal(part.type, "text")
    assert.equal((part as { synthetic?: boolean }).synthetic, true)
    assert.equal(part.type === "text" ? part.text : "", text)
}

async function inject(state: SessionState, config: PluginConfig, messages: WithParts[]): Promise<void> {
    await injectCompressNudges(state, sessionID, config, buildLogger(() => {}), messages)
}

test("ceiling nudge is appended as a transient synthetic user message", async () => {
    const messages = [
        buildUserMessage("msg-user-ceiling", 1),
        buildAssistantMessage("msg-assistant-ceiling", 2, 1000),
    ]
    const state = createSessionState()
    const before = structuredClone(messages)

    await inject(state, buildConfig(), messages)

    const nudges = getEphemeralNudges(messages)
    assert.equal(nudges.length, 1)
    assert.equal(messages.length, before.length + 1)
    assert.deepEqual(messages.slice(0, before.length), before)
    assert.equal(nudges[0].parts[0].type === "text" ? nudges[0].parts[0].text : "", buildCeilingAlert({
        tokens: 1010,
        max: 1000,
        over: 10,
        pct: 101,
    }))
    assertNudgeMessage(nudges[0], buildCeilingAlert({ tokens: 1010, max: 1000, over: 10, pct: 101 }))
    assert.equal(state.nudges.ceilingTokens, 1010)
})

test("iteration nudge is selected when the threshold is crossed without a new user message", async () => {
    const messages = [
        buildUserMessage("msg-user-iteration", 1),
        buildAssistantMessage("msg-assistant-iteration", 2, 900),
    ]
    const state = createSessionState()
    const config = buildConfig({
        maxContextLimit: 5000,
        minContextLimit: 100,
        iterationNudgeThreshold: 1,
    })

    await inject(state, config, messages)

    const nudges = getEphemeralNudges(messages)
    assert.equal(nudges.length, 1)
    assert.match(
        nudges[0].parts[0].type === "text" ? nudges[0].parts[0].text : "",
        /ITERATION CHECKPOINT/,
    )
})

test("window nudge is selected in-window at a user turn boundary", async () => {
    const messages = [
        buildUserMessage("msg-user-window-1", 1),
        buildAssistantMessage("msg-assistant-window", 2, 900),
        buildUserMessage("msg-user-window-2", 3),
    ]
    const state = createSessionState()
    const config = buildConfig({ maxContextLimit: 5000, minContextLimit: 100 })

    await inject(state, config, messages)

    const nudges = getEphemeralNudges(messages)
    assert.equal(nudges.length, 1)
    assert.match(
        nudges[0].parts[0].type === "text" ? nudges[0].parts[0].text : "",
        /CONTEXT CHECKPOINT/,
    )
})

test("window nudge lists active blocks already compressed in the session", async () => {
    const messages = [
        buildUserMessage("msg-user-refs-1", 1),
        buildAssistantMessage("msg-assistant-refs", 2, 900),
        buildUserMessage("msg-user-refs-2", 3),
    ]
    const state = createSessionState("compact")
    state.prune.messages.activeBlockIds.add(2)
    state.prune.messages.activeBlockIds.add(1)
    state.prune.messages.activeBlockIds.add(0)
    const config = buildConfig({ maxContextLimit: 5000, minContextLimit: 100 })

    await inject(state, config, messages)

    const nudges = getEphemeralNudges(messages)
    assert.equal(nudges.length, 1)
    const text = nudges[0].parts[0].type === "text" ? nudges[0].parts[0].text : ""
    assert.match(text, /\n  Blocks already compressed: 2 \(@b1@, @b2@\)\n/)
})

test("repeated evaluations stay quiet until the frequency gate opens", async () => {
    const messages = [
        buildUserMessage("msg-user-repeat", 1),
        buildAssistantMessage("msg-assistant-repeat", 2, 1000),
    ]
    const state = createSessionState()
    const config = buildConfig({ nudgeFrequency: 5 })

    await inject(state, config, messages)
    await inject(state, config, messages)

    assert.equal(getEphemeralNudges(messages).length, 1)
    assert.equal(state.nudges.ceilingTokens, 1010)
})

test("a non-array messages shape is swallowed and logged once", async () => {
    const state = createSessionState()
    const warnings: string[] = []
    const logger = buildLogger((message) => warnings.push(message))
    const config = buildConfig()
    const messages = "not-an-array" as unknown as WithParts[]

    await injectCompressNudges(state, "ses_soft_fail", config, logger, messages)
    await injectCompressNudges(state, "ses_soft_fail", config, logger, messages)

    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /nudge messages array unavailable/)
    assert.equal(state.nudges.ceilingTokens, 0)
    assert.equal(state.nudges.iterationAt, 0)
    assert.equal(state.nudges.windowTokens, 0)
})

test("window nudge is edge-triggered and re-arms only past the token delta", async () => {
    const state = createSessionState()
    const config = buildConfig({ maxContextLimit: 50000, minContextLimit: 100 })

    const first = [
        buildUserMessage("msg-window-edge-user-1", 1),
        buildAssistantMessage("msg-window-edge-assistant-1", 2, 1000),
        buildUserMessage("msg-window-edge-user-2", 3),
    ]
    await inject(state, config, first)
    assert.equal(getEphemeralNudges(first).length, 1)
    assert.match(
        getEphemeralNudges(first)[0].parts[0].type === "text" ? getEphemeralNudges(first)[0].parts[0].text : "",
        /CONTEXT CHECKPOINT/,
    )

    const second = [
        buildUserMessage("msg-window-edge-user-1", 1),
        buildAssistantMessage("msg-window-edge-assistant-1", 2, 1000),
        buildUserMessage("msg-window-edge-user-2", 3),
        buildAssistantMessage("msg-window-edge-assistant-2", 4, 1020),
        buildUserMessage("msg-window-edge-user-3", 5),
    ]
    await inject(state, config, second)
    assert.equal(getEphemeralNudges(second).length, 0)

    const third = [
        buildUserMessage("msg-window-edge-user-1", 1),
        buildAssistantMessage("msg-window-edge-assistant-1", 2, 1000),
        buildUserMessage("msg-window-edge-user-2", 3),
        buildAssistantMessage("msg-window-edge-assistant-2", 4, 1020),
        buildUserMessage("msg-window-edge-user-3", 5),
        buildAssistantMessage("msg-window-edge-assistant-3", 6, 6020),
        buildUserMessage("msg-window-edge-user-4", 7),
    ]
    await inject(state, config, third)
    assert.equal(getEphemeralNudges(third).length, 1)
    assert.match(
        getEphemeralNudges(third)[0].parts[0].type === "text" ? getEphemeralNudges(third)[0].parts[0].text : "",
        /CONTEXT CHECKPOINT/,
    )
})

test("ceiling nudge is edge-triggered and re-arms only past the token delta", async () => {
    const state = createSessionState()
    const config = buildConfig({ maxContextLimit: 5000, minContextLimit: 100 })

    const first = [
        buildUserMessage("msg-ceiling-edge-user-1", 1),
        buildAssistantMessage("msg-ceiling-edge-assistant-1", 2, 6000),
    ]
    await inject(state, config, first)
    assert.equal(getEphemeralNudges(first).length, 1)
    assert.match(
        getEphemeralNudges(first)[0].parts[0].type === "text" ? getEphemeralNudges(first)[0].parts[0].text : "",
        /CONTEXT CEILING EXCEEDED/,
    )

    const second = [
        buildUserMessage("msg-ceiling-edge-user-1", 1),
        buildAssistantMessage("msg-ceiling-edge-assistant-1", 2, 6000),
        buildAssistantMessage("msg-ceiling-edge-assistant-2", 3, 6100),
    ]
    await inject(state, config, second)
    assert.equal(getEphemeralNudges(second).length, 0)

    const third = [
        buildUserMessage("msg-ceiling-edge-user-1", 1),
        buildAssistantMessage("msg-ceiling-edge-assistant-1", 2, 6000),
        buildAssistantMessage("msg-ceiling-edge-assistant-2", 3, 6100),
        buildAssistantMessage("msg-ceiling-edge-assistant-3", 4, 11100),
    ]
    await inject(state, config, third)
    assert.equal(getEphemeralNudges(third).length, 1)
    assert.match(
        getEphemeralNudges(third)[0].parts[0].type === "text" ? getEphemeralNudges(third)[0].parts[0].text : "",
        /CONTEXT CEILING EXCEEDED/,
    )
})

test("iteration nudge keeps its message-count cadence", async () => {
    const state = createSessionState()
    const config = buildConfig({
        maxContextLimit: 5000,
        minContextLimit: 100,
        iterationNudgeThreshold: 1,
        nudgeFrequency: 1,
    })

    const first = [
        buildUserMessage("msg-iteration-cadence-user", 1),
        buildAssistantMessage("msg-iteration-cadence-assistant-1", 2, 900),
    ]
    await inject(state, config, first)
    assert.equal(getEphemeralNudges(first).length, 1)
    assert.equal(state.nudges.iterationAt, 2)
    assert.match(
        getEphemeralNudges(first)[0].parts[0].type === "text" ? getEphemeralNudges(first)[0].parts[0].text : "",
        /ITERATION CHECKPOINT/,
    )

    const second = [
        buildUserMessage("msg-iteration-cadence-user", 1),
        buildAssistantMessage("msg-iteration-cadence-assistant-1", 2, 900),
        buildAssistantMessage("msg-iteration-cadence-assistant-2", 3, 900),
    ]
    await inject(state, config, second)
    assert.equal(getEphemeralNudges(second).length, 1)
    assert.equal(state.nudges.iterationAt, 3)
})
