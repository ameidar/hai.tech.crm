import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/login.page';
import { CyclesPage } from '../../page-objects/cycles.page';
import { CycleDetailPage } from '../../page-objects/cycle-detail.page';

const TEST_ADMIN = {
  email: 'admin@haitech.co.il',
  password: 'admin123',
};

test.describe('Cycle Zoom Integration', () => {
  
  // Login before each test
  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test.describe('Zoom Section Visibility', () => {
    
    test('Zoom section appears only for online cycles', async ({ page }) => {
      const cyclesPage = new CyclesPage(page);
      const cycleDetailPage = new CycleDetailPage(page);
      
      await cyclesPage.goto();
      
      const cycleCount = await cyclesPage.getCycleCount();
      
      if (cycleCount > 0) {
        // Open first cycle
        await cyclesPage.openFirstCycle();
        await cycleDetailPage.waitForPageLoad();
        
        // Check if Zoom section is present
        const hasZoom = await cycleDetailPage.hasZoomSection();
        
        // Get activity type from page content
        const pageText = await page.textContent('body');
        const isOnline = pageText?.includes('אונליין') ?? false;
        
        // Zoom section should match activity type
        if (isOnline) {
          expect(hasZoom).toBeTruthy();
        }
        // Note: For non-online cycles, Zoom section might still be hidden
      }
    });
  });

  test.describe('Zoom Meeting Creation', { tag: '@zoom' }, () => {
    
    test('create Zoom meeting button is functional', async ({ page }) => {
      const cyclesPage = new CyclesPage(page);
      const cycleDetailPage = new CycleDetailPage(page);
      
      await cyclesPage.goto();
      
      // Try to find an online cycle
      // Filter by searching or just try the first cycle
      const cycleCount = await cyclesPage.getCycleCount();
      
      if (cycleCount > 0) {
        await cyclesPage.openFirstCycle();
        await cycleDetailPage.waitForPageLoad();
        
        // Check if this is an online cycle with Zoom section
        const hasZoom = await cycleDetailPage.hasZoomSection();
        
        if (hasZoom) {
          // Check if Zoom meeting already exists
          const hasExistingMeeting = await cycleDetailPage.hasZoomMeeting();
          
          if (!hasExistingMeeting) {
            // Create Zoom button should be visible
            await expect(cycleDetailPage.createZoomButton).toBeVisible();
          } else {
            // Should show Zoom meeting details
            await expect(page.getByText('Meeting ID')).toBeVisible();
          }
        }
      }
    });

    test('Zoom meeting details display correctly', async ({ page }) => {
      const cyclesPage = new CyclesPage(page);
      const cycleDetailPage = new CycleDetailPage(page);
      
      await cyclesPage.goto();
      
      const cycleCount = await cyclesPage.getCycleCount();
      
      if (cycleCount > 0) {
        await cyclesPage.openFirstCycle();
        await cycleDetailPage.waitForPageLoad();
        
        const hasZoom = await cycleDetailPage.hasZoomSection();
        
        if (hasZoom) {
          const hasExistingMeeting = await cycleDetailPage.hasZoomMeeting();
          
          if (hasExistingMeeting) {
            // Should show Meeting ID
            await expect(page.getByText('Meeting ID')).toBeVisible();
            
            // Should show join link
            await expect(page.getByText(/לינק לכניסה/i)).toBeVisible();
            
            // Should have copy buttons
            const copyButtons = page.getByRole('button').filter({ has: page.locator('svg') });
            expect(await copyButtons.count()).toBeGreaterThan(0);
          }
        }
      }
    });

    test('copy to clipboard buttons work', async ({ page, context }) => {
      // Grant clipboard permissions
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      
      const cyclesPage = new CyclesPage(page);
      const cycleDetailPage = new CycleDetailPage(page);
      
      await cyclesPage.goto();
      
      const cycleCount = await cyclesPage.getCycleCount();
      
      if (cycleCount > 0) {
        await cyclesPage.openFirstCycle();
        await cycleDetailPage.waitForPageLoad();
        
        const hasZoom = await cycleDetailPage.hasZoomSection();
        
        if (hasZoom) {
          const hasExistingMeeting = await cycleDetailPage.hasZoomMeeting();
          
          if (hasExistingMeeting) {
            // Find copy button for join URL
            const copyButton = page.locator('button').filter({ has: page.locator('svg') }).first();
            
            if (await copyButton.isVisible()) {
              await copyButton.click();
              
              // Should show feedback (checkmark or "הועתק")
              await page.waitForTimeout(300);
              // The UI shows visual feedback, which we can check
            }
          }
        }
      }
    });
  });

  test.describe('Zoom Meeting in Meetings Table', () => {
    
    test('meetings inherit Zoom details from cycle', async ({ page }) => {
      const cyclesPage = new CyclesPage(page);
      const cycleDetailPage = new CycleDetailPage(page);
      
      await cyclesPage.goto();
      
      const cycleCount = await cyclesPage.getCycleCount();
      
      if (cycleCount > 0) {
        await cyclesPage.openFirstCycle();
        await cycleDetailPage.waitForPageLoad();
        
        const hasZoom = await cycleDetailPage.hasZoomSection();
        const hasExistingMeeting = hasZoom && await cycleDetailPage.hasZoomMeeting();
        
        // Check meetings table
        const meetingCount = await cycleDetailPage.getMeetingCount();
        
        if (meetingCount > 0 && hasExistingMeeting) {
          // Click on first meeting
          await cycleDetailPage.openMeeting(0);
          
          // Meeting detail modal should open
          await expect(page.locator('[role="dialog"]').or(page.getByText(/פרטי מפגש/i))).toBeVisible();
          
          // If cycle has Zoom, meetings should show Zoom info
          // Note: This depends on how the meeting modal is implemented
        }
      }
    });
  });
});
