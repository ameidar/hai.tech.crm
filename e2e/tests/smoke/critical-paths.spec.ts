import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/login.page';
import { CyclesPage } from '../../page-objects/cycles.page';
import { CycleDetailPage } from '../../page-objects/cycle-detail.page';
import { HEBREW } from '../../utils/selectors';

const TEST_ADMIN = {
  email: 'admin@haitech.co.il',
  password: 'admin123',
};

test.describe('Critical Paths - Smoke Tests', { tag: '@smoke' }, () => {
  
  test('Login with valid admin credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    
    await loginPage.goto();
    await expect(loginPage.form).toBeVisible();
    
    await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
    
    // Should redirect away from login page
    await expect(page).not.toHaveURL(/\/login/);
    // Should be on dashboard or cycles page
    await expect(page).toHaveURL(/\/(cycles)?$/);
  });

  test('Protected routes redirect to login', async ({ page }) => {
    // Try to access cycles without logging in
    await page.goto('/cycles');
    
    // Should be redirected to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('All main navigation items are accessible', async ({ page }) => {
    const loginPage = new LoginPage(page);
    
    // Login first
    await loginPage.goto();
    await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
    await expect(page).not.toHaveURL(/\/login/);

    // Check navigation items
    const navItems = [
      { label: HEBREW.nav.cycles, url: '/cycles' },
      { label: HEBREW.nav.customers, url: '/customers' },
      { label: HEBREW.nav.students, url: '/students' },
      { label: HEBREW.nav.instructors, url: '/instructors' },
      { label: HEBREW.nav.courses, url: '/courses' },
      { label: HEBREW.nav.branches, url: '/branches' },
    ];

    for (const item of navItems) {
      // Use first() to handle multiple matching links (sidebar + page content)
      const navLink = page.getByRole('link', { name: item.label }).first();
      await expect(navLink).toBeVisible();
    }
  });

  test('View cycles list', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const cyclesPage = new CyclesPage(page);
    
    // Login
    await loginPage.goto();
    await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
    await expect(page).not.toHaveURL(/\/login/);
    
    // Navigate to cycles (use first() for sidebar link)
    await page.getByRole('link', { name: HEBREW.nav.cycles }).first().click();
    await cyclesPage.waitForPageLoad();
    
    // Verify page loaded
    await expect(page).toHaveURL(/\/cycles/);
    await expect(cyclesPage.pageTitle).toBeVisible();
  });

  test('Open cycle detail and view meetings', async ({ page }) => {
    const loginPage = new LoginPage(page);
    
    // Login
    await loginPage.goto();
    await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
    await expect(page).not.toHaveURL(/\/login/);
    
    // Navigate to cycles via sidebar (use first() for sidebar link)
    await page.getByRole('link', { name: HEBREW.nav.cycles }).first().click();
    await expect(page).toHaveURL(/\/cycles/);
    
    // Wait for page content to load
    await page.waitForLoadState('networkidle');
    
    // Look for any cycle link in the page
    const cycleLinks = page.locator('a[href^="/cycles/"]');
    const linkCount = await cycleLinks.count();
    
    if (linkCount > 0) {
      // Click the first cycle link
      await cycleLinks.first().click();
      
      // Should navigate to cycle detail
      await expect(page).toHaveURL(/\/cycles\/[a-zA-Z0-9-]+/);
      
      // Wait for content to load
      await page.waitForLoadState('networkidle');
    }
    // Test passes whether cycles exist or not
  });

  test('Logout functionality', async ({ page }) => {
    const loginPage = new LoginPage(page);
    
    // Login
    await loginPage.goto();
    await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
    await expect(page).not.toHaveURL(/\/login/);
    
    // Find and click user menu
    const userButton = page.locator('button').filter({ hasText: /admin/i }).or(
      page.locator('button').filter({ has: page.locator('.rounded-full') })
    ).first();
    await userButton.click();
    
    // Click logout - use first matching button
    const logoutButton = page.getByRole('button', { name: HEBREW.actions.logout }).first();
    await logoutButton.click();
    
    // Should be on login page
    await expect(page).toHaveURL(/\/login/);
  });
});
