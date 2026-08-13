import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveAsyncListState,
  shouldShowEmptyState,
} from "./async-list-state.ts";

test("목록의 idle/loading/empty/data/partial/error 상태를 구분한다", () => {
  assert.equal(
    deriveAsyncListState({
      hasStarted: false,
      isLoading: false,
      itemCount: 0,
      hasError: false,
    }),
    "idle",
  );
  assert.equal(
    deriveAsyncListState({
      hasStarted: true,
      isLoading: true,
      itemCount: 0,
      hasError: false,
    }),
    "loading",
  );
  assert.equal(
    deriveAsyncListState({
      hasStarted: true,
      isLoading: false,
      itemCount: 0,
      hasError: false,
    }),
    "success-empty",
  );
  assert.equal(
    deriveAsyncListState({
      hasStarted: true,
      isLoading: false,
      itemCount: 2,
      hasError: false,
    }),
    "success-data",
  );
  assert.equal(
    deriveAsyncListState({
      hasStarted: true,
      isLoading: false,
      itemCount: 2,
      hasError: true,
    }),
    "partial",
  );
  assert.equal(
    deriveAsyncListState({
      hasStarted: true,
      isLoading: false,
      itemCount: 0,
      hasError: true,
    }),
    "error",
  );
});

test("full error에서는 empty를 숨기고 retry 성공 뒤 회복한다", () => {
  const failed = deriveAsyncListState({
    hasStarted: true,
    isLoading: false,
    itemCount: 0,
    hasError: true,
  });
  const recovered = deriveAsyncListState({
    hasStarted: true,
    isLoading: false,
    itemCount: 0,
    hasError: false,
  });

  assert.equal(shouldShowEmptyState(failed), false);
  assert.equal(recovered, "success-empty");
  assert.equal(shouldShowEmptyState(recovered), true);
});
