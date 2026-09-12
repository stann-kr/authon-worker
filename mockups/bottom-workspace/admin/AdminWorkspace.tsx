import { useState } from "react";
import {
  events,
  type Guest,
  type GuestLink,
  type GuestRequest,
  type Screen,
} from "../model";
import { Icon } from "../shared/Icon";
import "./admin.css";

type Props = {
  screen: Screen;
  guests: Guest[];
  requests: GuestRequest[];
  links: GuestLink[];
  eventId: string;
  mine: boolean;
  onNavigate: (screen: Screen) => void;
  onDecision: (id: string, approve: boolean) => void;
  onEvent: (id: string) => void;
  onLinkToggle: (id: string) => void;
  onLinkInspect: (link: GuestLink) => void;
  onAccount: (name: string) => void;
  onVenue: () => void;
};

export function AdminWorkspace(props: Props) {
  const {
    screen,
    guests,
    requests,
    links,
    mine,
    onNavigate,
    onDecision,
    onEvent,
    onLinkToggle,
    onLinkInspect,
    onAccount,
    onVenue,
  } = props;
  const [rejectId, setRejectId] = useState<string | null>(null);
  const visibleRequests = requests.filter(
    (request) => !mine || request.name === "SORA",
  );
  const pending = visibleRequests.filter(
    (request) => request.state === "pending",
  );
  const contributors = ["SORA", "MILO", "운영팀"].map((name) => ({
    name,
    total: guests.filter((guest) => guest.owner === name).length,
    checked: guests.filter((guest) => guest.owner === name && guest.checked)
      .length,
  }));

  if (screen === "requests")
    return (
      <section aria-label="추가 인원 요청 목록">
        <div className="section-heading">
          <div>
            <span className="eyebrow">REQUESTS</span>
            <h2>
              {mine ? "내 요청" : "승인을 기다리는 요청"}{" "}
              <span className="count">{pending.length}</span>
            </h2>
          </div>
        </div>
        <div className="request-list">
          {visibleRequests.map((request) => (
            <article className="request-card" key={request.id}>
              <div className="request-title">
                <span className="avatar">{request.name[0]}</span>
                <div>
                  <h3>{request.name}</h3>
                  <span className="quiet">추가 인원 요청</span>
                </div>
                <strong>
                  +{request.count}
                  <small>명</small>
                </strong>
              </div>
              <p>{request.reason}</p>
              {request.state === "pending" && !mine ? (
                <div className="request-actions">
                  {rejectId === request.id ? (
                    <div className="confirmation">
                      <span>{request.name}의 요청을 거절할까요?</span>
                      <div className="button-row">
                        <button
                          className="secondary"
                          onClick={() => setRejectId(null)}
                        >
                          취소
                        </button>
                        <button
                          className="secondary"
                          onClick={() => {
                            onDecision(request.id, false);
                            setRejectId(null);
                          }}
                        >
                          요청 거절
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        className="secondary"
                        onClick={() => setRejectId(request.id)}
                      >
                        거절
                      </button>
                      <button
                        className="primary"
                        onClick={() => onDecision(request.id, true)}
                      >
                        <Icon name="check" size={17} /> {request.count}명 승인
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <span
                  className={`status-badge ${request.state === "approved" ? "green" : ""}`}
                >
                  {request.state === "pending"
                    ? "승인 대기"
                    : request.state === "approved"
                      ? "승인 완료"
                      : "거절됨"}
                </span>
              )}
            </article>
          ))}
        </div>
        {!visibleRequests.length && (
          <div className="empty-state">
            <Icon name="check" />
            <h3>아직 요청한 내역이 없어요</h3>
            <p>등록 한도가 부족하면 하단에서 추가 인원을 요청해 주세요.</p>
          </div>
        )}
      </section>
    );

  if (screen === "events")
    return (
      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">EVENTS</span>
            <h2>이번 달 행사</h2>
          </div>
          <span className="quiet">2026년 9월</span>
        </div>
        <div className="event-list">
          {events.map((event) => (
            <button
              className={`event-row ${event.id === props.eventId ? "selected" : ""}`}
              key={event.id}
              onClick={() => onEvent(event.id)}
            >
              <div className="event-day">
                <small>{event.day}</small>
                <strong>{event.date.slice(-2)}</strong>
              </div>
              <div className="event-info">
                <span
                  className={`status-badge ${event.id === "tonight" ? "green" : ""}`}
                >
                  {event.state}
                </span>
                <h3>{event.title}</h3>
                <p>
                  {event.venue} · {event.time}
                </p>
              </div>
              <Icon name="arrow" size={22} />
            </button>
          ))}
        </div>
        <p className="quiet footnote">
          행사를 선택하면 해당 행사의 명단·입장 집계로 이어집니다.
        </p>
      </section>
    );

  if (screen === "links")
    return (
      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">INVITATIONS</span>
            <h2>
              등록 링크 <span className="count">{links.length}</span>
            </h2>
          </div>
        </div>
        <div className="link-list">
          {links.map((link) => (
            <article key={link.id} className="link-row">
              <button
                className="link-details"
                onClick={() => onLinkInspect(link)}
              >
                <span className="link-icon">
                  <Icon name="link" />
                </span>
                <span>
                  <strong>{link.name}</strong>
                  <small>
                    {link.kind} · {link.used} / {link.limit}명 등록
                  </small>
                </span>
                <Icon name="chevron" size={17} />
              </button>
              <button
                className={`status-badge toggle ${link.active ? "green" : ""}`}
                aria-label={`${link.name} ${link.active ? "비활성화" : "활성화"}`}
                aria-pressed={link.active}
                onClick={() => onLinkToggle(link.id)}
              >
                {link.active ? "활성" : "비활성"}
                <span className="toggle-dot" />
              </button>
            </article>
          ))}
        </div>
      </section>
    );

  if (screen === "users")
    return (
      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">TEAM & ACCESS</span>
            <h2>베뉴 계정</h2>
          </div>
        </div>
        {[
          { name: "SORA", role: "DJ · 개인 계정" },
          { name: "MILO", role: "DJ · 개인 계정" },
          { name: "운영팀", role: "스태프 · 공용 계정" },
          { name: "Door 01", role: "도어 접근 가능 · 공용 계정" },
        ].map((user) => (
          <button
            key={user.name}
            className="management-row"
            onClick={() => onAccount(user.name)}
          >
            <span className="avatar">{user.name[0]}</span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </span>
            <span className="status-badge green">활성</span>
            <Icon name="chevron" size={17} />
          </button>
        ))}
        <div className="info-line">
          <Icon name="check" size={17} />
          <span>처리할 비밀번호 재설정 요청이 없어요.</span>
        </div>
      </section>
    );

  if (screen === "venues")
    return (
      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">VENUES</span>
            <h2>관리 중인 베뉴</h2>
          </div>
        </div>
        <button className="management-row" onClick={onVenue}>
          <span className="link-icon">
            <Icon name="venue" />
          </span>
          <span>
            <strong>FAUST</strong>
            <small>Seoul · 베뉴 설정</small>
          </span>
          <span className="status-badge green">활성</span>
          <Icon name="chevron" size={17} />
        </button>
      </section>
    );

  if (screen === "analytics")
    return (
      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">EVENT INSIGHTS</span>
            <h2>등록 담당자별 입장</h2>
          </div>
          <span className="status-badge">마감 전</span>
        </div>
        <div className="analytics-legend">
          <span>
            <i />
            등록 인원
          </span>
          <span>
            <i />
            입장 인원
          </span>
        </div>
        <div className="contributor-chart">
          {contributors.map((owner) => (
            <div key={owner.name} className="chart-row">
              <div>
                <strong>{owner.name}</strong>
                <span>
                  {owner.checked} / {owner.total}명
                </span>
              </div>
              <div className="bar-track">
                <div
                  style={{
                    width: `${(owner.total / Math.max(1, ...contributors.map((item) => item.total))) * 100}%`,
                  }}
                >
                  <i
                    style={{
                      width: `${owner.total ? (owner.checked / owner.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="quiet footnote">
          {events.find((event) => event.id === props.eventId)?.date} · 선택한
          행사 기준 · 누적 입장
        </p>
      </section>
    );

  return (
    <section className="overview">
      <button className="pending-banner" onClick={() => onNavigate("requests")}>
        <span className="notification-icon">
          <Icon name="bell" />
        </span>
        <span>
          <strong>
            {pending.length
              ? `추가 인원 요청 ${pending.length}건`
              : "처리할 요청이 없어요"}
          </strong>
          <small>
            {pending.length
              ? "명단 등록을 기다리는 DJ가 있어요"
              : "오늘의 게스트 명단을 확인해 보세요"}
          </small>
        </span>
        <Icon name="chevron" />
      </button>
      <div className="section-heading">
        <div>
          <span className="eyebrow">TONIGHT’S CONTRIBUTORS</span>
          <h2>등록 담당자 현황</h2>
        </div>
        <button className="text-button" onClick={() => onNavigate("roster")}>
          전체 명단
          <Icon name="arrow" size={16} />
        </button>
      </div>
      <div className="contributor-table">
        <div className="contributor-table-head">
          <span>담당자</span>
          <span>등록</span>
          <span>입장</span>
        </div>
        {contributors.map((owner) => (
          <div className="contributor-table-row" key={owner.name}>
            <span>
              <span className="avatar">{owner.name[0]}</span>
              <strong>{owner.name}</strong>
            </span>
            <span>{owner.total}</span>
            <span className="green-text">{owner.checked}</span>
          </div>
        ))}
      </div>
      <button className="overview-link" onClick={() => onNavigate("links")}>
        <Icon name="link" />
        <span>
          외부 등록 링크
          <strong>{links.filter((link) => link.active).length}개 활성</strong>
        </span>
        <Icon name="arrow" />
      </button>
    </section>
  );
}
