import { useState } from "react";
import { useMock } from "../data/MockData";
import { Sheet } from "../shared/Sheet";
import { Area, Form, Notice, Select } from "../shared/ui";
import type { Booking } from "./types";
import { guestImpact, transitionBooking } from "./domain";

export function BookingCancellation({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const { data, user, mutate, t } = useMock();
  const [reason, setReason] = useState("");
  const [linkAction, setLinkAction] = useState<"" | "keep" | "pause">("");
  const impact = guestImpact(data, booking);
  return <Sheet title={t("부킹 취소")} protectEdits onClose={onClose}>
    <Form submit="취소 기록" onSubmit={async () => {
      if (await mutate((d) => transitionBooking(d, booking.id, booking.scopeId, user.id,
        booking.revision, "cancelled", { reason, linkAction: impact.link ? linkAction as "keep" | "pause" : "keep" }),
      "부킹 취소를 기록했습니다.")) onClose();
    }}>
      <Area label="취소 사유" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={1000} />
      <p className="planning-hint">{t("등록 {registered}명 · 입장 {checked}명", { registered: impact.registered, checked: impact.checked })}</p>
      {impact.link && <Select label="게스트 링크 처리" value={linkAction} required
        onChange={(e) => setLinkAction(e.target.value as "keep" | "pause")}>
        <option value="">{t("처리 방법 선택")}</option>
        <option value="pause" disabled={impact.sharedBookings.length > 0}>{t("추가 등록 중지")}</option>
        <option value="keep">{t("현재 링크 상태 유지")}</option>
      </Select>}
      {impact.sharedBookings.length > 0 && <Notice>다른 확정 부킹이 같은 링크를 사용 중입니다.</Notice>}
      <Notice>기존 게스트와 입장 기록은 유지됩니다. 취소 안내는 자동 발송되지 않습니다.</Notice>
    </Form>
  </Sheet>;
}
