import { S3Client, GetObjectCommand, NoSuchKey, S3ServiceException } from "@aws-sdk/client-s3";

export async function GetS3FileAsByteArrayAsync(bucketName: string, key: string): Promise<Uint8Array | undefined> {
  const client = new S3Client({});

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
    // The Body object also has 'transformToByteArray' and 'transformToWebStream' methods.
    const bytes = await response.Body?.transformToByteArray();
    return bytes;
  } catch (caught) {
    if (caught instanceof NoSuchKey) {
      console.error(
        `Error from S3 while getting object "${key}" from "${bucketName}". No such key exists.`
      );
    } else if (caught instanceof S3ServiceException) {
      console.error(
        `Error from S3 while getting object from ${bucketName}.  ${caught.name}: ${caught.message}`
      );
    } else {
      throw caught;
    }
  }
}
;
