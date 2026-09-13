import { useState } from "react";
import { Sheet } from "../shared/Sheet";
import { Field, Form, Select, Toggle } from "../shared/ui";
import { useMock } from "../data/MockData";
import type { Booking } from "./types";
import { MaterialLink, timeLabel } from "./ui";

// Only the selected event's shared fields enter this preview; no directory, internal notes or guest data.
export type ArtistReviewInfo = Pick<
  Booking,
  | "start"
  | "end"
  | "arrival"
  | "soundcheck"
  | "stage"
  | "materials"
  | "revision"
  | "availability"
  | "status"
> & { artistName: string; eventName: string };
export function ArtistReview({
  info,
  onClose,
  onRespond,
}: {
  info: ArtistReviewInfo;
  onClose: () => void;
  onRespond: (
    availability: Booking["availability"],
    acknowledged: boolean,
    riderUrl: string,
  ) => Promise<void>;
}) {
  const { t } = useMock();
  const [availability, setAvailability] = useState(info.availability);
  const [acknowledged, setAcknowledged] = useState(false);
  const [riderUrl, setRiderUrl] = useState(info.materials.riderUrl);
  return (
    <Sheet
      title={t("아티스트 화면 미리보기")}
      subtitle={info.artistName}
      protectEdits
      onClose={onClose}
    >
      <div className="planning-detail">
        <h3>{info.eventName}</h3>
        <span className="planning-eyebrow">
          {t("일정 버전 {version}", { version: info.revision })} · KST
        </span>
        <dl className="planning-facts">
          <div>
            <dt>{t("출연")}</dt>
            <dd>
              {timeLabel(info.start)} → {timeLabel(info.end)}
            </dd>
          </div>
          <div>
            <dt>{t("장소·무대")}</dt>
            <dd>{info.stage || t("미정")}</dd>
          </div>
          <div>
            <dt>{t("도착")}</dt>
            <dd>{timeLabel(info.arrival)}</dd>
          </div>
          <div>
            <dt>{t("사운드체크")}</dt>
            <dd>{timeLabel(info.soundcheck)}</dd>
          </div>
        </dl>
        <MaterialLink
          label="소개·프레스 자료"
          value={info.materials.pressUrl}
        />
        {info.materials.requirements && (
          <p className="planning-copy">{info.materials.requirements}</p>
        )}
        <Form
          submit="응답 저장"
          onSubmit={() => onRespond(availability, acknowledged, riderUrl)}
        >
          <Select
            label="일정 가능 여부"
            value={availability}
            onChange={(e) => {
              setAvailability(e.target.value as Booking["availability"]);
              setAcknowledged(false);
            }}
          >
            <option value="unknown">{t("아직 확인 중")}</option>
            <option value="available">{t("가능합니다")}</option>
            <option value="unavailable">{t("조정이 필요합니다")}</option>
          </Select>
          <Field
            label="기술자료 URL"
            type="url"
            value={riderUrl}
            onChange={(e) => {
              setRiderUrl(e.target.value);
              setAcknowledged(false);
            }}
          />
          {info.status === "confirmed" && (
            <Toggle
              label="위 출연 일정과 준비사항을 확인했습니다"
              checked={acknowledged}
              disabled={availability !== "available"}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
          )}
        </Form>
      </div>
    </Sheet>
  );
}
