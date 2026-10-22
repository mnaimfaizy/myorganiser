/* eslint-disable import/first -- jest.mock must precede application imports */
// Mocks sit above every import, so the module graph sees them first.
// Out of scope: the controller resolves false rather than rejecting for
// setLocationChanged and deleteMobileNumber, so a rejection is unreachable there.
const mockPush = jest.fn();
const mockUseMobileNumbersPage = jest.fn();
const mockVaultHandle = { isUnlocked: true };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

// The page reads its data through the hook; the controller fixture stands in.
jest.mock('../hooks/use-mobile-numbers-page', () => ({
  useMobileNumbersPage: (...args: unknown[]) =>
    mockUseMobileNumbersPage(...args),
}));

// Desktop by default; each phone test flips it to true.
jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useIsMobileState: jest.fn(() => false),
}));

// The locked-vault gate is owned by @myorganiser/web-vault-ui and is out of scope
// here. This mock renders the children straight away with a fake unlocked handle.
jest.mock('@myorganiser/web-vault-ui', () => ({
  VaultGate: ({
    children,
  }: {
    children: (args: { handle: unknown }) => unknown;
  }) => children({ handle: mockVaultHandle }),
}));

import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  OrganisationTypeEnum,
  PriorityEnum,
  type UsageLocationRecord,
  UpdateMethodEnum,
} from '@myorganiser/vault-core';
import { useIsMobileState } from '@myorganiser/web-ui';
import { MobileNumberDetailPageClient } from './MobileNumberDetailPageClient';
import {
  makeMobileNumberRecord,
  makeMobileNumbersPageController,
  makeUsageLocationRecord,
} from '../testing/mobile-numbers-page-controller.fixture';

// Radix popper and checkbox need these browser APIs, which jsdom lacks.
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));
Element.prototype.scrollIntoView = jest.fn();

/** Last updated on 3 October of this year, at local noon so the date holds in any zone. */
const UPDATED_ON = new Date(new Date().getFullYear(), 9, 3, 12).toISOString();

function place(
  overrides: Partial<UsageLocationRecord> &
    Pick<UsageLocationRecord, 'id' | 'organisationName'>,
): UsageLocationRecord {
  return { ...makeUsageLocationRecord(overrides.id, false), ...overrides };
}

// Saved in this order on purpose: the page sorts the unticked place above the ticked one.
const electoral = place({
  id: 'loc-electoral',
  organisationName: 'Electoral roll',
  organisationType: OrganisationTypeEnum.Government,
  updateMethod: UpdateMethodEnum.Online,
  priority: PriorityEnum.High,
  link: 'https://vote.example.com',
  changed: true,
});
const medicare = place({
  id: 'loc-medicare',
  organisationName: 'Medicare',
  organisationType: OrganisationTypeEnum.Government,
  updateMethod: UpdateMethodEnum.Online,
  priority: PriorityEnum.Normal,
});

// One of the two places is updated, so one is still to go.
const personal = makeMobileNumberRecord({
  id: 'mobile-personal',
  label: 'Personal',
  updatedAt: UPDATED_ON,
  usageLocations: [medicare, electoral],
});
const work = makeMobileNumberRecord({
  id: 'mobile-work',
  label: 'Work',
  countryCode: '+61',
  phoneNumber: '298765432',
  updatedAt: UPDATED_ON,
  usageLocations: [],
});

async function renderDetail(
  id = 'mobile-personal',
  page = makeMobileNumbersPageController([personal, work]),
) {
  mockUseMobileNumbersPage.mockReturnValue(page);
  let view!: ReturnType<typeof render>;
  // Flushed inside act, so the form validation settles before the test acts.
  await act(async () => {
    view = render(<MobileNumberDetailPageClient params={{ id }} />);
  });
  return { page, ...view };
}

function setPhone(isPhone: boolean) {
  jest.mocked(useIsMobileState).mockReturnValue(isPhone);
}

/** Opens a place's row menu. jsdom has no PointerEvent, so Enter opens it. */
function openRowMenu(organisationName: string) {
  fireEvent.keyDown(
    screen.getByRole('button', { name: `More for ${organisationName}` }),
    { key: 'Enter' },
  );
}

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard',
);
let writeText: jest.Mock;

describe('MobileNumberDetailPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPhone(false);
    writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      delete (navigator as unknown as { clipboard?: Clipboard }).clipboard;
    }
  });

  describe('loading and missing mobile number', () => {
    it('renders nothing while the breakpoint is still undecided', async () => {
      jest
        .mocked(useIsMobileState)
        .mockReturnValue(undefined as unknown as boolean);

      const { container } = await renderDetail();

      expect(container).toBeEmptyDOMElement();
    });

    it('shows Loading… and no heading while the mobile numbers are loading', async () => {
      await renderDetail(
        'mobile-personal',
        makeMobileNumbersPageController([personal, work], { loading: true }),
      );

      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1 }),
      ).not.toBeInTheDocument();
    });

    it('shows Mobile number not found and a link back to the list when the id matches no number', async () => {
      await renderDetail('mobile-missing');

      expect(screen.getByText('Mobile number not found.')).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Back to mobile numbers' }),
      ).toHaveAttribute('href', '/dashboard/mobile-numbers');
    });
  });

  describe('desktop detail', () => {
    it('shows the label, the updated caption, the call and message links, and an empty Places checklist', async () => {
      await renderDetail('mobile-work');

      expect(
        screen.getByRole('heading', { level: 1, name: 'Work' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Australia · updated 3 Oct')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute(
        'href',
        'tel:+61298765432',
      );
      expect(screen.getByRole('link', { name: 'Message' })).toHaveAttribute(
        'href',
        'sms:+61298765432',
      );

      const places = screen.getByRole('region', { name: 'Places to update' });
      expect(
        within(places).getByText('Everyone who has this number on file'),
      ).toBeInTheDocument();
      expect(within(places).getByText('No places yet')).toBeInTheDocument();
      expect(
        within(places).getByText(
          'Add every organisation that needs to be told about this mobile number.',
        ),
      ).toBeInTheDocument();

      const danger = screen.getByRole('region', {
        name: 'Delete this number',
      });
      expect(
        within(danger).getByText('It is removed from every device.'),
      ).toBeInTheDocument();
    });

    it('copies the formatted number and shows the clears-in-60-s confirmation', async () => {
      await renderDetail();

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Copy number +61 412 345 678' }),
        );
      });

      expect(writeText).toHaveBeenCalledWith('+61 412 345 678');
      expect(
        await screen.findByText('Copied — clears in 60 s'),
      ).toBeInTheDocument();
    });

    it('announces that the copy failed, and no success, when the browser refuses the write', async () => {
      writeText.mockRejectedValue(new Error('Permission denied'));
      await renderDetail();

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Copy number +61 412 345 678' }),
        );
      });

      expect(
        await screen.findByText(
          'Could not copy. Select the text and copy it instead.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Copied — clears in 60 s'),
      ).not.toBeInTheDocument();
    });

    it('saves edits from the Edit dialog under the mobile number id and closes it', async () => {
      const { page } = await renderDetail();

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      const dialog = await screen.findByRole('dialog', {
        name: 'Edit mobile number',
      });
      fireEvent.change(within(dialog).getByLabelText('Label'), {
        target: { value: 'Personal mobile' },
      });
      const save = within(dialog).getByRole('button', {
        name: 'Save changes',
      });
      await waitFor(() => expect(save).toBeEnabled());
      await act(async () => {
        fireEvent.click(save);
      });

      expect(page.updateMobileNumber).toHaveBeenCalledWith(
        'mobile-personal',
        expect.objectContaining({ label: 'Personal mobile' }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Edit mobile number' }),
        ).not.toBeInTheDocument(),
      );
    });

    it('keeps the Edit mobile number dialog open with the typed label when the save rejects', async () => {
      const { page } = await renderDetail();
      jest
        .mocked(page.updateMobileNumber)
        .mockRejectedValue(new Error('Save failed'));

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      const dialog = await screen.findByRole('dialog', {
        name: 'Edit mobile number',
      });
      fireEvent.change(within(dialog).getByLabelText('Label'), {
        target: { value: 'Personal mobile' },
      });
      const save = within(dialog).getByRole('button', {
        name: 'Save changes',
      });
      await waitFor(() => expect(save).toBeEnabled());
      await act(async () => {
        fireEvent.click(save);
      });

      expect(page.updateMobileNumber).toHaveBeenCalledWith(
        'mobile-personal',
        expect.objectContaining({ label: 'Personal mobile' }),
      );
      const openDialog = screen.getByRole('dialog', {
        name: 'Edit mobile number',
      });
      expect(within(openDialog).getByLabelText('Label')).toHaveValue(
        'Personal mobile',
      );
    });
  });

  describe('desktop places', () => {
    it('adds a place under the mobile number and closes the dialog once the save resolves', async () => {
      const { page } = await renderDetail();

      fireEvent.click(screen.getByRole('button', { name: 'Add place' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add place' });
      expect(
        within(dialog).getByText(
          'Who needs to know about Personal (+61 412 345 678)?',
        ),
      ).toBeInTheDocument();

      fireEvent.change(within(dialog).getByLabelText('Organisation'), {
        target: { value: 'Water board' },
      });
      const submit = within(dialog).getByRole('button', { name: 'Add place' });
      await waitFor(() => expect(submit).toBeEnabled());
      await act(async () => {
        fireEvent.click(submit);
      });

      expect(page.saveLocation).toHaveBeenCalledWith(
        'mobile-personal',
        expect.objectContaining({ orgName: 'Water board' }),
        null,
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Add place' }),
        ).not.toBeInTheDocument(),
      );
    });

    it('keeps the Add place dialog open with its values when saveLocation rejects', async () => {
      const { page } = await renderDetail();
      jest
        .mocked(page.saveLocation)
        .mockRejectedValue(new Error('Save failed'));

      fireEvent.click(screen.getByRole('button', { name: 'Add place' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add place' });
      fireEvent.change(within(dialog).getByLabelText('Organisation'), {
        target: { value: 'Water board' },
      });
      const submit = within(dialog).getByRole('button', { name: 'Add place' });
      await waitFor(() => expect(submit).toBeEnabled());
      await act(async () => {
        fireEvent.click(submit);
      });

      expect(page.saveLocation).toHaveBeenCalledWith(
        'mobile-personal',
        expect.objectContaining({ orgName: 'Water board' }),
        null,
      );
      const openDialog = screen.getByRole('dialog', { name: 'Add place' });
      expect(within(openDialog).getByLabelText('Organisation')).toHaveValue(
        'Water board',
      );
    });

    it('edits a place from its row menu and saves it under its own location id', async () => {
      const { page } = await renderDetail();

      openRowMenu('Medicare');
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Edit place' }),
      );

      const dialog = await screen.findByRole('dialog', { name: 'Edit place' });
      expect(within(dialog).getByLabelText('Organisation')).toHaveValue(
        'Medicare',
      );
      const save = within(dialog).getByRole('button', {
        name: 'Save changes',
      });
      await waitFor(() => expect(save).toBeEnabled());
      await act(async () => {
        fireEvent.click(save);
      });

      expect(page.saveLocation).toHaveBeenCalledWith(
        'mobile-personal',
        expect.objectContaining({ orgName: 'Medicare' }),
        'loc-medicare',
      );
    });

    it('disables a place tick while its save is pending and re-enables it once the save settles', async () => {
      const { page } = await renderDetail();
      let finishTick: (saved: boolean) => void = () => undefined;
      jest.mocked(page.setLocationChanged).mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finishTick = resolve;
          }),
      );

      await act(async () => {
        fireEvent.click(
          screen.getByRole('checkbox', { name: 'Updated at Medicare' }),
        );
      });
      expect(page.setLocationChanged).toHaveBeenCalledWith(
        'mobile-personal',
        'loc-medicare',
        true,
      );
      expect(
        screen.getByRole('checkbox', { name: 'Updated at Medicare' }),
      ).toBeDisabled();

      await act(async () => {
        finishTick(true);
      });
      expect(
        screen.getByRole('checkbox', { name: 'Updated at Medicare' }),
      ).toBeEnabled();
    });

    it('deletes a place once its confirm is accepted, and closes the confirm', async () => {
      const { page } = await renderDetail();

      openRowMenu('Medicare');
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Delete place…' }),
      );

      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Medicare"?',
      });
      expect(
        within(dialog).getByText(
          'This action cannot be undone. This usage location will be permanently removed from this mobile number.',
        ),
      ).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Delete place' }),
        );
      });

      expect(page.deleteLocation).toHaveBeenCalledWith(
        'mobile-personal',
        'loc-medicare',
      );
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
    });

    it('keeps the place confirm open when the delete is refused', async () => {
      const { page } = await renderDetail();
      jest.mocked(page.deleteLocation).mockResolvedValue(false);

      openRowMenu('Medicare');
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Delete place…' }),
      );
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Medicare"?',
      });

      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Delete place' }),
        );
      });

      expect(page.deleteLocation).toHaveBeenCalledWith(
        'mobile-personal',
        'loc-medicare',
      );
      expect(
        screen.getByRole('alertdialog', { name: 'Delete "Medicare"?' }),
      ).toBeInTheDocument();
    });
  });

  describe('deleting the mobile number', () => {
    it('navigates to the list and does not flash Mobile number not found once the delete resolves true', async () => {
      const { page, rerender } = await renderDetail();
      let finishDelete: (deleted: boolean) => void = () => undefined;
      jest.mocked(page.deleteMobileNumber).mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finishDelete = resolve;
          }),
      );

      const danger = screen.getByRole('region', {
        name: 'Delete this number',
      });
      fireEvent.click(within(danger).getByRole('button', { name: 'Delete…' }));
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Personal"?',
      });
      expect(
        within(dialog).getByText(
          'This action cannot be undone. The mobile number and its 2 usage locations will be permanently removed.',
        ),
      ).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole('button', {
            name: 'Delete mobile number',
          }),
        );
      });
      expect(page.deleteMobileNumber).toHaveBeenCalledWith('mobile-personal');

      // The record leaves the list before the delete resolves.
      mockUseMobileNumbersPage.mockReturnValue({ ...page, items: [work] });
      rerender(
        <MobileNumberDetailPageClient params={{ id: 'mobile-personal' }} />,
      );
      expect(
        screen.queryByText('Mobile number not found.'),
      ).not.toBeInTheDocument();
      expect(mockPush).not.toHaveBeenCalled();

      await act(async () => {
        finishDelete(true);
      });
      expect(mockPush).toHaveBeenCalledWith('/dashboard/mobile-numbers');
      expect(
        screen.queryByText('Mobile number not found.'),
      ).not.toBeInTheDocument();
    });

    it('keeps the confirm open and stays on the detail when the delete is refused', async () => {
      const { page } = await renderDetail();
      jest.mocked(page.deleteMobileNumber).mockResolvedValue(false);

      const danger = screen.getByRole('region', {
        name: 'Delete this number',
      });
      fireEvent.click(within(danger).getByRole('button', { name: 'Delete…' }));
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Personal"?',
      });

      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole('button', {
            name: 'Delete mobile number',
          }),
        );
      });

      expect(page.deleteMobileNumber).toHaveBeenCalledWith('mobile-personal');
      expect(
        screen.getByRole('alertdialog', { name: 'Delete "Personal"?' }),
      ).toBeInTheDocument();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('phone', () => {
    beforeEach(() => {
      setPhone(true);
    });

    it('draws one title, the places progress and the footer, and shows the success check after a copy', async () => {
      await renderDetail();

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Personal' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
      expect(
        screen.getByRole('heading', {
          name: 'PLACES TO UPDATE · 1 OF 2',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('progressbar', { name: 'Places updated' }),
      ).toHaveAttribute('aria-valuenow', '1');
      expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute(
        'href',
        'tel:+61412345678',
      );
      expect(screen.getByRole('link', { name: 'Message' })).toHaveAttribute(
        'href',
        'sms:+61412345678',
      );

      // The copy control's icon badge is the aria-hidden span inside the button.
      const copyButton = screen.getByRole('button', {
        name: 'Copy number +61 412 345 678',
      });
      const badge = copyButton.querySelector('[aria-hidden="true"]');
      expect(badge).toHaveClass('bg-secondary');
      expect(badge).not.toHaveClass('bg-success-soft');

      await act(async () => {
        fireEvent.click(copyButton);
      });

      expect(writeText).toHaveBeenCalledWith('+61 412 345 678');
      expect(
        await screen.findByText('Copied — clears in 60 s'),
      ).toBeInTheDocument();
      expect(badge).toHaveClass('bg-success-soft');
      expect(badge).not.toHaveClass('bg-secondary');
      expect(
        screen.getByRole('button', { name: 'Delete…' }),
      ).toBeInTheDocument();
    });

    it('opens the place sheet from Add place', async () => {
      await renderDetail();

      fireEvent.click(screen.getByRole('button', { name: 'Add place' }));

      const sheet = await screen.findByRole('dialog', { name: 'Add place' });
      expect(within(sheet).getByLabelText('Organisation')).toBeInTheDocument();
    });
  });
});
