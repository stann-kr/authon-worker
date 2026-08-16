export interface AttendanceSummaryAuthority {
  generation: number;
  readSequence: number;
}

export interface AttendanceSummaryReadToken {
  generation: number;
  readSequence: number;
}

export interface AttendanceSummaryMutationToken {
  generation: number;
}

export interface AttendanceSummaryMutationClaim {
  generation: number;
  readSequence: number;
}

export function createAttendanceSummaryAuthority(): AttendanceSummaryAuthority {
  return { generation: 0, readSequence: 0 };
}

export function invalidateAttendanceSummaries(
  authority: AttendanceSummaryAuthority,
): void {
  authority.generation += 1;
  authority.readSequence += 1;
}

export function beginAttendanceSummaryRead(
  authority: AttendanceSummaryAuthority,
): AttendanceSummaryReadToken {
  authority.readSequence += 1;
  return {
    generation: authority.generation,
    readSequence: authority.readSequence,
  };
}

export function isAttendanceSummaryReadCurrent(
  authority: AttendanceSummaryAuthority,
  token: AttendanceSummaryReadToken,
): boolean {
  return authority.generation === token.generation &&
    authority.readSequence === token.readSequence;
}

export function beginAttendanceSummaryMutation(
  authority: AttendanceSummaryAuthority,
): AttendanceSummaryMutationToken {
  authority.generation += 1;
  return { generation: authority.generation };
}

export function claimAttendanceSummaryMutation(
  authority: AttendanceSummaryAuthority,
  token: AttendanceSummaryMutationToken,
): AttendanceSummaryMutationClaim | null {
  if (authority.generation !== token.generation) return null;
  authority.generation += 1;
  return {
    generation: authority.generation,
    readSequence: authority.readSequence,
  };
}

export function isAttendanceSummaryMutationClaimCurrent(
  authority: AttendanceSummaryAuthority,
  claim: AttendanceSummaryMutationClaim,
): boolean {
  return authority.generation === claim.generation &&
    authority.readSequence === claim.readSequence;
}
