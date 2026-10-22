/**
 * Country calling codes with dial codes
 * Source: ITU-T E.164 international calling codes
 */
export const COUNTRY_CALLING_CODES = [
  { country: 'United States', code: '+1', flag: '🇺🇸', digitCount: 10 },
  { country: 'Canada', code: '+1', flag: '🇨🇦', digitCount: 10 },
  { country: 'United Kingdom', code: '+44', flag: '🇬🇧', digitCount: 10 },
  { country: 'Australia', code: '+61', flag: '🇦🇺', digitCount: 9 },
  { country: 'New Zealand', code: '+64', flag: '🇳🇿', digitCount: 9 },
  { country: 'India', code: '+91', flag: '🇮🇳', digitCount: 10 },
  { country: 'China', code: '+86', flag: '🇨🇳', digitCount: 11 },
  { country: 'Japan', code: '+81', flag: '🇯🇵', digitCount: 10 },
  { country: 'South Korea', code: '+82', flag: '🇰🇷', digitCount: 10 },
  { country: 'Singapore', code: '+65', flag: '🇸🇬', digitCount: 8 },
  { country: 'Malaysia', code: '+60', flag: '🇲🇾', digitCount: 10 },
  { country: 'Indonesia', code: '+62', flag: '🇮🇩', digitCount: 11 },
  { country: 'Philippines', code: '+63', flag: '🇵🇭', digitCount: 10 },
  { country: 'Thailand', code: '+66', flag: '🇹🇭', digitCount: 9 },
  { country: 'Vietnam', code: '+84', flag: '🇻🇳', digitCount: 10 },
  { country: 'Pakistan', code: '+92', flag: '🇵🇰', digitCount: 10 },
  { country: 'Bangladesh', code: '+880', flag: '🇧🇩', digitCount: 10 },
  { country: 'Sri Lanka', code: '+94', flag: '🇱🇰', digitCount: 9 },
  { country: 'Afghanistan', code: '+93', flag: '🇦🇫', digitCount: 9 },
  { country: 'Germany', code: '+49', flag: '🇩🇪', digitCount: 11 },
  { country: 'France', code: '+33', flag: '🇫🇷', digitCount: 9 },
  { country: 'Italy', code: '+39', flag: '🇮🇹', digitCount: 10 },
  { country: 'Spain', code: '+34', flag: '🇪🇸', digitCount: 9 },
  { country: 'Netherlands', code: '+31', flag: '🇳🇱', digitCount: 9 },
  { country: 'Belgium', code: '+32', flag: '🇧🇪', digitCount: 9 },
  { country: 'Switzerland', code: '+41', flag: '🇨🇭', digitCount: 9 },
  { country: 'Austria', code: '+43', flag: '🇦🇹', digitCount: 10 },
  { country: 'Poland', code: '+48', flag: '🇵🇱', digitCount: 9 },
  { country: 'Russia', code: '+7', flag: '🇷🇺', digitCount: 10 },
  { country: 'Ukraine', code: '+380', flag: '🇺🇦', digitCount: 9 },
  { country: 'Turkey', code: '+90', flag: '🇹🇷', digitCount: 10 },
  { country: 'Egypt', code: '+20', flag: '🇪🇬', digitCount: 10 },
  { country: 'South Africa', code: '+27', flag: '🇿🇦', digitCount: 9 },
  { country: 'Nigeria', code: '+234', flag: '🇳🇬', digitCount: 10 },
  { country: 'Kenya', code: '+254', flag: '🇰🇪', digitCount: 10 },
  { country: 'Saudi Arabia', code: '+966', flag: '🇸🇦', digitCount: 9 },
  { country: 'UAE', code: '+971', flag: '🇦🇪', digitCount: 9 },
  { country: 'Israel', code: '+972', flag: '🇮🇱', digitCount: 9 },
  { country: 'Brazil', code: '+55', flag: '🇧🇷', digitCount: 11 },
  { country: 'Argentina', code: '+54', flag: '🇦🇷', digitCount: 10 },
  { country: 'Mexico', code: '+52', flag: '🇲🇽', digitCount: 10 },
  { country: 'Colombia', code: '+57', flag: '🇨🇴', digitCount: 10 },
  { country: 'Chile', code: '+56', flag: '🇨🇱', digitCount: 9 },
  { country: 'Peru', code: '+51', flag: '🇵🇪', digitCount: 9 },
] as const;

/**
 * Get country info by calling code
 */
export function getCountryByCode(code: string) {
  return COUNTRY_CALLING_CODES.find((c) => c.code === code);
}

/**
 * Format phone number with proper spacing
 */
export function formatPhoneNumber(
  countryCode: string,
  phoneNumber: string,
): string {
  const country = getCountryByCode(countryCode);
  const digits = phoneNumber.replace(/\D/g, '');

  if (!country) {
    return `${countryCode} ${phoneNumber}`;
  }

  // Format based on country
  if (countryCode === '+1') {
    // US/Canada: (555) 123-4567
    if (digits.length === 10) {
      return `${countryCode} (${digits.slice(0, 3)}) ${digits.slice(
        3,
        6,
      )}-${digits.slice(6)}`;
    }
  } else if (countryCode === '+44') {
    // UK: 7911 123456
    if (digits.length === 10) {
      return `${countryCode} ${digits.slice(0, 4)} ${digits.slice(4)}`;
    }
  } else if (countryCode === '+61') {
    // Australia: 4xx xxx xxx
    if (digits.length === 9) {
      return `${countryCode} ${digits.slice(0, 3)} ${digits.slice(
        3,
        6,
      )} ${digits.slice(6)}`;
    }
  } else if (countryCode === '+91') {
    // India: 98765 43210
    if (digits.length === 10) {
      return `${countryCode} ${digits.slice(0, 5)} ${digits.slice(5)}`;
    }
  }

  // Default formatting: group by 3s
  const groups = [];
  for (let i = 0; i < digits.length; i += 3) {
    groups.push(digits.slice(i, i + 3));
  }
  return `${countryCode} ${groups.join(' ')}`;
}

/**
 * Validate phone number length for a country
 */
export function isValidPhoneLength(
  countryCode: string,
  phoneNumber: string,
): boolean {
  const country = getCountryByCode(countryCode);
  if (!country) return true; // Allow if country not found

  const digits = phoneNumber.replace(/\D/g, '');
  return digits.length === country.digitCount;
}

/**
 * The country name for a calling code. Several countries share a code (+1 is
 * the United States and Canada), so their names are joined with " / ". Undefined
 * for a code that is not in the list.
 */
export function countryNameForCode(code: string): string | undefined {
  const names = COUNTRY_CALLING_CODES.filter((c) => c.code === code).map(
    (c) => c.country,
  );
  return names.length > 0 ? names.join(' / ') : undefined;
}
