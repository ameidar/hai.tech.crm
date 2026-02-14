/**
 * Mobile Responsiveness Tests
 * 
 * These tests verify that responsive Tailwind CSS classes are correctly applied
 * to components by reading the source files and checking for expected patterns.
 * This approach avoids complex component rendering with mocked dependencies.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const readComponent = (relativePath: string): string => {
  return readFileSync(resolve(__dirname, '..', relativePath), 'utf-8');
};

describe('Layout - Mobile Drawer', () => {
  const source = readComponent('components/Layout.tsx');

  it('should have a mobile top bar hidden on desktop (md:hidden)', () => {
    // The mobile top bar should only show on mobile
    expect(source).toContain('md:hidden');
    // Should contain the hamburger Menu icon
    expect(source).toMatch(/Menu/);
  });

  it('should have a hamburger button that opens mobile sidebar', () => {
    expect(source).toContain('setMobileSidebarOpen(true)');
    expect(source).toContain('mobileSidebarOpen');
  });

  it('should have a mobile sidebar overlay with backdrop', () => {
    // Mobile overlay with semi-transparent background
    expect(source).toContain('bg-black/50');
    expect(source).toContain('fixed inset-0');
    expect(source).toContain('z-50');
  });

  it('should close mobile sidebar on route change', () => {
    expect(source).toContain('setMobileSidebarOpen(false)');
    expect(source).toContain('location.pathname');
  });

  it('should have desktop sidebar hidden on mobile (hidden md:flex)', () => {
    expect(source).toContain('hidden md:flex');
  });

  it('should use flex-col on mobile and flex-row on desktop', () => {
    expect(source).toContain('flex-col md:flex-row');
  });

  it('should have mobile close button hidden on desktop', () => {
    // Mobile close button inside sidebar
    expect(source).toContain('md:hidden');
    // Desktop toggle button hidden on mobile
    expect(source).toContain('hidden md:block');
  });

  it('should have touch-friendly minimum tap target sizes', () => {
    expect(source).toContain('min-w-[44px]');
    expect(source).toContain('min-h-[44px]');
  });
});

describe('Dashboard - Responsive Grid', () => {
  const source = readComponent('pages/Dashboard.tsx');

  it('should use responsive grid for KPI cards (2 cols mobile, 4 cols desktop)', () => {
    expect(source).toContain('grid-cols-2');
    expect(source).toContain('lg:grid-cols-4');
  });

  it('should have responsive padding (p-4 on mobile, md:p-6 on desktop)', () => {
    expect(source).toContain('p-4 md:p-6');
  });

  it('should have responsive gap sizing', () => {
    expect(source).toContain('gap-3 md:gap-6');
  });

  it('should have mobile card view for today meetings (md:hidden)', () => {
    // Mobile card view div
    expect(source).toMatch(/md:hidden.*divide-y/s);
  });

  it('should have desktop table view hidden on mobile (hidden md:block)', () => {
    expect(source).toContain('hidden md:block');
  });

  it('should have responsive text sizing in KPI cards', () => {
    expect(source).toContain('md:text-3xl');
  });

  it('should have responsive financial cards grid', () => {
    expect(source).toContain('grid-cols-1 md:grid-cols-3');
  });

  it('should hide status badges on mobile', () => {
    expect(source).toContain('hidden md:flex');
  });
});

describe('Meetings - Card View on Mobile', () => {
  const source = readComponent('pages/Meetings.tsx');

  it('should have mobile card view (md:hidden)', () => {
    expect(source).toContain('md:hidden space-y-2');
  });

  it('should have desktop table view hidden on mobile (hidden md:block)', () => {
    expect(source).toContain('hidden md:block');
  });

  it('should have responsive padding in main container', () => {
    expect(source).toContain('p-4 md:p-6');
  });

  it('should have touch-friendly tap targets in mobile cards', () => {
    expect(source).toContain('active:bg-gray-50');
  });

  it('should have mobile stats summary', () => {
    expect(source).toContain('md:hidden w-full');
  });

  it('should have responsive date navigation', () => {
    expect(source).toContain('min-w-[44px] min-h-[44px]');
  });

  it('should hide view selector on mobile', () => {
    expect(source).toContain('hidden md:block me-auto');
  });
});

describe('Cycles - Card View on Mobile', () => {
  const source = readComponent('pages/Cycles.tsx');

  it('should have mobile card view (md:hidden)', () => {
    expect(source).toContain('md:hidden space-y-2');
  });

  it('should have desktop table view hidden on mobile (hidden md:block)', () => {
    expect(source).toContain('hidden md:block');
  });

  it('should have responsive padding', () => {
    expect(source).toContain('p-4 md:p-6');
  });

  it('should have touch-friendly mobile cards', () => {
    expect(source).toContain('active:bg-gray-50');
  });

  it('should have mobile filter toggle button', () => {
    expect(source).toContain('md:hidden btn btn-secondary');
  });

  it('should have collapsible filters hidden on mobile by default', () => {
    expect(source).toContain('hidden md:flex');
  });

  it('should have responsive gap in filters', () => {
    expect(source).toContain('gap-2 md:gap-4');
  });
});

describe('Customers - Responsive Grid', () => {
  const source = readComponent('pages/Customers.tsx');

  it('should have responsive card grid (1 col mobile, 2-3 cols desktop)', () => {
    expect(source).toContain('grid-cols-1 md:grid-cols-2 lg:grid-cols-3');
  });

  it('should have responsive padding', () => {
    expect(source).toContain('p-4 md:p-6');
  });

  it('should have responsive gap sizing', () => {
    expect(source).toContain('gap-3 md:gap-6');
  });

  it('should have responsive search area', () => {
    expect(source).toContain('gap-2 md:gap-4');
  });
});

describe('Students - Responsive Layout', () => {
  const source = readComponent('pages/Students.tsx');

  it('should have mobile card view (md:hidden)', () => {
    expect(source).toContain('md:hidden space-y-2');
  });

  it('should have desktop table view hidden on mobile (hidden md:block)', () => {
    expect(source).toContain('hidden md:block');
  });

  it('should have touch-friendly action buttons on mobile', () => {
    expect(source).toContain('min-w-[44px] min-h-[44px]');
  });

  it('should hide view selector on mobile', () => {
    expect(source).toContain('hidden md:block');
  });

  it('should have responsive search/filter area', () => {
    expect(source).toContain('gap-2 md:gap-4');
  });
});

describe('Modal - Full Screen on Mobile', () => {
  const source = readComponent('components/ui/Modal.tsx');

  it('should be full-screen on mobile with rounded corners on desktop', () => {
    expect(source).toContain('rounded-none md:rounded-xl');
  });

  it('should be full height on mobile, auto on desktop', () => {
    expect(source).toContain('h-full md:h-auto');
  });

  it('should align to bottom on mobile, center on desktop', () => {
    expect(source).toContain('items-end md:items-center');
  });

  it('should have no padding on mobile, padding on desktop', () => {
    expect(source).toContain('md:p-4');
  });

  it('should limit max height only on desktop', () => {
    expect(source).toContain('md:max-h-[90vh]');
  });
});
