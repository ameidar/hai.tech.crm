import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class CycleDetailPage extends BasePage {
  // Locators
  readonly cycleName: Locator;
  readonly backButton: Locator;
  readonly courseInfo: Locator;
  readonly branchInfo: Locator;
  readonly instructorInfo: Locator;
  readonly meetingsTable: Locator;
  readonly zoomSection: Locator;
  readonly createZoomButton: Locator;
  readonly registrationsList: Locator;
  readonly addStudentButton: Locator;
  readonly progressSection: Locator;
  readonly expensesSection: Locator;
  readonly addExpenseButton: Locator;

  constructor(page: Page) {
    super(page);
    // Use a combination of data-testid and semantic selectors
    this.cycleName = page.getByTestId('cycle-name').or(page.locator('h1').first());
    this.backButton = page.getByRole('link', { name: /חזרה/i });
    this.courseInfo = page.getByTestId('cycle-course').or(page.getByText(/קורס/i).locator('..'));
    this.branchInfo = page.getByTestId('cycle-branch').or(page.getByText(/סניף/i).locator('..'));
    this.instructorInfo = page.getByTestId('cycle-instructor').or(page.getByText(/מדריך/i).locator('..'));
    this.meetingsTable = page.getByTestId('meetings-table').or(page.locator('table'));
    this.zoomSection = page.getByTestId('zoom-section').or(page.locator('.card').filter({ hasText: 'Zoom' }));
    this.createZoomButton = page.getByTestId('create-zoom-btn').or(page.getByRole('button', { name: /צור פגישת Zoom/i }));
    this.registrationsList = page.getByTestId('registrations-list').or(page.locator('.card').filter({ hasText: /תלמידים/i }));
    this.addStudentButton = page.getByTestId('add-student-btn').or(page.getByRole('button', { name: /הוסף תלמיד/i }));
    this.progressSection = page.getByTestId('progress-section').or(page.locator('.card').filter({ hasText: /התקדמות/i }));
    this.expensesSection = page.getByTestId('cycle-expenses').or(page.locator('.card').filter({ hasText: /הוצאות מחזור/i }));
    this.addExpenseButton = page.getByRole('button', { name: /הוסף הוצאה/i });
  }

  /**
   * Navigate to a specific cycle
   */
  async goto(cycleId: string) {
    await super.goto(`/cycles/${cycleId}`);
    await this.waitForPageLoad();
  }

  /**
   * Wait for the page to fully load
   */
  async waitForPageLoad() {
    await expect(this.cycleName).toBeVisible();
  }

  /**
   * Go back to cycles list
   */
  async goBack() {
    await this.backButton.click();
  }

  /**
   * Get the cycle name text
   */
  async getCycleName(): Promise<string> {
    return await this.cycleName.innerText();
  }

  /**
   * Check if Zoom section is visible (for online cycles)
   */
  async hasZoomSection(): Promise<boolean> {
    return await this.zoomSection.isVisible();
  }

  /**
   * Check if Zoom meeting exists
   */
  async hasZoomMeeting(): Promise<boolean> {
    const meetingId = this.page.locator('text=Meeting ID');
    return await meetingId.isVisible();
  }

  /**
   * Create Zoom meeting
   */
  async createZoomMeeting() {
    await this.createZoomButton.click();
    // Wait for API response
    await this.page.waitForResponse(resp => resp.url().includes('/api/zoom') && resp.status() === 200);
  }

  /**
   * Get meeting count
   */
  async getMeetingCount(): Promise<number> {
    const rows = this.meetingsTable.locator('tbody tr');
    return await rows.count();
  }

  /**
   * Click on a meeting row
   */
  async openMeeting(index: number) {
    const row = this.meetingsTable.locator('tbody tr').nth(index);
    await row.click();
  }

  /**
   * Get student/registration count from the section header
   */
  async getStudentCount(): Promise<number> {
    const text = await this.registrationsList.locator('h2').innerText();
    const match = text.match(/\((\d+)\)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Check if we're on a cycle detail page
   */
  async isOnCycleDetailPage(): Promise<boolean> {
    const path = await this.getCurrentPath();
    return /^\/cycles\/[a-zA-Z0-9-]+$/.test(path);
  }

  /**
   * Check if expenses section is visible
   */
  async hasExpensesSection(): Promise<boolean> {
    return await this.expensesSection.isVisible();
  }

  /**
   * Add a cycle expense
   */
  async addExpense(type: string, amount: string, description?: string) {
    await this.addExpenseButton.click();
    
    // Wait for form to appear
    await this.page.locator('select').last().waitFor();
    
    // Select type
    await this.page.locator('select').last().selectOption(type);
    
    // Enter description if provided
    if (description) {
      await this.page.locator('input[placeholder*="תיאור"]').fill(description);
    }
    
    // Enter amount
    await this.page.locator('input[placeholder*="סכום"]').fill(amount);
    
    // Click add button
    await this.page.getByRole('button', { name: /הוסף$/i }).click();
    
    // Wait for the form to close
    await this.page.waitForTimeout(500);
  }

  /**
   * Get expense count
   */
  async getExpenseCount(): Promise<number> {
    const expenses = this.expensesSection.locator('.border.rounded-lg');
    return await expenses.count();
  }

  /**
   * Get total expenses amount from the summary
   */
  async getTotalExpenses(): Promise<string> {
    const summary = this.expensesSection.locator('.bg-gray-50').first();
    const text = await summary.innerText();
    const match = text.match(/₪([\d,]+)/);
    return match ? match[1] : '0';
  }

  /**
   * Delete first expense
   */
  async deleteFirstExpense() {
    const deleteButton = this.expensesSection.locator('button[title="מחק"], .text-red-600').first();
    await deleteButton.click();
    
    // Confirm deletion
    this.page.on('dialog', dialog => dialog.accept());
    await this.page.waitForTimeout(500);
  }
}
