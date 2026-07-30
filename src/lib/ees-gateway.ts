import {
  ArtifactType,
  CaptureDraft,
  DraftArtifact,
  EvidenceArtifact,
  MobileBootstrap,
  ObservationDraft,
  PerformanceEntry,
  RaterAssignment,
  SubmissionState,
} from "./contracts";
import { getMeritAccessToken } from "./auth";

const STORE_KEY = "ees-mobile-demo-v1";
const API_URL = import.meta.env.VITE_EES_API_URL || "http://localhost:4000";

interface ApiUser {
  id: string;
  firstName: string;
  lastName: string;
  rank: string;
}

interface ApiArtifact {
  id: string;
  type: ArtifactType;
  fileUrl: string;
  fileType: string;
  aiCaption?: string | null;
  aiCaptionStatus: "PENDING" | "COMPLETE" | "FAILED";
  flaggedByServiceMember: boolean;
  flagNote?: string | null;
}

interface ApiEntry {
  id: string;
  supportFormId: string;
  entryDate: string;
  section: PerformanceEntry["section"];
  rawText: string;
  confirmationStatus: PerformanceEntry["confirmationStatus"];
  clarificationNote?: string | null;
  artifacts?: ApiArtifact[];
  createdAt: string;
  createdByUser?: { firstName: string; lastName: string; rank: string } | null;
  goalLinks?: Array<{ goal: { id: string } }>;
  usedInEvalId?: string | null;
  withdrawnAt?: string | null;
}

interface ApiSupportForm {
  id: string;
  ratingPeriodStart: string;
  ratingPeriodEnd: string;
  status: string;
  entries: ApiEntry[];
}

interface ApiGoal {
  id: string;
  title: string;
  sectionKey: PerformanceEntry["section"];
}

interface ApiCompleteness {
  goalCountsByDimension: Record<PerformanceEntry["section"], number>;
}

interface ApiRaterEvaluation {
  supportFormId?: string | null;
  ratingChain?: {
    ratedSoldier?: ApiUser | null;
  } | null;
}

const seedEntry: PerformanceEntry = {
  id: "entry-seed-1",
  supportFormId: "test-sf-davis-2026",
  entryDate: "2026-07-12",
  section: "ACHIEVES",
  entryType: "ACCOMPLISHMENT",
  rawText:
    "Improved ACFT score by 42 points while coaching two Soldiers through their retest plans.",
  confirmationStatus: "CONFIRMED",
  artifacts: [
    {
      id: "artifact-seed-1",
      name: "ACFT scorecard.pdf",
      type: "SCORE_SHEET",
      mimeType: "application/pdf",
      size: 1180000,
      aiCaption:
        "ACFT scorecard showing a 42-point improvement during the current rating period.",
      aiCaptionStatus: "COMPLETE",
      flaggedByServiceMember: false,
    },
  ],
  createdAt: "2026-07-12T15:30:00.000Z",
  submittedBy: "SGT James Davis",
};

const baseBootstrap: MobileBootstrap = {
  user: {
    id: "test-user-davis",
    displayName: "James Davis",
    rank: "SGT",
  },
  supportForm: {
    id: "test-sf-davis-2026",
    label: "FY26 Support Form",
    ratingPeriod: "01 SEP 2025 – 31 AUG 2026",
    ratingPeriodStart: "2025-09-01",
    ratingPeriodEnd: "2026-08-31",
    status: "ACTIVE",
    goalsEstablishedDimensions: ["LEADS", "DEVELOPS"],
  },
  goals: [
    {
      id: "goal-readiness",
      title: "Improve platoon training readiness and accountability",
      sectionKey: "LEADS",
    },
    {
      id: "goal-development",
      title: "Develop junior Soldiers through monthly coaching",
      sectionKey: "DEVELOPS",
    },
  ],
  entries: [seedEntry],
  raterAssignments: [],
};

function readDemoBootstrap(): MobileBootstrap {
  if (typeof window === "undefined") return baseBootstrap;
  const raw = window.localStorage.getItem(STORE_KEY);
  if (!raw) return baseBootstrap;
  try {
    const stored = JSON.parse(raw) as Partial<MobileBootstrap>;
    return {
      ...baseBootstrap,
      ...stored,
      user: { ...baseBootstrap.user, ...stored.user },
      supportForm: stored.supportForm === null ? null : { ...baseBootstrap.supportForm!, ...stored.supportForm },
      goals: stored.goals ?? baseBootstrap.goals,
      entries: stored.entries ?? baseBootstrap.entries,
      raterAssignments: stored.raterAssignments ?? [],
    };
  } catch {
    return baseBootstrap;
  }
}

function writeDemoBootstrap(data: MobileBootstrap) {
  window.localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

async function createDemoEntry(draft: CaptureDraft): Promise<PerformanceEntry> {
  const data = readDemoBootstrap();
  if (!data.supportForm) throw new Error("No active personal support form is available.");
  const now = new Date().toISOString();
  const artifacts = draft.artifacts.map(({ file, type }) => ({
        id: crypto.randomUUID(),
        name: file.name,
        type,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        previewUrl: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
        aiCaptionStatus: "PENDING" as const,
        flaggedByServiceMember: draft.flaggedByServiceMember,
        flagNote: draft.flagNote,
      }));

  const entry: PerformanceEntry = {
    id: crypto.randomUUID(),
    supportFormId: data.supportForm.id,
    entryDate: draft.eventDate,
    section: draft.section,
    entryType: "ACCOMPLISHMENT",
    rawText: draft.rawText,
    goalId: draft.goalId || undefined,
    confirmationStatus: "UNREVIEWED",
    artifacts,
    createdAt: now,
    submittedBy: `${data.user.rank} ${data.user.displayName}`,
  };

  data.entries = [entry, ...data.entries];
  writeDemoBootstrap(data);

  // Simulate asynchronous caption completion while preserving the immediate
  // "PENDING" record behavior expected from the real MERIT pipeline.
  if (artifacts.length) {
    window.setTimeout(() => {
      const latest = readDemoBootstrap();
      const stored = latest.entries.find((item) => item.id === entry.id);
      for (const storedArtifact of stored?.artifacts ?? []) {
        storedArtifact.aiCaptionStatus = "COMPLETE";
        storedArtifact.aiCaption =
          `${storedArtifact.type.replace("_", " ").toLowerCase()} uploaded for ` +
          `${draft.section.toLowerCase()} accomplishment review. ` +
          "Demo caption only; production MERIT performs factual extraction through the evidence service.";
      }
      writeDemoBootstrap(latest);
      window.dispatchEvent(new Event("ees-demo-updated"));
    }, 2200);
  }

  return entry;
}

export interface EesGateway {
  bootstrap(): Promise<MobileBootstrap>;
  createEntry(draft: CaptureDraft, onState?: (state: SubmissionState) => void): Promise<{ entry: PerformanceEntry; uploadWarning?: string; failedArtifacts?: DraftArtifact[] }>;
  retryEvidence(entry: PerformanceEntry, draft: CaptureDraft, onState?: (state: SubmissionState) => void): Promise<{ entry: PerformanceEntry; failedArtifacts: DraftArtifact[] }>;
  resubmitClarification(entry: PerformanceEntry, draft: CaptureDraft, response: string, onState?: (state: SubmissionState) => void): Promise<{ entry: PerformanceEntry; failedArtifacts: DraftArtifact[] }>;
  withdrawEntry(entry: PerformanceEntry, reason?: string): Promise<void>;
  createObservation(draft: ObservationDraft): Promise<void>;
}

const demoGateway: EesGateway = {
  async bootstrap() {
    return readDemoBootstrap();
  },
  async createEntry(draft, onState) {
    onState?.("SAVING_ENTRY");
    if (draft.artifacts.length) onState?.("UPLOADING_EVIDENCE");
    onState?.(draft.artifacts.length ? "ANALYZING_EVIDENCE" : "ANALYSIS_COMPLETE");
    return { entry: await createDemoEntry(draft) };
  },
  async retryEvidence(entry, _draft, onState) {
    onState?.("UPLOADING_EVIDENCE");
    onState?.("ANALYZING_EVIDENCE");
    return { entry, failedArtifacts: [] };
  },
  async resubmitClarification(entry, draft, _response, onState) {
    onState?.("SAVING_ENTRY");
    const data = readDemoBootstrap();
    const stored = data.entries.find((item) => item.id === entry.id);
    if (!stored) throw new Error("Entry not found.");
    stored.rawText = draft.rawText.trim();
    stored.confirmationStatus = "UNREVIEWED";
    stored.artifacts.push(...draft.artifacts.map(({ file, type }) => ({
      id: crypto.randomUUID(), name: file.name, type, mimeType: file.type, size: file.size,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      aiCaptionStatus: "PENDING" as const, flaggedByServiceMember: draft.flaggedByServiceMember, flagNote: draft.flagNote,
    })));
    writeDemoBootstrap(data);
    onState?.(draft.artifacts.length ? "ANALYZING_EVIDENCE" : "ANALYSIS_COMPLETE");
    return { entry: stored, failedArtifacts: [] };
  },
  async withdrawEntry(entry) {
    const data = readDemoBootstrap();
    data.entries = data.entries.filter((item) => item.id !== entry.id);
    writeDemoBootstrap(data);
  },
  async createObservation() {
    throw new Error("This demo identity is a rated Soldier. Sign in as an assigned rater to record leader observations.");
  },
};

async function sharedAuthHeader(): Promise<Record<string, string>> {
  const devAuth = localStorage.getItem("devAuth");
  if (devAuth) return { Authorization: devAuth };
  const accessToken = await getMeritAccessToken();
  if (accessToken) return { Authorization: `Bearer ${accessToken}` };
  throw new Error("Your MERIT session is unavailable. Sign in again to continue.");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-MERIT-CLIENT", "mobile");
  Object.entries(await sharedAuthHeader()).forEach(([key, value]) => headers.set(key, value));
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_URL}/api${path}`, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new Error(payload?.error || payload?.message || `MERIT request failed (${response.status}).`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function displayPeriod(start: string, end: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", year: "numeric" });
  return `${formatter.format(new Date(start))} - ${formatter.format(new Date(end))}`.toUpperCase();
}

function mapArtifact(artifact: ApiArtifact): EvidenceArtifact {
  const isImage = artifact.fileType === "image";
  let name = "Supporting evidence";
  try {
    name = decodeURIComponent(new URL(artifact.fileUrl).pathname.split("/").pop() || name);
  } catch {
    // Preserve a useful fallback for legacy URLs.
  }
  return {
    id: artifact.id,
    name,
    type: artifact.type,
    mimeType: isImage ? "image/*" : "application/pdf",
    size: 0,
    fileUrl: artifact.fileUrl,
    previewUrl: isImage ? artifact.fileUrl : undefined,
    aiCaption: artifact.aiCaption ?? undefined,
    aiCaptionStatus: artifact.aiCaptionStatus,
    flaggedByServiceMember: artifact.flaggedByServiceMember,
    flagNote: artifact.flagNote ?? undefined,
  };
}

function mapEntry(entry: ApiEntry, fallbackAuthor: string): PerformanceEntry {
  const author = entry.createdByUser
    ? `${entry.createdByUser.rank} ${entry.createdByUser.firstName} ${entry.createdByUser.lastName}`
    : fallbackAuthor;
  return {
    id: entry.id,
    supportFormId: entry.supportFormId,
    entryDate: entry.entryDate,
    section: entry.section,
    entryType: "ACCOMPLISHMENT",
    rawText: entry.rawText,
    goalId: entry.goalLinks?.[0]?.goal.id,
    confirmationStatus: entry.confirmationStatus,
    clarificationNote: entry.clarificationNote ?? undefined,
    artifacts: (entry.artifacts ?? []).map(mapArtifact),
    createdAt: entry.createdAt,
    submittedBy: author,
    usedInEvalId: entry.usedInEvalId ?? undefined,
    withdrawnAt: entry.withdrawnAt ?? undefined,
  };
}

async function uploadArtifacts(
  formId: string,
  entryId: string,
  draft: CaptureDraft,
  onState?: (state: SubmissionState) => void,
): Promise<{ uploadedIds: string[]; failedArtifacts: DraftArtifact[] }> {
  if (!draft.artifacts.length) {
    onState?.("ANALYSIS_COMPLETE");
    return { uploadedIds: [], failedArtifacts: [] };
  }
  onState?.("UPLOADING_EVIDENCE");
  const uploadedIds: string[] = [];
  const failedArtifacts: DraftArtifact[] = [];
  for (const artifact of draft.artifacts) {
    const upload = new FormData();
    upload.set("file", artifact.file);
    upload.set("type", artifact.type);
    upload.set("flaggedByServiceMember", String(draft.flaggedByServiceMember));
    if (draft.flagNote) upload.set("flagNote", draft.flagNote);
    try {
      const created = await request<ApiArtifact>(`/support-forms/${formId}/entries/${entryId}/artifacts`, {
        method: "POST",
        body: upload,
      });
      uploadedIds.push(created.id);
    } catch {
      failedArtifacts.push(artifact);
    }
  }
  if (failedArtifacts.length) {
    onState?.("UPLOAD_FAILED");
  } else {
    onState?.("EVIDENCE_SECURED");
    onState?.("ANALYZING_EVIDENCE");
  }
  return { uploadedIds, failedArtifacts };
}

const apiGateway: EesGateway = {
  async bootstrap() {
    const user = await request<ApiUser>("/users/me");
    const [forms, raterEvaluations] = await Promise.all([
      request<ApiSupportForm[]>(`/support-forms?soldierId=${encodeURIComponent(user.id)}`),
      request<ApiRaterEvaluation[]>("/evaluations?role=rater"),
    ]);
    const now = new Date();
    const form = forms.find((candidate) => {
      const start = new Date(candidate.ratingPeriodStart);
      const end = candidate.ratingPeriodEnd ? new Date(candidate.ratingPeriodEnd) : null;
      return start <= now && (!end || end >= now) && !["CONSUMED", "ARCHIVED", "QUARANTINED"].includes(candidate.status);
    }) ?? forms[0];
    const [goals, completeness] = form
      ? await Promise.all([
          request<ApiGoal[]>(`/support-forms/${form.id}/goals`),
          request<ApiCompleteness>(`/support-forms/${form.id}/completeness`),
        ])
      : [[], null];
    const uniqueAssignments = new Map<string, ApiRaterEvaluation>();
    for (const evaluation of raterEvaluations) {
      if (evaluation.supportFormId && evaluation.ratingChain?.ratedSoldier) {
        uniqueAssignments.set(evaluation.supportFormId, evaluation);
      }
    }
    const raterAssignments: RaterAssignment[] = await Promise.all(
      [...uniqueAssignments.entries()].map(async ([supportFormId, evaluation]) => {
        const soldier = evaluation.ratingChain!.ratedSoldier!;
        const assignmentGoals = await request<ApiGoal[]>(`/support-forms/${supportFormId}/goals`);
        return {
          supportFormId,
          soldierId: soldier.id,
          displayName: `${soldier.firstName} ${soldier.lastName}`,
          rank: soldier.rank,
          goals: assignmentGoals.map(({ id, title, sectionKey }) => ({ id, title, sectionKey })),
        };
      }),
    );
    if (!form && raterAssignments.length === 0) {
      throw new Error("No active support form or assigned Soldier workload is available.");
    }
    const displayName = `${user.firstName} ${user.lastName}`;
    return {
      user: { id: user.id, displayName, rank: user.rank },
      supportForm: form ? {
        id: form.id,
        label: "Active support form",
        ratingPeriod: displayPeriod(form.ratingPeriodStart, form.ratingPeriodEnd),
        ratingPeriodStart: form.ratingPeriodStart,
        ratingPeriodEnd: form.ratingPeriodEnd,
        status: form.status,
        goalsEstablishedDimensions: completeness
          ? Object.entries(completeness.goalCountsByDimension)
              .filter(([, count]) => count > 0)
              .map(([dimension]) => dimension as PerformanceEntry["section"])
          : [],
      } : null,
      goals: goals.map(({ id, title, sectionKey }) => ({ id, title, sectionKey })),
      entries: form ? form.entries.filter((entry) => !entry.withdrawnAt).map((entry) => mapEntry(entry, `${user.rank} ${displayName}`)) : [],
      raterAssignments,
    };
  },
  async createEntry(draft, onState) {
    const forms = await request<ApiSupportForm[]>("/support-forms");
    const now = new Date();
    const form = forms.find((candidate) => {
      const start = new Date(candidate.ratingPeriodStart);
      const end = candidate.ratingPeriodEnd ? new Date(candidate.ratingPeriodEnd) : null;
      return start <= now && (!end || end >= now) && !["CONSUMED", "ARCHIVED", "QUARANTINED"].includes(candidate.status);
    }) ?? forms[0];
    if (!form) throw new Error("No active MERIT support form is available.");
    onState?.("SAVING_ENTRY");
    const created = await request<ApiEntry>(`/support-forms/${form.id}/entries`, {
      method: "POST",
      body: JSON.stringify({
      clientRequestId: draft.clientRequestId,
        section: draft.section,
        entryType: "ACCOMPLISHMENT",
        rawText: draft.rawText.trim(),
        entryDate: draft.eventDate,
        goalIds: draft.goalId ? [draft.goalId] : [],
      }),
    });

    const { failedArtifacts } = await uploadArtifacts(form.id, created.id, draft, onState);
    const uploadWarning = failedArtifacts.length
      ? `${failedArtifacts.length} evidence upload${failedArtifacts.length === 1 ? "" : "s"} failed. The entry is saved; retry without re-submitting it.`
      : undefined;

    const refreshed = await request<ApiSupportForm>(`/support-forms/${form.id}`);
    const entry = refreshed.entries.find((item) => item.id === created.id) ?? created;
    return { entry: mapEntry(entry, "You"), uploadWarning, failedArtifacts };
  },
  async retryEvidence(entry, draft, onState) {
    const { failedArtifacts } = await uploadArtifacts(entry.supportFormId, entry.id, draft, onState);
    const refreshed = await request<ApiSupportForm>(`/support-forms/${entry.supportFormId}`);
    const current = refreshed.entries.find((item) => item.id === entry.id);
    if (!current) throw new Error("The saved entry could not be reloaded.");
    return { entry: mapEntry(current, "You"), failedArtifacts };
  },
  async resubmitClarification(entry, draft, response, onState) {
    const { uploadedIds, failedArtifacts } = await uploadArtifacts(entry.supportFormId, entry.id, draft, onState);
    if (failedArtifacts.length) return { entry, failedArtifacts };
    onState?.("SAVING_ENTRY");
    const updated = await request<ApiEntry>(`/support-forms/entries/${entry.id}/resubmit`, {
      method: "POST",
      body: JSON.stringify({ rawText: draft.rawText.trim(), response: response.trim(), replacementArtifactIds: uploadedIds }),
    });
    onState?.(draft.artifacts.length ? "ANALYZING_EVIDENCE" : "ANALYSIS_COMPLETE");
    return { entry: mapEntry(updated, "You"), failedArtifacts: [] };
  },
  async withdrawEntry(entry, reason) {
    await request(`/support-forms/entries/${entry.id}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ reason: reason?.trim() || undefined }),
    });
  },
  async createObservation(draft) {
    await request(`/support-forms/${draft.supportFormId}/observations`, {
      method: "POST",
      body: JSON.stringify({
        goalId: draft.goalId || null,
        sectionKey: draft.sectionKey,
        feedbackType: draft.feedbackType,
        factualNote: draft.factualNote.trim(),
        occurredAt: draft.occurredAt,
        tags: [],
      }),
    });
  },
};

export const eesGateway: EesGateway =
  import.meta.env.VITE_EES_DEMO_MODE === "false"
    ? apiGateway
    : demoGateway;
