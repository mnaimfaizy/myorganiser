import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Combobox, type ComboboxOption } from './Combobox';

// jsdom has no scrollIntoView, which cmdk calls on the selected item, and no
// ResizeObserver, which cmdk's List observes.
Element.prototype.scrollIntoView = jest.fn();

class ResizeObserverStub {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}
window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const SEARCH_PLACEHOLDER = 'Search countries…';
const EMPTY_TEXT = 'No countries match.';

const COUNTRY_OPTIONS: ComboboxOption[] = [
  { value: '+61', label: 'Australia' },
  { value: '+1', label: 'Canada' },
];

// The "ca" query matches both this option's value and its label.
const OVERLAP_OPTIONS: ComboboxOption[] = [
  { value: '+61', label: 'Australia' },
  { value: 'ca', label: 'Canada (ca)' },
];

function renderCombobox(options: ComboboxOption[] = COUNTRY_OPTIONS) {
  const onValueChange = jest.fn();
  render(
    <Combobox
      value=""
      onValueChange={onValueChange}
      options={options}
      searchPlaceholder={SEARCH_PLACEHOLDER}
      emptyText={EMPTY_TEXT}
    />,
  );
  return { onValueChange };
}

function openAndSearch(query: string) {
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), {
    target: { value: query },
  });
}

describe('Combobox search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('finds an option by its label when the query is not part of its value', async () => {
    renderCombobox();

    openAndSearch('australia');

    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'Australia' }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('option', { name: 'Canada' }),
    ).not.toBeInTheDocument();
  });

  it('matches a label query case-insensitively', async () => {
    renderCombobox();

    openAndSearch('AUSTRALIA');

    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'Australia' }),
      ).toBeInTheDocument(),
    );
  });

  it('still finds an option by its value', async () => {
    renderCombobox();

    openAndSearch('+61');

    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'Australia' }),
      ).toBeInTheDocument(),
    );
  });

  it('reports the option value, not its label, after a label-filtered selection', async () => {
    const { onValueChange } = renderCombobox();
    openAndSearch('australia');

    fireEvent.click(await screen.findByRole('option', { name: 'Australia' }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('+61');
    expect(onValueChange).not.toHaveBeenCalledWith('Australia');
    await waitFor(() =>
      expect(
        screen.queryByPlaceholderText(SEARCH_PLACEHOLDER),
      ).not.toBeInTheDocument(),
    );
  });

  it('renders a matching option once when its label and value both match the query', async () => {
    renderCombobox(OVERLAP_OPTIONS);

    openAndSearch('ca');

    await waitFor(() =>
      expect(
        screen.getAllByRole('option', { name: 'Canada (ca)' }),
      ).toHaveLength(1),
    );
  });

  it('shows the empty text when no option matches the query', async () => {
    renderCombobox();

    openAndSearch('zzzz-no-match');

    await waitFor(() =>
      expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});
