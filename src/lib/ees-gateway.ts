import {
  ArtifactType,
  CaptureDraft,
  DraftArtifact,
  EvidenceArtifact,
  MobileBootstrap,
  ObservationDraft,
  PerformanceEntry,
  PilotKpiSummary,
  PilotMetricEventInput,
  RaterAssignment,
  SubmissionState,
} from "./contracts";
import { getMeritAccessToken } from "./auth";

const DEMO_PROFILE_KEY = "ees-mobile-demo-profile-v1";
const STORE_KEY_PREFIX = "ees-mobile-demo-v2";
const PILOT_EVENT_STORE_KEY = "ees-mobile-pilot-events-v1";
const API_URL = import.meta.env.VITE_EES_API_URL || "http://localhost:4000";

interface ApiUser {
  id: string;
  firstName: string;
  lastName: string;
  rank: string;
  roles: string[];
  applicationSupportRole: "NONE" | "SUPPORT" | "ADMINISTRATOR";
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

interface ApiObservation {
  id: string;
}

const DEMO_TODAY = new Date().toISOString().slice(0, 10);
const DEMO_YEAR = new Date().getUTCFullYear();
const DEMO_PERIOD_START = `${DEMO_YEAR}-01-01`;
const DEMO_PERIOD_END = `${DEMO_YEAR}-12-31`;

const seedEntry: PerformanceEntry = {
  id: "entry-seed-1",
  supportFormId: "test-sf-davis-2026",
  entryDate: DEMO_TODAY,
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
  createdAt: `${DEMO_TODAY}T15:30:00.000Z`,
  submittedBy: "SGT James Davis",
};

export type DemoProfileId = "soldier" | "leader" | "pilot_owner";

export interface DemoProfileOption {
  id: DemoProfileId;
  initials: string;
  rank: string;
  displayName: string;
  identityLabel: string;
  roleLabel: string;
  description: string;
  accessLabel: string;
}

export const demoProfiles: DemoProfileOption[] = [
  {
    id: "soldier",
    initials: "JD",
    rank: "SGT",
    displayName: "James Davis",
    identityLabel: "SGT James Davis",
    roleLabel: "Soldier",
    description: "Log your own performance.",
    accessLabel: "Personal record",
  },
  {
    id: "leader",
    initials: "MJ",
    rank: "SSG",
    displayName: "Marcus Johnson",
    identityLabel: "SSG Marcus Johnson",
    roleLabel: "Leader",
    description: "Log your work or observe your roster.",
    accessLabel: "Personal record + observer access",
  },
  {
    id: "pilot_owner",
    initials: "PO",
    rank: "MERIT",
    displayName: "Pilot Owner",
    identityLabel: "MERIT Pilot Owner",
    roleLabel: "Pilot Owner",
    description: "View aggregate pilot results.",
    accessLabel: "Pilot metrics only",
  },
];

const demoGoals: MobileBootstrap["goals"] = [
  { id: "goal-readiness", title: "Improve platoon training readiness and accountability", sectionKey: "LEADS" },
  { id: "goal-development", title: "Develop junior Soldiers through monthly coaching", sectionKey: "DEVELOPS" },
];

const demoLeaderGoals: MobileBootstrap["goals"] = [
  { id: "goal-johnson-readiness", title: "Improve squad maintenance readiness and reporting accuracy", sectionKey: "ACHIEVES" },
  { id: "goal-johnson-development", title: "Develop team leaders through weekly coaching", sectionKey: "DEVELOPS" },
];

const seedLeaderEntry: PerformanceEntry = {
  id: "entry-seed-johnson-1",
  supportFormId: "test-sf-johnson-2026",
  entryDate: DEMO_TODAY,
  section: "DEVELOPS",
  entryType: "ACCOMPLISHMENT",
  rawText: "Coached two team leaders through counseling preparation and improved on-time completion across the squad.",
  confirmationStatus: "UNREVIEWED",
  artifacts: [],
  createdAt: `${DEMO_TODAY}T14:10:00.000Z`,
  submittedBy: "SSG Marcus Johnson",
};

const demoBootstrapByProfile: Record<DemoProfileId, MobileBootstrap> = {
  soldier: {
    user: {
      id: "test-user-davis",
      displayName: "James Davis",
      rank: "SGT",
      roles: ["SOLDIER"],
      applicationSupportRole: "NONE",
    },
    canViewPilotImpact: false,
    supportForm: {
      id: "test-sf-davis-2026",
      label: `CY${String(DEMO_YEAR).slice(-2)} Support Form`,
      ratingPeriod: `01 JAN ${DEMO_YEAR} – 31 DEC ${DEMO_YEAR}`,
      ratingPeriodStart: DEMO_PERIOD_START,
      ratingPeriodEnd: DEMO_PERIOD_END,
      status: "ACTIVE",
      goalsEstablishedDimensions: ["LEADS", "DEVELOPS"],
    },
    goals: demoGoals,
    entries: [seedEntry],
    raterAssignments: [],
  },
  leader: {
    user: {
      id: "test-user-johnson",
      displayName: "Marcus Johnson",
      rank: "SSG",
      roles: ["SOLDIER", "RATER"],
      applicationSupportRole: "NONE",
    },
    canViewPilotImpact: false,
    supportForm: {
      id: "test-sf-johnson-2026",
      label: `CY${String(DEMO_YEAR).slice(-2)} Support Form`,
      ratingPeriod: `01 JAN ${DEMO_YEAR} – 31 DEC ${DEMO_YEAR}`,
      ratingPeriodStart: DEMO_PERIOD_START,
      ratingPeriodEnd: DEMO_PERIOD_END,
      status: "ACTIVE",
      goalsEstablishedDimensions: ["ACHIEVES", "DEVELOPS"],
    },
    goals: demoLeaderGoals,
    entries: [seedLeaderEntry],
    raterAssignments: [{
      supportFormId: "test-sf-davis-2026",
      soldierId: "test-user-davis",
      displayName: "James Davis",
      rank: "SGT",
      goals: demoGoals.map(({ id, title }) => ({ id, title })),
    }],
  },
  pilot_owner: {
    user: {
      id: "test-user-pilot-owner",
      displayName: "Pilot Owner",
      rank: "MERIT",
      roles: [],
      applicationSupportRole: "ADMINISTRATOR",
    },
    canViewPilotImpact: true,
    supportForm: null,
    goals: [],
    entries: [],
    raterAssignments: [],
  },
};

for (const [profileId, bootstrap] of Object.entries(demoBootstrapByProfile)) {
  const isAdministrator = bootstrap.user.applicationSupportRole === "ADMINISTRATOR";
  if (bootstrap.canViewPilotImpact !== isAdministrator) {
    throw new Error(`Demo profile ${profileId} has inconsistent pilot-impact access.`);
  }
}

const soldierDemo = demoBootstrapByProfile.soldier;
const leaderDemo = demoBootstrapByProfile.leader;
const pilotOwnerDemo = demoBootstrapByProfile.pilot_owner;
if (!soldierDemo.supportForm || soldierDemo.raterAssignments.length > 0) {
  throw new Error("The Soldier demo must expose only the personal-record lane.");
}
if (!leaderDemo.supportForm || leaderDemo.raterAssignments.length === 0) {
  throw new Error("The Leader demo must combine a personal record with an authorized observer lane.");
}
if (pilotOwnerDemo.supportForm || pilotOwnerDemo.raterAssignments.length > 0 || pilotOwnerDemo.user.roles.length > 0) {
  throw new Error("The Pilot Owner demo must not inherit operational Soldier or rating authority.");
}

function cloneBootstrap(data: MobileBootstrap): MobileBootstrap {
  return JSON.parse(JSON.stringify(data)) as MobileBootstrap;
}

export function readSelectedDemoProfileId(): DemoProfileId | null {
  if (typeof window === "undefined") return null;
  const candidate = window.localStorage.getItem(DEMO_PROFILE_KEY);
  return demoProfiles.some((profile) => profile.id === candidate) ? candidate as DemoProfileId : null;
}

export function selectDemoProfile(profileId: DemoProfileId): void {
  window.localStorage.setItem(DEMO_PROFILE_KEY, profileId);
}

export function clearSelectedDemoProfile(): void {
  window.localStorage.removeItem(DEMO_PROFILE_KEY);
}

function readDemoBootstrapForProfile(profileId: DemoProfileId): MobileBootstrap {
  const base = cloneBootstrap(demoBootstrapByProfile[profileId]);
  const raw = window.localStorage.getItem(`${STORE_KEY_PREFIX}:${profileId}`);
  if (!raw) return base;
  try {
    const stored = JSON.parse(raw) as Partial<MobileBootstrap>;
    return {
      ...base,
      ...stored,
      user: base.user,
      canViewPilotImpact: base.canViewPilotImpact,
      supportForm: stored.supportForm === null || base.supportForm === null ? null : { ...base.supportForm, ...stored.supportForm },
      goals: stored.goals ?? base.goals,
      entries: stored.entries ?? base.entries,
      raterAssignments: base.raterAssignments,
    };
  } catch {
    return base;
  }
}

function readDemoBootstrap(): MobileBootstrap {
  const profileId = readSelectedDemoProfileId();
  if (!profileId) throw new Error("Choose a demo profile to continue.");
  return readDemoBootstrapForProfile(profileId);
}

function writeDemoBootstrap(data: MobileBootstrap) {
  const profileId = readSelectedDemoProfileId();
  if (!profileId) throw new Error("Choose a demo profile to continue.");
  window.localStorage.setItem(`${STORE_KEY_PREFIX}:${profileId}`, JSON.stringify(data));
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
  createObservation(draft: ObservationDraft, onState?: (state: SubmissionState) => void): Promise<{ observationId: string; uploadWarning?: string; failedArtifacts: DraftArtifact[] }>;
  retryObservationEvidence(observationId: string, supportFormId: string, artifacts: DraftArtifact[], onState?: (state: SubmissionState) => void): Promise<DraftArtifact[]>;
  trackPilotEvent(event: PilotMetricEventInput): Promise<void>;
  pilotSummary(days?: number): Promise<PilotKpiSummary>;
}

type StoredPilotEvent = PilotMetricEventInput & { actorId: string };

function readDemoPilotEvents(): StoredPilotEvent[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(PILOT_EVENT_STORE_KEY) ?? "[]") as StoredPilotEvent[];
  } catch {
    return [];
  }
}

function demoPilotSummary(days = 30): PilotKpiSummary {
  const soldierData = readDemoBootstrapForProfile("soldier");
  const leaderData = readDemoBootstrapForProfile("leader");
  const events = readDemoPilotEvents();
  const localWorkflows = new Set(events.map((event) => event.workflowId)).size;
  const localCompletions = events.filter((event) => event.eventType === "WORKFLOW_COMPLETED");
  const localRaterCompletions = localCompletions.filter((event) => event.workflowType === "RATER_OBSERVATION").length;
  const newEntries = Math.max(0, soldierData.entries.length - 1) + Math.max(0, leaderData.entries.length - 1);
  const through = new Date();
  const since = new Date(through.getTime() - days * 24 * 60 * 60 * 1000);
  const weeklyBase = days > 30 ? [8, 10, 12, 14, 16, 18, 21, 25] : [12, 16, 18, 21, 25];
  const weeklyTrend = weeklyBase.map((records, index) => {
    const week = new Date(through);
    week.setUTCDate(week.getUTCDate() - (weeklyBase.length - 1 - index) * 7);
    return {
      weekStart: week.toISOString().slice(0, 10),
      entries: Math.round(records * 0.72) + (index === weeklyBase.length - 1 ? newEntries : 0),
      observations: Math.round(records * 0.28),
      records: records + (index === weeklyBase.length - 1 ? newEntries : 0),
    };
  });
  const mobileRecords = 112 + newEntries + localRaterCompletions;
  return {
    dataStatus: "SYNTHETIC_DEMO",
    pilotId: "MERIT_MOBILE_PILOT",
    period: { days, since: since.toISOString(), through: through.toISOString() },
    scope: { unitCount: 4 },
    adoption: {
      activeParticipants: 31,
      repeatParticipants: 22,
      workflowsStarted: 102 + localWorkflows,
      workflowsCompleted: 94 + localCompletions.length,
      workflowsFailed: 3,
      completionRate: 92,
      draftRecoveries: 5 + events.filter((event) => event.eventType === "DRAFT_RECOVERED").length,
    },
    speed: {
      medianCaptureSeconds: 88,
      measuredCompletions: 94 + localCompletions.length,
      timeSavings: {
        status: "BASELINE_REQUIRED",
        savedHours: null,
        message: "Capture duration is measured. Hours saved require a pre-pilot baseline using the same workflow definition.",
      },
    },
    outcomes: {
      mobileRecords,
      soldierEntries: 83 + newEntries,
      raterObservations: 29 + localRaterCompletions,
      reviewedRecords: 78,
      usedInEvaluation: 18,
      releasedObservations: 16,
      positiveObservations: 20,
    },
    quality: {
      evidenceBackedEntries: 68,
      evidenceBackedPercent: 61,
      goalLinkedRecords: 72,
      goalLinkedPercent: 64,
      confirmed: 62,
      needsClarification: 7,
      notUsed: 3,
      awaitingReview: 11 + newEntries,
      medianReviewLagHours: 19,
      measuredReviews: 72,
    },
    dimensionCoverage: [
      { dimension: "CHARACTER", records: 13, percent: 12 },
      { dimension: "PRESENCE", records: 17, percent: 15 },
      { dimension: "INTELLECT", records: 16, percent: 14 },
      { dimension: "LEADS", records: 24, percent: 21 },
      { dimension: "DEVELOPS", records: 20, percent: 18 },
      { dimension: "ACHIEVES", records: 22 + newEntries, percent: 20 },
    ],
    weeklyTrend,
    sampleSize: { telemetryEvents: 412 + events.length, mobileRecords },
    privacy: {
      aggregationOnly: true,
      message: "This view intentionally excludes names, individual rankings, accomplishment text, evidence, and rating content.",
    },
  };
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
  async createObservation(draft, onState) {
    const data = readDemoBootstrap();
    const assigned = data.raterAssignments.some((assignment) => assignment.supportFormId === draft.supportFormId);
    if (!data.user.roles.includes("RATER") || !assigned) {
      throw new Error("Only a leader with an authorized Soldier relationship can record this observation.");
    }
    onState?.("SAVING_ENTRY");
    if (draft.artifacts.length) {
      onState?.("UPLOADING_EVIDENCE");
      onState?.("EVIDENCE_SECURED");
    } else {
      onState?.("ANALYSIS_COMPLETE");
    }
    return { observationId: crypto.randomUUID(), failedArtifacts: [] };
  },
  async retryObservationEvidence(_observationId, _supportFormId, _artifacts, onState) {
    onState?.("UPLOADING_EVIDENCE");
    onState?.("EVIDENCE_SECURED");
    return [];
  },
  async trackPilotEvent(event) {
    const events = readDemoPilotEvents();
    if (events.some((stored) => stored.clientEventId === event.clientEventId)) return;
    const data = readDemoBootstrap();
    events.push({ ...event, actorId: data.user.id });
    window.localStorage.setItem(PILOT_EVENT_STORE_KEY, JSON.stringify(events.slice(-500)));
  },
  async pilotSummary(days = 30) {
    const data = readDemoBootstrap();
    if (!data.canViewPilotImpact || data.user.applicationSupportRole !== "ADMINISTRATOR") {
      throw new Error("Pilot impact requires platform-administrator access.");
    }
    return demoPilotSummary(days);
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

async function uploadObservationArtifacts(
  formId: string,
  observationId: string,
  artifacts: DraftArtifact[],
  onState?: (state: SubmissionState) => void,
): Promise<DraftArtifact[]> {
  if (!artifacts.length) {
    onState?.("ANALYSIS_COMPLETE");
    return [];
  }
  onState?.("UPLOADING_EVIDENCE");
  const failedArtifacts: DraftArtifact[] = [];
  for (const artifact of artifacts) {
    const upload = new FormData();
    upload.set("file", artifact.file);
    upload.set("type", artifact.type);
    try {
      await request(`/support-forms/${formId}/observations/${observationId}/artifacts`, {
        method: "POST",
        body: upload,
      });
    } catch {
      failedArtifacts.push(artifact);
    }
  }
  onState?.(failedArtifacts.length ? "UPLOAD_FAILED" : "EVIDENCE_SECURED");
  return failedArtifacts;
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
    const canViewPilotImpact = user.applicationSupportRole === "ADMINISTRATOR";
    if (!form && raterAssignments.length === 0 && !canViewPilotImpact) {
      throw new Error("No active support form or assigned Soldier workload is available.");
    }
    const displayName = `${user.firstName} ${user.lastName}`;
    return {
      user: { id: user.id, displayName, rank: user.rank, roles: user.roles, applicationSupportRole: user.applicationSupportRole },
      canViewPilotImpact,
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
  async createObservation(draft, onState) {
    onState?.("SAVING_ENTRY");
    const observation = await request<ApiObservation>(`/support-forms/${draft.supportFormId}/observations`, {
      method: "POST",
      body: JSON.stringify({
        clientRequestId: draft.clientRequestId,
        goalId: draft.goalId || null,
        sectionKey: draft.sectionKey,
        feedbackType: draft.feedbackType,
        factualNote: draft.factualNote.trim(),
        occurredAt: draft.occurredAt,
        tags: [],
      }),
    });
    const failedArtifacts = await uploadObservationArtifacts(
      draft.supportFormId,
      observation.id,
      draft.artifacts,
      onState,
    );
    return {
      observationId: observation.id,
      failedArtifacts,
      uploadWarning: failedArtifacts.length
        ? `${failedArtifacts.length} evidence upload${failedArtifacts.length === 1 ? "" : "s"} failed. The observation is saved.`
        : undefined,
    };
  },
  async retryObservationEvidence(observationId, supportFormId, artifacts, onState) {
    return uploadObservationArtifacts(supportFormId, observationId, artifacts, onState);
  },
  async trackPilotEvent(event) {
    await request("/pilot-metrics/events", { method: "POST", body: JSON.stringify(event) });
  },
  async pilotSummary(days = 30) {
    return request<PilotKpiSummary>(`/pilot-metrics/summary?days=${days}&pilotId=MERIT_MOBILE_PILOT`);
  },
};

export const eesGateway: EesGateway =
  import.meta.env.VITE_EES_DEMO_MODE === "false"
    ? apiGateway
    : demoGateway;
