import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const region = process.env.AWS_REGION;
const bucket = process.env.S3_BUCKET;
const prefix = (process.env.S3_PREFIX || 'uploads').replace(/\/+$/, '');

if (!region) throw new Error('Missing AWS_REGION env var');
if (!bucket) throw new Error('Missing S3_BUCKET env var');

export const s3 = new S3Client({ region });

export function buildS3Key(documentId: number, filename: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ts = Date.now();
  return `${prefix}/${documentId}/${ts}-${safe}`;
}

export async function putFileToS3(opts: {
  key: string;
  body: Buffer;
  contentType: string;
}) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
    }),
  );
}

/**
 * Signed URL for GET Object (download OR inline preview depending on params)
 */
export async function getSignedObjectUrl(opts: {
  key: string;
  expiresInSeconds?: number; // default 900 (15m)
  inline?: boolean; // true = preview in browser
  responseContentType?: string; // e.g. application/pdf
  filename?: string; // suggested filename
}) {
  const disposition = opts.inline
    ? `inline${opts.filename ? `; filename="${opts.filename}"` : ''}`
    : `attachment${opts.filename ? `; filename="${opts.filename}"` : ''}`;

  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: opts.key,
    ResponseContentDisposition: disposition,
    ...(opts.responseContentType ? { ResponseContentType: opts.responseContentType } : {}),
  });

  return getSignedUrl(s3, cmd, { expiresIn: opts.expiresInSeconds ?? 900 });
}

/**
 * Convenience: signed download URL (attachment)
 */
export async function getSignedDownloadUrl(key: string, expiresInSeconds = 900) {
  return getSignedObjectUrl({ key, expiresInSeconds, inline: false });
}

/**
 * Convenience: signed preview URL (inline)
 */
export async function getSignedPreviewUrl(opts: {
  key: string;
  filename?: string;
  responseContentType?: string;
  expiresInSeconds?: number;
}) {
  return getSignedObjectUrl({
    key: opts.key,
    inline: true,
    filename: opts.filename,
    responseContentType: opts.responseContentType,
    expiresInSeconds: opts.expiresInSeconds ?? 900,
  });
}
