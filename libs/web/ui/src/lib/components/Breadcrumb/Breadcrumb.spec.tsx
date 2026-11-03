import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import {
  BreadcrumbLabelProvider,
  useBreadcrumbLabel,
  useSetBreadcrumbLabel,
} from './Breadcrumb';

function LabelReader() {
  const label = useBreadcrumbLabel();
  return <p>{String(label)}</p>;
}

function LabelSetter({ label }: { label: string | null }) {
  useSetBreadcrumbLabel(label);
  return null;
}

// The setter sits in a fixed slot (`false` when hidden) so the reader keeps
// its position across rerenders and is not remounted when the setter goes away.
function Harness({
  showSetter,
  label,
}: {
  showSetter: boolean;
  label: string;
}) {
  return (
    <BreadcrumbLabelProvider>
      {showSetter && <LabelSetter label={label} />}
      <LabelReader />
    </BreadcrumbLabelProvider>
  );
}

describe('Breadcrumb label context', () => {
  it('reads null without throwing when no provider is mounted', () => {
    render(<LabelReader />);

    expect(screen.getByText('null')).toBeInTheDocument();
  });

  it('does nothing when a setter is mounted without a provider', () => {
    render(
      <>
        <LabelSetter label="Renew passport" />
        <LabelReader />
      </>,
    );

    expect(screen.getByText('null')).toBeInTheDocument();
  });

  it('shows the label a mounted setter supplies to a reader in the same provider', () => {
    render(<Harness showSetter label="Renew passport" />);

    expect(screen.getByText('Renew passport')).toBeInTheDocument();
  });

  it('reverts the reader to null when the setter unmounts', () => {
    const { rerender } = render(<Harness showSetter label="Renew passport" />);
    expect(screen.getByText('Renew passport')).toBeInTheDocument();

    rerender(<Harness showSetter={false} label="Renew passport" />);

    expect(screen.getByText('null')).toBeInTheDocument();
    expect(screen.queryByText('Renew passport')).not.toBeInTheDocument();
  });

  it('updates the reader when the setter label changes while mounted', () => {
    const { rerender } = render(<Harness showSetter label="A" />);
    expect(screen.getByText('A')).toBeInTheDocument();

    rerender(<Harness showSetter label="B" />);

    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });
});
