import { useState } from "react";
import {
  canManageTargetAccount,
  canManageTargetRole,
  canDiscoverTargetRole,
} from "../../../lib/users/policy";
import { useMock, audit, id, useIntent } from "../data/MockData";
import { assertCapability } from "../data/access";
import { requireManagedAccount, validateAccountGrant } from "./policy";
import {
  MOCK_NOW,
  roleLabels,
  type MockUser,
  type Role,
  type Locale,
} from "../data/types";
import { Sheet } from "../shared/Sheet";
import {
  Action,
  Confirm,
  CopyBox,
  Empty,
  Field,
  Form,
  Notice,
  Row,
  Select,
  Tabs,
  Toggle,
  optionalNumber,
  string,
} from "../shared/ui";
const accountKinds = [
  { id: "personal", label: "개인 계정" },
  { id: "shared", label: "공용 계정" },
];
export function Accounts() {
  const {
    data,
    user,
    venue,
    isSuper,
    mutate,
    setAuthPage,
    navigate,
    t,
    busy,
    notice,
  } = useMock();
  const [panel, setPanel] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [roleFilter, setRoleFilter] = useState("all"),
    [status, setStatus] = useState("current"),
    [confirm, setConfirm] = useState(""),
    [credential, setCredential] = useState<{
      userId: string;
      version: number;
      kind: string;
    } | null>(null);
  useIntent("user-create", () => setPanel("create"));
  const selected = data.users.find((u) => u.id === panel);
  const roles: Role[] = isSuper
    ? ["venue_admin", "door_staff", "staff", "dj"]
    : ["door_staff", "staff", "dj"];
  const entries = data.users.filter(
    (u) =>
      (u.venueId === venue.id || (isSuper && u.role === "super_admin")) &&
      canDiscoverTargetRole(user.role, u.role) &&
      (status === "deleted"
        ? u.deleted
        : !u.deleted &&
          (status === "current" ||
            (status === "active" ? u.active : !u.active))) &&
      (roleFilter === "all" || roleFilter === "shared"
        ? roleFilter !== "shared" || u.accountKind === "shared"
        : u.role === roleFilter) &&
      `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase()),
  );
  const manageable = selected && canManageTargetAccount(user, selected);
  const close = () => {
    setPanel(null);
    setConfirm("");
  };
  const issue = async () => {
    if (!selected || !manageable) return;
    let version = 0;
    const kind = selected.setup ? "reset" : "invitation";
    if (
      await mutate((d) => {
        const u = requireManagedAccount(d, user.id, selected.id, venue.id);
        if (!u.active || u.deleted)
          throw Error(
            "비활성 계정은 먼저 활성화한 뒤 비밀번호를 재설정할 수 있습니다.",
          );
        u.credentialVersion++;
        version = u.credentialVersion;
        audit(
          d,
          u.id,
          kind === "reset"
            ? "password_reset_link_issued"
            : "invitation_reissued",
        );
      }, "새 링크를 발급했습니다.")
    ) {
      close();
      setCredential({ userId: selected.id, version, kind });
    }
  };
  const changeState = async () => {
    if (!selected || !manageable) return;
    const operation = confirm;
    if (
      await mutate((d) => {
        const u = requireManagedAccount(d, user.id, selected.id, venue.id);
        if (
          u.active && u.role === "super_admin" &&
          d.users.filter(
            (x) => x.role === "super_admin" && x.active && !x.deleted,
          ).length <= 1
        )
          throw Error(
            "마지막 활성 최고 관리자는 비활성화하거나 삭제할 수 없습니다.",
          );
        if (operation === "delete") {
          if (u.active)
            throw Error("계정을 먼저 비활성화해야 삭제할 수 있습니다.");
          u.deleted = true;
          audit(d, u.id, "deleted");
        } else {
          u.active = !u.active;
          audit(d, u.id, u.active ? "reactivated" : "deactivated");
        }
      }, "변경했습니다.")
    )
      close();
  };
  return (
    <div className="flow-section management-section">
      <div className="flow-filter-stack flow-filter-bar flow-compact-filters">
      <Field
        label="사용자 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="이름 또는 이메일"
      />
      <div className="flow-inline-fields">
        <Select
          label="역할 필터"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="all">{t("전체 역할")}</option>
          {Object.entries(roleLabels)
            .filter(([r]) => isSuper || r !== "super_admin")
            .map(([r, l]) => (
              <option key={r} value={r}>
                {t(l)}
              </option>
            ))}
          <option value="shared">{t("공용 계정")}</option>
        </Select>
        <Select
          label="상태 필터"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {[
            ["current", "현재 계정"],
            ["active", "활성"],
            ["inactive", "비활성"],
            ["deleted", "삭제된 계정"],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {t(l)}
            </option>
          ))}
        </Select>
      </div>
      </div>
      {entries.map((u, index) => (
        <Row
          key={u.id}
          selected={panel === u.id}
          title={u.deleted ? t("삭제된 계정") : u.name}
          heading={index === 0 ? "계정" : undefined}
          columns={[
            { label: "이메일", value: u.deleted ? "—" : u.email, grow: 1.8 },
            { label: "역할", value: u.deleted ? "—" : roleLabels[u.role] },
            { label: "계정 유형", value: u.deleted ? "—" : u.accountKind === "shared" ? "공용 계정" : "개인 계정" },
          ]}
          meta={
            u.deleted
              ? t("삭제됨")
              : `${u.email} · ${t(roleLabels[u.role])} · ${t(u.accountKind === "shared" ? "공용 계정" : "개인 계정")}`
          }
          badge={u.deleted ? "삭제됨" : u.active ? "활성" : "비활성"}
          onClick={() => setPanel(u.id)}
        />
      ))}
      {!entries.length && <Empty />}
      <details className="flow-details">
        <summary>{t("최근 계정 관리 기록")}</summary>
        {data.audit
          .filter(
            (a) => a.venueId === venue.id || (isSuper && a.venueId === null),
          )
          .map((a) => (
            <Row
              key={a.id}
              title={
                data.users.find((u) => u.id === a.userId)?.name ?? "사용자"
              }
              meta={`${auditLabel(a.action)} · ${a.at.slice(11, 16)}`}
            />
          ))}
        {!data.audit.length && (
          <Empty text="기록된 계정 관리 작업이 없습니다." />
        )}
      </details>
      <Action secondary onClick={() => navigate("password-requests")}>
        비밀번호 재설정 요청
      </Action>
      {panel === "create" && (
        <Sheet
          size="wide"
          protectEdits
          title={t("계정 생성")}
          subtitle={venue.name}
          onClose={close}
        >
          <AccountForm
            roles={roles}
            onSubmit={async (form) => {
              const email = string(form, "email").toLowerCase(),
                uid = id();
              let created = false;
              const ok = await mutate((d) => {
                const actor = assertCapability(d, user.id, "admin", venue.id);
                const grant = validateAccountGrant(actor, string(form, "role"), string(form, "kind"), form.has("door"));
                if (d.users.some((u) => u.email === email && !u.deleted))
                  throw Error(
                    "이미 등록된 이메일입니다. 사용자 목록에서 기존 계정의 초대 링크 재발급 또는 비밀번호 재설정을 진행해주세요.",
                  );
                const limit = optionalNumber(form, "limit");
                if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 999))
                  throw Error("게스트 한도는 0 이상의 숫자여야 합니다.");
                d.users.push({
                  id: uid,
                  venueId: venue.id,
                  name: string(form, "name"),
                  email,
                  ...grant,
                  limit,
                  active: true,
                  deleted: false,
                  setup: false,
                  locale:
                    string(form, "locale") === "auto"
                      ? null
                      : (string(form, "locale") as Locale),
                  credentialVersion: 1,
                  createdAt: MOCK_NOW,
                  lastLogin: null,
                });
                audit(d, uid, "created");
                created = true;
              }, "계정 생성 완료");
              if (ok && created) {
                close();
                setCredential({ userId: uid, version: 1, kind: "invitation" });
              }
            }}
          />
        </Sheet>
      )}
      {selected && (
        <Sheet
          key={selected.id}
          presentation={confirm ? "modal" : "detail"}
          size="wide"
          protectEdits
          title={selected.deleted ? t("삭제된 계정") : selected.name}
          subtitle={t(roleLabels[selected.role])}
          onClose={close}
        >
          {!manageable && (
            <Notice>
              현재 로그인한 계정의 역할, 상태, 비밀번호와 삭제는 다른 관리자가
              변경해야 합니다.
            </Notice>
          )}
          {selected.deleted ? (
            <Notice>이미 삭제 처리된 계정입니다.</Notice>
          ) : (
            <>
              <AccountForm
                user={selected}
                roles={
                  !manageable ? [selected.role] : roles
                }
                disabled={!manageable}
                onSubmit={async (form) => {
                  if (!manageable) return;
                  const nextRole = string(form, "role") as Role;
                  if (
                    nextRole !== selected.role &&
                    !canManageTargetRole(user.role, selected.role, nextRole)
                  )
                    return;
                  const ok = await mutate((d) => {
                    const u = requireManagedAccount(d, user.id, selected.id, venue.id);
                    const actor = assertCapability(d, user.id, "admin", venue.id);
                    const grant = validateAccountGrant(actor, nextRole, string(form, "kind"), form.has("door"), u);
                    const limit = optionalNumber(form, "limit");
                    if (
                      limit !== null &&
                      (!Number.isInteger(limit) || limit < 0 || limit > 999)
                    )
                      throw Error("게스트 한도는 0 이상의 숫자여야 합니다.");
                    Object.assign(u, {
                      name: string(form, "name"),
                      ...grant,
                      limit,
                    });
                    audit(d, u.id, "user_updated");
                  }, "변경했습니다.");
                  if (ok) close();
                }}
              />
              <div className="flow-pair">
                <span>{t("생성일")}</span>
                <strong>{selected.createdAt.slice(0, 10)}</strong>
              </div>
              <div className="flow-pair">
                <span>{t("최근 로그인")}</span>
                <strong>
                  {selected.lastLogin?.slice(0, 16) ?? t("기록 없음")}
                </strong>
              </div>
              {confirm ? (
                <>
                  <Confirm
                    title={selected.name}
                    description={
                      confirm === "credential"
                        ? selected.setup
                          ? "현재 비밀번호와 세션은 링크를 사용하기 전까지 유지됩니다. 기존 재설정 링크는 폐기되고 새 링크는 1시간 동안 한 번만 유효합니다."
                          : "기존 초대 링크와 설정 코드는 즉시 사용할 수 없게 되며, 새 링크는 24시간 동안 한 번만 유효합니다."
                        : confirm === "delete"
                          ? "계정을 삭제합니다. 이 작업은 되돌릴 수 없습니다."
                          : "계정을 비활성화하고 현재 세션을 종료합니다."
                    }
                    onCancel={() => setConfirm("")}
                    onConfirm={() =>
                      void (confirm === "credential" ? issue() : changeState())
                    }
                    disabled={!manageable}
                  />
                  {notice && <Notice>{notice}</Notice>}
                </>
              ) : (
                <div className="flow-stack">
                  <Action
                    secondary
                    disabled={!manageable || !selected.active}
                    onClick={() => setConfirm("credential")}
                  >
                    {selected.setup ? "재설정 링크 발급" : "초대 링크 재발급"}
                  </Action>
                  <Action
                    secondary
                    disabled={!manageable}
                    onClick={() => {
                      if (selected.active) setConfirm("toggle");
                      else
                        void mutate((d) => {
                          requireManagedAccount(d, user.id, selected.id, venue.id).active = true;
                          audit(d, selected.id, "reactivated");
                        }, "변경했습니다.");
                    }}
                  >
                    {selected.active ? "비활성화" : "활성화"}
                  </Action>
                  <Action
                    secondary
                    disabled={!manageable || selected.active || busy}
                    onClick={() => setConfirm("delete")}
                  >
                    삭제
                  </Action>
                </div>
              )}
            </>
          )}
        </Sheet>
      )}
      {credential && (
        <Sheet
          title={t(
            credential.kind === "invitation"
              ? "초대 링크"
              : "비밀번호 재설정 링크",
          )}
          onClose={() => setCredential(null)}
        >
          <Notice>
            {credential.kind === "invitation"
              ? "이 링크는 지금만 표시됩니다. 사용자에게 URL 그대로 안전하게 전달하세요."
              : "현재 비밀번호와 세션은 링크를 사용하기 전까지 유지됩니다."}
          </Notice>
          <CopyBox
            value={`http://127.0.0.1:4176/#auth/setup/${credential.userId}/${credential.version}/${credential.kind}`}
            onOpen={() => {
              setAuthPage(
                `setup:${credential.userId}:${credential.version}:${credential.kind}`,
              );
              navigate("auth");
              setCredential(null);
            }}
          />
          <p className="flow-hint">
            {t(
              credential.kind === "invitation"
                ? "24시간 동안 한 번만 사용할 수 있습니다."
                : "1시간 동안 한 번만 사용할 수 있습니다.",
            )}
          </p>
        </Sheet>
      )}
    </div>
  );
}
function AccountForm({
  user,
  roles,
  disabled = false,
  onSubmit,
}: {
  user?: MockUser;
  roles: Role[];
  disabled?: boolean;
  onSubmit: (form: FormData) => Promise<void>;
}) {
  const { t } = useMock();
  const [kind, setKind] = useState(user?.accountKind ?? "personal");
  const [role, setRole] = useState<Role>(user?.role ?? "dj");
  const [doorAccess, setDoorAccess] = useState(Boolean(user?.doorAccess));
  return (
    <Form
      submit={user ? "저장" : "계정 생성 및 초대 링크 발급"}
      onSubmit={onSubmit}
      disabled={disabled}
    >
      <fieldset disabled={disabled} className="flow-fields">
        <Field
          label="이름"
          name="name"
          defaultValue={user?.name ?? ""}
          maxLength={100}
          required
        />
        <Field
          label="이메일 주소"
          name="email"
          type="email"
          defaultValue={user?.email ?? ""}
          required
          readOnly={!!user}
        />
        <Select
          label="계정 유형"
          name="kind"
          value={kind}
          onChange={(e) => {
            const kind = e.target.value as "personal" | "shared";
            setKind(kind);
            if (kind === "shared") setRole("staff");
            else setDoorAccess(false);
          }}
        >
          {accountKinds.map((k) => (
            <option key={k.id} value={k.id} disabled={user?.role === "super_admin" && k.id === "shared"}>
              {t(k.label)}
            </option>
          ))}
        </Select>
        <Select label="역할" name="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {roles.filter((role) => kind !== "shared" || role === "staff").map((role) => (
            <option key={role} value={role}>
              {t(roleLabels[role])}
            </option>
          ))}
        </Select>
        {kind === "shared" && (
          <Toggle
            label="도어 접근"
            name="door"
            checked={doorAccess}
            onChange={(e) => setDoorAccess(e.target.checked)}
          />
        )}
        <Field
          label="게스트 한도"
          name="limit"
          type="number"
          min="0"
          max="999"
          step="1"
          defaultValue={user?.limit ?? ""}
          placeholder="무제한"
        />
        {!user && (
          <Select label="기본 언어" name="locale" defaultValue="auto">
            <option value="auto">{t("자동")}</option>
            <option value="ko">한국어</option>
            <option value="en">English</option>
          </Select>
        )}
        {kind === "shared" && (
          <p className="flow-hint">
            {t("공용 계정은 게스트 등록 시 입력자 이름 필수")}
          </p>
        )}
      </fieldset>
    </Form>
  );
}
function auditLabel(action: string) {
  return (
    (
      {
        created: "계정 생성",
        user_updated: "정보 변경",
        deactivated: "비활성화",
        reactivated: "활성화",
        deleted: "삭제",
        password_reset_link_issued: "재설정 링크 발급",
        invitation_reissued: "초대 링크 재발급",
        password_setup_completed: "계정 설정 완료",
        password_changed: "비밀번호 변경",
        password_reset_request_rejected: "재설정 요청 거절",
        reset_approved: "재설정 승인",
      } as Record<string, string>
    )[action] ?? action
  );
}
export function ResetRequests() {
  const { data, user, venue, isSuper, mutate, t, notice, scenario } = useMock();
  const [selectedId, setSelected] = useState<string | null>(null),
    [reject, setReject] = useState(false),
    [tab, setTab] = useState("pending"),
    [error, setError] = useState("");
  const selected = data.resetRequests.find((r) => r.id === selectedId);
  const target = data.users.find((u) => u.id === selected?.userId);
  const requests = data.resetRequests.filter((r) => {
    const u = data.users.find((u) => u.id === r.userId);
    return (
      u &&
      !u.deleted &&
      (isSuper || u.venueId === venue.id) &&
      (tab === "pending" ? r.state === "pending" : r.state !== "pending")
    );
  });
  return (
    <div className="flow-section management-section">
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "pending", label: "승인 대기" },
          { id: "history", label: "최근 처리 내역" },
        ]}
      />
      {requests.map((r, index) => (
        <Row
          key={r.id}
          selected={selectedId === r.id}
          title={data.users.find((u) => u.id === r.userId)?.name ?? "사용자"}
          heading={index === 0 ? "요청 계정" : undefined}
          columns={[
            { label: "이메일", value: r.email, grow: 1.8 },
            { label: "요청 일시", value: r.createdAt.replace("T", " ").slice(0, 16) },
          ]}
          meta={r.email}
          badge={
            r.state === "pending"
              ? "승인 대기"
              : r.state === "approved"
                ? "승인 완료"
                : r.state === "completed"
                  ? "완료"
                  : "거절됨"
          }
          onClick={() => {
            setSelected(r.id);
            setReject(false);
            setError("");
          }}
        />
      ))}
      {!requests.length && (
        <Empty text="처리 대기 중인 비밀번호 재설정 요청이 없습니다." />
      )}
      {selected && target && (
        <Sheet
          key={selected.id}
          presentation={reject ? "modal" : "detail"}
          protectEdits
          subtitle={venue.name}
          title={`${target.name} · ${t("본인 확인 및 승인")}`}
          onClose={() => setSelected(null)}
        >
          {selected.state !== "pending" ? (
            <Notice>
              {selected.state === "approved"
                ? "비밀번호 재설정을 승인했습니다."
                : "요청을 처리 내역에 기록했습니다."}
            </Notice>
          ) : !canManageTargetAccount(user, target) ? (
            <Notice error>
              현재 로그인한 자기 계정 요청은 다른 관리자가 처리해야 합니다.
            </Notice>
          ) : !target.active ? (
            <Notice error>비활성 계정은 먼저 활성화해야 합니다.</Notice>
          ) : reject ? (
            <>
              <Confirm
                title={target.name}
                description="요청을 처리 내역에 거절로 기록합니다. 계정 비밀번호와 세션은 바뀌지 않습니다."
                onCancel={() => setReject(false)}
                onConfirm={() =>
                  void mutate((d) => {
                    const account = requireManagedAccount(d, user.id, target.id, venue.id);
                    if (!account.active) throw Error("비활성 계정은 먼저 활성화해야 합니다.");
                    const request = d.resetRequests.find((r) => r.id === selected.id && r.userId === target.id);
                    if (!request || request.state !== "pending")
                      throw Error("이 요청은 이미 다른 관리자가 처리했습니다.");
                    request.state = "rejected";
                    audit(d, target.id, "password_reset_request_rejected");
                  }, "비밀번호 재설정 요청을 거절했습니다.").then((ok) => {
                    if (ok) setSelected(null);
                  })
                }
              />
              {notice && <Notice>{notice}</Notice>}
            </>
          ) : (
            <>
              {error && <Notice error>{error}</Notice>}
              <Form
                submit="재설정 승인"
                onSubmit={async (form) => {
                  if (string(form, "challenge") !== selected.challenge) {
                    setError(
                      "사용자가 알려준 4자리 요청 확인번호가 이 요청과 일치하지 않습니다.",
                    );
                    return;
                  }
                  if (!form.has("attested")) return;
                  const ok = await mutate((d) => {
                    const account = requireManagedAccount(d, user.id, target.id, venue.id);
                    if (!account.active) throw Error("비활성 계정은 먼저 활성화해야 합니다.");
                    const r = d.resetRequests.find(
                      (r) => r.id === selected.id && r.userId === target.id,
                    );
                    if (!r || r.state !== "pending")
                      throw Error("이 요청은 이미 다른 관리자가 처리했습니다.");
                    if (!form.has("attested") || r.challenge !== string(form, "challenge"))
                      throw Error("사용자가 알려준 4자리 요청 확인번호가 이 요청과 일치하지 않습니다.");
                    if (scenario === "credential-expired")
                      throw Error(
                        "요청이 만료되었습니다. 사용자에게 재설정을 다시 요청하도록 안내해주세요.",
                      );
                    const u = d.users.find((u) => u.id === target.id)!;
                    u.credentialVersion++;
                    r.version = u.credentialVersion;
                    r.state = "approved";
                    r.method = "direct";
                    r.verification = string(form, "method");
                    audit(d, target.id, "reset_approved");
                  }, "비밀번호 재설정을 승인했습니다.");
                  if (ok) setSelected(null);
                }}
              >
                <Select label="본인 확인 방법" name="method" required>
                  <option value="">{t("선택")}</option>
                  {[
                    ["in_person", "대면 확인"],
                    ["phone", "기존 등록 전화번호"],
                    ["messenger", "기존 조직 메신저"],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {t(l)}
                    </option>
                  ))}
                </Select>
                <Field
                  label="사용자가 알려준 4자리 요청 확인번호"
                  name="challenge"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  required
                  autoComplete="off"
                />
                <label className="flow-check">
                  <input type="checkbox" name="attested" required />
                  <span>
                    {t(
                      "요청 전에 확인된 연락처로 먼저 연락해 본인 확인을 마쳤습니다.",
                    )}
                  </span>
                </label>
              </Form>
              <Action secondary onClick={() => setReject(true)}>
                거절
              </Action>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
