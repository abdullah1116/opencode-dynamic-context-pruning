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
