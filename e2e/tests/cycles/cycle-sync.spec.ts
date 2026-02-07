import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/login.page';
import { CyclesPage } from '../../page-objects/cycles.page';
import { CycleDetailPage } from '../../page-objects/cycle-detail.page';

const TEST_ADMIN = {
  email: 'admin@haitech.co.il',
  password: 'admin123',
};

test.describe('Cycle Sync Progress', () => {
  
  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('sync progress does not change totalMeetings', async ({ page }) => {
    const cyclesPage = new CyclesPage(page);
    const cycleDetailPage = new CycleDetailPage(page);
    
    await cyclesPage.goto();
    
    const cycleCount = await cyclesPage.getCycleCount();
    
    if (cycleCount > 0) {
      await cyclesPage.openFirstCycle();
      await cycleDetailPage.waitForPageLoad();
      
      // Get the current progress text before sync
      const progressSection = page.getByTestId('progress-section').or(page.locator('.card').filter({ hasText: /התקדמות/i }));
      const progressTextBefore = await progressSection.innerText();
      
      // Extract totalMeetings from progress (e.g., "X / Y" format)
      const totalMatch = progressTextBefore.match(/\/\s*(\d+)/);
      const totalBefore = totalMatch ? parseInt(totalMatch[1], 10) : null;
      
      // Click sync button if exists
      const syncButton = progressSection.locator('button').filter({ has: page.locator('svg') });
      
      if (await syncButton.isVisible()) {
        await syncButton.click();
        
        // Wait for sync to complete
        await page.waitForTimeout(1000);
        
        // Get progress after sync
        const progressTextAfter = await progressSection.innerText();
        const totalMatchAfter = progressTextAfter.match(/\/\s*(\d+)/);
        const totalAfter = totalMatchAfter ? parseInt(totalMatchAfter[1], 10) : null;
        
        // totalMeetings should remain unchanged
        if (totalBefore !== null && totalAfter !== null) {
          expect(totalAfter).toBe(totalBefore);
        }
      }
    }
  });

  test('sync progress updates completed and remaining counts', async ({ page }) => {
    const cyclesPage = new CyclesPage(page);
    const cycleDetailPage = new CycleDetailPage(page);
    
    await cyclesPage.goto();
    
    const cycleCount = await cyclesPage.getCycleCount();
    
    if (cycleCount > 0) {
      await cyclesPage.openFirstCycle();
      await cycleDetailPage.waitForPageLoad();
      
      const progressSection = page.getByTestId('progress-section').or(page.locator('.card').filter({ hasText: /התקדמות/i }));
      const syncButton = progressSection.locator('button').filter({ has: page.locator('svg') });
      
      if (await syncButton.isVisible()) {
        // Set up response interception
        const responsePromise = page.waitForResponse(resp => 
          resp.url().includes('/sync-progress') && resp.status() === 200
        );
        
        await syncButton.click();
        
        const response = await responsePromise;
        const data = await response.json();
        
        // Response should include synced data
        expect(data.synced).toBeDefined();
        expect(data.synced.completedMeetings).toBeDefined();
        expect(data.synced.remainingMeetings).toBeDefined();
        expect(data.synced.totalMeetings).toBeDefined();
      }
    }
  });
});
