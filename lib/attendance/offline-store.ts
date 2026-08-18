"use client";

import {
  MAX_OFFLINE_ATTENDANCE_MUTATIONS,
  createOfflineAttendanceMutation,
  isAttendanceScopeEqual,
  transitionOfflineAttendanceMutation,
  type AttendanceScope,
  type DoorAttendanceAction,
  type OfflineAttendanceMutation,
  type OfflineAttendanceMutationState,
} from "./domain";

const DATABASE_NAME = "authon-attendance-offline-v1";
const DATABASE_VERSION = 2;
const MUTATION_STORE = "mutations";
const MUTATION_STATE_INDEX = "state";
const META_STORE = "meta";
const DEVICE_KEY = "device";

interface MetaRecord {
  key: string;
  value: string | number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("ATTENDANCE_STORAGE_REQUEST_FAILED"),
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("ATTENDANCE_STORAGE_TRANSACTION_FAILED"),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("ATTENDANCE_STORAGE_TRANSACTION_ABORTED"),
    );
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;
let deviceIdPromise: Promise<string> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("ATTENDANCE_STORAGE_UNAVAILABLE"));
  }
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let isBlocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      const mutationStore = database.objectStoreNames.contains(MUTATION_STORE)
        ? request.transaction?.objectStore(MUTATION_STORE)
        : database.createObjectStore(MUTATION_STORE, {
          keyPath: "idempotencyKey",
        });
      if (
        mutationStore &&
        !mutationStore.indexNames.contains(MUTATION_STATE_INDEX)
      ) {
        mutationStore.createIndex(MUTATION_STATE_INDEX, "state");
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      if (isBlocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onblocked = () => {
      isBlocked = true;
      databasePromise = null;
      reject(new Error("ATTENDANCE_STORAGE_UPGRADE_BLOCKED"));
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("ATTENDANCE_STORAGE_UNAVAILABLE"));
    };
  });
  return databasePromise;
}

async function listAllMutations(
  database: IDBDatabase,
): Promise<OfflineAttendanceMutation[]> {
  const transaction = database.transaction(MUTATION_STORE, "readonly");
  return requestResult(
    transaction.objectStore(MUTATION_STORE).getAll(),
  );
}

export async function getAttendanceDeviceId(): Promise<string> {
  if (deviceIdPromise) return deviceIdPromise;
  deviceIdPromise = loadOrCreateAttendanceDeviceId();
  try {
    return await deviceIdPromise;
  } catch (error) {
    deviceIdPromise = null;
    throw error;
  }
}

async function loadOrCreateAttendanceDeviceId(): Promise<string> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, "readwrite");
  const completion = transactionComplete(transaction);
  const store = transaction.objectStore(META_STORE);
  try {
    const existing = await requestResult<MetaRecord | undefined>(
      store.get(DEVICE_KEY),
    );
    if (typeof existing?.value === "string") {
      await completion;
      return existing.value;
    }
    const deviceId = crypto.randomUUID();
    store.put({
      key: DEVICE_KEY,
      value: deviceId,
    } satisfies MetaRecord);
    await completion;
    return deviceId;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already be aborted or committed.
    }
    await completion.catch(() => {});
    throw error;
  }
}

export async function enqueueAttendanceMutation(params: {
  scope: AttendanceScope;
  action: DoorAttendanceAction;
  reversesIdempotencyKey?: string | null;
}): Promise<OfflineAttendanceMutation> {
  const database = await openDatabase();
  const deviceId = await getAttendanceDeviceId();
  const transaction = database.transaction(
    [MUTATION_STORE, META_STORE],
    "readwrite",
  );
  const completion = transactionComplete(transaction);
  try {
    const mutationStore = transaction.objectStore(MUTATION_STORE);
    const queuedCount = await requestResult(
      mutationStore.index(MUTATION_STATE_INDEX).count("queued"),
    );
    if (queuedCount >= MAX_OFFLINE_ATTENDANCE_MUTATIONS) {
      transaction.abort();
      await completion.catch(() => {});
      throw new Error("ATTENDANCE_QUEUE_FULL");
    }
    const sequenceKey = `sequence:${deviceId}`;
    const metaStore = transaction.objectStore(META_STORE);
    const current = await requestResult<MetaRecord | undefined>(
      metaStore.get(sequenceKey),
    );
    const sequence = typeof current?.value === "number"
      ? current.value + 1
      : 1;
    const mutation = createOfflineAttendanceMutation({
      ...params,
      deviceId,
      sequence,
    });
    metaStore.put({ key: sequenceKey, value: sequence } satisfies MetaRecord);
    mutationStore.put(mutation);
    await completion;
    return mutation;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already be aborted or committed.
    }
    await completion.catch(() => {});
    throw error;
  }
}

export async function listAttendanceMutations(
  scope: AttendanceScope,
): Promise<OfflineAttendanceMutation[]> {
  const database = await openDatabase();
  const mutations = await listAllMutations(database);
  return mutations
    .filter((mutation) => isAttendanceScopeEqual(mutation.scope, scope))
    .sort(
      (left, right) =>
        left.queuedAt.localeCompare(right.queuedAt) ||
        left.deviceId.localeCompare(right.deviceId) ||
        left.sequence - right.sequence,
    );
}

export async function resolveAttendanceMutation(params: {
  idempotencyKey: string;
  state: Exclude<OfflineAttendanceMutationState, "queued">;
  resolution?: OfflineAttendanceMutation["resolution"];
}): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(MUTATION_STORE, "readwrite");
  const store = transaction.objectStore(MUTATION_STORE);
  const mutation = await requestResult<OfflineAttendanceMutation | undefined>(
    store.get(params.idempotencyKey),
  );
  if (mutation) {
    store.put(
      transitionOfflineAttendanceMutation(
        mutation,
        params.state,
        params.resolution ?? null,
      ),
    );
  }
  await transactionComplete(transaction);
}

export async function removeAttendanceMutations(
  idempotencyKeys: readonly string[],
): Promise<void> {
  if (idempotencyKeys.length === 0) return;
  const database = await openDatabase();
  const transaction = database.transaction(MUTATION_STORE, "readwrite");
  const store = transaction.objectStore(MUTATION_STORE);
  for (const key of idempotencyKeys) store.delete(key);
  await transactionComplete(transaction);
}

export async function clearResolvedAttendanceMutations(
  scope: AttendanceScope,
): Promise<void> {
  const database = await openDatabase();
  const mutations = await listAllMutations(database);
  const transaction = database.transaction(MUTATION_STORE, "readwrite");
  const store = transaction.objectStore(MUTATION_STORE);
  for (const mutation of mutations) {
    if (
      mutation.state !== "queued" &&
      isAttendanceScopeEqual(mutation.scope, scope)
    ) {
      store.delete(mutation.idempotencyKey);
    }
  }
  await transactionComplete(transaction);
}

export function groupAttendanceMutationsByDevice(
  mutations: readonly OfflineAttendanceMutation[],
): Array<{ deviceId: string; mutations: OfflineAttendanceMutation[] }> {
  const groups = new Map<string, OfflineAttendanceMutation[]>();
  for (const mutation of mutations) {
    if (mutation.state !== "queued") continue;
    const group = groups.get(mutation.deviceId) ?? [];
    group.push(mutation);
    groups.set(mutation.deviceId, group);
  }
  return [...groups.entries()].map(([deviceId, grouped]) => ({
    deviceId,
    mutations: grouped.sort((left, right) => left.sequence - right.sequence),
  }));
}
