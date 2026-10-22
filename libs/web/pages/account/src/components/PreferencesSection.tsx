'use client';

import { COUNTRIES, SUPPORTED_CURRENCIES } from '@myorganiser/core';
import type { CurrencyCode } from '@myorganiser/vault-core';
import {
  Button,
  Label,
  ListGroup,
  ListGroupHeaderTitle,
  ListGroupRow,
  ListGroupRowTitle,
  ListGroupRowTrailing,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@myorganiser/web-ui';
import { useCallback, useId } from 'react';

import type { AccountVariant } from '../account-view';

interface PreferencesSectionProps {
  variant: AccountVariant;
  countryCode: string;
  onCountryCodeChange: (countryCode: string) => void;
  preferredCurrency: CurrencyCode;
  onPreferredCurrencyChange: (currency: CurrencyCode) => void;
  onSave: () => void;
}

export function PreferencesSection({
  variant,
  countryCode,
  onCountryCodeChange,
  preferredCurrency,
  onPreferredCurrencyChange,
  onSave,
}: PreferencesSectionProps) {
  const headingId = useId();
  const countryLabelId = useId();
  const currencyLabelId = useId();

  const handleCurrencyChange = useCallback(
    (value: string) => {
      onPreferredCurrencyChange(value as CurrencyCode);
    },
    [onPreferredCurrencyChange],
  );

  if (variant === 'phone') {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <ListGroupHeaderTitle id={headingId} className="mt-1.5 px-1">
          Preferences
        </ListGroupHeaderTitle>
        <ListGroup>
          <ListGroupRow size="value" className="min-h-13 justify-between">
            <ListGroupRowTitle id={countryLabelId} className="min-w-0 flex-1">
              Country
            </ListGroupRowTitle>
            <ListGroupRowTrailing>
              <Select value={countryCode} onValueChange={onCountryCodeChange}>
                <SelectTrigger
                  aria-labelledby={countryLabelId}
                  className="h-auto w-auto shrink-0 border-transparent bg-transparent px-0 text-body text-muted-foreground [&>span]:overflow-visible [&>span]:whitespace-normal"
                >
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ListGroupRowTrailing>
          </ListGroupRow>
          <ListGroupRow size="value" className="min-h-13 justify-between">
            <ListGroupRowTitle id={currencyLabelId} className="min-w-0 flex-1">
              Preferred currency
            </ListGroupRowTitle>
            <ListGroupRowTrailing>
              <Select
                value={preferredCurrency}
                onValueChange={handleCurrencyChange}
              >
                <SelectTrigger
                  aria-labelledby={currencyLabelId}
                  className="h-auto w-auto shrink-0 border-transparent bg-transparent px-0 text-body text-muted-foreground [&>span]:overflow-visible [&>span]:whitespace-normal"
                >
                  <SelectValue placeholder="Select currency">
                    {preferredCurrency}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ListGroupRowTrailing>
          </ListGroupRow>
        </ListGroup>
        <p className="px-1 text-caption text-muted-foreground">
          Used for prices in Subscriptions and for address formats.
        </p>
        <Button className="w-full" onClick={onSave}>
          Save
        </Button>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col rounded-panel border border-border bg-raised-surface"
    >
      <header className="flex flex-col gap-1 px-6 pt-5">
        <h2 id={headingId} className="font-display text-title font-bold">
          Preferences
        </h2>
        <p className="text-body-sm text-muted-foreground">
          Used for prices in Subscriptions and for address formats.
        </p>
      </header>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 px-6 pt-4 pb-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={countryLabelId}>Country</Label>
          <Select value={countryCode} onValueChange={onCountryCodeChange}>
            <SelectTrigger id={countryLabelId} className="h-12">
              <SelectValue placeholder="Select country" />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={currencyLabelId}>Preferred currency</Label>
          <Select
            value={preferredCurrency}
            onValueChange={handleCurrencyChange}
          >
            <SelectTrigger id={currencyLabelId} className="h-12">
              <SelectValue placeholder="Select currency" />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_CURRENCIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex justify-end px-6 pb-5">
        <Button onClick={onSave}>Save</Button>
      </div>
    </section>
  );
}
