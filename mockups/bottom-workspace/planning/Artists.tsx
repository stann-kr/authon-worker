import { useState } from "react";
import { useMock, useIntent } from "../data/MockData";
import { Sheet } from "../shared/Sheet";
import { Action, Area, Empty, Field, Form, Notice, Select } from "../shared/ui";
import { artistKinds, type Artist } from "./types";
import { artistError, assertScope, activeBooking } from "./domain";
import { newArtist } from "./fixtures";
import { MaterialLink, PlanningTabs, Status, timeLabel } from "./ui";

export function Artists() {
  const { data, venue, user, mutate, navigate, setIntent, t } = useMock();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Artist | null>(null);
  const [error, setError] = useState("");
  const create = () => {
    setError("");
    setDraft(newArtist(venue.id));
  };
  useIntent("artist-create", create);
  const artists = data.planning.artists.filter((a) => a.scopeId === venue.id);
  const list = artists.filter(
    (a) =>
      (!kind || a.kind === kind) &&
      `${a.name} ${a.contact} ${a.agency} ${a.city}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const selected = artists.find((a) => a.id === selectedId);
  const history = data.planning.bookings
    .filter((b) => b.scopeId === venue.id && b.artistId === selectedId)
    .sort((a, b) => b.start.localeCompare(a.start));
  const book = (artistId: string) => {
    navigate("bookings");
    setIntent(`booking-artist:${artistId}`);
  };
  const update = (key: keyof Artist, value: string) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  return (
    <div className="flow-section planning-section">
      <PlanningTabs />
      <div className="planning-actions">
        <Action onClick={create}>아티스트 추가</Action>
      </div>
      <div className="planning-filters">
        <Field
          label="아티스트 검색"
          type="search"
          placeholder="이름·담당자·에이전시"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          label="공연 형태"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">{t("전체")}</option>
          {Object.entries(artistKinds).map(([key, label]) => (
            <option key={key} value={key}>
              {t(label)}
            </option>
          ))}
        </Select>
      </div>
      <p className="planning-result" role="status">
        {t("아티스트 {count}명", { count: list.length })}
      </p>
      <div className="planning-directory">
        {list.map((a) => (
          <button
            className="planning-artist"
            key={a.id}
            onClick={() => setSelectedId(a.id)}
          >
            <div className="planning-card-top">
              <strong>{a.name}</strong>
              <span className="status-badge">{t(artistKinds[a.kind])}</span>
            </div>
            <p>
              {a.city || t("거점 미등록")} · {a.agency || t("직접 연락")}
            </p>
            <span>{a.contact || t("담당자 미등록")}</span>
            <small>
              {t("진행 중 {count}건", {
                count: data.planning.bookings.filter(
                  (b) => b.artistId === a.id && activeBooking(b),
                ).length,
              })}{" "}
              · {a.riderUrl ? t("기술자료 등록됨") : t("기술자료 필요")}
            </small>
          </button>
        ))}
      </div>
      {!list.length && (
        <>
          <Empty text="조건에 맞는 아티스트가 없습니다." />
          <Action
            secondary
            onClick={() => {
              setQuery("");
              setKind("");
            }}
          >
            검색·필터 초기화
          </Action>
        </>
      )}
      {selected && !draft && (
        <Sheet
          title={selected.name}
          subtitle={`${t(artistKinds[selected.kind])} · ${selected.city || t("거점 미등록")}`}
          onClose={() => setSelectedId(null)}
        >
          <div className="planning-detail">
            <div className="button-row">
              <Action onClick={() => book(selected.id)}>
                이 아티스트 부킹
              </Action>
              <Action
                secondary
                onClick={() => {
                  setError("");
                  setDraft(structuredClone(selected));
                }}
              >
                아티스트 수정
              </Action>
            </div>
            <dl className="planning-facts">
              <div>
                <dt>{t("연락 담당자")}</dt>
                <dd>{selected.contact || "—"}</dd>
              </div>
              <div>
                <dt>{t("이메일")}</dt>
                <dd>
                  {selected.email ? (
                    <a href={`mailto:${selected.email}`}>{selected.email}</a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("에이전시")}</dt>
                <dd>{selected.agency || t("직접 연락")}</dd>
              </div>
            </dl>
            {selected.bio && <p className="planning-copy">{selected.bio}</p>}
            <div className="planning-materials">
              <MaterialLink
                label="소개·프레스 자료"
                value={selected.pressUrl}
              />
              <MaterialLink label="기술자료" value={selected.riderUrl} />
            </div>
            {selected.notes && (
              <section>
                <h3>{t("팀 내부 메모")}</h3>
                <p className="planning-copy">{selected.notes}</p>
              </section>
            )}
            <section>
              <h3>{t("함께한 행사와 진행 중인 부킹")}</h3>
              {history.map((b) => (
                <button
                  className="planning-history-link"
                  key={b.id}
                  onClick={() => {
                    navigate("bookings");
                    setIntent(`booking-open:${b.id}`);
                  }}
                >
                  <span>
                    <strong>
                      {data.events.find((e) => e.id === b.eventId)?.name}
                    </strong>
                    <small>{timeLabel(b.start)}</small>
                  </span>
                  <Status booking={b} />
                </button>
              ))}
              {!history.length && <Empty text="아직 연결된 부킹이 없습니다." />}
            </section>
          </div>
        </Sheet>
      )}
      {draft && (
        <Sheet
          key={draft.id}
          title={
            selected?.id === draft.id
              ? t("아티스트 수정")
              : t("아티스트 추가")
          }
          protectEdits
          onClose={() => {
            setDraft(null);
            setError("");
          }}
        >
          <Form
            submit="아티스트 저장"
            onSubmit={async () => {
              const candidate = {
                ...draft,
                name: draft.name.trim(),
                email: draft.email.trim(),
              };
              const issue = artistError(candidate);
              setError(issue);
              if (issue) return;
              const ok = await mutate((d) => {
                assertScope(d, venue.id, user.id);
                const index = d.planning.artists.findIndex(
                  (a) => a.id === candidate.id && a.scopeId === venue.id,
                );
                if (index < 0) d.planning.artists.unshift(candidate);
                else d.planning.artists[index] = candidate;
              }, "아티스트 정보를 저장했습니다.");
              if (ok) {
                setSelectedId(candidate.id);
                setDraft(null);
              }
            }}
          >
            <Field
              label="아티스트 이름"
              name="artistName"
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
              maxLength={100}
              required
              error={error.includes("이름") ? error : undefined}
            />
            <div className="form-duo">
              <Select
                label="공연 형태"
                value={draft.kind}
                onChange={(e) => update("kind", e.target.value)}
              >
                {Object.entries(artistKinds).map(([key, label]) => (
                  <option key={key} value={key}>
                    {t(label)}
                  </option>
                ))}
              </Select>
              <Field
                label="거점 도시"
                value={draft.city}
                onChange={(e) => update("city", e.target.value)}
                maxLength={80}
              />
            </div>
            <Field
              label="연락 담당자"
              value={draft.contact}
              onChange={(e) => update("contact", e.target.value)}
              maxLength={100}
            />
            <Field
              label="이메일"
              type="email"
              value={draft.email}
              onChange={(e) => update("email", e.target.value)}
              error={error.includes("이메일") ? error : undefined}
            />
            <Field
              label="에이전시"
              value={draft.agency}
              onChange={(e) => update("agency", e.target.value)}
              maxLength={120}
            />
            <Area
              label="소개·공연 구성"
              value={draft.bio}
              onChange={(e) => update("bio", e.target.value)}
              maxLength={1500}
            />
            <Field
              label="소개·프레스 자료 URL"
              type="url"
              value={draft.pressUrl}
              onChange={(e) => update("pressUrl", e.target.value)}
              error={error.includes("링크") ? error : undefined}
            />
            <Field
              label="기술자료 URL"
              type="url"
              value={draft.riderUrl}
              onChange={(e) => update("riderUrl", e.target.value)}
            />
            <Area
              label="팀 내부 메모"
              value={draft.notes}
              onChange={(e) => update("notes", e.target.value)}
              maxLength={1500}
            />
            {error && <Notice error>{error}</Notice>}
          </Form>
        </Sheet>
      )}
    </div>
  );
}
