import { useState } from "react";
import { useMock, audit, id } from "../data/MockData";
import { MOCK_NOW, roleLabels, type Locale } from "../data/types";
import {
  Action,
  Field,
  Form,
  Notice,
  Select,
  Toggle,
  Tabs,
  CopyBox,
  Metrics,
  string,
} from "../shared/ui";
export const DEMO_PASSWORD = "DemoPass123";
export function passwordError(password: string, confirmation: string) {
  if (password !== confirmation) return "비밀번호가 일치하지 않습니다.";
  if (password.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
  if (!/[a-z]/i.test(password) || !/[0-9]/.test(password))
    return "비밀번호에 영문과 숫자를 모두 포함해야 합니다.";
  return null;
}
export function AuthViews() {
  const {
    data,
    authPage,
    setAuthPage,
    receiptId,
    setReceiptId,
    mutate,
    chooseUser,
    navigate,
    notify,
    scenario,
    setScenario,
    t,
    venue,
  } = useMock();
  const page = authPage.split(":")[0];
  const receipt = data.resetRequests.find((r) => r.receiptId === receiptId);
  const [error, setError] = useState("");
  const go = (page: string) => {
    setError("");
    notify("");
    setAuthPage(page);
  };
  const targetId = authPage.split(":")[1],
    version = authPage.split(":")[2],
    kind = authPage.split(":")[3];
  const target = data.users.find((u) => u.id === targetId);
  const invalidSetup =
    page === "setup" &&
    (!target ||
      !target.active ||
      target.deleted ||
      Number(version) !== target.credentialVersion ||
      (kind === "invitation" && target.setup) ||
      scenario === "credential-expired");
  const submitPassword = async (form: FormData) => {
    const password = string(form, "password");
    const message = passwordError(password, string(form, "confirmation"));
    if (message) {
      setError(message);
      return;
    }
    if (!target || invalidSetup) return;
    const ok = await mutate((d) => {
      const user = d.users.find((u) => u.id === target.id)!;
      user.password = password;
      user.setup = true;
      user.credentialVersion++;
      d.resetRequests
        .filter((r) => r.userId === user.id && r.state === "approved")
        .forEach((r) => (r.state = "completed"));
      audit(d, user.id, "password_setup_completed");
    }, "비밀번호가 변경되었습니다.");
    if (ok) {
      if (!target.setup && scenario !== "partial-error") chooseUser(target.id);
      else {
        go("done");
        if (scenario === "partial-error")
          notify(
            "비밀번호는 설정되었지만 자동 로그인에 실패했습니다. 새 비밀번호로 다시 로그인하세요.",
          );
      }
    }
  };
  return (
    <div className="flow-auth">
      <div className="flow-auth-brand">{venue.brandName || venue.name}</div>
      <h1>
        {t(
          page === "login"
            ? "로그인"
            : page === "reset"
              ? "비밀번호 재설정 요청"
              : page === "pending"
                ? "관리자 확인"
                : page === "code"
                  ? "설정 코드로 비밀번호 만들기"
                  : page === "register"
                    ? "회원가입이 종료되었습니다"
                    : page === "done"
                      ? "비밀번호가 변경되었습니다."
                      : "계정 설정",
        )}
      </h1>
      {error && <Notice error>{error}</Notice>}
      {page === "login" && (
        <>
          <Form
            submit="로그인"
            onSubmit={async (form) => {
              const email = string(form, "email").toLowerCase(),
                password = string(form, "password");
              const user = data.users.find(
                (u) => u.email.toLowerCase() === email && !u.deleted,
              );
              if (
                user &&
                user.active &&
                !user.deleted &&
                !user.setup &&
                password === `MOCK-${user.id.toUpperCase()}` &&
                scenario !== "credential-expired"
              ) {
                go(`setup:${user.id}:${user.credentialVersion}:code`);
                return;
              }
              if (
                !user ||
                !user.active ||
                (user.venueId &&
                  !data.venues.find((v) => v.id === user.venueId)?.active) ||
                password !== (user.password ?? DEMO_PASSWORD)
              ) {
                setError("이메일 또는 비밀번호가 올바르지 않습니다.");
                return;
              }
              if (!user.setup) {
                go("code");
                return;
              }
              const ok = await mutate((d) => {
                const current = d.users.find((u) => u.id === user.id)!;
                current.lastLogin = MOCK_NOW;
                current.keepSignedIn = form.has("keep");
              }, "");
              if (ok) chooseUser(user.id);
            }}
          >
            <Field
              label="이메일 주소"
              name="email"
              type="email"
              required
              autoComplete="username"
              defaultValue="sora@example.com"
            />
            <Field
              label="비밀번호"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
            <Toggle label="로그인 유지" name="keep" defaultChecked />
          </Form>
          <div className="flow-stack">
            {receiptId && (
              <Action secondary onClick={() => go("pending")}>
                진행 중인 재설정 요청
              </Action>
            )}
            <Action secondary onClick={() => go("reset")}>
              비밀번호를 잊으셨나요?
            </Action>
            <Action secondary onClick={() => go("code")}>
              설정 코드로 비밀번호 만들기
            </Action>
            <Action secondary onClick={() => go("register")}>
              계정 생성
            </Action>
          </div>
          <details className="flow-details">
            <summary>{t("예시 계정")}</summary>
            <p className="flow-hint">sora@example.com · {DEMO_PASSWORD}</p>
          </details>
        </>
      )}
      {page === "register" && (
        <>
          <Notice>
            계정은 관리자를 통해서만 생성할 수 있습니다. 계정이 필요하면 베뉴
            관리자에게 문의하세요.
          </Notice>
          <Action onClick={() => go("login")}>로그인으로 이동</Action>
        </>
      )}
      {page === "reset" && (
        <>
          <Notice>
            이메일로 요청하면 관리자가 본인 확인 후 재설정을 도와드립니다.
          </Notice>
          <Form
            submit="관리자에게 재설정 요청"
            onSubmit={async (form) => {
              const email = string(form, "email").toLowerCase();
              const rid = id();
              let receipt = rid;
              const ok = await mutate((d) => {
                const existing = d.resetRequests.find(
                  (r) => r.email === email && r.state === "pending",
                );
                if (existing) {
                  receipt = existing.receiptId;
                  return;
                }
                const user = d.users.find(
                  (u) => u.email === email && !u.deleted,
                );
                d.resetRequests.push({
                  id: id(),
                  userId: user?.id ?? "",
                  email,
                  challenge: String(Math.floor(1000 + Math.random() * 9000)),
                  state: "pending",
                  method: null,
                  verification: "",
                  createdAt: MOCK_NOW,
                  receiptId: rid,
                });
              }, "비밀번호 재설정 요청을 접수했습니다.");
              if (ok) {
                setReceiptId(receipt);
                go("pending");
              }
            }}
          >
            <Field
              label="이메일 주소"
              name="email"
              type="email"
              required
              defaultValue="milo@example.com"
            />
            <p className="flow-hint">
              {t("응답에는 이메일 등록 여부를 표시하지 않습니다.")}
            </p>
          </Form>
          <Action secondary disabled>
            이메일로 재설정 — 사용 안 함
          </Action>
          <Notice>
            현재 이메일 방식은 사용할 수 없습니다. 아래 관리자 요청을
            이용해주세요.
          </Notice>
          <Action secondary onClick={() => go("login")}>
            로그인으로 돌아가기
          </Action>
        </>
      )}
      {page === "pending" && (
        <>
          <Notice>비밀번호 재설정 요청을 접수했습니다.</Notice>
          <p className="flow-hint">
            {t("관리자가 기존 연락처나 대면으로 연락할 때까지 기다리세요.")}
          </p>
          <div className="flow-result-code">
            {receipt?.challenge ?? "— — — —"}
          </div>
          <p className="flow-hint">
            {t("먼저 연락한 관리자에게만 4자리 확인번호를 알려주세요.")}
          </p>
          <p className="flow-hint">
            {t(
              "24시간 안에 같은 브라우저로 돌아오세요. 승인 확인 후 최대 15분 동안 비밀번호를 설정할 수 있습니다.",
            )}
          </p>
          <CopyBox label="확인번호 복사" value={receipt?.challenge ?? ""} />
          <Action
            onClick={() => {
              if (scenario === "credential-expired") {
                setError(
                  "비밀번호 설정 시간이 만료되었습니다. 다시 요청해주세요.",
                );
                return;
              }
              if (
                receipt?.state === "approved" &&
                receipt.method === "direct"
              ) {
                const u = data.users.find((u) => u.id === receipt.userId)!;
                go(
                  `setup:${u.id}:${receipt.version ?? u.credentialVersion}:approved`,
                );
              } else
                setError(
                  "코드 없는 승인이 아직 없거나 만료되었습니다. 관리자의 처리를 확인하거나 전달받은 설정 코드를 사용해주세요.",
                );
            }}
          >
            승인 상태 확인
          </Action>
          <Action secondary onClick={() => go("code")}>
            관리자에게 설정 코드를 받았어요
          </Action>
          <Action secondary onClick={() => go("reset")}>
            다른 이메일로 다시 요청
          </Action>
        </>
      )}
      {page === "code" && (
        <>
          <Form
            submit="계속"
            onSubmit={(form) => {
              const u = data.users.find(
                (u) =>
                  u.email === string(form, "email").toLowerCase() &&
                  !u.deleted &&
                  u.active,
              );
              if (
                !u ||
                string(form, "code") !== `MOCK-${u.id.toUpperCase()}` ||
                scenario === "credential-expired"
              ) {
                setError(
                  "설정 코드가 올바르지 않거나 최초 설정 대상 계정이 아닙니다. 관리자에게 문의하세요.",
                );
                return;
              }
              if (
                u.setup &&
                !data.resetRequests.some(
                  (r) =>
                    r.userId === u.id &&
                    r.state === "approved" &&
                    r.method === "code",
                )
              ) {
                setError(
                  "설정 코드가 올바르지 않거나 최초 설정 대상 계정이 아닙니다. 관리자에게 문의하세요.",
                );
                return;
              }
              go(`setup:${u.id}:${u.credentialVersion}:code`);
            }}
          >
            <Field
              label="이메일 주소"
              name="email"
              type="email"
              required
              defaultValue="invited@example.com"
            />
            <Field
              label="1회용 설정 코드"
              name="code"
              required
              autoComplete="off"
            />
            <p className="flow-hint">
              {t("관리자에게 받은 15분짜리 코드를 입력하세요.")}
            </p>
          </Form>
          <Action secondary onClick={() => go("login")}>
            로그인으로 돌아가기
          </Action>
        </>
      )}
      {page === "setup" &&
        (invalidSetup ? (
          <>
            <Notice error>
              계정 설정 또는 재설정 링크 형식이 올바르지 않습니다. 관리자에게 새
              링크를 요청해주세요.
            </Notice>
            <Action
              onClick={() => {
                setScenario("normal");
                go("reset");
              }}
            >
              관리자에게 재설정 요청
            </Action>
          </>
        ) : (
          <>
            <Notice>
              {kind === "approved"
                ? "승인되었습니다. 이 브라우저에서 15분 안에 한 번만 사용할 수 있습니다."
                : "로그인에 사용할 새 비밀번호를 만드세요."}
            </Notice>
            <Form
              submit={
                target?.setup ? "비밀번호 변경" : "비밀번호 설정 후 로그인"
              }
              onSubmit={submitPassword}
            >
              <Field label="이메일 주소" value={target?.email ?? ""} readOnly />
              <Field
                label="새 비밀번호"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
              <Field
                label="비밀번호 확인"
                name="confirmation"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
              <p className="flow-hint">
                {t("영문과 숫자를 포함하여 8자 이상 입력하세요.")}
              </p>
            </Form>
          </>
        ))}
      {page === "done" && (
        <>
          <Notice>새 비밀번호로 다시 로그인해주세요.</Notice>
          <Action onClick={() => go("login")}>로그인으로 돌아가기</Action>
        </>
      )}
      {!["login", "done", "register"].includes(page) && (
        <button
          className="text-button"
          onClick={() => {
            go("login");
            navigate("auth");
          }}
        >
          {t("로그인으로 돌아가기")}
        </button>
      )}
    </div>
  );
}
export function ProfileView() {
  const {
    user,
    data,
    mutate,
    locale,
    setLocale,
    setAuthPage,
    navigate,
    t,
    operator,
    setOperator,
    notify,
  } = useMock();
  const [tab, setTab] = useState("profile");
  const [error, setError] = useState("");
  return (
    <div className="flow-section">
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "profile", label: "기본 정보" },
          { id: "security", label: "보안" },
        ]}
      />
      {tab === "profile" ? (
        <>
          <Metrics
            items={[
              { label: "역할", value: roleLabels[user.role] },
              { label: "게스트 한도", value: user.limit ?? "무제한" },
            ]}
          />
          <Form
            onSubmit={async (form) => {
              const name = string(form, "name"),
                language = string(form, "locale") as Locale;
              if (!name) return;
              const ok = await mutate((d) => {
                const u = d.users.find((u) => u.id === user.id)!;
                u.name = name;
                u.locale = language;
                audit(d, u.id, "user_updated");
              }, "프로필이 변경되었습니다.");
              if (ok) setLocale(language);
            }}
          >
            <Field
              label="이름"
              name="name"
              required
              maxLength={100}
              defaultValue={user.name}
            />
            <Field label="이메일 주소" readOnly value={user.email} />
            <Select label="기본 언어" name="locale" defaultValue={locale}>
              <option value="ko">한국어</option>
              <option value="en">English</option>
            </Select>
            {user.accountKind === "shared" && (
              <Field
                label="현재 입력자"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                placeholder="본인 이름 입력"
              />
            )}
          </Form>
        </>
      ) : (
        <>
          <Notice>
            비밀번호를 변경하면 로그아웃됩니다. 새 비밀번호로 다시
            로그인해주세요.
          </Notice>
          {error && <Notice error>{error}</Notice>}
          <Form
            submit="비밀번호 변경"
            onSubmit={async (form) => {
              const current = string(form, "current"),
                password = string(form, "password");
              if (
                current !==
                (data.users.find((u) => u.id === user.id)?.password ??
                  DEMO_PASSWORD)
              ) {
                setError("현재 비밀번호가 올바르지 않습니다.");
                return;
              }
              const message = passwordError(
                password,
                string(form, "confirmation"),
              );
              if (message) {
                setError(message);
                return;
              }
              if (
                await mutate((d) => {
                  const u = d.users.find((u) => u.id === user.id)!;
                  u.password = password;
                  u.credentialVersion++;
                  audit(d, u.id, "password_changed");
                }, "비밀번호가 변경되었습니다.")
              ) {
                setAuthPage("login");
                navigate("auth");
                notify("비밀번호가 변경되었습니다.");
              }
            }}
          >
            <Field
              label="현재 비밀번호"
              name="current"
              type="password"
              required
            />
            <Field
              label="새 비밀번호"
              name="password"
              type="password"
              required
              minLength={8}
            />
            <Field
              label="새 비밀번호 확인"
              name="confirmation"
              type="password"
              required
              minLength={8}
            />
          </Form>
        </>
      )}
      <button
        className="text-button"
        onClick={() => {
          setAuthPage("login");
          navigate("auth");
        }}
      >
        {t("로그아웃")}
      </button>
    </div>
  );
}
