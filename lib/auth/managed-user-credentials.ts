import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { isLocale, type Locale } from "@/i18n/config";
import { getDb } from "../db/client";
import { passwordResetTokens, users } from "../db/schema";
import { escapeHtml, isEmailConfigured, sendEmail } from "../email/service";
import { getVenueDeliveryContext } from "../tenant/server";
import type {
  ManagedPasswordLinkResult,
  User,
} from "../users/types";
import { hashPassword } from "./password";
import {
  buildPasswordLinkUrl,
  getPasswordLinkExpiry,
  type OneTimePasswordLink,
  type PasswordLinkPurpose,
} from "./password-link";
import {
  ACTIVATE_MANAGED_PASSWORD_LINK_SQL,
  CANCEL_MANAGED_PASSWORD_RESET_REQUESTS_SQL,
  INSERT_MANAGED_PASSWORD_LINK_AUDIT_SQL,
  INVALIDATE_OTHER_MANAGED_PASSWORD_LINKS_SQL,
} from "./password-link-lifecycle-sql";
import { generateResetToken, hashResetToken } from "./token";

export type ManagedUserCredentialErrorCode =
  | "UPDATE_FAILED"
  | "USER_INACTIVE"
  | "USER_NOT_FOUND";

export class ManagedUserCredentialError extends Error {
  readonly code: ManagedUserCredentialErrorCode;

  constructor(code: ManagedUserCredentialErrorCode) {
    super(code);
    this.code = code;
    this.name = "ManagedUserCredentialError";
  }
}

interface ManagedCredentialActor {
  id: string;
  sessionVersion: number;
}

async function preparePasswordLink(params: {
  venueId: string | null;
  preferredLocale: Locale | null;
  purpose: PasswordLinkPurpose;
  expiresAt?: string;
}): Promise<OneTimePasswordLink & { id: string; tokenHash: string }> {
  const token = generateResetToken();
  const [tokenHash, delivery] = await Promise.all([
    hashResetToken(token),
    getVenueDeliveryContext(params.venueId),
  ]);
  const locale = params.preferredLocale ?? delivery.defaultLocale;
  return {
    id: crypto.randomUUID(),
    tokenHash,
    expiresAt: params.expiresAt ?? getPasswordLinkExpiry(params.purpose),
    url: buildPasswordLinkUrl({
      baseUrl: delivery.baseUrl,
      token,
      locale,
    }),
  };
}

export async function prepareAccountInvitationCredential(input: {
  venueId: string;
  preferredLocale: Locale | null;
}) {
  const [passwordHash, invitation] = await Promise.all([
    hashPassword(generateResetToken()),
    preparePasswordLink({
      venueId: input.venueId,
      preferredLocale: input.preferredLocale,
      purpose: "account_invitation",
    }),
  ]);
  return { passwordHash, invitation };
}

export async function createDeletedUserPasswordHash(): Promise<string> {
  return hashPassword(crypto.randomUUID());
}

export async function issueManagedPasswordLinkCredential(input: {
  actor: ManagedCredentialActor;
  target: User;
}): Promise<ManagedPasswordLinkResult> {
  if (!input.target.active) {
    throw new ManagedUserCredentialError("USER_INACTIVE");
  }

  let passwordLinkTokenId: string | null = null;
  try {
    const { env } = getCloudflareContext();
    const db = getDb();
    const [credentialSnapshot] = await db
      .select({
        passwordHash: users.passwordHash,
        sessionVersion: users.sessionVersion,
      })
      .from(users)
      .where(eq(users.id, input.target.id))
      .limit(1);
    if (!credentialSnapshot) {
      throw new ManagedUserCredentialError("USER_NOT_FOUND");
    }

    const isInitialSetup =
      input.target.migrationStatus === "pending_reset" &&
      !input.target.passwordSetAt;
    const purpose: PasswordLinkPurpose = isInitialSetup
      ? "account_invitation"
      : "password_reset";
    const passwordLink = await preparePasswordLink({
      venueId: input.target.venueId,
      preferredLocale: input.target.preferredLocale,
      purpose,
    });
    passwordLinkTokenId = passwordLink.id;
    const nowIso = new Date().toISOString();
    const auditEventId = crypto.randomUUID();
    const auditAction = isInitialSetup
      ? "invitation_reissued"
      : "password_reset_link_issued";
    const setupMethod = isInitialSetup
      ? "invitation_link"
      : "password_reset_link";

    // The new token remains inert until both actor and target snapshots match.
    await db.insert(passwordResetTokens).values({
      id: passwordLink.id,
      userId: input.target.id,
      token: passwordLink.tokenHash,
      expiresAt: passwordLink.expiresAt,
      used: true,
      createdAt: nowIso,
    });
    const [, activatedTokenResult, auditResult] = await env.DB.batch<{
      user_id?: string;
      target_user_id?: string;
    }>([
      env.DB.prepare(INVALIDATE_OTHER_MANAGED_PASSWORD_LINKS_SQL).bind(
        input.target.id,
        passwordLink.id,
        input.target.id,
        credentialSnapshot.passwordHash,
        credentialSnapshot.sessionVersion,
        input.target.id,
        input.actor.id,
        input.actor.sessionVersion,
      ),
      env.DB.prepare(ACTIVATE_MANAGED_PASSWORD_LINK_SQL).bind(
        passwordLink.id,
        input.target.id,
        nowIso,
        input.target.id,
        credentialSnapshot.passwordHash,
        credentialSnapshot.sessionVersion,
        input.target.id,
        input.actor.id,
        input.actor.sessionVersion,
      ),
      env.DB.prepare(INSERT_MANAGED_PASSWORD_LINK_AUDIT_SQL).bind(
        auditEventId,
        input.actor.id,
        auditAction,
        JSON.stringify({
          setupMethod,
          linkExpiresAt: passwordLink.expiresAt,
        }),
        nowIso,
        input.target.id,
        passwordLink.id,
        nowIso,
      ),
      env.DB.prepare(CANCEL_MANAGED_PASSWORD_RESET_REQUESTS_SQL).bind(
        nowIso,
        input.target.id,
        auditEventId,
      ),
    ]);

    const activatedUserId = (
      activatedTokenResult.results?.[0] as { user_id?: string } | undefined
    )?.user_id;
    const auditedUserId = (
      auditResult.results?.[0] as { target_user_id?: string } | undefined
    )?.target_user_id;
    if (
      activatedUserId !== input.target.id ||
      auditedUserId !== input.target.id
    ) {
      throw new ManagedUserCredentialError("UPDATE_FAILED");
    }

    return {
      linkKind: isInitialSetup ? "invitation" : "password_reset",
      passwordUrl: passwordLink.url,
      expiresAt: passwordLink.expiresAt,
    };
  } catch (error) {
    if (passwordLinkTokenId) {
      try {
        await getDb()
          .delete(passwordResetTokens)
          .where(eq(passwordResetTokens.id, passwordLinkTokenId));
      } catch {
        // A leftover inert token does not grant credential access.
      }
    }
    throw error;
  }
}

export type ManagedInvitationResendResult = "sent" | "email_unavailable";

export async function resendManagedInvitationCredential(input: {
  target: User;
}): Promise<ManagedInvitationResendResult> {
  if (!input.target.active) {
    throw new ManagedUserCredentialError("USER_INACTIVE");
  }
  const { env } = getCloudflareContext();
  if (!isEmailConfigured(env)) return "email_unavailable";

  const db = getDb();
  const token = generateResetToken();
  const tokenHash = await hashResetToken(token);
  const resetTokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  await db.insert(passwordResetTokens).values({
    id: resetTokenId,
    userId: input.target.id,
    token: tokenHash,
    expiresAt,
    used: true,
    createdAt: new Date().toISOString(),
  });

  const delivery = await getVenueDeliveryContext(
    input.target.venueId,
    env.NEXT_PUBLIC_APP_URL,
  );
  const emailLocale = isLocale(input.target.preferredLocale)
    ? input.target.preferredLocale
    : delivery.defaultLocale;
  const t = await getTranslations({ locale: emailLocale, namespace: "Email" });
  const resetLink = buildPasswordLinkUrl({
    baseUrl: delivery.baseUrl,
    token,
    locale: emailLocale,
  });
  const safeResetLink = escapeHtml(resetLink);

  try {
    await sendEmail({
      to: input.target.email,
      subject: t("inviteSubject", { brand: delivery.brand.name }),
      body: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>${escapeHtml(t("inviteHeading"))}</h2>
          <p>${escapeHtml(t("greeting", { name: input.target.name }))}</p>
          <p>${escapeHtml(t("inviteInstructions"))}</p>
          <div style="margin: 30px 0;">
            <a href="${safeResetLink}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px;">${escapeHtml(t("setPasswordButton"))}</a>
          </div>
          <p>${escapeHtml(t("inviteExpiry"))}</p>
          <p style="color: #666; font-size: 12px; margin-top: 40px;">${escapeHtml(t("noReply"))}</p>
        </div>
        `,
    });
  } catch (error) {
    await db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.id, resetTokenId));
    throw error;
  }

  // Delivery succeeds before the new token becomes the sole active link.
  await db.batch([
    db
      .update(passwordResetTokens)
      .set({ used: true })
      .where(eq(passwordResetTokens.userId, input.target.id)),
    db
      .update(passwordResetTokens)
      .set({ used: false })
      .where(eq(passwordResetTokens.id, resetTokenId)),
  ]);
  return "sent";
}
