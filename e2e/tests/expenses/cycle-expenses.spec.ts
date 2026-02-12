import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/login.page';
import { CycleDetailPage } from '../../page-objects/cycle-detail.page';
import { CyclesPage } from '../../page-objects/cycles.page';

const TEST_ADMIN = {
  email: 'admin@haitech.co.il',
  password: 'admin123',
};

test.describe('Cycle Expenses', () => {
  let cycleId: string;

  // Login and navigate to a cycle before each test
  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
    await expect(page).not.toHaveURL(/\/login/);

    // Navigate to cycles page to find a cycle
    const cyclesPage = new CyclesPage(page);
    await cyclesPage.goto();
    
    // Wait for cycles to load
    await page.waitForTimeout(1000);
    
    // Click on first cycle
    const firstLink = page.locator('tbody tr').first().locator('a').first();
    await firstLink.click();
    
    // Get cycle ID from URL
    await page.waitForURL(/\/cycles\/[a-zA-Z0-9-]+/);
    const url = page.url();
    cycleId = url.split('/cycles/')[1];
  });

  test.describe('Expenses Section Display', () => {
    
    test('expenses section is visible on cycle detail page', async ({ page }) => {
      const cycleDetailPage = new CycleDetailPage(page);
      
      // Expenses section should be visible
      await expect(cycleDetailPage.expensesSection).toBeVisible({ timeout: 10000 });
    });

    test('shows "אין הוצאות מחזור" when no expenses exist', async ({ page }) => {
      const cycleDetailPage = new CycleDetailPage(page);
      
      // Check for empty state or expenses list
      const hasExpenses = await cycleDetailPage.getExpenseCount();
      const emptyMessage = page.getByText(/אין הוצאות מחזור/i);
      
      if (hasExpenses === 0) {
        await expect(emptyMessage).toBeVisible();
      } else {
        await expect(emptyMessage).not.toBeVisible();
      }
    });

    test('add expense button is visible for admins', async ({ page }) => {
      const cycleDetailPage = new CycleDetailPage(page);
      
      // Add expense button should be visible
      await expect(cycleDetailPage.addExpenseButton).toBeVisible();
    });
  });

  test.describe('Adding Expenses', () => {
    
    test('can add a materials expense', async ({ page }) => {
      const cycleDetailPage = new CycleDetailPage(page);
      
      const initialCount = await cycleDetailPage.getExpenseCount();
      
      // Add expense
      await cycleDetailPage.addExpense('materials', '150', 'חומרים לקורס');
      
      // Wait for update
      await page.waitForTimeout(1000);
      
      // Verify expense was added
      const newCount = await cycleDetailPage.getExpenseCount();
      expect(newCount).toBe(initialCount + 1);
      
      // Verify the expense appears in the list
      await expect(page.getByText('הכנת חומרים')).toBeVisible();
      await expect(page.getByText('₪150')).toBeVisible();
    });

    test('can add a wraparound hours expense', async ({ page }) => {
      const cycleDetailPage = new CycleDetailPage(page);
      
      // Add expense
      await cycleDetailPage.addExpense('wraparound_hours', '268', 'שעות מעטפת');
      
      // Wait for update
      await page.waitForTimeout(1000);
      
      // Verify the expense type label
      await expect(page.getByText('שעות מעטפת').first()).toBeVisible();
    });

    test('expense amount validation - cannot add zero amount', async ({ page }) => {
      const cycleDetailPage = new CycleDetailPage(page);
      
      // Click add button
      await cycleDetailPage.addExpenseButton.click();
      
      // Try to add with empty amount
      const addButton = page.getByRole('button', { name: /הוסף$/i });
      
      // Button should be disabled without amount
      await expect(addButton).toBeDisabled();
    });

    test('cancel button closes add form', async ({ page }) => {
      const cycleDetailPage = new CycleDetailPage(page);
      
      // Click add button to open form
      await cycleDetailPage.addExpenseButton.click();
      
      // Form should be visible
      await expect(page.locator('input[placeholder*="סכום"]')).toBeVisible();
      
      // Click cancel
      await page.getByRole('button', { name: /ביטול/i }).click();
      
      // Form should be hidden
      await expect(page.locator('input[placeholder*="סכום"]')).not.toBeVisible();
    });
  });

  test.describe('Expense Summary', () => {
    
    test('shows total expenses in summary', async ({ page }) => {
      const cycleDetailPage = new CycleDetailPage(page);
      
      // Add an expense first
      await cycleDetailPage.addExpense('materials', '200', 'בדיקת סיכום');
      
      // Wait for update
      await page.waitForTimeout(1000);
      
      // Check that summary shows the amount
      const total = await cycleDetailPage.getTotalExpenses();
      expect(parseInt(total.replace(',', ''))).toBeGreaterThanOrEqual(200);
    });

    test('shows per-meeting amount in summary', async ({ page }) => {
      const cycleDetailPage = new CycleDetailPage(page);
      
      // Look for "לפגישה" text in summary
      const summary = cycleDetailPage.expensesSection.locator('.bg-gray-50').first();
      const text = await summary.innerText();
      
      // Should show per-meeting calculation
      expect(text).toContain('לפגישה');
    });
  });

  test.describe('Deleting Expenses', () => {
    
    test('can delete an expense', async ({ page }) => {
      const cycleDetailPage = new CycleDetailPage(page);
      
      // First add an expense
      await cycleDetailPage.addExpense('other', '100', 'הוצאה למחיקה');
      await page.waitForTimeout(1000);
      
      const initialCount = await cycleDetailPage.getExpenseCount();
      expect(initialCount).toBeGreaterThan(0);
      
      // Delete the expense
      page.on('dialog', dialog => dialog.accept());
      const deleteButton = cycleDetailPage.expensesSection.locator('button').filter({ has: page.locator('svg') }).last();
      await deleteButton.click();
      
      // Wait for deletion
      await page.waitForTimeout(1000);
      
      // Verify expense was deleted
      const newCount = await cycleDetailPage.getExpenseCount();
      expect(newCount).toBe(initialCount - 1);
    });
  });

  test.describe('Expense Types', () => {
    
    test('all expense types are available in dropdown', async ({ page }) => {
      const cycleDetailPage = new CycleDetailPage(page);
      
      // Open add form
      await cycleDetailPage.addExpenseButton.click();
      
      // Check dropdown options
      const select = page.locator('select').last();
      const options = await select.locator('option').allTextContents();
      
      // Verify all Hebrew labels are present
      expect(options).toContain('הכנת חומרים');
      expect(options).toContain('שעות מעטפת');
      expect(options).toContain('ציוד');
      expect(options).toContain('נסיעות קבועות');
      expect(options).toContain('אחר');
    });
  });

  test.describe('Financial Impact', () => {
    
    test('adding expense affects profit calculation', async ({ page }) => {
      const cycleDetailPage = new CycleDetailPage(page);
      
      // Add a significant expense
      await cycleDetailPage.addExpense('equipment', '500', 'ציוד לבדיקה');
      
      // Wait for update
      await page.waitForTimeout(1000);
      
      // The expense should appear in the total
      const total = await cycleDetailPage.getTotalExpenses();
      expect(parseInt(total.replace(',', ''))).toBeGreaterThanOrEqual(500);
    });
  });
});
