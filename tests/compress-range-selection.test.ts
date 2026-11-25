import assert from "node:assert/strict"
import test from "node:test"
import { messagePrompt } from "../lib/prompts/compress-message"
import { rangePrompt } from "../lib/prompts/compress-range"

test("range prompt replaces permissive batching with batch as the default vehicle", () => {
    for (const prompt of [rangePrompt(), rangePrompt("compact")]) {
        assert.doesNotMatch(prompt, /When multiple independent ranges are ready/)
        assert.match(prompt, /Batch is the default vehicle/)
        assert.match(prompt, /emit ONE tool call/)
        assert.match(prompt, /exactly one closed range exists/)
    }
})

test("range prompt makes non-overlap a precondition with split or merge first", () => {
    for (const prompt of [rangePrompt(), rangePrompt("compact")]) {
        assert.match(prompt, /Non-overlap is a precondition/)
        assert.match(prompt, /split or merged/)
        assert.match(prompt, /Adjacent ranges that share no messages are fine/)
        assert.match(prompt, /Check boundaries while selecting, not while composing/)
    }
})

test("range prompt requires tight topic boundaries without live context padding", () => {
    for (const prompt of [rangePrompt(), rangePrompt("compact")]) {
        assert.match(prompt, /first message of its topic/)
        assert.match(prompt, /Do not pad a range with live context/)
    }
})

test("range prompt prefers granularity over one wide range", () => {
    for (const prompt of [rangePrompt(), rangePrompt("compact")]) {
        assert.match(prompt, /GRANULARITY/)
        assert.match(prompt, /several tight one-topic ranges/)
        assert.match(prompt, /The anti-pattern is a wide range over loosely related topics/)
        assert.match(prompt, /many tight ranges batched into one call/)
    }
})

test("range prompt keeps per-entry exhaustiveness independent of batching", () => {
    for (const prompt of [rangePrompt(), rangePrompt("compact")]) {
        assert.match(prompt, /full ★ detail/)
        assert.match(prompt, /Batching never buys brevity/)
    }
})

test("message prompt gets the same batch-default doctrine", () => {
    for (const prompt of [messagePrompt(), messagePrompt("compact")]) {
        assert.match(prompt, /Batch is the default vehicle/)
        assert.match(prompt, /exactly one message is ready/)
        assert.match(prompt, /batching never buys brevity/)
        assert.match(prompt, /GENERAL CLEANUP/)
    }
})
