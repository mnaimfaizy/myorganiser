import { AddressRecord } from '@myorganiser/vault-core';

/**
 * Check if an address record uses the new structured format
 */
export function isStructuredAddress(item: AddressRecord): boolean {
  return !!(item.street || item.suburb || item.country);
}

/**
 * Get a Google Maps search URL for an address
 */
export function getGoogleMapsUrl(item: AddressRecord): string {
  if (isStructuredAddress(item)) {
    const parts: string[] = [];

    // Property Number + Street
    const line1 = [item.propertyNumber, item.street].filter(Boolean).join(' ');
    if (line1) parts.push(line1);

    // Suburb + State
    const line2 = [item.suburb, item.state].filter(Boolean).join(' ');
    if (line2) parts.push(line2);

    // Zip Code + Country
    const line3 = [item.zipCode, item.country].filter(Boolean).join(' ');
    if (line3) parts.push(line3);

    const address = parts.join(', ');
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      address,
    )}`;
  }

  const address = item.address || '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    address,
  )}`;
}
