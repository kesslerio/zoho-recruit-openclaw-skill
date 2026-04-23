import {
  firstQueryValue,
  json,
  requireSecret
} from "../../../_lib.js";
import {
  downloadAttachmentContent,
  getCandidateResumeArtifacts,
  sendApiError
} from "../../_shared.js";

export default async function handler(req, res) {
  if (!requireSecret(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  try {
    const candidateId = firstQueryValue(req.query.candidateId, null);
    const applicationId = firstQueryValue(req.query.applicationId, null);
    const attachmentId = firstQueryValue(req.query.attachmentId, null);

    if (!candidateId) {
      return json(res, 400, { ok: false, error: { type: "validation", message: "Missing candidateId" } });
    }

    const artifacts = await getCandidateResumeArtifacts(candidateId, applicationId);
    const attachment = attachmentId
      ? artifacts.attachments.find((item) => item.id && String(item.id) === String(attachmentId)) || null
      : artifacts.primaryResume || null;

    if (!attachment?.id || !attachment.sourceModule || !attachment.sourceRecordId) {
      return json(res, 404, {
        ok: false,
        error: {
          type: "not_found",
          message: attachmentId ? "Attachment not found" : "No resume attachment available"
        }
      });
    }

    const content = await downloadAttachmentContent({
      moduleApiName: attachment.sourceModule,
      recordId: attachment.sourceRecordId,
      attachmentId: attachment.id
    });

    return json(res, 200, {
      ok: true,
      candidateId,
      applicationId,
      attachment,
      contentType: content.contentType,
      contentDisposition: content.contentDisposition,
      contentBase64: content.buffer.toString("base64"),
      byteLength: content.buffer.length,
      recruitBase: content.recruitBase
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}
