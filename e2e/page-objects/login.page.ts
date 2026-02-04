import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class LoginPage extends BasePage {
  // Locators
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;
  readonly form: Locator;

  constructor(page: Page) {
    super(page);
    // Use data-testid when available, fallback to role/type selectors
    this.emailInput = page.getByTestId('email-input').or(page.locator('input[type="email"]'));
    this.passwordInput = page.getByTestId('password-input').or(page.locator('input[type="password"]'));
    this.loginButton = page.getByTestId('login-button').or(page.getByRole('button', { name: /התחברות/i }));
    this.errorMessage = page.getByTestId('login-error').or(page.locator('.bg-red-50'));
    this.form = page.getByTestId('login-form').or(page.locator('form'));
  }

  /**
   * Navigate to login page
   */
  async goto() {
    await super.goto('/login');
    await expect(this.form).toBeVisible();
  }

  /**
   * Perform login with credentials
   */
  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  /**
   * Check if login error is displayed
   */
  async hasError(): Promise<boolean> {
    return await this.errorMessage.isVisible();
  }

  /**
   * Get error message text
   */
  async getErrorText(): Promise<string> {
    return await this.errorMessage.innerText();
  }

  /**
   * Check if we're on the login page
   */
  async isOnLoginPage(): Promise<boolean> {
    const path = await this.getCurrentPath();
    return path === '/login';
  }
}
