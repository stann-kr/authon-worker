import { AwsClient } from "aws4fetch";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { reportServerError } from "@/lib/observability/structured-log";

interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
}

type EmailEnvironment = Pick<
  CloudflareEnv,
  | "AWS_SES_ACCESS_KEY"
  | "AWS_SES_SECRET_KEY"
  | "AWS_SES_FROM_EMAIL"
>;

export function isEmailConfigured(env: EmailEnvironment): boolean {
  return Boolean(
    env.AWS_SES_ACCESS_KEY &&
      env.AWS_SES_SECRET_KEY &&
      env.AWS_SES_FROM_EMAIL,
  );
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

export async function sendEmail({
  to,
  subject,
  body,
}: SendEmailParams): Promise<unknown> {
  const { env } = getCloudflareContext();
  const accessKeyId = env.AWS_SES_ACCESS_KEY;
  const secretAccessKey = env.AWS_SES_SECRET_KEY;
  const region = env.AWS_SES_REGION ?? "ap-northeast-2";
  const fromEmail = env.AWS_SES_FROM_EMAIL;

  if (!isEmailConfigured(env) || !accessKeyId || !secretAccessKey || !fromEmail) {
    throw new Error("[SES] AWS credentials or FROM_EMAIL are not configured");
  }

  const client = new AwsClient({ accessKeyId, secretAccessKey, region });
  const url = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  try {
    const response = await client.fetch(url, {
      method: "POST",
      body: JSON.stringify({
        FromEmailAddress: fromEmail,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: { Html: { Data: body, Charset: "UTF-8" } },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SES Email Error: ${response.status} ${errorText}`);
    }
    return await response.json();
  } catch (error) {
    await reportServerError("email.send", error);
    throw error;
  }
}
