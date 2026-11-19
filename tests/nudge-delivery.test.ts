import assert from "node:assert/strict"
import test from "node:test"
import type { PluginConfig } from "../lib/config"
import type { Logger } from "../lib/logger"
import { injectCompressNudges } from "../lib/messages/inject/inject"
import { buildCeilingAlert } from "../lib/prompts/alerts"
import { createSessionState, type WithParts } from "../lib/state"

const sessionID = "ses_synthetic_nudges"

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

function buildRecorder() {
    const calls: any[] = []
    return {
        calls,
        client: {
            session: {
                synthetic: async (input: any) => {
                    calls.push(input)
                    return { data: {} }
                },
            },
        },
    }
}

function buildLogger(onWarn: (message: string) => void): Logger {
    return { warn: (message: string) => onWarn(message) } as unknown as Logger
}

test("ceiling nudge is admitted as a hidden no-reply synthetic message", async () => {
    const messages = [
        buildUserMessage("msg-user-ceiling", 1),
        buildAssistantMessage("msg-assistant-ceiling", 2, 1000),
    ]
    const state = createSessionState()
    const { calls, client } = buildRecorder()
    const before = structuredClone(messages)

    await injectCompressNudges(
        client,
        state,
        sessionID,
        buildConfig(),
        buildLogger(() => {}),
        messages,
    )

    assert.equal(calls.length, 1)
    assert.deepEqual(Object.keys(calls[0]).sort(), ["resume", "sessionID", "text"])
    assert.equal(calls[0].sessionID, sessionID)
    assert.equal(calls[0].resume, false)
    assert.equal(calls[0].description, undefined)
    assert.equal(calls[0].metadata, undefined)
    assert.equal(calls[0].text, buildCeilingAlert({ tokens: 1010, max: 1000, over: 10, pct: 101 }))
    assert.deepEqual(messages, before)
})

test("iteration nudge is selected when the threshold is crossed without a new user message", async () => {
    const messages = [
        buildUserMessage("msg-user-iteration", 1),
        buildAssistantMessage("msg-assistant-iteration", 2, 900),
    ]
    const state = createSessionState()
    const { calls, client } = buildRecorder()
    const config = buildConfig({
        maxContextLimit: 5000,
        minContextLimit: 100,
        iterationNudgeThreshold: 1,
    })

    await injectCompressNudges(
        client,
        state,
        sessionID,
        config,
        buildLogger(() => {}),
        messages,
    )

    assert.equal(calls.length, 1)
    assert.match(calls[0].text, /ITERATION CHECKPOINT/)
    assert.equal(calls[0].resume, false)
})

test("window nudge is selected in-window at a user turn boundary", async () => {
    const messages = [
        buildUserMessage("msg-user-window-1", 1),
        buildAssistantMessage("msg-assistant-window", 2, 900),
        buildUserMessage("msg-user-window-2", 3),
    ]
    const state = createSessionState()
    const { calls, client } = buildRecorder()
    const config = buildConfig({ maxContextLimit: 5000, minContextLimit: 100 })

    await injectCompressNudges(
        client,
        state,
        sessionID,
        config,
        buildLogger(() => {}),
        messages,
    )

    assert.equal(calls.length, 1)
    assert.match(calls[0].text, /CONTEXT WINDOW ALERT/)
    assert.equal(calls[0].resume, false)
})

test("window nudge lists active blocks as the placeholders compress requires", async () => {
    const messages = [
        buildUserMessage("msg-user-refs-1", 1),
        buildAssistantMessage("msg-assistant-refs", 2, 900),
        buildUserMessage("msg-user-refs-2", 3),
    ]
    const state = createSessionState("compact")
    state.prune.messages.activeBlockIds.add(2)
    state.prune.messages.activeBlockIds.add(1)
    state.prune.messages.activeBlockIds.add(0)
    const { calls, client } = buildRecorder()
    const config = buildConfig({ maxContextLimit: 5000, minContextLimit: 100 })

    await injectCompressNudges(
        client,
        state,
        sessionID,
        config,
        buildLogger(() => {}),
        messages,
    )

    assert.equal(calls.length, 1)
    assert.match(calls[0].text, /\n  ▣  COMPRESSED BLOCKS IN SESSION: 2 \(@b1@, @b2@\)\n/)
})

test("repeated evaluations stay quiet until the frequency gate opens", async () => {
    const messages = [
        buildUserMessage("msg-user-repeat", 1),
        buildAssistantMessage("msg-assistant-repeat", 2, 1000),
    ]
    const state = createSessionState()
    const { calls, client } = buildRecorder()
    const config = buildConfig({ nudgeFrequency: 5 })

    await injectCompressNudges(
        client,
        state,
        sessionID,
        config,
        buildLogger(() => {}),
        messages,
    )
    await injectCompressNudges(
        client,
        state,
        sessionID,
        config,
        buildLogger(() => {}),
        messages,
    )

    assert.equal(calls.length, 1)
})

test("missing session.synthetic is swallowed and logged once", async () => {
    const messages = [
        buildUserMessage("msg-user-soft", 1),
        buildAssistantMessage("msg-assistant-soft", 2, 1000),
    ]
    const state = createSessionState()
    const warnings: string[] = []
    const logger = buildLogger((message) => warnings.push(message))
    const config = buildConfig()

    await injectCompressNudges({ session: {} }, state, "ses_soft_fail", config, logger, messages)
    await injectCompressNudges({ session: {} }, state, "ses_soft_fail", config, logger, messages)

    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /session\.synthetic unavailable/)
})

test("window nudge is edge-triggered and re-arms only past the token delta", async () => {
    const state = createSessionState()
    const { calls, client } = buildRecorder()
    const config = buildConfig({ maxContextLimit: 50000, minContextLimit: 100 })

    const first = [
        buildUserMessage("msg-window-edge-user-1", 1),
        buildAssistantMessage("msg-window-edge-assistant-1", 2, 1000),
        buildUserMessage("msg-window-edge-user-2", 3),
    ]
    await injectCompressNudges(
        client,
        state,
        sessionID,
        config,
        buildLogger(() => {}),
        first,
    )
    assert.equal(calls.length, 1)
    assert.match(calls[0].text, /CONTEXT WINDOW ALERT/)

    const second = [
        ...first,
        buildAssistantMessage("msg-window-edge-assistant-2", 4, 1020),
        buildUserMessage("msg-window-edge-user-3", 5),
    ]
    await injectCompressNudges(
        client,
        state,
        sessionID,
        config,
        buildLogger(() => {}),
        second,
    )
    assert.equal(calls.length, 1)

    const third = [
        ...second,
        buildAssistantMessage("msg-window-edge-assistant-3", 6, 6020),
        buildUserMessage("msg-window-edge-user-4", 7),
    ]
    await injectCompressNudges(
        client,
        state,
        sessionID,
        config,
        buildLogger(() => {}),
        third,
    )
    assert.equal(calls.length, 2)
    assert.match(calls[1].text, /CONTEXT WINDOW ALERT/)
})

test("ceiling nudge is edge-triggered and re-arms only past the token delta", async () => {
    const state = createSessionState()
    const { calls, client } = buildRecorder()
    const config = buildConfig({ maxContextLimit: 5000, minContextLimit: 100 })

    const first = [
        buildUserMessage("msg-ceiling-edge-user-1", 1),
        buildAssistantMessage("msg-ceiling-edge-assistant-1", 2, 6000),
    ]
    await injectCompressNudges(
        client,
        state,
        sessionID,
        config,
        buildLogger(() => {}),
        first,
    )
    assert.equal(calls.length, 1)
    assert.match(calls[0].text, /CONTEXT CEILING EXCEEDED/)

    const second = [...first, buildAssistantMessage("msg-ceiling-edge-assistant-2", 3, 6100)]
    await injectCompressNudges(
        client,
        state,
        sessionID,
        config,
        buildLogger(() => {}),
        second,
    )
    assert.equal(calls.length, 1)

    const third = [...second, buildAssistantMessage("msg-ceiling-edge-assistant-3", 4, 11100)]
    await injectCompressNudges(
        client,
        state,
        sessionID,
        config,
        buildLogger(() => {}),
        third,
    )
    assert.equal(calls.length, 2)
    assert.match(calls[1].text, /CONTEXT CEILING EXCEEDED/)
})

test("iteration nudge keeps its message-count cadence", async () => {
    const state = createSessionState()
    const { calls, client } = buildRecorder()
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
    await injectCompressNudges(
        client,
        state,
        sessionID,
        config,
        buildLogger(() => {}),
        first,
    )
    assert.equal(calls.length, 1)
    assert.match(calls[0].text, /ITERATION CHECKPOINT/)

    const second = [...first, buildAssistantMessage("msg-iteration-cadence-assistant-2", 3, 900)]
    await injectCompressNudges(
        client,
        state,
        sessionID,
        config,
        buildLogger(() => {}),
        second,
    )
    assert.equal(calls.length, 2)
    assert.match(calls[1].text, /ITERATION CHECKPOINT/)
})
