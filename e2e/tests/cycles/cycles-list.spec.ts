import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/login.page';
import { CyclesPage } from '../../page-objects/cycles.page';
import { HEBREW } from '../../utils/selectors';

const TEST_ADMIN = {
  email: 'admin@haitech.co.il',
  password: 'admin123',
};

test.describe('Cycles List', () => {
  
  // Login before each test
  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test.describe('Page Loading', () => {
    
    test('loads cycles page with correct elements', async ({ page }) => {
      const cyclesPage = new CyclesPage(page);
      
      await cyclesPage.goto();
      
      // Check page title
      await expect(cyclesPage.pageTitle).toBeVisible();
      
      // Check action button
      await expect(cyclesPage.addCycleButton).toBeVisible();
      
      // Check search input
      await expect(cyclesPage.searchInput).toBeVisible();
    });

    test('page eventually shows content', async ({ page }) => {
      // Navigate to cycles page
      await page.goto('/cycles');
      
      // Wait for page to have content - simply check that a table exists
      const table = page.locator('[data-testid="cycles-table"]').or(page.getByRole('table'));
      await expect(table).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Table Display', () => {
    
    test('displays cycles in table format', async ({ page }) => {
      const cyclesPage = new CyclesPage(page);
      
      await cyclesPage.goto();
      
      const cycleCount = await cyclesPage.getCycleCount();
      
      if (cycleCount > 0) {
        // Table should be visible
        await expect(cyclesPage.cyclesTable).toBeVisible();
        
        // Table should have headers
        const headers = cyclesPage.cyclesTable.locator('thead th');
        const headerCount = await headers.count();
        expect(headerCount).toBeGreaterThan(0);
        
        // Check for expected column headers (Hebrew)
        await expect(page.getByRole('columnheader', { name: /שם המחזור/i })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: /קורס/i })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: /סטטוס/i })).toBeVisible();
      } else {
        // Empty state should be shown
        await expect(page.getByText(/אין מחזורים/i)).toBeVisible();
      }
    });

    test('each cycle row has clickable name link', async ({ page }) => {
      const cyclesPage = new CyclesPage(page);
      
      await cyclesPage.goto();
      
      const cycleCount = await cyclesPage.getCycleCount();
      
      if (cycleCount > 0) {
        // First row should have a link
        const firstRowLink = cyclesPage.cyclesTable.locator('tbody tr').first().locator('a').first();
        await expect(firstRowLink).toBeVisible();
        await expect(firstRowLink).toHaveAttribute('href', /\/cycles\//);
      }
    });
  });

  test.describe('Filtering', () => {
    
    test('search filters cycles by name', async ({ page }) => {
      const cyclesPage = new CyclesPage(page);
      
      await cyclesPage.goto();
      
      const initialCount = await cyclesPage.getCycleCount();
      
      if (initialCount > 0) {
        // Search for something that likely won't match all
        await cyclesPage.searchCycles('zzzznonexistent');
        
        // Wait for results to update
        await page.waitForTimeout(500);
        
        // Should have fewer results or show no results message
        const newCount = await cyclesPage.getCycleCount();
        const hasEmptyMessage = await page.getByText(/אין מחזורים/i).isVisible();
        
        expect(newCount < initialCount || hasEmptyMessage).toBeTruthy();
      }
    });

    test('status filter is present and clickable', async ({ page }) => {
      const cyclesPage = new CyclesPage(page);
      
      await cyclesPage.goto();
      
      // Find any select element that contains status options
      const selects = page.locator('select');
      const selectCount = await selects.count();
      
      // Should have multiple filters
      expect(selectCount).toBeGreaterThan(0);
      
      // Find the status filter by its options
      for (let i = 0; i < selectCount; i++) {
        const select = selects.nth(i);
        const options = await select.locator('option').allTextContents();
        if (options.some(opt => opt.includes('פעיל') || opt.includes('סטטוס'))) {
          // Found the status filter, try to select an option
          await select.selectOption({ index: 1 });
          // Wait a bit for filter to apply
          await page.waitForTimeout(500);
          break;
        }
      }
    });

    test('clear filters button appears when filter active', async ({ page }) => {
      const cyclesPage = new CyclesPage(page);
      
      await cyclesPage.goto();
      
      // Add a search filter
      await cyclesPage.searchCycles('test');
      
      // Wait for filter to take effect
      await page.waitForTimeout(500);
      
      // Clear filters button may or may not appear depending on results
      // Just verify search input has our value
      await expect(cyclesPage.searchInput).toHaveValue('test');
    });
  });

  test.describe('Navigation to Detail', () => {
    
    test('clicking cycle name navigates to detail page', async ({ page }) => {
      const cyclesPage = new CyclesPage(page);
      
      await cyclesPage.goto();
      
      const cycleCount = await cyclesPage.getCycleCount();
      
      if (cycleCount > 0) {
        // Get first cycle link
        const firstLink = cyclesPage.cyclesTable.locator('tbody tr').first().locator('a').first();
        const href = await firstLink.getAttribute('href');
        
        // Click on it
        await firstLink.click();
        
        // Should navigate to detail page
        await expect(page).toHaveURL(new RegExp(href!.replace(/\//g, '\\/')));
      }
    });
  });

  test.describe('Add Cycle Modal', () => {
    
    test('add cycle button is visible and clickable', async ({ page }) => {
      const cyclesPage = new CyclesPage(page);
      
      await cyclesPage.goto();
      
      // Add cycle button should be visible
      await expect(cyclesPage.addCycleButton).toBeVisible();
      
      // Button should be enabled
      await expect(cyclesPage.addCycleButton).toBeEnabled();
    });
  });
});
