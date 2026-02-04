import { Page, Locator, expect } from '@playwright/test';

export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to a specific path
   */
  async goto(path: string = '/') {
    await this.page.goto(path);
  }

  /**
   * Wait for page to be fully loaded
   */
  async waitForLoad() {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Get element by data-testid
   */
  getByTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  /**
   * Check if an element is visible
   */
  async isVisible(locator: Locator): Promise<boolean> {
    return await locator.isVisible();
  }

  /**
   * Wait for an element to be visible
   */
  async waitForVisible(locator: Locator) {
    await expect(locator).toBeVisible();
  }

  /**
   * Click a navigation item by label (Hebrew)
   */
  async clickNavItem(label: string) {
    const navItem = this.page.getByRole('link', { name: label });
    await navItem.click();
  }

  /**
   * Get the current URL path
   */
  async getCurrentPath(): Promise<string> {
    const url = this.page.url();
    return new URL(url).pathname;
  }

  /**
   * Take a screenshot with a descriptive name
   */
  async screenshot(name: string) {
    await this.page.screenshot({ path: `test-results/screenshots/${name}.png` });
  }
}
