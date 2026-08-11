/** Review-case workflow rules, kept pure so they are trivially testable. */

export type ReviewStatus = 'new' | 'under_review' | 'substantiated' | 'dismissed';

export const ALLOWED_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  new: ['under_review', 'dismissed'],
  under_review: ['substantiated', 'dismissed', 'new'],
  // Decisions are re-openable (an appeal path), but only back to review —
  // never silently rewritten to the opposite verdict.
  substantiated: ['under_review'],
  dismissed: ['under_review'],
};

export function canTransition(from: ReviewStatus, to: ReviewStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** A decision requires a written justification; movement between queues doesn't. */
export function transitionRequiresNote(to: ReviewStatus): boolean {
  return to === 'substantiated' || to === 'dismissed';
}
