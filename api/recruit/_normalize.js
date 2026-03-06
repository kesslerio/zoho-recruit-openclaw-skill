function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return null;
}

function pickValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }

  return null;
}

function normalizeLookup(value, { primitive = "id" } = {}) {
  if (!value) return null;
  if (Array.isArray(value)) return normalizeLookup(value[0], { primitive });
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    return primitive === "name"
      ? { id: null, name: text }
      : { id: text, name: null };
  }

  const id = firstDefined(value.id, value.ID, value.record_id, value.value);
  const name = firstDefined(value.name, value.Name, value.display_value, value.label);
  if (!id && !name) return null;
  return {
    id: id ? String(id) : null,
    name: name ? String(name) : null
  };
}

function mergeLookups(...lookups) {
  const present = lookups.filter(Boolean);
  if (present.length === 0) return null;

  return {
    id: firstDefined(...present.map((lookup) => lookup.id), null),
    name: firstDefined(...present.map((lookup) => lookup.name), null)
  };
}

function splitList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function stripHtml(value) {
  if (typeof value !== "string") return null;
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
}

export function normalizeAttachmentRecord(record, { moduleApiName, recordId, recruitBase }) {
  const id = firstDefined(record?.id, record?.ID);
  const fileName = pickValue(record, ["File_Name", "Attachment_Name", "name"]);
  const category = firstDefined(record?.Attachment_Category, record?.Category, record?.attachments_category, null);

  return {
    id: id ? String(id) : null,
    fileName: fileName ? String(fileName) : null,
    sizeBytes: toNumber(firstDefined(record?.Size, record?.size)),
    category: category ? String(category) : null,
    createdTime: firstDefined(record?.Created_Time, record?.created_time, null),
    modifiedTime: firstDefined(record?.Modified_Time, record?.modified_time, null),
    owner: mergeLookups(
      normalizeLookup(record?.Owner),
      normalizeLookup(record?.$Owner, { primitive: "name" }),
      normalizeLookup(record?.Attachment_Owner, { primitive: "name" })
    ),
    sourceModule: moduleApiName,
    sourceRecordId: String(recordId),
    downloadUrl: id ? `${recruitBase}/recruit/v2/${moduleApiName}/${encodeURIComponent(recordId)}/Attachments/${encodeURIComponent(id)}` : null
  };
}

export function selectPrimaryResume(attachments) {
  const ranked = [...attachments].sort((left, right) => {
    const leftName = `${left.category || ""} ${left.fileName || ""}`.toLowerCase();
    const rightName = `${right.category || ""} ${right.fileName || ""}`.toLowerCase();
    const leftScore = /(resume|cv)/.test(leftName) ? 2 : 0;
    const rightScore = /(resume|cv)/.test(rightName) ? 2 : 0;
    const leftTime = Date.parse(left.modifiedTime || left.createdTime || 0) || 0;
    const rightTime = Date.parse(right.modifiedTime || right.createdTime || 0) || 0;
    return rightScore - leftScore || rightTime - leftTime;
  });

  return ranked[0] || null;
}

export function normalizeJobRecord(record) {
  return {
    id: String(firstDefined(record?.id, record?.ID, "")),
    title: firstDefined(record?.Posting_Title, record?.Potential_Name, record?.Title, null),
    status: firstDefined(record?.Job_Opening_Status, record?.Status, null),
    department: firstDefined(record?.Department, record?.Department_Name, null),
    owner: mergeLookups(
      normalizeLookup(record?.Job_Opening_Owner),
      normalizeLookup(record?.Owner),
      normalizeLookup(record?.Hiring_Manager, { primitive: "name" })
    ),
    client: mergeLookups(
      normalizeLookup(record?.Client),
      normalizeLookup(record?.Client_Name, { primitive: "name" })
    ),
    recruiter: mergeLookups(
      normalizeLookup(record?.Assigned_Recruiter, { primitive: "name" }),
      normalizeLookup(record?.Recruiter, { primitive: "name" }),
      normalizeLookup(record?.Candidate_Owner, { primitive: "name" })
    ),
    location: {
      city: firstDefined(record?.City, record?.Job_Opening_City, null),
      state: firstDefined(record?.State, record?.Job_Opening_State, null),
      country: firstDefined(record?.Country, record?.Job_Opening_Country, null),
      remote: toBoolean(firstDefined(record?.Remote, record?.Is_Remote))
    },
    openings: toNumber(firstDefined(record?.Number_of_Positions, record?.Openings)),
    candidateCount: toNumber(firstDefined(record?.No_of_Candidates_Associated, record?.Candidate_Count)),
    dateOpened: firstDefined(record?.Date_Opened, record?.Created_Time, null),
    targetDate: firstDefined(record?.Target_Date, record?.Date_Closed, null),
    salary: {
      currency: firstDefined(record?.Currency, record?.$currency_symbol, null),
      min: toNumber(firstDefined(record?.Salary_From, record?.Salary_Min, null)),
      max: toNumber(firstDefined(record?.Salary_To, record?.Salary_Max, null))
    },
    jobType: firstDefined(record?.Job_Type, record?.Employment_Type, null),
    descriptionText: stripHtml(firstDefined(record?.Job_Description, record?.Description, null)),
    posted: toBoolean(firstDefined(record?.Publish, record?.Published, null)),
    rawKeySummary: {
      postingTitle: firstDefined(record?.Posting_Title, record?.Potential_Name, null),
      jobOpeningId: firstDefined(record?.Job_Opening_ID, record?.Posting_ID, null)
    }
  };
}

function buildReviewPayload(candidate, attachments, { application = null, job = null } = {}) {
  return {
    candidateId: candidate.id,
    applicationId: application?.id || null,
    jobId: job?.id || candidate.jobOpening?.id || null,
    fullName: candidate.fullName,
    status: application?.status || candidate.status,
    rating: candidate.rating,
    source: application?.source || candidate.source,
    experienceYears: candidate.experienceYears,
    currentTitle: candidate.currentJobTitle,
    currentEmployer: candidate.currentEmployer,
    contact: candidate.contact,
    location: candidate.location,
    skills: candidate.skills,
    education: candidate.education,
    experience: candidate.experience,
    summaryText: candidate.summaryText,
    resume: {
      primary: selectPrimaryResume(attachments),
      attachmentCount: attachments.length,
      hasResume: attachments.length > 0
    }
  };
}

export function normalizeApplicationRecord(record) {
  return {
    id: String(firstDefined(record?.id, record?.ID, "")),
    status: firstDefined(record?.Application_Status, record?.Status, record?.Candidate_Status, null),
    stage: firstDefined(record?.Stage, record?.Pipeline_Stage, null),
    source: firstDefined(record?.Source, record?.Application_Source, null),
    candidate: mergeLookups(
      normalizeLookup(record?.Candidate),
      normalizeLookup(record?.Candidate_Name, { primitive: "name" }),
      normalizeLookup(record?.Candidate_Id, { primitive: "id" })
    ),
    jobOpening: mergeLookups(
      normalizeLookup(record?.Job_Opening),
      normalizeLookup(record?.Job_Opening_Name, { primitive: "name" }),
      normalizeLookup(record?.Posting_Title, { primitive: "name" })
    ),
    owner: mergeLookups(
      normalizeLookup(record?.Owner),
      normalizeLookup(record?.Application_Owner, { primitive: "name" })
    ),
    createdTime: firstDefined(record?.Created_Time, null),
    modifiedTime: firstDefined(record?.Modified_Time, null)
  };
}

export function normalizeCandidateRecord(record, { attachments = [], application = null, job = null } = {}) {
  const fullName = firstDefined(record?.Full_Name, [record?.First_Name, record?.Last_Name].filter(Boolean).join(" ").trim(), null);
  const normalized = {
    id: String(firstDefined(record?.id, record?.ID, "")),
    candidateNumber: firstDefined(record?.Candidate_ID, record?.Candidate_Number, null),
    fullName,
    firstName: firstDefined(record?.First_Name, null),
    lastName: firstDefined(record?.Last_Name, null),
    status: firstDefined(record?.Candidate_Status, record?.Status, null),
    source: firstDefined(record?.Source, null),
    rating: firstDefined(record?.Rating, null),
    headline: firstDefined(record?.Current_Job_Title, record?.Headline, null),
    currentJobTitle: firstDefined(record?.Current_Job_Title, null),
    currentEmployer: firstDefined(record?.Current_Employer, null),
    experienceYears: toNumber(firstDefined(record?.Experience_in_Years, record?.Experience_Years, null)),
    currentSalary: toNumber(firstDefined(record?.Current_Salary, null)),
    expectedSalary: toNumber(firstDefined(record?.Expected_Salary, null)),
    contact: {
      email: firstDefined(record?.Email, record?.Personal_Email, null),
      phone: firstDefined(record?.Phone, null),
      mobile: firstDefined(record?.Mobile, null),
      website: firstDefined(record?.Website, null),
      linkedin: firstDefined(record?.LinkedIn, record?.LinkedIn_Profile, null)
    },
    location: {
      city: firstDefined(record?.City, null),
      state: firstDefined(record?.State, null),
      country: firstDefined(record?.Country, null),
      postalCode: firstDefined(record?.Zip_Code, record?.Postal_Code, null)
    },
    skills: splitList(firstDefined(record?.Skill_Set, record?.Skills, null)),
    tags: asArray(record?.Associated_Tags)
      .map((tag) => {
        if (typeof tag === "string") return tag;
        return firstDefined(tag?.name, tag?.Name, null);
      })
      .filter(Boolean),
    education: asArray(record?.Educational_Details).map((item) => ({
      school: firstDefined(item?.Institute_School, item?.School, null),
      degree: firstDefined(item?.Degree, null),
      major: firstDefined(item?.Major_Department, item?.Major, null),
      gpa: firstDefined(item?.GPA, null),
      duration: item?.Duration || null,
      currentlyPursuing: toBoolean(firstDefined(item?.Currently_pursuing, null))
    })),
    experience: asArray(record?.Experience_Details).map((item) => ({
      company: firstDefined(item?.Company, item?.Company_Name, null),
      title: firstDefined(item?.Title, item?.Designation, null),
      from: firstDefined(item?.From, item?.Start_Date, item?.Duration?.from, null),
      to: firstDefined(item?.To, item?.End_Date, item?.Duration?.to, null),
      summary: stripHtml(firstDefined(item?.Description, item?.Summary, null))
    })),
    attachmentSummary: {
      hasAttachments: attachments.length > 0 || Boolean(record?.Is_Attachment_Present),
      attachmentCount: attachments.length,
      primaryResume: selectPrimaryResume(attachments)
    },
    jobOpening: mergeLookups(
      normalizeLookup(record?.Job_Opening),
      normalizeLookup(record?.Job_Opening_Name, { primitive: "name" })
    ),
    owner: mergeLookups(
      normalizeLookup(record?.Candidate_Owner, { primitive: "name" }),
      normalizeLookup(record?.Owner)
    ),
    createdTime: firstDefined(record?.Created_Time, null),
    updatedTime: firstDefined(record?.Updated_On, record?.Modified_Time, null),
    summaryText: stripHtml(firstDefined(record?.Additional_Info, record?.Profile_Summary, null)),
    reviewPayload: null
  };

  normalized.reviewPayload = buildReviewPayload(normalized, attachments, { application, job });
  return normalized;
}

export function normalizeApplicantRecord(record, { job = null } = {}) {
  const applicationLookup = mergeLookups(
    normalizeLookup(record?.Application),
    normalizeLookup(record?.Application_Name, { primitive: "name" }),
    normalizeLookup(record?.Application_Id, { primitive: "id" })
  );
  const applicationId = applicationLookup?.id ?? firstDefined(record?.Application_ID, record?.Application_Id, null) ?? null;
  const candidate = normalizeCandidateRecord(record, { attachments: [], job });

  return {
    ...candidate,
    applicationId,
    reviewPayload: {
      ...candidate.reviewPayload,
      applicationId,
      jobId: job?.id || candidate.jobOpening?.id || null
    }
  };
}
