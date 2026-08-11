import { getPool, getRoPool, closePool } from '../db/pool.js';
import { createGeminiGenerator, hasApiKey } from './gemini.js';
import { investigateVendor, persistInvestigation } from './investigator.js';

function renderMarkdown(result: Awaited<ReturnType<typeof investigateVendor>>, modelId: string | null): string {
  const b = result.brief;
  const tag = { rule_derived: '🟦 rule', sql_derived: '🟩 data', model_inference: '🟨 model' } as const;
  const lines = [
    `# Integrity brief: ${b.target}`,
    '',
    `> **${b.headline}**`,
    '',
    `- Assessment: \`${b.overall_assessment}\``,
    `- Source: **${result.mode === 'model' ? `LLM (${modelId}) — grounding-validated` : 'deterministic fallback (no free-form generation)'}**`,
    `- Attempts: ${result.attempts} · rejected drafts: ${result.validationFailures.length}`,
    '',
    '## Findings',
    ...b.claims.map((c) => {
      const refs = [
        ...c.rule_ids.map((r) => `rule:${r}`),
        ...c.regulation_citations.map((r) => `law:${r}`),
        ...c.figures.map((f) => `${f.evidence_ref}=${f.value}`),
      ];
      return `- [${tag[c.provenance]}] ${c.text}${refs.length ? `\n  - refs: ${refs.join(' · ')}` : ''}`;
    }),
    '',
    '## Limitations',
    b.limitations,
    '',
    '---',
    '*Every flag above is an indicator warranting review, not a finding of wrongdoing.*',
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const vendorArgIdx = process.argv.indexOf('--vendor');
  const target = vendorArgIdx >= 0 ? process.argv[vendorArgIdx + 1] : undefined;
  if (!target) {
    console.error('usage: npm run investigate --workspace @ledgerlight/server -- --vendor "Vendor Name"');
    process.exit(1);
  }

  const pool = getPool();
  const generator = hasApiKey() ? createGeminiGenerator() : null;
  if (!generator) console.log('(no GEMINI_API_KEY — running in deterministic fallback mode)');

  const result = await investigateVendor(pool, target, generator, getRoPool());
  const id = await persistInvestigation(pool, target, result, generator?.modelId ?? null);

  console.log(renderMarkdown(result, generator?.modelId ?? null));
  console.log(`\n(investigation #${id} persisted; mode=${result.mode}, attempts=${result.attempts})`);
  if (result.validationFailures.length > 0) {
    console.log('\nrejected drafts and reasons:');
    result.validationFailures.forEach((reasons, i) => {
      reasons.forEach((r) => console.log(`  attempt ${i + 1}: ${r}`));
    });
  }
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
