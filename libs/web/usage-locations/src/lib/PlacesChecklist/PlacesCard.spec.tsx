import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  OrganisationTypeEnum,
  PriorityEnum,
  type UsageLocationRecord,
  UpdateMethodEnum,
} from '@myorganiser/vault-core';
import { PlacesCard, type PlacesCardProps } from './PlacesCard';

// Radix popper and checkbox need these browser APIs, which jsdom lacks.
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));
Element.prototype.scrollIntoView = jest.fn();

function place(
  id: string,
  organisationName: string,
  changed: boolean,
  link?: string,
): UsageLocationRecord {
  return {
    id,
    organisationName,
    organisationType: OrganisationTypeEnum.Government,
    updateMethod: UpdateMethodEnum.Online,
    changed,
    priority: PriorityEnum.Normal,
    createdAt: '2026-01-15T09:00:00.000Z',
    ...(link ? { link } : {}),
  };
}

function renderCard(overrides: Partial<PlacesCardProps> = {}): PlacesCardProps {
  const props: PlacesCardProps = {
    locations: [],
    noun: 'number',
    today: new Date(),
    pendingPlaceIds: new Set(),
    onAddPlace: jest.fn(),
    onEditPlace: jest.fn(),
    onSetPlaceChanged: jest.fn(),
    onRequestDeletePlace: jest.fn(),
    ...overrides,
  };
  render(<PlacesCard {...props} />);
  return props;
}

describe('PlacesCard', () => {
  it('describes an empty number checklist in the number words', () => {
    renderCard({ noun: 'number' });

    expect(
      screen.getByText('Everyone who has this number on file'),
    ).toBeInTheDocument();
    expect(screen.getByText('No places yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Add every organisation that needs to be told about this mobile number.',
      ),
    ).toBeInTheDocument();
  });

  it('describes an empty address checklist in the address words', () => {
    renderCard({ noun: 'address' });

    expect(
      screen.getByText('Everyone who needs to know about this address'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Add every organisation that needs to be told about this address.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the progress as "1 of 2" with "1 to go" and a labelled progress bar', () => {
    renderCard({
      locations: [
        place('loc-medicare', 'Medicare', false),
        place('loc-electoral', 'Electoral roll', true),
      ],
    });

    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(screen.getByText('1 to go')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Places updated' }),
    ).toHaveAttribute('aria-valuenow', '1');
    expect(screen.queryByText('All updated')).not.toBeInTheDocument();
  });

  it('shows "All updated" when every place is ticked, and "To do" then says every place is updated', () => {
    renderCard({
      locations: [
        place('loc-medicare', 'Medicare', true),
        place('loc-electoral', 'Electoral roll', true),
      ],
    });

    expect(screen.getByText('All updated')).toBeInTheDocument();
    expect(screen.queryByText(/to go/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'To do · 0' }));

    expect(screen.getByText('Every place is updated.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('filters the rows to the unticked places when To do is chosen', () => {
    renderCard({
      locations: [
        place('loc-medicare', 'Medicare', false),
        place('loc-electoral', 'Electoral roll', true),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'To do · 1' }));

    expect(
      screen.getByRole('checkbox', { name: 'Updated at Medicare' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Updated at Electoral roll' }),
    ).not.toBeInTheDocument();
  });

  it('offers Update online for a place still to update that has an https link', () => {
    renderCard({
      locations: [
        place('loc-medicare', 'Medicare', false, 'https://example.com'),
      ],
    });

    expect(screen.getByRole('link', { name: /Update online/ })).toHaveAttribute(
      'href',
      'https://example.com',
    );
  });

  it('does not offer Update online for a javascript: link', () => {
    renderCard({
      locations: [
        // eslint-disable-next-line no-script-url -- deliberate unsafe-scheme fixture for issue #1281
        place('loc-medicare', 'Medicare', false, 'javascript:alert(1)'),
      ],
    });

    expect(
      screen.queryByRole('link', { name: /Update online/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Update online/)).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('does not offer Update online for a place already ticked as updated', () => {
    renderCard({
      locations: [
        place('loc-medicare', 'Medicare', true, 'https://example.com'),
      ],
    });

    expect(
      screen.queryByRole('link', { name: /Update online/ }),
    ).not.toBeInTheDocument();
  });

  it('labels the card with its heading so the section is reachable by name', () => {
    renderCard({
      locations: [place('loc-medicare', 'Medicare', false)],
    });

    const section = screen.getByRole('region', { name: 'Places to update' });
    expect(
      within(section).getByRole('heading', {
        level: 2,
        name: 'Places to update',
      }),
    ).toBeInTheDocument();
  });
});
