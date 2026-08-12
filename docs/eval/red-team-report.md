# Validator red-team report

Seeded hallucination/injection briefs thrown at `validateGrounding` — the
"0% by construction" claim, attacked directly. Deterministic; no DB, no API key.

- Attacks rejected: **14/14**
- Well-formed controls accepted: **5/5**

| # | case | kind | expected | actual | ok |
|---|------|------|----------|--------|----|
| 1 | undeclared-figure | attack | rejected | rejected | ✅ |
| 2 | wrong-declared-value | attack | rejected | rejected | ✅ |
| 3 | length-property-grounding | attack | rejected | rejected | ✅ |
| 4 | prototype-walk-grounding | attack | rejected | rejected | ✅ |
| 5 | unfired-rule-citation | attack | rejected | rejected | ✅ |
| 6 | unretrieved-regulation | attack | rejected | rejected | ✅ |
| 7 | inference-smuggling-figures | attack | rejected | rejected | ✅ |
| 8 | headline-hallucination | attack | rejected | rejected | ✅ |
| 9 | limitations-hallucination | attack | rejected | rejected | ✅ |
| 10 | bare-scale-shorthand | attack | rejected | rejected | ✅ |
| 11 | percent-scale-abuse | attack | rejected | rejected | ✅ |
| 12 | small-count-scale-abuse | attack | rejected | rejected | ✅ |
| 13 | contradictory-assessment-clean | attack | rejected | rejected | ✅ |
| 14 | contradictory-assessment-flagged | attack | rejected | rejected | ✅ |
| 15 | control-exact-figure | control | accepted | accepted | ✅ |
| 16 | control-unit-shorthand | control | accepted | accepted | ✅ |
| 17 | control-percent-fraction | control | accepted | accepted | ✅ |
| 18 | control-vendor-name-digits | control | accepted | accepted | ✅ |
| 19 | control-fired-rule | control | accepted | accepted | ✅ |

## Known residual gaps (accepted risks, stated rather than hidden)
- Word-form numbers ("nineteen million dollars") contain no digit tokens and pass unchecked.
- A number formatted as a standalone year ("received 2019 contracts" meaning a count of 2019) is exempted by the year rule.
- Non-numeric fabrications (invented entity names, mischaracterized relationships) are out of scope for numeric grounding; the rule/citation checks and human review board are the containment for those.
