"use client";

import {
  MAX_OFFLINE_DOOR_MUTATIONS,
  createOfflineDoorMutation,
  isOfflineDoorScopeEqual,
  retainCurrentOfflineDoorData,
  transitionOfflineDoorMutation,
  type OfflineDoorAction,
  type OfflineDoorMutation,
  type OfflineDoorMutationState,
  type OfflineDoorRosterSnapshot,
  type OfflineDoorScope,
} from "./offline-domain";

const DATABASE_NAME = "authon-door-offline-v1";
const DATABASE_VERSION = 1;
const RECORD_STORE = "records";
const META_STORE = "meta";
const DEVICE_KEY = "device";

interface OfflineRecord {
  key: string;
  type: "snapshot" | "mutation";
  value: OfflineDoorRosterSnapshot | OfflineDoorMutation;
}

interface MetaRecord {
  key: string;
  value: string | number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("OFFLINE_STORAGE_UNAVAILABLE"));
  }
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORD_STORE)) {
        database.createObjectStore(RECORD_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("OFFLINE_STORAGE_UNAVAILABLE"));
    };
  });
  return databasePromise;
}

function snapshotKey(scope: OfflineDoorScope): string {
  return `snapshot:${scope.venueId}:${scope.eventId}`;
}

function mutationKey(idempotencyKey: string): string {
  return `mutation:${idempotencyKey}`;
}

async function readAllRecords(database: IDBDatabase): Promise<OfflineRecord[]> {
  const transaction = database.transaction(RECORD_STORE, "readonly");
  return requestResult(transaction.objectStore(RECORD_STORE).getAll());
}

async function purgeAndReadScope(
  database: IDBDatabase,
  scope: OfflineDoorScope,
): Promise<{
  snapshots: OfflineDoorRosterSnapshot[];
  mutations: OfflineDoorMutation[];
}> {
  const records = await readAllRecords(database);
  const snapshots = records.flatMap((record) =>
    record.type === "snapshot" ? [record.value as OfflineDoorRosterSnapshot] : [],
  );
  const mutations = records.flatMap((record) =>
    record.type === "mutation" ? [record.value as OfflineDoorMutation] : [],
  );
  const retained = retainCurrentOfflineDoorData({ scope, snapshots, mutations });
  const retainedKeys = new Set([
    ...retained.snapshots.map((snapshot) => snapshotKey(snapshot.scope)),
    ...retained.mutations.map((mutation) => mutationKey(mutation.idempotencyKey)),
  ]);
  const transaction = database.transaction(RECORD_STORE, "readwrite");
  const store = transaction.objectStore(RECORD_STORE);
  for (const record of records) {
    if (!retainedKeys.has(record.key)) store.delete(record.key);
  }
  await transactionComplete(transaction);
  return retained;
}

export async function getOfflineDoorDeviceId(): Promise<string> {
  const database = await openDatabase();
  const readTransaction = database.transaction(META_STORE, "readonly");
  const existing = await requestResult<MetaRecord | undefined>(
    readTransaction.objectStore(META_STORE).get(DEVICE_KEY),
  );
  if (typeof existing?.value === "string") return existing.value;
  const deviceId = crypto.randomUUID();
  const writeTransaction = database.transaction(META_STORE, "readwrite");
  writeTransaction.objectStore(META_STORE).put({ key: DEVICE_KEY, value: deviceId });
  await transactionComplete(writeTransaction);
  return deviceId;
}

async function nextDeviceSequence(database: IDBDatabase, deviceId: string): Promise<number> {
  const key = `sequence:${deviceId}`;
  const transaction = database.transaction(META_STORE, "readwrite");
  const store = transaction.objectStore(META_STORE);
  const current = await requestResult<MetaRecord | undefined>(store.get(key));
  const sequence = typeof current?.value === "number" ? current.value + 1 : 1;
  store.put({ key, value: sequence });
  await transactionComplete(transaction);
  return sequence;
}

export async function saveOfflineDoorRoster(
  snapshot: OfflineDoorRosterSnapshot,
): Promise<void> {
  const database = await openDatabase();
  await purgeAndReadScope(database, snapshot.scope);
  const transaction = database.transaction(RECORD_STORE, "readwrite");
  transaction.objectStore(RECORD_STORE).put({
    key: snapshotKey(snapshot.scope),
    type: "snapshot",
    value: snapshot,
  } satisfies OfflineRecord);
  await transactionComplete(transaction);
}

export async function loadOfflineDoorRoster(
  scope: OfflineDoorScope,
): Promise<OfflineDoorRosterSnapshot | null> {
  const database = await openDatabase();
  const retained = await purgeAndReadScope(database, scope);
  return retained.snapshots.find((snapshot) =>
    isOfflineDoorScopeEqual(snapshot.scope, scope),
  ) ?? null;
}

export async function removeOfflineDoorRoster(
  scope: OfflineDoorScope,
): Promise<void> {
  const database = await openDatabase();
  await purgeAndReadScope(database, scope);
  const transaction = database.transaction(RECORD_STORE, "readwrite");
  transaction.objectStore(RECORD_STORE).delete(snapshotKey(scope));
  await transactionComplete(transaction);
}

export async function enqueueOfflineDoorMutation(params: {
  scope: OfflineDoorScope;
  guestId: string;
  action: OfflineDoorAction;
}): Promise<OfflineDoorMutation> {
  const database = await openDatabase();
  const retained = await purgeAndReadScope(database, params.scope);
  const queuedCount = retained.mutations.filter((mutation) => mutation.state === "queued").length;
  if (queuedCount >= MAX_OFFLINE_DOOR_MUTATIONS) {
    throw new Error("OFFLINE_QUEUE_FULL");
  }
  const deviceId = await getOfflineDoorDeviceId();
  const sequence = await nextDeviceSequence(database, deviceId);
  const mutation = createOfflineDoorMutation({ ...params, deviceId, sequence });
  const transaction = database.transaction(RECORD_STORE, "readwrite");
  transaction.objectStore(RECORD_STORE).put({
    key: mutationKey(mutation.idempotencyKey),
    type: "mutation",
    value: mutation,
  } satisfies OfflineRecord);
  await transactionComplete(transaction);
  return mutation;
}

export async function listOfflineDoorMutations(
  scope: OfflineDoorScope,
): Promise<OfflineDoorMutation[]> {
  const database = await openDatabase();
  const retained = await purgeAndReadScope(database, scope);
  return retained.mutations.sort(
    (left, right) =>
      new Date(left.queuedAt).getTime() - new Date(right.queuedAt).getTime() ||
      left.deviceId.localeCompare(right.deviceId) ||
      left.sequence - right.sequence,
  );
}

export async function resolveOfflineDoorMutation(params: {
  scope: OfflineDoorScope;
  idempotencyKey: string;
  state: Exclude<OfflineDoorMutationState, "queued">;
  resolution?: OfflineDoorMutation["resolution"];
}): Promise<void> {
  const database = await openDatabase();
  const retained = await purgeAndReadScope(database, params.scope);
  const mutation = retained.mutations.find(
    (candidate) => candidate.idempotencyKey === params.idempotencyKey,
  );
  if (!mutation) return;
  const next = transitionOfflineDoorMutation(
    mutation,
    params.state,
    params.resolution ?? null,
  );
  const transaction = database.transaction(RECORD_STORE, "readwrite");
  transaction.objectStore(RECORD_STORE).put({
    key: mutationKey(next.idempotencyKey),
    type: "mutation",
    value: next,
  } satisfies OfflineRecord);
  await transactionComplete(transaction);
}

export async function clearResolvedOfflineDoorMutations(
  scope: OfflineDoorScope,
): Promise<void> {
  const database = await openDatabase();
  const retained = await purgeAndReadScope(database, scope);
  const transaction = database.transaction(RECORD_STORE, "readwrite");
  const store = transaction.objectStore(RECORD_STORE);
  for (const mutation of retained.mutations) {
    if (mutation.state !== "queued") store.delete(mutationKey(mutation.idempotencyKey));
  }
  await transactionComplete(transaction);
}

export async function clearOfflineDoorData(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(RECORD_STORE, "readwrite");
  transaction.objectStore(RECORD_STORE).clear();
  await transactionComplete(transaction);
}
