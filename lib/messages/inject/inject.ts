import type { SessionState, WithParts } from "../../state"
import type { Logger } from "../../logger"
import type { PluginConfig } from "../../config"
import { formatMessageIdTag } from "../../message-ids"
import type { CompressionPriorityMap } from "../priority"
import { compressPermission } from "../../compress-permission"
import {
    getLastUserMessage,
    isIgnoredUserMessage,
    isProtectedUserMessage,
    messageHasCompress,
} from "../query"
import { saveSessionState } from "../../state/persistence"
import {
    appendToTextPart,
    appendToLastTextPart,
    appendToAllToolParts,
    createSyntheticTextPart,
    hasContent,
} from "../utils"
import { buildCeilingAlert, buildIterationAlert, buildWindowAlert } from "../../prompts/alerts"
import {
    countMessagesAfterIndex,
    deliverSyntheticNudge,
    findLastNonIgnoredMessage,
    getActiveBlockRefs,
    getIterationNudgeThreshold,
    getNudgeFrequency,
    getModelInfo,
    isContextOverLimits,
    isNudgeDue,
    type NudgeClient,
} from "./utils"

export const injectCompressNudges = async (
    client: NudgeClient | undefined,
    state: SessionState,
    sessionID: string | null,
    config: PluginConfig,
    logger: Logger,
    messages: WithParts[],
): Promise<void> => {
    if (!sessionID) {
        return
    }

    if (compressPermission(state, config) === "deny") {
        return
    }

    if (state.manualMode) {
        return
    }

    const lastMessage = findLastNonIgnoredMessage(messages)
    const lastAssistantMessage = messages.findLast((message) => message.info.role === "assistant")

    if (lastAssistantMessage && messageHasCompress(lastAssistantMessage)) {
        state.nudges.ceilingAt = 0
        state.nudges.iterationAt = 0
        state.nudges.windowAt = 0
        await saveSessionState(state, logger)
        return
    }

    if (!lastMessage) {
        return
    }

    const { providerId, modelId } = getModelInfo(messages)
    const { tokens, min, max, overMaxLimit, overMinLimit } = isContextOverLimits(
        config,
        state,
        providerId,
        modelId,
        messages,
    )

    let text: string | undefined
    let trigger: "ceilingAt" | "iterationAt" | "windowAt" | undefined

    if (overMaxLimit && max !== undefined) {
        if (isNudgeDue(state.nudges.ceilingAt, messages.length, getNudgeFrequency(config))) {
            text = buildCeilingAlert({
                tokens,
                max,
                over: tokens - max,
                pct: max > 0 ? (tokens / max) * 100 : 0,
            })
            trigger = "ceilingAt"
        }
    } else {
        const lastUserMessage = getLastUserMessage(messages)
        const lastUserMessageIndex = lastUserMessage
            ? messages.findIndex((message) => message.info.id === lastUserMessage.info.id)
            : -1
        const messagesSinceUser =
            lastUserMessageIndex >= 0 ? countMessagesAfterIndex(messages, lastUserMessageIndex) : 0

        const iterationCrossed =
            lastUserMessageIndex >= 0 &&
            lastMessage.index > lastUserMessageIndex &&
            messagesSinceUser >= getIterationNudgeThreshold(config)

        if (iterationCrossed && max !== undefined) {
            if (isNudgeDue(state.nudges.iterationAt, messages.length, getNudgeFrequency(config))) {
                text = buildIterationAlert({ iterations: messagesSinceUser, tokens, max })
                trigger = "iterationAt"
            }
        } else if (
            overMinLimit &&
            min !== undefined &&
            max !== undefined &&
            lastMessage.message.info.role === "user" &&
            lastAssistantMessage &&
            isNudgeDue(state.nudges.windowAt, messages.length, 1)
        ) {
            const blockRefs = getActiveBlockRefs(state)
            text = buildWindowAlert({
                tokens,
                max,
                min,
                headroom: max - tokens,
                blockCount: blockRefs.length,
                blockRefs,
            })
            trigger = "windowAt"
        }
    }

    if (!text || !trigger) {
        return
    }

    if (!(await deliverSyntheticNudge(client, sessionID, text, logger))) {
        return
    }

    state.nudges[trigger] = messages.length
    await saveSessionState(state, logger)
}

export const injectMessageIds = (
    state: SessionState,
    config: PluginConfig,
    messages: WithParts[],
    compressionPriorities?: CompressionPriorityMap,
): void => {
    if (compressPermission(state, config) === "deny") {
        return
    }

    for (const message of messages) {
        if (isIgnoredUserMessage(message)) {
            continue
        }

        const messageRef = state.messageIds.byRawId.get(message.info.id)
        if (!messageRef) {
            continue
        }

        const isBlockedMessage = isProtectedUserMessage(config, message)
        const priority =
            config.compress.mode === "message" && !isBlockedMessage
                ? compressionPriorities?.get(message.info.id)?.priority
                : undefined
        const tag = formatMessageIdTag(
            isBlockedMessage ? "BLOCKED" : messageRef,
            priority ? { priority } : undefined,
            state.idFormat,
        )

        if (message.info.role === "user") {
            let injected = false
            for (const part of message.parts) {
                if (part.type === "text") {
                    injected = appendToTextPart(part, tag) || injected
                }
            }

            if (injected) {
                continue
            }

            message.parts.push(createSyntheticTextPart(message, tag))
            continue
        }

        if (message.info.role !== "assistant") {
            continue
        }

        if (!hasContent(message)) {
            continue
        }

        if (appendToAllToolParts(message, tag)) {
            continue
        }

        if (appendToLastTextPart(message, tag)) {
            continue
        }

        const syntheticPart = createSyntheticTextPart(message, tag)
        const firstToolIndex = message.parts.findIndex((p) => p.type === "tool")
        if (firstToolIndex === -1) {
            message.parts.push(syntheticPart)
        } else {
            message.parts.splice(firstToolIndex, 0, syntheticPart)
        }
    }
}
