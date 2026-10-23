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
): UsageLocationRecord {
  return {
    id,
    organisationName,
    organisationType: OrganisationTypeEnum.Government,
    updateMethod: UpdateMethodEnum.Online,
    changed,
    priority: PriorityEnum.Normal,
    createdAt: '2026-01-15T09:00:00.000Z',
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
