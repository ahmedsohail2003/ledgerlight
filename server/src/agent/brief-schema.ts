import { z } from 'zod';

/**
 * The integrity brief the agent must produce. Structure is the contract that
 * makes grounding enforceable:
 *  - every numeric figure a claim states must be DECLARED in `figures`, each
 *    pointing at a JSON path in the evidence pack it came from;
 *  - a claim asserting a red flag must reference fired rule ids;
 *  - regulation citations must resolve to clauses retrieved for this case;
 *  - `model_inference` claims are opinions/synthesis: no figures, no flags.
 */
export const FigureSchema = z.object({
  /** JSON path into the evidence pack, e.g. "profile.total_value" or "top_contracts[2].contract_value" */
  evidence_ref: z.string().min(1),
  /** The exact numeric value as it appears in the evidence */
  value: z.number(),
});

export const ClaimSchema = z.object({
  text: z.string().min(1),
  provenance: z.enum(['rule_derived', 'sql_derived', 'model_inference']),
  rule_ids: z.array(z.string()).default([]),
  figures: z.array(FigureSchema).default([]),
  /** Stable regulation chunk_ids (e.g. "GCR-s6"); each must be in the set
   *  retrieved for this investigation, enforced by the grounding validator. */
  regulation_citations: z.array(z.string()).default([]),
});

export const BriefSchema = z.object({
  target: z.string().min(1),
  headline: z.string().min(1),
  overall_assessment: z.enum(['indicators_warrant_review', 'no_indicators_found', 'insufficient_data']),
  claims: z.array(ClaimSchema).min(1),
  limitations: z.string().min(1),
});

export type Figure = z.infer<typeof FigureSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type Brief = z.infer<typeof BriefSchema>;

/** JSON Schema fed to Gemini's structured-output mode (kept in sync with Zod). */
export const BRIEF_JSON_SCHEMA = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    headline: { type: 'string' },
    overall_assessment: {
      type: 'string',
      enum: ['indicators_warrant_review', 'no_indicators_found', 'insufficient_data'],
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          provenance: { type: 'string', enum: ['rule_derived', 'sql_derived', 'model_inference'] },
          rule_ids: { type: 'array', items: { type: 'string' } },
          figures: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                evidence_ref: { type: 'string' },
                value: { type: 'number' },
              },
              required: ['evidence_ref', 'value'],
            },
          },
          regulation_citations: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'provenance', 'rule_ids', 'figures', 'regulation_citations'],
      },
    },
    limitations: { type: 'string' },
  },
  required: ['target', 'headline', 'overall_assessment', 'claims', 'limitations'],
} as const;
