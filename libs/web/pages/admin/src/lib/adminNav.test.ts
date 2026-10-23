import { isAdminNavItemActive, resolveAdminHeader } from './adminNav';

describe('isAdminNavItemActive', () => {
  it('matches /admin only exactly, and tolerates a trailing slash', () => {
    expect(isAdminNavItemActive('/admin', '/admin')).toBe(true);
    expect(isAdminNavItemActive('/admin/', '/admin')).toBe(true);
    expect(isAdminNavItemActive('/admin/users', '/admin')).toBe(false);
  });

  it('matches a section url as a path prefix followed by a slash', () => {
    expect(isAdminNavItemActive('/admin/users', '/admin/users')).toBe(true);
    expect(isAdminNavItemActive('/admin/users/abc', '/admin/users')).toBe(true);
  });

  it('does not match a sibling path that only shares the text prefix', () => {
    expect(isAdminNavItemActive('/admin/usersx', '/admin/users')).toBe(false);
  });
});

describe('resolveAdminHeader', () => {
  it('gives Overview with the portal crumb as current text on /admin', () => {
    expect(resolveAdminHeader('/admin')).toEqual({
      title: 'Overview',
      crumbs: [{ label: 'Admin portal' }],
    });
  });

  it('gives the section title with a linked portal crumb on a section root', () => {
    expect(resolveAdminHeader('/admin/users')).toEqual({
      title: 'Users',
      crumbs: [{ label: 'Admin portal', href: '/admin' }],
    });
    expect(resolveAdminHeader('/admin/audit-logs')).toEqual({
      title: 'Audit log',
      crumbs: [{ label: 'Admin portal', href: '/admin' }],
    });
  });

  it('treats a trailing slash on a section root as that section root', () => {
    expect(resolveAdminHeader('/admin/users/')).toEqual({
      title: 'Users',
      crumbs: [{ label: 'Admin portal', href: '/admin' }],
    });
  });

  it('gives Details with linked crumbs for a user detail route', () => {
    expect(resolveAdminHeader('/admin/users/user-123')).toEqual({
      title: 'Details',
      crumbs: [
        { label: 'Admin portal', href: '/admin' },
        { label: 'Users', href: '/admin/users' },
      ],
    });
  });

  it('gives Details with linked crumbs for a feedback report detail route', () => {
    expect(resolveAdminHeader('/admin/feedback/report-9')).toEqual({
      title: 'Details',
      crumbs: [
        { label: 'Admin portal', href: '/admin' },
        { label: 'Feedback', href: '/admin/feedback' },
      ],
    });
  });

  it('falls back to Admin portal for a route under no section', () => {
    expect(resolveAdminHeader('/dashboard')).toEqual({
      title: 'Admin portal',
      crumbs: [{ label: 'Admin portal' }],
    });
    expect(resolveAdminHeader('/admin/usersx')).toEqual({
      title: 'Admin portal',
      crumbs: [{ label: 'Admin portal' }],
    });
  });
});
