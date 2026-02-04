import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/login.page';

const TEST_ADMIN = {
  email: 'admin@haitech.co.il',
  password: 'admin123',
};

const TEST_INSTRUCTOR = {
  email: 'instructor@haitech.co.il',
  password: 'instructor123',
};

test.describe('Authentication', () => {
  
  test.describe('Login Form', () => {
    
    test('displays login form correctly', async ({ page }) => {
      const loginPage = new LoginPage(page);
      
      await loginPage.goto();
      
      // Check form elements are visible
      await expect(loginPage.form).toBeVisible();
      await expect(loginPage.emailInput).toBeVisible();
      await expect(loginPage.passwordInput).toBeVisible();
      await expect(loginPage.loginButton).toBeVisible();
      
      // Check logo and branding
      await expect(page.getByAltText('דרך ההייטק')).toBeVisible();
      await expect(page.getByText('מערכת ניהול')).toBeVisible();
    });

    test('email field accepts valid email', async ({ page }) => {
      const loginPage = new LoginPage(page);
      
      await loginPage.goto();
      await loginPage.emailInput.fill('test@example.com');
      
      await expect(loginPage.emailInput).toHaveValue('test@example.com');
    });

    test('password field masks input', async ({ page }) => {
      const loginPage = new LoginPage(page);
      
      await loginPage.goto();
      
      // Check password field type
      await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
    });

    test('password field initially has type password', async ({ page }) => {
      const loginPage = new LoginPage(page);
      
      await loginPage.goto();
      
      // Password field should be masked (type=password)
      await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
    });
  });

  test.describe('Login - Success Cases', () => {
    
    test('admin user can login successfully', async ({ page }) => {
      const loginPage = new LoginPage(page);
      
      await loginPage.goto();
      await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
      
      // Should redirect away from login
      await expect(page).not.toHaveURL(/\/login/);
      
      // Should not show error
      await expect(loginPage.errorMessage).not.toBeVisible();
    });

    test('login persists after page reload', async ({ page }) => {
      const loginPage = new LoginPage(page);
      
      await loginPage.goto();
      await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
      await expect(page).not.toHaveURL(/\/login/);
      
      // Reload page
      await page.reload();
      
      // Should still be logged in
      await expect(page).not.toHaveURL(/\/login/);
    });
  });

  test.describe('Login - Error Cases', () => {
    
    test('shows error for invalid credentials', async ({ page }) => {
      const loginPage = new LoginPage(page);
      
      await loginPage.goto();
      await loginPage.login('wrong@email.com', 'wrongpassword');
      
      // Should show error message
      await expect(loginPage.errorMessage).toBeVisible();
      
      // Should stay on login page
      await expect(page).toHaveURL(/\/login/);
    });

    test('shows error for empty email', async ({ page }) => {
      const loginPage = new LoginPage(page);
      
      await loginPage.goto();
      await loginPage.passwordInput.fill('somepassword');
      await loginPage.loginButton.click();
      
      // HTML5 validation should prevent submission
      // Check that we're still on login page
      await expect(page).toHaveURL(/\/login/);
    });

    test('shows error for empty password', async ({ page }) => {
      const loginPage = new LoginPage(page);
      
      await loginPage.goto();
      await loginPage.emailInput.fill('test@example.com');
      await loginPage.loginButton.click();
      
      // HTML5 validation should prevent submission
      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe('Session Management', () => {
    
    test('protected routes redirect to login when not authenticated', async ({ page }) => {
      // Try various protected routes
      const protectedRoutes = ['/cycles', '/customers', '/students', '/instructors'];
      
      for (const route of protectedRoutes) {
        await page.goto(route);
        await expect(page).toHaveURL(/\/login/);
      }
    });

    test('already logged in user is redirected from login page', async ({ page }) => {
      const loginPage = new LoginPage(page);
      
      // Login first
      await loginPage.goto();
      await loginPage.login(TEST_ADMIN.email, TEST_ADMIN.password);
      await expect(page).not.toHaveURL(/\/login/);
      
      // Try to go back to login page
      await page.goto('/login');
      
      // Should be redirected away from login
      await expect(page).not.toHaveURL(/\/login/);
    });
  });
});
