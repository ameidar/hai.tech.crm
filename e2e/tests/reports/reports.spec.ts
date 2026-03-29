import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/login.page';

const TEST_ADMIN = {
  email: 'admin@haitech.co.il',
  password: 'admin123',
};

test.describe('Reports Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should navigate to reports page', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.locator('h1, h2').filter({ hasText: /דוחות/ })).toBeVisible();
  });

  test('should have cycles limit selector', async ({ page }) => {
    await page.goto('/reports');
    
    // Wait for page to load
    await expect(page.locator('h1, h2').filter({ hasText: /דוחות/ })).toBeVisible();
    
    // Look for the cycles limit dropdown - find the one with label "מחזורים:"
    const cyclesLabel = page.getByText('מחזורים:');
    await expect(cyclesLabel).toBeVisible();
  });

  test('should have three tabs: overview, billing, cycles', async ({ page }) => {
    await page.goto('/reports');
    
    // Wait for page to load
    await expect(page.locator('h1, h2').filter({ hasText: /דוחות/ })).toBeVisible();
    
    // Check for tabs
    await expect(page.getByRole('button', { name: /סיכום כללי/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /גבייה לפי סניף/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /מחזורים/ })).toBeVisible();
  });

  test('should switch to cycles tab and show cycles heading', async ({ page }) => {
    await page.goto('/reports');
    
    // Wait for page to load
    await expect(page.locator('h1, h2').filter({ hasText: /דוחות/ })).toBeVisible();
    
    // Click cycles tab
    await page.getByRole('button', { name: /מחזורים/ }).click();
    
    // Should show cycles section header
    await expect(page.getByText('מחזורים פעילים')).toBeVisible();
  });

  test('should have cycle count in the tab', async ({ page }) => {
    await page.goto('/reports');
    
    // Wait for page to load
    await expect(page.locator('h1, h2').filter({ hasText: /דוחות/ })).toBeVisible();
    
    // The cycles tab should show a count in parentheses
    const cyclesTab = page.getByRole('button', { name: /מחזורים \(\d+\)/ });
    await expect(cyclesTab).toBeVisible();
  });
});
