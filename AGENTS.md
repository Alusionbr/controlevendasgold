# Codex agent policy

## Goal
Preserve business-rule correctness and final quality while reducing unnecessary context, repeated reads, and GPT-6 Astra consumption.

## Repository-specific context discipline
- `CLAUDE.md` contains important business rules. Read only the section relevant to the task; do not reload the ~large file in full on every turn.
- Start with targeted search in `src/`, `styles/`, `supabase/`, `tests/`, or the specific file named by the task.
- Avoid loading `controle360-mobile.html` in full unless the task specifically concerns that generated/standalone artifact; prefer source modules first.
- Do not scan all docs/history by default. Pull only the business-rule/model-data section needed.
- Reuse concise summaries for unchanged files instead of reopening them.

## Model routing
When selectable subagents/models are available:
- **GPT-6 Astra**: architecture, inventory/accounting invariants, auth/security/Supabase design, schema/data migrations, cross-module bugs after cheaper attempts fail, and final review of high-risk changes.
- **GPT-5.6 Sol**: default implementation, non-trivial refactors, normal debugging, test fixes, and review.
- **GPT-5.6 Terra**: well-scoped implementation with clear requirements.
- **GPT-5.6 Luna**: repository reconnaissance, code search, repetitive edits, formatting, small isolated fixes, and narrow checks.
- Do not use Astra for file discovery, formatting, simple CRUD wiring, or mechanical changes.
- If model-selectable subagents are unavailable, follow the same staged workflow without claiming a delegation occurred.

## Execution workflow
1. Identify the exact business flow and its invariants before editing.
2. Locate the smallest set of source files with targeted search.
3. Read the relevant `CLAUDE.md` section only if the rule is not already clear from the task/current context.
4. Make a concise plan for cross-module changes.
5. Implement with the least expensive reliable model.
6. Run targeted tests/checks around the changed flow.
7. Escalate to Astra only for unresolved complexity or a high-risk review.
8. Inspect the final diff for unrelated changes and generated-file churn.

## Non-negotiable quality gate
- Never change physical stock without the corresponding `stockMovements` logic required by the project rules.
- Preserve cost/CMV and consignment invariants; shipment is not automatically a sale.
- Do not weaken auth, role checks, validation, data integrity, or error handling to save tokens.
- Database/schema/auth/security changes require stronger review, explicit migration reasoning, and rollback awareness.
- Prefer small, reviewable source-file changes over editing giant bundled outputs.
- Stop rereading/retesting once the relevant checks pass and no unresolved risk remains.
