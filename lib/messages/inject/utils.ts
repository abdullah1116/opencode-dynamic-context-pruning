import type { SessionState, WithParts } from "../../state"
import type { PluginConfig } from "../../config"
import type { Logger } from "../../logger"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { formatBlockRef } from "../../message-ids"
import { getLastUserMessage, isIgnoredUserMessage } from "../query"
import { generateStableId } from "../utils"
import { getCurrentTokenUsage } from "../../token-utils"
import { getActiveSummaryTokenUsage } from "../../state/utils"

export interface LastUserModelContext {
    providerId: string | undefined
    modelId: string | undefined
}

export interface LastNonIgnoredMessage {
    message: WithParts
    index: number
}

export interface ContextLimitUsage {
    tokens: number
    min: number | undefined
    max: number | undefined
    overMaxLimit: boolean
    overMinLimit: boolean
}

export function getNudgeFrequency(config: PluginConfig): number {
    return Math.max(1, Math.floor(config.compress.nudgeFrequency || 1))
}

export function getIterationNudgeThreshold(config: PluginConfig): number {
    return Math.max(1, Math.floor(config.compress.iterationNudgeThreshold || 1))
}

export function isNudgeDue(lastAt: number, messageCount: number, interval: number): boolean {
    return lastAt === 0 || messageCount - lastAt >= interval
}

export function getNudgeRearmDelta(max: number): number {
    return Math.max(5000, Math.round(max * 0.05))
}

export function isTokenNudgeDue(lastTokens: number, tokens: number, max: number): boolean {
    return lastTokens === 0 || tokens - lastTokens >= getNudgeRearmDelta(max)
}

export function findLastNonIgnoredMessage(messages: WithParts[]): LastNonIgnoredMessage | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (isIgnoredUserMessage(message)) {
            continue
        }
        return { message, index: i }
    }

    return null
}

export function countMessagesAfterIndex(messages: WithParts[], index: number): number {
    let count = 0

    for (let i = index + 1; i < messages.length; i++) {
        const message = messages[i]
        if (isIgnoredUserMessage(message)) {
            continue
        }
        count++
    }

    return count
}

export function getModelInfo(messages: WithParts[]): LastUserModelContext {
    const lastUserMessage = getLastUserMessage(messages)
    if (!lastUserMessage) {
        return {
            providerId: undefined,
            modelId: undefined,
        }
    }

    const userInfo = lastUserMessage.info as UserMessage
    return {
        providerId: userInfo.model.providerID,
        modelId: userInfo.model.modelID,
    }
}

function resolveContextTokenLimit(
    config: PluginConfig,
    state: SessionState,
    providerId: string | undefined,
    modelId: string | undefined,
    threshold: "max" | "min",
): number | undefined {
    const parseLimitValue = (limit: number | `${number}%` | undefined): number | undefined => {
        if (limit === undefined) {
            return undefined
        }

        if (typeof limit === "number") {
            return limit
        }

        if (!limit.endsWith("%") || state.modelContextLimit === undefined) {
            return undefined
        }

        const parsedPercent = parseFloat(limit.slice(0, -1))
        if (isNaN(parsedPercent)) {
            return undefined
        }

        const roundedPercent = Math.round(parsedPercent)
        const clampedPercent = Math.max(0, Math.min(100, roundedPercent))
        return Math.round((clampedPercent / 100) * state.modelContextLimit)
    }

    const modelLimits =
        threshold === "max" ? config.compress.modelMaxLimits : config.compress.modelMinLimits
    if (modelLimits && providerId !== undefined && modelId !== undefined) {
        const providerModelId = `${providerId}/${modelId}`
        const modelLimit = modelLimits[providerModelId]
        if (modelLimit !== undefined) {
            return parseLimitValue(modelLimit)
        }
    }

    const globalLimit =
        threshold === "max" ? config.compress.maxContextLimit : config.compress.minContextLimit
    return parseLimitValue(globalLimit)
}

export function isContextOverLimits(
    config: PluginConfig,
    state: SessionState,
    providerId: string | undefined,
    modelId: string | undefined,
    messages: WithParts[],
): ContextLimitUsage {
    const summaryTokenExtension = config.compress.summaryBuffer
        ? getActiveSummaryTokenUsage(state)
        : 0
    const resolvedMaxContextLimit = resolveContextTokenLimit(
        config,
        state,
        providerId,
        modelId,
        "max",
    )
    const max =
        resolvedMaxContextLimit === undefined
            ? undefined
            : resolvedMaxContextLimit + summaryTokenExtension
    const min = resolveContextTokenLimit(config, state, providerId, modelId, "min")
    const tokens = getCurrentTokenUsage(state, messages)

    return {
        tokens,
        min,
        max,
        overMaxLimit: max === undefined ? false : tokens > max,
        overMinLimit: min === undefined ? true : tokens >= min,
    }
}

const warnedRefSessions = new Set<string>()

export function getActiveBlockRefs(state: SessionState, logger?: Logger): string[] {
    const refs: string[] = []
    const blockIds = Array.from(state.prune.messages.activeBlockIds)
        .filter((id) => Number.isInteger(id) && id > 0)
        .sort((a, b) => a - b)

    for (const id of blockIds) {
        try {
            const ref = formatBlockRef(id, state.idFormat)
            if (ref.length === 0) {
                throw new Error("empty block ref")
            }
            refs.push(ref)
        } catch (error) {
            const sessionID = state.sessionId ?? "unknown"
            if (!warnedRefSessions.has(sessionID)) {
                warnedRefSessions.add(sessionID)
                logger?.warn("failed to format active block ref, omitting it", {
                    sessionID,
                    blockId: id,
                    error: error instanceof Error ? error.message : undefined,
                })
            }
        }
    }

    return refs
}

const warnedNudgeSessions = new Set<string>()

export function warnNudgeUnavailable(logger: Logger, sessionID: string): void {
    if (warnedNudgeSessions.has(sessionID)) {
        return
    }

    warnedNudgeSessions.add(sessionID)
    logger.warn("nudge messages array unavailable, skipping compress nudge", {
        sessionID,
    })
}

export function createEphemeralNudgeMessage(
    baseMessage: WithParts,
    sessionID: string,
    trigger: string,
    text: string,
): WithParts {
    const userInfo = baseMessage.info as UserMessage
    const seed = `${sessionID}:${trigger}`
    const messageId = generateStableId("msg_nudge_ephemeral", seed)
    const partId = generateStableId("prt_nudge_ephemeral", seed)

    return {
        info: {
            id: messageId,
            sessionID,
            role: "user" as const,
            agent: userInfo.agent,
            model: userInfo.model,
            time: { created: Date.now() },
        },
        parts: [
            {
                id: partId,
                sessionID,
                messageID: messageId,
                type: "text" as const,
                text,
                synthetic: true,
            },
        ],
    }
}

export function appendEphemeralNudge(
    sessionID: string,
    trigger: string,
    text: string,
    messages: WithParts[],
): boolean {
    const baseMessage = getLastUserMessage(messages)
    if (!baseMessage) {
        return false
    }

    const message = createEphemeralNudgeMessage(baseMessage, sessionID, trigger, text)
    if (messages.some((existing) => existing.info.id === message.info.id)) {
        return false
    }

    messages.push(message)
    return true
}
