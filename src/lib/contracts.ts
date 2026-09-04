export const leadershipDimensions = [
  "CHARACTER",
  "PRESENCE",
  "INTELLECT",
  "LEADS",
  "DEVELOPS",
  "ACHIEVES",
] as const;

export type LeadershipDimension = (typeof leadershipDimensions)[number];

export type ArtifactType =
  | "CERTIFICATE"
  | "SCORE_SHEET"
  | "PHOTO"
  | "DOCUMENT"
  | "OTHER";

export type ArtifactCaptionStatus = "PENDING" | "COMPLETE" | "FAILED";

export type EntryConfirmationStatus =
  | "UNREVIEWED"
  | "CONFIRMED"
  | "NEEDS_CLARIFICATION"
  | "NOT_USED";

export interface EvidenceArtifact {
  id: string;
  name: string;
  type: ArtifactType;
  mimeType: string;
  size: number;
  previewUrl?: string;
  fileUrl?: string;
  aiCaption?: string;
  aiCaptionStatus: ArtifactCaptionStatus;
  flaggedByServiceMember: boolean;
  flagNote?: string;
}

export interface DraftArtifact {
  id: string;
  file: File;
  type: ArtifactType;
}

export type SubmissionState =
  | "IDLE"
  | "SAVING_ENTRY"
  | "UPLOADING_EVIDENCE"
  | "EVIDENCE_SECURED"
  | "ANALYZING_EVIDENCE"
  | "ANALYSIS_COMPLETE"
  | "UPLOAD_FAILED"
  | "ANALYSIS_FAILED";

export interface PerformanceEntry {
  id: string;
  supportFormId: string;
  entryDate: string;
  section: LeadershipDimension;
  entryType: "ACCOMPLISHMENT";
  rawText: string;
  goalId?: string;
  confirmationStatus: EntryConfirmationStatus;
  clarificationNote?: string;
  artifacts: EvidenceArtifact[];
  createdAt: string;
  submittedBy: string;
  usedInEvalId?: string;
  withdrawnAt?: string;
}

export interface CaptureDraft {
  clientRequestId: string;
  rawText: string;
  section: LeadershipDimension;
  goalId?: string;
  eventDate: string;
  artifacts: DraftArtifact[];
  flaggedByServiceMember: boolean;
  flagNote?: string;
  attested: boolean;
}

export type ObservationFeedbackType = "POSITIVE" | "DEVELOPMENTAL" | "NEUTRAL";

export interface RaterAssignment {
  supportFormId: string;
  soldierId: string;
  displayName: string;
  rank: string;
  goals: Array<{ id: string; title: string }>;
}

export interface ObservationDraft {
  clientRequestId: string;
  supportFormId: string;
  factualNote: string;
  sectionKey: LeadershipDimension;
  feedbackType: ObservationFeedbackType;
  occurredAt: string;
  goalId?: string;
  artifacts: DraftArtifact[];
}

export interface MobileBootstrap {
  user: {
    id: string;
    displayName: string;
    rank: string;
    roles: string[];
    applicationSupportRole: "NONE" | "SUPPORT" | "ADMINISTRATOR";
  };
  canViewPilotImpact: boolean;
  supportForm: {
    id: string;
    label: string;
    ratingPeriod: string;
    ratingPeriodStart: string;
    ratingPeriodEnd: string;
    status: string;
    goalsEstablishedDimensions: LeadershipDimension[];
  } | null;
  goals: Array<{ id: string; title: string; sectionKey: LeadershipDimension }>;
  entries: PerformanceEntry[];
  raterAssignments: RaterAssignment[];
}

export type PilotWorkflowType = "SOLDIER_ENTRY" | "RATER_OBSERVATION";

export type PilotMetricEventType =
  | "WORKFLOW_STARTED"
  | "EVIDENCE_STEP_REACHED"
  | "WORKFLOW_COMPLETED"
  | "WORKFLOW_FAILED"
  | "DRAFT_RECOVERED";

export interface PilotMetricEventInput {
  clientEventId: string;
  pilotId: "MERIT_MOBILE_PILOT";
  workflowId: string;
  workflowType: PilotWorkflowType;
  eventType: PilotMetricEventType;
  durationMs?: number;
  hasEvidence?: boolean;
  evidenceCount?: number;
  occurredAt: string;
}

export interface PilotKpiSummary {
  dataStatus: "LIVE_AGGREGATE" | "SYNTHETIC_DEMO";
  pilotId: string;
  period: { days: number; since: string; through: string };
  scope: { unitCount: number };
  adoption: {
    activeParticipants: number;
    repeatParticipants: number;
    workflowsStarted: number;
    workflowsCompleted: number;
    workflowsFailed: number;
    completionRate: number;
    draftRecoveries: number;
  };
  speed: {
    medianCaptureSeconds: number | null;
    measuredCompletions: number;
    timeSavings: {
      status: "BASELINE_REQUIRED" | "MEASURED";
      savedHours: number | null;
      message: string;
    };
  };
  outcomes: {
    mobileRecords: number;
    soldierEntries: number;
    raterObservations: number;
    reviewedRecords: number;
    usedInEvaluation: number;
    releasedObservations: number;
    positiveObservations: number;
  };
  quality: {
    evidenceBackedEntries: number;
    evidenceBackedPercent: number;
    goalLinkedRecords: number;
    goalLinkedPercent: number;
    confirmed: number;
    needsClarification: number;
    notUsed: number;
    awaitingReview: number;
    medianReviewLagHours: number | null;
    measuredReviews: number;
  };
  dimensionCoverage: Array<{ dimension: LeadershipDimension; records: number; percent: number }>;
  weeklyTrend: Array<{ weekStart: string; entries: number; observations: number; records: number }>;
  sampleSize: { telemetryEvents: number; mobileRecords: number };
  privacy: { aggregationOnly: boolean; message: string };
}
