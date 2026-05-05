import { AwsClient } from 'aws4fetch';

/**
 * AWS SES API v2를 사용하여 이메일을 발송하는 유틸리티
 */

// 환경 변수 검증 (런타임 에러 방지용)
const checkEnv = () => {
  const required = ['AWS_SES_ACCESS_KEY', 'AWS_SES_SECRET_KEY', 'AWS_SES_REGION', 'AWS_SES_FROM_EMAIL'];
  for (const key of required) {
    if (!process.env[key]) {
      console.warn(`[SES] Missing environment variable: ${key}`);
    }
  }
};

const client = new AwsClient({
  accessKeyId: process.env.AWS_SES_ACCESS_KEY || '',
  secretAccessKey: process.env.AWS_SES_SECRET_KEY || '',
  region: process.env.AWS_SES_REGION || 'ap-northeast-2',
});

interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
}

/**
 * 이메일을 발송함
 * @param {SendEmailParams} params - 발송 정보
 * @returns {Promise<unknown>} SES API 응답
 */
export async function sendEmail({ to, subject, body }: SendEmailParams) {
  checkEnv();

  const region = process.env.AWS_SES_REGION || 'ap-northeast-2';
  const url = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;

  try {
    const response = await client.fetch(url, {
      method: 'POST',
      body: JSON.stringify({
        FromEmailAddress: process.env.AWS_SES_FROM_EMAIL,
        Destination: {
          ToAddresses: [to],
        },
        Content: {
          Simple: {
            Subject: {
              Data: subject,
              Charset: 'UTF-8',
            },
            Body: {
              Html: {
                Data: body,
                Charset: 'UTF-8',
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SES] Failed to send email:', errorText);
      throw new Error(`SES Email Error: ${response.status} ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[SES] Email sending exception:', error);
    throw error;
  }
}
