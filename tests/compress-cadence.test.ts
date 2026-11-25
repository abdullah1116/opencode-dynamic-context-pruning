import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { systemPrompt } from "../lib/prompts/system"

const repoRoot = join(import.meta.dirname, "..")

function readSchema(): {
    properties: { compress: { properties: Record<string, { default?: unknown }> } }
} {
    return JSON.parse(readFileSync(join(repoRoot, "dcp.schema.json"), "utf-8"))
}

test("compress cadence rule renders the configured value in the system prompt", () => {
    for (const prompt of [systemPrompt("xml", 7), systemPrompt("compact", 7)]) {
        assert.match(
            prompt,
            /Compress at minimum once every 7 messages — if 7 message positions have passed since the last compression, compress before starting new work\./,
        )
    }
})

test("compress cadence rule is omitted when the value is 0 or negative", () => {
    for (const value of [0, -3]) {
        const prompt = systemPrompt("xml", value)
        assert.doesNotMatch(prompt, /COMPRESSION CADENCE/)
        assert.doesNotMatch(prompt, /message positions have passed/)
        assert.match(prompt, /Evaluate conversation signal-to-noise REGULARLY/)
    }
})

test("compress cadence rule falls back to the default of 20", () => {
    for (const prompt of [systemPrompt(), systemPrompt("compact")]) {
        assert.match(prompt, /once every 20 messages/)
    }
})

test("compressEveryMessages defaults to 20 in config source, schema, and rendered prompt", () => {
    const configSource = readFileSync(join(repoRoot, "lib", "config.ts"), "utf-8")
    assert.match(configSource, /compressEveryMessages: 20,/)

    const schema = readSchema()
    assert.equal(schema.properties.compress.properties.compressEveryMessages.type, "number")
    assert.equal(schema.properties.compress.properties.compressEveryMessages.default, 20)

    assert.match(systemPrompt(), /once every 20 messages/)
})

test("absorbBlocks defaults to true in config source and schema", () => {
    const configSource = readFileSync(join(repoRoot, "lib", "config.ts"), "utf-8")
    assert.match(configSource, /absorbBlocks: true,/)

    const schema = readSchema()
    assert.equal(schema.properties.compress.properties.absorbBlocks.type, "boolean")
    assert.equal(schema.properties.compress.properties.absorbBlocks.default, true)
})

test("absorbBlocks explicit false override passes through merge and config keys", () => {
    const configSource = readFileSync(join(repoRoot, "lib", "config.ts"), "utf-8")
    assert.match(configSource, /absorbBlocks: override\.absorbBlocks \?\? base\.absorbBlocks,/)
    assert.match(configSource, /"compress\.absorbBlocks"/)
})
