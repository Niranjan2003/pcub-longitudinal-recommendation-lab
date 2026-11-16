import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';

/**
 * Server-state defaults:
 *  - mutations NEVER retry (a retry is a new application decision, made by a human)
 *  - queries retry only on network failure, at most twice
 *  - no optimistic updates anywhere
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, error) => error instanceof ApiError && error.kind === 'network' && count < 2,
        refetchOnWindowFocus: true,
        staleTime: 0,
      },
      mutations: { retry: 0 },
    },
  });
}

export const queryKeys = {
  capabilities: ['capabilities'] as const,
  session: (id: string) => ['session', id] as const,
  comparison: (id: string) => ['comparison', id] as const,
  recipe: (id: string) => ['recipe', id] as const,
  r1: ['r1'] as const,
};

/** Immutable server records: persisted jobs, catalog recipes, frozen R1 results. */
export const IMMUTABLE = { staleTime: Infinity, gcTime: Infinity } as const;
