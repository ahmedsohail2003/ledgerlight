/**
 * Curated vendor aliases for gold-set cases. The research JSON carries messy
 * display strings ("GC Strategies Inc. (GCStrategies)", "Dalian Enterprises
 * Inc. and Coradix Technology Consulting Ltd. (JV)"); this table maps each
 * case_id to the clean vendor names to look for in the contract data. Curated
 * by hand from the evidence collected in docs/research/gold_set_candidates.json.
 */
export const CASE_VENDOR_ALIASES: Record<string, string[]> = {
  'oag-2024-r1-arrivecan-gcstrategies': ['GC Strategies', 'GCstrategies', 'Coredal Systems Consulting'],
  'oag-2025-r4-gcstrategies-government-wide': ['GC Strategies', 'GCstrategies', 'Coredal Systems Consulting'],
  'gcs-portfolio-2011-2024': ['GC Strategies', 'GCstrategies', 'Coredal Systems Consulting'],
  'gcs-arrivecan-cbsa': ['GC Strategies', 'GCstrategies'],
  'opo-arrivecan-gcstrategies': ['GC Strategies', 'GCstrategies'],
  'oag-2024-r1-arrivecan-dalian-coradix': ['Dalian Enterprises', 'Coradix Technology Consulting', 'Dalian and Coradix'],
  'opo-arrivecan-dalian-coradix': ['Dalian Enterprises', 'Coradix Technology Consulting', 'Dalian and Coradix'],
  'dalian-yeo-dnd-conflict': ['Dalian Enterprises', 'Dalian and Coradix'],
  'coradix-suspension-2024': ['Coradix Technology Consulting', 'Coradix'],
  'oag-2024-r5-mckinsey': ['McKinsey', 'McKinsey and Company'],
  'mckinsey-professional-services': ['McKinsey', 'McKinsey and Company'],
  'opo-mckinsey-2024': ['McKinsey', 'McKinsey and Company'],
  'oag-2024-r8-ceba-accenture': ['Accenture'],
  'oag-2018-r1-phoenix-ibm': ['IBM Canada', 'IBM'],
  'opo-arrivecan-teksystems': ['TEKsystems', 'TEK systems'],
  'chca-pedabun-psib-shell': ['Pedabun 35 Nursing', 'Canadian Health Care Agency'],
  'ghi-boissonnault-psib': ['Global Health Imports'],
  'canadalife-pshcp-administration': ['Canada Life', 'The Canada Life Assurance Company'],
  'botler-cbsa-misconduct': ['GC Strategies', 'Dalian Enterprises', 'Coradix Technology Consulting'],
};
