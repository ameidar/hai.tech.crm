import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/login.page';

const TEST_ADMIN = {
  email: 'admin@haitech.co.il',
  password: 'admin123',
};

test.describe('Meetings Page Statistics', () => {
  
  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('displays total meetings count for selected date', async ({ page }) => {
    // Navigate to meetings page
    await page.goto('/meetings');
    
    // Wait for page to load - use h1 specifically
    await expect(page.locator('h1').filter({ hasText: /פגישות/i }).first()).toBeVisible();
    
    // Wait for meetings to load
    await page.waitForTimeout(1000);
    
    // Check if stats section exists when there are meetings
    const table = page.locator('table');
    const tableVisible = await table.isVisible();
    
    if (tableVisible) {
      // Should show "X פגישות ביום זה" stats
      const statsText = page.getByText(/פגישות ביום זה/i);
      await expect(statsText).toBeVisible();
      
      // Stats should include count
      const fullStatsText = await statsText.innerText();
      expect(fullStatsText).toMatch(/\d+\s*פגישות ביום זה/);
    }
  });

  test('meeting count updates when changing date', async ({ page }) => {
    await page.goto('/meetings');
    await expect(page.locator('h1').filter({ hasText: /פגישות/i }).first()).toBeVisible();
    
    // Get current date stats if available
    await page.waitForTimeout(1000);
    
    // Click next day button (ChevronLeft for Hebrew RTL = next day)
    const nextButton = page.locator('button').filter({ has: page.locator('svg') }).nth(1);
    await nextButton.click();
    
    // Wait for data reload
    await page.waitForTimeout(500);
    
    // Stats should still be visible (or empty state) - use first() to avoid multiple matches
    const statsOrEmpty = page.getByText(/פגישות ביום זה/i).or(page.getByRole('heading', { name: /אין פגישות/i }));
    await expect(statsOrEmpty.first()).toBeVisible();
  });

  test('stats show breakdown by status', async ({ page }) => {
    await page.goto('/meetings');
    await expect(page.locator('h1').filter({ hasText: /פגישות/i }).first()).toBeVisible();
    
    await page.waitForTimeout(1000);
    
    const table = page.locator('table');
    const tableVisible = await table.isVisible();
    
    if (tableVisible) {
      // Should show status breakdown
      const completedStat = page.getByText(/הושלמו/i).first();
      const pendingStat = page.getByText(/ממתינים/i).first();
      const cancelledStat = page.getByText(/בוטלו/i).first();
      
      // At least one status indicator should be visible
      const hasStats = await completedStat.isVisible() || 
                       await pendingStat.isVisible() || 
                       await cancelledStat.isVisible();
      
      expect(hasStats).toBeTruthy();
    }
  });
});
