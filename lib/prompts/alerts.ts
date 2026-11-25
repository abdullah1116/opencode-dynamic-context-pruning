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
║   ▲▲▲   CONTEXT WINDOW ALERT   ▲▲▲   ACTION REQUIRED          ║
╚═══════════════════════════════════════════════════════════════╝

    ▰▰▰▰▰▰▰▰▰▰▰▰▰    ▲▲▲    ▰▰▰▰▰▰▰▰▰▰▰▰▰

  ⚠  CONTEXT  :  ${tokens} / ${max} tokens   (${pct}%)
  ⚠  WINDOW   :  ${min} – ${max}
  ⚠  HEADROOM :  ${headroom} tokens before the hard ceiling

───────────────────────────────────────────────────────────────

  ▲▲   EVALUATE THE CONVERSATION FOR COMPRESSIBLE RANGES   ▲▲

  →  CLOSED RANGES      call \`compress\` on them NOW
  →  DIRECTION SHIFTED  compress the older, irrelevant ranges first
  →  ACTIVE WORK        leave uncompressed — never compress live context

───────────────────────────────────────────────────────────────

  ▣  COMPRESSED BLOCKS IN SESSION: ${blockCount}${refs}

     If your chosen range includes a listed block, include each
     required placeholder exactly once in the summary.

╔═══════════════════════════════════════════════════════════════╗
║  ⚑   DO NOT LET THE CEILING ARRIVE UNNOTICED                  ║
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
