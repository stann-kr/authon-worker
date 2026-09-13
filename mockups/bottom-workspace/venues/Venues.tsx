import { useState } from "react";
import { useMock, id, useIntent } from "../data/MockData";
import {
  MOCK_DATE,
  MOCK_NOW,
  type MockVenue,
  type Locale,
} from "../data/types";
import { Sheet } from "../shared/Sheet";
import {
  Action,
  Area,
  Confirm,
  Empty,
  Field,
  Form,
  Notice,
  Row,
  Select,
  string,
} from "../shared/ui";
export function Venues() {
  const { data, isSuper, mutate, chooseVenue, t, notice } = useMock();
  const [panel, setPanel] = useState<string | null>(null),
    [confirm, setConfirm] = useState(false);
  useIntent("venue-create", () => setPanel("create"));
  const venue = data.venues.find((v) => v.id === panel);
  if (!isSuper) return <Notice error>이 화면에 접근할 권한이 없습니다.</Notice>;
  const close = () => {
    setPanel(null);
    setConfirm(false);
  };
  return (
    <div className="flow-section">
      {data.venues.map((v) => (
        <Row
          key={v.id}
          title={v.name}
          meta={`${v.domain || t("지정된 기본 도메인 없음")} · ${v.opening}–${v.closing}`}
          badge={v.active ? "활성" : "비활성"}
          onClick={() => setPanel(v.id)}
        />
      ))}
      {!data.venues.length && <Empty text="베뉴가 없습니다" />}
      {panel && (
        <Sheet
          protectEdits
          title={t(venue ? "베뉴 수정" : "베뉴 생성")}
          onClose={close}
        >
          <VenueForm
            key={panel}
            venue={venue}
            onSubmit={async (form) => {
              const next: MockVenue = {
                id: venue?.id ?? id(),
                name: string(form, "name"),
                type: string(form, "type") as MockVenue["type"],
                address: string(form, "address"),
                description: string(form, "description"),
                brandName: string(form, "brandName"),
                tagline: string(form, "tagline"),
                domain: string(form, "domain"),
                locale: string(form, "locale") as Locale,
                timezone: string(form, "timezone"),
                opening: string(form, "opening"),
                closing: string(form, "closing"),
                active: venue?.active ?? true,
              };
              const ok = await mutate((d) => {
                try {
                  new Intl.DateTimeFormat("en", { timeZone: next.timezone });
                } catch {
                  throw Error("올바른 IANA 시간대를 입력해주세요.");
                }
                if (next.opening === next.closing)
                  throw Error(
                    "서로 다른 오픈·클로징 시간을 HH:mm 형식으로 입력해주세요.",
                  );
                if (
                  next.domain &&
                  (next.domain.includes("/") ||
                    next.domain.includes(":") ||
                    !next.domain.includes("."))
                )
                  throw Error(
                    "https:// 또는 경로를 제외한 호스트 이름만 입력하세요.",
                  );
                if (
                  d.venues.some(
                    (v) =>
                      v.id !== next.id && v.domain && v.domain === next.domain,
                  )
                )
                  throw Error("이미 사용 중인 도메인입니다.");
                if (venue)
                  Object.assign(
                    d.venues.find((v) => v.id === venue.id)!,
                    next,
                  );
                else {
                  d.venues.push(next);
                  d.events.push({
                    id: `general-${next.id}`,
                    venueId: next.id,
                    date: MOCK_DATE,
                    name: "일반 명단",
                    state: "open",
                    general: true,
                    capacity: null,
                    target: null,
                    createdAt: MOCK_NOW,
                    openedAt: MOCK_NOW,
                    closedAt: null,
                    templateId: null,
                  });
                }
              }, "저장했습니다.");
              if (ok) close();
            }}
          />
          {venue &&
            (confirm ? (
              <>
                <Confirm
                  title={venue.name}
                  description="게스트 등록과 입장 운영을 중단하고 소속 사용자를 로그아웃합니다. 나중에 다시 활성화할 수 있습니다."
                  onCancel={() => setConfirm(false)}
                  onConfirm={() =>
                    void mutate((d) => {
                      d.venues.find((v) => v.id === venue.id)!.active = false;
                    }, "변경했습니다.").then((ok) => {
                      if (ok) close();
                    })
                  }
                />
                {notice && <Notice>{notice}</Notice>}
              </>
            ) : (
              <div className="flow-stack">
                <Action
                  secondary
                  onClick={() =>
                    venue.active
                      ? setConfirm(true)
                      : void mutate((d) => {
                          d.venues.find((v) => v.id === venue.id)!.active =
                            true;
                        }, "변경했습니다.")
                  }
                >
                  {venue.active ? "비활성화" : "활성화"}
                </Action>
                <Action
                  disabled={!venue.active}
                  secondary
                  onClick={() => {
                    chooseVenue(venue.id);
                    close();
                  }}
                >
                  운영 베뉴로 선택
                </Action>
              </div>
            ))}
        </Sheet>
      )}
    </div>
  );
}
function VenueForm({
  venue,
  onSubmit,
}: {
  venue?: MockVenue;
  onSubmit: (form: FormData) => Promise<void>;
}) {
  const { t } = useMock();
  return (
    <Form onSubmit={onSubmit} submit={venue ? "저장" : "베뉴 생성"}>
      <Field
        label="베뉴 이름"
        name="name"
        defaultValue={venue?.name ?? ""}
        required
        maxLength={100}
      />
      <Select label="유형" name="type" defaultValue={venue?.type ?? "club"}>
        {[
          ["club", "클럽"],
          ["bar", "바"],
          ["lounge", "라운지"],
          ["festival", "페스티벌"],
          ["private", "프라이빗"],
        ].map(([v, l]) => (
          <option key={v} value={v}>
            {t(l)}
          </option>
        ))}
      </Select>
      <Field label="주소" name="address" defaultValue={venue?.address ?? ""} />
      <Area
        label="설명"
        name="description"
        defaultValue={venue?.description ?? ""}
      />
      <Field
        label="표시 이름"
        name="brandName"
        defaultValue={venue?.brandName ?? ""}
      />
      <Field
        label="태그라인"
        name="tagline"
        defaultValue={venue?.tagline ?? ""}
      />
      <Field
        label="기본 도메인 (빈 값: 해제)"
        name="domain"
        defaultValue={venue?.domain ?? ""}
        placeholder="venue.example.com"
      />
      <Select
        label="도메인 기본 언어"
        name="locale"
        defaultValue={venue?.locale ?? "ko"}
      >
        <option value="ko">한국어</option>
        <option value="en">English</option>
      </Select>
      <Field
        label="베뉴 시간대"
        name="timezone"
        required
        defaultValue={venue?.timezone ?? "Asia/Seoul"}
      />
      <div className="flow-inline-fields">
        <Field
          label="오픈 시간"
          name="opening"
          type="time"
          required
          defaultValue={venue?.opening ?? "23:00"}
        />
        <Field
          label="클로징 시간"
          name="closing"
          type="time"
          required
          defaultValue={venue?.closing ?? "07:00"}
        />
      </div>
      <p className="flow-hint">
        {t(
          "자정을 넘겨 운영하면 클로징 전 시각은 전날 오픈일의 영업일로 처리합니다.",
        )}
      </p>
    </Form>
  );
}
