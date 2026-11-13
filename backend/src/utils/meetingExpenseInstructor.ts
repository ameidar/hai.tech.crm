/**
 * Instructor attribution for meeting expenses (meeting_expenses).
 *
 * `MeetingExpense.instructorId` is optional in the schema: historically it was only set for
 * `extra_instructor` rows (the additional instructor being paid), and travel / taxi / materials
 * rows were stored with `instructor_id = NULL`. Anything that attributes a meeting expense to an
 * instructor must therefore fall back to the meeting's instructor — otherwise those rows silently
 * disappear from per-instructor totals (2026-11-13: approved travel showed as ₪0).
 */

/** Treats null / undefined / empty string as "not provided". */
const present = (id: string | null | undefined): id is string =>
  typeof id === 'string' && id.trim() !== '';

/**
 * The instructor a meeting expense belongs to: the expense's own instructor when set,
 * otherwise the meeting's instructor.
 */
export function effectiveExpenseInstructorId(
  expense: { instructorId?: string | null },
  meeting: { instructorId?: string | null } | null | undefined,
): string | null {
  if (present(expense.instructorId)) return expense.instructorId;
  return present(meeting?.instructorId) ? meeting!.instructorId! : null;
}

/**
 * Write-time default: the instructorId to store on a new meeting expense.
 * Uses the explicitly provided instructor, otherwise the meeting's instructor, so new rows
 * are never stored with a NULL instructor when the meeting has one.
 */
export function defaultExpenseInstructorId(
  providedInstructorId: string | null | undefined,
  meetingInstructorId: string | null | undefined,
): string | null {
  if (present(providedInstructorId)) return providedInstructorId;
  return present(meetingInstructorId) ? meetingInstructorId : null;
}
