/**
 * Common selectors used across tests
 * Prefer data-testid, fallback to accessible roles
 */

export const SELECTORS = {
  // Navigation
  nav: {
    dashboard: '[data-testid="nav-dashboard"], a[href="/"]',
    customers: '[data-testid="nav-customers"], a[href="/customers"]',
    students: '[data-testid="nav-students"], a[href="/students"]',
    courses: '[data-testid="nav-courses"], a[href="/courses"]',
    branches: '[data-testid="nav-branches"], a[href="/branches"]',
    instructors: '[data-testid="nav-instructors"], a[href="/instructors"]',
    cycles: '[data-testid="nav-cycles"], a[href="/cycles"]',
    meetings: '[data-testid="nav-meetings"], a[href="/meetings"]',
    reports: '[data-testid="nav-reports"], a[href="/reports"]',
  },

  // Common UI
  ui: {
    loading: '[data-testid="loading"], .animate-pulse, .animate-spin',
    modal: '[data-testid="modal"], [role="dialog"]',
    table: '[data-testid="table"], table',
    emptyState: '[data-testid="empty-state"]',
    errorMessage: '[data-testid="error"], .bg-red-50',
    successMessage: '[data-testid="success"], .bg-green-50',
  },

  // Buttons (Hebrew labels)
  buttons: {
    save: 'button:has-text("שמור")',
    cancel: 'button:has-text("ביטול")',
    delete: 'button:has-text("מחק")',
    add: 'button:has-text("הוסף")',
    edit: 'button:has-text("עריכה")',
    close: 'button:has-text("סגור")',
    submit: 'button[type="submit"]',
  },
};

/**
 * Hebrew translations for common labels
 */
export const HEBREW = {
  // Navigation labels
  nav: {
    dashboard: 'דשבורד',
    customers: 'לקוחות',
    students: 'תלמידים',
    courses: 'קורסים',
    branches: 'סניפים',
    instructors: 'מדריכים',
    cycles: 'מחזורים',
    meetings: 'פגישות',
    reports: 'דוחות',
    auditLog: 'יומן פעילות',
  },

  // Statuses
  cycleStatus: {
    active: 'פעיל',
    completed: 'הושלם',
    cancelled: 'בוטל',
  },

  meetingStatus: {
    scheduled: 'מתוכנן',
    completed: 'הושלם',
    cancelled: 'בוטל',
    postponed: 'נדחה',
  },

  // Common actions
  actions: {
    login: 'התחברות',
    logout: 'התנתק',
    save: 'שמור',
    cancel: 'ביטול',
    delete: 'מחק',
    edit: 'עריכה',
    add: 'הוסף',
    back: 'חזרה',
    search: 'חיפוש',
  },
};
