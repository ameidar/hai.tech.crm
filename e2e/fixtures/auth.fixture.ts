import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../page-objects/login.page';

// Test user credentials
export const TEST_ADMIN = {
  email: 'admin@haitech.co.il',
  password: 'admin123', // Will need to verify this
};

export const TEST_INSTRUCTOR = {
  email: 'instructor@haitech.co.il',
  password: 'instructor123',
};

// Extend base test with authenticated fixtures
export const test = base.extend<{
  loginPage: LoginPage;
  authenticatedPage: void;
}>({
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
  },

  authenticatedPage: [
    async ({ page }, use) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
      
      // Wait for redirect to dashboard
      await expect(page).toHaveURL(/\/(cycles|$)/);
      await use();
    },
    { auto: false },
  ],
});

export { expect } from '@playwright/test';
