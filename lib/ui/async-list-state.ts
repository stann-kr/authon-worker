export type AsyncListState =
  | "idle"
  | "loading"
  | "success-empty"
  | "success-data"
  | "partial"
  | "error";

export interface AsyncListStateInput {
  hasStarted: boolean;
  isLoading: boolean;
  itemCount: number;
  hasError: boolean;
  isPartial?: boolean;
}

/**
 * Produces one truthful presentation state for an asynchronously loaded list.
 * A full failure never degrades into an empty result, while stale data may be
 * retained and labelled as partial.
 */
export function deriveAsyncListState({
  hasStarted,
  isLoading,
  itemCount,
  hasError,
  isPartial = false,
}: AsyncListStateInput): AsyncListState {
  if (!hasStarted) return "idle";
  if (isLoading && itemCount === 0) return "loading";
  if (isPartial || (hasError && itemCount > 0)) return "partial";
  if (hasError) return "error";
  return itemCount === 0 ? "success-empty" : "success-data";
}

export function shouldShowEmptyState(state: AsyncListState): boolean {
  return state === "success-empty";
}
