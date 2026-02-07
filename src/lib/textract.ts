import {
  TextractClient,
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand,
} from '@aws-sdk/client-textract';

const region = process.env.AWS_REGION!;
const bucket = process.env.S3_BUCKET!;
if (!region) throw new Error('Missing AWS_REGION');
if (!bucket) throw new Error('Missing S3_BUCKET');

export const textract = new TextractClient({ region });

export async function startOcrJob(s3Key: string) {
  const res = await textract.send(
    new StartDocumentTextDetectionCommand({
      DocumentLocation: { S3Object: { Bucket: bucket, Name: s3Key } },
    }),
  );
  if (!res.JobId) throw new Error('Textract did not return JobId');
  return res.JobId;
}

export async function getOcrText(jobId: string) {
  let nextToken: string | undefined;
  let status: string | undefined;
  const lines: string[] = [];

  do {
    const res = await textract.send(
      new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: nextToken }),
    );
    status = res.JobStatus;
    nextToken = res.NextToken;

    for (const b of res.Blocks || []) {
      if (b.BlockType === 'LINE' && b.Text) lines.push(b.Text);
    }
  } while (nextToken);

  return { status, text: lines.join('\n') };
}
