import { getCurrentPhoneTab, getPhoneScreen } from './phone-screen';

describe('getCurrentPhoneTab', () => {
  it.each([
    ['/dashboard', 'home'],
    ['/dashboard/', 'home'],
    ['', 'home'],
    ['/dashboard/tasks', 'tasks'],
    ['/dashboard/groceries', 'groceries'],
    ['/dashboard/groceries/abc123', 'groceries'],
    ['/dashboard/vault', 'vault'],
    ['/dashboard/more', 'more'],
  ])('marks the tab for %j as %j', (pathname, expected) => {
    expect(getCurrentPhoneTab(pathname)).toBe(expected);
  });

  it.each([
    '/dashboard/subscriptions',
    '/dashboard/addresses/abc',
    '/dashboard/mobile-numbers',
    '/dashboard/youtube/shorts',
    '/dashboard/account',
    '/dashboard/account/reports',
  ])('assigns sections off the bar (%j) to more', (pathname) => {
    expect(getCurrentPhoneTab(pathname)).toBe('more');
  });

  it('does not treat a prefix-sharing segment as the tasks tab', () => {
    expect(getCurrentPhoneTab('/dashboard/tasksx')).toBe('more');
  });
});

describe('getPhoneScreen', () => {
  it('returns the home root with its large title', () => {
    expect(getPhoneScreen('/dashboard')).toEqual({
      type: 'root',
      tab: 'home',
      title: 'Home',
      kind: 'home',
    });
  });

  it.each([
    ['/dashboard/tasks', 'tasks', 'Tasks', 'tasks'],
    ['/dashboard/groceries', 'groceries', 'Groceries', 'groceries'],
    ['/dashboard/vault', 'vault', 'Vault', 'vault'],
    ['/dashboard/vault/', 'vault', 'Vault', 'vault'],
    ['/dashboard/more', 'more', 'More', 'more'],
  ])('returns the tab root for %j', (pathname, tab, title, kind) => {
    expect(getPhoneScreen(pathname)).toEqual({
      type: 'root',
      tab,
      title,
      kind,
    });
  });

  it.each([
    ['/dashboard/subscriptions', 'Subscriptions'],
    ['/dashboard/addresses', 'Addresses'],
    ['/dashboard/mobile-numbers', 'Mobile numbers'],
    ['/dashboard/youtube', 'YouTube'],
  ])(
    'pushes top-level section %j from More with back to More and no tab bar',
    (pathname, title) => {
      expect(getPhoneScreen(pathname)).toEqual({
        type: 'pushed',
        tab: 'more',
        title,
        back: { label: 'More', href: '/dashboard/more' },
        tabBar: false,
      });
    },
  );

  it('pushes Account from More with back to More and keeps the tab bar', () => {
    expect(getPhoneScreen('/dashboard/account')).toEqual({
      type: 'pushed',
      tab: 'more',
      title: 'Account',
      back: { label: 'More', href: '/dashboard/more' },
      tabBar: true,
    });
  });

  it('pushes a groceries item with no title of its own and back to Groceries', () => {
    expect(getPhoneScreen('/dashboard/groceries/abc123')).toEqual({
      type: 'pushed',
      tab: 'groceries',
      title: null,
      back: { label: 'Groceries', href: '/dashboard/groceries' },
      tabBar: false,
    });
  });

  it('pushes an addresses item with no title of its own and back to Addresses', () => {
    expect(getPhoneScreen('/dashboard/addresses/xyz')).toEqual({
      type: 'pushed',
      tab: 'more',
      title: null,
      back: { label: 'Addresses', href: '/dashboard/addresses' },
      tabBar: false,
    });
  });

  it('pushes a YouTube shorts screen back to YouTube', () => {
    expect(getPhoneScreen('/dashboard/youtube/shorts')).toEqual({
      type: 'pushed',
      tab: 'more',
      title: 'Shorts',
      back: { label: 'YouTube', href: '/dashboard/youtube' },
      tabBar: false,
    });
  });

  it('pushes an account reports screen back to Account with no tab bar', () => {
    expect(getPhoneScreen('/dashboard/account/reports')).toEqual({
      type: 'pushed',
      tab: 'more',
      title: 'Your reports',
      back: { label: 'Account', href: '/dashboard/account' },
      tabBar: false,
    });
  });
});
