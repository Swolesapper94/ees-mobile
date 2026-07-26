import {
  ArtifactType,
  CaptureDraft,
  EvidenceArtifact,
  MobileBootstrap,
  ObservationDraft,
  PerformanceEntry,
  RaterAssignment,
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
}

interface ApiSupportForm {
  id: string;
  ratingPeriodStart: string;
  ratingPeriodEnd: string;
  entries: ApiEntry[];
}

interface ApiGoal {
  id: string;
  title: string;
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
  },
  goals: [
    {
      id: "goal-readiness",
      title: "Improve platoon training readiness and accountability",
    },
    {
      id: "goal-development",
      title: "Develop junior Soldiers through monthly coaching",
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

function inferArtifactType(file: File): ArtifactType {
  if (file.type.startsWith("image/")) return "PHOTO";
  if (/score|acft|range/i.test(file.name)) return "SCORE_SHEET";
  if (/cert|award/i.test(file.name)) return "CERTIFICATE";
  if (file.type === "application/pdf") return "DOCUMENT";
  return "OTHER";
}

async function createDemoEntry(draft: CaptureDraft): Promise<PerformanceEntry> {
  const data = readDemoBootstrap();
  if (!data.supportForm) throw new Error("No active personal support form is available.");
  const now = new Date().toISOString();
  const artifact = draft.artifact
    ? {
        id: crypto.randomUUID(),
        name: draft.artifact.name,
        type: draft.artifactType ?? inferArtifactType(draft.artifact),
        mimeType: draft.artifact.type || "application/octet-stream",
        size: draft.artifact.size,
        previewUrl: draft.artifact.type.startsWith("image/")
          ? URL.createObjectURL(draft.artifact)
          : undefined,
        aiCaptionStatus: "PENDING" as const,
        flaggedByServiceMember: draft.flaggedByServiceMember,
        flagNote: draft.flagNote,
      }
    : undefined;

  const entry: PerformanceEntry = {
    id: crypto.randomUUID(),
    supportFormId: data.supportForm.id,
    entryDate: draft.eventDate,
    section: draft.section,
    entryType: "ACCOMPLISHMENT",
    rawText: draft.rawText,
    goalId: draft.goalId || undefined,
    confirmationStatus: "UNREVIEWED",
    artifacts: artifact ? [artifact] : [],
    createdAt: now,
    submittedBy: `${data.user.rank} ${data.user.displayName}`,
  };

  data.entries = [entry, ...data.entries];
  writeDemoBootstrap(data);

  // Simulate asynchronous caption completion while preserving the immediate
  // "PENDING" record behavior expected from the real MERIT pipeline.
  if (artifact) {
    window.setTimeout(() => {
      const latest = readDemoBootstrap();
      const stored = latest.entries.find((item) => item.id === entry.id);
      const storedArtifact = stored?.artifacts.find(
        (item) => item.id === artifact.id,
      );
      if (storedArtifact) {
        storedArtifact.aiCaptionStatus = "COMPLETE";
        storedArtifact.aiCaption =
          `${artifact.type.replace("_", " ").toLowerCase()} uploaded for ` +
          `${draft.section.toLowerCase()} accomplishment review. ` +
          "Demo caption only; production MERIT performs factual extraction through the evidence service.";
        writeDemoBootstrap(latest);
        window.dispatchEvent(new Event("ees-demo-updated"));
      }
    }, 2200);
  }

  return entry;
}

export interface EesGateway {
  bootstrap(): Promise<MobileBootstrap>;
  createEntry(draft: CaptureDraft): Promise<{ entry: PerformanceEntry; uploadWarning?: string }>;
  createObservation(draft: ObservationDraft): Promise<void>;
}

const demoGateway: EesGateway = {
  async bootstrap() {
    return readDemoBootstrap();
  },
  async createEntry(draft) {
    return { entry: await createDemoEntry(draft) };
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
    confirmationStatus: entry.confirmationStatus,
    clarificationNote: entry.clarificationNote ?? undefined,
    artifacts: (entry.artifacts ?? []).map(mapArtifact),
    createdAt: entry.createdAt,
    submittedBy: author,
  };
}

const apiGateway: EesGateway = {
  async bootstrap() {
    const user = await request<ApiUser>("/users/me");
    const [forms, raterEvaluations] = await Promise.all([
      request<ApiSupportForm[]>(`/support-forms?soldierId=${encodeURIComponent(user.id)}`),
      request<ApiRaterEvaluation[]>("/evaluations?role=rater"),
    ]);
    const form = forms[0];
    const goals = form ? await request<ApiGoal[]>(`/support-forms/${form.id}/goals`) : [];
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
          goals: assignmentGoals.map(({ id, title }) => ({ id, title })),
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
      } : null,
      goals: goals.map(({ id, title }) => ({ id, title })),
      entries: form ? form.entries.map((entry) => mapEntry(entry, `${user.rank} ${displayName}`)) : [],
      raterAssignments,
    };
  },
  async createEntry(draft) {
    const forms = await request<ApiSupportForm[]>("/support-forms");
    const form = forms[0];
    if (!form) throw new Error("No active MERIT support form is available.");
    const created = await request<ApiEntry>(`/support-forms/${form.id}/entries`, {
      method: "POST",
      body: JSON.stringify({
        section: draft.section,
        entryType: "ACCOMPLISHMENT",
        rawText: draft.rawText.trim(),
        entryDate: draft.eventDate,
        goalIds: draft.goalId ? [draft.goalId] : [],
      }),
    });

    let uploadWarning: string | undefined;
    if (draft.artifact) {
      const upload = new FormData();
      upload.set("file", draft.artifact);
      upload.set("type", draft.artifactType ?? inferArtifactType(draft.artifact));
      upload.set("flaggedByServiceMember", String(draft.flaggedByServiceMember));
      if (draft.flagNote) upload.set("flagNote", draft.flagNote);
      try {
        await request<ApiArtifact>(`/support-forms/${form.id}/entries/${created.id}/artifacts`, {
          method: "POST",
          body: upload,
        });
      } catch {
        uploadWarning = "The accomplishment was saved, but its evidence upload failed. Add the evidence from the full MERIT support-form workspace.";
      }
    }

    const refreshed = await request<ApiSupportForm>(`/support-forms/${form.id}`);
    const entry = refreshed.entries.find((item) => item.id === created.id) ?? created;
    return { entry: mapEntry(entry, "You"), uploadWarning };
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
