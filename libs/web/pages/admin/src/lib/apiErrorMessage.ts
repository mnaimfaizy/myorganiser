import { isAxiosError } from 'axios';

export function getApiErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const data = err.response?.data;

    if (
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof data.message === 'string'
    ) {
      return data.message;
    }
  }

  return 'Action failed. Please try again.';
}
