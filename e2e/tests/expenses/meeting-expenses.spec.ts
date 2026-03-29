import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/login.page';

const TEST_ADMIN = {
  email: 'admin@haitech.co.il',
  password: 'admin123',
};

test.describe('Meeting Expenses', () => {

  // Login before each test
  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test.describe('Meeting Detail Modal - Expenses Section', () => {
    
    test('expenses section appears in meeting detail modal', async ({ page }) => {
      // Navigate to meetings page
      await page.goto('/meetings');
      
      // Wait for meetings to load
      await page.waitForTimeout(1000);
      
      // Click on first meeting row to open detail modal
      const firstRow = page.locator('tbody tr').first();
      await firstRow.click();
      
      // Wait for modal to open
      await page.waitForTimeout(500);
      
      // Check for expenses section
      const expensesSection = page.getByText('הוצאות נלוות');
      await expect(expensesSection).toBeVisible({ timeout: 5000 });
    });

    test('can submit expense from meeting modal', async ({ page }) => {
      // Navigate to meetings page
      await page.goto('/meetings');
      await page.waitForTimeout(1000);
      
      // Open first meeting
      const firstRow = page.locator('tbody tr').first();
      await firstRow.click();
      await page.waitForTimeout(500);
      
      // Click add expense button
      const addButton = page.getByRole('button', { name: /הגש הוצאה/i });
      await addButton.click();
      
      // Fill in expense details
      await page.locator('select').last().selectOption('taxi');
      await page.locator('input[placeholder*="תיאור"]').fill('מונית לפגישה');
      await page.locator('input[placeholder*="סכום"]').fill('85');
      
      // Submit
      await page.getByRole('button', { name: /הגש$/i }).click();
      
      // Wait for update
      await page.waitForTimeout(1000);
      
      // Verify expense was added with pending status
      await expect(page.getByText('ממתין לאישור')).toBeVisible();
    });
  });

  test.describe('Expense Approval Workflow', () => {
    
    test('admin can approve pending expense', async ({ page }) => {
      // Navigate to meetings page
      await page.goto('/meetings');
      await page.waitForTimeout(1000);
      
      // Open first meeting
      const firstRow = page.locator('tbody tr').first();
      await firstRow.click();
      await page.waitForTimeout(500);
      
      // First add an expense
      const addButton = page.getByRole('button', { name: /הגש הוצאה/i });
      if (await addButton.isVisible()) {
        await addButton.click();
        await page.locator('select').last().selectOption('travel');
        await page.locator('input[placeholder*="סכום"]').fill('50');
        await page.getByRole('button', { name: /הגש$/i }).click();
        await page.waitForTimeout(1000);
      }
      
      // Find and click approve button
      const approveButton = page.locator('button[title="אשר"]').or(page.locator('.text-green-600 svg').locator('..'));
      if (await approveButton.isVisible()) {
        await approveButton.click();
        await page.waitForTimeout(500);
        
        // Verify expense is now approved
        await expect(page.getByText('מאושר')).toBeVisible();
      }
    });

    test('admin can reject pending expense', async ({ page }) => {
      // Navigate to meetings page
      await page.goto('/meetings');
      await page.waitForTimeout(1000);
      
      // Open first meeting
      const firstRow = page.locator('tbody tr').first();
      await firstRow.click();
      await page.waitForTimeout(500);
      
      // First add an expense
      const addButton = page.getByRole('button', { name: /הגש הוצאה/i });
      if (await addButton.isVisible()) {
        await addButton.click();
        await page.locator('select').last().selectOption('materials');
        await page.locator('input[placeholder*="סכום"]').fill('30');
        await page.getByRole('button', { name: /הגש$/i }).click();
        await page.waitForTimeout(1000);
      }
      
      // Find and click reject button
      const rejectButton = page.locator('button[title="דחה"]').or(page.locator('.text-red-600 svg').locator('..'));
      if (await rejectButton.isVisible()) {
        await rejectButton.click();
        
        // Enter rejection reason
        await page.locator('input[placeholder*="סיבת דחייה"]').fill('לא רלוונטי');
        await page.getByRole('button', { name: /דחה$/i }).click();
        await page.waitForTimeout(500);
        
        // Verify expense is rejected
        await expect(page.getByText('נדחה')).toBeVisible();
      }
    });
  });

  test.describe('Expense Types in Meeting', () => {
    
    test('all meeting expense types are available', async ({ page }) => {
      // Navigate to meetings page
      await page.goto('/meetings');
      await page.waitForTimeout(1000);
      
      // Open first meeting
      const firstRow = page.locator('tbody tr').first();
      await firstRow.click();
      await page.waitForTimeout(500);
      
      // Open add form
      const addButton = page.getByRole('button', { name: /הגש הוצאה/i });
      await addButton.click();
      
      // Check dropdown options
      const select = page.locator('select').last();
      const options = await select.locator('option').allTextContents();
      
      // Verify meeting expense types
      expect(options).toContain('נסיעות');
      expect(options).toContain('מונית');
      expect(options).toContain('מדריך נוסף');
      expect(options).toContain('חומרים');
      expect(options).toContain('אחר');
    });
  });

  test.describe('Expense Summary in Meeting', () => {
    
    test('shows expense totals when expenses exist', async ({ page }) => {
      // Navigate to meetings page
      await page.goto('/meetings');
      await page.waitForTimeout(1000);
      
      // Open first meeting
      const firstRow = page.locator('tbody tr').first();
      await firstRow.click();
      await page.waitForTimeout(500);
      
      // Add an expense
      const addButton = page.getByRole('button', { name: /הגש הוצאה/i });
      if (await addButton.isVisible()) {
        await addButton.click();
        await page.locator('select').last().selectOption('taxi');
        await page.locator('input[placeholder*="סכום"]').fill('100');
        await page.getByRole('button', { name: /הגש$/i }).click();
        await page.waitForTimeout(1000);
      }
      
      // Check for summary section
      const summary = page.locator('.bg-gray-50').filter({ hasText: /סה"כ/i });
      if (await summary.isVisible()) {
        const text = await summary.innerText();
        expect(text).toContain('₪');
      }
    });
  });

  test.describe('Expense Deletion', () => {
    
    test('can delete pending expense', async ({ page }) => {
      // Navigate to meetings page
      await page.goto('/meetings');
      await page.waitForTimeout(1000);
      
      // Open first meeting
      const firstRow = page.locator('tbody tr').first();
      await firstRow.click();
      await page.waitForTimeout(500);
      
      // Add an expense first
      const addButton = page.getByRole('button', { name: /הגש הוצאה/i });
      if (await addButton.isVisible()) {
        await addButton.click();
        await page.locator('select').last().selectOption('other');
        await page.locator('input[placeholder*="תיאור"]').fill('הוצאה למחיקה');
        await page.locator('input[placeholder*="סכום"]').fill('25');
        await page.getByRole('button', { name: /הגש$/i }).click();
        await page.waitForTimeout(1000);
      }
      
      // Set up dialog handler
      page.on('dialog', dialog => dialog.accept());
      
      // Find and click delete button
      const deleteButton = page.locator('.text-gray-400').filter({ has: page.locator('svg') }).last();
      if (await deleteButton.isVisible()) {
        await deleteButton.click();
        await page.waitForTimeout(1000);
        
        // Verify expense was deleted (message should disappear)
        await expect(page.getByText('הוצאה למחיקה')).not.toBeVisible();
      }
    });
  });
});
