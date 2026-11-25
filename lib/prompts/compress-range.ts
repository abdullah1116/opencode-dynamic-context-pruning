import type { IdFormat } from "../message-ids"

export function rangePrompt(format: IdFormat = "xml"): string {
    const compact = format === "compact"
    const message = compact ? "@4@" : "mNNNN"
    const block = compact ? "@b1@" : "bN"
    const placeholder = compact ? "@b1@" : "(bN)"
    return `Collapse a range in the conversation into a detailed summary.

THE SUMMARY
Your summary is an authoritative record. Be EXHAUSTIVE for the ★ subtypes and LEAN everywhere else. That is the whole trade-off: detail goes to ★, brevity comes from everything else, and what you cannot classify earns no record at all.

USER INTENT FIDELITY
User messages are the highest authority in the record. Preserve scope, constraints, priorities and acceptance criteria exactly as stated. Quote user messages verbatim whenever they are short enough, and quote ALL user input from past phases, not only the recent lines.

CONTEXT MAP — classify every message before you write
       A ACTIVE   in-flight this phase     → keep raw (never inside a compressed range)
       L LEDGER   decided, past phases     → compress; user words verbatim
       R RECORD   finished work            → compress to outcomes
       X ERRATA   corrections              → keep the fix verbatim, mark the corpse
       F DROSS    failed or retried runs   → drop (one clause if a lesson survived)
       T FACTS    paths, branches, links   → fact list
       O OPEN     unresolved threads       → keep listed
       C CHAFF    status noise             → drop

★ NEVER LOSE — if length forces a choice, ★ detail wins over all prose:
       A1 target in hand      A2 operation in flight   A4 this phase's user words
       L1 user verdicts       L2 constraints           R1 shipped work (with IDs)
       T1 coordinates         T3 tool/CLI quirks       O1 in-flight dependencies
       O2 unanswered asks     X1 user corrections      X3 reversals

THREE LENSES — same order, every message
  1. TRUTH  — is this already corrected? ERRATA rules before anything else.
  2. LOSS   — would losing it force re-derivation? ★ items survive in full.
  3. WASTE  — is it replayable from files or elsewhere? drop without a record.

ERRORS
Never preserve an error that was later fixed. Its only memory is the working invocation, now in FACTS, plus one clause for the lesson, if one survived.

COMPRESSED BLOCKS
The range may consume blocks that are already compressed. The tool names the required placeholders when it needs them.

Absorb mode (no placeholder named): write ONE merged summary and emit no placeholder token at all — nothing parses it and it would surface as literal text.

Placeholder mode (required blocks named): reference each one with this exact format:

- \`${placeholder}\`

Compressed block sections carry the header \`[Compressed conversation section]\`.

${compact ? "Compressed block IDs look like `@b1@`, distinct from raw message IDs like `@4@`." : "Compressed block IDs always use the `bN` form (never `mNNNN`) and use the same XML metadata tag format."}

Rules:

- Include every required block placeholder exactly once.
- Do not invent placeholders for blocks outside the selected range.
- Treat \`${placeholder}\` as a RESERVED TOKEN: never emit it except as an intentional placeholder.
- To name a block in prose, write plain text like \`compressed ${compact ? "block 1" : "bN"}\`.
- Preflight: the placeholder set in your summary equals the required set — no duplicates, no extras.

Placeholders are semantic references: each is replaced with the full stored block content when the tool processes your output.

FLOW PRESERVATION
Text around a placeholder must read correctly AFTER expansion. Treat the placeholder as a stand-in for a full conversation segment, keep chronology and causality across it, and never write a sentence that depends on it staying literal (for example "as noted in \`${compact ? "@b2@" : "(b2)"}\`").

BOUNDARY IDS
You specify boundaries by ID using the injected IDs visible in the conversation:

- \`${message}\` IDs identify raw messages
- \`${block}\` IDs identify previously compressed blocks

${compact ? "Each message has an ID like `@4@`. Copy the whole marker, including both `@` characters, into `startId` and `endId`." : "Each message has an ID inside XML metadata tags like `<dcp-message-id>...</dcp-message-id>`."}
The same ID tag appears in every tool output of the message it belongs to — each unique ID identifies one complete message.
Treat these tags as boundary metadata only, not as tool result content.

Rules:

- Pick \`startId\` and \`endId\` directly from injected IDs in context.
- IDs must exist in the current visible context.
- \`startId\` must appear before \`endId\`.
- Do not invent IDs. Use only IDs that are present in context.

BATCHING

Batch is the default vehicle: sweep the whole conversation for closed ranges, then emit ONE tool call carrying every ready range as a separate entry in the \`content\` array. A single-range call is the exception, justified only when exactly one closed range exists.

Non-overlap is a precondition, not an error to discover after the fact: ranges must not overlap. Adjacent ranges that share no messages are fine; overlapping ranges must be split or merged before batching. Check boundaries while selecting, not while composing.

Boundaries are tight: start a range at the first message of its topic and end it at the topic's last message. Do not pad a range with live context — still-active conversation stays outside every range, in every entry of the batch.

GRANULARITY: prefer several tight one-topic ranges over one wide range spanning unrelated topics. The anti-pattern is a wide range over loosely related topics — it erases topic structure permanently. The preferred shape is many tight ranges batched into one call.

Each entry carries full ★ detail for its own range. Batching never buys brevity: no entry's summary is trimmed for the batch's sake.
`
}

export const COMPRESS_RANGE = rangePrompt()
