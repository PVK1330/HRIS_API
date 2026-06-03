'use strict';

function getPendingDocuments(checklist = []) {
  return checklist.filter((i) => i.is_mandatory && i.upload_status !== 'Uploaded');
}

function getRejectedDocuments(checklist = []) {
  return checklist.filter((i) => i.hr_review_status === 'Rejected');
}

function getApprovedDocuments(checklist = []) {
  return checklist.filter((i) => i.is_mandatory && i.upload_status === 'Uploaded' && i.hr_review_status === 'Approved');
}

function getRemainingDocumentCount(checklist = []) {
  return checklist.filter(
    (i) => i.is_mandatory && (i.upload_status !== 'Uploaded' || i.hr_review_status !== 'Approved')
  ).length;
}

module.exports = {
  getPendingDocuments,
  getRejectedDocuments,
  getApprovedDocuments,
  getRemainingDocumentCount,
};
