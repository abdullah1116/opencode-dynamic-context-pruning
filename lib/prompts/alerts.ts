const tokenFormatter = new Intl.NumberFormat("en-US")

function formatTokens(value: number): string {
    return tokenFormatter.format(Math.max(0, Math.round(value)))
}

function formatPercent(value: number, total: number): string {
    if (total <= 0) {
        return "0"
    }
    return String(Math.round((value / total) * 100))
}

function formatBlockRefs(refs: string[]): string {
    return refs.length > 0 ? ` (${refs.join(", ")})` : ""
}

export interface WindowAlertInput {
    tokens: number
    max: number
    min: number
    headroom: number
    blockCount: number
    blockRefs: string[]
}

export function buildWindowAlert(input: WindowAlertInput): string {
    const tokens = formatTokens(input.tokens)
    const max = formatTokens(input.max)
    const min = formatTokens(input.min)
    const headroom = formatTokens(input.headroom)
    const pct = formatPercent(input.tokens, input.max)
    const blockCount = formatTokens(input.blockCount)
    const refs = formatBlockRefs(input.blockRefs)

    return `╔═══════════════════════════════════════════════════════════════╗
║   CONTEXT CHECKPOINT · sweep due · nothing settled may be lost║
╚═══════════════════════════════════════════════════════════════╝

  CONTEXT    ${tokens} / ${max} tokens   (${pct}%)
  HEADROOM   ${headroom} before the limit
  BAND       ${min} – ${max}
───────────────────────────────────────────────────────────────

COMMAND: take one cheap pass over this window before continuing.

  1. CLASSIFY — seconds per message, no deep checks:
       A ACTIVE   in-flight this phase        → raw
       L LEDGER   decided, past phases        → compress, quote user
       R RECORD   finished work               → compress to outcomes
       X ERRATA   corrections                 → keep the fix, kill the corpse
       F DROSS    failed/retried commands     → drop
       T FACTS    paths, branches, links      → fact list
       O OPEN     unresolved threads          → keep listed
       C CHAFF    status noise                → drop

  2. LOWER THE BAR — compress anything CLOSED; junk dies entire.
     A one-line "it ran" outcome is enough for DROSS.
  3. GUARD — same phase? past USER messages stay. Only junk goes.
  4. TRUTH LENS FIRST — a corrected claim never survives as truth.

  Do not re-verify settled work. This is a sweep, not an audit.
  Blocks already compressed: ${blockCount}${refs}
╚═══════════════════════════════════════════════════════════════╝`
}

export interface CeilingAlertInput {
    tokens: number
    max: number
    over: number
    pct: number
}

export function buildCeilingAlert(input: CeilingAlertInput): string {
    const tokens = formatTokens(input.tokens)
    const max = formatTokens(input.max)
    const over = formatTokens(input.over)
    const pct = String(Math.round(input.pct))

    return `█████████████████████████████████████████████████████████████████
█   ⛔⛔⛔   !! CONTEXT CEILING EXCEEDED !!   ⛔⛔⛔
█████████████████████████████████████████████████████████████████

   🔺🔺🔺   D A N G E R   —   O V E R   H A R D   L I M I T   🔺🔺🔺

  ⛔  CONTEXT :  ${tokens} / ${max} tokens   (${pct}%)
  ⛔  OVER BY :  ${over} tokens

  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

   !!!   S T O P   N O R M A L   E X P L O R A T I O N   !!!
   !!!   YOU MUST CALL \`compress\` NOW                     !!!
   !!!   FINISH ONLY THE ATOMIC STEP IN FLIGHT, THEN COMPRESS !!!

  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

  ►  SELECTION : oldest resolved history first
  ►  NEVER COMPRESS : active instructions · unresolved questions ·
     constraints that still bind

█████████████████████████████████████████████████████████████████`
}

export interface IterationAlertInput {
    iterations: number
    tokens: number
    max: number
}

export function buildIterationAlert(input: IterationAlertInput): string {
    const iterations = formatTokens(input.iterations)
    const tokens = formatTokens(input.tokens)
    const max = formatTokens(input.max)
    const pct = formatPercent(input.tokens, input.max)

    return `◇ ⚠ ITERATION CHECKPOINT ⚠ ◇
${iterations} tool calls since the last user message · context ${tokens} / ${max} (${pct}%)

If any part of this turn is already closed — research finished, decision
made, file written — compress it before continuing.
Closed work compressed early costs nothing later.`
}
