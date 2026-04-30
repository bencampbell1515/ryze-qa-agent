/**
 * Optional Google Drive uploader stub.
 * Implement this if you want to auto-convert the .docx to a Google Doc.
 * Requires googleapis npm and OAuth setup.
 */
export async function uploadToGoogleDrive(
  _docxPath: string,
): Promise<{ url: string } | null> {
  console.warn('Google Drive upload not configured. Skipping.');
  return null;
}
