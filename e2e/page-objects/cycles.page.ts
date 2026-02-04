import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class CyclesPage extends BasePage {
  // Locators
  readonly pageTitle: Locator;
  readonly cyclesTable: Locator;
  readonly addCycleButton: Locator;
  readonly searchInput: Locator;
  readonly statusFilter: Locator;
  readonly instructorFilter: Locator;
  readonly branchFilter: Locator;
  readonly courseFilter: Locator;
  readonly loadingIndicator: Locator;

  constructor(page: Page) {
    super(page);
    // Page elements
    this.pageTitle = page.getByRole('heading', { name: /מחזורים/i }).first();
    this.cyclesTable = page.getByTestId('cycles-table').or(page.locator('table'));
    this.addCycleButton = page.getByTestId('add-cycle-btn').or(page.getByRole('button', { name: /מחזור חדש/i }));
    this.searchInput = page.getByTestId('search-input').or(page.getByPlaceholder(/חיפוש/i));
    this.statusFilter = page.getByTestId('status-filter').or(page.locator('select').filter({ hasText: /סטטוס/i }).first());
    this.instructorFilter = page.locator('select').filter({ hasText: /מדריכים/i }).first();
    this.branchFilter = page.locator('select').filter({ hasText: /סניפים/i }).first();
    this.courseFilter = page.locator('select').filter({ hasText: /קורסים/i }).first();
    this.loadingIndicator = page.getByTestId('loading').or(page.locator('.animate-pulse'));
  }

  /**
   * Navigate to cycles page
   */
  async goto() {
    await super.goto('/cycles');
    await this.waitForPageLoad();
  }

  /**
   * Wait for the page to fully load
   */
  async waitForPageLoad() {
    // Wait for either table or empty state to appear
    await Promise.race([
      expect(this.cyclesTable).toBeVisible().catch(() => {}),
      expect(this.page.getByText(/אין מחזורים/i)).toBeVisible().catch(() => {}),
      this.page.waitForTimeout(5000),
    ]);
  }

  /**
   * Get all cycle rows from the table
   */
  async getCycleRows(): Promise<Locator[]> {
    const rows = this.cyclesTable.locator('tbody tr');
    return await rows.all();
  }

  /**
   * Get cycle count
   */
  async getCycleCount(): Promise<number> {
    const rows = await this.getCycleRows();
    return rows.length;
  }

  /**
   * Click on a specific cycle by name
   */
  async openCycleByName(name: string) {
    const cycleLink = this.page.getByRole('link', { name }).first();
    await cycleLink.click();
  }

  /**
   * Click on the first cycle in the list
   */
  async openFirstCycle() {
    const firstRow = this.cyclesTable.locator('tbody tr').first();
    const cycleLink = firstRow.locator('a').first();
    await cycleLink.click();
  }

  /**
   * Search for cycles by text
   */
  async searchCycles(text: string) {
    await this.searchInput.fill(text);
    // Wait for debounced search
    await this.page.waitForTimeout(400);
  }

  /**
   * Filter by status
   */
  async filterByStatus(status: 'active' | 'completed' | 'cancelled') {
    const statusMap = {
      active: 'פעיל',
      completed: 'הושלם',
      cancelled: 'בוטל',
    };
    await this.page.locator('select').filter({ hasText: /סטטוסים/i }).first().selectOption({ label: statusMap[status] });
  }

  /**
   * Check if we're on the cycles page
   */
  async isOnCyclesPage(): Promise<boolean> {
    const path = await this.getCurrentPath();
    return path === '/cycles';
  }
}
